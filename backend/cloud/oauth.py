"""Letting an assistant connect by signing in, instead of by pasted token.

The person clicks "connect" in Claude or ChatGPT, lands on a VoiceFlow page, signs
in with Google, approves, and the assistant is handed a token for their lectures.
This module is the authorization server behind that: the MCP SDK speaks the
protocol (discovery, /authorize, /token, /register, /revoke) and calls the methods
below to store and look things up.

What is stored, all in MongoDB and all short-lived or sliding:

  oauth_clients   assistants that registered themselves (DCR) or published a
                  metadata document at their client id (CIMD); public clients only
  oauth_requests  an authorization waiting for the person to approve it (10 min)
  oauth_codes     an approved request waiting to be exchanged for tokens (5 min, once)
  oauth_grants    "this person let this assistant in" - what the app lists and revokes
  oauth_tokens    access tokens (an hour) and refresh tokens (rotated on every use)

Rules that matter:

  - PKCE is required (the SDK enforces it) and clients hold no secret, so a stolen
    authorization code is useless without the verifier.
  - Tokens are bound to this server (RFC 8707): a request naming any other
    `resource` is refused.
  - Codes and refresh tokens are single use. Presenting one a second time is what
    a thief does, so it revokes the whole grant.
  - Only hashes are stored. Revoking a grant deletes it and every token it issued.
  - The only scope is `lectures:read`; nothing here can write.
"""
from __future__ import annotations

import logging
import re
import secrets
from datetime import timedelta
from typing import Any, Awaitable, Callable
from urllib.parse import urlsplit

from mcp.server.auth.provider import (
    AccessToken, AuthorizationCode, AuthorizationParams, AuthorizeError, RefreshToken, RegistrationError,
    TokenError, construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pymongo import ReturnDocument

from backend.cloud import cimd, tokens
from backend.cloud.common import new_id, utcnow
from backend.cloud.config import Settings
from backend.cloud.database import Database
from backend.cloud.security import hash_token

log = logging.getLogger("voiceflow.oauth")

ACCESS_PREFIX = "vfo_"
REFRESH_PREFIX = "vfr_"
CODE_PREFIX = "vfc_"
REQUEST_MINUTES = 10
CODE_MINUTES = 5
CLIENT_DAYS = 60                  # a registered client unused this long is forgotten
METADATA_FRESH_SECONDS = 3600     # a fetched client document is trusted this long...
METADATA_KEEP_SECONDS = 24 * 3600  # ...and used for this long if the client's site is down
MAX_REDIRECT_URIS = 10
_TOUCH_SECONDS = 60

_BLOCKED_SCHEMES = {"javascript", "data", "file", "vbscript", "about", "blob", "ftp", "ws", "wss"}
_LOOPBACK = {"localhost", "127.0.0.1", "::1"}


def valid_redirect(uri: str) -> bool:
    """https anywhere, http only to this machine, or an app's own scheme (claude://...).
    Never a scheme a browser would run, and never one carrying a fragment."""
    if len(uri) > 512:
        return False
    try:
        parts = urlsplit(uri)
    except ValueError:
        return False
    scheme = parts.scheme.lower()
    if not scheme or parts.fragment or not re.fullmatch(r"[a-z][a-z0-9+.-]*", scheme):
        return False
    if scheme == "https":
        return bool(parts.hostname)
    if scheme == "http":
        return parts.hostname in _LOOPBACK
    return scheme not in _BLOCKED_SCHEMES


def clean_name(value: Any) -> str | None:
    """A name shown to a person on the consent page: printable, short."""
    if not isinstance(value, str):
        return None
    name = "".join(ch for ch in value if ch.isprintable()).strip()
    return name[:80] or None


def _present(client_id: str, doc: dict[str, Any]) -> OAuthClientInformationFull:
    return OAuthClientInformationFull(
        client_id=client_id, redirect_uris=doc["redirectUris"], client_name=doc.get("name"),
        token_endpoint_auth_method="none", grant_types=["authorization_code", "refresh_token"],
        response_types=["code"], scope=" ".join(tokens.SCOPES),
    )


class OAuthProvider:
    """Implements the MCP SDK's OAuthAuthorizationServerProvider over MongoDB."""

    def __init__(self, runtime: Any, settings: Settings,
                 fetch: Callable[[str], Awaitable[dict[str, Any]]] = cimd.fetch) -> None:
        self.runtime = runtime
        self.settings = settings
        self.fetch = fetch
        self.issuer = settings.public_url
        self.resource = f"{settings.public_url}/mcp"

    def _db(self) -> Database:
        if self.runtime.database is None:
            raise RuntimeError("starting up")
        return self.runtime.database

    # ---- clients ---------------------------------------------------------

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        db = self._db()
        if len(client_id) > cimd.MAX_URL:
            return None
        doc = await db.oauth_clients.find_one({"_id": client_id})
        if client_id.startswith("https://"):
            now = utcnow()
            age = (now - doc["fetchedAt"]).total_seconds() if doc and doc.get("fetchedAt") else None
            if age is None or age > METADATA_FRESH_SECONDS:
                try:
                    found = await self.fetch(client_id)
                    if not all(valid_redirect(uri) for uri in found["redirect_uris"]) \
                            or len(found["redirect_uris"]) > MAX_REDIRECT_URIS:
                        raise cimd.ClientMetadataError("The client's redirect addresses are not acceptable.")
                except cimd.ClientMetadataError as error:
                    log.info("client metadata for %s unusable: %s", client_id, error)
                    if age is None or age > METADATA_KEEP_SECONDS:
                        return None
                else:
                    doc = {"_id": client_id, "source": "cimd", "name": clean_name(found["client_name"]),
                           "redirectUris": found["redirect_uris"], "fetchedAt": now,
                           "expiresAt": now + timedelta(seconds=METADATA_KEEP_SECONDS)}
                    await db.oauth_clients.replace_one({"_id": client_id}, doc, upsert=True)
        return _present(client_id, doc) if doc else None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        """Dynamic registration (RFC 7591), for assistants that do not publish a document."""
        uris = [str(uri) for uri in client_info.redirect_uris or []]
        if not uris or len(uris) > MAX_REDIRECT_URIS or not all(valid_redirect(uri) for uri in uris):
            raise RegistrationError("invalid_redirect_uri", "Redirect addresses must be https, a local http address, or an app link.")
        # Public clients only. The handler echoes this object back to the client, so
        # what is changed here is what the client is told.
        client_info.token_endpoint_auth_method = "none"
        client_info.client_secret = None
        client_info.client_secret_expires_at = None
        client_info.scope = " ".join(tokens.SCOPES)
        client_info.grant_types = ["authorization_code", "refresh_token"]
        now = utcnow()
        await self._db().oauth_clients.insert_one({
            "_id": client_info.client_id, "source": "dcr", "name": clean_name(client_info.client_name),
            "redirectUris": uris, "createdAt": now, "expiresAt": now + timedelta(days=CLIENT_DAYS),
        })

    # ---- the person approves ---------------------------------------------

    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        """Called with a valid client and redirect; parks the request and sends the
        person to the page where they sign in and approve it."""
        if params.resource and params.resource.rstrip("/") != self.resource:
            raise AuthorizeError("invalid_target", "That is not the Ekho server.")
        scopes = params.scopes or list(tokens.SCOPES)
        if not set(scopes) <= set(tokens.SCOPES):
            raise AuthorizeError("invalid_scope", "Ekho only offers read access to lectures.")
        db, now = self._db(), utcnow()
        request_id = secrets.token_urlsafe(32)
        await db.oauth_requests.insert_one({
            "_id": request_id, "clientId": client.client_id, "redirectUri": str(params.redirect_uri),
            "explicit": params.redirect_uri_provided_explicitly, "state": params.state, "scopes": scopes,
            "codeChallenge": params.code_challenge, "createdAt": now,
            "expiresAt": now + timedelta(minutes=REQUEST_MINUTES),
        })
        # A client in regular use does not expire.
        await db.oauth_clients.update_one(
            {"_id": client.client_id, "source": "dcr"}, {"$set": {"expiresAt": now + timedelta(days=CLIENT_DAYS)}})
        return f"{self.issuer}/oauth/consent?request={request_id}"

    async def pending(self, request_id: str) -> dict[str, Any] | None:
        """What a person is being asked to approve, or None if the link is stale."""
        request = await self._db().oauth_requests.find_one({"_id": request_id, "expiresAt": {"$gt": utcnow()}})
        if request is None:
            return None
        client = await self._db().oauth_clients.find_one({"_id": request["clientId"]})
        if client is None:
            return None
        redirect = urlsplit(request["redirectUri"])
        return {
            "id": request_id, "clientId": request["clientId"],
            "clientName": client.get("name") or urlsplit(request["clientId"]).hostname or "An assistant",
            "verified": client.get("source") == "cimd",        # its name comes from its own address
            "redirectTo": redirect.hostname or f"{redirect.scheme}:// app",
            "scopes": request["scopes"],
        }

    def _finish(self, request: dict[str, Any], **params: str | None) -> str:
        # RFC 9207: say which server answered, so a client can tell it from an impostor.
        return construct_redirect_uri(request["redirectUri"], state=request.get("state"), iss=self.issuer, **params)

    async def approve(self, request_id: str, user_id: str) -> str | None:
        """The person said yes. Returns where to send them (back to the assistant, with a code)."""
        db, now = self._db(), utcnow()
        # Taken, not read: a request can be approved once.
        request = await db.oauth_requests.find_one_and_delete({"_id": request_id, "expiresAt": {"$gt": now}})
        if request is None:
            return None
        client = await db.oauth_clients.find_one({"_id": request["clientId"]})
        if client is None:
            return None
        grant = await db.oauth_grants.find_one_and_update(
            {"userId": user_id, "clientId": request["clientId"]},
            {"$setOnInsert": {"_id": new_id("grt_"), "createdAt": now, "lastUsedAt": None},
             "$set": {"clientName": client.get("name") or request["clientId"], "scopes": request["scopes"],
                      "expiresAt": now + timedelta(days=self.settings.oauth_refresh_days)}},
            upsert=True, return_document=ReturnDocument.AFTER)
        code = CODE_PREFIX + secrets.token_urlsafe(32)
        await db.oauth_codes.insert_one({
            "_id": hash_token(code), "grantId": grant["_id"], "userId": user_id, "clientId": request["clientId"],
            "scopes": request["scopes"], "codeChallenge": request["codeChallenge"],
            "redirectUri": request["redirectUri"], "explicit": request["explicit"],
            "usedAt": None, "createdAt": now, "expiresAt": now + timedelta(minutes=CODE_MINUTES),
        })
        return self._finish(request, code=code)

    async def deny(self, request_id: str) -> str | None:
        request = await self._db().oauth_requests.find_one_and_delete({"_id": request_id})
        if request is None:
            return None
        return self._finish(request, error="access_denied", error_description="The person declined to connect.")

    # ---- the assistant collects ------------------------------------------

    async def load_authorization_code(self, client: OAuthClientInformationFull, authorization_code: str) -> AuthorizationCode | None:
        doc = await self._db().oauth_codes.find_one({"_id": hash_token(authorization_code)})
        if doc is None:
            return None
        if doc.get("usedAt") is not None:
            # A code that has already been exchanged, presented again: someone has a copy.
            await self.revoke_grant(doc["userId"], doc["grantId"])
            return None
        return AuthorizationCode(
            code=authorization_code, scopes=doc["scopes"], expires_at=doc["expiresAt"].timestamp(),
            client_id=doc["clientId"], code_challenge=doc["codeChallenge"], redirect_uri=doc["redirectUri"],
            redirect_uri_provided_explicitly=doc["explicit"], resource=self.resource, subject=doc["userId"])

    async def exchange_authorization_code(self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode) -> OAuthToken:
        doc = await self._db().oauth_codes.find_one_and_update(
            {"_id": hash_token(authorization_code.code), "usedAt": None}, {"$set": {"usedAt": utcnow()}})
        if doc is None:
            raise TokenError("invalid_grant", "That code has already been used.")
        return await self._issue(doc["grantId"], doc["userId"], doc["clientId"], doc["scopes"])

    async def _issue(self, grant_id: str, user_id: str, client_id: str, scopes: list[str]) -> OAuthToken:
        db, now = self._db(), utcnow()
        access, refresh = ACCESS_PREFIX + secrets.token_urlsafe(32), REFRESH_PREFIX + secrets.token_urlsafe(32)
        access_ttl = timedelta(minutes=self.settings.oauth_access_minutes)
        refresh_ttl = timedelta(days=self.settings.oauth_refresh_days)
        base = {"grantId": grant_id, "userId": user_id, "clientId": client_id, "scopes": scopes, "createdAt": now}
        await db.oauth_tokens.insert_many([
            {**base, "_id": hash_token(access), "kind": "access", "expiresAt": now + access_ttl, "touchedAt": None},
            {**base, "_id": hash_token(refresh), "kind": "refresh", "expiresAt": now + refresh_ttl, "usedAt": None},
        ])
        await db.oauth_grants.update_one({"_id": grant_id}, {"$set": {"expiresAt": now + refresh_ttl}})
        return OAuthToken(access_token=access, expires_in=int(access_ttl.total_seconds()),
                          scope=" ".join(scopes), refresh_token=refresh)

    async def load_refresh_token(self, client: OAuthClientInformationFull, refresh_token: str) -> RefreshToken | None:
        if not refresh_token.startswith(REFRESH_PREFIX):
            return None
        doc = await self._db().oauth_tokens.find_one({"_id": hash_token(refresh_token), "kind": "refresh"})
        if doc is None:
            return None
        if doc.get("usedAt") is not None:
            await self.revoke_grant(doc["userId"], doc["grantId"])      # replayed: treat as stolen
            return None
        return RefreshToken(token=refresh_token, client_id=doc["clientId"], scopes=doc["scopes"],
                            expires_at=int(doc["expiresAt"].timestamp()), resource=self.resource, subject=doc["userId"])

    async def exchange_refresh_token(self, client: OAuthClientInformationFull, refresh_token: RefreshToken, scopes: list[str]) -> OAuthToken:
        doc = await self._db().oauth_tokens.find_one_and_update(
            {"_id": hash_token(refresh_token.token), "kind": "refresh", "usedAt": None}, {"$set": {"usedAt": utcnow()}})
        if doc is None:
            raise TokenError("invalid_grant", "That refresh token has already been used.")
        return await self._issue(doc["grantId"], doc["userId"], doc["clientId"], scopes)

    # ---- using and ending a grant ----------------------------------------

    async def load_access_token(self, token: str) -> AccessToken | None:
        """Both kinds of credential open the MCP endpoint: tokens made by hand in the app
        (vft_) and tokens an assistant earned by signing in (vfo_)."""
        db = self._db()
        if tokens.looks_like_one(token):
            record = await tokens.verify(db, token)
            if record is None:
                return None
            return AccessToken(
                token=token, client_id=f"token:{record['_id']}", scopes=list(record["scopes"]),
                expires_at=int(record["expiresAt"].timestamp()), resource=self.resource, subject=record["userId"])
        if not token.startswith(ACCESS_PREFIX):
            return None
        now = utcnow()
        doc = await db.oauth_tokens.find_one({"_id": hash_token(token), "kind": "access", "expiresAt": {"$gt": now}})
        if doc is None:
            return None
        touched = doc.get("touchedAt")
        if touched is None or (now - touched).total_seconds() > _TOUCH_SECONDS:
            await db.oauth_tokens.update_one({"_id": doc["_id"]}, {"$set": {"touchedAt": now}})
            await db.oauth_grants.update_one({"_id": doc["grantId"]}, {"$set": {"lastUsedAt": now}})
        return AccessToken(
            token=token, client_id=doc["clientId"], scopes=doc["scopes"], expires_at=int(doc["expiresAt"].timestamp()),
            resource=self.resource, subject=doc["userId"], claims={"iss": self.issuer})

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        """RFC 7009: revoking either token ends the grant, so neither keeps working."""
        doc = await self._db().oauth_tokens.find_one({"_id": hash_token(token.token)})
        if doc is not None:
            await self.revoke_grant(doc["userId"], doc["grantId"])

    async def revoke_presented(self, token: str, client_id: str) -> None:
        """The holder of a token asks for it to be revoked. Unknown tokens, and tokens
        that belong to some other client, are ignored (RFC 7009 says to answer 200 either way)."""
        doc = await self._db().oauth_tokens.find_one({"_id": hash_token(token)})
        if doc is not None and doc["clientId"] == client_id:
            await self.revoke_grant(doc["userId"], doc["grantId"])

    async def revoke_grant(self, user_id: str, grant_id: str) -> bool:
        db = self._db()
        result = await db.oauth_grants.delete_one({"_id": grant_id, "userId": user_id})
        await db.oauth_tokens.delete_many({"grantId": grant_id, "userId": user_id})
        await db.oauth_codes.delete_many({"grantId": grant_id, "userId": user_id})
        return result.deleted_count == 1


async def list_grants(database: Database, user_id: str) -> list[dict[str, Any]]:
    """The assistants this person has let in by signing in, for the app to show."""
    cursor = database.oauth_grants.find({"userId": user_id, "expiresAt": {"$gt": utcnow()}}).sort("createdAt", -1)
    return [{"id": g["_id"], "name": g.get("clientName") or "An assistant", "scopes": g["scopes"],
             "createdAt": g["createdAt"], "lastUsedAt": g.get("lastUsedAt")} async for g in cursor]


async def delete_everything_for(database: Database, user_id: str) -> None:
    """With the account: every grant, token and code it has issued."""
    for collection in (database.oauth_grants, database.oauth_tokens, database.oauth_codes):
        await collection.delete_many({"userId": user_id})
