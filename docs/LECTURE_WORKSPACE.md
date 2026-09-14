# Lecture Workspace: Product Contract

## The rule

Every saved recording belongs to exactly one **lecture workspace**. A workspace
is the durable home for a topic or a single class meeting: it contains student
notes, any number of dated recording sessions, their timed transcripts and
markers, and lecture-specific attachments. There are no loose recordings.

```
Library
└── Course folder (optional)
    ├── Imported files       — slides, handouts, readings, external notes
    ├── Class AI             — one opt-in guide and question history
    └── Lecture workspace
        ├── Student notes
        ├── Recording sessions
        │   ├── audio + final transcript
        │   └── topic markers
        └── Attachments      — GoodNotes exports, PDFs, slides, readings
```

Folders are optional. A student can start from the Library and create an
unfiled lecture, or record inside a class folder. A lecture workspace can be
dragged into a folder or onto the visible parent destination to move it back
one level; the Library root is the unfiled destination. Moving a workspace
moves all of its sessions together.

## Capture and transcription

**Record & note** opens a ready-to-record lecture in the current folder. The
student deliberately starts microphone capture with the large record control,
then can add capture notes and files while recording. Saving creates the
lecture workspace, while cancelling creates nothing. **Continue recording**
inside an existing workspace adds another dated session to that same topic.

After **Done**, the server runs the student-selected Fast, Balanced, or High
accuracy model over the complete saved audio file. The capture experience stays
focused on the recording and its notes; the durable transcript appears in the
lecture's review tab once processing is complete.

## Review and material handling

The default workspace view is student-owned notes. The review tab exposes one
selected recording with a custom audio deck, accessible scrubber, transcript,
and topic markers. Each marker is a labelled time anchor for later study.

Imported files can be attached to a workspace or kept class-wide in a folder.
The folder screen offers both an **Add file** action and a visible drop zone.
PDF, `.docx`, `.pptx`, Markdown, and text are read locally when possible for
Class AI; GoodNotes pages should be exported to PDF. Scanned PDFs are marked as
needing OCR rather than being represented as readable source material.

## Migration and data integrity

On launch, any historical recording without a workspace receives a new
one-session workspace with its existing title, folder, creation time, notes,
audio, and transcript. The migration changes relationships only; it does not
rewrite audio or transcript files. Future saves always create or use a
workspace, so the UI and database share the same simple model.

Audio, transcripts, markers, files, and SQLite data remain in local `data/`
and are ignored by Git. Class AI is folder-scoped: it can read content in that
course (including child folders), but not another course.
