# Ekho: mobile

The app on the phone: the web UI from `frontend/` running in a WebView, with a native
shell underneath it that does everything a web page can't.

## Why it is built this way

The screen you see is the real web build from `frontend/`, running in a
`react-native-webview`. That is deliberate: there is one UI to design, test and maintain,
in plain CSS and JSX, instead of a second set of native screens.

Everything a browser cannot do on a phone is served by the native shell:

| The page asks for | The shell answers with |
| --- | --- |
| `fetch('/api/…')` | SQLite, via `src/localApi.js` |
| `MediaRecorder` | the native PCM recorder, via `src/bridge.js` and `src/pcmRecorder.js` |
| `<audio src=…>` | the file on disk, over a `file://` base origin |
| a finished WAV to transcribe | `whisper.rn` (whisper.cpp) on the phone |
| `/api/account/…` | the sync client, `src/cloudSync.js` |
| a link to a web page | the phone's browser (the page itself never navigates) |

Recording is the reason this is a native app rather than a website on the home screen.
**A WebView's `MediaRecorder` is suspended the moment the screen locks**, which is exactly the
case this app exists to handle. So audio is captured as a pause-safe 16 kHz mono PCM WAV by
`@fugood/react-native-audio-pcm-stream` (patched, see `patches/`), and only a token naming the
file on disk ever crosses into the page. The audio bytes never do.

When the first lecture is finished the app downloads the Whisper `small.en` model
(quantized, about 181 MB) once from Hugging Face. That is the only transcription-related
network request. Whisper then reads the local WAV directly and every later transcription
works offline; lecture audio is never sent anywhere.

## Layout

    App.js                    the shell: WebView, bridge handlers, recorder, local Whisper queue
    src/bridge.js             injected into the page; replaces fetch and MediaRecorder
    src/localApi.js           the backend, on the phone: schema, routes, sync-outbox triggers
    src/cloudSync.js          sync with the server, accounts, assistants (no Expo imports; tested under Node)
    src/googleAuth.js         native Google sign-in
    src/pcmRecorder.js        writes the 16 kHz mono WAV whisper.cpp needs
    src/onDeviceWhisper.js    model download and private whisper.cpp inference
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

## What runs where

Recording, folders, notes, bookmarks, playback, exact-word search and Whisper transcription
all run on the device. Backup, search by meaning and assistant access need the account and the
server (`backend/cloud/`). Whisper, the recorder and Google sign-in contain native code, so the
app needs a development or production build, not Expo Go.

## Builds

Expo Go runs the JS but is Expo's binary, not ours. It does not contain the
native WAV recorder or whisper.cpp, so this app must use a development or
production build. Expo Go is useful only for web-shell iteration, not testing
recording or transcription.

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
asserts the JSON shapes the components read — the client is
unmodified, so a missing field is a broken screen, not a caught error.
