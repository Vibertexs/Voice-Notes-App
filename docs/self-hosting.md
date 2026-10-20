# Run Ekho yourself

Ekho is not on the Play Store yet, so to use it you build the Android app yourself. This guide has
two paths. Pick the one that matches what you want.

| | **A. Just the app** | **B. The whole thing** |
|---|---|---|
| Record and transcribe lectures on your phone | yes | yes |
| Folders, notes, bookmarks, favourites, search by words | yes | yes |
| Share a transcript or the audio | yes | yes |
| Back up and sync between phones | no | yes |
| Search by *meaning*, and "top topics" | no | yes |
| Let Claude or ChatGPT read your lectures | no | yes |
| What you need | a computer, an Android phone, a free Expo account | A, plus a free MongoDB Atlas account, a Google Cloud project, and a server with an `https://` address |
| Time | about 30 minutes (mostly waiting for the build) | an afternoon |

Everything on your phone stays on your phone either way. Audio is never uploaded in either path.

---

## Path A: just the app, no accounts, no server

### What you need
- A computer (Windows, Mac or Linux) with **[Node.js](https://nodejs.org) 22 or newer** and **[Git](https://git-scm.com)**.
- An **Android phone** (the app is Android-first; iPhone is not supported yet).
- A free **[Expo account](https://expo.dev/signup)**. Expo's build service compiles the app for you,
  so you do not need Android Studio. Its free plan includes a limited number of builds each month
  (see Expo's pricing page for the current limit).

### Steps

1. **Get the code.**
   ```bash
   git clone https://github.com/Vibertexs/Voice-Notes-App.git
   cd Voice-Notes-App
   ```

2. **Build the interface** (the screens are a web page that the app displays):
   ```bash
   npm install
   npm run build
   cd mobile
   npm install
   npm run build:web
   ```

3. **Make the project yours.** Open `mobile/app.json` in any text editor and **delete** these two bits,
   which belong to the original author's Expo account:
   - the line `"owner": "vibertexyt"`
   - the `"eas": { "projectId": "..." }` block inside `"extra"`

   Then log in and create your own Expo project (it will ask a couple of questions; accept the defaults):
   ```bash
   npx eas-cli login
   npx eas-cli init
   ```

4. **Build the app.** The `local-only` profile makes a build with no server at all, so it opens straight
   into the app with no sign-in:
   ```bash
   npx eas-cli build --profile local-only --platform android
   ```
   The first time, it asks to create an Android signing key: say **yes**. The build runs on Expo's
   servers and usually takes 10 to 25 minutes. When it finishes it prints a link and a QR code.

5. **Install it.** Open the link on your phone (or scan the QR code), download the `.apk`, and open it.
   Android will ask you to allow installing apps from this source; allow it for this one install.

6. **Use it.** Tap the red button to record. The first time you finish a recording, the app downloads its
   speech model (about 181 MB), so be on Wi-Fi. After that, transcription works offline.

> Always get permission before you record anyone. The app reminds you the first time.

### Updating
Pull the latest code (`git pull`), repeat steps 2 and 4, and install the new APK over the old one. Your
recordings stay.

---

## Path B: with backup, meaning search and AI assistants

You run the server yourself. It is a small Python program plus a MongoDB database.

### What you need (in addition to Path A)
- A free **[MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)** account. The free tier works.
- A **Google Cloud** project (free) for "Sign in with Google".
- A place for the server to live **with an `https://` address**. Android refuses plain `http://` for
  release builds. Options: a small cloud server with a domain (the way the original is deployed; see
  [`cloud-api.md`](cloud-api.md#3-deploy-one-server-docker--caddy--atlas)), or a free tunnel such as
  Cloudflare Tunnel or ngrok that gives your laptop a temporary `https://` address.
- **Python 3.14** (or use the Docker setup from `cloud-api.md`).

### 1. The database
1. In Atlas, create a free cluster (M0).
2. **Database Access:** add a user with a password and the **Read and write to any database** role. (The
   guide in `cloud-api.md` shows how to narrow this to one database, which is better for a real deployment.)
3. **Network Access:** allow the address your server will connect from (for testing at home you can add
   your current IP).
4. **Connect > Drivers:** copy the connection string. You will paste it in the next step.

### 2. The server
```bash
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt        # Windows: .venv\Scripts\pip
cp .env.example .env                                  # Windows: copy .env.example .env
```
Open `.env` and set at least:

| Setting | What to put |
|---|---|
| `MONGODB_URI` | the connection string from Atlas (with your password in it) |
| `JWT_SECRET` | a long random string; make one with `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `GOOGLE_CLIENT_IDS` | your Google *Web* client ID (step 3) |
| `PUBLIC_URL` | the `https://` address people reach your server at (turns on the AI assistant connector) |
| `SEMANTIC_SEARCH` | `false` if you do not want search by meaning (it uses an Atlas preview feature) |
| `LEGAL_OPERATOR`, `LEGAL_CONTACT_EMAIL`, `LEGAL_JURISDICTION` | who runs your copy (shown on `/privacy` and `/terms`) |

Start it:
```bash
.venv/bin/python -m uvicorn cloud_app:app --host 0.0.0.0 --port 8000
```
Open `http://127.0.0.1:8000/readyz`. You should see `{"ok":true,"database":"ok"}`. On first start it
creates the collections, validators and indexes (including the Atlas Search and Vector Search indexes)
for you; the search indexes take a minute or two to build.

Put your `https://` address in front of it (a tunnel, or Caddy as in `cloud-api.md`).

### 3. Google sign-in
In the [Google Cloud console](https://console.cloud.google.com), in your project:
1. **APIs & Services > OAuth consent screen:** set it up (External). While it is in *Testing*, add your
   own Google account as a test user.
2. **Credentials > Create credentials > OAuth client ID:**
   - Type **Web application**. Under **Authorized JavaScript origins** add your server's `https://` address
     (needed for the AI assistant sign-in page). Copy the **Client ID**: this is `GOOGLE_CLIENT_IDS` on the
     server and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in the app build.
   - Type **Android**, with your app's package name (from `mobile/app.json`) and the **SHA-1** of the key your
     build is signed with. `npx eas-cli credentials` shows it.

### 4. Build the app pointing at your server
Do steps 1 to 3 of Path A, then build with your server's address and client ID:
```bash
cd mobile
npx eas-cli build --profile standalone --platform android
```
and give that build your values first: in `mobile/eas.json`, under the `standalone` profile's `env`, add
```json
"EXPO_PUBLIC_CLOUD_API_URL": "https://your-server.example.com",
"EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID": "your-web-client-id.apps.googleusercontent.com"
```
Install the APK as in Path A. The app now opens on a "Continue with Google" screen; sign in with the Google
account you added as a test user.

### 5. Connect an AI assistant (optional)
In the app, open your account (the person icon) and choose **Connect an assistant**. It shows the address
to paste into Claude or ChatGPT and the steps to follow. Sign in with the same Google account.

---

## If something goes wrong

| Symptom | Likely cause |
|---|---|
| `eas build` says you do not own the project | you skipped step 3 of Path A (remove `owner` and `projectId`, then `eas init`) |
| The app asks to sign in and fails | you built with the default profile; use `--profile local-only` for Path A |
| "Cannot find native module" when sharing audio | install a build made from the current code (the sharing module is part of the build) |
| `/readyz` says the database is unreachable | Atlas Network Access does not include your server's address, or the password in `MONGODB_URI` is wrong |
| Search by meaning returns nothing | the vector index is still building (a minute or two), or `SEMANTIC_SEARCH` is off |
| Google says "access blocked" | your account is not a test user on the consent screen |

Questions or problems: open an issue on GitHub.
