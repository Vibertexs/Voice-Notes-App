"""Recordings: capture, playback, markers and re-transcription."""
from backend._router_imports import *  # noqa: F401,F403
from backend._router_imports import APIRouter

router = APIRouter()


@router.get("/api/lectures/{lecture_id}")
def read_lecture(lecture_id: str) -> dict[str, object]:
    return serialize_lecture(get_lecture(lecture_id), include_content=True)


@router.post("/api/lectures/{lecture_id}/markers", status_code=201)
def create_session_marker(lecture_id: str, marker: SessionMarkerCreate) -> dict[str, object]:
    get_lecture(lecture_id)
    marker_id = str(uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    label = clean_label(marker.label, "New topic", 120)
    with connect_database() as connection:
        connection.execute(
            """
            INSERT INTO session_markers (id, lecture_id, label, time_seconds, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (marker_id, lecture_id, label, marker.time_seconds, created_at),
        )
        row = connection.execute(
            "SELECT id, label, time_seconds, created_at FROM session_markers WHERE id = ?",
            (marker_id,),
        ).fetchone()
    return dict(row)


@router.delete("/api/lectures/{lecture_id}/markers/{marker_id}")
def delete_session_marker(lecture_id: str, marker_id: str) -> dict[str, str]:
    with connect_database() as connection:
        deleted = connection.execute(
            "DELETE FROM session_markers WHERE id = ? AND lecture_id = ?", (marker_id, lecture_id)
        ).rowcount
    if not deleted:
        raise HTTPException(status_code=404, detail="Topic marker not found.")
    return {"status": "deleted"}


@router.get("/api/lectures/{lecture_id}/audio")
def read_lecture_audio(lecture_id: str) -> FileResponse:
    row = get_lecture(lecture_id)
    audio_path = AUDIO_DIR / row["audio_filename"]
    if not audio_path.is_file():
        raise HTTPException(status_code=404, detail="The saved audio file is unavailable.")
    media_type, _ = mimetypes.guess_type(audio_path.name)
    return FileResponse(audio_path, media_type=media_type or "application/octet-stream")


@router.post("/api/lectures", status_code=201)
def create_lecture(
    audio: UploadFile = File(...),
    folder_id: str = Form(default=""),
    workspace_id: str = Form(default=""),
    create_workspace: bool = Form(default=False),
    title: str = Form(default=""),
    capture_notes: str = Form(default=""),
    model: str = Form(default=FINAL_TRANSCRIPTION_MODEL),
) -> dict[str, object]:
    # Final saved transcripts are always the quality-first local model.
    model = FINAL_TRANSCRIPTION_MODEL
    selected_workspace_id = workspace_id or None
    selected_workspace = get_workspace(selected_workspace_id) if selected_workspace_id else None
    selected_folder_id = selected_workspace["folder_id"] if selected_workspace else folder_id or None
    selected_folder = get_folder(selected_folder_id) if selected_folder_id else None
    suffix = Path(audio.filename or "recording.webm").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=415, detail="Upload a supported audio file.")
    if len(capture_notes) > 100_000:
        raise HTTPException(status_code=422, detail="Capture notes must be 100,000 characters or fewer.")

    created_at_datetime = datetime.now(timezone.utc)
    clean_title = clean_label(title, default_lecture_title(created_at_datetime), 180)
    capture_notes = capture_notes.strip()
    lecture_id = str(uuid4())
    audio_filename = f"{lecture_id}{suffix}"

    with tempfile.TemporaryDirectory(prefix="voice-notes-") as temp_dir:
        temporary_audio_path = Path(temp_dir) / f"recording{suffix}"
        total_bytes = 0
        with temporary_audio_path.open("wb") as destination:
            while chunk := audio.file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="The recording exceeds the 25 MB limit.")
                destination.write(chunk)
        if total_bytes == 0:
            raise HTTPException(status_code=400, detail="The recording was empty.")
        saved_audio_path = AUDIO_DIR / audio_filename
        shutil.copyfile(temporary_audio_path, saved_audio_path)

    note_body = capture_notes
    course = selected_folder["name"] if selected_folder else "Unfiled recordings"
    try:
        with connect_database() as connection:
            # A saved recording always belongs to a lecture page.  `create_workspace`
            # remains an accepted form field for older clients, but is no longer a
            # branch in the product model.
            if selected_workspace_id is None:
                selected_workspace_id = str(uuid4())
                connection.execute(
                    """
                    INSERT INTO workspaces (id, folder_id, title, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        selected_workspace_id,
                        selected_folder_id,
                        clean_title,
                        created_at_datetime.isoformat(),
                        created_at_datetime.isoformat(),
                    ),
                )
            if capture_notes:
                current_notes = connection.execute(
                    "SELECT note_body FROM workspace_notes WHERE workspace_id = ?",
                    (selected_workspace_id,),
                ).fetchone()
                merged_notes = append_capture_notes(
                    current_notes["note_body"] if current_notes else "",
                    capture_notes,
                    created_at_datetime,
                )
                connection.execute(
                    """
                    INSERT INTO workspace_notes (workspace_id, note_body, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(workspace_id) DO UPDATE SET
                        note_body = excluded.note_body,
                        updated_at = excluded.updated_at
                    """,
                    (selected_workspace_id, merged_notes, created_at_datetime.isoformat()),
                )
            connection.execute(
                """
                INSERT INTO lectures (
                    id, workspace_id, is_standalone, capture_notes_workspace_id, folder_id, course, title, created_at, audio_filename, model, transcript, note_body
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    lecture_id,
                    selected_workspace_id,
                    0,
                    selected_workspace_id if capture_notes else None,
                    selected_folder_id,
                    course,
                    clean_title,
                    created_at_datetime.isoformat(),
                    audio_filename,
                    model,
                    "",
                    note_body,
                ),
            )
            connection.execute(
                "UPDATE lectures SET transcription_status = 'pending' WHERE id = ?", (lecture_id,)
            )
            connection.execute(
                "UPDATE workspaces SET updated_at = ? WHERE id = ?",
                (created_at_datetime.isoformat(), selected_workspace_id),
            )
    except Exception:
        saved_audio_path.unlink(missing_ok=True)
        raise
    queue_transcription(lecture_id)
    return serialize_lecture(get_lecture(lecture_id), include_content=True)


@router.patch("/api/lectures/{lecture_id}")
def update_lecture(lecture_id: str, update: LectureUpdate) -> dict[str, object]:
    current = get_lecture(lecture_id)
    values = update.model_dump(exclude_unset=True)
    title = clean_label(values.get("title", current["title"]), "Untitled lecture", 180)
    note_body = values.get("note_body", current["note_body"])
    if not isinstance(note_body, str):
        raise HTTPException(status_code=400, detail="The note must be text.")
    folder_id = current["folder_id"]
    course = current["course"]
    if "folder_id" in values:
        folder_id = values["folder_id"] or None
        destination = get_folder(folder_id) if folder_id else None
        course = destination["name"] if destination else "Unfiled recordings"
    with connect_database() as connection:
        connection.execute(
            "UPDATE lectures SET title = ?, note_body = ?, folder_id = ?, course = ? WHERE id = ?",
            (title, note_body, folder_id, course, lecture_id),
        )
        if current["workspace_id"] and "folder_id" in values:
            connection.execute(
                "UPDATE workspaces SET folder_id = ?, updated_at = ? WHERE id = ?",
                (folder_id, datetime.now(timezone.utc).isoformat(), current["workspace_id"]),
            )
            connection.execute(
                "UPDATE lectures SET folder_id = ?, course = ? WHERE workspace_id = ?",
                (folder_id, course, current["workspace_id"]),
            )
    return serialize_lecture(get_lecture(lecture_id), include_content=True)


@router.post("/api/lectures/{lecture_id}/retranscribe")
def retranscribe_lecture(lecture_id: str) -> dict[str, object]:
    """Re-read saved audio so an older recording gains timed transcript lines."""
    row = get_lecture(lecture_id)
    audio_path = AUDIO_DIR / row["audio_filename"]
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="The audio for this recording is missing.")
    with connect_database() as connection:
        connection.execute(
            "UPDATE lectures SET model = ? WHERE id = ?", (FINAL_TRANSCRIPTION_MODEL, lecture_id)
        )
    queue_transcription(lecture_id)
    return serialize_lecture(get_lecture(lecture_id), include_content=True)


@router.delete("/api/lectures/{lecture_id}")
def delete_lecture(lecture_id: str) -> dict[str, str]:
    row = get_lecture(lecture_id)
    with connect_database() as connection:
        connection.execute("DELETE FROM session_markers WHERE lecture_id = ?", (lecture_id,))
        connection.execute("DELETE FROM transcript_segments WHERE lecture_id = ?", (lecture_id,))
        drop_from_search_index(connection, "transcript", lecture_id)
        connection.execute("DELETE FROM lectures WHERE id = ?", (lecture_id,))
    (AUDIO_DIR / row["audio_filename"]).unlink(missing_ok=True)
    return {"status": "deleted"}
