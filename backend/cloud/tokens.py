"""Access tokens: what lets an assistant read one user's lectures.

A token is a long random string the user creates in the app and pastes into an
assistant. Like refresh tokens, only its SHA-256 is stored, so a copy of the
database cannot be turned back into working tokens. The plain value is shown
once, when it is created.

Tokens are read-only by construction: the only scope that exists is
`lectures:read`, and nothing in the assistant-facing API writes. They are
separate from sign-in sessions on purpose - signing out of the phone does not
cut an assistant off, and revoking an assistant does not sign the phone out -
and they are deleted with the account.
"""
from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Any

from fastapi import HTTPException, status

from backend.cloud.common import new_id, utcnow
from backend.cloud.config import Settings
from backend.cloud.database import Database
from backend.cloud.security import hash_token

PREFIX = "vft_"
SCOPES = ["lectures:read"]
MAX_PER_USER = 10
_TOUCH_EVERY_SECONDS = 60


def looks_like_one(value: str) -> bool:
    return value.startswith(PREFIX)


async def create(database: Database, settings: Settings, user_id: str, name: str) -> tuple[dict[str, Any], str]:
    """Returns the stored record and the plain token. The token is not kept."""
    if await database.access_tokens.count_documents({"userId": user_id}) >= MAX_PER_USER:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"You already have {MAX_PER_USER} assistant tokens. Remove one you no longer use first.",
        )
    plain = PREFIX + secrets.token_urlsafe(32)
    now = utcnow()
    record = {
        "_id": new_id("tok_"),
        "userId": user_id,
        "name": name.strip(),
        "tokenHash": hash_token(plain),
        "scopes": list(SCOPES),
        "createdAt": now,
        "expiresAt": now + timedelta(days=settings.access_token_days),
        "lastUsedAt": None,
    }
    await database.access_tokens.insert_one(record)
    return record, plain


def present(record: dict[str, Any], *, token: str | None = None) -> dict[str, Any]:
    return {
        "id": record["_id"], "name": record["name"], "scopes": record["scopes"],
        "createdAt": record["createdAt"], "expiresAt": record["expiresAt"],
        "lastUsedAt": record.get("lastUsedAt"), "token": token,
    }


async def list_for(database: Database, user_id: str) -> list[dict[str, Any]]:
    cursor = database.access_tokens.find({"userId": user_id, "expiresAt": {"$gt": utcnow()}}).sort("createdAt", -1)
    return [present(record) async for record in cursor]


async def revoke(database: Database, user_id: str, token_id: str) -> bool:
    result = await database.access_tokens.delete_one({"_id": token_id, "userId": user_id})
    return result.deleted_count == 1


async def verify(database: Database, plain: str) -> dict[str, Any] | None:
    """The stored record for a valid, unexpired token - or None."""
    if not looks_like_one(plain):
        return None
    now = utcnow()
    record = await database.access_tokens.find_one({"tokenHash": hash_token(plain), "expiresAt": {"$gt": now}})
    if record is None:
        return None
    last = record.get("lastUsedAt")
    if last is None or (now - last).total_seconds() > _TOUCH_EVERY_SECONDS:
        # So the list can say "last used 2 hours ago"; not on every request.
        await database.access_tokens.update_one({"_id": record["_id"]}, {"$set": {"lastUsedAt": now}})
    return record
