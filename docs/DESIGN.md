# Class Notes Prototype Design

## Product intent

Class Notes is for a student who wants to capture a lecture immediately, then
organize it without interrupting the class. The prototype proves the whole
local flow: record, transcribe, find a recording again, file it, replay it, and
delete it.

## Information architecture

The app has one centered workspace. A compact top bar holds the Library and
New folder actions; breadcrumbs in the main area handle movement between the
root and nested folders.

```
Top bar                         Main area
────────────────────────────   ─────────────────────────────
Library · Recent · New folder   Folder tiles and recording lists
                                Recent-recordings dropdown
                                Recording detail and transcript
                                Folder creation or recording capture
```

The centered workspace keeps the current class context visible without a
permanent navigation rail. The Library button and breadcrumbs provide a direct
route home, while the record action remains at the bottom of every folder view.

Inside a folder, the action row is deliberately limited to **Record & note**,
**Add file**, **Color**, and **Delete**. **Record & note** begins recording in
the current folder immediately and opens the companion notes panel beside it;
there is no up-front choice between audio and writing. The student can hide the
notes panel if they need focus, but it is ready by default. Class AI is a
dedicated section after the folder's imported files, where it is clearly a
class-wide study tool rather than an action attached to one note or recording.

The library has one **Lectures** collection rather than separate “lecture
notes” and “loose recordings” sections. It is a single chronological card feed:
dark cards are continuing lecture notes with their attached recordings, and
light cards are recordings not yet attached to a lecture note. This preserves
the useful distinction without making a student scan two empty states or guess
where a lecture belongs.

## Capture before organization

Every new recording inherits the folder from which the student starts capture.
Starting from the Library root saves to **Unfiled**. This gives an in-context
lecture a sensible home without adding an extra decision before class. The
server assigns a readable date-and-time default name when the title is blank;
the name and destination can both be changed afterward.

Folders are an organizational layer, not a prerequisite for capture. They can
represent a course, a semester, or a topic and may be nested.

## Moving recordings

Drag a recording row onto a folder to file it. Drop targets use a distinct but
subtle blue outline and surface change so it is clear where the recording will
go.

When a student is viewing a folder, one full-width **parent location** target
appears above its contents. Clicking it opens the immediate parent (or the
Library at the top level). Dragging a recording onto the same target moves it
there—one folder level at a time; at the top level, that means Unfiled. The
copy always names the dual behavior directly: "Click to open" and "Drag a
recording here to move it." Breadcrumbs remain available for direct jumps to
any ancestor.

Drag-and-drop is not reliable on every touch or keyboard environment, so the
recording detail view offers an **Attach to lecture** selector as an accessible
alternative. Folder placement is inherited from the place where capture began,
so there is no second “save to folder” decision during review. The bottom
**Done** button saves a name change only. Moving between folders remains an
intentional drag action from the library.

A lecture note can hold any number of recording sessions. Besides recording a
new session from the note itself or dragging one onto its card, the recording
review tab has an **Add recordings** picker for selecting several loose
recordings at once. Each selected recording is attached independently and its
capture notes are appended to the lecture note once.

## Visual language

The interface uses an editorial card system over an airy cool-grey, lightly
glassed workspace. Cards have a clear, substantial outline and generous rounded
corners rather than offset shadows. The border belongs to the surface it frames:
dark inlaid covers use a dark border and pale surfaces use the surrounding
blue-grey. The dark inlaid lower portion of a folder tile consistently holds
its name and action; its colored upper "cover" gives the library personality
without becoming a second navigation language. Folder colors remain decorative
landmarks, not the only way a destination is identified.

The same grammar carries into the rest of the product: top-bar actions are
outlined controls, recording rows are wide bordered surfaces with a small
colored icon, forms and transcript areas are calm light cards, and capture is a
single dark-blue feature card. Blue stays reserved for primary actions and
active/drop states. Folder creation is available from the top bar and from an
empty folder state, while a prominent recording action stays at the bottom of
the workspace. Motion is disabled for users who request reduced motion.

Capture uses one oversized, tactile record control rather than a crowded row
of actions. Once recording begins, a compact transport deck appears: elapsed
time is visible, pause/resume is secondary, **Done** saves the audio
for transcription, and a native, keyboard-accessible **Slide all the way to
cancel** control discards the active capture. This gives the flow a confident
audio-station feel while keeping the destructive action intentional.

**Add notes** opens an optional companion panel beside capture. It is a
save-bound draft rather than a competing second editor: when the student saves
an existing class note's recording, the draft is appended under a timestamped
"Capture notes" heading; for a first recording, it becomes that new class
note's initial content. Discarding or cancelling capture therefore creates no
orphan note. The live waveform uses a small noise gate, eased level changes,
and neighbouring-bar averaging so it reads as stable audio feedback instead of
jittering with every microphone sample.

Folders are portrait covers, deliberately unlike the wide recording rows. A
textured color field sits above a large dark inlay, with a local sequence number,
the folder name, and a plain-language action. Students choose one of six colors
while creating a folder and can change it later from the folder's **Color**
control; this changes the cover field only, leaving the readable information
panel consistent. Color is stored in the local database, is used as a quick
visual landmark rather than the only identifier, and never changes the folder's
organization or sharing state.

Recordings use horizontal rows rather than square tiles because their title,
date, and destination are the information students scan first. The Recent menu
uses the same compact row shape and is placed in the top bar, preventing a
second recording list from repeating the current page's content.

## Privacy and data

Audio, class materials, the SQLite database, transcripts, topic markers, and
study-guide drafts live in the local `data/` folder, which is ignored by Git.
Nothing is uploaded by this prototype. Imported materials use generated local
filenames rather than browser paths, are limited to supported study formats and
25 MB each, and can be removed one at a time. Their readable text is extracted
locally from PDFs, `.docx`, `.pptx`, Markdown, and text files for Class AI;
the original is kept alongside the extracted source. Scanned PDFs are labeled
as needing OCR, and older `.doc`/`.ppt` files are kept but require conversion
before Class AI can read them. Deleting a recording removes its
database entry and saved audio, but keeps the surrounding class note and its
student-authored notes. Deleting a lecture note removes only its written notes
and releases its recordings as loose recordings; imported files are separate
folder-level items and stay in place. An occupied folder cannot be deleted
until its contents are moved or deleted.

The optional AI integration is also local: the server communicates only with an
Ollama process on `127.0.0.1`. It never sends class notes, transcripts, or
question history to a hosted provider. AI belongs to a **class folder**, not a
single lecture note: it can use every saved lecture note, attached recording,
loose recording, and imported file in that class folder (including nested
folders). It never uses data from another class. The server builds a bounded, labeled context for
each response because a local model has a finite context window; this is a
technical limit on one request, not a manual source-selection burden placed on
the student. An installed model does consume local disk, memory, and processing
power, so the interface does not silently download one; it shows the required
one-time setup and stays usable without it.

## Scope intentionally deferred

- Cloud/LLM-backed study-note summaries and flashcards
- Cloud synchronization, sign-in, and sharing
- Native mobile recording and background capture
- Uploading an existing audio file
- Folder renaming and moving folders

These features should follow real student testing of the capture and
organization workflow. The next decision point is whether repeated real
lectures prove the need for a mobile client; the current API and SQLite model
are kept deliberately simple so a mobile app can replace the browser UI later.

## Current product phase

A **class note** is the persistent home for student-authored notes, several
dated recording sessions, transcripts, and topic markers. A **class folder** is
the home for its one optional AI study guide and question history. The design
deliberately separates individual lecture review from cross-lecture study
material and treats a class note as either one lecture or a continuing topic.
The architecture and interaction contract are documented in
[Lecture Workspace](LECTURE_WORKSPACE.md).
