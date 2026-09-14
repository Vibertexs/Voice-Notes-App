from __future__ import annotations

from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from time import perf_counter

import gc
import io as _io

import av
import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.audio import (
    _group_frames,
    _ignore_invalid_frames,
    _resample_frames,
    decode_audio,
)

SAMPLE_RATE = 16000
# Seeking lands on a packet boundary, so rewind a little and let the caller trim.
SEEK_MARGIN_SECONDS = 1.0


def decode_audio_from(
    audio_path: Path | str,
    start_seconds: float = 0.0,
    sampling_rate: int = SAMPLE_RATE,
) -> tuple[np.ndarray, float]:
    """Decode only the tail of a file.

    Decoding a whole recording costs time proportional to its length, which is
    why a live pass fell further behind the longer a lecture ran. Seeking first
    makes each pass cost only the new audio.

    Returns the samples and the real start time they begin at.
    """
    if start_seconds <= 0:
        return decode_audio(str(audio_path), sampling_rate=sampling_rate), 0.0

    resampler = av.audio.resampler.AudioResampler(
        format="s16", layout="mono", rate=sampling_rate
    )
    raw_buffer = _io.BytesIO()
    dtype = None
    actual_start: float | None = None
    target = max(0.0, float(start_seconds) - SEEK_MARGIN_SECONDS)

    with av.open(str(audio_path), mode="r", metadata_errors="ignore") as container:
        stream = container.streams.audio[0]
        container.seek(int(target / stream.time_base), stream=stream)

        def note_first(source):
            nonlocal actual_start
            for frame in source:
                if actual_start is None and frame.pts is not None:
                    actual_start = float(frame.pts * stream.time_base)
                yield frame

        frames = _ignore_invalid_frames(container.decode(audio=0))
        frames = note_first(frames)
        frames = _group_frames(frames, 500000)
        frames = _resample_frames(frames, resampler)
        for frame in frames:
            array = frame.to_ndarray()
            dtype = array.dtype
            raw_buffer.write(array)

    del resampler
    gc.collect()

    if dtype is None:
        return np.zeros(0, dtype=np.float32), float(target)
    audio = np.frombuffer(raw_buffer.getbuffer(), dtype=dtype).astype(np.float32) / 32768.0
    return audio, float(actual_start if actual_start is not None else target)


@lru_cache(maxsize=2)
def load_model(
    model_name: str,
    device: str,
    compute_type: str,
) -> WhisperModel:
    """Keep the live draft model and one selected final model warm locally."""
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
    live: bool = False,
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
        # Seek instead of decoding the whole file, so cost tracks new audio only.
        samples, offset = decode_audio_from(audio_path, start_seconds)
        total_seconds = offset + len(samples) / SAMPLE_RATE
        source = samples

    segments, info = model.transcribe(
        source,
        # Captions are explicitly a short-lived draft, so favor a quick first
        # hypothesis. The saved pass keeps the slower, higher-quality beam.
        beam_size=1 if live else 5,
        condition_on_previous_text=False if live else True,
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
