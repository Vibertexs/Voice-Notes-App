# Voice Notes Whisper POC

This is the first foundation test for the class voice-notes app: prove that we can turn an audio recording into text before building the Expo mobile UI.

## Why this path

The POC uses `faster-whisper`, an open-source Whisper implementation backed by CTranslate2. It is a practical first backend choice because the mobile app can upload a recording to a small server endpoint later, while we keep the speech-to-text engine swappable.

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
```

## Create a Sample Audio File

```powershell
.\scripts\make_sample_audio.ps1
```

## Transcribe

```powershell
.\.venv\Scripts\python transcribe.py .\sample-class-note.wav --output transcript.json
```

The first transcription run downloads the selected Whisper model. The default is `tiny.en` so the first test is quick.

## What Success Looks Like

The command should print JSON with:

- `text`: the full transcript
- `segments`: timestamped transcript chunks
- `duration_seconds`: audio length
- `elapsed_seconds`: transcription runtime

Once this works, the next step is wrapping this script in a tiny API that the Expo app can call after recording audio.

## Try the Browser UI

The local browser UI is a student lecture library. Its persistent sidebar has
two primary actions: **New recording** and **New folder**. New recordings are
saved as unfiled items with a timestamped default name; drag them into a course
folder later, or move them back to Unfiled. Each recording saves its audio and
raw transcript on this computer. The saved data is stored under `data/`, which
is intentionally excluded from Git.

```powershell
.\.venv\Scripts\python -m uvicorn app:app --reload
```

Then open http://127.0.0.1:8000, allow microphone access, record a short note,
and select **Stop & transcribe**. This development server is intentionally bound
to your computer; do not expose it to the internet without authentication,
HTTPS, and stronger upload controls.

The UI offers three locally-run English models: `tiny.en` for speed, `base.en`
as the default balance, and `small.en` for higher accuracy. Each model is
downloaded only the first time you select it. Start with the same recording in
each mode and compare the transcript and elapsed time before choosing a default.

Recordings receive a timestamped default title when no name is entered, and can
be renamed later. Use **Delete recording** in the app to remove its transcript
and saved audio from this computer. See [the prototype design notes](docs/DESIGN.md)
for the product and interaction decisions behind this version.
