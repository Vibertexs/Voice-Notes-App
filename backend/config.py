"""Filesystem layout and hard limits, kept in one place so layers agree."""
from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIST = PROJECT_ROOT / "frontend-dist"

# Overridable so a test run can point at a scratch library instead of the real one.
DATA_DIR = Path(os.environ.get("VOICE_NOTES_DATA") or (PROJECT_ROOT / "data"))
AUDIO_DIR = DATA_DIR / "audio"
MATERIALS_DIR = DATA_DIR / "materials"
DATABASE_PATH = DATA_DIR / "voice_notes.db"

MAX_UPLOAD_BYTES = 256 * 1024 * 1024
MAX_MATERIAL_BYTES = 25 * 1024 * 1024
MAX_MATERIALS_PER_WORKSPACE = 30
MAX_MATERIAL_EXTRACTED_CHARS = 100_000
MAX_PDF_PAGES_FOR_EXTRACTION = 100
MAX_OFFICE_ARCHIVE_FILES = 10_000
MAX_OFFICE_UNCOMPRESSED_BYTES = 60 * 1024 * 1024

LOCAL_AI_URL = "http://127.0.0.1:11434"
LOCAL_AI_DEFAULT_MODEL = "qwen3:1.7b"
LOCAL_AI_CONTEXT_LIMIT = 50_000
LOCAL_AI_HISTORY_LIMIT = 8

ALLOWED_SUFFIXES = {".wav", ".mp3", ".m4a", ".ogg", ".webm", ".mp4"}
ALLOWED_MATERIAL_SUFFIXES = {".pdf", ".txt", ".md", ".doc", ".docx", ".ppt", ".pptx"}
FOLDER_COLORS = {"blue", "violet", "rose", "coral", "amber", "lime", "mint", "sky", "slate"}
