"""Fixtures for the cloud API tests.

These run against a real MongoDB - the one in MONGODB_URI - not a mock. What
is being tested is mostly how MongoDB behaves: unique indexes deciding races,
upserts turning into duplicate-key errors, validators refusing documents. A
fake would only test that the fake agrees with the code.

Each run gets its own database, voiceflow_test_<random>, dropped at the end.
Each test makes its own users, so tests never see each other's data.
"""
from __future__ import annotations

import asyncio
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

from backend.cloud.app import create_app
from backend.cloud.apple import APPLE_ISSUER, AppleVerifier
from backend.cloud.google import GoogleVerifier
from backend.cloud.config import Settings
from backend.cloud.email import MemorySender

APPLE_CLIENT_ID = "com.voiceflow.test"
GOOGLE_CLIENT_ID = "123456-web.apps.googleusercontent.com"
APPLE_KID = "test-key-1"
TEST_DB_PREFIX = "voiceflow_test_"


def _settings() -> Settings:
    try:
        return Settings(
            environment="test",
            mongodb_db=f"{TEST_DB_PREFIX}{uuid.uuid4().hex[:10]}",
            jwt_secret="test-secret-" + "x" * 40,
            apple_client_ids=[APPLE_CLIENT_ID],
            google_client_ids=[GOOGLE_CLIENT_ID],
            rate_limits_enabled=False,
            # The MCP endpoint: tokens are for this address, and httpx's test host is "test".
            public_url="http://localhost",
            # "auto" builds the Atlas index and uses regex until it is ready,
            # exactly as production does. Building one takes a minute or two,
            # so ordinary runs skip it.
            search_backend="auto" if os.environ.get("VOICEFLOW_TEST_ATLAS_SEARCH") else "regex",
        )
    except ValueError as error:
        pytest.skip(f"cloud tests need MONGODB_URI (in .env or the environment): {error}")


class FakeApple:
    """Stands in for an identity provider: a key pair, and tokens signed with it."""

    issuer = APPLE_ISSUER
    client_id = APPLE_CLIENT_ID

    def __init__(self) -> None:
        self.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        public = RSAAlgorithm.to_jwk(self.private_key.public_key(), as_dict=True)
        self.jwks = {"keys": [{**public, "kid": APPLE_KID, "alg": "RS256", "use": "sig"}]}

    async def fetch(self) -> dict[str, Any]:
        return self.jwks

    def token(self, sub: str, *, email: str | None = None, verified: Any = True,
              audience: str | None = None, nonce: str | None = None, kid: str = APPLE_KID,
              issuer: str | None = None) -> str:
        now = datetime.now(timezone.utc)
        claims: dict[str, Any] = {
            "iss": issuer or self.issuer, "aud": audience or self.client_id, "sub": sub,
            "iat": now, "exp": now + timedelta(minutes=10),
        }
        if email:
            claims.update(email=email, email_verified=verified)
        if nonce:
            claims["nonce"] = nonce
        return jwt.encode(claims, self.private_key, algorithm="RS256", headers={"kid": kid})


class FakeGoogle(FakeApple):
    issuer = "https://accounts.google.com"
    client_id = GOOGLE_CLIENT_ID


@pytest.fixture(scope="session")
def fake_apple() -> FakeApple:
    return FakeApple()


@pytest.fixture(scope="session")
def fake_google() -> FakeGoogle:
    return FakeGoogle()


@pytest.fixture(scope="session")
def mailbox() -> MemorySender:
    return MemorySender()


@pytest.fixture(scope="session")
async def app(fake_apple: FakeApple, fake_google: FakeGoogle, mailbox: MemorySender):
    settings = _settings()
    assert settings.mongodb_db.startswith(TEST_DB_PREFIX)
    application = create_app(
        settings,
        email_sender=mailbox,
        apple_verifier=AppleVerifier([APPLE_CLIENT_ID], fetch_keys=fake_apple.fetch),
        google_verifier=GoogleVerifier([GOOGLE_CLIENT_ID], fetch_keys=fake_google.fetch),
    )
    # The app's lifespan runs in a task of its own. The MCP transport opens an
    # anyio task group at startup, and anyio insists it is closed by the same
    # task that opened it; a session-scoped fixture is torn down by a different
    # one. (A real server starts and stops in one task, so this is only a
    # test-harness matter.)
    started, stop = asyncio.Event(), asyncio.Event()

    async def run_app():
        async with application.router.lifespan_context(application):
            started.set()
            await stop.wait()

    task = asyncio.create_task(run_app())
    await asyncio.wait_for(started.wait(), timeout=60)
    try:
        yield application
    finally:
        database = application.state.db
        # Belt and braces: only ever drop a database this run created.
        if database.db.name.startswith(TEST_DB_PREFIX):
            await database.client.drop_database(database.db.name)
        stop.set()
        await task


@pytest.fixture(scope="session")
async def client(app) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as http:
        yield http


@pytest.fixture
def db(app):
    return app.state.db


class Account:
    """A registered user, and helpers to call the API as them."""

    def __init__(self, client: httpx.AsyncClient, email: str, password: str, tokens: dict[str, Any]) -> None:
        self.client = client
        self.email = email
        self.password = password
        self.tokens = tokens

    @property
    def id(self) -> str:
        return self.tokens["user"]["id"]

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.tokens['accessToken']}"}

    async def get(self, path: str, **kwargs: Any) -> httpx.Response:
        return await self.client.get(path, headers=self.headers, **kwargs)

    async def post(self, path: str, json: Any = None, **kwargs: Any) -> httpx.Response:
        return await self.client.post(path, json=json, headers=self.headers, **kwargs)

    async def patch(self, path: str, json: Any = None) -> httpx.Response:
        return await self.client.patch(path, json=json, headers=self.headers)

    async def delete(self, path: str, json: Any = None) -> httpx.Response:
        return await self.client.request("DELETE", path, json=json, headers=self.headers)

    async def sync(self, device: str, cursor: str | None = None, **changes: list[dict]) -> dict[str, Any]:
        response = await self.post("/v1/sync", {"deviceId": device, "cursor": cursor, "changes": changes})
        assert response.status_code == 200, response.text
        return response.json()


@pytest.fixture
def make_account(client):
    async def make(password: str = "correct horse battery") -> Account:
        email = f"user-{uuid.uuid4().hex[:12]}@example.com"
        response = await client.post("/v1/auth/register", json={"email": email, "password": password})
        assert response.status_code == 201, response.text
        return Account(client, email, password, response.json())
    return make


@pytest.fixture
async def account(make_account) -> Account:
    return await make_account()


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def now_iso(offset_seconds: float = 0) -> str:
    return iso(datetime.now(timezone.utc) + timedelta(seconds=offset_seconds))


def unique_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:16]}"


def wait_ms(ms: int = 5) -> None:
    """Lets the millisecond clock tick, where a test needs two stamps to differ."""
    time.sleep(ms / 1000)
