"""The cloud API as an ASGI app.

`create_app()` builds it; `cloud_app.py` at the repo root is what uvicorn runs.
The factory takes its collaborators as arguments so tests can hand it a test
database, an email sender that records instead of sending, and Apple keys they
generated themselves.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.cloud import routes_auth, routes_library
from backend.cloud.apple import AppleVerifier
from backend.cloud.config import Settings, get_settings
from backend.cloud.database import open_database, prepare_database
from backend.cloud.email import EmailSender, ResendSender
from backend.cloud.library import Search

log = logging.getLogger("voiceflow.api")


class BodyLimit:
    """Refuses request bodies over a size limit, before they are read.

    Checking Content-Length is not enough on its own - a chunked upload has
    none - so the body is also counted as it streams in.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            await JSONResponse({"detail": TOO_LARGE}, status_code=413)(scope, receive, send)
            return

        seen = 0

        async def counted() -> Message:
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:
                    # An HTTPException, because FastAPI passes those through
                    # body parsing untouched and turns anything else into 400.
                    raise HTTPException(status_code=413, detail=TOO_LARGE)
            return message

        await self.app(scope, counted, send)


TOO_LARGE = "That request is too large."


class SecurityHeaders:
    """Headers that cost nothing and close off whole classes of mistakes.

    This is a JSON API, so it never needs to be framed, sniffed or cached.
    """

    HEADERS = [
        (b"x-content-type-options", b"nosniff"),
        (b"x-frame-options", b"DENY"),
        (b"referrer-policy", b"no-referrer"),
        (b"cache-control", b"no-store"),
    ]

    def __init__(self, app: ASGIApp, hsts: bool) -> None:
        self.app = app
        self.extra = self.HEADERS + ([(b"strict-transport-security", b"max-age=31536000")] if hsts else [])

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                names = {name for name, _ in message.get("headers", [])}
                message["headers"] = list(message.get("headers", [])) + [
                    header for header in self.extra if header[0] not in names
                ]
            await send(message)

        await self.app(scope, receive, with_headers)


def create_app(
    settings: Settings | None = None,
    *,
    email_sender: EmailSender | None = None,
    apple_verifier: AppleVerifier | None = None,
) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        database = open_database(settings)
        try:
            # Startup fails loudly if the database is unreachable. A server
            # that starts anyway just fails every request later, more quietly.
            prepared = await prepare_database(database, settings)
            log.info("database ready: %s, search index: %s", settings.mongodb_db, prepared["search"])
            app.state.db = database
            app.state.settings = settings
            app.state.email = email_sender or ResendSender(settings)
            app.state.apple = apple_verifier or AppleVerifier(settings.apple_client_ids)
            app.state.search = Search(database, settings)
            yield
        finally:
            await database.close()

    app = FastAPI(
        title="VoiceFlow Cloud API",
        version="1.0.0",
        summary="Accounts and sync for VoiceFlow. Transcripts and metadata only - audio never leaves the phone.",
        lifespan=lifespan,
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
    )

    @app.exception_handler(Exception)
    async def unexpected(request: Request, error: Exception) -> JSONResponse:
        # Logged in full here; the client gets nothing it could learn from.
        log.exception("unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse({"detail": "Something went wrong on our side. Try again."}, status_code=500)

    @app.get("/healthz", tags=["health"])
    async def healthz() -> dict[str, Any]:
        """The process is up. Says nothing about the database, on purpose:
        a platform restarting the server because Atlas blinked would help
        nobody."""
        return {"ok": True}

    @app.get("/readyz", tags=["health"])
    async def readyz(request: Request) -> JSONResponse:
        try:
            await request.app.state.db.ping()
        except Exception:  # noqa: BLE001 - any failure means "not ready"
            return JSONResponse({"ok": False, "database": "unreachable"}, status_code=503)
        return JSONResponse({"ok": True, "database": "ok"})

    app.include_router(routes_auth.router)
    app.include_router(routes_library.router)

    # Outermost last: the body limit runs before anything reads the body.
    if settings.allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.allowed_origins,
            allow_methods=["GET", "POST", "PATCH", "DELETE"],
            allow_headers=["Authorization", "Content-Type"],
        )
    app.add_middleware(SecurityHeaders, hsts=settings.production)
    app.add_middleware(BodyLimit, max_bytes=settings.max_body_bytes)
    return app
