/**
 * The phone's half of sync with the VoiceFlow cloud API (backend/cloud/).
 *
 * The phone's SQLite stays the source of truth for the screen: the page reads
 * and writes it exactly as before and never waits on the network. Separately,
 * triggers queue what changed (see SYNC_SCHEMA in localApi.js), and this module
 * trades that queue with the server:
 *
 *   1. take a batch from the outbox and turn rows into documents
 *   2. POST /v1/sync - the server applies them (last write wins) and answers
 *      with whatever changed elsewhere since our cursor
 *   3. in one transaction: clear what the server took, apply what it sent,
 *      save the new cursor
 *
 * Audio never leaves the phone. A recording synced to another phone arrives
 * with its title, bookmarks, notes and transcript; playing it needs the phone
 * that recorded it.
 *
 * Nothing here imports Expo. The database, the write lock, fetch and the clock
 * are passed in, so the tests run this file under Node against sql.js and a
 * real server.
 */

const PAGE = { folders: 200, recordings: 200, transcripts: 5 };
// The server refuses bodies over 8MB. Transcripts are the only large thing,
// so they are what this budget counts.
const TRANSCRIPT_BUDGET = 3_000_000;
const MAX_ROUNDS = 20;
const REFRESH_MARGIN_MS = 60_000;
const PERIODIC_MS = 5 * 60_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export class CloudError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

// --- shapes ------------------------------------------------------------------

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clampSeconds = (value) => Math.min(7 * 24 * 3600, Math.max(0, num(value)));
const text = (value, max) => String(value ?? '').slice(0, max);
const idOrNull = (value) => (typeof value === 'string' && ID.test(value) ? value : null);

/** Server timestamps can carry microseconds; not every JS engine parses those. */
export function toMs(iso) {
  if (!iso) return 0;
  const ms = Date.parse(String(iso).replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(ms) ? ms : 0;
}
const toIso = (iso) => (iso ? new Date(toMs(iso)).toISOString() : null);

/**
 * Word timings in the compact form the server stores: {w, s, e}. A long
 * lecture has fifteen thousand of them, and the long names would double the
 * size of every transcript. The word keeps its leading space - the player
 * renders words without inventing separators.
 */
export function segmentToCloud(segment) {
  const words = Array.isArray(segment?.words) ? segment.words.slice(0, 2000) : [];
  const end = segment?.end_seconds ?? segment?.end;
  return {
    start: clampSeconds(segment?.start_seconds ?? segment?.start),
    end: end == null ? null : clampSeconds(end),
    text: text(segment?.text, 5000),
    words: words.map((word) => ({
      w: text(word?.word ?? word?.text, 200),
      s: clampSeconds(word?.start),
      e: word?.end == null ? null : clampSeconds(word.end),
    })),
  };
}

export function segmentFromCloud(segment) {
  const words = Array.isArray(segment?.words) ? segment.words : [];
  const start = num(segment?.start);
  return {
    text: String(segment?.text ?? ''),
    start_seconds: start,
    end_seconds: segment?.end == null ? start : num(segment.end),
    // No words means no word timings; saying so by omission is what the
    // player expects, rather than an empty list that implies there were none.
    ...(words.length ? {
      words: words.map((word) => ({ start: num(word.s), end: word.e == null ? num(word.s) : num(word.e), word: String(word.w ?? '') })),
    } : {}),
  };
}

function parseSegments(json) {
  try {
    const parsed = JSON.parse(json ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const primaryLecture = (db, workspaceId) => db.getFirstAsync(
  // The newest session is the one the playback screen opens, so it is the
  // one whose transcript and bookmarks stand for the recording.
  'SELECT * FROM lectures WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1', workspaceId,
);

// --- the client --------------------------------------------------------------

export function createCloud({
  openDatabase, exclusive, fetch: fetchImpl, apiUrl, deviceName = 'Phone',
  audioFile = null, onData = () => {}, onStatus = () => {}, now = () => Date.now(),
}) {
  const server = String(apiUrl ?? '').replace(/\/+$/, '');
  let syncing = null;
  let again = false;
  let timer = null;
  let ticker = null;
  let refreshing = null;

  // ---- local state ---------------------------------------------------------

  async function getState(key) {
    const db = await openDatabase();
    const row = await db.getFirstAsync('SELECT value FROM cloud_state WHERE key = ?', key);
    return row?.value ?? null;
  }
  async function setState(db, values) {
    for (const [key, value] of Object.entries(values)) {
      if (value == null) await db.runAsync('DELETE FROM cloud_state WHERE key = ?', key);
      else await db.runAsync('INSERT OR REPLACE INTO cloud_state (key, value) VALUES (?, ?)', key, String(value));
    }
  }
  const saveState = async (values) => setState(await openDatabase(), values);

  async function deviceId() {
    let id = await getState('device_id');
    if (!id) {
      id = `dev_${now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      await saveState({ device_id: id });
    }
    return id;
  }

  async function status() {
    const db = await openDatabase();
    const pending = await db.getFirstAsync('SELECT COUNT(*) AS n FROM sync_outbox');
    const user = await getState('user');
    return {
      configured: Boolean(server),
      server: server || null,
      signedIn: Boolean(await getState('refresh_token')),
      user: user ? JSON.parse(user) : null,
      pending: pending?.n ?? 0,
      syncing: Boolean(syncing),
      lastSyncAt: await getState('last_sync_at'),
      lastError: await getState('last_error'),
    };
  }

  const announce = () => { status().then(onStatus, () => {}); };

  // ---- HTTP ----------------------------------------------------------------

  async function request(path, { method = 'GET', body, token } = {}) {
    let response;
    try {
      response = await fetchImpl(`${server}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new CloudError("Can't reach the VoiceFlow server. Check your connection.");
    }
    const type = response.headers?.get?.('content-type') ?? '';
    const data = type.includes('application/json') ? await response.json() : null;
    if (!response.ok) {
      const detail = Array.isArray(data?.detail)
        ? (data.detail[0]?.msg ?? 'That was not accepted.').replace(/^Value error, /, '')
        : data?.detail;
      throw new CloudError(detail || `The server answered ${response.status}.`, response.status);
    }
    return data;
  }

  async function storeTokens(tokens) {
    await saveState({
      access_token: tokens.accessToken,
      access_expires: now() + tokens.expiresIn * 1000,
      refresh_token: tokens.refreshToken,
      user: JSON.stringify(tokens.user),
    });
  }

  async function forgetSession(reason = null) {
    await saveState({
      access_token: null, access_expires: null, refresh_token: null, user: null,
      cursor: null, last_error: reason,
    });
    announce();
  }

  /** One refresh at a time: two would race, and the loser looks like theft. */
  function refresh() {
    if (!refreshing) {
      refreshing = (async () => {
        const token = await getState('refresh_token');
        if (!token) throw new CloudError('Sign in to sync.', 401);
        try {
          await storeTokens(await request('/v1/auth/refresh', { method: 'POST', body: { refreshToken: token } }));
        } catch (error) {
          if (error.status === 401) await forgetSession('Your session ended. Sign in again to keep syncing.');
          throw error;
        }
      })().finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function authed(path, options = {}) {
    if (!(await getState('refresh_token'))) throw new CloudError('Sign in to sync.', 401);
    if (num(await getState('access_expires')) - now() < REFRESH_MARGIN_MS) await refresh();
    try {
      return await request(path, { ...options, token: await getState('access_token') });
    } catch (error) {
      if (error.status !== 401) throw error;
      await refresh();
      return request(path, { ...options, token: await getState('access_token') });
    }
  }

  // ---- outbox -> documents -------------------------------------------------

  async function folderDoc(db, entry) {
    const row = entry.op === 'delete' ? null : await db.getFirstAsync('SELECT * FROM folders WHERE id = ?', entry.id);
    if (!row) return { id: entry.id, updatedAt: entry.changed_at, deletedAt: entry.changed_at, name: '' };
    return {
      id: row.id,
      updatedAt: entry.changed_at,
      name: text(row.name, 120),
      color: row.color,
      icon: row.icon ? text(row.icon, 40) : null,
      parentId: idOrNull(row.parent_id),
      createdAt: row.created_at,
      archivedAt: row.archived_at ?? null,
    };
  }

  async function recordingDoc(db, entry, device) {
    const row = entry.op === 'delete' ? null : await db.getFirstAsync('SELECT * FROM workspaces WHERE id = ?', entry.id);
    if (!row) return { id: entry.id, updatedAt: entry.changed_at, deletedAt: entry.changed_at, title: '' };
    const lecture = await primaryLecture(db, row.id);
    const markers = lecture ? await db.getAllAsync(
      'SELECT id, label, time_seconds, created_at FROM session_markers WHERE lecture_id = ? ORDER BY time_seconds',
      lecture.id,
    ) : [];
    const notes = await db.getFirstAsync('SELECT note_body FROM workspace_notes WHERE workspace_id = ?', row.id);
    return {
      id: row.id,
      updatedAt: entry.changed_at,
      folderId: idOrNull(row.folder_id),
      title: text(row.title, 300),
      favorite: Boolean(row.favorite),
      createdAt: row.created_at,
      durationSeconds: lecture?.duration_seconds == null ? null : clampSeconds(lecture.duration_seconds),
      transcription: {
        status: text(lecture?.transcription_status ?? 'unavailable', 20),
        model: lecture?.model ? text(lecture.model, 60) : null,
      },
      // Only the phone holding the file describes it. Others send null and
      // the server keeps the description it has.
      audio: lecture?.file_name
        ? { fileName: text(lecture.file_name, 200), bytes: Math.max(0, Math.round(num(lecture.size_bytes))), deviceId: device }
        : null,
      markers: markers.filter((marker) => ID.test(marker.id)).slice(0, 2000).map((marker) => ({
        id: marker.id,
        label: text(marker.label, 200),
        timeSeconds: clampSeconds(marker.time_seconds),
        createdAt: marker.created_at ?? null,
      })),
      notes: text(notes?.note_body, 200_000),
    };
  }

  async function transcriptDoc(db, entry) {
    const lecture = await primaryLecture(db, entry.id);
    if (!lecture) return null;
    const segments = parseSegments(lecture.segments_json).slice(0, 20_000).map(segmentToCloud);
    return { id: entry.id, updatedAt: entry.changed_at, text: text(lecture.transcript, 2_000_000), segments };
  }

  async function takeBatch() {
    return exclusive(async () => {
      const db = await openDatabase();
      const device = await deviceId();
      const changes = { folders: [], recordings: [], transcripts: [] };
      const sent = [];
      const dropped = [];
      let budget = TRANSCRIPT_BUDGET;
      let full = false;
      const rows = await db.getAllAsync('SELECT * FROM sync_outbox ORDER BY changed_at LIMIT 1000');
      for (const entry of rows) {
        if (!ID.test(entry.id)) { dropped.push(entry); continue; }
        if (changes[entry.kind].length >= PAGE[entry.kind]) { full = true; continue; }
        let doc;
        if (entry.kind === 'folders') doc = await folderDoc(db, entry);
        else if (entry.kind === 'recordings') doc = await recordingDoc(db, entry, device);
        else doc = await transcriptDoc(db, entry);
        if (!doc) { dropped.push(entry); continue; }
        if (entry.kind === 'transcripts') {
          const size = JSON.stringify(doc).length;
          if (size > budget && changes.transcripts.length) { full = true; continue; }
          budget -= size;
        }
        changes[entry.kind].push(doc);
        sent.push(entry);
      }
      return { changes, sent, dropped, full: full || rows.length === 1000 };
    });
  }

  // ---- documents -> local rows ---------------------------------------------

  async function applyFolder(db, doc) {
    if (doc.deletedAt) {
      // As on the phone: a folder's recordings outlive it.
      await db.runAsync('UPDATE workspaces SET folder_id = NULL WHERE folder_id = ?', doc.id);
      await db.runAsync('UPDATE materials SET folder_id = NULL WHERE folder_id = ?', doc.id);
      await db.runAsync('DELETE FROM folders WHERE id = ?', doc.id);
      return;
    }
    await db.runAsync(
      `INSERT INTO folders (id, name, parent_id, color, icon, created_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id,
         color = excluded.color, icon = excluded.icon, archived_at = excluded.archived_at`,
      doc.id, doc.name, doc.parentId ?? null, doc.color ?? 'blue', doc.icon ?? null,
      toIso(doc.createdAt ?? doc.updatedAt), toIso(doc.archivedAt),
    );
  }

  async function removeWorkspace(db, id) {
    // Deleted on another device: the user asked for it, audio included.
    const sessions = await db.getAllAsync('SELECT id, file_name FROM lectures WHERE workspace_id = ?', id);
    for (const session of sessions) {
      if (session.file_name && audioFile) {
        const file = audioFile(session.file_name);
        if (file.exists) file.delete();
      }
      await db.runAsync('DELETE FROM session_markers WHERE lecture_id = ?', session.id);
    }
    for (const table of ['lectures', 'workspace_notes', 'workspace_study_notes', 'workspace_flashcards', 'materials']) {
      await db.runAsync(`DELETE FROM ${table} WHERE workspace_id = ?`, id);
    }
    await db.runAsync('DELETE FROM workspaces WHERE id = ?', id);
    await db.runAsync('DELETE FROM cloud_stash WHERE id = ?', id);
  }

  async function applyRecording(db, doc) {
    if (doc.deletedAt) { await removeWorkspace(db, doc.id); return; }
    const updated = toIso(doc.updatedAt);
    const created = toIso(doc.createdAt ?? doc.updatedAt);
    const exists = await db.getFirstAsync('SELECT id FROM workspaces WHERE id = ?', doc.id);
    if (exists) {
      await db.runAsync(
        'UPDATE workspaces SET folder_id = ?, title = ?, favorite = ?, updated_at = ? WHERE id = ?',
        doc.folderId ?? null, doc.title, doc.favorite ? 1 : 0, updated, doc.id,
      );
    } else {
      await db.runAsync(
        'INSERT INTO workspaces (id, folder_id, title, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        doc.id, doc.folderId ?? null, doc.title, doc.favorite ? 1 : 0, created, updated,
      );
    }

    let lecture = await primaryLecture(db, doc.id);
    const status = doc.transcription?.status ?? 'unavailable';
    if (!lecture) {
      // Recorded on another phone. The row stands in for it, with no file:
      // it shows the title, bookmarks and transcript, and says the audio is
      // elsewhere rather than offering to play nothing.
      await db.runAsync(
        `INSERT INTO lectures (id, workspace_id, folder_id, title, created_at, model, file_name, size_bytes,
           duration_seconds, transcription_status, transcription_progress, status)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 'remote')`,
        doc.id, doc.id, doc.folderId ?? null, doc.title, created, doc.transcription?.model ?? 'device',
        Math.round(num(doc.audio?.bytes)), doc.durationSeconds ?? null, status, status === 'ready' ? 1 : 0,
      );
      lecture = await primaryLecture(db, doc.id);
    } else if (!lecture.file_name) {
      await db.runAsync(
        'UPDATE lectures SET folder_id = ?, title = ?, duration_seconds = ?, transcription_status = ? WHERE id = ?',
        doc.folderId ?? null, doc.title, doc.durationSeconds ?? null, status, lecture.id,
      );
    } else {
      // This phone has the audio, so it owns the transcription state.
      await db.runAsync('UPDATE lectures SET folder_id = ?, title = ? WHERE id = ?', doc.folderId ?? null, doc.title, lecture.id);
    }

    const markers = Array.isArray(doc.markers) ? doc.markers : [];
    const keep = new Set(markers.map((marker) => marker.id));
    const current = await db.getAllAsync('SELECT id FROM session_markers WHERE lecture_id = ?', lecture.id);
    for (const marker of current) {
      if (!keep.has(marker.id)) await db.runAsync('DELETE FROM session_markers WHERE id = ?', marker.id);
    }
    for (const marker of markers) {
      await db.runAsync(
        'INSERT OR REPLACE INTO session_markers (id, lecture_id, label, time_seconds, created_at) VALUES (?, ?, ?, ?, ?)',
        marker.id, lecture.id, marker.label ?? '', num(marker.timeSeconds), toIso(marker.createdAt) ?? updated,
      );
    }

    const notes = await db.getFirstAsync('SELECT note_body FROM workspace_notes WHERE workspace_id = ?', doc.id);
    if ((notes?.note_body ?? '') !== (doc.notes ?? '')) {
      await db.runAsync(
        `INSERT INTO workspace_notes (workspace_id, note_body, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET note_body = excluded.note_body, updated_at = excluded.updated_at`,
        doc.id, doc.notes ?? '', updated,
      );
    }

    // A transcript that arrived before its recording has been waiting.
    const stashed = await db.getFirstAsync('SELECT doc FROM cloud_stash WHERE id = ?', doc.id);
    if (stashed) {
      await db.runAsync('DELETE FROM cloud_stash WHERE id = ?', doc.id);
      await applyTranscript(db, JSON.parse(stashed.doc));
    }
  }

  async function applyTranscript(db, doc) {
    const lecture = await primaryLecture(db, doc.id);
    if (!lecture) {
      // Pages of recordings and transcripts move independently, so the words
      // can arrive first. Keep them until the recording does.
      if (!doc.deletedAt) await db.runAsync('INSERT OR REPLACE INTO cloud_stash (id, doc) VALUES (?, ?)', doc.id, JSON.stringify(doc));
      return;
    }
    const segments = (doc.deletedAt ? [] : doc.segments ?? []).map(segmentFromCloud);
    const words = doc.deletedAt ? '' : String(doc.text ?? '');
    await db.runAsync(
      `UPDATE lectures SET transcript = ?, segments_json = ?,
         transcription_status = CASE WHEN ? != '' THEN 'ready' ELSE transcription_status END,
         transcription_progress = CASE WHEN ? != '' THEN 1 ELSE transcription_progress END
       WHERE id = ?`,
      words, JSON.stringify(segments), words, words, lecture.id,
    );
  }

  const APPLY = { folders: applyFolder, recordings: applyRecording, transcripts: applyTranscript };

  /** Everything from one server reply, in one transaction. */
  async function settle(batch, result) {
    return exclusive(async () => {
      const db = await openDatabase();
      let changed = 0;
      await db.execAsync('BEGIN');
      try {
        // Changes made by applying the server's documents are the server's,
        // not this phone's: the triggers must not queue them back up.
        await setState(db, { applying: '1' });
        // Pulled documents first, while what was just pushed is still in the
        // outbox to compare against - so nothing older than it can land.
        for (const kind of ['folders', 'recordings', 'transcripts']) {
          for (const doc of result.changes?.[kind] ?? []) {
            const pending = await db.getFirstAsync(
              'SELECT changed_at FROM sync_outbox WHERE kind = ? AND id = ?', kind, doc.id);
            // Last write wins here too: a local edit newer than the server's
            // copy is kept, and goes up on the next round.
            if (pending && toMs(pending.changed_at) > toMs(doc.updatedAt)) continue;
            await APPLY[kind](db, doc);
            await db.runAsync('DELETE FROM sync_outbox WHERE kind = ? AND id = ?', kind, doc.id);
            changed++;
          }
        }
        // Kind and id together: a recording and its transcript share an id.
        // Rejected counts as done - the server's newer copy is on its way.
        const answered = (entry) => ['applied', 'rejected']
          .some((outcome) => result[outcome]?.[entry.kind]?.includes(entry.id));
        for (const entry of [...batch.sent.filter(answered), ...batch.dropped]) {
          // Only if nothing changed since it was read: a newer edit stays queued.
          await db.runAsync(
            'DELETE FROM sync_outbox WHERE kind = ? AND id = ? AND changed_at = ?',
            entry.kind, entry.id, entry.changed_at,
          );
        }
        await setState(db, { cursor: result.cursor, applying: null });
        await db.execAsync('COMMIT');
      } catch (error) {
        await db.execAsync('ROLLBACK').catch(() => {});
        throw error;
      }
      return changed;
    });
  }

  /**
   * The server refused the batch as malformed. Find the documents it will not
   * take by sending them one at a time, and set those aside, so one bad row
   * cannot stop everything else from ever syncing.
   */
  async function isolateRejects(batch, device, cursor) {
    const bad = [];
    for (const entry of batch.sent) {
      const doc = batch.changes[entry.kind].find((candidate) => candidate.id === entry.id);
      try {
        await authed('/v1/sync', {
          method: 'POST',
          body: { deviceId: device, cursor, changes: { [entry.kind]: [doc] } },
        });
      } catch (error) {
        if (error.status === 422) bad.push(entry);
        else throw error;
      }
    }
    await exclusive(async () => {
      const db = await openDatabase();
      for (const entry of bad) {
        await db.runAsync('DELETE FROM sync_outbox WHERE kind = ? AND id = ? AND changed_at = ?', entry.kind, entry.id, entry.changed_at);
      }
    });
    return bad.length;
  }

  async function runSync() {
    const device = await deviceId();
    let changed = 0;
    let rounds = 0;
    let remaining = false;
    let warning = null;
    try {
      for (; rounds < MAX_ROUNDS; rounds++) {
        const batch = await takeBatch();
        const cursor = await getState('cursor');
        let result;
        try {
          result = await authed('/v1/sync', { method: 'POST', body: { deviceId: device, cursor, changes: batch.changes } });
        } catch (error) {
          if (error.status !== 422 || !batch.sent.length) throw error;
          const skipped = await isolateRejects(batch, device, cursor);
          warning = `${skipped} item${skipped === 1 ? '' : 's'} could not be synced and ${skipped === 1 ? 'was' : 'were'} skipped.`;
          continue;
        }
        changed += await settle(batch, result);
        remaining = batch.full || result.more;
        if (!remaining) break;
      }
      await saveState({ last_sync_at: new Date(now()).toISOString(), last_error: warning });
    } catch (error) {
      if (error.status !== 401) await saveState({ last_error: error.message });
      throw error;
    } finally {
      if (changed) onData();
      announce();
    }
    if (remaining) schedule(1000);
    return { changed, rounds: rounds + 1 };
  }

  /** One sync at a time. A request during one runs again straight after it. */
  function syncNow() {
    if (!server) return Promise.reject(new CloudError("Sync isn't set up in this build.", 503));
    if (syncing) { again = true; return syncing; }
    syncing = (async () => {
      announce();
      try {
        return await runSync();
      } finally {
        syncing = null;
        if (again) { again = false; schedule(0); }
      }
    })();
    return syncing;
  }

  function schedule(delayMs = 3000) {
    if (!server) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!(await getState('refresh_token'))) return;
      syncNow().catch(() => {});
    }, delayMs);
  }

  function start() {
    schedule(0);
    clearInterval(ticker);
    ticker = setInterval(() => schedule(0), PERIODIC_MS);
  }

  function stop() {
    clearTimeout(timer);
    clearInterval(ticker);
  }

  // ---- signing in and out --------------------------------------------------

  /**
   * Queues everything already on the phone, stamped with when it last
   * changed rather than now. Signing in to an account that already has newer
   * copies (from another phone) then keeps those, instead of this phone's old
   * data overwriting them for no reason other than having signed in second.
   */
  async function seedOutbox() {
    await exclusive(async () => {
      const db = await openDatabase();
      await db.runAsync(`INSERT OR IGNORE INTO sync_outbox (kind, id, op, changed_at)
        SELECT 'folders', id, 'upsert', created_at FROM folders`);
      await db.runAsync(`INSERT OR IGNORE INTO sync_outbox (kind, id, op, changed_at)
        SELECT 'recordings', id, 'upsert', updated_at FROM workspaces`);
      await db.runAsync(`INSERT OR IGNORE INTO sync_outbox (kind, id, op, changed_at)
        SELECT 'transcripts', w.id, 'upsert', w.updated_at FROM workspaces w
         WHERE EXISTS (SELECT 1 FROM lectures l WHERE l.workspace_id = w.id
                        AND (l.transcript != '' OR l.segments_json != '[]'))`);
    });
  }

  async function signedIn(tokens) {
    await storeTokens(tokens);
    // A full pull: this may be a different account than last time.
    await saveState({ cursor: null, last_error: null });
    await seedOutbox();
    syncNow().catch(() => {});
    return status();
  }

  const credentials = (body) => ({
    email: String(body?.email ?? '').trim(),
    password: String(body?.password ?? ''),
    deviceName,
  });

  async function handleAccountApi({ method, path, body }) {
    const action = path.split('?')[0].replace(/^\/api\/account\/?/, '').replace(/\/$/, '');
    try {
      if (method === 'GET' && action === '') return { status: 200, body: await status() };
      if (!server) return { status: 503, body: { detail: "Sync isn't set up in this build." } };
      if (method !== 'POST') return { status: 405, body: { detail: 'Not allowed.' } };

      switch (action) {
        case 'register':
          return { status: 200, body: await signedIn(await request('/v1/auth/register', { method: 'POST', body: credentials(body) })) };
        case 'login':
          return { status: 200, body: await signedIn(await request('/v1/auth/login', { method: 'POST', body: credentials(body) })) };
        case 'forgot':
          await request('/v1/auth/password/forgot', { method: 'POST', body: { email: String(body?.email ?? '').trim() } });
          return { status: 200, body: { ok: true } };
        case 'reset':
          return {
            status: 200,
            body: await signedIn(await request('/v1/auth/password/reset', {
              method: 'POST',
              body: {
                email: String(body?.email ?? '').trim(),
                code: String(body?.code ?? '').trim(),
                newPassword: String(body?.password ?? ''),
                deviceName,
              },
            })),
          };
        case 'sync':
          await syncNow();
          return { status: 200, body: await status() };
        case 'logout': {
          const token = await getState('refresh_token');
          // Best effort: signing out of the phone must work offline too.
          if (token) await request('/v1/auth/logout', { method: 'POST', body: { refreshToken: token } }).catch(() => {});
          await forgetSession();
          return { status: 200, body: await status() };
        }
        case 'delete':
          await authed('/v1/me', { method: 'DELETE', body: { password: body?.password ?? null } });
          await forgetSession();
          return { status: 200, body: await status() };
        default:
          return { status: 404, body: { detail: `No account route ${action}` } };
      }
    } catch (error) {
      return { status: error.status || 503, body: { detail: error.message } };
    }
  }

  return { handleAccountApi, syncNow, schedule, start, stop, status, deviceId };
}
