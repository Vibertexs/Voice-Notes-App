"""Keeps the full-text index in step with transcripts, notes and files."""
from __future__ import annotations

import sqlite3

from backend.database import connect_database


def index_lecture_transcript(connection: sqlite3.Connection, lecture_id: str) -> None:
    """Mirror one recording's timed lines into the search index."""
    connection.execute(
        "DELETE FROM search_index WHERE kind = 'transcript' AND ref_id = ?", (lecture_id,)
    )
    rows = connection.execute(
        "SELECT start_seconds, text FROM transcript_segments WHERE lecture_id = ? ORDER BY position",
        (lecture_id,),
    ).fetchall()
    if rows:
        connection.executemany(
            "INSERT INTO search_index (body, kind, ref_id, start_seconds) VALUES (?, 'transcript', ?, ?)",
            [(row["text"], lecture_id, row["start_seconds"]) for row in rows],
        )
        return
    # Recordings captured before timed lines existed are still worth finding.
    flat = connection.execute(
        "SELECT transcript FROM lectures WHERE id = ?", (lecture_id,)
    ).fetchone()
    if flat and flat["transcript"].strip():
        connection.execute(
            "INSERT INTO search_index (body, kind, ref_id, start_seconds) VALUES (?, 'transcript', ?, NULL)",
            (flat["transcript"], lecture_id),
        )


def index_workspace_note(connection: sqlite3.Connection, workspace_id: str) -> None:
    connection.execute("DELETE FROM search_index WHERE kind = 'note' AND ref_id = ?", (workspace_id,))
    row = connection.execute(
        "SELECT note_body FROM workspace_notes WHERE workspace_id = ?", (workspace_id,)
    ).fetchone()
    if row and row["note_body"].strip():
        connection.execute(
            "INSERT INTO search_index (body, kind, ref_id, start_seconds) VALUES (?, 'note', ?, NULL)",
            (row["note_body"], workspace_id),
        )


def index_material(connection: sqlite3.Connection, material_id: str) -> None:
    connection.execute(
        "DELETE FROM search_index WHERE kind = 'material' AND ref_id = ?", (material_id,)
    )
    row = connection.execute(
        "SELECT original_filename, extracted_text FROM materials WHERE id = ?", (material_id,)
    ).fetchone()
    if row and (row["extracted_text"].strip() or row["original_filename"].strip()):
        body = f"{row['original_filename']}\n{row['extracted_text']}".strip()
        connection.execute(
            "INSERT INTO search_index (body, kind, ref_id, start_seconds) VALUES (?, 'material', ?, NULL)",
            (body, material_id),
        )


def drop_from_search_index(connection: sqlite3.Connection, kind: str, ref_id: str) -> None:
    connection.execute("DELETE FROM search_index WHERE kind = ? AND ref_id = ?", (kind, ref_id))


def rebuild_search_index(connection: sqlite3.Connection) -> int:
    """Rebuild every row from the source tables, so the index can never drift for long."""
    connection.execute("DELETE FROM search_index")
    for row in connection.execute("SELECT id FROM lectures").fetchall():
        index_lecture_transcript(connection, row["id"])
    for row in connection.execute("SELECT workspace_id FROM workspace_notes").fetchall():
        index_workspace_note(connection, row["workspace_id"])
    for row in connection.execute("SELECT id FROM materials").fetchall():
        index_material(connection, row["id"])
    return connection.execute("SELECT COUNT(*) AS total FROM search_index").fetchone()["total"]
