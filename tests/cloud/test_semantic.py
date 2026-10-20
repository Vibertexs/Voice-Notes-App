"""Semantic search: passages, the cost caps, and the tool that uses them.

Atlas computes the embeddings, so what is tested here is everything that is ours:
cutting transcripts into passages, keeping them current, never embedding the
same text twice, holding spend under its caps, and failing soft. One opt-in test
runs a real vector query against Atlas (VOICEFLOW_TEST_ATLAS_SEARCH=1).
"""
from __future__ import annotations

import asyncio
import os

import pytest

from backend.cloud import semantic
from tests.cloud.conftest import Account, now_iso, unique_id
from tests.cloud.test_mcp import call, make_token
from tests.cloud.test_sync import recording


def seg(start: float, end: float, text: str) -> dict:
    return {"start": start, "end": end, "text": text, "words": []}


def lecture(lines: list[tuple[float, float, str]]) -> list[dict]:
    return [seg(*line) for line in lines]


async def put(account: Account, rid: str, segments: list[dict], *, title: str = "A lecture") -> None:
    await account.sync(
        "phoneA",
        recordings=[recording(rid, title, now_iso())],
        transcripts=[{"id": rid, "text": " ".join(s["text"] for s in segments), "segments": segments, "updatedAt": now_iso()}],
    )


# ---------------------------------------------------------------------------
# Cutting a transcript up
# ---------------------------------------------------------------------------

def test_a_short_transcript_is_one_passage():
    chunks = semantic.make_chunks(lecture([(0, 5, "Hello."), (5, 12, "Welcome back.")]))
    assert chunks == [{"n": 0, "start": 0.0, "end": 12.0, "text": "Hello. Welcome back."}]


def test_passages_close_at_about_a_minute():
    lines = [(i * 10, i * 10 + 9, f"Sentence {i}.") for i in range(15)]        # 150 seconds
    chunks = semantic.make_chunks(lecture(lines))
    assert len(chunks) == 3
    assert [c["n"] for c in chunks] == [0, 1, 2]
    assert chunks[0]["start"] == 0 and chunks[1]["start"] == chunks[0]["end"] + 1
    assert all(c["end"] - c["start"] <= 66 for c in chunks)
    assert " ".join(c["text"] for c in chunks) == " ".join(f"Sentence {i}." for i in range(15))   # nothing lost or reordered


def test_passages_also_close_on_length_and_never_split_a_line():
    long_line = "word " * 300                                   # one 1,500-character line
    chunks = semantic.make_chunks(lecture([(0, 2, "Short."), (2, 4, long_line), (4, 6, "After.")]))
    assert [c["text"].startswith(p) for c, p in zip(chunks, ("Short.", "word", "After."))] == [True] * 3
    assert any(len(c["text"]) > semantic.MAX_CHARS for c in chunks)     # it stands alone, uncut


def test_empty_and_missing_pieces_are_skipped():
    assert semantic.make_chunks([]) == []
    assert semantic.make_chunks(lecture([(0, 1, "   "), (1, 2, "")])) == []
    chunks = semantic.make_chunks([{"text": "No timings at all"}])
    assert chunks[0]["start"] == 0.0 and chunks[0]["text"] == "No timings at all"


def test_the_fingerprint_changes_exactly_when_the_text_does():
    a = semantic.make_chunks(lecture([(0, 5, "One."), (5, 9, "Two.")]))
    assert semantic.fingerprint(a) == semantic.fingerprint(semantic.make_chunks(lecture([(0, 5, "One."), (5, 9, "Two.")])))
    assert semantic.fingerprint(a) != semantic.fingerprint(semantic.make_chunks(lecture([(0, 5, "One."), (5, 9, "Two!")])))
    # Where a passage BEGINS is part of what the search reports, so it counts; the inner timings do not.
    assert semantic.fingerprint(a) != semantic.fingerprint(semantic.make_chunks(lecture([(1, 5, "One."), (5, 9, "Two.")])))
    assert semantic.fingerprint(a) == semantic.fingerprint(semantic.make_chunks(lecture([(0, 5, "One."), (6, 9, "Two.")])))


# ---------------------------------------------------------------------------
# Keeping passages current
# ---------------------------------------------------------------------------

async def chunks_of(db, rid: str) -> list[dict]:
    return [c async for c in db.chunks.find({"recordingId": rid}).sort("n", 1)]


async def test_backing_up_a_transcript_creates_its_passages(db, account: Account):
    rid = unique_id()
    await put(account, rid, lecture([(0, 8, "Cells divide in four phases."), (8, 20, "Prophase comes first.")]))
    chunks = await chunks_of(db, rid)
    assert len(chunks) == 1 and chunks[0]["userId"] == account.id
    assert chunks[0]["text"] == "Cells divide in four phases. Prophase comes first." and chunks[0]["start"] == 0
    assert chunks[0]["_id"] == f"{rid}:0"


async def test_an_unchanged_transcript_is_not_embedded_again(db, account: Account):
    rid = unique_id()
    segments = lecture([(0, 8, "Same words."), (8, 20, "Still the same.")])
    await put(account, rid, segments)
    first = (await chunks_of(db, rid))[0]["createdAt"]
    used = (await db.usage.find_one({"_id": semantic._today()}))["chunks"]
    await asyncio.sleep(0.01)
    await put(account, rid, segments)                         # a newer copy of identical text
    assert (await chunks_of(db, rid))[0]["createdAt"] == first
    assert (await db.usage.find_one({"_id": semantic._today()}))["chunks"] == used      # and no budget was spent


async def test_a_changed_transcript_replaces_its_passages(db, account: Account):
    rid = unique_id()
    await put(account, rid, lecture([(0, 8, "The old words.")]))
    await asyncio.sleep(0.01)
    await put(account, rid, lecture([(0, 8, "Entirely new words.")]))
    chunks = await chunks_of(db, rid)
    assert [c["text"] for c in chunks] == ["Entirely new words."]


async def test_deleting_removes_the_passages_every_way_it_can_happen(db, client, make_account):
    account = await make_account()
    via_sync, via_rest = unique_id(), unique_id()
    for rid in (via_sync, via_rest):
        await put(account, rid, lecture([(0, 8, f"Words of {rid}.")]))
    assert await chunks_of(db, via_sync) and await chunks_of(db, via_rest)

    await account.sync("phoneA", recordings=[{**recording(via_sync, "x", now_iso(1)), "deletedAt": now_iso(1)}])
    assert await chunks_of(db, via_sync) == [] and await db.chunk_sets.find_one({"_id": via_sync}) is None

    assert (await account.delete(f"/v1/recordings/{via_rest}")).status_code == 204
    assert await chunks_of(db, via_rest) == []

    keep = unique_id()
    await put(account, keep, lecture([(0, 8, "Kept.")]))
    assert (await account.delete("/v1/me", {"password": account.password})).status_code == 204
    assert await db.chunks.count_documents({"userId": account.id}) == 0
    assert await db.chunk_sets.count_documents({"userId": account.id}) == 0


async def test_passages_belong_to_one_user(db, make_account):
    alice, bob = await make_account(), await make_account()
    a, b = unique_id(), unique_id()
    await put(alice, a, lecture([(0, 8, "Alice's words.")]))
    await put(bob, b, lecture([(0, 8, "Bob's words.")]))
    assert {c["userId"] for c in await chunks_of(db, a)} == {alice.id}
    assert {c["userId"] for c in await chunks_of(db, b)} == {bob.id}


async def test_older_transcripts_are_indexed_when_first_needed(db, app, account: Account):
    rid = unique_id()
    await put(account, rid, lecture([(0, 8, "An older transcript.")]))
    await semantic.drop(db, account.id, rid)                                # as if it predated this feature
    assert await chunks_of(db, rid) == []
    assert await semantic.ensure_user(db, app.state.settings, account.id) >= 1
    assert len(await chunks_of(db, rid)) == 1


# ---------------------------------------------------------------------------
# Cost: every cap is a real limit
# ---------------------------------------------------------------------------

async def test_the_daily_cap_stops_indexing_but_never_the_backup(db, app, account: Account):
    rid = unique_id()
    capped = app.state.settings.model_copy(update={"embed_daily_chunks": 0})
    await put(account, rid, lecture([(0, 8, "Words that will not be indexed today.")]))
    await semantic.drop(db, account.id, rid)
    assert await semantic.rebuild(db, capped, account.id, rid) == "daily cap"
    assert await chunks_of(db, rid) == []
    assert (await account.get(f"/v1/recordings/{rid}/transcript")).status_code == 200      # still saved and readable
    assert await semantic.rebuild(db, app.state.settings, account.id, rid) == "built"      # and it catches up later


async def test_one_user_cannot_hold_more_than_their_share(db, app, account: Account):
    capped = app.state.settings.model_copy(update={"embed_user_max_chunks": 2})
    ids = [unique_id() for _ in range(3)]
    for rid in ids:
        await put(account, rid, lecture([(0, 8, f"Lecture {rid}.")]))
        await semantic.drop(db, account.id, rid)
    results = [await semantic.rebuild(db, capped, account.id, rid) for rid in ids]
    assert results == ["built", "built", "user cap"]
    assert await db.chunks.count_documents({"userId": account.id}) == 2


async def test_it_can_be_switched_off(db, app, account: Account):
    rid = unique_id()
    off = app.state.settings.model_copy(update={"semantic_search": False})
    await put(account, rid, lecture([(0, 8, "Not indexed.")]))
    await semantic.drop(db, account.id, rid)
    assert await semantic.rebuild(db, off, account.id, rid) == "off"
    assert await semantic.ensure_user(db, off, account.id) == 0
    with pytest.raises(semantic.SemanticUnavailable):
        await semantic.similar(db, off, account.id, "anything")


async def test_the_search_cap_is_enforced_and_spend_is_counted(db, app, account: Account):
    settings = app.state.settings.model_copy(update={"search_backend": "atlas", "embed_daily_queries": 0})
    with pytest.raises(semantic.SemanticUnavailable, match="limit for today"):
        await semantic.similar(db, settings, account.id, "a question")
    before = (await db.usage.find_one({"_id": semantic._today()}) or {}).get("queries", 0)
    # No vector index in this test database, so the query itself fails soft - and is still counted.
    open_ = app.state.settings.model_copy(update={"search_backend": "atlas"})
    with pytest.raises(semantic.SemanticUnavailable, match="still being set up"):
        await semantic.similar(db, open_, account.id, "a question")
    assert (await db.usage.find_one({"_id": semantic._today()}))["queries"] == before + 1


async def test_a_blank_query_costs_nothing(db, app, account: Account):
    assert await semantic.similar(db, app.state.settings, account.id, "   ") == []


class _FakeChunks:
    """Stands in for the vector query, which needs a real Atlas index."""
    def __init__(self, scored: list[float]) -> None:
        self.scored = scored

    async def aggregate(self, pipeline):
        async def rows():
            for i, score in enumerate(self.scored):
                yield {"recordingId": "r", "start": float(i), "end": float(i + 1), "text": f"passage {i}", "score": score}
        return rows()


class _WithFakeChunks:
    def __init__(self, real, scored: list[float]) -> None:
        self._real, self.chunks = real, _FakeChunks(scored)

    def __getattr__(self, name):
        return getattr(self._real, name)


async def test_passages_too_far_from_the_question_are_dropped(db, app, account: Account):
    """Vector search always returns its nearest neighbours; on real recordings a true
    match scored 0.756 and an unrelated passage 0.629. Only the first should survive."""
    settings = app.state.settings.model_copy(update={"search_backend": "atlas"})
    database = _WithFakeChunks(db, [0.756, 0.70, 0.629])
    found = await semantic.similar(database, settings, account.id, "slices of bread with fillings")
    assert [p["score"] for p in found] == [0.756, 0.70]

    nothing = await semantic.similar(_WithFakeChunks(db, [0.5, 0.4]), settings, account.id, "an unrelated question")
    assert nothing == []                                         # empty means "nothing about it", not "not ready"

    strict = settings.model_copy(update={"embed_min_score": 0.9})
    assert await semantic.similar(database, strict, account.id, "slices of bread with fillings") == []


# ---------------------------------------------------------------------------
# What callers see
# ---------------------------------------------------------------------------

async def test_the_rest_endpoint_says_why_when_it_cannot_answer(account: Account):
    response = await account.get("/v1/search/similar", params={"q": "how do cells make energy"})
    assert response.status_code == 503 and "turned off" in response.json()["detail"]


async def test_the_tool_explains_and_points_to_keyword_search(client, account: Account):
    token = (await make_token(account))["token"]
    error, message = await call(client, token, "find_similar", query="how do cells make energy")
    assert error and "search_lectures" in message


async def test_the_tool_returns_passages_with_titles_and_times(client, monkeypatch, make_account):
    account = await make_account()
    rid, gone = unique_id(), unique_id()
    await put(account, rid, lecture([(0, 8, "x")]), title="Cell biology")

    async def fake_similar(database, settings, user_id, text, limit=5):
        assert user_id == account.id                                            # the caller's own id, from the token
        return [{"recordingId": rid, "start": 754.0, "end": 800.0, "text": "Mitochondria make ATP. " * 60, "score": 0.8123},
                {"recordingId": gone, "start": 1.0, "end": 2.0, "text": "a deleted recording's passage", "score": 0.7}]
    monkeypatch.setattr(semantic, "similar", fake_similar)

    token = (await make_token(account))["token"]
    error, data = await call(client, token, "find_similar", query="how do cells make energy")
    assert not error and data["query"] == "how do cells make energy"
    assert len(data["results"]) == 1                                            # the deleted one is not shown
    hit = data["results"][0]
    assert hit["title"] == "Cell biology" and hit["at"] == "12:34" and hit["startSeconds"] == 754.0
    assert hit["similarity"] == 0.812 and len(hit["passage"]) <= 700


async def test_the_rest_endpoint_says_where_each_passage_lives(client, monkeypatch, make_account):
    """The app lists a meaning match like any other result, so it needs the folder and date too."""
    account = await make_account()
    rid, gone = unique_id(), unique_id()
    await put(account, rid, lecture([(0, 8, "x")]), title="Cell biology")

    async def fake_similar(database, settings, user_id, text, limit=5):
        assert user_id == account.id
        return [{"recordingId": rid, "start": 12.0, "end": 40.0, "text": "Mitochondria make ATP.", "score": 0.81},
                {"recordingId": gone, "start": 1.0, "end": 2.0, "text": "a deleted recording", "score": 0.9}]
    monkeypatch.setattr(semantic, "similar", fake_similar)

    response = await account.get("/v1/search/similar", params={"q": "bread"})
    assert response.status_code == 200
    (hit,) = response.json()["results"]                                         # the deleted recording is not listed
    assert hit["recordingId"] == rid and hit["title"] == "Cell biology" and hit["startSeconds"] == 12.0
    assert hit["passage"] == "Mitochondria make ATP." and hit["createdAt"] and "folderId" in hit
    assert hit["favorite"] is False                                             # so the app can limit meaning matches to favourites


# ---------------------------------------------------------------------------
# A real vector query (opt-in: builds an Atlas index, takes a couple of minutes)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not os.environ.get("VOICEFLOW_TEST_ATLAS_SEARCH"), reason="set VOICEFLOW_TEST_ATLAS_SEARCH=1")
async def test_atlas_finds_by_meaning_and_only_for_the_owner(db, app, make_account):
    mine, theirs = await make_account(), await make_account()
    await put(mine, unique_id(), lecture([(0, 30, "Mitochondria are the organelles that produce most of the cell's ATP."),
                                          (30, 60, "Supply and demand curves intersect at the market clearing price.")]), title="Bio")
    await put(theirs, unique_id(), lecture([(0, 30, "Cells make their energy in the powerhouse using oxygen and glucose.")]), title="Other person's bio")

    settings = app.state.settings.model_copy(update={"search_backend": "atlas"})
    for _ in range(120):                                       # the index, then the embeddings, are built asynchronously
        indexes = [i async for i in await db.chunks.list_search_indexes(semantic.VECTOR_INDEX)]
        if indexes and indexes[0].get("queryable"):
            break
        await asyncio.sleep(3)
    found: list[dict] = []
    for _ in range(40):
        found = await semantic.similar(db, settings, mine.id, "how do cells produce energy")
        if found:
            break
        await asyncio.sleep(3)
    assert found, "no passages came back"
    assert "Mitochondria" in found[0]["text"]                  # meaning, not matching words
    assert all(p["recordingId"] and "Other person" not in p["text"] for p in found)
    assert {await db.chunks.count_documents({"_id": p["_id"], "userId": mine.id}) for p in found} == {1}
