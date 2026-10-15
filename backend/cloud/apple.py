"""Verifying Sign in with Apple identity tokens. See oidc.py for what is checked."""
from __future__ import annotations

from backend.cloud.oidc import IdTokenVerifier, TokenError

APPLE_ISSUER = "https://appleid.apple.com"
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"


class AppleTokenError(TokenError):
    pass


class AppleVerifier(IdTokenVerifier):
    provider = "Apple"
    issuers = (APPLE_ISSUER,)
    keys_url = APPLE_KEYS_URL
    error = AppleTokenError
