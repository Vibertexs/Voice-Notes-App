# VoiceFlow

A lecture recorder that transcribes on the phone. No audio ever leaves the device.

## The one thing to know first

**The mobile UI is the web app.** `frontend/` is a React + Vite app; its build is inlined
into `mobile/src/webapp.generated.js` and shown inside a `react-native-webview`. The phone
screen *is* that web page.

So UI work happens in `frontend/src/`, in plain CSS and JSX. There are no React Native
styles to edit. `mobile/App.js` is the native shell — recording, file storage, Whisper —
and it talks to the page over a bridge, not through props.

After changing anything in `frontend/`:

```bash
npm run build          # repo root -> frontend-dist/
cd mobile && npm run build:web   # -> src/webapp.generated.js
```

A JS reload on the phone picks that up. Native changes (`mobile/App.js`, `mobile/src/*.js`)
also reload. Anything under `mobile/patches/` is Java and needs a new EAS build.

## Design system

`frontend/src/styles.css` is the single source of truth. Every colour, size and radius is a
token on `:root`. **Use the tokens; do not introduce new colours.** The palette is
deliberate: surfaces are near-black and desaturated, and the coral→magenta→purple→blue
spectrum is spent only on the record button, the waveforms and primary pills. Saturation
anywhere else reads as a mistake.

Decisions already made, worth not relitigating:

- Navigation is **Record only**. Folders and search live inside the folder screen.
- Recording is pause-gated: you must pause before you can finish.
- Nothing may shift position between recording and paused states. Reserve the space.

When matching a reference image, match it. Do not blend in a second design language, and
do not add a component that duplicates one in `frontend/src/components/`.

## Seeing your work

Do not guess at layout. Two ways to look:

1. **Desktop render** — serve the page and screenshot it in a **390x844 iframe**. Chrome on
   Windows clamps a window to ~500px, so `--window-size=390,844` silently renders at 504px
   and you are not testing the phone layout at all. `mobile/tests/render.test.mjs` has the
   wiring for running `localApi.js` under `sql.js`.
2. **The actual phone** — `adb exec-out screencap -p > shot.png`. This is the only real
   check. `adb logcat -s ReactNativeJS:V` before changing any native code; every native bug
   in this repo's history was found in seconds from the log and slowly from screenshots.

Use `adb exec-out`, never `adb shell cat`, for anything binary — CRLF translation corrupts it.

## Tests

```bash
cd mobile && npm test
```

Five suites, all must pass. They assert design and architecture invariants, not just logic
— if one fails after a UI change, read its rationale before assuming it is stale. Several
encode a bug that was expensive to find.

## Repo map

| Path | What |
|---|---|
| `frontend/src/` | the UI: components, `styles.css`, hooks |
| `mobile/App.js` | native shell: recording, storage, bridge |
| `mobile/src/pcmRecorder.js` | writes the 16 kHz mono PCM WAV whisper.cpp requires |
| `mobile/src/onDeviceWhisper.js` | local Whisper (`small.en`), model download |
| `mobile/src/localApi.js` | the backend, reimplemented on-device over SQLite |
| `mobile/patches/` | Java fixes to the capture module; needs an EAS build |
| `backend/` | Python/FastAPI, serves the desktop app only |
