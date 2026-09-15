# Class Notes — mobile

The web UI, running on a phone, with a native shell underneath it.

## Why it is built this way

The screen you see is the real web build from `frontend/`, unmodified, running
in a WebView. That is deliberate: it is the same code, so the phone looks
exactly like the desktop app and there is one UI to maintain rather than two.

Everything a browser cannot do on a phone is served by the native shell:

| The page asks for       | The shell answers with              |
| ----------------------- | ----------------------------------- |
| `fetch('/api/…')`       | SQLite, via `src/localApi.js`       |
| `MediaRecorder`         | `expo-audio`, via `src/bridge.js`   |
| `<audio src=…>`         | the file on disk, over a `file://` base origin |

Recording is the reason this is a native app rather than a website saved to the
home screen. **A WebView's `MediaRecorder` is suspended the moment the screen
locks** — which is precisely the case this app exists to handle. So audio is
captured by `expo-audio`, and only a token naming the file on disk ever crosses
into the page. The bytes never do.

## Layout

    App.js                    the shell: WebView, bridge handlers, the recorder
    src/bridge.js             injected into the page; replaces fetch and MediaRecorder
    src/localApi.js           the backend, on the phone: schema, routes, serializers
    src/webapp.generated.js   the inlined web build (generated, do not edit)
    scripts/bundle-web.mjs    regenerates the above from frontend-dist/

## Working on it

The web UI is built from the repo root, then inlined:

```bash
npm run build          # at the repo root, writes frontend-dist/
cd mobile
npm run build:web      # inlines frontend-dist/ into src/webapp.generated.js
npx expo start
```

Any change to `frontend/` needs both build steps before it shows up on the
phone. Changing only `App.js`, `src/bridge.js`, or `src/localApi.js` needs
neither — Fast Refresh picks those up.

## What does not work on the phone yet

Transcription and the AI features need the Python service and its models. Those
endpoints return a 503 with a plain explanation rather than a stub that looks
like it worked, so a screen that depends on them says so instead of showing
empty results. Recording, classes, lectures, notes, markers, search and
playback all run entirely on the device.

## Background recording

`app.json` declares what background capture needs — `UIBackgroundModes: audio`
on iOS, and the foreground-service and notification permissions on Android.

**None of that applies in Expo Go**, which ships its own fixed native manifest.
If the OS refuses to arm the recorder there, the shell retries without
background capture so recording still works, and the recording simply stops if
you leave the app. To get real lock-screen capture, make a dev build:

```bash
npx expo run:android      # or: npx expo run:ios
```

## Tests

Run from `mobile/`, against `sql.js` and a fake filesystem:

```bash
npm test
```

The suite drives `localApi.js` the way the real web client drives FastAPI, and
asserts the JSON shapes the components actually read — the client is
unmodified, so a missing field is a broken screen, not a caught error.
