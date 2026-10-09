"""Passwords, tokens and codes.

Passwords
---------
argon2id, with OWASP's lower-memory parameters (19 MiB, 2 passes, 1 lane).
The library default uses 64 MiB per hash; on a small container a handful of
simultaneous logins at that size is enough to run out of memory. Hashing is
CPU-bound, so callers run it in a thread rather than blocking the event loop.

Tokens
------
An access token is a short-lived JWT. It is cheap to reject a forged or expired
one without touching the database. A valid one is still checked against its
session on every request, so signing out and deleting an account take effect
immediately rather than when the token happens to expire.

A refresh token is a long random string. Only its SHA-256 is stored, so a
database leak does not hand out working sessions. It rotates on every use, and
presenting one that has already been rotated away is treated as theft: the
session is revoked.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from starlette.concurrency import run_in_threadpool

from backend.cloud.common import utcnow
from backend.cloud.config import Settings

_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)

# Verified against when the account does not exist, so a login for an unknown
# email takes as long as one with a wrong password. Without it the response time
# says which emails have accounts.
_DUMMY_HASH = _hasher.hash("not-a-real-password-just-for-timing")

REFRESH_PREFIX = "vfr_"


async def hash_password(password: str) -> str:
    return await run_in_threadpool(_hasher.hash, password)


async def verify_password(stored_hash: str | None, password: str) -> bool:
    def check() -> bool:
        try:
            return _hasher.verify(stored_hash or _DUMMY_HASH, password) and stored_hash is not None
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False
    return await run_in_threadpool(check)


def needs_rehash(stored_hash: str) -> bool:
    """True when the hash was made with older parameters than today's."""
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except InvalidHashError:
        return True


# ---------------------------------------------------------------------------
# Access tokens
# ---------------------------------------------------------------------------

def issue_access_token(settings: Settings, user_id: str, session_id: str) -> tuple[str, int]:
    lifetime = settings.access_token_minutes * 60
    now = utcnow()
    claims = {
        "sub": user_id,
        "sid": session_id,
        "typ": "access",
        "iss": settings.jwt_issuer,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=lifetime)).timestamp()),
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm="HS256"), lifetime


def decode_access_token(settings: Settings, token: str) -> dict[str, Any]:
    """The claims of a valid token. Raises jwt.InvalidTokenError otherwise."""
    claims = jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=["HS256"],          # pinned: never let the token choose
        issuer=settings.jwt_issuer,
        options={"require": ["sub", "sid", "exp", "iat", "iss"]},
    )
    if claims.get("typ") != "access":
        raise jwt.InvalidTokenError("not an access token")
    return claims


# ---------------------------------------------------------------------------
# Refresh tokens and one-time codes
# ---------------------------------------------------------------------------

def new_refresh_token() -> str:
    return REFRESH_PREFIX + secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_reset_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_code(settings: Settings, code: str) -> str:
    """Keyed hash of a 6-digit code.

    There are only a million codes, so a plain hash of one is reversed by
    trying them all. Keying it with the server secret means a copy of the
    database alone is not enough to do that.
    """
    return hmac.new(settings.jwt_secret.encode(), code.encode(), hashlib.sha256).hexdigest()


def same(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def hash_key(value: str) -> str:
    """A stable, non-reversible form of an email or IP, for rate-limit keys."""
    return hashlib.sha256(value.lower().encode()).hexdigest()[:32]
