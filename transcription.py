from __future__ import annotations

from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from time import perf_counter

from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

SAMPLE_RATE = 16000


@lru_cache(maxsize=1)
def load_model(
    model_name: str,
    device: str,
    compute_type: str,
) -> WhisperModel:
    """Reuse the active model while keeping local memory use predictable."""
    return WhisperModel(model_name, device=device, compute_type=compute_type)


def transcribe_audio(
    audio_path: Path,
    *,
    model_name: str = "tiny.en",
    device: str = "cpu",
    compute_type: str = "int8",
    language: str | None = "en",
    on_progress: Callable[[float, float], None] | None = None,
    start_seconds: float = 0.0,
    on_segment: Callable[[dict[str, object]], None] | None = None,
) -> dict[str, object]:
    """Transcribe one local audio file and return a JSON-serializable result.

    `on_progress` is called with (seconds_done, seconds_total) as each segment
    lands, so a caller can show real progress instead of a guess.
    """
    started_at = perf_counter()
    model = load_model(model_name, device, compute_type)

    offset = 0.0
    total_seconds = 0.0
    source: object = str(audio_path)
    if start_seconds > 0:
        # Decode once so the already-transcribed head can be skipped.
        samples = decode_audio(str(audio_path), sampling_rate=SAMPLE_RATE)
        total_seconds = len(samples) / SAMPLE_RATE
        offset = max(0.0, min(float(start_seconds), total_seconds))
        source = samples[int(offset * SAMPLE_RATE):]

    segments, info = model.transcribe(
        source,
        beam_size=5,
        language=language,
        vad_filter=True,
    )

    if not total_seconds:
        total_seconds = float(info.duration or 0.0)
    if on_progress is not None:
        on_progress(0.0, total_seconds)

    transcript_segments = []
    for segment in segments:
        entry = {
            "start": round(segment.start + offset, 2),
            "end": round(segment.end + offset, 2),
            "text": segment.text.strip(),
        }
        transcript_segments.append(entry)
        if on_segment is not None:
            on_segment(entry)
        if on_progress is not None:
            done = float(segment.end) + offset
            on_progress(min(done, total_seconds) if total_seconds else done, total_seconds)

    if on_progress is not None:
        on_progress(total_seconds, total_seconds)

    return {
        "audio": str(audio_path),
        "model": model_name,
        "language": info.language,
        "language_probability": round(info.language_probability, 4),
        "duration_seconds": round(total_seconds, 2),
        "start_seconds": round(offset, 2),
        "elapsed_seconds": round(perf_counter() - started_at, 2),
        "text": " ".join(segment["text"] for segment in transcript_segments).strip(),
        "segments": transcript_segments,
    }
