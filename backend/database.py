"""SQLite access: connection policy, schema creation, and row lookups."""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

from backend.config import (
    AUDIO_DIR,
    DATABASE_PATH,
    DATA_DIR,
    MATERIALS_DIR,
)


def connect_database() -> sqlite3.Connection:
    # WAL plus a busy timeout so the transcription worker and the web request
    # can touch the database at the same time without "database is locked".
    connection = sqlite3.connect(DATABASE_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 30000")
    return connection


def initialize_database() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    AUDIO_DIR.mkdir(exist_ok=True)
    MATERIALS_DIR.mkdir(exist_ok=True)
    with connect_database() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                parent_id TEXT,
                color TEXT NOT NULL DEFAULT 'blue',
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS lectures (
                id TEXT PRIMARY KEY,
                course TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                audio_filename TEXT NOT NULL,
                model TEXT NOT NULL,
                transcript TEXT NOT NULL,
                note_body TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                folder_id TEXT,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS workspace_notes (
                workspace_id TEXT PRIMARY KEY,
                note_body TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS workspace_study_notes (
                workspace_id TEXT PRIMARY KEY,
                note_body TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS workspace_flashcards (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                front TEXT NOT NULL,
                back TEXT NOT NULL,
                position INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
                body,
                kind UNINDEXED,
                ref_id UNINDEXED,
                start_seconds UNINDEXED,
                tokenize = 'porter unicode61'
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS transcript_segments (
                id TEXT PRIMARY KEY,
                lecture_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                start_seconds REAL NOT NULL,
                end_seconds REAL NOT NULL,
                text TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS session_markers (
                id TEXT PRIMARY KEY,
                lecture_id TEXT NOT NULL,
                label TEXT NOT NULL,
                time_seconds REAL NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS materials (
                id TEXT PRIMARY KEY,
                workspace_id TEXT,
                folder_id TEXT,
                original_filename TEXT NOT NULL,
                stored_filename TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                extracted_text TEXT NOT NULL DEFAULT '',
                extraction_status TEXT NOT NULL DEFAULT 'not_processed',
                extraction_message TEXT NOT NULL DEFAULT '',
                extracted_at TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS workspace_ai_notes (
                workspace_id TEXT PRIMARY KEY,
                note_body TEXT NOT NULL,
                model TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS workspace_ai_messages (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                model TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS folder_ai_notes (
                folder_id TEXT PRIMARY KEY,
                note_body TEXT NOT NULL,
                model TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS folder_ai_messages (
                id TEXT PRIMARY KEY,
                folder_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                model TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_session_markers_lecture_time "
            "ON session_markers (lecture_id, time_seconds)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_transcript_segments_lecture_position "
            "ON transcript_segments (lecture_id, position)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_workspace_ai_messages_created "
            "ON workspace_ai_messages (workspace_id, created_at)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_workspace_flashcards_position "
            "ON workspace_flashcards (workspace_id, position)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_folder_ai_messages_created "
            "ON folder_ai_messages (folder_id, created_at)"
        )
        folder_columns = {row["name"] for row in connection.execute("PRAGMA table_info(folders)")}
        if "archived_at" not in folder_columns:
            connection.execute("ALTER TABLE folders ADD COLUMN archived_at TEXT")
        # A folder is a class, and classes do not live inside other classes.
        connection.execute("UPDATE folders SET parent_id = NULL WHERE parent_id IS NOT NULL")
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(lectures)")}
        if "folder_id" not in columns:
            connection.execute("ALTER TABLE lectures ADD COLUMN folder_id TEXT")
        if "workspace_id" not in columns:
            connection.execute("ALTER TABLE lectures ADD COLUMN workspace_id TEXT")
        if "is_standalone" not in columns:
            connection.execute(
                "ALTER TABLE lectures ADD COLUMN is_standalone INTEGER NOT NULL DEFAULT 0"
            )
        if "capture_notes_workspace_id" not in columns:
            connection.execute("ALTER TABLE lectures ADD COLUMN capture_notes_workspace_id TEXT")
        if "transcription_status" not in columns:
            # Recordings that already exist finished transcribing long ago.
            connection.execute(
                "ALTER TABLE lectures ADD COLUMN transcription_status TEXT NOT NULL DEFAULT 'ready'"
            )
        if "transcription_progress" not in columns:
            connection.execute(
                "ALTER TABLE lectures ADD COLUMN transcription_progress REAL NOT NULL DEFAULT 1"
            )
        if "duration_seconds" not in columns:
            connection.execute("ALTER TABLE lectures ADD COLUMN duration_seconds REAL")
        if "transcription_eta_seconds" not in columns:
            connection.execute("ALTER TABLE lectures ADD COLUMN transcription_eta_seconds REAL")
        if "transcription_resume_from" not in columns:
            connection.execute(
                "ALTER TABLE lectures ADD COLUMN transcription_resume_from REAL NOT NULL DEFAULT 0"
            )
        material_columns = {row["name"] for row in connection.execute("PRAGMA table_info(materials)")}
        if "extracted_text" not in material_columns:
            connection.execute("ALTER TABLE materials ADD COLUMN extracted_text TEXT NOT NULL DEFAULT ''")
        if "extraction_status" not in material_columns:
            connection.execute(
                "ALTER TABLE materials ADD COLUMN extraction_status TEXT NOT NULL DEFAULT 'not_processed'"
            )
        if "extraction_message" not in material_columns:
            connection.execute("ALTER TABLE materials ADD COLUMN extraction_message TEXT NOT NULL DEFAULT ''")
        if "extracted_at" not in material_columns:
            connection.execute("ALTER TABLE materials ADD COLUMN extracted_at TEXT")
        if "folder_id" not in material_columns:
            connection.execute(
                """
                CREATE TABLE materials_migrating (
                    id TEXT PRIMARY KEY,
                    workspace_id TEXT,
                    folder_id TEXT,
                    original_filename TEXT NOT NULL,
                    stored_filename TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    extracted_text TEXT NOT NULL DEFAULT '',
                    extraction_status TEXT NOT NULL DEFAULT 'not_processed',
                    extraction_message TEXT NOT NULL DEFAULT '',
                    extracted_at TEXT
                )
                """
            )
            connection.execute(
                """
                INSERT INTO materials_migrating (
                    id, workspace_id, folder_id, original_filename, stored_filename, mime_type,
                    size_bytes, created_at, extracted_text, extraction_status, extraction_message, extracted_at
                )
                SELECT materials.id, NULL, workspaces.folder_id,
                       materials.original_filename, materials.stored_filename, materials.mime_type,
                       materials.size_bytes, materials.created_at, materials.extracted_text,
                       materials.extraction_status, materials.extraction_message, materials.extracted_at
                FROM materials
                LEFT JOIN workspaces ON workspaces.id = materials.workspace_id
                """
            )
            connection.execute("DROP TABLE materials")
            connection.execute("ALTER TABLE materials_migrating RENAME TO materials")
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_materials_folder_created "
            "ON materials (folder_id, created_at)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_materials_workspace_created "
            "ON materials (workspace_id, created_at)"
        )
        folder_columns = {row["name"] for row in connection.execute("PRAGMA table_info(folders)")}
        if "color" not in folder_columns:
            connection.execute("ALTER TABLE folders ADD COLUMN color TEXT NOT NULL DEFAULT 'blue'")
        # A recording without a lecture page was a short-lived experiment.  Keep
        # every existing audio file, but give each orphan its own lecture so the
        # library has one predictable mental model from now on.
        legacy_rows = connection.execute(
            """
            SELECT id, folder_id, title, created_at, note_body
            FROM lectures
            WHERE workspace_id IS NULL
            """
        ).fetchall()
        for lecture in legacy_rows:
            workspace_id = str(uuid4())
            connection.execute(
                """
                INSERT INTO workspaces (id, folder_id, title, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    workspace_id,
                    lecture["folder_id"],
                    lecture["title"],
                    lecture["created_at"],
                    lecture["created_at"],
                ),
            )
            connection.execute(
                """
                UPDATE lectures
                SET workspace_id = ?, is_standalone = 0, capture_notes_workspace_id = ?
                WHERE id = ?
                """,
                (workspace_id, workspace_id, lecture["id"]),
            )
            connection.execute(
                """
                INSERT INTO workspace_notes (workspace_id, note_body, updated_at)
                VALUES (?, ?, ?)
                """,
                (workspace_id, lecture["note_body"], lecture["created_at"]),
            )
        missing_notes = connection.execute(
            """
            SELECT workspaces.id, workspaces.updated_at,
                   COALESCE((
                       SELECT lectures.note_body
                       FROM lectures
                       WHERE lectures.workspace_id = workspaces.id
                       ORDER BY lectures.created_at ASC
                       LIMIT 1
                   ), '') AS note_body
            FROM workspaces
            LEFT JOIN workspace_notes ON workspace_notes.workspace_id = workspaces.id
            WHERE workspace_notes.workspace_id IS NULL
            """
        ).fetchall()
        for workspace in missing_notes:
            connection.execute(
                """
                INSERT INTO workspace_notes (workspace_id, note_body, updated_at)
                VALUES (?, ?, ?)
                """,
                (workspace["id"], workspace["note_body"], workspace["updated_at"]),
            )
        connection.execute(
            """
            UPDATE lectures
            SET capture_notes_workspace_id = workspace_id
            WHERE capture_notes_workspace_id IS NULL
              AND workspace_id IS NOT NULL
              AND trim(note_body) <> ''
            """
        )


def get_folder(folder_id: str) -> sqlite3.Row:
    with connect_database() as connection:
        row = connection.execute("SELECT * FROM folders WHERE id = ?", (folder_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Folder not found.")
    return row


def get_lecture(lecture_id: str) -> sqlite3.Row:
    with connect_database() as connection:
        row = connection.execute("SELECT * FROM lectures WHERE id = ?", (lecture_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Recording not found.")
    return row


def get_workspace(workspace_id: str) -> sqlite3.Row:
    with connect_database() as connection:
        row = connection.execute(
            """
            SELECT workspaces.*, COUNT(lectures.id) AS session_count
            FROM workspaces
            LEFT JOIN lectures ON lectures.workspace_id = workspaces.id
            WHERE workspaces.id = ?
            GROUP BY workspaces.id
            """,
            (workspace_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Lecture workspace not found.")
    return row


def get_material(material_id: str) -> sqlite3.Row:
    with connect_database() as connection:
        row = connection.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Imported file not found.")
    return row
