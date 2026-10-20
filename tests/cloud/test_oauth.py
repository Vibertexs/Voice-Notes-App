"""Connecting an assistant by signing in: registration, consent, tokens, revocation.

The flow is driven over real HTTP, the way Claude or ChatGPT drives it: register,
send the person to /authorize, they approve on the consent page with a Google
credential, the assistant swaps the code for tokens and calls the MCP endpoint.
"""
from __future__ import annotations

import base64
import hashlib
import secrets
from urllib.parse import parse_qs, urlsplit

import pytest

from backend.cloud import cimd, oauth
from tests.cloud.conftest import Account, FakeGoogle, unique_id
from tests.cloud.test_library import seed
from tests.cloud.test_mcp import call, rpc

REDIRECT = "http://localhost:8765/callback"


def query_of(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


class Assistant:
    """What an MCP client does, minus the UI."""

    def __init__(self, client, name: str = "Test Assistant") -> None:
        self.client, self.name = client, name
        self.client_id: str = ""
        self.verifier = secrets.token_urlsafe(48)
        self.state = secrets.token_urlsafe(8)

    @property
    def challenge(self) -> str:
        return base64.urlsafe_b64encode(hashlib.sha256(self.verifier.encode()).digest()).decode().rstrip("=")

    async def register(self, **overrides):
        body = {"redirect_uris": [REDIRECT], "client_name": self.name, "token_endpoint_auth_method": "none",
                "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
                "scope": "lectures:read", **overrides}
        response = await self.client.post("/register", json=body)
        if response.status_code == 201:
            self.client_id = response.json()["client_id"]
        return response

    async def authorize(self, **overrides):
        params = {"response_type": "code", "client_id": self.client_id, "redirect_uri": REDIRECT,
                  "code_challenge": self.challenge, "code_challenge_method": "S256", "state": self.state,
                  "resource": "http://localhost/mcp", "scope": "lectures:read", **overrides}
        return await self.client.get("/authorize", params=params)

    async def start(self, **overrides) -> str:
        """Authorize, and return the id of the request waiting for the person's approval."""
        response = await self.authorize(**overrides)
        assert response.status_code == 302, response.text
        location = response.headers["location"]
        assert urlsplit(location).path == "/oauth/consent", location
        return query_of(location)["request"]

    async def exchange(self, code: str, **overrides):
        return await self.client.post("/token", data={
            "grant_type": "authorization_code", "client_id": self.client_id, "code": code,
            "redirect_uri": REDIRECT, "code_verifier": self.verifier, **overrides})

    async def refresh(self, refresh_token: str):
        return await self.client.post("/token", data={
            "grant_type": "refresh_token", "client_id": self.client_id, "refresh_token": refresh_token})


async def approve(client, fake_google: FakeGoogle, request_id: str, sub: str, **token_overrides):
    credential = fake_google.token(sub, nonce=token_overrides.pop("nonce", request_id), **token_overrides)
    return await client.post("/oauth/consent", json={"request": request_id, "credential": credential})


async def sign_in_google(db, account: Account) -> str:
    """Give a test account a Google identity, as signing in with Google on the phone would."""
    sub = unique_id("google.")
    await db.users.update_one({"_id": account.id}, {"$set": {"googleSub": sub}})
    return sub


async def connected(client, db, fake_google, account: Account, name: str = "Test Assistant") -> tuple[Assistant, dict]:
    """The whole flow, ending with the assistant holding tokens."""
    sub = await sign_in_google(db, account)
    assistant = Assistant(client, name)
    assert (await assistant.register()).status_code == 201
    request_id = await assistant.start()
    done = await approve(client, fake_google, request_id, sub)
    assert done.status_code == 200, done.text
    returned = query_of(done.json()["redirect"])
    assert returned["state"] == assistant.state and returned["iss"] == "http://localhost"
    exchanged = await assistant.exchange(returned["code"])
    assert exchanged.status_code == 200, exchanged.text
    return assistant, exchanged.json()


# ---------------------------------------------------------------------------
# Discovery and registration
# ---------------------------------------------------------------------------

async def test_the_discovery_document_describes_a_public_pkce_server(client):
    meta = (await client.get("/.well-known/oauth-authorization-server")).json()
    assert meta["issuer"].rstrip("/") == "http://localhost"
    assert meta["authorization_endpoint"].endswith("/authorize") and meta["token_endpoint"].endswith("/token")
    assert meta["registration_endpoint"].endswith("/register") and meta["revocation_endpoint"].endswith("/revoke")
    assert meta["code_challenge_methods_supported"] == ["S256"]
    assert meta["token_endpoint_auth_methods_supported"] == ["none"]
    assert meta["client_id_metadata_document_supported"] is True
    assert meta["authorization_response_iss_parameter_supported"] is True


async def test_registered_clients_are_always_public(client):
    # Asking for a secret does not get one: every client here relies on PKCE alone.
    response = await Assistant(client).register(token_endpoint_auth_method="client_secret_post")
    body = response.json()
    assert response.status_code == 201 and body["token_endpoint_auth_method"] == "none"
    assert not body.get("client_secret") and body["scope"] == "lectures:read"


@pytest.mark.parametrize("uri", ["javascript:alert(1)", "http://evil.example/cb", "data:text/html,hi", "https://x.example/cb#frag", "file:///etc/passwd"])
async def test_dangerous_redirect_addresses_are_refused_at_registration(client, uri):
    response = await Assistant(client).register(redirect_uris=[uri])
    assert response.status_code == 400


@pytest.mark.parametrize("uri", ["https://chatgpt.example/callback", "http://127.0.0.1:5000/cb", "http://localhost:9/cb", "claude://oauth/callback"])
async def test_ordinary_redirect_addresses_are_accepted(client, uri):
    assert (await Assistant(client).register(redirect_uris=[uri])).status_code == 201


def test_redirect_rules():
    assert oauth.valid_redirect("https://a.example/cb") and oauth.valid_redirect("com.example.app:/cb")
    assert not oauth.valid_redirect("http://a.example/cb") and not oauth.valid_redirect("javascript:x")
    assert not oauth.valid_redirect("https:///nohost") and not oauth.valid_redirect("https://a.example/cb#x")


@pytest.mark.parametrize("registered, asked, allowed", [
    ("http://localhost:1111/callback", "http://localhost:46404/callback", True),         # the port is the app's to pick
    ("http://127.0.0.1:1111/cb", "http://127.0.0.1:9/cb", True),
    ("http://[::1]:1111/cb", "http://[::1]:9/cb", True),
    ("http://localhost:1111/callback", "http://localhost:9/other", False),                # a different path is a different address
    ("http://localhost:1111/callback", "http://127.0.0.1:9/callback", False),             # and so is a different host
    ("http://localhost:1111/callback", "https://localhost:9/callback", False),            # or scheme
    ("https://app.example:443/cb", "https://app.example:444/cb", False),                  # off this machine, the port counts
    ("https://app.example/cb", "http://localhost:9/cb", False),                           # nothing registered here to match
])
async def test_only_a_loopback_redirect_may_change_its_port(client, registered, asked, allowed):
    assistant = Assistant(client)
    assert (await assistant.register(redirect_uris=[registered])).status_code == 201
    response = await assistant.authorize(redirect_uri=asked)
    if allowed:
        assert response.status_code == 302 and urlsplit(response.headers["location"]).path == "/oauth/consent"
    else:
        assert response.status_code == 400                                                   # refused, and not redirected anywhere


async def test_a_local_app_on_another_port_completes_the_flow(client, db, fake_google, account: Account):
    """What Claude Code does: registers one port, then listens on a different one."""
    sub = await sign_in_google(db, account)
    assistant = Assistant(client)
    await assistant.register(redirect_uris=["http://localhost:1111/callback"])
    elsewhere = "http://localhost:46404/callback"
    request_id = await assistant.start(redirect_uri=elsewhere)
    redirect = (await approve(client, fake_google, request_id, sub)).json()["redirect"]
    assert redirect.startswith(elsewhere + "?")                                   # the code goes to the port it asked for
    code = query_of(redirect)["code"]
    assert (await assistant.exchange(code, redirect_uri="http://localhost:9/callback")).status_code == 400
    again = (await approve(client, fake_google, await assistant.start(redirect_uri=elsewhere), sub)).json()["redirect"]
    assert (await assistant.exchange(query_of(again)["code"], redirect_uri=elsewhere)).status_code == 200


# ---------------------------------------------------------------------------
# The whole flow
# ---------------------------------------------------------------------------

async def test_an_assistant_connects_and_reads_only_that_users_lectures(client, db, fake_google, make_account):
    owner, other = await make_account(), await make_account()
    _, owner_recording = await seed(owner)
    await seed(other)
    assistant, tokens = await connected(client, db, fake_google, owner)
    assert tokens["token_type"] == "Bearer" and tokens["scope"] == "lectures:read" and tokens["refresh_token"].startswith("vfr_")

    error, data = await call(client, tokens["access_token"], "get_recording", recording_id=owner_recording)
    assert not error and data["title"] == "Substitution reactions"
    _, listing = await call(client, tokens["access_token"], "list_recordings", limit=50)
    assert owner_recording in {r["id"] for r in listing["recordings"]}
    assert len(listing["recordings"]) == 3                                      # the owner's three, not the other user's


async def test_the_consent_page_names_the_assistant_and_escapes_it(client, db, fake_google):
    assistant = Assistant(client, name='<script>alert("x")</script> Claude')
    await assistant.register()
    page = await client.get("/oauth/consent", params={"request": await assistant.start()})
    assert page.status_code == 200 and "<script>alert" not in page.text and "&lt;script&gt;alert" in page.text
    policy = page.headers["content-security-policy"]
    assert "default-src 'none'" in policy and "frame-ancestors 'none'" in policy and "nonce-" in policy
    assert "introduced itself" in page.text                                     # a self-registered client is not vouched for

    stale = await client.get("/oauth/consent", params={"request": "nonsense"})
    assert stale.status_code == 400 and "expired" in stale.text


async def test_only_an_existing_account_can_approve_and_only_for_this_request(client, db, fake_google, account: Account):
    sub = await sign_in_google(db, account)
    assistant = Assistant(client)
    await assistant.register()
    request_id = await assistant.start()

    stranger = await approve(client, fake_google, request_id, unique_id("google."))
    assert stranger.status_code == 403 and "does not have an Ekho account" in stranger.json()["detail"]
    assert await db.users.count_documents({"googleSub": {"$exists": True}, "createdAt": {"$exists": False}}) == 0

    elsewhere = await approve(client, fake_google, request_id, sub, nonce="a-credential-for-another-page-entirely")
    assert elsewhere.status_code == 401                                         # bound to the request by its nonce
    forged = await client.post("/oauth/consent", json={"request": request_id, "credential": "x" * 40})
    assert forged.status_code == 401

    ok = await approve(client, fake_google, request_id, sub)
    assert ok.status_code == 200
    again = await approve(client, fake_google, request_id, sub)
    assert again.status_code == 400                                             # a request is approved once


async def test_declining_sends_the_assistant_an_error_not_a_code(client):
    assistant = Assistant(client)
    await assistant.register()
    request_id = await assistant.start()
    response = await client.post("/oauth/deny", json={"request": request_id})
    returned = query_of(response.json()["redirect"])
    assert returned["error"] == "access_denied" and returned["state"] == assistant.state and "code" not in returned
    assert (await client.post("/oauth/deny", json={"request": request_id})).status_code == 400


async def test_a_request_for_another_resource_or_scope_is_refused(client):
    assistant = Assistant(client)
    await assistant.register()
    wrong_resource = await assistant.authorize(resource="https://other.example/mcp")
    assert query_of(wrong_resource.headers["location"])["error"] == "invalid_target"
    wrong_scope = await assistant.authorize(scope="lectures:write")
    assert query_of(wrong_scope.headers["location"])["error"] == "invalid_scope"
    unknown = await Assistant(client).authorize()
    assert unknown.status_code == 400                                           # unknown client: no redirect anywhere
    no_pkce = await assistant.authorize(code_challenge_method="plain")
    assert no_pkce.status_code in (302, 400) and "code=" not in no_pkce.headers.get("location", "")


# ---------------------------------------------------------------------------
# Codes and tokens
# ---------------------------------------------------------------------------

async def test_the_code_needs_the_pkce_verifier_and_works_once(client, db, fake_google, account: Account):
    sub = await sign_in_google(db, account)
    assistant = Assistant(client)
    await assistant.register()
    request_id = await assistant.start()
    code = query_of((await approve(client, fake_google, request_id, sub)).json()["redirect"])["code"]

    wrong = await assistant.exchange(code, code_verifier="not-the-verifier-" + "x" * 30)
    assert wrong.status_code == 400 and wrong.json()["error"] == "invalid_grant"
    assert (await assistant.exchange(code, redirect_uri="http://localhost:9/else")).status_code == 400

    first = await assistant.exchange(code)
    assert first.status_code == 200
    # Presented a second time - what a thief with a copy would do - it fails and the grant is revoked.
    second = await assistant.exchange(code)
    assert second.status_code == 400 and second.json()["error"] == "invalid_grant"
    assert (await rpc(client, first.json()["access_token"], "tools/list")).status_code == 401


async def test_another_client_cannot_use_a_code(client, db, fake_google, account: Account):
    sub = await sign_in_google(db, account)
    victim, thief = Assistant(client, "Victim"), Assistant(client, "Thief")
    await victim.register(), await thief.register()
    code = query_of((await approve(client, fake_google, await victim.start(), sub)).json()["redirect"])["code"]
    stolen = await thief.exchange(code, code_verifier=victim.verifier)
    assert stolen.status_code == 400


async def test_refreshing_rotates_and_a_replayed_refresh_token_ends_the_grant(client, db, fake_google, account: Account):
    assistant, tokens = await connected(client, db, fake_google, account)
    renewed = await assistant.refresh(tokens["refresh_token"])
    assert renewed.status_code == 200
    new = renewed.json()
    assert new["access_token"] != tokens["access_token"] and new["refresh_token"] != tokens["refresh_token"]
    assert (await rpc(client, new["access_token"], "tools/list")).status_code == 200

    replay = await assistant.refresh(tokens["refresh_token"])                   # the old one, again
    assert replay.status_code == 400
    # Everything that grant issued stops working, including the newest tokens.
    assert (await rpc(client, new["access_token"], "tools/list")).status_code == 401
    assert (await assistant.refresh(new["refresh_token"])).status_code == 400


async def test_tokens_are_stored_hashed_and_expire(client, db, fake_google, account: Account):
    _, tokens = await connected(client, db, fake_google, account)
    stored = await db.oauth_tokens.find({"userId": account.id}).to_list(10)
    assert len(stored) == 2 and all(tokens[k] not in str(stored) for k in ("access_token", "refresh_token"))
    await db.oauth_tokens.update_many({"userId": account.id, "kind": "access"}, {"$set": {"expiresAt": oauth.utcnow()}})
    assert (await rpc(client, tokens["access_token"], "tools/list")).status_code == 401


async def test_hand_made_tokens_still_work_beside_signed_in_ones(client, account: Account):
    made = (await account.post("/v1/me/tokens", {"name": "Laptop"})).json()["token"]
    assert (await rpc(client, made, "tools/list")).status_code == 200


# ---------------------------------------------------------------------------
# Revoking
# ---------------------------------------------------------------------------

async def test_the_app_lists_connections_and_disconnects_them(client, db, fake_google, make_account):
    alice, mallory = await make_account(), await make_account()
    _, tokens = await connected(client, db, fake_google, alice, name="Claude")
    listed = (await alice.get("/v1/me/connections")).json()
    assert [g["name"] for g in listed] == ["Claude"] and listed[0]["scopes"] == ["lectures:read"]
    assert (await rpc(client, tokens["access_token"], "tools/list")).status_code == 200
    assert (await db.oauth_grants.find_one({"_id": listed[0]["id"]}))["lastUsedAt"] is not None

    assert (await mallory.delete(f"/v1/me/connections/{listed[0]['id']}")).status_code == 404
    assert (await alice.delete(f"/v1/me/connections/{listed[0]['id']}")).status_code == 204
    assert (await alice.get("/v1/me/connections")).json() == []
    assert (await rpc(client, tokens["access_token"], "tools/list")).status_code == 401
    assert (await Assistant(client).refresh(tokens["refresh_token"])).status_code in (400, 401)


async def test_the_assistant_can_revoke_itself(client, db, fake_google, account: Account):
    assistant, tokens = await connected(client, db, fake_google, account)
    response = await client.post("/revoke", data={"client_id": assistant.client_id, "token": tokens["refresh_token"]})
    assert response.status_code == 200
    assert (await rpc(client, tokens["access_token"], "tools/list")).status_code == 401


async def test_a_different_client_cannot_revoke_someone_elses_grant(client, db, fake_google, account: Account):
    _, tokens = await connected(client, db, fake_google, account)
    other = Assistant(client, "Someone else")
    await other.register()
    response = await client.post("/revoke", data={"client_id": other.client_id, "token": tokens["refresh_token"]})
    assert response.status_code == 200                                          # RFC 7009: same answer either way...
    assert (await rpc(client, tokens["access_token"], "tools/list")).status_code == 200   # ...but nothing was revoked
    assert (await client.post("/revoke", data={"token": tokens["refresh_token"]})).status_code == 400


async def test_connecting_again_reuses_the_grant(client, db, fake_google, account: Account):
    sub = await sign_in_google(db, account)
    assistant = Assistant(client)
    await assistant.register()
    for _ in range(2):
        code = query_of((await approve(client, fake_google, await assistant.start(), sub)).json()["redirect"])["code"]
        assert (await assistant.exchange(code)).status_code == 200
    assert await db.oauth_grants.count_documents({"userId": account.id}) == 1


async def test_deleting_the_account_removes_every_grant(client, db, fake_google, account: Account):
    _, tokens = await connected(client, db, fake_google, account)
    assert (await account.delete("/v1/me", {"password": account.password})).status_code == 204
    for collection in (db.oauth_grants, db.oauth_tokens, db.oauth_codes):
        assert await collection.count_documents({"userId": account.id}) == 0
    assert (await rpc(client, tokens["access_token"], "tools/list")).status_code == 401


# ---------------------------------------------------------------------------
# Clients identified by a metadata document (CIMD)
# ---------------------------------------------------------------------------

async def test_a_client_can_be_identified_by_the_address_of_its_metadata(client, db, fake_google, app, account: Account):
    url = "https://assistant.example/oauth/client.json"
    fetched: list[str] = []

    async def fake_fetch(client_id: str):
        fetched.append(client_id)
        return {"client_name": "Example Assistant", "redirect_uris": [REDIRECT]}

    app.state.oauth.fetch = fake_fetch
    sub = await sign_in_google(db, account)
    assistant = Assistant(client)
    assistant.client_id = url
    request_id = await assistant.start()
    page = await client.get("/oauth/consent", params={"request": request_id})
    assert "Example Assistant" in page.text and "introduced itself" not in page.text      # named by its own address
    code = query_of((await approve(client, fake_google, request_id, sub)).json()["redirect"])["code"]
    assert (await assistant.exchange(code)).status_code == 200
    assert fetched == [url]                                                      # fetched once, then cached


async def test_a_metadata_document_that_cannot_be_used_means_no_client(client, app):
    async def broken(client_id: str):
        raise cimd.ClientMetadataError("nope")
    app.state.oauth.fetch = broken
    assistant = Assistant(client)
    assistant.client_id = "https://nowhere.example/client.json"
    assert (await assistant.authorize()).status_code == 400

    async def bad_redirects(client_id: str):
        return {"client_name": "x", "redirect_uris": ["javascript:alert(1)"]}
    app.state.oauth.fetch = bad_redirects
    assistant.client_id = "https://bad.example/client.json"
    assert (await assistant.authorize()).status_code == 400


# ---------------------------------------------------------------------------
# The fetcher refuses to be aimed at internal addresses
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("url", [
    "http://assistant.example/client.json",             # not https
    "https://assistant.example",                        # no path
    "https://assistant.example/",
    "https://127.0.0.1/client.json",                    # an address, not a name
    "https://[::1]/client.json",
    "https://localhost/client.json",
    "https://thing.internal/client.json",
    "https://assistant.example:8443/client.json",       # not the standard port
    "https://user:pass@assistant.example/client.json",  # credentials
    "https://assistant.example/client.json#frag",
    "https://assistant.example/" + "a" * 600,           # absurdly long
])
def test_client_addresses_that_could_aim_the_server_inward_are_refused(url):
    with pytest.raises(cimd.ClientMetadataError):
        cimd.check_url(url)


async def test_a_name_that_resolves_to_a_private_address_is_refused(monkeypatch):
    def answers(*addresses):
        async def getaddrinfo(self, host, port, **kwargs):
            return [(2, 1, 6, "", (address, port)) for address in addresses]
        return getaddrinfo

    import asyncio
    loop_class = type(asyncio.get_running_loop())
    for bad in ("127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "172.16.0.1", "0.0.0.0"):
        monkeypatch.setattr(loop_class, "getaddrinfo", answers(bad))
        with pytest.raises(cimd.ClientMetadataError):
            await cimd.public_address("assistant.example")
    # One private answer among public ones is still refused: the connection could land on it.
    monkeypatch.setattr(loop_class, "getaddrinfo", answers("93.184.216.34", "10.0.0.5"))
    with pytest.raises(cimd.ClientMetadataError):
        await cimd.public_address("assistant.example")
    monkeypatch.setattr(loop_class, "getaddrinfo", answers("93.184.216.34"))
    assert await cimd.public_address("assistant.example") == "93.184.216.34"


def test_a_metadata_document_must_name_itself_and_be_public():
    url = "https://assistant.example/client.json"
    good = {"client_id": url, "client_name": "Ex", "redirect_uris": [REDIRECT]}
    assert cimd.parse(url, good) == {"client_name": "Ex", "redirect_uris": [REDIRECT]}
    for broken in ({**good, "client_id": "https://someone-else.example/client.json"}, {**good, "redirect_uris": []},
                   {**good, "redirect_uris": "http://x"}, {**good, "client_secret": "s"},
                   {**good, "token_endpoint_auth_method": "client_secret_basic"}, ["not", "an", "object"]):
        with pytest.raises(cimd.ClientMetadataError):
            cimd.parse(url, broken)
