"""Timed transcript lines: the rows that make a transcript seekable."""
from __future__ import annotations

import json
import sqlite3
from uuid import uuid4

from backend.services.search_index import index_lecture_transcript


def replace_transcript_segments(
    connection: sqlite3.Connection,
    lecture_id: str,
    segments: list[dict[str, object]] | None,
) -> int:
    """Store the timed lines Whisper produced so the transcript can seek the audio."""
    connection.execute("DELETE FROM transcript_segments WHERE lecture_id = ?", (lecture_id,))
    rows: list[tuple[object, ...]] = []
    for segment in segments or []:
        text = str(segment.get("text", "")).strip()
        if not text:
            continue
        try:
            start = max(0.0, float(segment.get("start", 0.0)))
            end = float(segment.get("end", start))
        except (TypeError, ValueError):
            continue
        words = segment.get("words") or []
        rows.append((
            str(uuid4()), lecture_id, len(rows), start, max(start, end), text,
            json.dumps(words, separators=(",", ":")),
        ))
    if rows:
        connection.executemany(
            """
            INSERT INTO transcript_segments (
                id, lecture_id, position, start_seconds, end_seconds, text, words
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
    index_lecture_transcript(connection, lecture_id)
    return len(rows)


def read_transcript_segments(
    connection: sqlite3.Connection, lecture_id: str
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT start_seconds, end_seconds, text, words
        FROM transcript_segments
        WHERE lecture_id = ?
        ORDER BY position ASC
        """,
        (lecture_id,),
    ).fetchall()
    segments: list[dict[str, object]] = []
    for row in rows:
        segment = dict(row)
        try:
            segment["words"] = json.loads(segment["words"] or "[]")
        except (TypeError, ValueError):
            segment["words"] = []
        segments.append(segment)
    return segments
