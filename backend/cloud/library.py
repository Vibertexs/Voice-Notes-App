"""Reading and editing a user's library directly, without a phone in the loop.

The phones keep their copies current through /v1/sync. These are the calls
for everything else - a web page, a script, and next, an MCP server that lets
Claude read your lectures. Edits made here are stamped like any other change,
so the phones pick them up on their next sync.

Every query in this module filters on userId first. The indexes all lead with
it, and a query that forgot it would be both slow and a data leak.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from pymongo import ReturnDocument
from pymongo.errors import OperationFailure

from backend.cloud.common import new_id, utcnow
from backend.cloud.config import Settings
from backend.cloud.database import SEARCH_INDEX, Database
from backend.cloud.models import FOLDER_COLORS, FolderCreate, FolderUpdate, RecordingUpdate
from backend.cloud.sync import to_client

log = logging.getLogger("voiceflow.library")

# Changes made through this API are attributed to this pseudo-device. It
# contains a colon, which a real device id cannot (see ID_PATTERN), so every
# phone receives these changes on its next pull.
API_DEVICE = "server:api"

LIVE = {"deletedAt": None}


def _not_found(what: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"That {what} does not exist.")


def _stamp() -> dict[str, Any]:
    now = utcnow()
    return {"updatedAt": now, "syncedAt": now, "syncedBy": API_DEVICE}


# ---------------------------------------------------------------------------
# Folders
# ---------------------------------------------------------------------------

async def list_folders(database: Database, user_id: str, *, archived: bool = False) -> list[dict]:
    """Folders with how many recordings each holds and their total length.

    One aggregation instead of a query per folder: $lookup runs the inner
    pipeline for each folder, and that pipeline is answered by the by_folder
    index (userId, folderId, ...).
    """
    pipeline = [
        {"$match": {"userId": user_id, **LIVE, "archivedAt": {"$ne": None} if archived else None}},
        {"$lookup": {
            "from": "recordings",
            "let": {"folder": "$_id"},
            "pipeline": [
                {"$match": {"userId": user_id, **LIVE, "$expr": {"$eq": ["$folderId", "$$folder"]}}},
                {"$group": {
                    "_id": None,
                    "count": {"$sum": 1},
                    "seconds": {"$sum": {"$ifNull": ["$durationSeconds", 0]}},
                    "latest": {"$max": "$createdAt"},
                }},
            ],
            "as": "stats",
        }},
        {"$set": {"stats": {"$first": "$stats"}}},
    ]
    folders = []
    async for folder in await database.folders.aggregate(pipeline):
        stats = folder.pop("stats", None) or {}
        out = to_client(folder)
        out.update(
            recordingCount=stats.get("count", 0),
            durationSeconds=stats.get("seconds", 0),
            lastRecordedAt=stats.get("latest"),
        )
        folders.append(out)
    # Sorted here, not with a case-insensitive collation in the pipeline: a
    # collation applies to the inner $lookup too, and the indexes use the
    # default one, so it would quietly turn every lookup into a scan.
    return sorted(folders, key=lambda folder: folder["name"].casefold())


async def get_folder(database: Database, user_id: str, folder_id: str) -> dict:
    folder = await database.folders.find_one({"_id": folder_id, "userId": user_id, **LIVE})
    if folder is None:
        raise _not_found("folder")
    return folder


async def create_folder(database: Database, user_id: str, body: FolderCreate) -> dict:
    now = utcnow()
    folder = {
        "_id": new_id(),
        "userId": user_id,
        "name": body.name.strip(),
        "color": body.color if body.color in FOLDER_COLORS else "blue",
        "icon": body.icon,
        "parentId": None,
        "createdAt": now,
        "archivedAt": None,
        "deletedAt": None,
        **_stamp(),
    }
    await database.folders.insert_one(folder)
    return to_client(folder)


async def update_folder(database: Database, user_id: str, folder_id: str, body: FolderUpdate) -> dict:
    changes: dict[str, Any] = {}
    if body.name is not None:
        changes["name"] = body.name.strip()
    if body.color is not None:
        changes["color"] = body.color if body.color in FOLDER_COLORS else "blue"
    if "icon" in body.model_fields_set:
        changes["icon"] = body.icon or None
    if body.archived is not None:
        changes["archivedAt"] = utcnow() if body.archived else None
    folder = await database.folders.find_one_and_update(
        {"_id": folder_id, "userId": user_id, **LIVE},
        {"$set": {**changes, **_stamp()}},
        return_document=ReturnDocument.AFTER,
    )
    if folder is None:
        raise _not_found("folder")
    return to_client(folder)


async def delete_folder(database: Database, user_id: str, folder_id: str) -> None:
    """Recordings outlive the folder they were filed under, as on the phone.

    They move to the inbox first. If this stops halfway the folder still
    exists and the call can simply be repeated.
    """
    await get_folder(database, user_id, folder_id)
    await database.recordings.update_many(
        {"userId": user_id, "folderId": folder_id, **LIVE},
        {"$set": {"folderId": None, **_stamp()}},
    )
    stamp = _stamp()
    await database.folders.update_one(
        {"_id": folder_id, "userId": user_id},
        {"$set": {"deletedAt": stamp["updatedAt"], "name": "", **stamp}},
    )


# ---------------------------------------------------------------------------
# Recordings
# ---------------------------------------------------------------------------

async def list_recordings(
    database: Database, user_id: str, *, folder_id: str | None = None,
    before: datetime | None = None, limit: int = 50,
) -> list[dict]:
    """Newest first. `folder_id="inbox"` lists recordings in no folder.

    Paged by createdAt rather than skip/offset: skipping makes the database
    walk past every earlier row, and the by_folder / by_created indexes
    already hold recordings in exactly this order.
    """
    query: dict[str, Any] = {"userId": user_id, **LIVE}
    if folder_id == "inbox":
        query["folderId"] = None
    elif folder_id:
        query["folderId"] = folder_id
    if before is not None:
        query["createdAt"] = {"$lt": before}
    pipeline = [
        {"$match": query},
        {"$sort": {"createdAt": -1}},
        {"$limit": max(1, min(limit, 200))},
        # A listing says how many bookmarks there are, not what they are.
        {"$set": {"markerCount": {"$size": {"$ifNull": ["$markers", []]}}}},
        {"$unset": ["markers", "notes"]},
    ]
    return [to_client(doc) async for doc in await database.recordings.aggregate(pipeline)]


async def get_recording(database: Database, user_id: str, recording_id: str) -> dict:
    recording = await database.recordings.find_one({"_id": recording_id, "userId": user_id, **LIVE})
    if recording is None:
        raise _not_found("recording")
    return to_client(recording)


async def update_recording(database: Database, user_id: str, recording_id: str, body: RecordingUpdate) -> dict:
    changes: dict[str, Any] = {}
    if body.title is not None:
        changes["title"] = body.title.strip()
    if body.favorite is not None:
        changes["favorite"] = body.favorite
    if body.folder_id is not None:
        if body.folder_id == "inbox":
            changes["folderId"] = None
        else:
            await get_folder(database, user_id, body.folder_id)
            changes["folderId"] = body.folder_id
    recording = await database.recordings.find_one_and_update(
        {"_id": recording_id, "userId": user_id, **LIVE},
        {"$set": {**changes, **_stamp()}},
        return_document=ReturnDocument.AFTER,
    )
    if recording is None:
        raise _not_found("recording")
    return to_client(recording)


async def delete_recording(database: Database, user_id: str, recording_id: str) -> None:
    """Deletes the words everywhere. The audio is on the phone that recorded
    it, and is removed there when this tombstone reaches it."""
    stamp = _stamp()
    gone = {"deletedAt": stamp["updatedAt"], **stamp}
    result = await database.recordings.update_one(
        {"_id": recording_id, "userId": user_id, **LIVE},
        {"$set": {**gone, "title": "", "markers": [], "notes": "", "folderId": None},
         "$unset": {"audio": ""}},
    )
    if result.matched_count == 0:
        raise _not_found("recording")
    await database.transcripts.update_one(
        {"_id": recording_id, "userId": user_id},
        {"$set": {**gone, "text": "", "segments": []}},
    )
    from backend.cloud import semantic
    await semantic.drop(database, user_id, recording_id)


async def get_transcript(
    database: Database, user_id: str, recording_id: str, *,
    start: float | None = None, end: float | None = None, words: bool = False,
) -> dict:
    """The transcript, optionally only the part between two times.

    The slicing happens in the database ($filter), so asking for five minutes
    of a three-hour lecture sends five minutes over the wire. Word timings are
    left out unless asked for; they are most of the document's size and only
    a player needs them.
    """
    keep = {"$and": [
        {"$lt": ["$$s.start", end]} if end is not None else True,
        {"$gt": [{"$ifNull": ["$$s.end", "$$s.start"]}, start]} if start is not None else True,
    ]}
    pipeline: list[dict[str, Any]] = [
        {"$match": {"_id": recording_id, "userId": user_id, **LIVE}},
        {"$set": {"segments": {"$filter": {"input": "$segments", "as": "s", "cond": keep}}}},
        {"$unset": ["userId", "syncedAt", "syncedBy"]},
    ]
    if not words:
        pipeline.append({"$unset": "segments.words"})
    found = [doc async for doc in await database.transcripts.aggregate(pipeline)]
    if not found:
        # Distinguish "no such recording" from "not transcribed yet".
        await get_recording(database, user_id, recording_id)
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That recording has no transcript yet.")
    transcript = found[0]
    if start is not None or end is not None:
        # The full text would defeat the point of asking for a slice.
        transcript["text"] = " ".join(segment["text"].strip() for segment in transcript["segments"])
    transcript["id"] = transcript.pop("_id")
    return transcript


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

class Search:
    """Full-text search over transcripts and titles.

    With Atlas Search: a Lucene index, relevance-ranked, tolerant of word
    forms. Without it (a local MongoDB, or while Atlas is still building the
    index): a case-insensitive regex scan of this user's transcripts, which is
    fine at one person's scale and always correct.

    An Atlas $search against an index that is not ready returns no results
    rather than an error, so readiness is checked explicitly and cached.
    """

    READY_CHECK_SECONDS = 60

    def __init__(self, database: Database, settings: Settings) -> None:
        self.database = database
        self.mode = settings.search_backend
        self._ready = False
        self._checked = 0.0

    async def atlas_ready(self) -> bool:
        if self.mode == "regex":
            return False
        if self.mode == "atlas":
            return True
        if not self._ready and time.monotonic() - self._checked > self.READY_CHECK_SECONDS:
            self._checked = time.monotonic()
            try:
                indexes = [i async for i in await self.database.transcripts.list_search_indexes(SEARCH_INDEX)]
                self._ready = bool(indexes) and bool(indexes[0].get("queryable"))
            except OperationFailure:
                self._ready = False
        return self._ready

    async def run(self, user_id: str, text: str, limit: int = 20) -> dict:
        text = text.strip()[:200]
        if not text:
            return {"query": "", "engine": "none", "results": []}
        limit = max(1, min(limit, 50))
        if await self.atlas_ready():
            try:
                hits = await self._atlas(user_id, text, limit)
                engine = "atlas"
            except OperationFailure as error:
                log.warning("Atlas Search failed, using regex: %s", error.details.get("errmsg"))
                hits, engine = await self._regex(user_id, text, limit), "regex"
        else:
            hits, engine = await self._regex(user_id, text, limit), "regex"
        return {"query": text, "engine": engine, "results": await self._results(user_id, text, hits, limit)}

    async def _atlas(self, user_id: str, text: str, limit: int) -> list[dict]:
        pipeline = [
            {"$search": {
                "index": SEARCH_INDEX,
                "compound": {
                    # filter: must match, does not affect the score.
                    "filter": [{"equals": {"path": "userId", "value": user_id}}],
                    "must": [{"text": {"query": text, "path": "text"}}],
                },
            }},
            {"$match": LIVE},
            {"$limit": limit},
            {"$project": {"segments.start": 1, "segments.text": 1, "score": {"$meta": "searchScore"}}},
        ]
        return [doc async for doc in await self.database.transcripts.aggregate(pipeline)]

    async def _regex(self, user_id: str, text: str, limit: int) -> list[dict]:
        pattern = {"$regex": re.escape(text), "$options": "i"}
        cursor = self.database.transcripts.find(
            {"userId": user_id, **LIVE, "text": pattern},
            projection={"segments.start": 1, "segments.text": 1},
        ).sort("updatedAt", -1).limit(limit)
        return [doc async for doc in cursor]

    async def _results(self, user_id: str, text: str, hits: list[dict], limit: int) -> list[dict]:
        """Attach each hit to its recording and find where the words were said."""
        ids = [hit["_id"] for hit in hits]
        title_match = {"userId": user_id, **LIVE, "title": {"$regex": re.escape(text), "$options": "i"}}
        cursor = self.database.recordings.find(
            {"$or": [{"userId": user_id, **LIVE, "_id": {"$in": ids}}, title_match]},
            projection={"title": 1, "folderId": 1, "createdAt": 1, "durationSeconds": 1},
        ).sort("createdAt", -1).limit(len(ids) + limit)
        recordings = {doc["_id"]: doc async for doc in cursor}
        needle = text.lower()
        terms = [term for term in re.findall(r"\w+", needle) if len(term) > 2]
        results = []
        for hit in hits:
            recording = recordings.pop(hit["_id"], None)
            if recording is None:
                continue
            segment = _best_segment(hit.get("segments", []), needle, terms)
            results.append(_result(recording, segment, hit.get("score")))
        # Recordings whose title matched but whose transcript did not.
        for recording in recordings.values():
            if len(results) >= limit:
                break
            results.append(_result(recording, None, None))
        return results[:limit]


def _best_segment(segments: list[dict], needle: str, terms: list[str]) -> dict | None:
    """The exact phrase if a segment has it, else the one with most terms."""
    best, best_score = None, 0
    for segment in segments:
        said = str(segment.get("text", "")).lower()
        score = 100 if needle in said else sum(term in said for term in terms)
        if score > best_score:
            best, best_score = segment, score
            if score == 100:
                break
    return best


def _result(recording: dict, segment: dict | None, score: float | None) -> dict:
    return {
        "recordingId": recording["_id"],
        "title": recording.get("title", ""),
        "folderId": recording.get("folderId"),
        "createdAt": recording.get("createdAt"),
        "startSeconds": segment.get("start") if segment else None,
        "excerpt": str(segment.get("text", "")).strip() if segment else "",
        "score": score,
    }
