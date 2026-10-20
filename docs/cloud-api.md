# VoiceFlow Cloud API

Accounts and sync for the phone app, on FastAPI and MongoDB Atlas. Transcripts
and metadata only: **audio never leaves the phone that recorded it.**

```
phone (SQLite)  ──POST /v1/sync──▶  cloud_app.py (FastAPI)  ──▶  MongoDB Atlas
phone (SQLite)  ◀──changes since───┘        ▲
                                            └── /v1/recordings, /v1/search … (REST; the future MCP server)
```

The phone keeps working exactly as before with no account and no network. Signing
in adds sync on top; it never puts the network between the user and their screen.

---

## 1. Run it locally

```powershell
copy .env.example .env            # then put your Atlas connection string in it
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
.\.venv\Scripts\python -m backend.mongo_setup      # checks the connection, builds the schema
.\.venv\Scripts\python -m uvicorn cloud_app:app --reload
```

Open http://127.0.0.1:8000/docs for interactive API docs. In development, reset
codes are printed to the server log instead of emailed.

Atlas only accepts connections from IPs on its **Network Access** list; if setup
says it cannot reach the cluster, add your current IP there.

## 2. Tests

```powershell
.\.venv\Scripts\python -m pytest                    # 69 API tests against a throwaway Atlas database
$env:VOICEFLOW_TEST_ATLAS_SEARCH=1; .\.venv\Scripts\python -m pytest -k search   # + a real Atlas Search index (~1 min)
cd mobile; npm test                                 # phone suites, including sync against a scripted server
cd mobile; npm run test:e2e                         # two phones, the real server, real Atlas
```

The API tests use a real MongoDB on purpose: most of what they check is MongoDB
behaviour - unique indexes deciding races, upserts turning into duplicate-key
errors, validators refusing documents. Each run creates `voiceflow_test_<random>`
and drops it afterwards.

## 3. Deploy (Render + Atlas)

1. **Push the repo to GitHub.** `.env` is gitignored; check `git status` shows no
   secrets before pushing.
2. **Atlas → Network Access → Add IP Address → `0.0.0.0/0`.** Render's free tier
   has no fixed outbound IP, so the cluster has to accept any address and rely on
   the database password. That is the honest trade-off of a free host; a paid
   plan with static IPs (or Atlas private endpoints) removes it.
3. **Atlas → Database Access:** give the server its own database user with
   `readWrite` **and** `dbAdmin` on the `voiceflow` database only (Specific
   Privileges), not an Atlas admin. `dbAdmin` is what lets startup install the
   validators (`collMod`); without it the server refuses to start, with the reason
   in the log. If a password ever appeared in a screenshot or chat, rotate it.
4. **Render → New → Blueprint →** pick the repo. `render.yaml` defines the
   service. When asked, paste `MONGODB_URI`. `JWT_SECRET` is generated for you.
   `RESEND_API_KEY` and `APPLE_CLIENT_IDS` can stay empty for now.
5. Wait for the deploy, then open `https://<your-service>.onrender.com/readyz`.
   It should answer `{"ok":true,"database":"ok"}`.

The free plan sleeps after 15 idle minutes; the first request after that takes
up to a minute. The phone retries, so it shows up as a slow sync, not a failure.

### Point the phone at it

The URL is baked into the JS bundle by Expo, so this needs a JS reload, not a
new native build:

```powershell
cd mobile
$env:EXPO_PUBLIC_CLOUD_API_URL="https://<your-service>.onrender.com"; npx expo start
```

Then on the phone: Folders → the person icon → Create account. For a release
build, set the same variable in the EAS build profile.

### Email (password resets)

Without `RESEND_API_KEY`, forgot-password still answers normally but no email is
sent (production logs that it could not send - never the code). A free Resend
account sends from `onboarding@resend.dev` to your own address; verify a domain
in Resend to email anyone, and set `EMAIL_FROM` to match.

---

### Backups

Free Atlas (M0) has no backups, so the EC2 host takes its own. Every night at
03:15 UTC, cron runs `deploy/backup/backup.sh`, which:

1. `mongodump`s the `voiceflow` database (the connection string comes from a
   mode-600 config file, never a command-line argument or the log),
2. verifies the archive with `mongorestore --dryRun`,
3. uploads it to `s3://voiceflow-backups-bilal/mongodb/` with its SHA-256 in
   the object metadata, and confirms S3 reports the same size,
4. deletes the local temp copy.

The server's IAM role can put, get and list only; **S3's lifecycle rule deletes
backups after 30 days**, so the server never needs delete permission. No AWS
keys exist anywhere - the CLI uses the instance role.

**Set up (once, on the EC2 host):**

```bash
cd ~/Voice-Notes-App && git pull
bash deploy/backup/install.sh      # tools, config, cron, log rotation
/opt/voiceflow-backup/backup.sh    # run one now and read the output
```

**Is it working?** `/opt/voiceflow-backup/backup.sh --check` exits non-zero if the
newest backup is missing or older than 36 hours; log is `/var/log/voiceflow-backup.log`.

**Restore.** The default never touches production - it loads into a separate
database so you can look first:

```bash
/opt/voiceflow-backup/restore.sh --list
/opt/voiceflow-backup/restore.sh                        # latest -> voiceflow_restore_<date>
/opt/voiceflow-backup/restore.sh --from voiceflow-20261015T031500Z.archive.gz
```

To replace live data (after inspecting the restored copy), `--into voiceflow
--overwrite-production`, then type the database name to confirm. Afterwards
restart the API (`docker compose restart api`) so it rebuilds the Atlas Search
index, which is not part of a dump. Drop test restores when finished.

Limits: a once-a-night snapshot means up to 24 hours of changes can be lost. The
phones do **not** automatically re-upload those: their outbox is empty because the
changes were already synced, and their pull cursors are ahead of the restored
data. Signing out and back in on a phone re-queues everything on it (the library
there is the other full copy), so after a real restore, have users do that. The
exception is unsynced edits still in a phone's outbox, which upload as usual.

## 4. How users sign in

| | |
|---|---|
| **Email + password** | Works everywhere, nothing to configure. argon2id hashes (OWASP's 19 MiB profile, run off the event loop). |
| **Sign in with Google** | Set `GOOGLE_CLIENT_IDS` to the **Web** OAuth client id. The Android app uses `@react-native-google-signin/google-signin`; Google matches the app to its *Android* client by package name and signing-key SHA-1, and the ID token it returns is addressed to the Web client, which the server verifies. While the consent screen is in *Testing*, only listed test users can sign in. |
| **Sign in with Apple** | Server side is done: set `APPLE_CLIENT_IDS` to the iOS bundle id. Needs `expo-apple-authentication` and an iOS build. |

A provider sign-in whose **verified** email matches a password account joins it, and **clears that account's password and sessions**: nobody ever proved the address belonged to whoever registered it, so otherwise an attacker could register a victim's email first and keep their password. The owner sets a new one through the emailed reset code.

**Tokens.** Sign-in returns a 15-minute access token (JWT, HS256) and a 30-day
refresh token. The access token is checked against its session on every request,
so signing out or deleting the account takes effect immediately rather than when
the JWT expires. Refresh tokens are random, stored only as SHA-256, and rotate on
every use; presenting one that was already rotated away revokes the session
(theft detection), with a 10-second grace for a retried request.

**Abuse.** Sign-in, sign-up and reset endpoints are rate limited per IP and per
email, with counters in MongoDB (so the limit holds across server instances) that
a TTL index removes. A wrong email and a wrong password take the same time and
return the same message.

## 4b. Assistants (MCP)

An assistant - Claude, ChatGPT, anything that speaks the Model Context Protocol -
can read a user's lectures through `POST /mcp`, a read-only MCP server mounted
in the same app. It is on when `PUBLIC_URL` is set.

**Connecting one.** Two ways, both read-only and both ending up in the app's
*Assistants* sheet where they can be removed at any time:

1. *Sign in* (the normal way, see "Signing in" below): add `https://<server>/mcp` as
   a connector in Claude or ChatGPT and sign in with Google when it asks.
2. *Paste a token*, for tools that cannot sign in: person icon > *Assistants* >
   *Create access token*. The token (`vft_...`, shown once, only its hash stored)
   and the server address go into the assistant. To try one from a terminal:
   `python scripts/mcp_check.py https://<server>/mcp vft_... "some words"`.

Either kind is separate from sign-in sessions and dies with the account.

**Tools** - each a thin wrapper over a query the REST API already runs, all
read-only and scoped to the token's user (never to an argument):

| Tool | What it does |
|---|---|
| `list_folders` | folders with recording counts and total length (`$lookup`) |
| `list_recordings` | newest first; by folder name or id, or `unfiled`; paged by date |
| `get_recording` | details, bookmarks (with the second each was set), the user's notes |
| `get_transcript` | timestamped lines; `start_seconds`/`end_seconds` slice it in the database; cut at 20k characters with `nextStartSeconds` to continue |
| `search_lectures` | where exact words were said, with the second (Atlas Search) |
| `find_similar` | passages by *meaning* (Atlas Vector Search); see below |
| `topics` | the words said most, in how many recordings; optionally one folder or date range (aggregation over `term_sets`); see below |

**Semantic search (`find_similar`, `GET /v1/search/similar`).** Each transcript is
cut into passages of about a minute (`chunks`), and Atlas embeds the `text` field
itself with automated embedding - no embedding service, key or model of ours. A
query is embedded the same way and matched with `$vectorSearch`, pre-filtered on
`userId` so nobody else's passages are ever candidates. Chunks are derived data:
rebuilt when a transcript changes (a hash means unchanged text is never embedded
again), removed with the recording or account, and built lazily for older
transcripts. Automated embedding is an Atlas **Preview** feature, so every path
fails soft: if the index is building, off, or changed, the tool says so and points
at `search_lectures`.

Vector search always returns its nearest neighbours however far away they are, so
results scoring under `EMBED_MIN_SCORE` (default 0.70) are dropped: on real
recordings a true match scored 0.756 and an unrelated passage 0.629. An empty list
therefore means "nothing about that", and is distinct from "the index is not ready".

**Topics (`topics`).** "What came up most in Chemistry?" answered by the database,
not by an assistant reading transcripts. Each recording's 40 most-said words
(`{w, n}`, stop words removed) are counted once, when it syncs, into `term_sets` -
the *computed pattern*. The query is `$match` (this user, optionally these
recordings) > `$unwind` > `$group` (sum mentions, count recordings) > `$sort` >
`$limit`. Counting words on every request instead took 8.7 s for a user with 1,000
lectures; this takes 62 ms (`docs/benchmark.md`). The trade: a word counts for a
recording only if it is among that recording's most-said.

**What it costs, and the limits that hold it down.** Embedding is billed per token
(about a fiftieth of a cent per hour of lecture on `voyage-4-lite`), and every
passage indexed is embedded, so volume is capped in code: `EMBED_DAILY_CHUNKS`
(indexed per UTC day), `EMBED_USER_MAX_CHUNKS` (held per user),
`EMBED_DAILY_QUERIES` (each search embeds its query), and `SEMANTIC_SEARCH=false`
to switch it off. A reached cap skips the work; the recording is still saved. Usage
is counted per day in `usage`. Atlas itself offers billing *alerts* but no hard
cap, so set one (Organization > Alerts > Billing).

**Safety.** Transcript text is whatever was spoken, so it is returned as data and
the server's instructions say it is not to be obeyed. Requests for a host other
than `PUBLIC_URL`'s are refused (DNS-rebinding guard). Unauthenticated calls get a
`401` pointing at `/.well-known/oauth-protected-resource/mcp`, as the spec asks.

**Signing in (OAuth).** The person adds the server's address as a connector, the
assistant discovers everything from `/.well-known/oauth-protected-resource/mcp` and
`/.well-known/oauth-authorization-server`, and:

1. The assistant identifies itself either by **Client ID Metadata Document** (its
   `client_id` is an https URL that serves a small JSON document; fetched with SSRF
   guards, see `cimd.py`) or by **Dynamic Client Registration** (`POST /register`).
   Clients are always public: no secret, PKCE (S256) required.
2. `GET /authorize` (validated by the MCP SDK) parks the request in `oauth_requests`
   and redirects to `/oauth/consent?request=...`.
3. That page names the assistant and what it may do (read lectures, nothing else) and
   offers Google sign-in. The credential's nonce is the request id, and only an
   *existing* account can approve; connecting an assistant never creates one.
4. Approving redirects back to the assistant with a one-time code and `iss` (RFC 9207).
5. `POST /token` exchanges the code (plus the PKCE verifier) for an access token
   (`vfo_`, 1 hour) and a refresh token (`vfr_`, 90 days, **rotated on every use**).
   Tokens are bound to `<PUBLIC_URL>/mcp` (RFC 8707); a request naming another
   resource is refused.

A code or refresh token presented twice is what a thief with a copy does, so it
revokes the whole grant. `POST /revoke` ends a grant from the assistant's side;
`GET /v1/me/connections` and `DELETE /v1/me/connections/{id}` are the app's side.
`/authorize`, `/token` and `/register` are rate limited per address. Collections:
`oauth_clients`, `oauth_requests`, `oauth_codes`, `oauth_grants`, `oauth_tokens` -
hashes only, all expiring through TTL indexes. The Google credential is verified with
the same verifier as the phone's sign-in, so the **Web** OAuth client in Google Cloud
needs `https://<server>` under *Authorized JavaScript origins* for the consent page.

## 5. The data model

| Collection | One document per | Notes |
|---|---|---|
| `users` | account | partial unique indexes on `email` and `appleSub` (either may be absent) |
| `sessions` | signed-in device | refresh-token hash; TTL-expired |
| `access_tokens` | assistant allowed to read | token hash, scope `lectures:read`; TTL-expired |
| `chunks`, `chunk_sets`, `usage` | semantic search | derived passages (vector-indexed), their hashes, daily counters |
| `term_sets` | recording | derived: its 40 most-said words, for `topics` |
| `oauth_clients`, `oauth_requests`, `oauth_codes`, `oauth_grants`, `oauth_tokens` | assistants that sign in | see "Signing in"; hashes only, TTL-expired |
| `folders` | folder | |
| `recordings` | recording | bookmarks and notes **embedded** - bounded, always read together |
| `transcripts` | recording's words | **referenced**, same `_id` as the recording - unbounded, ~15k word timings per lecture, and a folder listing should never load them |
| `password_resets`, `rate_limits` | short-lived bookkeeping | TTL-expired |

*Embed what is bounded, reference what is unbounded.* Every index on user data
leads with `userId`, then follows ESR (equality, sort, range). Each synced
collection has a `$jsonSchema` validator requiring `userId`, `updatedAt` and
`syncedAt`: a document without them would be invisible to every phone's sync,
silently. Search uses an **Atlas Search** (Lucene) index on transcript text,
filtered by user, and falls back to a regex scan until the index is built or on a
non-Atlas MongoDB.

## 6. Sync

One request does both directions: `POST /v1/sync {deviceId, cursor, changes}`.

**On the phone**, SQLite triggers write every change to a `sync_outbox` table in
the same transaction as the change (a transactional outbox), so no code path can
edit something without queueing it. Edits coalesce: one row per thing, stamped
with the latest edit.

**Conflicts: last write wins** on `updatedAt` (when the user made the edit), with
one conditional upsert per document:

```python
replace_one({"_id": id, "userId": user, "updatedAt": {"$lt": incoming}}, doc, upsert=True)
```

If the server's copy is newer, the filter matches nothing, the upsert tries to
insert a duplicate `_id`, and that `DuplicateKeyError` *is* the rejection. The same
mechanism stops one user overwriting another's document by guessing its id.
Clocks more than five minutes in the future are clamped to now.

**Pulling** walks `syncedAt` - when the *server* accepted a change - never the
phone's clock, so a phone with a wrong clock cannot hide its changes from the
others. The cursor is `(syncedAt, _id)` per collection for exact keyset paging,
and never advances into the last five seconds, where a write might be stamped but
not yet committed; that window is read again next time. A device never gets its
own writes back.

**Deletes** are tombstones with their content cleared at once, removed by a TTL
index after 180 days. Deleting a recording takes its transcript with it; deleting
a folder moves its recordings to the inbox.

What syncs: folders, recordings (title, folder, favourite, bookmarks, notes,
transcription status, *where* the audio is) and transcripts. Not yet: study notes,
flashcards, attached files. Never: audio.

## 7. Endpoints

| | |
|---|---|
| `POST /v1/auth/register` · `login` · `refresh` · `logout` · `logout-everywhere` | |
| `POST /v1/auth/password/forgot` · `reset` · `change` | six-digit emailed code, 15 min, 5 tries |
| `POST /v1/auth/apple` | |
| `GET /v1/me` · `DELETE /v1/me` · `DELETE /v1/me/sessions/{id}` | account, devices, deletion |
| `POST /v1/sync` | the phones |
| `GET/POST /v1/folders` · `PATCH/DELETE /v1/folders/{id}` | with recording counts via `$lookup` |
| `GET /v1/recordings?folder=&before=&limit=` · `GET/PATCH/DELETE /v1/recordings/{id}` | |
| `GET /v1/recordings/{id}/transcript?start=&end=&words=` | time slices cut server-side with `$filter` |
| `GET /v1/search?q=` | hits carry the second the words were said |
| `GET/POST /v1/me/tokens` · `DELETE /v1/me/tokens/{id}` | assistant tokens |
| `POST /mcp` | the MCP server (assistant token) |
| `GET /healthz` · `GET /readyz` | process up · database reachable |

The REST routes are what the planned MCP server will call so an assistant can
read (and file) a student's lectures; edits made there reach the phones on their
next sync, like any other change.

## 8. Known limits

- Tokens live in the app's private SQLite, not the iOS Keychain / Android
  Keystore. Moving them to `expo-secure-store` needs a native build.
- Sign in with Apple needs the native module and an iOS build (server side is ready).
- Last-write-wins is per document: two devices editing *different* fields of the
  same recording offline keep only the later device's version of the whole document.
- A recording synced to a second phone plays only on the phone that recorded it.
