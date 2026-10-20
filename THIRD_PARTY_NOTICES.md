# Third-party notices

Ekho is MIT licensed (see [LICENSE](LICENSE)). It is built on open-source software and uses a
speech model, each under its own license. This list names the main pieces; it is a good-faith
summary, not a complete bill of materials. Each project's own license text is the authority,
and the full dependency tree is in `package-lock.json`, `mobile/package-lock.json` and
`requirements-cloud.txt`.

## On the phone

| Component | Use | License |
|---|---|---|
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (via [whisper.rn](https://github.com/mybigday/whisper.rn)) | on-device speech recognition | MIT |
| [OpenAI Whisper](https://github.com/openai/whisper) model weights (`small.en`, quantized `ggml` build from `ggerganov/whisper.cpp` on Hugging Face) | the speech model the app downloads once | MIT |
| [Expo](https://github.com/expo/expo) (SDK, `expo-sqlite`, `expo-file-system`, `expo-keep-awake`, `expo-splash-screen`) | app framework and platform APIs | MIT |
| [React Native](https://github.com/facebook/react-native), [React](https://github.com/facebook/react) | app runtime and UI | MIT |
| [react-native-webview](https://github.com/react-native-webview/react-native-webview) | shows the interface | MIT |
| [@react-native-google-signin/google-signin](https://github.com/react-native-google-signin/google-signin) | Google sign-in | MIT |
| [@fugood/react-native-audio-pcm-stream](https://github.com/mybigday/react-native-audio-pcm-stream) (patched, see `mobile/patches/`) | microphone capture | MIT |
| [Figtree](https://github.com/erikdkennedy/figtree) | typeface | SIL Open Font License 1.1 |

## On the server

| Component | Use | License |
|---|---|---|
| [FastAPI](https://github.com/fastapi/fastapi), [Starlette](https://github.com/encode/starlette), [Pydantic](https://github.com/pydantic/pydantic) | web framework and validation | MIT |
| [Uvicorn](https://github.com/encode/uvicorn), [httpx](https://github.com/encode/httpx) | server and HTTP client | BSD-3-Clause |
| [PyMongo](https://github.com/mongodb/mongo-python-driver) | MongoDB driver | Apache-2.0 |
| [Model Context Protocol Python SDK](https://github.com/modelcontextprotocol/python-sdk) | the assistant-facing MCP server | MIT |
| [argon2-cffi](https://github.com/hynek/argon2-cffi), [PyJWT](https://github.com/jpadilla/pyjwt) | password hashing and tokens | MIT |
| [Caddy](https://github.com/caddyserver/caddy) | HTTPS reverse proxy | Apache-2.0 |

## Services

Ekho uses MongoDB Atlas (database, search and embeddings), Amazon Web Services (hosting and
backups), Google (sign-in), Resend (account email) and Hugging Face (model download). They are
described in the privacy policy served at `/privacy`.
