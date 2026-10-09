"""FastAPI dependencies: the database, the settings, and the signed-in user.

Identity always comes from here, never from a request body or a path. A route
that took a user id as a parameter would let anyone name anyone; these routes
only ever see the user their token proves they are.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.cloud.common import utcnow
from backend.cloud.config import Settings
from backend.cloud.database import Database
from backend.cloud.security import decode_access_token

_bearer = HTTPBearer(auto_error=False)

UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Sign in to continue.",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_database(request: Request) -> Database:
    return request.app.state.db


def get_config(request: Request) -> Settings:
    return request.app.state.settings


DatabaseDep = Annotated[Database, Depends(get_database)]
SettingsDep = Annotated[Settings, Depends(get_config)]


@dataclass(frozen=True)
class Principal:
    user_id: str
    session_id: str
    user: dict[str, Any]


async def current_principal(
    database: DatabaseDep,
    settings: SettingsDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> Principal:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise UNAUTHORIZED
    try:
        claims = decode_access_token(settings, credentials.credentials)
    except jwt.InvalidTokenError:
        raise UNAUTHORIZED from None

    # The token is genuine and unexpired; the session still has to exist.
    # This is what makes sign-out and account deletion immediate.
    session = await database.sessions.find_one(
        {"_id": claims["sid"], "userId": claims["sub"], "expiresAt": {"$gt": utcnow()}},
        projection={"_id": 1},
    )
    if session is None:
        raise UNAUTHORIZED
    user = await database.users.find_one({"_id": claims["sub"]})
    if user is None:
        raise UNAUTHORIZED
    return Principal(user_id=claims["sub"], session_id=claims["sid"], user=user)


PrincipalDep = Annotated[Principal, Depends(current_principal)]


def client_ip(request: Request) -> str:
    """The caller's address. Correct behind a proxy only when uvicorn is run
    with --proxy-headers, which the Dockerfile does."""
    return request.client.host if request.client else "unknown"
