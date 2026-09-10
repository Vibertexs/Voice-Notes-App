from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from transcription import transcribe_audio

app = FastAPI(title="Voice Notes POC")

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
ALLOWED_SUFFIXES = {".wav", ".mp3", ".m4a", ".ogg", ".webm", ".mp4"}
TRANSCRIPTION_MODELS = {"tiny.en", "base.en", "small.en"}


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse("static/index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/transcriptions")
def create_transcription(
    audio: UploadFile = File(...),
    model: str = Form(default="base.en"),
) -> dict[str, object]:
    if model not in TRANSCRIPTION_MODELS:
        raise HTTPException(status_code=400, detail="Choose a supported transcription quality.")

    suffix = Path(audio.filename or "recording.webm").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=415, detail="Upload a supported audio file.")

    with tempfile.TemporaryDirectory(prefix="voice-notes-") as temp_dir:
        audio_path = Path(temp_dir) / f"recording{suffix}"
        total_bytes = 0
        with audio_path.open("wb") as destination:
            while chunk := audio.file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail="The recording exceeds the 25 MB limit.",
                    )
                destination.write(chunk)

        if total_bytes == 0:
            raise HTTPException(status_code=400, detail="The recording was empty.")

        try:
            result = transcribe_audio(audio_path, model_name=model)
        except Exception as error:
            raise HTTPException(
                status_code=422,
                detail="The recording could not be transcribed. Try a different audio format.",
            ) from error

    return {
        key: result[key]
        for key in (
            "model",
            "language",
            "language_probability",
            "duration_seconds",
            "elapsed_seconds",
            "text",
            "segments",
        )
    }
