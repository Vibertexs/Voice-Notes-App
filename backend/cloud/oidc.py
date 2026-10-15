"""Verifying identity tokens from an OpenID Connect provider (Apple, Google).

The phone gets a signed JWT from the provider and sends it here. Trusting its
claims without checking would let anyone type in any provider user id, so this
checks what each provider's own documentation asks for:

  - the signature, against the provider's published public keys (RS256 only)
  - the issuer is the provider
  - the audience is one of OUR client ids, so a token minted for some other app
    cannot sign in here
  - it has not expired
  - the nonce, when the client sent one, matches

Providers rotate their keys. They are cached for a day and refetched
immediately if a token arrives signed with a key id the cache has not seen.
"""
from __future__ import annotations

import hashlib
import time
from typing import Any, Awaitable, Callable

import httpx
import jwt
from jwt import PyJWKSet

KEY_CACHE_SECONDS = 24 * 3600


class TokenError(Exception):
    pass


def fetcher(url: str) -> Callable[[], Awaitable[dict[str, Any]]]:
    async def fetch() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(url)
            response.raise_for_status()
            return response.json()
    return fetch


class IdTokenVerifier:
    provider = "the provider"
    issuers: tuple[str, ...] = ()
    keys_url = ""
    error = TokenError

    def __init__(
        self,
        client_ids: list[str],
        fetch_keys: Callable[[], Awaitable[dict[str, Any]]] | None = None,
    ) -> None:
        self.client_ids = list(client_ids)
        self._fetch_keys = fetch_keys or fetcher(self.keys_url)
        self._keys: PyJWKSet | None = None
        self._fetched_at = 0.0

    @property
    def enabled(self) -> bool:
        return bool(self.client_ids)

    def _fail(self, message: str) -> Exception:
        return self.error(message)

    async def _key_for(self, kid: str) -> Any:
        stale = time.monotonic() - self._fetched_at > KEY_CACHE_SECONDS
        for attempt in range(2):
            if self._keys is None or stale or attempt == 1:
                self._keys = PyJWKSet.from_dict(await self._fetch_keys())
                self._fetched_at = time.monotonic()
                stale = False
            for key in self._keys.keys:
                if key.key_id == kid:
                    return key.key
        raise self._fail(f"{self.provider} did not sign this token.")

    async def verify(self, identity_token: str, nonce: str | None = None) -> dict[str, Any]:
        try:
            header = jwt.get_unverified_header(identity_token)
        except jwt.InvalidTokenError as error:
            raise self._fail(f"That is not a {self.provider} identity token.") from error
        if header.get("alg") != "RS256" or "kid" not in header:
            raise self._fail(f"That is not a {self.provider} identity token.")

        key = await self._key_for(header["kid"])
        try:
            # PyJWT checks one issuer; providers with two spellings of theirs
            # (Google) are checked against the list below instead.
            claims = jwt.decode(
                identity_token,
                key,
                algorithms=["RS256"],
                audience=self.client_ids,
                options={"require": ["sub", "aud", "iss", "exp", "iat"]},
            )
        except jwt.InvalidTokenError as error:
            raise self._fail(f"{self.provider} sign-in could not be verified.") from error
        if claims.get("iss") not in self.issuers:
            raise self._fail(f"{self.provider} sign-in could not be verified.")

        if nonce is not None:
            # Clients either pass the provider the raw nonce or its SHA-256
            # (the common pattern); accept a token carrying either form.
            expected = {nonce, hashlib.sha256(nonce.encode()).hexdigest()}
            if claims.get("nonce") not in expected:
                raise self._fail(f"{self.provider} sign-in could not be verified.")
        return claims
