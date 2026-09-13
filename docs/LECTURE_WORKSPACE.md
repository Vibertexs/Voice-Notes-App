# Lecture Workspace: Phase 1 Architecture

## Decision

The library has three first-class objects: a **lecture note**, a **loose
recording**, and an **imported file**. A lecture note is the durable home for a
topic that returns over several class days; it can be opened empty and gradually
collect student notes, multiple dated recording sessions, and its own attached
study files. Imported files can also be course-wide resources in a folder. A
loose recording is a fast, low-friction capture that has not been assigned to a
lecture note yet.

```
Library
└── Course folder (optional)
    ├── Class AI            — one opt-in guide and question history
    │   └── All saved data in this class, within a bounded model context
    ├── Imported files      — slides, handouts, readings, and external notes
    └── Lecture workspace
        ├── Notes           — student-authored or pasted
        ├── Attachments     — GoodNotes exports, slides, handouts, and readings
        ├── Recording sessions
        │   ├── audio
        │   └── transcript
        │   └── topic markers
    └── Loose recording
        ├── audio + transcript
        └── optional capture notes
```

A folder remains an organizational container: normally a course or semester.
Inside it, a class note holds the actual subject matter—such as **Cell
Respiration**—rather than forcing students to create a new folder every day.
Folders are optional so a student can capture an unfiled class note when class
is starting.

This yields one simple rule for students:

- Use **Record & note** from a class folder for a new lecture. Saving its first
  capture makes the durable lecture page automatically.
- Use **Continue recording** from an open lecture whenever the material
  continues, including on another day. The new session stays with that note.
- Use **Attach file** for slides, handouts, readings, or a GoodNotes PDF export
  that belongs to that lecture; use the folder file collection for class-wide
  materials.
- Add a **marker** while recording when the instructor changes topic. The
  marker is saved at that exact audio time and stays clickable during review.

## Entry points

There are two deliberate ways in:

1. **New lecture workspace** creates a blank, persistent workspace. When
   invoked from a folder, that folder is selected automatically. This is the
   right route when a student wants to write notes or add a PDF before recording.
2. **Record a lecture** opens capture immediately. It inherits the current
   folder. On a successful save it creates a loose recording with a readable
   default title. The student can drag it onto a lecture note later; it can also
   be made loose again during review. Cancelling or denying microphone access
   creates nothing, so the library never fills with empty abandoned workspaces.

Inside an existing workspace, the blue **Continue recording** bar adds another
session to that same workspace. A session is therefore a dated piece of audio,
not a new lecture. A student can come back tomorrow and keep recording into the
same lecture context. Capture notes saved with a loose recording remain with it
until it is attached, then are appended to the target lecture note with a clear
recording label.

The default workspace title uses the existing readable date-and-time title.
Students can rename it later. Starting at the Library root creates an unfiled
workspace; starting in a course folder assigns that folder by default.

## Screen contract

The workspace screen has one purpose: keep class notes and their recordings
together, without showing the same recording twice in separate areas. AI is
deliberately outside that screen: it is a course-level tool, reached from the
folder or a shortcut that opens the course's Class AI view.

```
Breadcrumb + lecture title
────────────────────────────────────────────────
  Continue recording
────────────────────────────────────────────────
  Notes  |  Recordings & transcript
────────────────────────────────────────────────
  Notes:      student-owned notes + session list
  Review:     one selected session, scrubber, transcript, topic markers
```

The notes editor is the default focus. The recording action is visible above
every tab. The review tab isolates replay and transcript reading from writing.
Its audio deck exposes play/pause, ten-second skips, an accessible scrubber,
and clear elapsed/total time rather than depending on the browser's native
audio appearance. Mobile is not part of this desktop proof of concept; it will
use this same single-pane tab order rather than compressing columns.

The Class AI view is scoped to one course folder. Every generated guide or
answer can use all saved lecture notes, attached recording transcripts, loose
recordings, capture notes, and imported files in that course (including nested
folders), but it never crosses into another course. The server labels and bounds the assembled
context to fit the installed model's context window. This removes manual source
selection while preserving a predictable privacy and course boundary.

## Data contract for the implementation phase

Phase 2 should add the following relationships without replacing existing user
audio or transcript data:

- `workspaces`: `id`, nullable `folder_id`, `title`, `created_at`, `updated_at`.
- `lectures` becomes the recording-session store by adding nullable
  `workspace_id`, plus `is_standalone` for a loose recording. Its existing
  audio, transcription model, and transcript fields remain intact.
- `workspace_notes`: editable, local text notes linked directly to a workspace.
- `workspace_study_notes`: editable study-guide draft separate from student
  notes. Keeping it separate prevents generated text from silently overwriting
  what a student wrote.
- `materials`: nullable `workspace_id` and `folder_id`, original filename,
  generated local filename, type, size, upload time, locally extracted text,
  and extraction status. A lecture attachment inherits its workspace's folder
  so Class AI can use it; class-wide materials have no workspace relationship.
  The original stays available for download; the database never trusts a
  browser-provided path.
- `session_markers`: a user label and an audio time on a recording session.
  This is the lightweight bridge when content changes mid-lecture.
- `folder_ai_notes`: one editable AI study guide per class folder, kept
  separate from student-authored lecture notes.
- `folder_ai_messages`: a folder-scoped history of student questions and
  local-model answers, stored only in the local database.

The migration must be transactional. Each existing recording receives one new
workspace using its current title, folder, and creation time, then gets attached
as that workspace's first session. The saved audio file and transcript are not
rewritten. This preserves every existing library item and gives all records a
consistent destination before the UI changes.

## Current implementation

The note-first slice is implemented. A **Note** action creates a persistent
workspace in the active folder (or the Library root) and opens an editable local
note with automatic saving and a manual Save notes action. A workspace now has
three deliberate review spaces:

1. **Notes** for writing or pasting source material, with **Attachments** below
   for files that belong to that lecture. A lecture attachment can be a
   GoodNotes export (PDF), slides, a handout, or a reading. Class-wide imported
   files still appear as their own collection in the course folder. Both scopes
   accept private PDF, Word, PowerPoint, text, and Markdown files. Text from
   PDF, `.docx`, `.pptx`, Markdown, and text files is extracted locally for
   Class AI; scanned PDFs are clearly marked as needing OCR and older
   `.doc`/`.ppt` files need conversion first.
2. **Recordings & transcript** for listening to one dated session, reading its
   transcript, and placing/removing topic markers at the current audio time.
3. **Class AI**, reached from a course folder or from any lecture inside it,
   for one editable course guide and one question history. It uses an installed
   local Ollama model only when the student opts in; it is disabled with plain
   setup directions otherwise. It has access to all saved data in that course,
   including loose recordings, rather than asking the student to choose sources
   on each request.

The current study-draft generator is deliberately local and extractive. It is
not represented as an AI model: it never sends student notes, audio, or
transcripts to a cloud provider, and it is intended to validate the review
workflow before selecting an AI provider or asking a student to provide an API
key. Attached files are safely stored and downloadable in this phase; file
content is not included in the no-model study draft yet.

The local-AI option is intentionally a provider adapter, not a hard dependency:
the browser app speaks only to this FastAPI server, and the server speaks only
to an Ollama process at `127.0.0.1`. It constrains each prompt to the
student's saved notes, attached recordings, and loose recordings from one class
folder, plus locally extracted text from supported imported files, and bounds
the assembled prompt to the local model's context window. It keeps unreadable
or unprocessed files clearly labeled rather than pretending they are sources.
It saves question history once for that class. The default setup
recommendation is `qwen3:1.7b`, a roughly 1.4 GB Apache-2.0 open-weight model;
students can select another model that is already installed locally.

On first launch after this change, each existing recording is safely attached to
a new one-session workspace using the recording's current title, folder, and
creation time. Audio and transcript files are not rewritten.

## Next implementation check-in

Test whether a student can find their notes, a loose recording, one session's
transcript, uploaded materials, and the class guide without explanation. Next,
install and test the local model on this laptop before measuring note quality,
source coverage, and response time. Then add OCR or a student-visible source
preview for scanned or diagram-heavy files. Flashcards should come only after
the AI notes have a trustworthy source and a student-visible edit/review step.

## Check-in required before implementation

The implemented default is:

> **+ Recording** saves a loose recording after capture; **+ Note** is the
> explicit blank-canvas route. A loose recording can be dragged to a lecture
> note or made loose again later.

This keeps class-time capture fast while giving students a clean way to prepare
their notes before class without guessing the eventual lecture destination.
