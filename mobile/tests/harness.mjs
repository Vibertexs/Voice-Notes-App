/**
 * Phones, under Node.
 *
 * Each call to makePhone() is a separate device: its own SQLite (sql.js), its
 * own fake disk, and its own copy of localApi.js - the module keeps its
 * database in a module-level variable, so two phones need two instances. The
 * Expo imports are swapped for these fakes the same way local_api.test.mjs
 * does it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (name) => readFileSync(join(here, '..', 'src', name), 'utf8');
const SQL = await initSqlJs();

function exportsOf(source) {
  return [...source.matchAll(/export (?:async )?(?:function|const|class) (\w+)/g)].map((m) => m[1]);
}
function stripExports(source) {
  return source.replace(/export (async function|function|const|class)/g, '$1');
}

export function makePhone() {
  const db = new SQL.Database();
  const rows = (sql, args) => {
    const stmt = db.prepare(sql); stmt.bind(args);
    const out = []; while (stmt.step()) out.push(stmt.getAsObject());
    stmt.free(); return out;
  };
  const handle = {
    execAsync: async (sql) => { db.run(sql); },
    runAsync: async (sql, ...args) => { db.run(sql, args); },
    getAllAsync: async (sql, ...args) => rows(sql, args),
    getFirstAsync: async (sql, ...args) => rows(sql, args)[0] ?? null,
  };
  const fakeSqlite = { openDatabaseAsync: async () => handle };

  const disk = new Map();
  class FakeFile {
    constructor(parent, name) { this.uri = name ? `${parent.uri}/${name}` : String(parent); }
    get exists() { return disk.has(this.uri); }
    get size() { return disk.get(this.uri) ?? 0; }
    delete() { disk.delete(this.uri); }
  }
  class FakeDirectory {
    constructor(base, name) { this.uri = `${base}/${name}`; }
    get exists() { return true; }
    create() {}
  }
  const fakeFs = { File: FakeFile, Directory: FakeDirectory, Paths: { document: 'file:///doc' } };

  const source = src('localApi.js');
  const body = stripExports(source)
    .replace(/import \* as SQLite from 'expo-sqlite';/, 'const SQLite = __sqlite;')
    .replace(/import \{ ON_DEVICE_MODEL \} from '\.\/onDeviceWhisper';/,
      "const ON_DEVICE_MODEL = { name: 'Whisper Small English' };")
    .replace(/import \{ Directory, File, Paths \} from 'expo-file-system';/,
      'const { Directory, File, Paths } = __fs;');
  const api = new Function('__sqlite', '__fs', 'URLSearchParams',
    `${body}\nreturn { ${exportsOf(source).join(', ')} };`)(fakeSqlite, fakeFs, URLSearchParams);

  const call = (method) => (path, payload = null) => api.handleApi({ method, path, body: payload });
  return {
    api, disk, sql: (q, ...args) => rows(q, args),
    GET: call('GET'), POST: call('POST'), PATCH: call('PATCH'), PUT: call('PUT'), DELETE: call('DELETE'),
  };
}

export function loadCloudSync() {
  const source = src('cloudSync.js');
  return new Function(`${stripExports(source)}\nreturn { ${exportsOf(source).join(', ')} };`)();
}

/**
 * Records a lecture the way App.js does - claim, finish, post - and gives it
 * a Whisper-shaped transcript. Returns the workspace id, which is also the id
 * the recording has in the cloud.
 */
export async function recordLecture(phone, { title, folderId = null, words = 'the mitochondria is the powerhouse' } = {}) {
  const id = `rec${Math.random().toString(36).slice(2, 10)}`;
  await phone.api.claimRecording({ id, title, fileName: `${id}.wav` });
  phone.disk.set(`file:///doc/recordings/${id}.wav`, 960_000);
  await phone.api.finishRecording({ id, durationMs: 30_000, sizeBytes: 960_000 });
  const res = await phone.POST('/api/lectures', { audio: { __recording: id }, title, folder_id: folderId });
  const parts = words.split(' ');
  const segment = {
    text: words,
    start_seconds: 1.5,
    end_seconds: 1.5 + parts.length * 0.4,
    words: parts.map((word, i) => ({ start: 1.5 + i * 0.4, end: 1.8 + i * 0.4, word: i ? ` ${word}` : word })),
  };
  await phone.api.saveTranscript(id, words, [segment]);
  return { workspaceId: res.body.workspace_id, lectureId: id, segment };
}

export function checker() {
  let pass = 0, total = 0;
  const check = (label, ok, detail) => {
    total++; if (ok) pass++;
    console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '   -> ' + JSON.stringify(detail)));
  };
  const done = () => {
    console.log('\n' + pass + '/' + total + ' passed');
    process.exitCode = pass === total ? 0 : 1;
  };
  return { check, done };
}
