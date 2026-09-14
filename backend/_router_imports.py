"""Shared imports for routers, so each stays a thin slice of HTTP surface."""
from __future__ import annotations

import json
import mimetypes
import re
import shutil
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from backend.config import (
    ALLOWED_MATERIAL_SUFFIXES,
    ALLOWED_SUFFIXES,
    AUDIO_DIR,
    DATA_DIR,
    FOLDER_COLORS,
    FRONTEND_DIST,
    LOCAL_AI_DEFAULT_MODEL,
    MATERIALS_DIR,
    MAX_MATERIAL_BYTES,
    MAX_MATERIALS_PER_WORKSPACE,
    MAX_UPLOAD_BYTES,
)
from backend.database import (
    connect_database,
    get_folder,
    get_lecture,
    get_material,
    get_workspace,
)
from backend.schemas import *  # noqa: F401,F403  (request models)
from backend.serializers import (
    get_folder_path,
    serialize_ai_message,
    serialize_folder,
    serialize_lecture,
    serialize_material,
    serialize_workspace,
)
from backend.services.local_ai import (
    ask_local_model,
    build_class_ai_context,
    build_workspace_ai_context,
    class_ai_sources,
    descendant_folder_ids,
    ensure_local_model,
    local_ai_status,
    local_ai_system_prompt,
)
from backend.services.materials import extract_material_text, normalize_extracted_text
from backend.services.search_index import (
    drop_from_search_index,
    index_material,
    index_workspace_note,
    rebuild_search_index,
)
from backend.services.segments import read_transcript_segments, replace_transcript_segments
from backend.services.study import *  # noqa: F401,F403  (study drafting)
from backend.services.transcription_jobs import queue_transcription
from backend.settings import FINAL_TRANSCRIPTION_MODEL
