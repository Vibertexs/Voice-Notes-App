"""Topics: each recording's top words counted once, added up by MongoDB, scoped to one person."""
from __future__ import annotations

from datetime import datetime, timezone

from backend.cloud import insights
from tests.cloud.conftest import Account, now_iso, unique_id
from tests.cloud.test_mcp import call, make_token
from tests.cloud.test_sync import folder, recording, transcript


async def lectures(account: Account) -> dict[str, str]:
    """Chemistry: two lectures about reactions. Unfiled: one about markets."""
    fid, a, b, c = (unique_id() for _ in range(4))
    await account.sync(
        "phoneA",
        folders=[folder(fid, "Chemistry", now_iso())],
        recordings=[
            recording(a, "Reactions I", now_iso(), folderId=fid, createdAt="2026-09-01T09:00:00Z"),
            recording(b, "Reactions II", now_iso(), folderId=fid, createdAt="2026-09-08T09:00:00Z"),
            recording(c, "Markets", now_iso(), createdAt="2026-09-15T09:00:00Z"),
        ],
        transcripts=[
            transcript(a, "The nucleophile attacks. Nucleophile strength and the leaving group matter.", now_iso()),
            transcript(b, "Today the nucleophile again, and the solvent. Solvent polarity changes the rate.", now_iso()),
            transcript(c, "Supply and demand. Demand curves slope down and supply curves slope up.", now_iso()),
        ],
    )
    return {"folder": fid, "a": a, "b": b, "c": c}


# ---------------------------------------------------------------------------
# Counting words (pure)
# ---------------------------------------------------------------------------

def test_top_terms_ignores_case_filler_and_short_words():
    terms = insights.top_terms("The Nucleophile and the nucleophile. It is an SN2 step, so we go on. Solvent!")
    assert terms == [{"w": "nucleophile", "n": 2}, {"w": "solvent", "n": 1}, {"w": "step", "n": 1}]


def test_top_terms_keeps_only_the_most_said_and_breaks_ties_alphabetically():
    text = " ".join(["zebra"] * 3 + ["apple"] * 3 + [f"word{chr(97 + i)}" for i in range(10)])
    top = insights.top_terms(text, count=3)
    assert [t["w"] for t in top] == ["apple", "zebra", "worda"] and top[0]["n"] == 3


def test_a_recording_with_nothing_to_count_has_no_terms():
    assert insights.top_terms("") == [] and insights.top_terms("and the of it is") == []


# ---------------------------------------------------------------------------
# Keeping them current
# ---------------------------------------------------------------------------

async def test_syncing_a_transcript_builds_its_term_set(db, account: Account):
    ids = await lectures(account)
    stored = await db.term_sets.find_one({"_id": ids["a"]})
    assert stored["userId"] == account.id
    assert {"w": "nucleophile", "n": 2} in stored["terms"]


async def test_editing_a_transcript_replaces_its_terms(db, account: Account):
    ids = await lectures(account)
    await account.sync("phoneA", transcripts=[transcript(ids["a"], "Entropy entropy entropy.", now_iso())])
    assert (await db.term_sets.find_one({"_id": ids["a"]}))["terms"] == [{"w": "entropy", "n": 3}]


async def test_older_transcripts_are_counted_when_first_asked_for(db, account: Account):
    ids = await lectures(account)
    await db.term_sets.delete_many({"userId": account.id})              # as if they predated this feature
    assert await insights.ensure_user(db, account.id) == 3
    assert await insights.ensure_user(db, account.id) == 0              # nothing left to catch up on
    assert await db.term_sets.count_documents({"userId": account.id}) == 3
    assert ids


async def test_deleting_removes_the_terms_every_way_it_can_happen(db, account: Account):
    ids = await lectures(account)
    assert (await account.delete(f"/v1/recordings/{ids['a']}")).status_code == 204
    assert await db.term_sets.find_one({"_id": ids["a"]}) is None

    # A tombstone arriving from another phone: the transcript is marked deleted, then the term set is rebuilt.
    await db.transcripts.update_one({"_id": ids["b"]}, {"$set": {"deletedAt": datetime.now(timezone.utc)}})
    assert await insights.rebuild(db, account.id, ids["b"]) == "removed"
    assert await db.term_sets.find_one({"_id": ids["b"]}) is None

    assert (await account.delete("/v1/me", {"password": account.password})).status_code == 204
    assert await db.term_sets.count_documents({"userId": account.id}) == 0


# ---------------------------------------------------------------------------
# The tool
# ---------------------------------------------------------------------------

async def test_counts_words_and_the_recordings_they_were_in(client, account: Account):
    await lectures(account)
    token = (await make_token(account))["token"]
    error, data = await call(client, token, "topics", limit=50)
    assert not error
    found = {t["word"]: t for t in data["topics"]}
    assert found["nucleophile"] == {"word": "nucleophile", "mentions": 3, "recordings": 2}
    assert found["demand"]["mentions"] == 2 and found["demand"]["recordings"] == 1
    assert found["solvent"]["mentions"] == 2
    assert "the" not in found and "and" not in found and "today" not in found     # filler is left out
    assert data["topics"][0]["mentions"] >= data["topics"][-1]["mentions"]         # most-said first


async def test_a_folder_or_date_range_narrows_what_is_counted(client, account: Account):
    await lectures(account)
    token = (await make_token(account))["token"]
    _, chem = await call(client, token, "topics", folder="chemistry", limit=50)
    words = {t["word"] for t in chem["topics"]}
    assert "nucleophile" in words and "demand" not in words

    _, unfiled = await call(client, token, "topics", folder="unfiled", limit=50)
    assert {t["word"] for t in unfiled["topics"]} >= {"demand", "supply"}

    _, late = await call(client, token, "topics", since="2026-09-05", until="2026-09-10", limit=50)
    assert {t["word"] for t in late["topics"]} >= {"solvent"} and "demand" not in {t["word"] for t in late["topics"]}

    _, none = await call(client, token, "topics", since="2030-01-01")
    assert none["topics"] == []

    error, message = await call(client, token, "topics", folder="Physics")
    assert error and "Chemistry" in message


async def test_topics_only_count_the_callers_own_lectures(client, make_account):
    alice, mallory = await make_account(), await make_account()
    await lectures(alice)
    token = (await make_token(mallory))["token"]
    _, data = await call(client, token, "topics")
    assert data["topics"] == []


async def test_deleted_recordings_stop_counting(client, account: Account):
    ids = await lectures(account)
    token = (await make_token(account))["token"]
    assert (await account.delete(f"/v1/recordings/{ids['c']}")).status_code == 204
    _, data = await call(client, token, "topics", limit=50)
    assert "demand" not in {t["word"] for t in data["topics"]}
