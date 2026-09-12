# Lecture Workspace: Phase 1 Architecture

## Decision

The primary object is a **class note**, not a single audio recording. A class
note is the durable home for either one lecture or a study topic that returns
over several class days. It can be opened with nothing in it, then gradually
collect student notes and multiple dated recording sessions.

```
Library
└── Course folder (optional)
    └── Lecture workspace
        ├── Notes           — student-authored or pasted
        ├── Materials       — private original files (slides, handouts, readings)
        ├── Recording sessions
        │   ├── audio
        │   └── transcript
        │   └── topic markers
        └── Study guide     — editable, private local draft for now
```

A folder remains an organizational container: normally a course or semester.
Inside it, a class note holds the actual subject matter—such as **Cell
Respiration**—rather than forcing students to create a new folder every day.
Folders are optional so a student can capture an unfiled class note when class
is starting.

This yields one simple rule for students:

- Start a **new topic** when class shifts to a distinct subject.
- Add a **recording session** when the current lecture or topic continues,
  including on another day.
- Add a **topic marker** during review when one recording moves to a new idea.
  It points to the exact audio time, so the original session stays intact.

## Entry points

There are two deliberate ways in:

1. **New lecture workspace** creates a blank, persistent workspace. When
   invoked from a folder, that folder is selected automatically. This is the
   right route when a student wants to write notes or add a PDF before recording.
2. **Record a lecture** opens capture immediately. It inherits the current
   folder. On a successful first save, it creates a workspace and its first
   recording session together. Cancelling or denying microphone access creates
   nothing, so the library never fills with empty abandoned workspaces.

Inside an existing workspace, the persistent recording dock adds another
session to that same workspace. A session is therefore a dated piece of audio,
not a new lecture. A student can come back tomorrow and keep recording into the
same lecture context.

The default workspace title uses the existing readable date-and-time title.
Students can rename it later. Starting at the Library root creates an unfiled
workspace; starting in a course folder assigns that folder by default.

## Screen contract

The workspace screen has one purpose: keep class notes and their recordings
together, without showing the same recording twice in separate areas.

```
Breadcrumb + lecture title
────────────────────────────────────────────────
  Notes  |  Recordings & transcript  |  Study guide
────────────────────────────────────────────────
  Notes:      student-owned notes + session list
  Review:     one selected session, audio, transcript, topic markers
  Study:      editable draft based on notes + all session transcripts
```

The notes editor is the default focus. The recording action is visible in the
header on every tab. The review tab isolates replay and transcript reading from
writing, and the study tab keeps generated material visibly separate from the
student's own notes. Mobile is not part of this desktop proof of concept; it
will use this same single-pane tab order rather than compressing columns.

## Data contract for the implementation phase

Phase 2 should add the following relationships without replacing existing user
audio or transcript data:

- `workspaces`: `id`, nullable `folder_id`, `title`, `created_at`, `updated_at`.
- `lectures` becomes the recording-session store by adding nullable
  `workspace_id`. Its existing audio, transcription model, and transcript
  fields remain intact.
- `workspace_notes`: editable, local text notes linked directly to a workspace.
- `workspace_study_notes`: editable study-guide draft separate from student
  notes. Keeping it separate prevents generated text from silently overwriting
  what a student wrote.
- `materials`: original filename, generated local filename, type, size,
  workspace, and upload time. The original stays available for download; the
  database never trusts a browser-provided path.
- `session_markers`: a user label and an audio time on a recording session.
  This is the lightweight bridge when content changes mid-lecture.

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

1. **Notes** for writing or pasting source material.
   The adjacent **Class materials** panel accepts private PDF, Word,
   PowerPoint, text, and Markdown files. A file belongs to the class note, not
   to an individual recording.
2. **Recordings & transcript** for listening to one dated session, reading its
   transcript, and placing/removing topic markers at the current audio time.
3. **Study guide** for an editable local review draft made from the student's
   notes and all saved transcripts in that workspace.

The current study-draft generator is deliberately local and extractive. It is
not represented as an AI model: it never sends student notes, audio, or
transcripts to a cloud provider, and it is intended to validate the review
workflow before selecting an AI provider or asking a student to provide an API
key. Attached files are safely stored and downloadable in this phase; file
content is not silently parsed into the study draft yet.

On first launch after this change, each existing recording is safely attached to
a new one-session workspace using the recording's current title, folder, and
creation time. Audio and transcript files are not rewritten.

## Next implementation check-in

Test whether a student can find their notes, one session's transcript, and the
study guide without explanation. The next material slice is source extraction:
start with text/Markdown and then PDF/Office parsing so an opted-in study guide
can cite attached class materials. AI provider, consent, and cost choices come
after that. Flashcards should come only after the study guide has a trustworthy
source and a student-visible edit/review step.

## Check-in required before implementation

Approve or change this proposed default:

> **Record a lecture** creates a fresh workspace only after the first recording
> is successfully saved; **New lecture workspace** is the explicit blank-canvas
> route.

This keeps class-time capture fast while giving students a clean way to prepare
their notes before class.
