from __future__ import annotations

import mimetypes
import re
import shutil
import sqlite3
import tempfile
from collections import Counter
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from transcription import transcribe_audio

PROJECT_ROOT = Path(__file__).resolve().parent
DATA_DIR = PROJECT_ROOT / "data"
AUDIO_DIR = DATA_DIR / "audio"
DATABASE_PATH = DATA_DIR / "voice_notes.db"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
ALLOWED_SUFFIXES = {".wav", ".mp3", ".m4a", ".ogg", ".webm", ".mp4"}
TRANSCRIPTION_MODELS = {"tiny.en", "base.en", "small.en"}
FOLDER_COLORS = {"blue", "violet", "rose", "coral", "amber", "lime", "mint", "sky", "slate"}


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: str | None = None
    color: str = "blue"


class FolderUpdate(BaseModel):
    color: str = Field(min_length=1, max_length=20)


class LectureUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=180)
    note_body: str | None = Field(default=None, max_length=100_000)
    folder_id: str | None = None


class RecordingMove(BaseModel):
    folder_id: str | None = None


class WorkspaceCreate(BaseModel):
    title: str | None = Field(default=None, max_length=180)
    folder_id: str | None = None


class WorkspaceUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=180)
    folder_id: str | None = None


class WorkspaceNotesUpdate(BaseModel):
    note_body: str = Field(max_length=100_000)


class WorkspaceStudyNotesUpdate(BaseModel):
    note_body: str = Field(max_length=100_000)


class SessionMarkerCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    time_seconds: float = Field(ge=0)


def connect_database() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    AUDIO_DIR.mkdir(exist_ok=True)
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
            "CREATE INDEX IF NOT EXISTS idx_session_markers_lecture_time "
            "ON session_markers (lecture_id, time_seconds)"
        )
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(lectures)")}
        if "folder_id" not in columns:
            connection.execute("ALTER TABLE lectures ADD COLUMN folder_id TEXT")
        if "workspace_id" not in columns:
            connection.execute("ALTER TABLE lectures ADD COLUMN workspace_id TEXT")
        folder_columns = {row["name"] for row in connection.execute("PRAGMA table_info(folders)")}
        if "color" not in folder_columns:
            connection.execute("ALTER TABLE folders ADD COLUMN color TEXT NOT NULL DEFAULT 'blue'")
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
                "UPDATE lectures SET workspace_id = ? WHERE id = ?",
                (workspace_id, lecture["id"]),
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


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="Class Notes", lifespan=lifespan)


def clean_label(value: str, fallback: str, limit: int) -> str:
    return " ".join(value.split())[:limit] or fallback


def default_lecture_title(created_at: datetime) -> str:
    return f"Lecture — {created_at.astimezone().strftime('%b %d, %Y at %I:%M %p')}"


def new_note_template(title: str) -> str:
    return f"""# {title}

## Lecture summary


## Key ideas
-

## Key terms and definitions
-

## Questions to review
-
"""


STUDY_STOP_WORDS = frozenset((
    "a about after again all also am an and any are as at be because been before being but by can "
    "could did do does each for from had has have he her here hers herself him himself his how i if in "
    "into is it its itself just may me more most my no not of on once only or other our out over own same "
    "she should so some such than that the their theirs them themselves then there these they this those through "
    "to too under up us was we were what when where which while who will with would you your yours yourself"
).split())


def study_words(text: str) -> list[str]:
    return [word.lower() for word in re.findall(r"[A-Za-z][A-Za-z'-]{2,}", text)]


def study_sentences(text: str) -> list[str]:
    normalized = re.sub(r"(?m)^\s*(?:#{1,6}|[-*])\s*", "", text)
    candidates = re.split(r"(?<=[.!?])\s+|\n+", normalized)
    result: list[str] = []
    for candidate in candidates:
        candidate = " ".join(candidate.split())
        if 28 <= len(candidate) <= 360 and len(study_words(candidate)) >= 5:
            result.append(candidate)
    return result


def build_local_study_draft(title: str, note_body: str, transcripts: list[str]) -> str:
    """Create a transparent, local review outline; it is not an LLM summary."""
    source_text = "\n".join([note_body, *transcripts])
    words = [word for word in study_words(source_text) if word not in STUDY_STOP_WORDS]
    if len(words) < 8:
        raise HTTPException(
            status_code=422,
            detail="Add a few notes or save a recording before making a study draft.",
        )

    term_counts = Counter(words)
    terms = [term for term, _ in term_counts.most_common(5)]
    candidates = study_sentences(source_text)
    selected: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        fingerprint = candidate.casefold()
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        selected.append(candidate)
        if len(selected) == 4:
            break
    if not selected:
        selected = ["Review the original notes and recording to identify the main ideas."]

    session_label = "recording" if len(transcripts) == 1 else "recordings"
    key_ideas = "\n".join(f"- {sentence}" for sentence in selected)
    terms_list = "\n".join(f"- **{term.title()}** — define this in your own words." for term in terms[:4])
    questions = "\n".join(
        f"- How would you explain **{term.title()}** without looking at your notes?" for term in terms[:3]
    )
    return f"""# {title} — study draft

_Made locally from your notes and {len(transcripts)} saved {session_label}. Check it against class before studying._

## Key ideas
{key_ideas}

## Terms to know
{terms_list}

## Questions to review
{questions}
"""


def serialize_folder(row: sqlite3.Row) -> dict[str, object]:
    return {
        "id": row["id"],
        "name": row["name"],
        "parent_id": row["parent_id"],
        "color": row["color"],
        "created_at": row["created_at"],
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
        result["markers"] = [dict(marker) for marker in markers]
    return result


def serialize_workspace(row: sqlite3.Row, *, include_sessions: bool = False) -> dict[str, object]:
    result: dict[str, object] = {
        "id": row["id"],
        "folder_id": row["folder_id"],
        "title": row["title"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "session_count": row["session_count"] if "session_count" in row.keys() else 0,
    }
    if include_sessions:
        with connect_database() as connection:
            sessions = connection.execute(
                "SELECT * FROM lectures WHERE workspace_id = ? ORDER BY created_at ASC", (row["id"],)
            ).fetchall()
            notes = connection.execute(
                "SELECT note_body, updated_at FROM workspace_notes WHERE workspace_id = ?",
                (row["id"],),
            ).fetchone()
            study_notes = connection.execute(
                "SELECT note_body, updated_at FROM workspace_study_notes WHERE workspace_id = ?",
                (row["id"],),
            ).fetchone()
        result["sessions"] = [serialize_lecture(session, include_content=True) for session in sessions]
        result["note_body"] = notes["note_body"] if notes else ""
        result["notes_updated_at"] = notes["updated_at"] if notes else None
        result["study_notes"] = study_notes["note_body"] if study_notes else ""
        result["study_notes_updated_at"] = study_notes["updated_at"] if study_notes else None
    return result


def get_folder(folder_id: str) -> sqlite3.Row:
    with connect_database() as connection:
        row = connection.execute("SELECT * FROM folders WHERE id = ?", (folder_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Folder not found.")
    return row


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


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(PROJECT_ROOT / "static" / "index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/library")
def list_library(folder_id: str | None = Query(default=None)) -> dict[str, object]:
    current_folder = get_folder(folder_id) if folder_id else None
    with connect_database() as connection:
        if folder_id:
            folders = connection.execute(
                "SELECT * FROM folders WHERE parent_id = ? ORDER BY name COLLATE NOCASE", (folder_id,)
            ).fetchall()
            lectures = connection.execute(
                "SELECT * FROM lectures WHERE folder_id = ? AND workspace_id IS NULL ORDER BY created_at DESC", (folder_id,)
            ).fetchall()
            workspaces = connection.execute(
                """
                SELECT workspaces.*, COUNT(lectures.id) AS session_count
                FROM workspaces
                LEFT JOIN lectures ON lectures.workspace_id = workspaces.id
                WHERE workspaces.folder_id = ?
                GROUP BY workspaces.id
                ORDER BY workspaces.updated_at DESC
                """,
                (folder_id,),
            ).fetchall()
        else:
            folders = connection.execute(
                "SELECT * FROM folders WHERE parent_id IS NULL ORDER BY name COLLATE NOCASE"
            ).fetchall()
            lectures = connection.execute(
                "SELECT * FROM lectures WHERE folder_id IS NULL AND workspace_id IS NULL ORDER BY created_at DESC"
            ).fetchall()
            workspaces = connection.execute(
                """
                SELECT workspaces.*, COUNT(lectures.id) AS session_count
                FROM workspaces
                LEFT JOIN lectures ON lectures.workspace_id = workspaces.id
                WHERE workspaces.folder_id IS NULL
                GROUP BY workspaces.id
                ORDER BY workspaces.updated_at DESC
                """
            ).fetchall()
    return {
        "current_folder": serialize_folder(current_folder) if current_folder else None,
        "breadcrumbs": get_folder_path(current_folder),
        "folders": [serialize_folder(folder) for folder in folders],
        "workspaces": [serialize_workspace(workspace) for workspace in workspaces],
        "lectures": [serialize_lecture(lecture, include_content=False) for lecture in lectures],
    }


@app.get("/api/folders")
def list_folders() -> dict[str, list[dict[str, object]]]:
    with connect_database() as connection:
        rows = connection.execute(
            "SELECT * FROM folders ORDER BY name COLLATE NOCASE"
        ).fetchall()
    return {"folders": [serialize_folder(folder) for folder in rows]}


@app.get("/api/recordings")
def list_recordings() -> dict[str, list[dict[str, object]]]:
    with connect_database() as connection:
        rows = connection.execute(
            "SELECT * FROM lectures ORDER BY created_at DESC LIMIT 30"
        ).fetchall()
    return {"recordings": [serialize_lecture(recording, include_content=False) for recording in rows]}


@app.post("/api/folders", status_code=201)
def create_folder(folder: FolderCreate) -> dict[str, object]:
    name = clean_label(folder.name, "Untitled folder", 120)
    parent_id = folder.parent_id or None
    color = folder.color if folder.color in FOLDER_COLORS else "blue"
    if parent_id:
        get_folder(parent_id)
    with connect_database() as connection:
        if parent_id:
            duplicate = connection.execute(
                "SELECT 1 FROM folders WHERE parent_id = ? AND lower(name) = lower(?)", (parent_id, name)
            ).fetchone()
        else:
            duplicate = connection.execute(
                "SELECT 1 FROM folders WHERE parent_id IS NULL AND lower(name) = lower(?)", (name,)
            ).fetchone()
        if duplicate:
            raise HTTPException(status_code=409, detail="A folder with that name already exists here.")
        folder_id = str(uuid4())
        created_at = datetime.now(timezone.utc).isoformat()
        connection.execute(
            "INSERT INTO folders (id, name, parent_id, color, created_at) VALUES (?, ?, ?, ?, ?)",
            (folder_id, name, parent_id, color, created_at),
        )
    return serialize_folder(get_folder(folder_id))


@app.patch("/api/folders/{folder_id}")
def update_folder(folder_id: str, update: FolderUpdate) -> dict[str, object]:
    get_folder(folder_id)
    if update.color not in FOLDER_COLORS:
        raise HTTPException(status_code=422, detail="Choose a valid folder color.")
    with connect_database() as connection:
        connection.execute("UPDATE folders SET color = ? WHERE id = ?", (update.color, folder_id))
    return serialize_folder(get_folder(folder_id))


@app.delete("/api/folders/{folder_id}")
def delete_folder(folder_id: str) -> dict[str, str]:
    get_folder(folder_id)
    with connect_database() as connection:
        has_children = connection.execute(
            "SELECT 1 FROM folders WHERE parent_id = ? LIMIT 1", (folder_id,)
        ).fetchone()
        has_lectures = connection.execute(
            "SELECT 1 FROM lectures WHERE folder_id = ? LIMIT 1", (folder_id,)
        ).fetchone()
        has_workspaces = connection.execute(
            "SELECT 1 FROM workspaces WHERE folder_id = ? LIMIT 1", (folder_id,)
        ).fetchone()
        if has_children or has_lectures or has_workspaces:
            raise HTTPException(
                status_code=409,
                detail="Move or delete the folder's contents before deleting the folder.",
            )
        connection.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
    return {"status": "deleted"}


@app.post("/api/workspaces", status_code=201)
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


@app.get("/api/workspaces/{workspace_id}")
def read_workspace(workspace_id: str) -> dict[str, object]:
    return serialize_workspace(get_workspace(workspace_id), include_sessions=True)


@app.patch("/api/workspaces/{workspace_id}")
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


@app.put("/api/workspaces/{workspace_id}/notes")
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
        connection.execute(
            "UPDATE workspaces SET updated_at = ? WHERE id = ?", (saved_at, workspace_id)
        )
    return {"status": "saved", "updated_at": saved_at}


@app.put("/api/workspaces/{workspace_id}/study-notes")
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


@app.post("/api/workspaces/{workspace_id}/study-notes/generate")
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


@app.get("/api/lectures/{lecture_id}")
def read_lecture(lecture_id: str) -> dict[str, object]:
    return serialize_lecture(get_lecture(lecture_id), include_content=True)


@app.post("/api/lectures/{lecture_id}/markers", status_code=201)
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


@app.delete("/api/lectures/{lecture_id}/markers/{marker_id}")
def delete_session_marker(lecture_id: str, marker_id: str) -> dict[str, str]:
    with connect_database() as connection:
        deleted = connection.execute(
            "DELETE FROM session_markers WHERE id = ? AND lecture_id = ?", (marker_id, lecture_id)
        ).rowcount
    if not deleted:
        raise HTTPException(status_code=404, detail="Topic marker not found.")
    return {"status": "deleted"}


@app.get("/api/lectures/{lecture_id}/audio")
def read_lecture_audio(lecture_id: str) -> FileResponse:
    row = get_lecture(lecture_id)
    audio_path = AUDIO_DIR / row["audio_filename"]
    if not audio_path.is_file():
        raise HTTPException(status_code=404, detail="The saved audio file is unavailable.")
    media_type, _ = mimetypes.guess_type(audio_path.name)
    return FileResponse(audio_path, media_type=media_type or "application/octet-stream")


@app.post("/api/lectures", status_code=201)
def create_lecture(
    audio: UploadFile = File(...),
    folder_id: str = Form(default=""),
    workspace_id: str = Form(default=""),
    title: str = Form(default=""),
    model: str = Form(default="base.en"),
) -> dict[str, object]:
    if model not in TRANSCRIPTION_MODELS:
        raise HTTPException(status_code=400, detail="Choose a supported transcription quality.")
    selected_workspace_id = workspace_id or None
    selected_workspace = get_workspace(selected_workspace_id) if selected_workspace_id else None
    selected_folder_id = selected_workspace["folder_id"] if selected_workspace else folder_id or None
    selected_folder = get_folder(selected_folder_id) if selected_folder_id else None
    suffix = Path(audio.filename or "recording.webm").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=415, detail="Upload a supported audio file.")

    created_at_datetime = datetime.now(timezone.utc)
    clean_title = clean_label(title, default_lecture_title(created_at_datetime), 180)
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
        try:
            transcription = transcribe_audio(temporary_audio_path, model_name=model)
        except Exception as error:
            raise HTTPException(
                status_code=422,
                detail="The recording could not be transcribed. Try a different audio format.",
            ) from error
        saved_audio_path = AUDIO_DIR / audio_filename
        shutil.copyfile(temporary_audio_path, saved_audio_path)

    note_body = new_note_template(clean_title)
    course = selected_folder["name"] if selected_folder else "Unfiled recordings"
    try:
        with connect_database() as connection:
            if selected_workspace is None:
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
                connection.execute(
                    """
                    INSERT INTO workspace_notes (workspace_id, note_body, updated_at)
                    VALUES (?, ?, ?)
                    """,
                    (selected_workspace_id, note_body, created_at_datetime.isoformat()),
                )
            connection.execute(
                """
                INSERT INTO lectures (
                    id, workspace_id, folder_id, course, title, created_at, audio_filename, model, transcript, note_body
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    lecture_id,
                    selected_workspace_id,
                    selected_folder_id,
                    course,
                    clean_title,
                    created_at_datetime.isoformat(),
                    audio_filename,
                    model,
                    transcription["text"],
                    note_body,
                ),
            )
    except Exception:
        saved_audio_path.unlink(missing_ok=True)
        raise
    return serialize_lecture(get_lecture(lecture_id), include_content=True)


@app.patch("/api/lectures/{lecture_id}")
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


@app.patch("/api/lectures/{lecture_id}/move")
def move_lecture(lecture_id: str, move: RecordingMove) -> dict[str, object]:
    current = get_lecture(lecture_id)
    folder_id = move.folder_id or None
    destination = get_folder(folder_id) if folder_id else None
    course = destination["name"] if destination else "Unfiled recordings"
    with connect_database() as connection:
        if current["workspace_id"]:
            connection.execute(
                "UPDATE workspaces SET folder_id = ?, updated_at = ? WHERE id = ?",
                (folder_id, datetime.now(timezone.utc).isoformat(), current["workspace_id"]),
            )
            connection.execute(
                "UPDATE lectures SET folder_id = ?, course = ? WHERE workspace_id = ?",
                (folder_id, course, current["workspace_id"]),
            )
        else:
            connection.execute(
                "UPDATE lectures SET folder_id = ?, course = ? WHERE id = ?",
                (folder_id, course, lecture_id),
            )
    return serialize_lecture(get_lecture(lecture_id), include_content=True)


@app.delete("/api/lectures/{lecture_id}")
def delete_lecture(lecture_id: str) -> dict[str, str]:
    row = get_lecture(lecture_id)
    with connect_database() as connection:
        connection.execute("DELETE FROM session_markers WHERE lecture_id = ?", (lecture_id,))
        connection.execute("DELETE FROM lectures WHERE id = ?", (lecture_id,))
    (AUDIO_DIR / row["audio_filename"]).unlink(missing_ok=True)
    return {"status": "deleted"}
