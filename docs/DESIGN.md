# Class Notes Prototype Design

## Product intent

Class Notes is for a student who wants to capture a lecture immediately, then
organize it without interrupting the class. The prototype proves the whole
local flow: record, transcribe, find a recording again, file it, replay it, and
delete it.

## Information architecture

The app has one durable sidebar and one changing content area.

```
Sidebar                         Main area
────────────────────────────   ─────────────────────────────
New recording                   Unfiled recordings or folder contents
New folder                      Recording detail and transcript
Unfiled recordings              Folder creation or recording capture
Folders
Recent recordings
```

The sidebar remains visible while recording, viewing a transcript, or managing
folders. A student never has to navigate away to create the next item.

## Capture before organization

Every new recording is saved to **Unfiled recordings**, even when the student
was browsing a folder. Naming a lecture or choosing a course before class adds
friction at exactly the wrong moment. The server assigns a readable,
date-and-time default name when the title is blank. The name can be changed
afterward.

Folders are an organizational layer, not a prerequisite for capture. They can
represent a course, a semester, or a topic and may be nested.

## Moving recordings

Drag a recording row or sidebar item onto a folder to file it. Drag it onto
**Unfiled** to remove it from a folder. Drop targets use a distinct but subtle
blue outline and surface change so it is clear where the recording will go.

When a student is viewing a folder, a full-width return zone appears directly
above its contents. In a nested folder it moves a recording to the immediate
parent folder—not all the way back to Unfiled. At the top folder level, that
same target moves it to Unfiled. This follows the user's mental model of
"going back one level" while retaining the sidebar's explicit root destination.

Drag-and-drop is not reliable on every touch or keyboard environment, so the
recording detail view also includes a destination selector. It is a draft:
selecting a folder does not move the recording. The bottom **Save changes**
button saves the title and chosen destination together in one request. This
prevents an accidental move while the student is still reviewing a new
recording, while drag-and-drop remains an intentional immediate action.

## Visual language

The interface uses a frosted-glass workspace over a soft blue background so the
library feels like one focused surface rather than several boxed-in pages.
System type, simple recording rows, restrained motion, and blue primary actions
keep that effect legible rather than decorative. The two creation actions stay
together in the sidebar, while the main area stays focused on the current
location. Motion is disabled for users who request reduced motion.

Folders are square tiles: their consistent footprint makes a course library
easy to scan without turning recordings into another card grid. Students choose
one of six folder colors while creating a folder and can change it later from
the folder's **Color** control. Color is stored in the local database, is used
as a quick visual landmark rather than the only identifier, and never changes
the folder's organization or sharing state.

## Privacy and data

Audio, the SQLite database, and transcripts live in the local `data/` folder,
which is ignored by Git. Nothing is uploaded by this prototype. Deleting a
recording removes its database entry and saved audio. An occupied folder cannot
be deleted until its contents are moved or deleted.

## Scope intentionally deferred

- Automatic study-note summaries, diagrams, and flashcards
- Cloud synchronization, sign-in, and sharing
- Native mobile recording and background capture
- Uploading an existing audio file
- Folder renaming and moving folders

These features should follow real student testing of the capture and
organization workflow. The next decision point is whether repeated real
lectures prove the need for a mobile client; the current API and SQLite model
are kept deliberately simple so a mobile app can replace the browser UI later.
