import * as SQLite from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * The backend, on the phone.
 *
 * The web build talks to FastAPI over /api. Nothing is going to answer that on
 * a device, so this module answers it instead: the same paths, the same JSON
 * shapes, backed by SQLite and the local filesystem. The schema and the
 * serializers deliberately mirror backend/database.py and backend/serializers.py
 * - the client is unmodified, so any divergence shows up as a broken screen.
 *
 * What genuinely cannot run here says so. Transcription and the AI endpoints
 * need the Python service; they return a clear message rather than a stub that
 * looks like it worked.
 */

const DB_NAME = 'classnotes-web.db';

/** Set once by the shell at startup; localApi has no way to detect it itself. */
export const TRANSCRIPTION_ON_DEVICE = { value: false };
export const AUDIO_DIR = new Directory(Paths.document, 'recordings');

let database = null;

const nowIso = () => new Date().toISOString();
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export async function openDatabase() {
  if (database) return database;
  if (!AUDIO_DIR.exists) AUDIO_DIR.create({ intermediates: true });

  database = await SQLite.openDatabaseAsync(DB_NAME);
  await database.execAsync('PRAGMA journal_mode = WAL;');
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      parent_id TEXT,
      color TEXT NOT NULL DEFAULT 'blue',
      created_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY NOT NULL,
      folder_id TEXT,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lectures (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT,
      folder_id TEXT,
      course TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'device',
      transcript TEXT NOT NULL DEFAULT '',
      note_body TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      duration_seconds REAL,
      transcription_status TEXT NOT NULL DEFAULT 'unavailable',
      transcription_progress REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'complete',
      segments_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS workspace_notes (
      workspace_id TEXT PRIMARY KEY NOT NULL,
      note_body TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_study_notes (
      workspace_id TEXT PRIMARY KEY NOT NULL,
      note_body TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_flashcards (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_markers (
      id TEXT PRIMARY KEY NOT NULL,
      lecture_id TEXT NOT NULL,
      label TEXT NOT NULL,
      time_seconds REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT,
      folder_id TEXT,
      original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      extraction_status TEXT NOT NULL DEFAULT 'ready',
      extraction_message TEXT NOT NULL DEFAULT '',
      extracted_text TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_flashcards_position
      ON workspace_flashcards (workspace_id, position);
    CREATE INDEX IF NOT EXISTS idx_markers_lecture
      ON session_markers (lecture_id, time_seconds);
  `);
  // Segments arrived after the first recordings did. ALTER TABLE throws when
  // the column is already there, which is the expected state on every launch
  // but the first.
  try {
    await database.execAsync("ALTER TABLE lectures ADD COLUMN segments_json TEXT NOT NULL DEFAULT '[]'");
  } catch {
    /* already migrated */
  }
  return database;
}

// --- settings --------------------------------------------------------------

export async function getSetting(key, fallback = '') {
  const db = await openDatabase();
  const row = await db.getFirstAsync('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? fallback;
}

export async function setSetting(key, value) {
  const db = await openDatabase();
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key, String(value ?? ''),
  );
}

export const TRANSCRIPTION_SERVER = 'transcription_server_url';

/**
 * Lectures still waiting on a server transcript. Drained whenever one becomes
 * reachable, which is what lets a recording be saved on a bus and transcribed
 * an hour later without the user doing anything.
 */
export async function pendingTranscriptions() {
  const db = await openDatabase();
  return db.getAllAsync(
    `SELECT * FROM lectures
      WHERE transcription_status = 'pending' AND file_name != ''
      ORDER BY created_at ASC LIMIT 20`,
  );
}

export async function markTranscriptionPending(id) {
  const db = await openDatabase();
  await db.runAsync(
    "UPDATE lectures SET transcription_status = 'pending', transcription_progress = 0 WHERE id = ?",
    id,
  );
}

export async function markTranscriptionProgress(id, progress) {
  const db = await openDatabase();
  await db.runAsync(
    'UPDATE lectures SET transcription_progress = ? WHERE id = ?',
    Math.max(0, Math.min(1, Number(progress) || 0)), id,
  );
}

export function audioFile(fileName) {
  return new File(AUDIO_DIR, fileName);
}

// --- serializers, mirroring backend/serializers.py --------------------------

function folderJson(row) {
  return {
    id: row.id,
    name: row.name,
    parent_id: row.parent_id ?? null,
    color: row.color,
    created_at: row.created_at,
    archived: Boolean(row.archived_at),
    lecture_count: row.lecture_count ?? null,
    recording_count: row.recording_count ?? null,
    file_count: row.file_count ?? null,
    updated_at: row.updated_at ?? null,
  };
}

function materialJson(row) {
  return {
    id: row.id,
    workspace_id: row.workspace_id ?? null,
    folder_id: row.folder_id ?? null,
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    created_at: row.created_at,
    ai_status: row.extraction_status,
    ai_message: row.extraction_message,
    extracted_char_count: (row.extracted_text ?? '').length,
    download_url: null,
  };
}

/**
 * Timed segments for the transcript panel. A transcript with no timings still
 * has to render, so flat text becomes a single segment at zero rather than
 * nothing at all.
 */
function parseSegments(json, transcript) {
  try {
    const parsed = JSON.parse(json ?? '[]');
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    /* fall through to the flat text */
  }
  const text = String(transcript ?? '').trim();
  return text ? [{ start_seconds: 0, text }] : [];
}

async function lectureJson(db, row, { includeContent }) {
  const file = row.file_name ? audioFile(row.file_name) : null;
  const result = {
    id: row.id,
    workspace_id: row.workspace_id ?? null,
    folder_id: row.folder_id ?? null,
    course: row.course ?? '',
    title: row.title,
    created_at: row.created_at,
    model: row.model,
    // Points straight at the file. The WebView is given a file:// base origin
    // so an <audio> tag can load it without a server in between.
    audio_url: file && file.exists ? file.uri : null,
    transcription_status: row.transcription_status,
    transcription_progress: row.transcription_progress,
    transcription_eta_seconds: null,
    duration_seconds: row.duration_seconds ?? null,
  };
  if (includeContent) {
    result.transcript = row.transcript ?? '';
    result.note_body = row.note_body ?? '';
    // The transcript panel reads segments, not the flat text: returning an
    // empty list here shows "No speech detected" over a perfectly good
    // transcript. Fall back to one segment when only flat text exists.
    result.segments = parseSegments(row.segments_json, row.transcript);
    result.markers = await db.getAllAsync(
      `SELECT id, label, time_seconds, created_at FROM session_markers
       WHERE lecture_id = ? ORDER BY time_seconds ASC, created_at ASC`,
      row.id,
    );
  }
  return result;
}

async function workspaceJson(db, row, { includeSessions = false } = {}) {
  const result = {
    id: row.id,
    folder_id: row.folder_id ?? null,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
    session_count: row.session_count ?? 0,
  };
  if (!includeSessions) return result;

  const sessions = await db.getAllAsync(
    'SELECT * FROM lectures WHERE workspace_id = ? ORDER BY created_at DESC', row.id,
  );
  result.sessions = [];
  for (const session of sessions) {
    result.sessions.push(await lectureJson(db, session, { includeContent: true }));
  }

  const notes = await db.getFirstAsync('SELECT * FROM workspace_notes WHERE workspace_id = ?', row.id);
  const study = await db.getFirstAsync('SELECT * FROM workspace_study_notes WHERE workspace_id = ?', row.id);
  const materials = await db.getAllAsync(
    'SELECT * FROM materials WHERE workspace_id = ? ORDER BY created_at DESC', row.id,
  );
  const flashcards = await db.getAllAsync(
    `SELECT id, front, back, position, created_at FROM workspace_flashcards
     WHERE workspace_id = ? ORDER BY position ASC`, row.id,
  );

  result.note_body = notes?.note_body ?? '';
  result.notes_updated_at = notes?.updated_at ?? null;
  result.study_notes = study?.note_body ?? '';
  result.study_notes_updated_at = study?.updated_at ?? null;
  result.ai_notes = '';
  result.ai_notes_model = null;
  result.ai_notes_updated_at = null;
  result.materials = materials.map(materialJson);
  result.flashcards = flashcards;
  return result;
}

// --- helpers ---------------------------------------------------------------

const ok = (body) => ({ status: 200, body });
const fail = (status, detail) => ({ status, body: { detail } });

/** The one thing a phone genuinely cannot do yet, said plainly. */
const needsServer = (what) => fail(
  503,
  `${what} runs on the desktop app, which has the speech and language models. Recording, notes and playback all work here.`,
);

async function touchWorkspace(db, workspaceId) {
  if (workspaceId) {
    await db.runAsync('UPDATE workspaces SET updated_at = ? WHERE id = ?', nowIso(), workspaceId);
  }
}

// --- the router ------------------------------------------------------------

/**
 * Answers one request. `path` includes the query string, exactly as the page
 * asked for it; `body` is already parsed.
 */
export async function handleApi({ method, path, body }) {
  const db = await openDatabase();
  const [rawPath, rawQuery] = path.split('?');
  const query = new URLSearchParams(rawQuery ?? '');
  const parts = rawPath.replace(/^\/api\//, '').replace(/\/$/, '').split('/');
  const [head, id, sub, subId] = parts;

  // ---- library ----
  if (head === 'library' && method === 'GET') {
    const folderId = query.get('folder_id');
    const archived = query.get('archived') === 'true';
    const currentFolder = folderId
      ? await db.getFirstAsync('SELECT * FROM folders WHERE id = ?', folderId)
      : null;

    let folders = [];
    if (!folderId) {
      folders = await db.getAllAsync(
        `SELECT f.*,
                (SELECT COUNT(*) FROM workspaces w WHERE w.folder_id = f.id) AS lecture_count,
                (SELECT COUNT(*) FROM lectures l
                   JOIN workspaces w2 ON l.workspace_id = w2.id
                  WHERE w2.folder_id = f.id) AS recording_count,
                (SELECT COUNT(*) FROM materials m WHERE m.folder_id = f.id) AS file_count,
                (SELECT MAX(w3.updated_at) FROM workspaces w3 WHERE w3.folder_id = f.id) AS updated_at
           FROM folders f
          WHERE f.archived_at IS ${archived ? 'NOT' : ''} NULL
          ORDER BY f.name COLLATE NOCASE`,
      );
    }

    const workspaces = folderId
      ? await db.getAllAsync(
        `SELECT w.*, (SELECT COUNT(*) FROM lectures l WHERE l.workspace_id = w.id) AS session_count
           FROM workspaces w WHERE w.folder_id = ? ORDER BY w.updated_at DESC`, folderId)
      : await db.getAllAsync(
        `SELECT w.*, (SELECT COUNT(*) FROM lectures l WHERE l.workspace_id = w.id) AS session_count
           FROM workspaces w WHERE w.folder_id IS NULL ORDER BY w.updated_at DESC`);

    const materials = folderId
      ? await db.getAllAsync(
        'SELECT * FROM materials WHERE folder_id = ? AND workspace_id IS NULL ORDER BY created_at DESC', folderId)
      : await db.getAllAsync(
        'SELECT * FROM materials WHERE folder_id IS NULL AND workspace_id IS NULL ORDER BY created_at DESC');

    return ok({
      current_folder: currentFolder ? folderJson(currentFolder) : null,
      breadcrumbs: currentFolder ? [folderJson(currentFolder)] : [],
      folders: folders.map(folderJson),
      workspaces: await Promise.all(workspaces.map((w) => workspaceJson(db, w))),
      lectures: [],
      materials: materials.map(materialJson),
    });
  }

  // ---- folders ----
  if (head === 'folders') {
    if (method === 'GET' && !id) {
      const rows = await db.getAllAsync('SELECT * FROM folders ORDER BY name COLLATE NOCASE');
      // Wrapped, not bare: the client reads result.folders, and a bare array
      // leaves it undefined, which takes the whole render down.
      return ok({ folders: rows.map(folderJson) });
    }
    if (method === 'POST' && !id) {
      const name = String(body?.name ?? '').trim();
      if (!name) return fail(422, 'Give the class a name.');
      const folder = {
        id: newId(), name, parent_id: body?.parent_id ?? null,
        color: body?.color ?? 'blue', created_at: nowIso(),
      };
      await db.runAsync(
        'INSERT INTO folders (id, name, parent_id, color, created_at) VALUES (?, ?, ?, ?, ?)',
        folder.id, folder.name, folder.parent_id, folder.color, folder.created_at,
      );
      return ok(folderJson({ ...folder, archived_at: null }));
    }
    if (method === 'PATCH' && id) {
      const existing = await db.getFirstAsync('SELECT * FROM folders WHERE id = ?', id);
      if (!existing) return fail(404, 'That class no longer exists.');
      if (body?.name !== undefined) {
        await db.runAsync('UPDATE folders SET name = ? WHERE id = ?', String(body.name).trim(), id);
      }
      if (body?.color !== undefined) {
        await db.runAsync('UPDATE folders SET color = ? WHERE id = ?', body.color, id);
      }
      if (body?.archived !== undefined) {
        await db.runAsync('UPDATE folders SET archived_at = ? WHERE id = ?', body.archived ? nowIso() : null, id);
      }
      return ok(folderJson(await db.getFirstAsync('SELECT * FROM folders WHERE id = ?', id)));
    }
    if (method === 'DELETE' && id) {
      // Lectures outlive the class they were filed under. Audio is the one
      // thing the user cannot recreate, so nothing here touches a file.
      await db.runAsync('UPDATE workspaces SET folder_id = NULL WHERE folder_id = ?', id);
      await db.runAsync('UPDATE materials SET folder_id = NULL WHERE folder_id = ?', id);
      await db.runAsync('DELETE FROM folders WHERE id = ?', id);
      return ok({ ok: true });
    }
  }

  // ---- workspaces ----
  if (head === 'workspaces' && id) {
    if (!sub && method === 'GET') {
      const row = await db.getFirstAsync('SELECT * FROM workspaces WHERE id = ?', id);
      if (!row) return fail(404, 'That lecture no longer exists.');
      return ok(await workspaceJson(db, row, { includeSessions: true }));
    }
    if (!sub && method === 'PATCH') {
      const row = await db.getFirstAsync('SELECT * FROM workspaces WHERE id = ?', id);
      if (!row) return fail(404, 'That lecture no longer exists.');
      if (body?.title !== undefined) {
        await db.runAsync('UPDATE workspaces SET title = ? WHERE id = ?', String(body.title).trim() || row.title, id);
      }
      if (body?.folder_id !== undefined) {
        await db.runAsync('UPDATE workspaces SET folder_id = ? WHERE id = ?', body.folder_id ?? null, id);
      }
      await touchWorkspace(db, id);
      return ok(await workspaceJson(db, await db.getFirstAsync('SELECT * FROM workspaces WHERE id = ?', id)));
    }
    if (!sub && method === 'DELETE') {
      // Deleting a lecture does take its audio: the user asked for that.
      const sessions = await db.getAllAsync('SELECT file_name FROM lectures WHERE workspace_id = ?', id);
      for (const session of sessions) {
        if (!session.file_name) continue;
        const file = audioFile(session.file_name);
        if (file.exists) file.delete();
      }
      await db.runAsync('DELETE FROM lectures WHERE workspace_id = ?', id);
      await db.runAsync('DELETE FROM workspace_notes WHERE workspace_id = ?', id);
      await db.runAsync('DELETE FROM workspace_study_notes WHERE workspace_id = ?', id);
      await db.runAsync('DELETE FROM workspace_flashcards WHERE workspace_id = ?', id);
      await db.runAsync('DELETE FROM materials WHERE workspace_id = ?', id);
      await db.runAsync('DELETE FROM workspaces WHERE id = ?', id);
      return ok({ ok: true });
    }
    if (sub === 'notes' && method === 'PUT') {
      await db.runAsync(
        `INSERT INTO workspace_notes (workspace_id, note_body, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET note_body = excluded.note_body, updated_at = excluded.updated_at`,
        id, String(body?.note_body ?? ''), nowIso(),
      );
      await touchWorkspace(db, id);
      return ok({ note_body: String(body?.note_body ?? ''), updated_at: nowIso() });
    }
    if (sub === 'study-notes' && !subId && method === 'PUT') {
      await db.runAsync(
        `INSERT INTO workspace_study_notes (workspace_id, note_body, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET note_body = excluded.note_body, updated_at = excluded.updated_at`,
        id, String(body?.note_body ?? ''), nowIso(),
      );
      return ok({ note_body: String(body?.note_body ?? ''), updated_at: nowIso() });
    }
    if (sub === 'study-notes' && subId === 'generate') return needsServer('Generated study notes');
    if (sub === 'flashcards' && subId === 'generate') return needsServer('Generated flashcards');
    if (sub === 'ai' && subId === 'messages') {
      if (method === 'GET') return ok([]);
      if (method === 'DELETE') return ok({ ok: true });
    }
    if (sub === 'ai') return needsServer('The AI assistant');
  }

  // ---- lectures ----
  if (head === 'lectures') {
    if (method === 'POST' && !id) return createLecture(db, body);
    if (id && sub === 'markers' && method === 'POST') {
      const marker = {
        id: newId(), lecture_id: id,
        label: String(body?.label ?? '').trim() || 'Marker',
        time_seconds: Number(body?.time_seconds ?? 0),
        created_at: nowIso(),
      };
      await db.runAsync(
        'INSERT INTO session_markers (id, lecture_id, label, time_seconds, created_at) VALUES (?, ?, ?, ?, ?)',
        marker.id, marker.lecture_id, marker.label, marker.time_seconds, marker.created_at,
      );
      return ok(marker);
    }
    if (id && sub === 'markers' && subId && method === 'DELETE') {
      await db.runAsync('DELETE FROM session_markers WHERE id = ? AND lecture_id = ?', subId, id);
      return ok({ ok: true });
    }
    if (id && sub === 'retranscribe' && method === 'POST') {
      const row = await db.getFirstAsync('SELECT * FROM lectures WHERE id = ?', id);
      if (!row) return fail(404, 'That recording is no longer on the device.');
      const file = row.file_name ? audioFile(row.file_name) : null;
      if (!file?.exists) return fail(404, 'The audio for that recording is missing.');
      // Android will only read back 16kHz mono WAV, which is what the
      // recogniser itself writes. An m4a from the fallback recorder cannot be
      // re-read, and there is no transcoder on the device.
      const server = await getSetting(TRANSCRIPTION_SERVER, '');
      if (server) {
        // The server takes any format, so this works for recordings the
        // on-device recogniser could never re-read.
        await markTranscriptionPending(id);
        return ok({ id, status: 'pending', via: 'server' });
      }
      if (!row.file_name.endsWith('.wav')) {
        return fail(503, 'This recording was captured without on-device transcription, and there is no transcription server set. Add one in Settings to transcribe it.');
      }
      if (!TRANSCRIPTION_ON_DEVICE.value) {
        return fail(503, 'This build has no on-device transcription and no server is configured.');
      }
      return ok({ id, status: 'queued', via: 'device', uri: file.uri });
    }
  }

  // ---- materials ----
  if (head === 'materials') {
    if (method === 'POST' && !id) {
      const part = body?.material;
      if (!part || !part.__file) return fail(422, 'No file was attached.');
      const material = {
        id: newId(),
        workspace_id: query.get('workspace_id'),
        folder_id: query.get('folder_id'),
        original_filename: part.__file.name,
        mime_type: part.__file.type,
        size_bytes: (part.__file.text ?? '').length,
        created_at: nowIso(),
        extraction_status: 'ready',
        extraction_message: '',
        extracted_text: part.__file.text ?? '',
      };
      await db.runAsync(
        `INSERT INTO materials (id, workspace_id, folder_id, original_filename, mime_type,
           size_bytes, created_at, extraction_status, extraction_message, extracted_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        material.id, material.workspace_id, material.folder_id, material.original_filename,
        material.mime_type, material.size_bytes, material.created_at,
        material.extraction_status, material.extraction_message, material.extracted_text,
      );
      return ok(materialJson(material));
    }
    if (method === 'DELETE' && id) {
      await db.runAsync('DELETE FROM materials WHERE id = ?', id);
      return ok({ ok: true });
    }
  }

  // ---- search ----
  if (head === 'search' && method === 'GET') {
    const term = (query.get('q') ?? '').trim();
    if (!term) return ok({ query: '', results: [] });
    const like = `%${term}%`;
    const rows = await db.getAllAsync(
      `SELECT l.id, l.title, l.workspace_id, l.created_at, l.note_body, l.transcript,
              w.title AS workspace_title
         FROM lectures l LEFT JOIN workspaces w ON w.id = l.workspace_id
        WHERE l.title LIKE ? OR l.note_body LIKE ? OR l.transcript LIKE ?
        ORDER BY l.created_at DESC LIMIT 40`,
      like, like, like,
    );
    return ok({
      query: term,
      results: rows.map((row) => {
        const haystack = row.note_body || row.transcript || '';
        const at = haystack.toLowerCase().indexOf(term.toLowerCase());
        const from = Math.max(0, at - 60);
        return {
          lecture_id: row.id,
          workspace_id: row.workspace_id,
          title: row.title,
          workspace_title: row.workspace_title,
          created_at: row.created_at,
          excerpt: at >= 0 ? `${from > 0 ? '…' : ''}${haystack.slice(from, at + 120)}…` : '',
        };
      }),
    });
  }

  // ---- settings ----
  if (head === 'settings') {
    if (method === 'GET') {
      return ok({
        transcription_server: await getSetting(TRANSCRIPTION_SERVER, ''),
        transcription_on_device: TRANSCRIPTION_ON_DEVICE.value,
      });
    }
    if (method === 'PUT' || method === 'PATCH') {
      if (body?.transcription_server !== undefined) {
        await setSetting(TRANSCRIPTION_SERVER, String(body.transcription_server ?? '').trim());
      }
      return ok({
        transcription_server: await getSetting(TRANSCRIPTION_SERVER, ''),
        transcription_on_device: TRANSCRIPTION_ON_DEVICE.value,
      });
    }
  }

  // ---- ai status ----
  if (head === 'ai' && id === 'status') {
    return ok({ available: false, models: [], detail: 'On-device AI is not available yet.' });
  }

  return fail(404, `No route for ${method} ${rawPath}`);
}

/**
 * Turns a finished native recording into a lecture. The audio never crossed
 * the bridge - the page sent a token naming the file already on disk.
 */
async function createLecture(db, body) {
  const token = body?.audio?.__recording;
  if (!token) return fail(422, 'That recording did not produce any audio.');

  const db_ = db;
  const captured = await db_.getFirstAsync('SELECT * FROM lectures WHERE id = ?', token);
  if (!captured) return fail(404, 'That recording is no longer on the device.');

  const title = String(body?.title ?? '').trim() || captured.title;
  let workspaceId = body?.workspace_id || null;

  if (!workspaceId) {
    workspaceId = newId();
    const at = nowIso();
    await db_.runAsync(
      'INSERT INTO workspaces (id, folder_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      workspaceId, body?.folder_id ?? null, title, at, at,
    );
  }

  await db_.runAsync(
    `UPDATE lectures SET workspace_id = ?, folder_id = ?, title = ?, note_body = ?, status = 'complete'
     WHERE id = ?`,
    workspaceId, body?.folder_id ?? null, title, String(body?.capture_notes ?? ''), token,
  );
  await touchWorkspace(db_, workspaceId);

  const row = await db_.getFirstAsync('SELECT * FROM lectures WHERE id = ?', token);
  return ok({
    ...(await lectureJson(db_, row, { includeContent: true })),
    workspace_id: workspaceId,
  });
}

// --- recording rows, claimed before audio exists ---------------------------

export async function claimRecording({ id, title, fileName }) {
  const db = await openDatabase();
  await db.runAsync(
    `INSERT INTO lectures (id, title, created_at, file_name, status, transcription_status)
     VALUES (?, ?, ?, ?, 'recording', 'unavailable')`,
    id, title, nowIso(), fileName,
  );
}

export async function finishRecording({ id, durationMs, sizeBytes }) {
  const db = await openDatabase();
  await db.runAsync(
    `UPDATE lectures SET duration_seconds = ?, size_bytes = ?, status = 'captured' WHERE id = ?`,
    Math.round(durationMs) / 1000, sizeBytes, id,
  );
}

/**
 * Stores what the recogniser heard. A lecture with text is 'ready'; one
 * without stays 'unavailable' so the page does not offer an empty transcript
 * as though it were a real one.
 */
export async function saveTranscript(id, transcript, segments = []) {
  const db = await openDatabase();
  const text = String(transcript ?? '').trim();
  const timed = Array.isArray(segments) ? segments.filter((s) => s?.text) : [];
  await db.runAsync(
    `UPDATE lectures SET transcript = ?, segments_json = ?, transcription_status = ?,
            transcription_progress = ?
     WHERE id = ?`,
    text, JSON.stringify(timed), text ? 'ready' : 'unavailable', text ? 1 : 0, id,
  );
}

export async function dropRecording(id) {
  const db = await openDatabase();
  const row = await db.getFirstAsync('SELECT file_name FROM lectures WHERE id = ?', id);
  await db.runAsync('DELETE FROM lectures WHERE id = ?', id);
  if (row?.file_name) {
    const file = audioFile(row.file_name);
    if (file.exists) file.delete();
  }
}

/**
 * The OS can kill a backgrounded app mid-lecture. A row still marked
 * 'recording' on launch is kept if its audio survived and dropped if not, so a
 * stopped-early lecture still reaches the library.
 */
export async function recoverInterrupted() {
  const db = await openDatabase();
  const stranded = await db.getAllAsync("SELECT * FROM lectures WHERE status = 'recording'");
  const recovered = [];
  for (const row of stranded) {
    const file = row.file_name ? audioFile(row.file_name) : null;
    if (file?.exists && (file.size ?? 0) > 0) {
      const workspaceId = newId();
      const at = nowIso();
      await db.runAsync(
        'INSERT INTO workspaces (id, folder_id, title, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)',
        workspaceId, row.title, at, at,
      );
      await db.runAsync(
        "UPDATE lectures SET status = 'recovered', workspace_id = ?, size_bytes = ? WHERE id = ?",
        workspaceId, file.size ?? 0, row.id,
      );
      recovered.push(row.id);
    } else {
      await db.runAsync('DELETE FROM lectures WHERE id = ?', row.id);
    }
  }
  return recovered;
}
