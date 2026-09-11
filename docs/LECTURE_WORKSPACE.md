# Lecture Workspace: Phase 1 Architecture

## Decision

The primary object is a **lecture workspace**, not a single audio recording.
A workspace is the durable home for one class meeting or study topic. It can be
opened with nothing in it, then gradually collect student notes, materials, and
multiple recording sessions.

```
Library
└── Course folder (optional)
    └── Lecture workspace
        ├── Notes           — student-authored, pasted, and AI-assisted later
        ├── Materials       — PDF first; preserved source file
        ├── Recording sessions
        │   ├── audio
        │   └── transcript
        └── Study           — approved flashcards, later
```

A folder remains an organizational container: normally a course, semester, or
topic. It is optional so a student can capture an unfiled lecture when class is
starting. A lecture workspace can live in a folder, or in the Library root.

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

The future workspace screen has one purpose: keep lecture notes and their
recordings together in one place.

```
Breadcrumb + lecture title
────────────────────────────────────────────────
                  Notes editor                    |  Recording sessions
──────────────────────────────────────────────────────────────────────────
                   Persistent recording dock
```

The notes editor is the default focus. The session inspector can collapse on
smaller screens. The recording dock stays available without covering the note.
Mobile is not part of this desktop proof of concept; it
will use a single-pane, tabbed adaptation rather than compressing this layout.

## Data contract for the implementation phase

Phase 2 should add the following relationships without replacing existing user
audio or transcript data:

- `workspaces`: `id`, nullable `folder_id`, `title`, `created_at`, `updated_at`.
- `lectures` becomes the recording-session store by adding nullable
  `workspace_id`. Its existing audio, transcription model, and transcript
  fields remain intact.
- `materials`: source filename, MIME type, workspace, and upload metadata.
- `workspace_notes`: editable, local text notes linked directly to a workspace.
  This is the source the future AI note workflow will receive alongside the
  transcript and PDF material.
- `workspace_notes`: editable notes, provenance (`student` or `ai`), and
  optional links to pages or recording timestamps.

The migration must be transactional. Each existing recording receives one new
workspace using its current title, folder, and creation time, then gets attached
as that workspace's first session. The saved audio file and transcript are not
rewritten. This preserves every existing library item and gives all records a
consistent destination before the UI changes.

## Current implementation

The note-first slice is implemented. A **Note** action creates a persistent
workspace in the active folder (or the Library root) and opens an editable local
note with automatic saving and a manual Save notes action. Every recording
session is displayed beside the notes it belongs to, rather than as a competing
top-level library object.

On first launch after this change, each existing recording is safely attached to
a new one-session workspace using the recording's current title, folder, and
creation time. Audio and transcript files are not rewritten.

## Next implementation check-in

The next slice is PDF material import: accept a single PDF, retain the original
file, render its pages with PDF.js, and connect that material to the same note
and recording sessions. Recording a second session from inside a workspace
follows after that. AI notes, flashcards, non-PDF imports, and mobile remain
later phases.

## Check-in required before implementation

Approve or change this proposed default:

> **Record a lecture** creates a fresh workspace only after the first recording
> is successfully saved; **New lecture workspace** is the explicit blank-canvas
> route.

This keeps class-time capture fast while giving students a clean way to prepare
their notes before class.
