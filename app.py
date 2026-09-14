"""Class Notes: a private, local lecture library.

This module only assembles the application. Behaviour lives in `backend/`:
config and database access, a service layer for transcription, search, files
and the local assistant, and one router per part of the product.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from backend.config import FRONTEND_DIST
from backend.database import connect_database, initialize_database
from backend.routers import ai, folders, lectures, library, materials, search, workspaces
from backend.services.search_index import rebuild_search_index
from backend.services.transcription_jobs import TRANSCRIBER, queue_transcription


def resume_unfinished_transcriptions() -> list[str]:
    """Pick up anything a restart interrupted, from its last committed line."""
    with connect_database() as connection:
        indexed = connection.execute(
            "SELECT COUNT(*) AS total FROM search_index"
        ).fetchone()["total"]
        if not indexed:
            rebuild_search_index(connection)
        unfinished = [
            row["id"]
            for row in connection.execute(
                "SELECT id FROM lectures WHERE transcription_status IN ('pending', 'running')"
            ).fetchall()
        ]
        for lecture_id in unfinished:
            reached = connection.execute(
                "SELECT COALESCE(MAX(end_seconds), 0) AS reached"
                " FROM transcript_segments WHERE lecture_id = ?",
                (lecture_id,),
            ).fetchone()["reached"]
            if reached:
                connection.execute(
                    "UPDATE lectures SET transcription_resume_from = ? WHERE id = ?",
                    (reached, lecture_id),
                )
    return unfinished


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    for lecture_id in resume_unfinished_transcriptions():
        queue_transcription(lecture_id)
    yield
    TRANSCRIBER.shutdown(wait=False, cancel_futures=True)


app = FastAPI(title="Class Notes", lifespan=lifespan)

for module in (library, folders, workspaces, lectures, materials, ai, search):
    app.include_router(module.router)

if (FRONTEND_DIST / "assets").is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=FRONTEND_DIST / "assets"),
        name="frontend-assets",
    )
