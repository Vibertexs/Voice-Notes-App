# Class Notes — mobile

Everything runs on the phone. No server, no account, no network.

## Run it

```bash
cd mobile
npm install
npx expo start
```

Scan the QR with **Expo Go** (iOS: Camera app, Android: the Expo Go app).

## What to test

The point of this build is one question: **does a recording survive a locked phone?**

1. Start a recording
2. Lock the screen, put the phone face down
3. Wait several minutes
4. Unlock, pause, save
5. Play it back — is the whole thing there?

Also worth trying: switch to another app mid-recording, and take a phone call.

## If background recording fails in Expo Go

Expo Go runs inside its own app container, so `UIBackgroundModes` from `app.json`
may not apply. If recording stops when the screen locks, build a dev client —
that uses this project's own native config:

```bash
npx expo run:ios      # needs Xcode
npx expo run:android  # needs Android Studio
```

## Layout

```
App.js                 three screens, no router
src/store.js           SQLite metadata + audio files on disk
src/RecordScreen.js    capture, background audio session, crash-safe row
src/DetailScreen.js    playback, notes, rename, delete
src/LibraryScreen.js   list of lectures
```

## Design notes

**Audio never sits in memory.** The recorder writes straight to a file and
playback streams from it. A 50-minute lecture is ~25MB on disk but ~190MB
decoded, which a phone will not tolerate.

**The database row is written before recording starts.** If the OS kills the app
mid-lecture, the row points at whatever audio reached the disk, and the next
launch adopts it instead of losing it.

## Not here yet

Transcription. That is the next step, and deliberately separate: this build
exists to prove capture is reliable before anything is built on top of it.
