"""Users and sessions: creating them, rotating them, ending them."""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import HTTPException, Request, status
from pymongo import ReturnDocument

from backend.cloud.common import new_id, utcnow
from backend.cloud.config import Settings
from backend.cloud.database import Database
from backend.cloud.models import Tokens, User
from backend.cloud.security import hash_token, issue_access_token, new_refresh_token

INVALID_SESSION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Your session has ended. Sign in again.",
)

# A refresh token used again within this many seconds of being rotated away is
# most likely a retried request, not a thief. It is refused, but the session is
# left alone instead of being revoked.
ROTATION_GRACE_SECONDS = 10


def normalize_email(email: str) -> str:
    return email.strip().lower()


def user_out(user: dict[str, Any]) -> User:
    return User(
        id=user["_id"],
        email=user.get("email"),
        created_at=user["createdAt"],
        has_password=bool(user.get("passwordHash")),
        apple_linked=bool(user.get("appleSub")),
        google_linked=bool(user.get("googleSub")),
    )


def _device_name(request: Request, given: str | None) -> str:
    if given and given.strip():
        return given.strip()[:80]
    return (request.headers.get("user-agent") or "Unknown device")[:80]


async def start_session(
    database: Database, settings: Settings, user: dict[str, Any],
    request: Request, device_name: str | None,
) -> Tokens:
    """A new signed-in device: one session document, one pair of tokens."""
    refresh = new_refresh_token()
    now = utcnow()
    session_id = new_id("ses_")
    await database.sessions.insert_one({
        "_id": session_id,
        "userId": user["_id"],
        "tokenHash": hash_token(refresh),
        "createdAt": now,
        "lastUsedAt": now,
        "expiresAt": now + timedelta(days=settings.refresh_token_days),
        "deviceName": _device_name(request, device_name),
    })
    await database.users.update_one({"_id": user["_id"]}, {"$set": {"lastSignInAt": now}})
    access, lifetime = issue_access_token(settings, user["_id"], session_id)
    return Tokens(access_token=access, refresh_token=refresh, expires_in=lifetime, user=user_out(user))


async def rotate_session(database: Database, settings: Settings, refresh_token: str) -> Tokens:
    """Swap a refresh token for a new pair.

    The swap is a single atomic find-and-update on the token's hash, so two
    requests racing with the same token cannot both succeed. The loser falls
    through to the reuse check below.
    """
    presented = hash_token(refresh_token)
    replacement = new_refresh_token()
    now = utcnow()
    session = await database.sessions.find_one_and_update(
        {"tokenHash": presented, "expiresAt": {"$gt": now}},
        {"$set": {
            "tokenHash": hash_token(replacement),
            "previousTokenHash": presented,
            "rotatedAt": now,
            "lastUsedAt": now,
            # Sliding expiry: someone who opens the app stays signed in.
            "expiresAt": now + timedelta(days=settings.refresh_token_days),
        }},
        return_document=ReturnDocument.AFTER,
    )
    if session is None:
        stolen = await database.sessions.find_one({"previousTokenHash": presented})
        if stolen is not None:
            rotated = stolen.get("rotatedAt")
            if rotated is None or (now - rotated).total_seconds() > ROTATION_GRACE_SECONDS:
                # A token that was already exchanged has come back. Either the
                # client is badly broken or someone copied it; in both cases
                # the safe thing is to end the session for everyone holding it.
                await database.sessions.delete_one({"_id": stolen["_id"]})
        raise INVALID_SESSION

    user = await database.users.find_one({"_id": session["userId"]})
    if user is None:
        await database.sessions.delete_one({"_id": session["_id"]})
        raise INVALID_SESSION
    access, lifetime = issue_access_token(settings, user["_id"], session["_id"])
    return Tokens(access_token=access, refresh_token=replacement, expires_in=lifetime, user=user_out(user))


async def end_sessions(database: Database, user_id: str, *, keep: str | None = None) -> int:
    query: dict[str, Any] = {"userId": user_id}
    if keep:
        query["_id"] = {"$ne": keep}
    result = await database.sessions.delete_many(query)
    return result.deleted_count


async def delete_account(database: Database, user_id: str) -> None:
    """Everything belonging to the user, then the user.

    The account goes last on purpose. If this stops halfway, the user can
    still sign in and try again; deleting the account first would leave data
    behind that nobody can reach or remove.
    """
    for collection in (database.transcripts, database.recordings, database.folders, database.password_resets):
        await collection.delete_many({"userId": user_id})
    await database.sessions.delete_many({"userId": user_id})
    # An assistant must not keep reading lectures of an account that is gone.
    await database.access_tokens.delete_many({"userId": user_id})
    # Passages are copies of the transcripts, so they go with them.
    await database.chunks.delete_many({"userId": user_id})
    await database.chunk_sets.delete_many({"userId": user_id})
    await database.term_sets.delete_many({"userId": user_id})
    # Assistants that signed in: their grants, tokens and any code not yet collected.
    for collection in (database.oauth_grants, database.oauth_tokens, database.oauth_codes):
        await collection.delete_many({"userId": user_id})
    await database.users.delete_one({"_id": user_id})
