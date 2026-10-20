# Play Store listing

Text and answers for the Play Console. Everything here matches what the app and server do
(see `backend/cloud/legal.py`); if one changes, change the other.

## Basics

| Field | Value |
|---|---|
| App name | Ekho: Lecture Recorder |
| Short description (80 chars) | Record lectures, get transcripts on your phone. Your audio never leaves it. |
| Category | Education (alternative: Productivity) |
| Contact email | the address set in `LEGAL_CONTACT_EMAIL` |
| Privacy policy URL | `https://api.ekhoapp.tech/privacy` |
| Account deletion URL | `https://api.ekhoapp.tech/delete-account` |
| Icon / feature graphic | `play-icon-512.png`, `feature-graphic-1024x500.png` (this folder) |
| Screenshots | at least 2 phone screenshots, 16:9 to 9:16; real device captures are best (`docs/screenshots/` are rendered samples) |

## Full description

Ekho records your lectures and turns them into searchable text, right on your phone.

**Private by design**
- Transcription happens on your device. Your audio is never uploaded.
- Sign in with Google to back up the text (transcripts, titles, folders, bookmarks and notes) and
  keep it in sync between phones.
- No ads, no tracking.

**Made for studying**
- Replay a lecture with the words highlighted as they are spoken.
- Bookmark important moments while you record, and add your own notes.
- Organize recordings into colour-coded folders.
- Search every lecture by the words said, or by what they meant: search "bread" and find the
  lecture about sandwiches.

**Use your own AI assistant (optional)**
- Connect Claude, ChatGPT or another assistant that supports MCP. It can search and read your
  lectures, read-only, and you can disconnect it any time.

**Please record responsibly.** Always get permission before you record. Laws and school rules
about recording vary, and many places require everyone's consent.

Transcripts are automatic and can contain mistakes. The first time you finish a recording the app
downloads its speech model (about 181 MB), so use Wi-Fi.

## Data safety form

Answers that match the privacy policy. Confirm against the current form wording before submitting.

**Does the app collect or share user data?** Collects: yes. Shares with third parties: no (the
service providers named in the policy process data on our behalf, which Google does not count as
"sharing").

**Is all data encrypted in transit?** Yes (HTTPS).
**Can users request deletion?** Yes (in app, and at the account deletion URL).

| Data type | Collected | Purpose | Optional? |
|---|---|---|---|
| Email address | yes | account management | required to back up |
| User IDs (Google account id) | yes | account management | required to back up |
| Audio files | **no** (never leaves the device) | n/a | n/a |
| Other user-generated content (transcripts, titles, notes, bookmarks, folder names) | yes | app functionality (backup, sync, search) | optional (only if signed in) |
| Search queries (meaning search) | yes, sent to the server, not stored | app functionality | optional (can be turned off) |
| App activity, device or other IDs, location, contacts, financial, health, photos | no | n/a | n/a |
| Crash logs, diagnostics | no | n/a | n/a |

Server logs (IP address, request details) are kept briefly for security; declare "IP address" under
device or other IDs only if the form's definition requires it.

## Other declarations

- **Target audience:** 13 and over (not designed for children).
- **Content rating:** no violence, no user-to-user sharing; answer the questionnaire accurately (utility
  or reference app). It records audio, so say so where asked.
- **Permissions:** microphone (to record), foreground service for microphone and media playback
  (to keep recording when the screen locks), notifications (recording status), internet.
- **App access for reviewers:** the app requires Google sign-in. Provide a Google test account in
  the "App access" instructions, and add it as a test user on the OAuth consent screen if it is still
  in Testing mode.
- **Ads:** none.
