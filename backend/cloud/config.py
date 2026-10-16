"""Every setting the cloud API reads, validated once at startup.

Configuration comes from environment variables (and a local .env file in
development). A misconfigured production server should refuse to start rather
than start and fail on the first request, so the checks that matter - a real
signing secret, a database to talk to - happen here.
"""
from __future__ import annotations

import secrets
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"

    # ---- database -------------------------------------------------------
    mongodb_uri: str = ""
    mongodb_db: str = "voiceflow"

    # ---- tokens ---------------------------------------------------------
    jwt_secret: str = ""
    jwt_issuer: str = "voiceflow"
    access_token_minutes: int = 15
    refresh_token_days: int = 30

    # ---- accounts -------------------------------------------------------
    # Sign in with Apple is accepted only for these audiences: the iOS bundle
    # id, and the Services ID if there is ever a web sign-in. Empty = off.
    apple_client_ids: Annotated[list[str], NoDecode] = []
    # Sign in with Google: the *Web* OAuth client id (the audience of the tokens
    # the Android library produces). Empty = off.
    google_client_ids: Annotated[list[str], NoDecode] = []
    password_reset_minutes: int = 15
    rate_limits_enabled: bool = True

    # ---- email (password reset codes) -----------------------------------
    resend_api_key: str = ""
    email_from: str = "VoiceFlow <onboarding@resend.dev>"

    # ---- assistants (MCP) -----------------------------------------------
    # The address this server is reached at from outside, e.g. https://api.example.com.
    # It is the MCP server's identity: access tokens are issued for exactly
    # `<public_url>/mcp`, and the Host header is checked against it. Empty turns
    # the MCP endpoint off.
    public_url: str = ""
    access_token_days: int = 365

    # ---- HTTP -----------------------------------------------------------
    # The phone app talks to this server from native code, which CORS does
    # not apply to. Origins are only needed for a future browser client.
    allowed_origins: Annotated[list[str], NoDecode] = []
    max_body_bytes: int = 8 * 1024 * 1024
    docs_enabled: bool = True

    # ---- data -----------------------------------------------------------
    search_backend: Literal["auto", "atlas", "regex"] = "auto"
    tombstone_days: int = 180

    @field_validator("allowed_origins", "apple_client_ids", "google_client_ids", mode="before")
    @classmethod
    def _comma_list(cls, value: object) -> object:
        """Accept `a.com,b.com` from an env var, not just a JSON array."""
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def _check(self) -> "Settings":
        if not self.mongodb_uri:
            raise ValueError("MONGODB_URI is required")
        self.public_url = self.public_url.strip().rstrip("/")
        if self.public_url and not self.public_url.startswith(("https://", "http://")):
            raise ValueError("PUBLIC_URL must start with https:// (or http:// for local development)")
        if self.production and self.public_url.startswith("http://"):
            raise ValueError("PUBLIC_URL must be https:// in production")
        if self.environment == "production":
            if len(self.jwt_secret) < 32:
                raise ValueError(
                    "JWT_SECRET must be at least 32 characters in production. "
                    "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
                )
        elif not self.jwt_secret:
            # Development only: a throwaway secret, so the server starts with no
            # setup. Every token it issues stops working when it restarts.
            self.jwt_secret = secrets.token_urlsafe(48)
        return self

    @property
    def production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
