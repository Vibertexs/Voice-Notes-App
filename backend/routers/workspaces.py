"""Lecture pages: the notes, the recordings on them, and the study guide."""
from backend._router_imports import *  # noqa: F401,F403
from backend._router_imports import APIRouter

router = APIRouter()


@router.post("/api/workspaces", status_code=201)
def create_workspace(workspace: WorkspaceCreate) -> dict[str, object]:
    folder_id = workspace.folder_id or None
    if folder_id:
        get_folder(folder_id)
    created_at = datetime.now(timezone.utc)
    title = clean_label(workspace.title or "", default_lecture_title(created_at), 180)
    workspace_id = str(uuid4())
    with connect_database() as connection:
        connection.execute(
            """
            INSERT INTO workspaces (id, folder_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (workspace_id, folder_id, title, created_at.isoformat(), created_at.isoformat()),
        )
    return serialize_workspace(get_workspace(workspace_id))


@router.get("/api/workspaces/{workspace_id}")
def read_workspace(workspace_id: str) -> dict[str, object]:
    return serialize_workspace(get_workspace(workspace_id), include_sessions=True)


@router.patch("/api/workspaces/{workspace_id}")
def update_workspace(workspace_id: str, update: WorkspaceUpdate) -> dict[str, object]:
    current = get_workspace(workspace_id)
    values = update.model_dump(exclude_unset=True)
    title = clean_label(values.get("title", current["title"]), "Untitled lecture", 180)
    folder_id = current["folder_id"]
    if "folder_id" in values:
        folder_id = values["folder_id"] or None
        if folder_id:
            get_folder(folder_id)
    updated_at = datetime.now(timezone.utc).isoformat()
    with connect_database() as connection:
        connection.execute(
            "UPDATE workspaces SET title = ?, folder_id = ?, updated_at = ? WHERE id = ?",
            (title, folder_id, updated_at, workspace_id),
        )
        destination = get_folder(folder_id) if folder_id else None
        course = destination["name"] if destination else "Unfiled recordings"
        connection.execute(
            "UPDATE lectures SET folder_id = ?, course = ? WHERE workspace_id = ?",
            (folder_id, course, workspace_id),
        )
    return serialize_workspace(get_workspace(workspace_id))


@router.delete("/api/workspaces/{workspace_id}")
def delete_workspace(workspace_id: str) -> dict[str, object]:
    """Delete a lecture note together with every recording saved inside it."""
    get_workspace(workspace_id)
    with connect_database() as connection:
        recordings = connection.execute(
            "SELECT id, audio_filename FROM lectures WHERE workspace_id = ?", (workspace_id,)
        ).fetchall()
        for recording in recordings:
            connection.execute(
                "DELETE FROM session_markers WHERE lecture_id = ?", (recording["id"],)
            )
            connection.execute(
                "DELETE FROM transcript_segments WHERE lecture_id = ?", (recording["id"],)
            )
            drop_from_search_index(connection, "transcript", recording["id"])
        connection.execute("DELETE FROM lectures WHERE workspace_id = ?", (workspace_id,))
        connection.execute("DELETE FROM workspace_notes WHERE workspace_id = ?", (workspace_id,))
        drop_from_search_index(connection, "note", workspace_id)
        connection.execute("DELETE FROM workspace_study_notes WHERE workspace_id = ?", (workspace_id,))
        connection.execute("DELETE FROM workspace_ai_notes WHERE workspace_id = ?", (workspace_id,))
        connection.execute("DELETE FROM workspace_ai_messages WHERE workspace_id = ?", (workspace_id,))
        connection.execute("UPDATE materials SET workspace_id = NULL WHERE workspace_id = ?", (workspace_id,))
        connection.execute("DELETE FROM workspaces WHERE id = ?", (workspace_id,))
    # Audio is removed only once the rows pointing at it are gone.
    for recording in recordings:
        (AUDIO_DIR / recording["audio_filename"]).unlink(missing_ok=True)
    return {"status": "deleted", "deleted_recording_count": len(recordings)}


@router.put("/api/workspaces/{workspace_id}/notes")
def save_workspace_notes(workspace_id: str, update: WorkspaceNotesUpdate) -> dict[str, object]:
    get_workspace(workspace_id)
    saved_at = datetime.now(timezone.utc).isoformat()
    with connect_database() as connection:
        connection.execute(
            """
            INSERT INTO workspace_notes (workspace_id, note_body, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(workspace_id) DO UPDATE SET
                note_body = excluded.note_body,
                updated_at = excluded.updated_at
            """,
            (workspace_id, update.note_body, saved_at),
        )
        index_workspace_note(connection, workspace_id)
        connection.execute(
            "UPDATE workspaces SET updated_at = ? WHERE id = ?", (saved_at, workspace_id)
        )
    return {"status": "saved", "updated_at": saved_at}


@router.put("/api/workspaces/{workspace_id}/study-notes")
def save_workspace_study_notes(
    workspace_id: str, update: WorkspaceStudyNotesUpdate
) -> dict[str, object]:
    get_workspace(workspace_id)
    saved_at = datetime.now(timezone.utc).isoformat()
    with connect_database() as connection:
        connection.execute(
            """
            INSERT INTO workspace_study_notes (workspace_id, note_body, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(workspace_id) DO UPDATE SET
                note_body = excluded.note_body,
                updated_at = excluded.updated_at
            """,
            (workspace_id, update.note_body, saved_at),
        )
        connection.execute(
            "UPDATE workspaces SET updated_at = ? WHERE id = ?", (saved_at, workspace_id)
        )
    return {"status": "saved", "updated_at": saved_at}


@router.post("/api/workspaces/{workspace_id}/study-notes/generate")
def generate_workspace_study_notes(workspace_id: str) -> dict[str, object]:
    workspace = get_workspace(workspace_id)
    with connect_database() as connection:
        notes = connection.execute(
            "SELECT note_body FROM workspace_notes WHERE workspace_id = ?", (workspace_id,)
        ).fetchone()
        sessions = connection.execute(
            "SELECT transcript FROM lectures WHERE workspace_id = ? ORDER BY created_at ASC",
            (workspace_id,),
        ).fetchall()
    draft = build_local_study_draft(
        workspace["title"],
        notes["note_body"] if notes else "",
        [session["transcript"] for session in sessions],
    )
    saved_at = datetime.now(timezone.utc).isoformat()
    with connect_database() as connection:
        connection.execute(
            """
            INSERT INTO workspace_study_notes (workspace_id, note_body, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(workspace_id) DO UPDATE SET
                note_body = excluded.note_body,
                updated_at = excluded.updated_at
            """,
            (workspace_id, draft, saved_at),
        )
        connection.execute(
            "UPDATE workspaces SET updated_at = ? WHERE id = ?", (saved_at, workspace_id)
        )
    return {"note_body": draft, "updated_at": saved_at, "mode": "local_draft"}
