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
