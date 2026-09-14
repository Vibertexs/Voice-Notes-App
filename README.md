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

The local browser UI is a student lecture library. **Record & note** starts
immediately from the Library or a folder; when saved, it becomes an editable
lecture page with that recording attached. Reopen the page to keep writing or
record another session on the same topic. Every recording has a lecture page;
historical loose recordings are migrated safely into one-session pages on
startup. Drag a lecture card onto a folder to organize it, or onto the visible
parent target to move it out one level.
**Imported files** can be kept class-wide in a folder or attached directly to
one lecture page. Use a lecture's **Attach file** action for a GoodNotes export,
slides, a handout, or a reading that belongs with that session; export GoodNotes
pages as PDFs first. The file action accepts PDF, `.docx`, `.pptx`, text, and
Markdown files up to 25 MB each. Compatible text is extracted locally and
becomes a source for Class AI, while the original remains on this computer under
`data/`, which is intentionally excluded from Git. Scanned PDFs need OCR, and
older `.doc`/`.ppt` files should be exported to PDF, `.docx`, or `.pptx` first.

```powershell
.\.venv\Scripts\python -m uvicorn app:app --reload
```

Then open http://127.0.0.1:8000, allow microphone access, record a short note,
and select **Stop & transcribe**. This development server is intentionally bound
to your computer; do not expose it to the internet without authentication,
HTTPS, and stronger upload controls.

The UI uses `tiny.en` automatically for fast, local live captions while class
is in progress. After you tap Done, it re-transcribes the complete recording
with your selected Fast (`tiny.en`), Balanced (`base.en`), or High accuracy
(`small.en`) model. That keeps captions responsive without compromising the
saved transcript. Each model is downloaded only the first time it is used.

Recordings receive a timestamped default title when no name is entered, and can
be renamed later. Use **Delete recording** in the app to remove its transcript
and saved audio from this computer. See [the prototype design notes](docs/DESIGN.md)
for the product and interaction decisions behind this version.

## Optional local AI

The **AI study** tab is designed to use [Ollama](https://ollama.com/download/windows)
on this laptop. It sends requests only to `http://127.0.0.1:11434`, never to a
hosted AI provider. After installing Ollama, download the prototype's default
Apache-2.0 model once:

```powershell
ollama pull qwen3:1.7b
```

Then refresh the browser app. The tab will offer locally generated notes and
questions over the current class note and its recording transcripts. The model
download is roughly 1.4 GB; it has no per-request cost, but does use this
laptop's RAM and processor while responding.
