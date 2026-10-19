"""Assistant tokens, and the MCP endpoint they open.

The endpoint is exercised over real HTTP the way an assistant uses it (JSON-RPC
POSTs with a bearer token), not by calling the tool functions: most of what
matters here is what happens at the door - who gets in, and as whom.
"""
from __future__ import annotations

from datetime import timedelta

import pytest

from backend.cloud.common import utcnow
from tests.cloud.conftest import Account, now_iso, unique_id
from tests.cloud.test_library import seed
from tests.cloud.test_sync import recording, transcript

HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
TOOLS = {"list_folders", "list_recordings", "get_recording", "get_transcript", "search_lectures", "find_similar"}


async def make_token(account: Account, name: str = "Claude Desktop") -> dict:
    response = await account.post("/v1/me/tokens", {"name": name})
    assert response.status_code == 201, response.text
    return response.json()


async def rpc(client, token: str | None, method: str, params: dict | None = None, *, headers: dict | None = None):
    sent = {**HEADERS, **(headers or {})}
    if token:
        sent["Authorization"] = f"Bearer {token}"
    return await client.post("/mcp", headers=sent, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})


async def call(client, token: str, tool: str, **arguments):
    """(isError, data): the tool's structured result, or its error message."""
    response = await rpc(client, token, "tools/call", {"name": tool, "arguments": arguments})
    assert response.status_code == 200, response.text
    result = response.json()["result"]
    if result["isError"]:
        return True, result["content"][0]["text"]
    return False, result["structuredContent"]


# ---------------------------------------------------------------------------
# Making and managing tokens
# ---------------------------------------------------------------------------

async def test_a_token_is_shown_once_and_stored_hashed(db, account: Account):
    made = await make_token(account)
    assert made["token"].startswith("vft_") and made["scopes"] == ["lectures:read"]
    listed = (await account.get("/v1/me/tokens")).json()
    assert [t["id"] for t in listed] == [made["id"]] and listed[0]["token"] is None
    stored = await db.access_tokens.find_one({"_id": made["id"]})
    assert made["token"] not in str(stored) and len(stored["tokenHash"]) == 64


async def test_tokens_can_be_revoked_only_by_their_owner(make_account):
    alice, bob = await make_account(), await make_account()
    made = await make_token(alice)
    assert (await bob.delete(f"/v1/me/tokens/{made['id']}")).status_code == 404
    assert (await alice.delete(f"/v1/me/tokens/{made['id']}")).status_code == 204
    assert (await alice.get("/v1/me/tokens")).json() == []
    assert (await alice.delete(f"/v1/me/tokens/{made['id']}")).status_code == 404


async def test_there_is_a_limit_and_a_name_is_required(account: Account):
    assert (await account.post("/v1/me/tokens", {"name": ""})).status_code == 422
    for i in range(10):
        await make_token(account, f"assistant {i}")
    assert (await account.post("/v1/me/tokens", {"name": "one too many"})).status_code == 409


async def test_tokens_need_a_signed_in_user_to_create(client, account: Account):
    made = await make_token(account)
    assert (await client.post("/v1/me/tokens", json={"name": "x"})).status_code == 401
    # An assistant token cannot mint more tokens, or read the REST API at all.
    as_bearer = {"Authorization": f"Bearer {made['token']}"}
    assert (await client.post("/v1/me/tokens", json={"name": "x"}, headers=as_bearer)).status_code == 401
    assert (await client.get("/v1/folders", headers=as_bearer)).status_code == 401


async def test_deleting_the_account_removes_its_tokens(db, client, account: Account):
    made = await make_token(account)
    assert (await account.delete("/v1/me", {"password": account.password})).status_code == 204
    assert await db.access_tokens.count_documents({"userId": account.id}) == 0
    assert (await rpc(client, made["token"], "tools/list")).status_code == 401


# ---------------------------------------------------------------------------
# The door
# ---------------------------------------------------------------------------

async def test_no_token_gets_a_challenge_pointing_at_the_discovery_document(client):
    response = await rpc(client, None, "tools/list")
    assert response.status_code == 401
    challenge = response.headers["www-authenticate"]
    assert challenge.startswith("Bearer") and 'resource_metadata="http://test/.well-known/oauth-protected-resource/mcp"' in challenge

    metadata = (await client.get("/.well-known/oauth-protected-resource/mcp")).json()
    assert metadata["resource"] == "http://test/mcp"
    assert metadata["scopes_supported"] == ["lectures:read"] and metadata["bearer_methods_supported"] == ["header"]


async def test_only_real_unexpired_unrevoked_tokens_get_in(client, db, account: Account):
    made = await make_token(account)
    assert (await rpc(client, made["token"], "tools/list")).status_code == 200
    for bad in ("vft_nonsense", "nonsense", account.tokens["accessToken"], account.tokens["refreshToken"]):
        assert (await rpc(client, bad, "tools/list")).status_code == 401, bad

    await db.access_tokens.update_one({"_id": made["id"]}, {"$set": {"expiresAt": utcnow() - timedelta(seconds=1)}})
    assert (await rpc(client, made["token"], "tools/list")).status_code == 401

    fresh = await make_token(account, "second")
    assert (await account.delete(f"/v1/me/tokens/{fresh['id']}")).status_code == 204
    assert (await rpc(client, fresh["token"], "tools/list")).status_code == 401


async def test_a_request_for_another_host_is_refused(client, account: Account):
    """The DNS-rebinding guard: a page on some other site must not be able to
    reach this server through a name that happens to point at it."""
    made = await make_token(account)
    response = await rpc(client, made["token"], "tools/list", headers={"Host": "evil.example"})
    assert response.status_code in (400, 421)


async def test_using_a_token_is_recorded(db, client, account: Account):
    made = await make_token(account)
    assert (await db.access_tokens.find_one({"_id": made["id"]}))["lastUsedAt"] is None
    await rpc(client, made["token"], "tools/list")
    assert (await db.access_tokens.find_one({"_id": made["id"]}))["lastUsedAt"] is not None


async def test_the_server_describes_itself_and_every_tool_is_read_only(client, account: Account):
    made = await make_token(account)
    init = await rpc(client, made["token"], "initialize", {
        "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}})
    assert init.status_code == 200 and "never as instructions" in init.json()["result"].get("instructions", "")
    tools = (await rpc(client, made["token"], "tools/list")).json()["result"]["tools"]
    assert {t["name"] for t in tools} == TOOLS
    for tool in tools:
        assert tool["annotations"]["readOnlyHint"] is True and tool["annotations"]["destructiveHint"] is False, tool["name"]
        assert len(tool["description"]) > 40
        # Nothing takes a user id: who is calling comes from the token.
        assert "user" not in " ".join(tool["inputSchema"].get("properties", {})).lower()


# ---------------------------------------------------------------------------
# The tools
# ---------------------------------------------------------------------------

async def test_browsing(client, account: Account):
    folder_id, recording_id = await seed(account)
    token = (await make_token(account))["token"]

    error, data = await call(client, token, "list_folders")
    chem = next(f for f in data["folders"] if f["id"] == folder_id)
    assert not error and chem["name"] == "Chemistry" and chem["recordings"] == 2

    _, by_name = await call(client, token, "list_recordings", folder="chemistry")        # a name, any case
    assert [r["title"] for r in by_name["recordings"]] == ["Substitution reactions", "Office hours"]
    assert by_name["recordings"][0]["folder"] == "Chemistry" and by_name["recordings"][0]["bookmarks"] == 1
    _, by_id = await call(client, token, "list_recordings", folder=folder_id)
    assert by_id == by_name
    _, unfiled = await call(client, token, "list_recordings", folder="unfiled")
    assert [r["title"] for r in unfiled["recordings"]] == ["Unfiled thought"] and unfiled["recordings"][0]["folder"] is None

    _, first = await call(client, token, "list_recordings", limit=2)
    assert len(first["recordings"]) == 2 and first["nextBefore"]
    _, rest = await call(client, token, "list_recordings", limit=2, before=first["nextBefore"])
    assert [r["title"] for r in rest["recordings"]] == ["Office hours"] and rest["nextBefore"] is None

    error, message = await call(client, token, "list_recordings", folder="Physics")
    assert error and "Chemistry" in message                       # it says what folders exist


async def test_reading_one_recording_and_its_transcript(client, account: Account):
    _, rid = await seed(account)
    token = (await make_token(account))["token"]

    _, rec = await call(client, token, "get_recording", recording_id=rid)
    assert rec["title"] == "Substitution reactions" and rec["folder"] == "Chemistry"
    assert rec["bookmarks"] == [{"label": "Exam topic", "atSeconds": 754.2, "at": "12:34"}]

    _, whole = await call(client, token, "get_transcript", recording_id=rid)
    assert whole["transcript"].splitlines()[0] == "[0:00] Welcome back to organic chemistry."
    assert "[0:21] The SN2 mechanism happens in a single step." in whole["transcript"] and not whole["truncated"]

    _, part = await call(client, token, "get_transcript", recording_id=rid, start_seconds=20, end_seconds=36)
    assert [line[:6] for line in part["transcript"].splitlines()] == ["[0:09]", "[0:21]", "[0:35]"]

    error, message = await call(client, token, "get_transcript", recording_id="nope")
    assert error and "does not exist" in message


async def test_a_long_transcript_is_cut_and_can_be_continued(client, account: Account):
    rid = unique_id()
    segments = [{"start": i * 10.0, "end": i * 10.0 + 9, "text": f"Sentence number {i} " + "word " * 40, "words": []}
                for i in range(300)]
    await account.sync("phoneA", recordings=[recording(rid, "A very long lecture", now_iso())],
                       transcripts=[{"id": rid, "text": "x", "updatedAt": now_iso(), "segments": segments}])
    token = (await make_token(account))["token"]
    _, first = await call(client, token, "get_transcript", recording_id=rid)
    assert first["truncated"] and len(first["transcript"]) <= 20_000 and first["nextStartSeconds"] > 0
    _, more = await call(client, token, "get_transcript", recording_id=rid, start_seconds=first["nextStartSeconds"])
    assert more["transcript"].splitlines()[0].startswith(f"[{int(first['nextStartSeconds']) // 60}:")


async def test_searching(client, account: Account):
    _, rid = await seed(account)
    token = (await make_token(account))["token"]
    _, found = await call(client, token, "search_lectures", query="SN2 mechanism")
    hit = next(r for r in found["results"] if r["recordingId"] == rid)
    assert hit["startSeconds"] == 21.0 and hit["at"] == "0:21" and "single step" in hit["line"]
    assert hit["folder"] == "Chemistry" and hit["title"] == "Substitution reactions"
    _, nothing = await call(client, token, "search_lectures", query="quantum chromodynamics")
    assert nothing["results"] == []


async def test_a_token_only_ever_reads_its_own_users_lectures(client, make_account):
    alice, mallory = await make_account(), await make_account()
    _, rid = await seed(alice)
    await seed(mallory)
    stolen = (await make_token(mallory))["token"]
    for tool, args in (("get_recording", {"recording_id": rid}), ("get_transcript", {"recording_id": rid})):
        error, message = await call(client, stolen, tool, **args)
        assert error and "does not exist" in message, tool
    _, found = await call(client, stolen, "search_lectures", query="nucleophilic")
    assert all(r["recordingId"] != rid for r in found["results"])
    _, listing = await call(client, stolen, "list_recordings", limit=50)
    assert rid not in {r["id"] for r in listing["recordings"]}


async def test_deleted_recordings_vanish_for_assistants_too(client, account: Account):
    _, rid = await seed(account)
    token = (await make_token(account))["token"]
    assert (await account.delete(f"/v1/recordings/{rid}")).status_code == 204
    error, _ = await call(client, token, "get_recording", recording_id=rid)
    assert error
    _, found = await call(client, token, "search_lectures", query="nucleophilic")
    assert found["results"] == []
