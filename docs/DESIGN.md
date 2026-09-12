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
recording detail view also includes a destination selector. It is a draft:
selecting a folder does not move the recording. The bottom **Done** button
saves the title and chosen destination together in one request, then returns
the student to that folder. This
prevents an accidental move while the student is still reviewing a new
recording, while drag-and-drop remains an intentional immediate action.

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
time is visible, pause/resume is secondary, **Finish & review** saves the audio
for transcription, and a native, keyboard-accessible **Slide all the way to
cancel** control discards the active capture. This gives the flow a confident
audio-station feel while keeping the destructive action intentional.

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
Nothing is uploaded by this prototype. Attached materials use generated local
filenames rather than browser paths, are limited to supported study formats and
25 MB each, and can be removed one at a time. Deleting a recording removes its
database entry and saved audio, but keeps the surrounding class note and its
student-authored notes. An occupied folder cannot be deleted until its contents
are moved or deleted.

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

A **class note** is now the persistent home for student-authored notes, several
dated recording sessions, transcripts, topic markers, and an editable local
study draft. The design deliberately separates a student's notes from generated
study material and treats a class note as either one lecture or a continuing
topic. The architecture and interaction contract are documented in
[Lecture Workspace](LECTURE_WORKSPACE.md).
