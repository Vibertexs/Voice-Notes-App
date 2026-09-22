/**
 * Drives src/localApi.js the way the real web client drives FastAPI.
 *
 * The client is unmodified, so a missing field is a broken screen rather than
 * a caught error. These checks assert the JSON shapes the components actually
 * read, not just that a call succeeded.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'localApi.js'), 'utf8');

let pass = 0, total = 0;
function check(label, ok, detail) {
  total++; if (ok) pass++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '   -> ' + JSON.stringify(detail)));
}

const SQL = await initSqlJs();
const db = new SQL.Database();

const fakeSqlite = {
  openDatabaseAsync: async () => ({
    execAsync: async (sql) => { db.run(sql); },
    runAsync: async (sql, ...args) => { db.run(sql, args); },
    getAllAsync: async (sql, ...args) => {
      const stmt = db.prepare(sql); stmt.bind(args);
      const rows = []; while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free(); return rows;
    },
    getFirstAsync: async (sql, ...args) => {
      const stmt = db.prepare(sql); stmt.bind(args);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free(); return row;
    },
  }),
};

const disk = new Map();
class FakeFile {
  constructor(parent, name) { this.uri = name ? `${parent.uri}/${name}` : String(parent); }
  get exists() { return disk.has(this.uri); }
  get size() { return disk.get(this.uri) ?? 0; }
  delete() { disk.delete(this.uri); }
}
class FakeDirectory {
  constructor(base, name) { this.uri = `${base}/${name}`; this.made = true; }
  get exists() { return this.made; }
  create() { this.made = true; }
}
const fakeFs = { File: FakeFile, Directory: FakeDirectory, Paths: { document: 'file:///doc' } };

const body = source
  .replace(/import \* as SQLite from 'expo-sqlite';/, 'const SQLite = __sqlite;')
  .replace(/import \{ Directory, File, Paths \} from 'expo-file-system';/,
    'const { Directory, File, Paths } = __fs;')
  .replace(/export (async function|function|const)/g, '$1');
const names = [...source.matchAll(/export (?:async )?(?:function|const) (\w+)/g)].map((m) => m[1]);
const factory = new Function('__sqlite', '__fs', 'URLSearchParams',
  `${body}\nreturn { ${names.join(', ')} };`);
const api = factory(fakeSqlite, fakeFs, URLSearchParams);

const GET = (path) => api.handleApi({ method: 'GET', path, body: null });
const POST = (path, b) => api.handleApi({ method: 'POST', path, body: b });
const PATCH = (path, b) => api.handleApi({ method: 'PATCH', path, body: b });
const PUT = (path, b) => api.handleApi({ method: 'PUT', path, body: b });
const DELETE = (path) => api.handleApi({ method: 'DELETE', path, body: null });

console.log('== an empty library still has every key the folder screens read ==');
let res = await GET('/api/library');
check('200', res.status === 200, res);
for (const key of ['current_folder', 'breadcrumbs', 'folders', 'workspaces', 'lectures', 'materials']) {
  check(`library.${key} present`, key in res.body, Object.keys(res.body));
}
check('folders is an array', Array.isArray(res.body.folders));

console.log('\n== response envelopes match what the client destructures ==');
// Twice now a handler returned the right data in the wrong wrapper. The client
// reads that as undefined and the render dies, so assert the envelope itself,
// not only the contents.
res = await GET('/api/folders');
check('/api/folders is wrapped in {folders}, not bare', Array.isArray(res.body?.folders), res.body);
res = await GET('/api/search?q=x');
check('/api/search returns {query, results}', Array.isArray(res.body?.results), res.body);
res = await GET('/api/ai/status');
check('/api/ai/status returns an object, not a list',
  res.body && typeof res.body === 'object' && !Array.isArray(res.body), res.body);

console.log('\n== creating a class ==');
res = await POST('/api/folders', { name: 'Biology', color: 'mint', icon: 'education' });
const bio = res.body;
check('201-ish with an id', Boolean(bio.id), bio);
check('FolderCard reads .name', bio.name === 'Biology');
check('FolderCard reads .color', bio.color === 'mint');
check('FolderCard reads .archived', bio.archived === false);
check('FolderCard reads .icon', bio.icon === 'education', bio);
res = await GET('/api/library');
check('appears in the grid', res.body.folders.length === 1);
check('FolderCard reads .lecture_count', res.body.folders[0].lecture_count === 0, res.body.folders[0]);
res = await PATCH(`/api/folders/${bio.id}`, { icon: 'music' });
check('the icon can be changed', res.body.icon === 'music', res.body);

console.log('\n== recording, then posting it as a lecture ==');
await api.claimRecording({ id: 'rec1', title: 'Mitosis', fileName: 'rec1.m4a' });
disk.set('file:///doc/recordings/rec1.m4a', 4_000_000);
await api.finishRecording({ id: 'rec1', durationMs: 1_500_000, sizeBytes: 4_000_000 });

res = await POST('/api/lectures', {
  audio: { __recording: 'rec1' },
  title: 'Mitosis',
  capture_notes: 'spindle fibres',
  create_workspace: 'true',
  folder_id: bio.id,
});
check('lecture created', res.status === 200, res);
const workspaceId = res.body.workspace_id;
check('a workspace was created for it', Boolean(workspaceId), res.body);
check('audio_url points at the file on disk', String(res.body.audio_url).endsWith('rec1.m4a'), res.body.audio_url);
check('duration survived', res.body.duration_seconds === 1500, res.body.duration_seconds);

console.log('\n== the audio bytes never cross the bridge ==');
res = await POST('/api/lectures', { title: 'No audio' });
check('a post with no token is rejected', res.status === 422, res);

console.log('\n== the playback screen reads the full workspace ==');
res = await GET(`/api/workspaces/${workspaceId}`);
check('200', res.status === 200, res);
for (const key of ['sessions', 'note_body', 'study_notes', 'materials', 'flashcards', 'title']) {
  check(`workspace.${key} present`, key in res.body, Object.keys(res.body));
}
check('the recording is in sessions', res.body.sessions.length === 1, res.body.sessions);
check('capture notes landed on the session', res.body.sessions[0].note_body === 'spindle fibres');
check('session carries markers array', Array.isArray(res.body.sessions[0].markers));
check('session carries segments array', Array.isArray(res.body.sessions[0].segments));
// The header's heart and the row's runtime read these two directly.
check('workspace carries .favorite', res.body.favorite === false, res.body.favorite);
res = await PATCH(`/api/workspaces/${workspaceId}`, { favorite: true });
check('favouriting sticks', res.body.favorite === true, res.body);
res = await GET(`/api/library?folder_id=${bio.id}`);
check('a listed recording carries .duration_seconds',
  res.body.workspaces[0].duration_seconds > 0, res.body.workspaces[0]);
check('a listed recording carries .favorite', res.body.workspaces[0].favorite === true,
  res.body.workspaces[0]);

console.log('\n== the class now counts its lecture ==');
res = await GET('/api/library');
check('lecture_count is 1', res.body.folders[0].lecture_count === 1, res.body.folders[0]);
res = await GET(`/api/library?folder_id=${bio.id}`);
check('opening the class shows it', res.body.workspaces.length === 1, res.body.workspaces);
check('current_folder is set', res.body.current_folder?.id === bio.id);
check('session_count is on the card', res.body.workspaces[0].session_count === 1, res.body.workspaces[0]);

console.log('\n== notes round-trip ==');
await PUT(`/api/workspaces/${workspaceId}/notes`, { note_body: 'prophase, metaphase' });
res = await GET(`/api/workspaces/${workspaceId}`);
check('notes saved', res.body.note_body === 'prophase, metaphase', res.body.note_body);
await PUT(`/api/workspaces/${workspaceId}/study-notes`, { note_body: 'exam 2' });
res = await GET(`/api/workspaces/${workspaceId}`);
check('study notes saved separately', res.body.study_notes === 'exam 2');

console.log('\n== markers ==');
res = await POST('/api/lectures/rec1/markers', { label: 'key point', time_seconds: 42.5 });
const markerId = res.body.id;
check('marker created', Boolean(markerId), res.body);
res = await GET(`/api/workspaces/${workspaceId}`);
check('marker visible on the session', res.body.sessions[0].markers.length === 1);
await DELETE(`/api/lectures/rec1/markers/${markerId}`);
res = await GET(`/api/workspaces/${workspaceId}`);
check('marker deleted', res.body.sessions[0].markers.length === 0);

console.log('\n== archive and recolour ==');
await PATCH(`/api/folders/${bio.id}`, { archived: true });
res = await GET('/api/library');
check('archived class leaves the default grid', res.body.folders.length === 0, res.body.folders);
res = await GET('/api/library?archived=true');
check('and appears under archived', res.body.folders.length === 1);
await PATCH(`/api/folders/${bio.id}`, { archived: false });
await PATCH(`/api/folders/${bio.id}`, { color: 'coral' });
res = await GET('/api/library');
check('recoloured', res.body.folders[0].color === 'coral');

console.log('\n== search finds a lecture by its notes ==');
res = await GET('/api/search?q=' + encodeURIComponent('spindle'));
check('one hit', res.body.results.length === 1, res.body.results);
check('hit carries an excerpt', res.body.results[0].excerpt.includes('spindle'), res.body.results[0]);
res = await GET('/api/search?q=' + encodeURIComponent('nothing-matches-this'));
check('no false positives', res.body.results.length === 0);

console.log('\n== unavailable features and legacy formats explain themselves ==');
for (const [label, call] of [
  ['ai questions', () => POST(`/api/workspaces/${workspaceId}/ai/questions`, { question: 'x' })],
  ['flashcards', () => POST(`/api/workspaces/${workspaceId}/flashcards/generate`, {})],
]) {
  const r = await call();
  check(`${label} returns a real error, not a fake success`, r.status === 503 && typeof r.body.detail === 'string', r);
}
res = await POST('/api/lectures/rec1/retranscribe', {});
check('a legacy m4a explains the private WAV limitation',
  res.status === 422 && /WAV/.test(res.body.detail), res);
res = await GET('/api/ai/status');
check('ai status reports unavailable rather than failing', res.status === 200 && res.body.available === false, res);

console.log('\n== deleting a class keeps its lectures ==');
await DELETE(`/api/folders/${bio.id}`);
res = await GET('/api/library');
check('class gone', res.body.folders.length === 0);
check('its lecture is still there, unfiled', res.body.workspaces.length === 1, res.body.workspaces);
check('the audio was not deleted', disk.has('file:///doc/recordings/rec1.m4a'));

console.log('\n== deleting the lecture does take the audio ==');
await DELETE(`/api/workspaces/${workspaceId}`);
check('audio deleted with the lecture', !disk.has('file:///doc/recordings/rec1.m4a'));
res = await GET('/api/library');
check('library is empty again', res.body.workspaces.length === 0);

console.log('\n== an unknown route 404s rather than hanging the page ==');
res = await GET('/api/does-not-exist');
check('404', res.status === 404, res);

console.log('\n' + pass + '/' + total + ' passed');
process.exit(pass === total ? 0 : 1);
