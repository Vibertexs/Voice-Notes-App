"""Two-way sync between phones and the server.

One request does both directions: the phone sends what changed on it since it
last synced, the server applies what it can, then answers with what changed
everywhere else.

Conflicts: last write wins
--------------------------
Each document's `updatedAt` is when the user made the change. The server keeps
whichever copy has the later one, using a single conditional upsert per
document:

    replace where {_id, userId, updatedAt < incoming}   (upsert)

That matches when the server copy is older (replace it) and when there is no
server copy (insert it). When the server copy is the same age or newer, the
filter matches nothing, the upsert tries to insert a second document with that
_id, and the duplicate-key error is the answer: rejected, the server's copy
stands, and the phone will receive it on the way back. A document id that
belongs to a different user lands in the same place, so one user can never
overwrite another's data by guessing an id.

Pulling: the cursor
-------------------
Pulls walk `syncedAt` - when the server accepted a change - in (syncedAt, _id)
order. Phone clocks are not trusted for this: a phone running an hour slow
would stamp its changes an hour in the past, behind every other phone's
cursor, and they would never be delivered.

Two subtleties, both handled by the cursor:

  - A page boundary can fall inside a run of documents that share a
    millisecond. The cursor holds the last _id as well as the time, so the
    next page starts exactly after the last document it delivered.
  - A write can be stamped with a syncedAt just before a pull reads the
    collection but commit just after, so the most recent few seconds are
    never settled. The cursor never advances past OVERLAP_SECONDS before the
    pull began; that window is read again next time. Anything delivered
    twice is harmless: applying the same document twice under last-write-wins
    changes nothing.

A device never receives its own writes back (`syncedBy`), which matters
because the largest documents - transcripts - are exactly the ones a phone
uploads.
"""
from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from pymongo.errors import DuplicateKeyError

from backend.cloud.common import as_utc, utcnow
from backend.cloud.database import Database
from backend.cloud.models import FolderDoc, RecordingDoc, SyncChanges, TranscriptDoc

OVERLAP_SECONDS = 5
# A phone with its clock set far into the future would otherwise win every
# conflict forever. Anything later than this is treated as "now".
MAX_CLOCK_SKEW = timedelta(minutes=5)

KINDS = ("folders", "recordings", "transcripts")
PAGE_SIZE = {"folders": 200, "recordings": 200, "transcripts": 10}

_INTERNAL = ("userId", "syncedAt", "syncedBy")


# ---------------------------------------------------------------------------
# Documents in and out
# ---------------------------------------------------------------------------

def to_client(stored: dict[str, Any]) -> dict[str, Any]:
    """A stored document as the API presents it: `id`, no bookkeeping."""
    out = {key: value for key, value in stored.items() if key not in _INTERNAL and key != "_id"}
    out["id"] = stored["_id"]
    return out


def _tombstone(kind: str, stored: dict[str, Any]) -> dict[str, Any]:
    """Keep what sync needs to route a delete; drop the content.

    A deleted recording should not leave its words behind on the server for
    the next six months, so the content goes now and the tombstone itself is
    removed later by the TTL index.
    """
    keep = {key: stored[key] for key in ("_id", "userId", "updatedAt", "deletedAt", "syncedAt", "syncedBy")}
    if kind == "folders":
        keep["name"] = ""
    elif kind == "recordings":
        keep.update(title="", markers=[], notes="", folderId=None)
    else:
        keep.update(text="", segments=[])
    return keep


def _storage(kind: str, doc: FolderDoc | RecordingDoc | TranscriptDoc, user_id: str,
             device_id: str, now: datetime) -> dict[str, Any]:
    stored = doc.model_dump(by_alias=True, exclude={"id"})
    stored.update(_id=doc.id, userId=user_id, syncedAt=now, syncedBy=device_id)
    if stored["updatedAt"] > now + MAX_CLOCK_SKEW:
        stored["updatedAt"] = now
    if stored.get("deletedAt") is not None:
        return _tombstone(kind, stored)
    if kind == "transcripts":
        # Fifteen thousand `"e": null`s add up; an absent end means the same.
        for segment in stored["segments"]:
            for word in segment["words"]:
                if word["e"] is None:
                    del word["e"]
    return stored


def _collection(database: Database, kind: str):
    return database.db[kind]


# ---------------------------------------------------------------------------
# Push
# ---------------------------------------------------------------------------

async def _keep_audio(database: Database, user_id: str, stored: dict[str, Any]) -> None:
    """Only the phone that recorded a take knows where its audio is.

    Another phone editing the title sends the recording without audio
    details, because it has none. Replacing the server copy wholesale would
    erase the one record of which device holds the file, so carry it over.
    """
    if stored.get("audio") is None and stored.get("deletedAt") is None:
        existing = await database.recordings.find_one(
            {"_id": stored["_id"], "userId": user_id}, projection={"audio": 1})
        if existing and existing.get("audio"):
            stored["audio"] = existing["audio"]


async def apply_one(database: Database, kind: str, stored: dict[str, Any]) -> bool:
    """Last-write-wins upsert. True if the server took this copy."""
    try:
        await _collection(database, kind).replace_one(
            {"_id": stored["_id"], "userId": stored["userId"], "updatedAt": {"$lt": stored["updatedAt"]}},
            stored,
            upsert=True,
        )
        return True
    except DuplicateKeyError:
        return False


async def _cascade_transcript_delete(database: Database, recording: dict[str, Any]) -> None:
    """A deleted recording takes its transcript with it."""
    await database.transcripts.update_one(
        {"_id": recording["_id"], "userId": recording["userId"]},
        {"$set": {
            "deletedAt": recording["deletedAt"], "updatedAt": recording["updatedAt"],
            "syncedAt": recording["syncedAt"], "syncedBy": recording["syncedBy"],
            "text": "", "segments": [],
        }},
    )


async def push(database: Database, user_id: str, device_id: str,
               changes: SyncChanges) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    applied: dict[str, list[str]] = {kind: [] for kind in KINDS}
    rejected: dict[str, list[str]] = {kind: [] for kind in KINDS}
    for kind in KINDS:
        for doc in getattr(changes, kind):
            now = utcnow()
            stored = _storage(kind, doc, user_id, device_id, now)
            if kind == "recordings":
                await _keep_audio(database, user_id, stored)
            if await apply_one(database, kind, stored):
                applied[kind].append(doc.id)
                if kind == "recordings" and stored.get("deletedAt") is not None:
                    await _cascade_transcript_delete(database, stored)
            else:
                rejected[kind].append(doc.id)
    return applied, rejected


# ---------------------------------------------------------------------------
# Pull
# ---------------------------------------------------------------------------

Position = tuple[datetime, str]          # (syncedAt, _id): read strictly after this
_START: Position = (datetime(1970, 1, 1, tzinfo=timezone.utc), "")


def encode_cursor(positions: dict[str, Position]) -> str:
    data = {kind: [moment.isoformat(), last_id] for kind, (moment, last_id) in positions.items()}
    raw = json.dumps(data, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> dict[str, Position]:
    """Where each collection's pull left off.

    Anything unreadable means "start from the beginning" - a full resync is
    slow but always correct, and better than refusing to sync at all.
    """
    if not cursor:
        return {kind: _START for kind in KINDS}
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
        positions = {}
        for kind in KINDS:
            moment, last_id = data[kind]
            if not isinstance(last_id, str):
                raise TypeError
            positions[kind] = (as_utc(datetime.fromisoformat(moment)), last_id)
        return positions
    except (ValueError, KeyError, TypeError):
        return {kind: _START for kind in KINDS}


async def pull(database: Database, user_id: str, device_id: str,
               cursor: str | None) -> tuple[dict[str, list[dict]], str, bool]:
    # Everything stamped at or before `settled` has certainly committed:
    # no write takes OVERLAP_SECONDS between being stamped and landing.
    settled: Position = (utcnow() - timedelta(seconds=OVERLAP_SECONDS), "")
    positions = decode_cursor(cursor)

    changes: dict[str, list[dict]] = {}
    more = False
    for kind in KINDS:
        since, after_id = positions[kind]
        query = {
            "userId": user_id,
            "syncedBy": {"$ne": device_id},
            "$or": [
                {"syncedAt": {"$gt": since}},
                {"syncedAt": since, "_id": {"$gt": after_id}},
            ],
        }
        limit = PAGE_SIZE[kind]
        found = [doc async for doc in _collection(database, kind)
                 .find(query).sort([("syncedAt", 1), ("_id", 1)]).limit(limit + 1)]
        page = found[:limit]
        changes[kind] = [to_client(doc) for doc in page]
        if len(found) > limit:
            reached: Position = (page[-1]["syncedAt"], page[-1]["_id"])
            # Only ask for another page if it would make progress. A full
            # page inside the unsettled window would come back unchanged.
            more = more or reached < settled
        else:
            reached = (utcnow(), "")
        # Never move into the unsettled window: it is read again next time.
        positions[kind] = min(reached, settled)
    return changes, encode_cursor(positions), more
