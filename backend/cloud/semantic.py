"""Semantic search: finding where something was said by meaning, not by word.

How it works
------------
A transcript is cut into passages of about a minute and each passage is stored
in `chunks`. Atlas Vector Search embeds the `text` field itself (automated
embedding): MongoDB turns each passage into a vector and keeps it current, and a
query is embedded the same way. Nothing here calls an embedding service, so
there is no key to hold and no model to host.

Chunks are derived data. They are rebuilt from the transcript whenever it
changes and removed when the recording is deleted, and a hash of the passages
means a transcript that did not change is never embedded again.

What it costs, and how that is held down
----------------------------------------
Embedding is billed per token, and every passage inserted is embedded. So the
volume of inserts is the cost, and it is capped here rather than trusted:

  - a daily limit on passages indexed, across everyone
  - a per-user limit on passages held
  - a daily limit on semantic searches (each embeds its query)
  - SEMANTIC_SEARCH=false turns all of it off

When a cap is reached the work is skipped, not failed: the recording is still
saved and keyword search still finds it. Caps reset at midnight UTC.

Automated embedding is a Preview feature of Atlas and may change, so every path
that touches it fails soft and says why.

Every passage carries its owner's `userId` and every search filters on it first.
"""
from __future__ import annotations

import hashlib
import logging
from typing import Any

from pymongo.errors import OperationFailure
from pymongo.operations import SearchIndexModel

from backend.cloud.common import utcnow
from backend.cloud.config import Settings
from backend.cloud.database import Database

log = logging.getLogger("voiceflow.semantic")

VECTOR_INDEX = "chunks_vector"
TARGET_SECONDS = 60          # a passage runs about this long...
MAX_CHARS = 1200             # ...or this many characters, whichever comes first


class SemanticUnavailable(Exception):
    """Semantic search cannot answer right now. The message says why, for people."""


# ---------------------------------------------------------------------------
# Cutting a transcript into passages (pure)
# ---------------------------------------------------------------------------

def make_chunks(segments: list[dict[str, Any]], *, target_seconds: float = TARGET_SECONDS,
                max_chars: int = MAX_CHARS) -> list[dict[str, Any]]:
    """Consecutive segments grouped into passages, each with where it starts and ends.

    A passage closes once adding the next line would make it longer than the
    target or the character limit. A single line longer than the limit stands
    alone rather than being cut in the middle of a sentence.
    """
    chunks: list[dict[str, Any]] = []
    lines: list[str] = []
    start = end = 0.0
    size = 0

    def close() -> None:
        nonlocal lines, size
        if lines:
            chunks.append({"n": len(chunks), "start": start, "end": end, "text": " ".join(lines)})
        lines, size = [], 0

    for segment in segments:
        text = str(segment.get("text", "")).strip()
        if not text:
            continue
        seg_start = float(segment.get("start") or 0.0)
        seg_end = float(segment.get("end") or seg_start)
        if lines and (seg_end - start > target_seconds or size + len(text) + 1 > max_chars):
            close()
        if not lines:
            start = seg_start
        lines.append(text)
        end = max(end, seg_end) if len(lines) > 1 else seg_end
        size += len(text) + 1
    close()
    return chunks


def fingerprint(chunks: list[dict[str, Any]]) -> str:
    """Changes exactly when the text to be embedded changes."""
    digest = hashlib.sha256()
    for chunk in chunks:
        digest.update(f"{chunk['start']:.2f}|{chunk['text']}\n".encode())
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# Budgets
# ---------------------------------------------------------------------------

def _today() -> str:
    return utcnow().strftime("%Y-%m-%d")


async def _used_today(database: Database, field: str) -> int:
    doc = await database.usage.find_one({"_id": _today()}, projection={field: 1})
    return int((doc or {}).get(field, 0))


async def _spend(database: Database, **amounts: int) -> None:
    await database.usage.update_one(
        {"_id": _today()}, {"$inc": amounts, "$setOnInsert": {"day": _today()}}, upsert=True)


# ---------------------------------------------------------------------------
# Keeping chunks current
# ---------------------------------------------------------------------------

async def drop(database: Database, user_id: str, recording_id: str) -> None:
    await database.chunks.delete_many({"userId": user_id, "recordingId": recording_id})
    await database.chunk_sets.delete_one({"_id": recording_id, "userId": user_id})


async def rebuild(database: Database, settings: Settings, user_id: str, recording_id: str) -> str:
    """Bring one recording's passages in line with its transcript.

    Returns what happened: "unchanged", "built", "removed", "empty", or why it
    was skipped ("off", "daily cap", "user cap"). Never raises for an expected
    reason - the recording is already saved, and this is only an index.
    """
    if not settings.semantic_search:
        return "off"
    transcript = await database.transcripts.find_one(
        {"_id": recording_id, "userId": user_id, "deletedAt": None}, projection={"segments": 1})
    if transcript is None:
        await drop(database, user_id, recording_id)
        return "removed"

    chunks = make_chunks(transcript.get("segments") or [])
    if not chunks:
        await drop(database, user_id, recording_id)
        return "empty"

    digest = fingerprint(chunks)
    existing = await database.chunk_sets.find_one({"_id": recording_id, "userId": user_id})
    if existing and existing.get("digest") == digest:
        return "unchanged"

    held = await database.chunks.count_documents({"userId": user_id})
    already = int((existing or {}).get("count", 0))
    if held - already + len(chunks) > settings.embed_user_max_chunks:
        log.warning("semantic: user %s is at the passage limit; %s not indexed", user_id, recording_id)
        return "user cap"
    if await _used_today(database, "chunks") + len(chunks) > settings.embed_daily_chunks:
        log.warning("semantic: daily indexing cap reached; %s not indexed", recording_id)
        return "daily cap"

    now = utcnow()
    await database.chunks.delete_many({"userId": user_id, "recordingId": recording_id})
    await database.chunks.insert_many([
        {"_id": f"{recording_id}:{c['n']}", "userId": user_id, "recordingId": recording_id,
         "n": c["n"], "start": c["start"], "end": c["end"], "text": c["text"], "createdAt": now}
        for c in chunks
    ])
    await database.chunk_sets.replace_one(
        {"_id": recording_id},
        {"_id": recording_id, "userId": user_id, "digest": digest, "count": len(chunks), "builtAt": now},
        upsert=True)
    await _spend(database, chunks=len(chunks), approxTokens=sum(len(c["text"]) for c in chunks) // 4)
    return "built"


async def after_sync(database: Database, settings: Settings, user_id: str, recording_ids: set[str]) -> None:
    """Run after a sync request has been answered, for the recordings it touched."""
    for recording_id in recording_ids:
        try:
            await rebuild(database, settings, user_id, recording_id)
        except Exception:  # noqa: BLE001 - an index must never break a backup
            log.exception("semantic: could not update passages for %s", recording_id)


async def ensure_user(database: Database, settings: Settings, user_id: str, limit: int = 10) -> int:
    """Index recordings that have a transcript but no passages yet (older ones,
    or ones skipped by a cap). A few at a time, so a search is never slow."""
    if not settings.semantic_search:
        return 0
    have = {doc["_id"] async for doc in database.chunk_sets.find({"userId": user_id}, projection={"_id": 1})}
    todo = [doc["_id"] async for doc in database.transcripts.find(
        {"userId": user_id, "deletedAt": None, "_id": {"$nin": list(have)}}, projection={"_id": 1}).limit(limit)]
    built = 0
    for recording_id in todo:
        if await rebuild(database, settings, user_id, recording_id) == "built":
            built += 1
    return built


# ---------------------------------------------------------------------------
# The index
# ---------------------------------------------------------------------------

async def ensure_vector_index(database: Database, settings: Settings) -> str:
    """Create the vector index on `chunks` if it is missing. Idempotent.

    Returns "created", the index's status, or "unavailable" - which is not an
    error: search falls back to keywords until it exists.
    """
    if not settings.semantic_search:
        return "off"
    try:
        if "chunks" not in await database.db.list_collection_names():
            await database.db.create_collection("chunks")
        existing = [i async for i in await database.chunks.list_search_indexes(VECTOR_INDEX)]
        if existing:
            return existing[0].get("status", "unknown")
        await database.chunks.create_search_index(SearchIndexModel(
            name=VECTOR_INDEX, type="vectorSearch",
            definition={"fields": [
                {"type": "autoEmbed", "modality": "text", "path": "text", "model": settings.embed_model},
                {"type": "filter", "path": "userId"},
            ]},
        ))
        return "created"
    except OperationFailure as error:
        log.warning("semantic: vector index unavailable: %s", (error.details or {}).get("errmsg", error))
        return "unavailable"


# ---------------------------------------------------------------------------
# Searching
# ---------------------------------------------------------------------------

async def index_ready(database: Database) -> bool:
    try:
        indexes = [i async for i in await database.chunks.list_search_indexes(VECTOR_INDEX)]
    except OperationFailure:
        return False
    return bool(indexes) and bool(indexes[0].get("queryable"))


async def similar(database: Database, settings: Settings, user_id: str, text: str, limit: int = 5) -> list[dict[str, Any]]:
    """Passages whose meaning is close to `text` (at least `embed_min_score`), best first."""
    text = text.strip()[:500]
    if not text:
        return []
    if not settings.semantic_search or settings.search_backend == "regex":
        raise SemanticUnavailable("Semantic search is turned off on this server.")
    if await _used_today(database, "queries") >= settings.embed_daily_queries:
        raise SemanticUnavailable("Semantic search has reached its limit for today. It resets at midnight UTC.")

    await ensure_user(database, settings, user_id)
    await _spend(database, queries=1, approxTokens=max(1, len(text) // 4))
    limit = max(1, min(limit, 20))
    try:
        found = [doc async for doc in await database.chunks.aggregate([
            {"$vectorSearch": {
                "index": VECTOR_INDEX, "path": "text", "query": text,
                "numCandidates": max(50, limit * 10), "limit": limit,
                # The owner, before anything else: nobody else's passages are ever candidates.
                "filter": {"userId": user_id},
            }},
            {"$project": {"recordingId": 1, "start": 1, "end": 1, "text": 1, "score": {"$meta": "vectorSearchScore"}}},
        ])]
    except OperationFailure as error:
        log.warning("semantic: vector query failed: %s", (error.details or {}).get("errmsg", error))
        raise SemanticUnavailable(
            "Semantic search is still being set up or is temporarily unavailable.") from None
    if not found and not await index_ready(database):
        # Atlas answers a query against a missing or still-building index with nothing,
        # not an error. "Nothing similar" and "not ready yet" must not sound alike.
        raise SemanticUnavailable("Semantic search is still being set up or is temporarily unavailable.")
    # Nearest is not the same as relevant: with nothing about the question in the
    # library, the "best" passage is still returned. Drop the ones too far away.
    return [passage for passage in found if float(passage.get("score", 0.0)) >= settings.embed_min_score]
