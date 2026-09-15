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

## Builds

Expo Go runs the JS but is Expo's binary, not ours. It cannot grant the
permissions `app.json` declares, so background recording and any native module
are unavailable there. Everything still runs - capture falls back to
foreground-only and transcription is skipped - but that is a development
convenience, not the product.

Three profiles, in `eas.json`:

| Profile | What it is | Needs the laptop? |
| ------- | ---------- | ----------------- |
| `development` | Our binary, JS served by Metro. Hot reload, native modules present. | yes, for JS |
| `standalone` | Everything bundled into an APK. The real thing. | no |
| `production` | An app bundle for the Play Store. | no |

```bash
npx eas-cli login
npx eas-cli build --profile development --platform android   # while building
npx eas-cli build --profile standalone   --platform android   # to hand someone
```

Builds run on Expo's machines, so no Android SDK or JDK is needed locally.
Install the APK from the link the build prints.

iOS needs no Mac to *build* - EAS compiles on Apple hardware - but installing
on a device needs an Apple Developer account.

## Tests

Run from `mobile/`, against `sql.js` and a fake filesystem:

```bash
npm test
```

The suite drives `localApi.js` the way the real web client drives FastAPI, and
asserts the JSON shapes the components actually read — the client is
unmodified, so a missing field is a broken screen, not a caught error.
