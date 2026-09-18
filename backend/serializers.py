"""Turns database rows into the JSON shapes the client expects."""
from __future__ import annotations

import sqlite3

from backend.config import MAX_MATERIAL_EXTRACTED_CHARS
from backend.database import connect_database
from backend.services.segments import read_transcript_segments


def serialize_ai_message(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": row["id"],
        "role": row["role"],
        "content": row["content"],
        "model": row["model"],
        "created_at": row["created_at"],
    }


def serialize_folder(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": row["id"],
        "name": row["name"],
        "parent_id": row["parent_id"],
        "color": row["color"],
        "icon": row["icon"] if "icon" in row.keys() else None,
        "created_at": row["created_at"],
        "archived": bool(row["archived_at"]) if "archived_at" in row.keys() else False,
        # Present only when the query asked for them (the library grid does).
        "lecture_count": row["lecture_count"] if "lecture_count" in row.keys() else None,
        "recording_count": row["recording_count"] if "recording_count" in row.keys() else None,
        "file_count": row["file_count"] if "file_count" in row.keys() else None,
        "updated_at": row["updated_at"] if "updated_at" in row.keys() else None,
    }


def serialize_material(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": row["id"],
        "workspace_id": row["workspace_id"],
        "folder_id": row["folder_id"],
        "original_filename": row["original_filename"],
        "mime_type": row["mime_type"],
        "size_bytes": row["size_bytes"],
        "created_at": row["created_at"],
        "ai_status": row["extraction_status"],
        "ai_message": row["extraction_message"],
        "extracted_char_count": len(row["extracted_text"]),
        "download_url": f"/api/materials/{row['id']}/file",
    }


def serialize_lecture(row: sqlite3.Row, *, include_content: bool) -> dict[str, object]:
    result: dict[str, object] = {
        "id": row["id"],
        "workspace_id": row["workspace_id"],
        "folder_id": row["folder_id"],
        "course": row["course"],
        "title": row["title"],
        "created_at": row["created_at"],
        "model": row["model"],
        "audio_url": f"/api/lectures/{row['id']}/audio",
        "transcription_status": (
            row["transcription_status"] if "transcription_status" in row.keys() else "ready"
        ),
        "transcription_progress": (
            row["transcription_progress"] if "transcription_progress" in row.keys() else 1
        ),
        "transcription_eta_seconds": (
            row["transcription_eta_seconds"] if "transcription_eta_seconds" in row.keys() else None
        ),
        "duration_seconds": (
            row["duration_seconds"] if "duration_seconds" in row.keys() else None
        ),
    }
    if include_content:
        result["transcript"] = row["transcript"]
        result["note_body"] = row["note_body"]
        with connect_database() as connection:
            markers = connection.execute(
                """
                SELECT id, label, time_seconds, created_at
                FROM session_markers
                WHERE lecture_id = ?
                ORDER BY time_seconds ASC, created_at ASC
                """,
                (row["id"],),
            ).fetchall()
            result["segments"] = read_transcript_segments(connection, row["id"])
        result["markers"] = [dict(marker) for marker in markers]
    return result


def serialize_workspace(row: sqlite3.Row, *, include_sessions: bool = False) -> dict[str, object]:
    result: dict[str, object] = {
        "id": row["id"],
        "folder_id": row["folder_id"],
        "title": row["title"],
        "favorite": bool(row["favorite"]) if "favorite" in row.keys() else False,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "session_count": row["session_count"] if "session_count" in row.keys() else 0,
        # Present only when the listing asked for it; a single workspace does
        # not need it because its own recordings carry their durations.
        "duration_seconds": row["duration_seconds"] if "duration_seconds" in row.keys() else None,
    }
    if include_sessions:
        with connect_database() as connection:
            sessions = connection.execute(
                "SELECT * FROM lectures WHERE workspace_id = ? ORDER BY created_at DESC", (row["id"],)
            ).fetchall()
            notes = connection.execute(
                "SELECT note_body, updated_at FROM workspace_notes WHERE workspace_id = ?",
                (row["id"],),
            ).fetchone()
            study_notes = connection.execute(
                "SELECT note_body, updated_at FROM workspace_study_notes WHERE workspace_id = ?",
                (row["id"],),
            ).fetchone()
            ai_notes = connection.execute(
                "SELECT note_body, model, updated_at FROM workspace_ai_notes WHERE workspace_id = ?",
                (row["id"],),
            ).fetchone()
            materials = connection.execute(
                "SELECT * FROM materials WHERE workspace_id = ? ORDER BY created_at DESC",
                (row["id"],),
            ).fetchall()
            flashcards = connection.execute(
                """
                SELECT id, front, back, position, created_at
                FROM workspace_flashcards
                WHERE workspace_id = ?
                ORDER BY position ASC
                """,
                (row["id"],),
            ).fetchall()
        result["sessions"] = [serialize_lecture(session, include_content=True) for session in sessions]
        result["note_body"] = notes["note_body"] if notes else ""
        result["notes_updated_at"] = notes["updated_at"] if notes else None
        result["study_notes"] = study_notes["note_body"] if study_notes else ""
        result["study_notes_updated_at"] = study_notes["updated_at"] if study_notes else None
        result["ai_notes"] = ai_notes["note_body"] if ai_notes else ""
        result["ai_notes_model"] = ai_notes["model"] if ai_notes else None
        result["ai_notes_updated_at"] = ai_notes["updated_at"] if ai_notes else None
        result["materials"] = [serialize_material(material) for material in materials]
        result["flashcards"] = [dict(flashcard) for flashcard in flashcards]
    return result


def get_folder_path(folder: sqlite3.Row | None) -> list[dict[str, object]]:
    if folder is None:
        return []
    path = [serialize_folder(folder)]
    parent_id = folder["parent_id"]
    with connect_database() as connection:
        while parent_id:
            parent = connection.execute(
                "SELECT * FROM folders WHERE id = ?", (parent_id,)
            ).fetchone()
            if parent is None:
                break
            path.append(serialize_folder(parent))
            parent_id = parent["parent_id"]
    return list(reversed(path))
