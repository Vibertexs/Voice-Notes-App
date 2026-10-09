"""The library over REST, search, and the HTTP plumbing around it all."""
from __future__ import annotations

import os

import pytest

from tests.cloud.conftest import Account, now_iso, unique_id
from tests.cloud.test_sync import folder, pull_all, recording, transcript

LECTURE = [
    {"start": 0.0, "end": 9.5, "text": "Welcome back to organic chemistry."},
    {"start": 9.5, "end": 21.0, "text": "Today we cover nucleophilic substitution."},
    {"start": 21.0, "end": 35.0, "text": "The SN2 mechanism happens in a single step."},
    {"start": 35.0, "end": 50.0, "text": "Remember this for the midterm exam."},
]


async def seed(account: Account) -> tuple[str, str]:
    fid, rid = unique_id(), unique_id()
    segments = [{**s, "words": [{"w": w, "s": s["start"]} for w in s["text"].split()]} for s in LECTURE]
    await account.sync(
        "phoneA",
        folders=[folder(fid, "Chemistry", now_iso())],
        recordings=[
            recording(rid, "Substitution reactions", now_iso(), folderId=fid, createdAt="2026-09-02T09:00:00Z"),
            recording(unique_id(), "Office hours", now_iso(), folderId=fid, createdAt="2026-09-01T09:00:00Z",
                      durationSeconds=600),
            recording(unique_id(), "Unfiled thought", now_iso(), createdAt="2026-09-03T09:00:00Z"),
        ],
        transcripts=[{"id": rid, "updatedAt": now_iso(), "segments": segments,
                      "text": " ".join(s["text"] for s in LECTURE)}],
    )
    return fid, rid


# ---------------------------------------------------------------------------
# Folders and recordings
# ---------------------------------------------------------------------------

async def test_folders_come_with_counts(account: Account):
    fid, _ = await seed(account)
    folders = (await account.get("/v1/folders")).json()["folders"]
    chem = next(f for f in folders if f["id"] == fid)
    assert chem["recordingCount"] == 2
    assert chem["durationSeconds"] == pytest.approx(3600.5)
    assert chem["lastRecordedAt"].startswith("2026-09-02")


async def test_listing_recordings_by_folder_and_inbox(account: Account):
    fid, rid = await seed(account)
    in_folder = (await account.get("/v1/recordings", params={"folder": fid})).json()["recordings"]
    assert [r["title"] for r in in_folder] == ["Substitution reactions", "Office hours"]
    assert in_folder[0]["markerCount"] == 1 and "markers" not in in_folder[0]
    inbox = (await account.get("/v1/recordings", params={"folder": "inbox"})).json()["recordings"]
    assert [r["title"] for r in inbox] == ["Unfiled thought"]

    page = (await account.get("/v1/recordings", params={"limit": 2})).json()
    assert len(page["recordings"]) == 2 and page["next"]
    rest = (await account.get("/v1/recordings", params={"limit": 2, "before": page["next"]})).json()
    assert [r["title"] for r in rest["recordings"]] == ["Office hours"]
    assert rest["next"] is None


async def test_rest_edits_reach_the_phones(account: Account):
    fid, rid = await seed(account)
    _, cursor = await pull_all(account, "phoneB")
    renamed = await account.patch(f"/v1/recordings/{rid}", {"title": "SN1 and SN2", "favorite": True})
    assert renamed.status_code == 200 and renamed.json()["title"] == "SN1 and SN2"
    new_folder = (await account.post("/v1/folders", {"name": "Exams", "color": "red"})).json()
    moved = await account.patch(f"/v1/recordings/{rid}", {"folderId": new_folder["id"]})
    assert moved.json()["folderId"] == new_folder["id"]

    # The phone that recorded it sees the change too, not just other phones.
    pulled, _ = await pull_all(account, "phoneA")
    got = next(r for r in pulled["recordings"] if r["id"] == rid)
    assert got["title"] == "SN1 and SN2" and got["favorite"] is True and got["folderId"] == new_folder["id"]
    assert new_folder["id"] in {f["id"] for f in pulled["folders"]}


async def test_deleting_a_folder_keeps_its_recordings(account: Account):
    fid, rid = await seed(account)
    assert (await account.delete(f"/v1/folders/{fid}")).status_code == 204
    assert fid not in {f["id"] for f in (await account.get("/v1/folders")).json()["folders"]}
    recording_now = (await account.get(f"/v1/recordings/{rid}")).json()
    assert recording_now["folderId"] is None
    assert (await account.delete(f"/v1/folders/{fid}")).status_code == 404


async def test_archived_folders_are_listed_separately(account: Account):
    fid, _ = await seed(account)
    await account.patch(f"/v1/folders/{fid}", {"archived": True})
    assert fid not in {f["id"] for f in (await account.get("/v1/folders")).json()["folders"]}
    assert fid in {f["id"] for f in (await account.get("/v1/folders", params={"archived": "true"})).json()["folders"]}


async def test_moving_into_someone_elses_folder_is_refused(make_account):
    alice, bob = await make_account(), await make_account()
    alice_folder, _ = await seed(alice)
    _, bob_recording = await seed(bob)
    response = await bob.patch(f"/v1/recordings/{bob_recording}", {"folderId": alice_folder})
    assert response.status_code == 404


async def test_another_users_recording_is_not_found(make_account):
    alice, bob = await make_account(), await make_account()
    _, rid = await seed(alice)
    assert (await bob.get(f"/v1/recordings/{rid}")).status_code == 404
    assert (await bob.get(f"/v1/recordings/{rid}/transcript")).status_code == 404
    assert (await bob.patch(f"/v1/recordings/{rid}", {"title": "mine now"})).status_code == 404
    assert (await bob.delete(f"/v1/recordings/{rid}")).status_code == 404


# ---------------------------------------------------------------------------
# Transcripts
# ---------------------------------------------------------------------------

async def test_transcript_whole_and_sliced(account: Account):
    _, rid = await seed(account)
    whole = (await account.get(f"/v1/recordings/{rid}/transcript")).json()
    assert len(whole["segments"]) == 4
    assert "words" not in whole["segments"][0]
    assert "userId" not in whole

    part = (await account.get(f"/v1/recordings/{rid}/transcript", params={"start": 20, "end": 36})).json()
    assert [s["start"] for s in part["segments"]] == [9.5, 21.0, 35.0]
    assert part["text"].startswith("Today we cover")

    timed = (await account.get(f"/v1/recordings/{rid}/transcript", params={"words": "true"})).json()
    assert timed["segments"][0]["words"][0] == {"w": "Welcome", "s": 0.0}


async def test_a_recording_without_a_transcript_says_so(account: Account):
    rid = unique_id()
    await account.sync("phoneA", recordings=[recording(rid, "Still transcribing", now_iso())])
    response = await account.get(f"/v1/recordings/{rid}/transcript")
    assert response.status_code == 404
    assert "no transcript" in response.json()["detail"]


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

async def test_search_finds_the_moment_something_was_said(account: Account):
    _, rid = await seed(account)
    found = (await account.get("/v1/search", params={"q": "SN2 mechanism"})).json()
    hit = next(r for r in found["results"] if r["recordingId"] == rid)
    assert hit["startSeconds"] == 21.0
    assert "single step" in hit["excerpt"]
    assert hit["title"] == "Substitution reactions"


async def test_search_matches_titles_too(account: Account):
    await seed(account)
    found = (await account.get("/v1/search", params={"q": "office hours"})).json()
    assert [r["title"] for r in found["results"]] == ["Office hours"]
    assert found["results"][0]["startSeconds"] is None


async def test_search_treats_the_query_as_text_not_a_pattern(account: Account):
    await seed(account)
    found = (await account.get("/v1/search", params={"q": ".*"})).json()
    assert found["results"] == []


async def test_search_only_sees_your_own_lectures(make_account):
    alice, bob = await make_account(), await make_account()
    await seed(alice)
    assert (await bob.get("/v1/search", params={"q": "nucleophilic"})).json()["results"] == []


@pytest.mark.atlas_search
@pytest.mark.skipif(not os.environ.get("VOICEFLOW_TEST_ATLAS_SEARCH"), reason="set VOICEFLOW_TEST_ATLAS_SEARCH=1")
async def test_atlas_search(app, account: Account):
    """Waits for Atlas to build the index on the test database, then searches."""
    import asyncio
    await seed(account)
    search = app.state.search
    for _ in range(90):
        search._checked = 0
        indexes = [i async for i in await app.state.db.transcripts.list_search_indexes()]
        if indexes and indexes[0].get("queryable"):
            break
        await asyncio.sleep(2)
    await asyncio.sleep(3)  # the index trails the collection slightly
    found = (await account.get("/v1/search", params={"q": "nucleophilic substitution"})).json()
    assert found["engine"] == "atlas"
    assert found["results"] and found["results"][0]["startSeconds"] == 9.5


# ---------------------------------------------------------------------------
# HTTP plumbing
# ---------------------------------------------------------------------------

async def test_health(client):
    assert (await client.get("/healthz")).json() == {"ok": True}
    ready = await client.get("/readyz")
    assert ready.status_code == 200 and ready.json()["database"] == "ok"


async def test_security_headers(client):
    response = await client.get("/healthz")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "no-store"


async def test_oversized_requests_are_refused(app, account: Account):
    limit = app.state.settings.max_body_bytes
    huge = "x" * (limit + 10)
    response = await account.client.post(
        "/v1/sync", content=huge, headers={**account.headers, "Content-Type": "application/json"})
    assert response.status_code == 413

    async def chunks():
        for _ in range(limit // 65536 + 2):
            yield b"x" * 65536
    streamed = await account.client.post(
        "/v1/sync", content=chunks(), headers={**account.headers, "Content-Type": "application/json"})
    assert streamed.status_code == 413


async def test_ids_in_paths_are_validated(account: Account):
    assert (await account.get("/v1/recordings/not valid!")).status_code == 422


async def test_unexpected_errors_do_not_leak_details(app, account: Account, monkeypatch):
    from backend.cloud import library

    async def broken(*args, **kwargs):
        raise RuntimeError("connection string mongodb+srv://user:hunter2@...")
    monkeypatch.setattr(library, "list_folders", broken)
    from httpx import ASGITransport, AsyncClient
    # raise_app_exceptions=False: see the response a real client would see.
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as http:
        response = await http.get("/v1/folders", headers=account.headers)
    assert response.status_code == 500
    assert "hunter2" not in response.text
