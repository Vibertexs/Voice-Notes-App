/**
 * Two phones, the real server, a real MongoDB.
 *
 *   cd mobile && npm run test:e2e
 *
 * Starts the cloud API (cloud_app.py) with uvicorn against a throwaway
 * database on the cluster in the repo's .env, runs two sql.js phones through
 * sign-up, sync, edits on both sides, a conflict, a delete and an edit made
 * over the REST API, then drops the database. Nothing is mocked between the
 * phone's SQLite and Atlas.
 *
 * Not part of `npm test`: it needs Python, the venv and network access to the
 * cluster. Set CLOUD_TEST_URL to run it against a server you started yourself.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checker, loadCloudSync, makePhone, recordLecture } from './harness.mjs';

const { check, done } = checker();
const { createCloud } = loadCloudSync();
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const python = [join(root, '.venv', 'Scripts', 'python.exe'), join(root, '.venv', 'bin', 'python')].find(existsSync) ?? 'python';
const database = `voiceflow_test_e2e_${Math.random().toString(36).slice(2, 10)}`;

const freePort = () => new Promise((resolve) => {
  const probe = createServer().listen(0, () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

let serverProcess = null;
let url = process.env.CLOUD_TEST_URL;
if (!url) {
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  serverProcess = spawn(python, ['-m', 'uvicorn', 'cloud_app:app', '--port', String(port)], {
    cwd: root,
    env: { ...process.env, MONGODB_DB: database, ENVIRONMENT: 'test', RATE_LIMITS_ENABLED: 'false', SEARCH_BACKEND: 'regex' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  serverProcess.stdout.on('data', (chunk) => { log += chunk; });
  serverProcess.stderr.on('data', (chunk) => { log += chunk; });
  const deadline = Date.now() + 45_000;
  for (;;) {
    try { if ((await fetch(`${url}/readyz`)).ok) break; } catch { /* not up yet */ }
    if (Date.now() > deadline || serverProcess.exitCode != null) {
      console.log(log);
      throw new Error('the cloud API did not start');
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

function connect(phone, name) {
  const cloud = createCloud({
    openDatabase: phone.api.openDatabase, exclusive: phone.api.exclusive, fetch,
    apiUrl: url, deviceName: name, audioFile: phone.api.audioFile,
  });
  phone.api.ACCOUNT.handler = cloud.handleAccountApi;
  return cloud;
}

const email = `e2e-${Date.now()}@example.com`;
const password = 'lecture notes forever';

try {
  // -------------------------------------------------------------------------
  console.log('== phone A has a semester of work, then signs up ==');
  const a = makePhone();
  await a.api.openDatabase();
  const cloudA = connect(a, 'Phone A');
  const folder = (await a.POST('/api/folders', { name: 'Biology', color: 'red' })).body;
  const mitosis = await recordLecture(a, { title: 'Mitosis', folderId: folder.id, words: 'prophase metaphase anaphase telophase' });
  await a.POST(`/api/lectures/${mitosis.lectureId}/markers`, { label: 'On the exam', time_seconds: 61 });
  await a.PUT(`/api/workspaces/${mitosis.workspaceId}/notes`, { note_body: 'PMAT' });

  let res = await a.POST('/api/account/register', { email, password });
  check('signed up from the phone', res.status === 200 && res.body.signedIn === true, res);
  await cloudA.syncNow();
  res = await a.GET('/api/account');
  check('everything uploaded', res.body.pending === 0 && !res.body.lastError, res.body);

  // -------------------------------------------------------------------------
  console.log('\n== phone B signs in and gets it all ==');
  const b = makePhone();
  await b.api.openDatabase();
  const cloudB = connect(b, 'Phone B');
  res = await b.POST('/api/account/login', { email, password });
  check('signed in on the second phone', res.status === 200, res);
  await cloudB.syncNow();
  res = await b.GET(`/api/library?folder_id=${folder.id}`);
  check('the folder arrived, with the recording in it', res.body.current_folder?.name === 'Biology' && res.body.workspaces[0]?.title === 'Mitosis', res.body);
  res = await b.GET(`/api/workspaces/${mitosis.workspaceId}`);
  const session = res.body.sessions?.[0];
  check('the transcript arrived with word timings', session?.segments?.[0]?.words?.[3]?.word === ' telophase', session?.segments);
  check('the bookmark arrived', session?.markers?.[0]?.label === 'On the exam', session?.markers);
  check('the notes arrived', res.body.note_body === 'PMAT', res.body.note_body);
  check('the audio did not', session?.audio_url === null, session?.audio_url);
  res = await b.GET('/api/search?q=anaphase');
  check("phone B's own search finds the synced transcript", res.body.results[0]?.workspace_id === mitosis.workspaceId, res.body);

  // -------------------------------------------------------------------------
  console.log('\n== edits on B reach A ==');
  await b.PATCH(`/api/workspaces/${mitosis.workspaceId}`, { title: 'Mitosis (week 3)', favorite: true });
  const bLecture = (await b.GET(`/api/workspaces/${mitosis.workspaceId}`)).body.sessions[0].id;
  await b.POST(`/api/lectures/${bLecture}/markers`, { label: 'Diagram', time_seconds: 90 });
  await cloudB.syncNow();
  await cloudA.syncNow();
  res = await a.GET(`/api/workspaces/${mitosis.workspaceId}`);
  check('the rename reached A', res.body.title === 'Mitosis (week 3)', res.body.title);
  check('the favourite reached A', res.body.favorite === true);
  check('both bookmarks are on A', res.body.sessions[0].markers.map((m) => m.label).sort().join() === 'Diagram,On the exam', res.body.sessions[0].markers);
  check('A still has its audio', String(res.body.sessions[0].audio_url).endsWith('.wav'), res.body.sessions[0].audio_url);
  check('...and is still the one the server says has it', (await a.GET('/api/account')).body.pending === 0);

  // -------------------------------------------------------------------------
  console.log('\n== both edit offline; the later edit wins on both ==');
  await a.PATCH(`/api/folders/${folder.id}`, { name: 'Bio (A, earlier)' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await b.PATCH(`/api/folders/${folder.id}`, { name: 'Bio 101 (B, later)' });
  await cloudA.syncNow();
  await cloudB.syncNow();
  await cloudA.syncNow();
  const nameOn = async (phone) => (await phone.GET('/api/folders')).body.folders.find((f) => f.id === folder.id)?.name;
  check('A ends with the later name', await nameOn(a) === 'Bio 101 (B, later)', await nameOn(a));
  check('B keeps the later name', await nameOn(b) === 'Bio 101 (B, later)', await nameOn(b));

  // -------------------------------------------------------------------------
  console.log('\n== an edit made over the REST API (what an MCP server will do) ==');
  const login = await (await fetch(`${url}/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  })).json();
  const rest = await fetch(`${url}/v1/recordings/${mitosis.workspaceId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.accessToken}` },
    body: JSON.stringify({ title: 'Renamed by an assistant' }),
  });
  check('the API accepted it', rest.status === 200, rest.status);
  await cloudA.syncNow();
  await cloudB.syncNow();
  check('A has it', (await a.GET(`/api/workspaces/${mitosis.workspaceId}`)).body.title === 'Renamed by an assistant');
  check('B has it', (await b.GET(`/api/workspaces/${mitosis.workspaceId}`)).body.title === 'Renamed by an assistant');
  const found = await (await fetch(`${url}/v1/search?q=metaphase`, { headers: { Authorization: `Bearer ${login.accessToken}` } })).json();
  check('server search finds the moment it was said', found.results[0]?.recordingId === mitosis.workspaceId && found.results[0]?.startSeconds === 1.5, found);

  // -------------------------------------------------------------------------
  console.log('\n== deleting on one phone deletes on the other ==');
  const extra = await recordLecture(a, { title: 'Office hours' });
  await cloudA.syncNow();
  await cloudB.syncNow();
  check('B got the new recording', (await b.GET(`/api/workspaces/${extra.workspaceId}`)).status === 200);
  await b.DELETE(`/api/workspaces/${extra.workspaceId}`);
  await cloudB.syncNow();
  await cloudA.syncNow();
  check('gone from A', (await a.GET(`/api/workspaces/${extra.workspaceId}`)).status === 404);
  check("...with A's audio file", !a.disk.has(`file:///doc/recordings/${extra.lectureId}.wav`));
  const transcript = await fetch(`${url}/v1/recordings/${extra.workspaceId}/transcript`, { headers: { Authorization: `Bearer ${login.accessToken}` } });
  check('and its transcript is gone from the server', transcript.status === 404, transcript.status);

  // -------------------------------------------------------------------------
  console.log('\n== signing out ==');
  await b.POST('/api/account/logout');
  await b.PATCH(`/api/folders/${folder.id}`, { name: 'Edited while signed out' });
  res = await b.POST('/api/account/sync');
  check('a signed-out phone does not sync', res.status === 401, res);
  check("A is unaffected by B's sign-out", (await a.POST('/api/account/sync')).status === 200);

  cloudA.stop();
  cloudB.stop();
} finally {
  if (serverProcess) {
    serverProcess.kill();
    const drop = spawnSync(python, ['-c', [
      'from backend.cloud.config import Settings',
      'from pymongo import MongoClient',
      `name = "${database}"`,
      'assert name.startswith("voiceflow_test_")',
      'MongoClient(Settings().mongodb_uri).drop_database(name)',
    ].join('\n')], { cwd: root, encoding: 'utf8' });
    console.log(drop.status === 0 ? `\n(dropped ${database})` : `\ncould not drop ${database}: ${drop.stderr}`);
  }
  done();
}
