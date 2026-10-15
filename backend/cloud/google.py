"""Verifying Google Sign-In ID tokens. See oidc.py for what is checked.

The audience is the *Web* OAuth client id, not the Android one: the Android
sign-in library is asked for a token on behalf of the Web client, and that is
what Google stamps into `aud`. The Android client id only proves to Google
which app is asking.
"""
from __future__ import annotations

from backend.cloud.oidc import IdTokenVerifier, TokenError

# Google signs with both spellings of its own name.
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs"


class GoogleTokenError(TokenError):
    pass


class GoogleVerifier(IdTokenVerifier):
    provider = "Google"
    issuers = GOOGLE_ISSUERS
    keys_url = GOOGLE_KEYS_URL
    error = GoogleTokenError
