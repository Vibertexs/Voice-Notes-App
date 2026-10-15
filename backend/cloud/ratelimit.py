"""Rate limits for the endpoints worth guessing at: sign-in, sign-up, resets.

Counters live in MongoDB rather than in memory, so the limit holds across
however many copies of the server are running. Each check is one atomic
find-and-increment on a document per (bucket, key, time window), created on
first use and removed by a TTL index once its window has passed - so there is
nothing to clean up and no race between two requests counting at once.

Keys are hashed: the collection should not become a list of every email
address anyone ever typed into the sign-in box.
"""
from __future__ import annotations

from datetime import timedelta

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from backend.cloud.common import utcnow
from backend.cloud.config import Settings
from backend.cloud.database import Database
from backend.cloud.security import hash_key

LIMITS = {
    # bucket: (requests allowed, per this many seconds)
    "register:ip": (5, 3600),
    "login:ip": (20, 60),
    "login:email": (8, 300),
    "refresh:ip": (60, 60),
    "forgot:ip": (10, 3600),
    "forgot:email": (3, 900),
    "reset:email": (10, 900),
    "apple:ip": (20, 60),
    "google:ip": (20, 60),
}


async def hit(database: Database, settings: Settings, bucket: str, key: str) -> None:
    if not settings.rate_limits_enabled:
        return
    allowed, window = LIMITS[bucket]
    now = utcnow()
    slot = int(now.timestamp()) // window
    counter = await database.rate_limits.find_one_and_update(
        {"_id": f"{bucket}:{hash_key(key)}:{slot}"},
        {"$inc": {"n": 1}, "$setOnInsert": {"expiresAt": now + timedelta(seconds=2 * window)}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    if counter["n"] > allowed:
        retry = window - int(now.timestamp()) % window
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Wait a moment and try again.",
            headers={"Retry-After": str(retry)},
        )
