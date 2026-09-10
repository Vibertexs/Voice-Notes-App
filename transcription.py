from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from time import perf_counter

from faster_whisper import WhisperModel


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
) -> dict[str, object]:
    """Transcribe one local audio file and return a JSON-serializable result."""
    started_at = perf_counter()
    model = load_model(model_name, device, compute_type)
    segments, info = model.transcribe(
        str(audio_path),
        beam_size=5,
        language=language,
        vad_filter=True,
    )

    transcript_segments = [
        {
            "start": round(segment.start, 2),
            "end": round(segment.end, 2),
            "text": segment.text.strip(),
        }
        for segment in segments
    ]

    return {
        "audio": str(audio_path),
        "model": model_name,
        "language": info.language,
        "language_probability": round(info.language_probability, 4),
        "duration_seconds": round(info.duration, 2),
        "elapsed_seconds": round(perf_counter() - started_at, 2),
        "text": " ".join(segment["text"] for segment in transcript_segments).strip(),
        "segments": transcript_segments,
    }
