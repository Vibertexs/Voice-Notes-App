"""What a person's lectures are about, counted by MongoDB.

`topics` answers "which subjects came up most?" without an assistant reading a
single transcript: the counting happens in an aggregation pipeline and only the
answer travels.

The computed pattern
--------------------
Splitting a transcript into words is the expensive part, and a transcript never
changes between syncs. So each recording's most-said words are worked out once,
when it syncs, and kept in `term_sets` (about 40 small `{w, n}` entries). Asking
for topics then only adds those short lists together:

  $match       this user's term sets (the userId index), narrowed to a folder or
               date range when asked
  $unwind      one document per (recording, word)
  $group       sum each word's mentions and count the recordings it appears in
  $sort/$limit the top few

Measured on 10,000 lectures (scripts/benchmark.py), doing the splitting inside
the pipeline instead took 9 s for a user with 1,000 lectures; this takes a
fraction of a second, and it no longer grows with how long each lecture is.

What it gives up: a word counts in a recording only if it is among that
recording's most-said words, so these are each lecture's defining terms, not
every passing mention. Like passages for semantic search, term sets are derived:
rebuilt when the transcript changes, removed with the recording, never synced.
"""
from __future__ import annotations

import logging
import re
from collections import Counter
from datetime import datetime
from typing import Any

from pymongo import ReplaceOne

from backend.cloud.common import utcnow
from backend.cloud.database import Database

log = logging.getLogger("voiceflow.insights")

WORD = re.compile(r"[a-z][a-z']{2,}")          # three letters or more, after lower-casing
TERMS_PER_RECORDING = 40
MAX_TOPICS = 50
CATCH_UP_BATCH = 500

STOP_WORDS = frozenset("""
a about above after again against all also am an and any are aren't as at be because been before being below
between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each
few for from further get gets got had hadn't has hasn't have haven't having he he'd he'll he's her here here's
hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself just let's
like me more most mustn't my myself no nor not of off oh okay on once only or other ought our ours ourselves
out over own really right same say says said shan't she she'd she'll she's should shouldn't so some such than
that that's the their theirs them themselves then there there's these they they'd they'll they're they've this
those through to too under until up us very want was wasn't we we'd we'll we're we've well were weren't what
what's when when's where where's which while who who's whom why why's will with won't would wouldn't yeah yes
you you'd you'll you're you've your yours yourself yourselves one two three four five going gonna thing things
actually kind know mean means think thought talk talking talked look looking looks come comes came make makes
made take takes took give gives gave need needs sort bit lot little much many way ways something anything
everything someone anyone everyone today now first next last good great new able back even still
""".split())


def top_terms(text: str, count: int = TERMS_PER_RECORDING) -> list[dict[str, Any]]:
    """The words said most in `text`, most first (ties alphabetical), as `{w, n}`."""
    counts = Counter(word for word in WORD.findall(text.lower()) if word not in STOP_WORDS)
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [{"w": word, "n": n} for word, n in ranked[:count]]


def _term_set(user_id: str, recording_id: str, text: str) -> dict[str, Any] | None:
    terms = top_terms(text)
    if not terms:
        return None
    return {"_id": recording_id, "userId": user_id, "terms": terms, "builtAt": utcnow()}


# ---------------------------------------------------------------------------
# Keeping term sets current
# ---------------------------------------------------------------------------

async def drop(database: Database, user_id: str, recording_id: str) -> None:
    await database.term_sets.delete_one({"_id": recording_id, "userId": user_id})


async def rebuild(database: Database, user_id: str, recording_id: str) -> str:
    """Bring one recording's term set in line with its transcript: "built", "removed" or "empty"."""
    transcript = await database.transcripts.find_one(
        {"_id": recording_id, "userId": user_id, "deletedAt": None}, projection={"text": 1})
    if transcript is None:
        await drop(database, user_id, recording_id)
        return "removed"
    term_set = _term_set(user_id, recording_id, transcript.get("text") or "")
    if term_set is None:
        await drop(database, user_id, recording_id)
        return "empty"
    await database.term_sets.replace_one({"_id": recording_id}, term_set, upsert=True)
    return "built"


async def after_sync(database: Database, user_id: str, recording_ids: set[str]) -> None:
    """Run after a sync request has been answered, for the recordings it touched."""
    for recording_id in recording_ids:
        try:
            await rebuild(database, user_id, recording_id)
        except Exception:  # noqa: BLE001 - a derived index must never break a backup
            log.exception("insights: could not update terms for %s", recording_id)


async def ensure_user(database: Database, user_id: str, limit: int = 2000) -> int:
    """Catch up on transcripts that have no term set yet (older ones, or ones synced
    before this existed). Computed here in Python and written in bulk."""
    have = {doc["_id"] async for doc in database.term_sets.find({"userId": user_id}, projection={"_id": 1})}
    cursor = database.transcripts.find(
        {"userId": user_id, "deletedAt": None, "_id": {"$nin": list(have)}}, projection={"text": 1}).limit(limit)
    built, batch = 0, []

    async def flush() -> None:
        nonlocal built, batch
        if batch:
            await database.term_sets.bulk_write(batch, ordered=False)
            built += len(batch)
        batch = []

    async for doc in cursor:
        term_set = _term_set(user_id, doc["_id"], doc.get("text") or "")
        if term_set is not None:
            batch.append(ReplaceOne({"_id": doc["_id"]}, term_set, upsert=True))
        if len(batch) >= CATCH_UP_BATCH:
            await flush()
    await flush()
    return built


# ---------------------------------------------------------------------------
# Asking
# ---------------------------------------------------------------------------

def pipeline(user_id: str, *, recording_ids: list[str] | None = None, limit: int = 20) -> list[dict[str, Any]]:
    match: dict[str, Any] = {"userId": user_id}
    if recording_ids is not None:
        match["_id"] = {"$in": recording_ids}
    return [
        {"$match": match},
        {"$unwind": "$terms"},
        {"$group": {"_id": "$terms.w", "mentions": {"$sum": "$terms.n"}, "recordings": {"$sum": 1}}},
        # More mentions first; a word in more recordings breaks ties, then the alphabet.
        {"$sort": {"mentions": -1, "recordings": -1, "_id": 1}},
        {"$limit": max(1, min(limit, MAX_TOPICS))},
        {"$project": {"_id": 0, "word": "$_id", "mentions": 1, "recordings": 1}},
    ]


async def recording_ids(database: Database, user_id: str, *, folder_id: str | None = None,
                        since: datetime | None = None, until: datetime | None = None) -> list[str] | None:
    """The recordings a topic count is limited to, or None for the whole library."""
    if folder_id is None and since is None and until is None:
        return None
    query: dict[str, Any] = {"userId": user_id, "deletedAt": None}
    if folder_id is not None:
        query["folderId"] = None if folder_id == "inbox" else folder_id
    if since is not None or until is not None:
        query["createdAt"] = {**({"$gte": since} if since else {}), **({"$lt": until} if until else {})}
    return [doc["_id"] async for doc in database.recordings.find(query, projection={"_id": 1})]


async def topics(database: Database, user_id: str, *, folder_id: str | None = None,
                 since: datetime | None = None, until: datetime | None = None, limit: int = 20) -> list[dict[str, Any]]:
    """The words said most across this user's lectures, with how often and in how many recordings."""
    ids = await recording_ids(database, user_id, folder_id=folder_id, since=since, until=until)
    if ids == []:
        return []
    await ensure_user(database, user_id)
    cursor = await database.term_sets.aggregate(pipeline(user_id, recording_ids=ids, limit=limit))
    return [doc async for doc in cursor]
