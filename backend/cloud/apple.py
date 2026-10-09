"""Verifying Sign in with Apple identity tokens.

The phone gets a signed JWT from Apple and sends it here. Trusting its claims
without checking would let anyone type in any Apple user id, so this verifies
what Apple's own documentation asks for:

  - the signature, against Apple's published public keys (RS256 only)
  - the issuer is https://appleid.apple.com
  - the audience is one of OUR client ids (the iOS bundle id), so a token
    minted for some other app cannot sign in here
  - it has not expired
  - the nonce, when the client sent one, matches

Apple rotates its keys. They are cached for a day and refetched immediately if
a token arrives signed with a key id the cache has not seen.
"""
from __future__ import annotations

import hashlib
import time
from typing import Any, Awaitable, Callable

import httpx
import jwt
from jwt import PyJWKSet

APPLE_ISSUER = "https://appleid.apple.com"
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
KEY_CACHE_SECONDS = 24 * 3600


class AppleTokenError(Exception):
    pass


async def _fetch_apple_keys() -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(APPLE_KEYS_URL)
        response.raise_for_status()
        return response.json()


class AppleVerifier:
    def __init__(
        self,
        client_ids: list[str],
        fetch_keys: Callable[[], Awaitable[dict[str, Any]]] = _fetch_apple_keys,
    ) -> None:
        self.client_ids = list(client_ids)
        self._fetch_keys = fetch_keys
        self._keys: PyJWKSet | None = None
        self._fetched_at = 0.0

    @property
    def enabled(self) -> bool:
        return bool(self.client_ids)

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
        raise AppleTokenError("Apple did not sign this token.")

    async def verify(self, identity_token: str, nonce: str | None = None) -> dict[str, Any]:
        try:
            header = jwt.get_unverified_header(identity_token)
        except jwt.InvalidTokenError as error:
            raise AppleTokenError("That is not an Apple identity token.") from error
        if header.get("alg") != "RS256" or "kid" not in header:
            raise AppleTokenError("That is not an Apple identity token.")

        key = await self._key_for(header["kid"])
        try:
            claims = jwt.decode(
                identity_token,
                key,
                algorithms=["RS256"],
                audience=self.client_ids,
                issuer=APPLE_ISSUER,
                options={"require": ["sub", "aud", "iss", "exp", "iat"]},
            )
        except jwt.InvalidTokenError as error:
            raise AppleTokenError("Apple sign-in could not be verified.") from error

        if nonce is not None:
            # Clients either pass Apple the raw nonce or its SHA-256 (the
            # common pattern); accept a token carrying either form.
            expected = {nonce, hashlib.sha256(nonce.encode()).hexdigest()}
            if claims.get("nonce") not in expected:
                raise AppleTokenError("Apple sign-in could not be verified.")
        return claims
