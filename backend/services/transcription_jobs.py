"""Background transcription: queueing, progress, ETA and resumption."""
from __future__ import annotations

import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from time import monotonic
from uuid import uuid4

from backend.config import AUDIO_DIR
from backend.database import connect_database
from backend.services.search_index import (
    drop_from_search_index,
    index_lecture_transcript,
)
from backend.services.segments import read_transcript_segments, replace_transcript_segments
from transcription import transcribe_audio


TRANSCRIBER = ThreadPoolExecutor(max_workers=1, thread_name_prefix="transcribe")


MODEL_REALTIME_FACTOR = {"tiny.en": 4.9, "base.en": 2.2, "small.en": 0.9}


class TranscriptionCancelled(Exception):
    """Raised inside the worker when its lecture disappears mid-run."""


def flush_progress_segments(
    lecture_id: str,
    pending: list[dict[str, object]],
    checkpoint: list[float],
    reached: float,
) -> None:
    """Persist finished lines mid-run so a restart resumes instead of starting over."""
    if not pending:
        return
    ready = [item for item in pending if float(item.get("end", 0.0)) <= reached]
    if not ready:
        return
    del pending[: len(ready)]
    with connect_database() as connection:
        alive = connection.execute(
            "SELECT 1 FROM lectures WHERE id = ?", (lecture_id,)
        ).fetchone()
        if alive is None:
            raise TranscriptionCancelled()
        start_position = connection.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM transcript_segments WHERE lecture_id = ?",
            (lecture_id,),
        ).fetchone()["next"]
        rows = []
        for item in ready:
            text = str(item.get("text", "")).strip()
            if not text:
                continue
            begin = max(0.0, float(item.get("start", 0.0)))
            finish = max(begin, float(item.get("end", begin)))
            rows.append((
                str(uuid4()), lecture_id, start_position + len(rows), begin, finish, text,
                json.dumps(item.get("words") or [], separators=(",", ":")),
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
            checkpoint[0] = max(checkpoint[0], float(ready[-1]["end"]))
            connection.execute(
                "UPDATE lectures SET transcription_resume_from = ? WHERE id = ?",
                (checkpoint[0], lecture_id),
            )


def set_transcription_status(lecture_id: str, status: str) -> None:
    with connect_database() as connection:
        connection.execute(
            "UPDATE lectures SET transcription_status = ? WHERE id = ?", (status, lecture_id)
        )


def transcribe_lecture_now(lecture_id: str) -> None:
    """Transcribe one saved recording in the background and store what it finds."""
    try:
        with connect_database() as connection:
            row = connection.execute(
                "SELECT audio_filename, model, transcription_resume_from FROM lectures WHERE id = ?",
                (lecture_id,),
            ).fetchone()
        if row is None:
            return
        audio_path = AUDIO_DIR / row["audio_filename"]
        if not audio_path.exists():
            set_transcription_status(lecture_id, "failed")
            return
        set_transcription_status(lecture_id, "running")
        started = monotonic()
        last_write = [0.0]
        anchor: list[tuple[float, float] | None] = [None]

        def report(done_seconds: float, total_seconds: float) -> None:
            if total_seconds <= 0:
                return
            now = monotonic()
            finished = done_seconds >= total_seconds
            # Throttle: a 50 minute lecture yields hundreds of segments.
            if not finished and now - last_write[0] < 2.0:
                return
            last_write[0] = now
            progress = max(0.0, min(1.0, done_seconds / total_seconds))
            flush_progress_segments(lecture_id, transcript_so_far, checkpoint, done_seconds)

            # Default to the model's measured pace. Extrapolating from wall-clock
            # elapsed is wrong early on, because loading the model is a fixed cost
            # that does not scale with progress.
            pace = MODEL_REALTIME_FACTOR.get(row["model"], 2.0)
            eta = max(0.0, (total_seconds / pace) - (now - started))

            if progress > 0:
                if anchor[0] is None:
                    anchor[0] = (now, progress)
                else:
                    anchor_time, anchor_progress = anchor[0]
                    moved = progress - anchor_progress
                    span = now - anchor_time
                    # Measuring between two progress points is immune to the
                    # model-load cost, so a small delta is already trustworthy.
                    if moved >= 0.05 and span >= 2.0:
                        eta = (1 - progress) * span / moved
            with connect_database() as connection:
                touched = connection.execute(
                    """
                    UPDATE lectures
                    SET transcription_progress = ?, duration_seconds = ?,
                        transcription_eta_seconds = ?
                    WHERE id = ?
                    """,
                    (progress, total_seconds, None if finished else round(eta, 1), lecture_id),
                ).rowcount
            if not touched:
                raise TranscriptionCancelled()

        resume_from = float(row["transcription_resume_from"] or 0.0)
        transcript_so_far: list[dict[str, object]] = []
        checkpoint = [resume_from]
        transcription = transcribe_audio(
            audio_path,
            model_name=row["model"],
            on_progress=report,
            start_seconds=resume_from,
            on_segment=transcript_so_far.append,
        )
        with connect_database() as connection:
            still_there = connection.execute(
                "SELECT id FROM lectures WHERE id = ?", (lecture_id,)
            ).fetchone()
            if still_there is None:
                return
            written_to = checkpoint[0]
            if written_to > 0:
                # Keep everything already committed; only the unflushed tail is new.
                connection.execute(
                    "DELETE FROM transcript_segments WHERE lecture_id = ? AND start_seconds >= ?",
                    (lecture_id, max(0.0, written_to - 0.01)),
                )
                start_position = connection.execute(
                    "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM transcript_segments WHERE lecture_id = ?",
                    (lecture_id,),
                ).fetchone()["next"]
                rows = []
                for segment in transcription.get("segments") or []:
                    text = str(segment.get("text", "")).strip()
                    if not text:
                        continue
                    begin = max(0.0, float(segment.get("start", 0.0)))
                    if begin < written_to - 0.01:
                        continue
                    finish = max(begin, float(segment.get("end", begin)))
                    rows.append((
                        str(uuid4()), lecture_id, start_position + len(rows), begin, finish, text,
                        json.dumps(segment.get("words") or [], separators=(",", ":")),
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
            else:
                replace_transcript_segments(connection, lecture_id, transcription.get("segments"))
            stored = read_transcript_segments(connection, lecture_id)
            full_text = " ".join(item["text"] for item in stored).strip() or transcription["text"]
            connection.execute(
                """
                UPDATE lectures
                SET transcript = ?, transcription_status = 'ready',
                    transcription_progress = 1, transcription_eta_seconds = NULL,
                    transcription_resume_from = 0,
                    duration_seconds = COALESCE(?, duration_seconds)
                WHERE id = ?
                """,
                (full_text, transcription.get("duration_seconds"), lecture_id),
            )
            index_lecture_transcript(connection, lecture_id)
    except TranscriptionCancelled:
        # The recording was deleted while it was being transcribed; nothing to record.
        with connect_database() as connection:
            connection.execute(
                "DELETE FROM transcript_segments WHERE lecture_id = ?", (lecture_id,)
            )
            drop_from_search_index(connection, "transcript", lecture_id)
    except Exception:
        set_transcription_status(lecture_id, "failed")


def queue_transcription(lecture_id: str) -> None:
    with connect_database() as connection:
        connection.execute(
            """
            UPDATE lectures
            SET transcription_status = 'pending', transcription_progress = 0,
                transcription_eta_seconds = NULL
            WHERE id = ?
            """,
            (lecture_id,),
        )
    TRANSCRIBER.submit(transcribe_lecture_now, lecture_id)
