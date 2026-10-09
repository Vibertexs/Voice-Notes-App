"""Sync: last write wins, tombstones, cursors, and keeping users apart."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest

from backend.cloud import sync
from tests.cloud.conftest import Account, now_iso, unique_id


def folder(id: str, name: str, updated: str, **extra) -> dict:
    return {"id": id, "name": name, "updatedAt": updated, "color": "violet", **extra}


def recording(id: str, title: str, updated: str, **extra) -> dict:
    return {
        "id": id, "title": title, "updatedAt": updated, "createdAt": "2026-09-01T10:00:00Z",
        "durationSeconds": 3000.5, "transcription": {"status": "ready", "model": "small.en"},
        "markers": [{"id": "m1", "label": "Exam topic", "timeSeconds": 754.2}],
        **extra,
    }


def transcript(id: str, text: str, updated: str, **extra) -> dict:
    words = [{"w": word, "s": i * 0.4, "e": i * 0.4 + 0.3} for i, word in enumerate(text.split())]
    return {"id": id, "text": text, "updatedAt": updated,
            "segments": [{"start": 0, "end": 12.5, "text": text, "words": words}], **extra}


def ids(changes: list[dict]) -> set[str]:
    return {doc["id"] for doc in changes}


async def pull_all(account: Account, device: str, cursor: str | None = None) -> tuple[dict, str]:
    """Follows `more` to the end, like the phone does."""
    gathered = {kind: [] for kind in sync.KINDS}
    for _ in range(50):
        result = await account.sync(device, cursor)
        for kind in sync.KINDS:
            gathered[kind].extend(result["changes"][kind])
        cursor = result["cursor"]
        if not result["more"]:
            return gathered, cursor
    raise AssertionError("pull never finished")


# ---------------------------------------------------------------------------
# The basics
# ---------------------------------------------------------------------------

async def test_changes_from_one_phone_reach_another(account: Account):
    fid, rid = unique_id(), unique_id()
    pushed = await account.sync(
        "phoneA",
        folders=[folder(fid, "Biology", now_iso())],
        recordings=[recording(rid, "Cell division", now_iso(), folderId=fid,
                              audio={"fileName": "rec.wav", "bytes": 96000000, "deviceId": "phoneA"})],
        transcripts=[transcript(rid, "mitosis has four phases", now_iso())],
    )
    assert pushed["applied"] == {"folders": [fid], "recordings": [rid], "transcripts": [rid]}
    assert pushed["rejected"] == {"folders": [], "recordings": [], "transcripts": []}

    pulled, _ = await pull_all(account, "phoneB")
    assert ids(pulled["folders"]) == {fid}
    got = pulled["recordings"][0]
    assert got["title"] == "Cell division" and got["folderId"] == fid
    assert got["markers"][0]["timeSeconds"] == 754.2
    assert got["audio"]["deviceId"] == "phoneA"
    assert "userId" not in got and "syncedBy" not in got and "_id" not in got
    assert pulled["transcripts"][0]["segments"][0]["words"][1] == {"w": "has", "s": 0.4, "e": 0.7}


async def test_a_phone_does_not_get_its_own_changes_back(account: Account):
    await account.sync("phoneA", folders=[folder(unique_id(), "Mine", now_iso())])
    pulled, _ = await pull_all(account, "phoneA")
    assert pulled["folders"] == []


async def test_a_cursor_only_returns_what_changed_since(account: Account, monkeypatch):
    monkeypatch.setattr(sync, "OVERLAP_SECONDS", 0)
    first, second = unique_id(), unique_id()
    await account.sync("phoneA", folders=[folder(first, "One", now_iso())])
    await asyncio.sleep(0.01)
    _, cursor = await pull_all(account, "phoneB")
    await asyncio.sleep(0.01)
    await account.sync("phoneA", folders=[folder(second, "Two", now_iso())])
    await asyncio.sleep(0.01)
    pulled, _ = await pull_all(account, "phoneB", cursor)
    assert ids(pulled["folders"]) == {second}


async def test_recent_changes_are_read_again_rather_than_risk_missing_one(account: Account):
    """The overlap window: a change from the last few seconds is delivered
    twice rather than possibly never."""
    fid = unique_id()
    await account.sync("phoneA", folders=[folder(fid, "Fresh", now_iso())])
    first, cursor = await pull_all(account, "phoneB")
    again, _ = await pull_all(account, "phoneB", cursor)
    assert fid in ids(first["folders"]) and fid in ids(again["folders"])


async def test_a_garbled_cursor_means_a_full_resync(account: Account):
    fid = unique_id()
    await account.sync("phoneA", folders=[folder(fid, "Kept", now_iso())])
    for bad in ["not-a-cursor", "e30", "W10"]:
        pulled, _ = await pull_all(account, "phoneB", bad)
        assert fid in ids(pulled["folders"])


async def test_pulls_page_through_many_transcripts(account: Account, monkeypatch):
    monkeypatch.setattr(sync, "OVERLAP_SECONDS", 0)
    many = [unique_id() for _ in range(sync.PAGE_SIZE["transcripts"] * 2 + 3)]
    for start in range(0, len(many), 50):
        await account.sync("phoneA", transcripts=[transcript(i, f"words {i}", now_iso()) for i in many[start:start + 50]])
    await asyncio.sleep(0.01)
    first = await account.sync("phoneB")
    assert first["more"] is True
    assert len(first["changes"]["transcripts"]) == sync.PAGE_SIZE["transcripts"]
    pulled, _ = await pull_all(account, "phoneB")
    assert ids(pulled["transcripts"]) == set(many)


# ---------------------------------------------------------------------------
# Conflicts
# ---------------------------------------------------------------------------

async def test_the_later_edit_wins_whatever_order_they_arrive_in(account: Account):
    fid = unique_id()
    await account.sync("phoneA", folders=[folder(fid, "Edited later", "2026-09-10T12:00:05Z")])
    stale = await account.sync("phoneB", folders=[folder(fid, "Edited earlier", "2026-09-10T12:00:00Z")])
    assert stale["rejected"]["folders"] == [fid]
    newer = await account.sync("phoneB", folders=[folder(fid, "Edited last", "2026-09-10T12:00:09Z")])
    assert newer["applied"]["folders"] == [fid]
    listing = (await account.get("/v1/folders")).json()["folders"]
    assert [f["name"] for f in listing if f["id"] == fid] == ["Edited last"]


async def test_an_identical_timestamp_keeps_the_server_copy(account: Account):
    fid = unique_id()
    await account.sync("phoneA", folders=[folder(fid, "First", "2026-09-10T12:00:00Z")])
    tie = await account.sync("phoneB", folders=[folder(fid, "Second", "2026-09-10T12:00:00Z")])
    assert tie["rejected"]["folders"] == [fid]


async def test_a_clock_in_the_future_cannot_win_forever(account: Account, db):
    fid = unique_id()
    await account.sync("phoneA", folders=[folder(fid, "From 2099", "2099-01-01T00:00:00Z")])
    stored = await db.folders.find_one({"_id": fid})
    assert stored["updatedAt"].year == datetime.now(timezone.utc).year
    later = await account.sync("phoneB", folders=[folder(fid, "Fixed", now_iso(60))])
    assert later["applied"]["folders"] == [fid]


async def test_editing_on_a_phone_without_the_audio_keeps_the_audio_details(account: Account, db):
    rid = unique_id()
    audio = {"fileName": "lecture.wav", "bytes": 1234, "deviceId": "phoneA"}
    await account.sync("phoneA", recordings=[recording(rid, "Original", "2026-09-10T12:00:00Z", audio=audio)])
    await account.sync("phoneB", recordings=[recording(rid, "Renamed on B", "2026-09-10T12:01:00Z", audio=None)])
    stored = await db.recordings.find_one({"_id": rid})
    assert stored["title"] == "Renamed on B"
    assert stored["audio"] == audio


# ---------------------------------------------------------------------------
# Deletes
# ---------------------------------------------------------------------------

async def test_deleting_a_recording_clears_it_and_its_transcript(account: Account, db):
    rid = unique_id()
    await account.sync("phoneA", recordings=[recording(rid, "Secret lecture", "2026-09-10T12:00:00Z", notes="private")],
                       transcripts=[transcript(rid, "the private words", "2026-09-10T12:00:00Z")])
    await account.sync("phoneA", recordings=[recording(rid, "Secret lecture", "2026-09-10T13:00:00Z",
                                                       deletedAt="2026-09-10T13:00:00Z", notes="private")])
    stored = await db.recordings.find_one({"_id": rid})
    words = await db.transcripts.find_one({"_id": rid})
    assert stored["deletedAt"] is not None and stored["title"] == "" and stored["notes"] == "" and stored["markers"] == []
    assert words["deletedAt"] is not None and words["text"] == "" and words["segments"] == []

    pulled, _ = await pull_all(account, "phoneB")
    assert [r["deletedAt"] for r in pulled["recordings"] if r["id"] == rid] != [None]
    assert any(t["id"] == rid and t["deletedAt"] for t in pulled["transcripts"])
    # Gone from the library and from search.
    assert (await account.get(f"/v1/recordings/{rid}")).status_code == 404
    assert (await account.get("/v1/search", params={"q": "private words"})).json()["results"] == []


async def test_an_old_edit_does_not_bring_a_deleted_recording_back(account: Account):
    rid = unique_id()
    await account.sync("phoneA", recordings=[recording(rid, "x", "2026-09-10T13:00:00Z", deletedAt="2026-09-10T13:00:00Z")])
    late = await account.sync("phoneB", recordings=[recording(rid, "edited offline", "2026-09-10T12:30:00Z")])
    assert late["rejected"]["recordings"] == [rid]


# ---------------------------------------------------------------------------
# Users are kept apart
# ---------------------------------------------------------------------------

async def test_one_user_cannot_overwrite_or_see_anothers_documents(make_account, db):
    alice, mallory = await make_account(), await make_account()
    fid = unique_id()
    await alice.sync("alice-phone", folders=[folder(fid, "Alice's", "2026-09-10T12:00:00Z")])
    attack = await mallory.sync("mallory-phone", folders=[folder(fid, "Mallory's", "2099-01-01T00:00:00Z")])
    assert attack["rejected"]["folders"] == [fid]
    stored = await db.folders.find_one({"_id": fid})
    assert stored["name"] == "Alice's" and stored["userId"] == alice.id

    seen, _ = await pull_all(mallory, "mallory-phone")
    assert fid not in ids(seen["folders"])


# ---------------------------------------------------------------------------
# What the server refuses
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("bad", [
    {"deviceId": "has spaces", "changes": {}},
    {"deviceId": "server:api", "changes": {}},
    {"deviceId": "ok", "changes": {"folders": [{"id": "../../etc", "name": "x", "updatedAt": "2026-01-01T00:00:00Z"}]}},
    {"deviceId": "ok", "changes": {"folders": [{"id": "a", "name": "x" * 121, "updatedAt": "2026-01-01T00:00:00Z"}]}},
    {"deviceId": "ok", "changes": {"folders": [{"id": "a", "name": "x"}]}},
    {"deviceId": "ok", "changes": {"transcripts": [{"id": f"t{i}", "updatedAt": "2026-01-01T00:00:00Z"} for i in range(51)]}},
])
async def test_malformed_sync_requests_are_refused(account: Account, bad):
    assert (await account.post("/v1/sync", bad)).status_code == 422


async def test_unknown_folder_colours_fall_back_to_blue(account: Account, db):
    fid = unique_id()
    await account.sync("phoneA", folders=[{**folder(fid, "Odd", now_iso()), "color": "#ff00ff"}])
    assert (await db.folders.find_one({"_id": fid}))["color"] == "blue"


async def test_the_database_itself_refuses_a_document_sync_could_not_see(db, account: Account):
    """The validator: a folder with no syncedAt would never reach any phone."""
    from pymongo.errors import WriteError
    with pytest.raises(WriteError):
        await db.folders.insert_one({"_id": unique_id(), "userId": account.id, "name": "x",
                                     "updatedAt": datetime.now(timezone.utc)})
