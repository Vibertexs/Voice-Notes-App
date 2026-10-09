"""Sync, and the library read and written directly."""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Path, Query, Request, Response, status

from backend.cloud import library, sync
from backend.cloud.common import ID_PATTERN, as_utc, utcnow
from backend.cloud.deps import DatabaseDep, PrincipalDep
from backend.cloud.models import FolderCreate, FolderUpdate, RecordingUpdate, SyncRequest, SyncResult

router = APIRouter(prefix="/v1")

DocId = Annotated[str, Path(pattern=ID_PATTERN)]


@router.post("/sync", response_model=SyncResult, tags=["sync"])
async def run_sync(body: SyncRequest, principal: PrincipalDep, database: DatabaseDep) -> SyncResult:
    """Push this device's changes, then pull everyone else's.

    Push comes first so a reply never carries back a change this request
    is about to overwrite. If `more` is true, call again straight away with
    the returned cursor (and no changes) to fetch the next page.
    """
    applied, rejected = await sync.push(database, principal.user_id, body.device_id, body.changes)
    changes, cursor, more = await sync.pull(database, principal.user_id, body.device_id, body.cursor)
    return SyncResult(
        cursor=cursor, more=more, server_time=utcnow(),
        applied=applied, rejected=rejected, changes=changes,
    )


# ---------------------------------------------------------------------------
# Folders
# ---------------------------------------------------------------------------

@router.get("/folders", tags=["library"])
async def list_folders(principal: PrincipalDep, database: DatabaseDep, archived: bool = False) -> dict[str, Any]:
    return {"folders": await library.list_folders(database, principal.user_id, archived=archived)}


@router.post("/folders", status_code=status.HTTP_201_CREATED, tags=["library"])
async def create_folder(body: FolderCreate, principal: PrincipalDep, database: DatabaseDep) -> dict[str, Any]:
    return await library.create_folder(database, principal.user_id, body)


@router.patch("/folders/{folder_id}", tags=["library"])
async def update_folder(folder_id: DocId, body: FolderUpdate, principal: PrincipalDep, database: DatabaseDep) -> dict[str, Any]:
    return await library.update_folder(database, principal.user_id, folder_id, body)


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["library"])
async def delete_folder(folder_id: DocId, principal: PrincipalDep, database: DatabaseDep) -> Response:
    await library.delete_folder(database, principal.user_id, folder_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Recordings
# ---------------------------------------------------------------------------

@router.get("/recordings", tags=["library"])
async def list_recordings(
    principal: PrincipalDep, database: DatabaseDep,
    folder: Annotated[str | None, Query(max_length=64, description='A folder id, or "inbox"')] = None,
    before: Annotated[datetime | None, Query(description="createdAt of the last item of the previous page")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict[str, Any]:
    recordings = await library.list_recordings(
        database, principal.user_id, folder_id=folder, before=as_utc(before), limit=limit)
    return {"recordings": recordings, "next": recordings[-1]["createdAt"] if len(recordings) == limit else None}


@router.get("/recordings/{recording_id}", tags=["library"])
async def get_recording(recording_id: DocId, principal: PrincipalDep, database: DatabaseDep) -> dict[str, Any]:
    return await library.get_recording(database, principal.user_id, recording_id)


@router.patch("/recordings/{recording_id}", tags=["library"])
async def update_recording(
    recording_id: DocId, body: RecordingUpdate, principal: PrincipalDep, database: DatabaseDep,
) -> dict[str, Any]:
    return await library.update_recording(database, principal.user_id, recording_id, body)


@router.delete("/recordings/{recording_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["library"])
async def delete_recording(recording_id: DocId, principal: PrincipalDep, database: DatabaseDep) -> Response:
    await library.delete_recording(database, principal.user_id, recording_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/recordings/{recording_id}/transcript", tags=["library"])
async def get_transcript(
    recording_id: DocId, principal: PrincipalDep, database: DatabaseDep,
    start: Annotated[float | None, Query(ge=0, description="Seconds into the recording")] = None,
    end: Annotated[float | None, Query(ge=0)] = None,
    words: bool = False,
) -> dict[str, Any]:
    return await library.get_transcript(
        database, principal.user_id, recording_id, start=start, end=end, words=words)


@router.get("/search", tags=["library"])
async def search(
    request: Request, principal: PrincipalDep,
    q: Annotated[str, Query(min_length=1, max_length=200)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> dict[str, Any]:
    return await request.app.state.search.run(principal.user_id, q, limit)
