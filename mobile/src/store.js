import * as SQLite from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Local store. Audio lives as files on disk; only metadata goes in SQLite.
 *
 * Audio is never held in memory as a whole: the recorder writes straight to a
 * file, and playback streams from it. A 50 minute lecture is ~25MB on disk but
 * would be ~190MB decoded, which a phone will not tolerate.
 */

const DB_NAME = 'classnotes.db';
export const RECORDINGS_DIR = new Directory(Paths.document, 'recordings');

let database = null;

export async function openStore() {
  if (database) return database;
  if (!RECORDINGS_DIR.exists) RECORDINGS_DIR.create({ intermediates: true });

  database = await SQLite.openDatabaseAsync(DB_NAME);
  // WAL so a write during playback does not block reads.
  await database.execAsync('PRAGMA journal_mode = WAL;');
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'complete'
    );
    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT 'blue',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  // Classes arrived after the first recordings did, so the column is added
  // rather than declared. ALTER TABLE throws if it is already there; an
  // existing column is the expected state on every launch but the first.
  try {
    await database.execAsync('ALTER TABLE recordings ADD COLUMN class_id TEXT');
  } catch {
    /* already migrated */
  }
  return database;
}

// --- classes ---------------------------------------------------------------

export async function listClasses({ archived = false } = {}) {
  const db = await openStore();
  return db.getAllAsync(
    `SELECT c.*, (
       SELECT COUNT(*) FROM recordings r WHERE r.class_id = c.id
     ) AS lecture_count
     FROM classes c WHERE c.archived = ? ORDER BY c.created_at ASC`,
    archived ? 1 : 0,
  );
}

export async function createClass({ id, name, color, createdAt }) {
  const db = await openStore();
  await db.runAsync(
    'INSERT INTO classes (id, name, color, created_at) VALUES (?, ?, ?, ?)',
    id, name, color, createdAt,
  );
}

export async function renameClass(id, name) {
  const db = await openStore();
  await db.runAsync('UPDATE classes SET name = ? WHERE id = ?', name, id);
}

export async function recolorClass(id, color) {
  const db = await openStore();
  await db.runAsync('UPDATE classes SET color = ? WHERE id = ?', color, id);
}

export async function archiveClass(id, archived) {
  const db = await openStore();
  await db.runAsync('UPDATE classes SET archived = ? WHERE id = ?', archived ? 1 : 0, id);
}

/**
 * Deleting a class keeps its lectures: they fall back to unfiled rather than
 * taking recordings down with them. Audio is the one thing the user cannot
 * recreate, so nothing here deletes a file.
 */
export async function deleteClass(id) {
  const db = await openStore();
  await db.runAsync('UPDATE recordings SET class_id = NULL WHERE class_id = ?', id);
  await db.runAsync('DELETE FROM classes WHERE id = ?', id);
}

export async function fileRecording(id, classId) {
  const db = await openStore();
  await db.runAsync('UPDATE recordings SET class_id = ? WHERE id = ?', classId ?? null, id);
}

export function recordingFile(fileName) {
  return new File(RECORDINGS_DIR, fileName);
}

export async function listRecordings({ classId } = {}) {
  const db = await openStore();
  if (classId === undefined) {
    return db.getAllAsync('SELECT * FROM recordings ORDER BY created_at DESC');
  }
  if (classId === null) {
    return db.getAllAsync('SELECT * FROM recordings WHERE class_id IS NULL ORDER BY created_at DESC');
  }
  return db.getAllAsync('SELECT * FROM recordings WHERE class_id = ? ORDER BY created_at DESC', classId);
}

export async function getRecording(id) {
  const db = await openStore();
  return db.getFirstAsync('SELECT * FROM recordings WHERE id = ?', id);
}

/**
 * Claim a row before recording starts, so a crash mid-lecture still leaves a
 * pointer to whatever audio reached the disk.
 */
export async function beginRecording({ id, title, fileName, createdAt, classId = null }) {
  const db = await openStore();
  await db.runAsync(
    `INSERT INTO recordings (id, title, file_name, created_at, class_id, status)
     VALUES (?, ?, ?, ?, ?, 'recording')`,
    id, title, fileName, createdAt, classId,
  );
}

export async function completeRecording({ id, durationMs, sizeBytes }) {
  const db = await openStore();
  await db.runAsync(
    `UPDATE recordings SET status = 'complete', duration_ms = ?, size_bytes = ?
     WHERE id = ?`,
    Math.round(durationMs), sizeBytes, id,
  );
}

export async function saveNotes(id, notes) {
  const db = await openStore();
  await db.runAsync('UPDATE recordings SET notes = ? WHERE id = ?', notes, id);
}

export async function renameRecording(id, title) {
  const db = await openStore();
  await db.runAsync('UPDATE recordings SET title = ? WHERE id = ?', title, id);
}

export async function deleteRecording(id) {
  const db = await openStore();
  const row = await getRecording(id);
  await db.runAsync('DELETE FROM recordings WHERE id = ?', id);
  if (row) {
    const file = recordingFile(row.file_name);
    if (file.exists) file.delete();
  }
}

/**
 * The OS can kill a backgrounded app mid-lecture. Anything still marked
 * 'recording' on launch is adopted if its audio survived, dropped if not.
 */
export async function recoverInterrupted() {
  const db = await openStore();
  const stranded = await db.getAllAsync("SELECT * FROM recordings WHERE status = 'recording'");
  const recovered = [];
  for (const row of stranded) {
    const file = recordingFile(row.file_name);
    if (file.exists && (file.size ?? 0) > 0) {
      await db.runAsync(
        "UPDATE recordings SET status = 'recovered', size_bytes = ? WHERE id = ?",
        file.size ?? 0, row.id,
      );
      recovered.push(row.id);
    } else {
      await db.runAsync('DELETE FROM recordings WHERE id = ?', row.id);
    }
  }
  return recovered;
}
