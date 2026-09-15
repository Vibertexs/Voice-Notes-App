/**
 * The on-device transcription path.
 *
 * None of this can be exercised on a device from here - it needs a dev build -
 * so the checks cover what is verifiable without one: that the two capture
 * engines stay separable, that the recogniser is configured to stay offline,
 * and that a transcript survives the round trip into the database and back out
 * in the shape the page reads.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

const here = dirname(fileURLToPath(import.meta.url));
const capture = readFileSync(join(here, '..', 'src', 'capture.js'), 'utf8');
const app = readFileSync(join(here, '..', 'App.js'), 'utf8');
const bridge = readFileSync(join(here, '..', 'src', 'bridge.js'), 'utf8');
const captureView = readFileSync(
  join(here, '..', '..', 'frontend', 'src', 'components', 'CaptureView.jsx'), 'utf8',
);
const appJson = JSON.parse(readFileSync(join(here, '..', 'app.json'), 'utf8'));

let pass = 0, total = 0;
function check(label, ok, detail) {
  total++; if (ok) pass++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '   -> ' + String(detail).slice(0, 300)));
}

console.log('== a lecture never leaves the phone ==');
check('recognition is pinned to on-device', /requiresOnDeviceRecognition:\s*true/.test(capture),
  'network recognition would upload the lecture and be rate limited');

console.log('\n== the app still works without the native module ==');
// expo-speech-recognition does not exist in Expo Go. If its absence threw, the
// app would not start there at all.
check('the module is loaded defensively', /try\s*\{[\s\S]{0,200}require\('expo-speech-recognition'\)/.test(capture),
  'a missing native module must not be fatal');
check('availability is derived, not assumed',
  /TRANSCRIPTION_AVAILABLE = speech !== null/.test(capture));
check('the fallback recorder is still wired', /prepareToRecordAsync/.test(app),
  'expo-audio must still record when the recogniser is unavailable');
check('the two engines are told apart by name', /engine: 'speech'/.test(app) && /engine: 'audio'/.test(app));

console.log('\n== pause is not offered when it cannot be honoured ==');
// One session writes one WAV; pausing would split the audio in two.
check('the shell derives pause support', /SUPPORTS_PAUSE = !TRANSCRIPTION_AVAILABLE/.test(capture));
check('capabilities reach the page', /__CN_CAPS__/.test(app) && /__CN_CAPS__/.test(bridge));
check('the page reads them', /caps\.pause !== false/.test(captureView));
check('the page does not claim to be paused when it is not',
  /Still recording/.test(captureView),
  'the label would otherwise say Paused while audio kept being captured');
check('the clock is not stopped when pause is unavailable',
  /if \(!canPause\)[\s\S]{0,400}return;/.test(captureView),
  'stopping the clock while audio continues makes the duration wrong');

console.log('\n== native config a dev build needs ==');
const android = appJson.expo.android;
check('the recogniser service is declared in queries',
  JSON.stringify(android.queries ?? []).includes('android.speech.RecognitionService'),
  'Android 11+ hides the service without a queries entry');
check('RECORD_AUDIO is declared', android.permissions.includes('android.permission.RECORD_AUDIO'));
const plugin = appJson.expo.plugins.find(
  (entry) => (Array.isArray(entry) ? entry[0] : entry) === 'expo-speech-recognition');
check('the config plugin is present', Boolean(plugin));
check('the plugin carries permission copy', Array.isArray(plugin) && Boolean(plugin[1]?.speechRecognitionPermission),
  'the OS prompt would otherwise be blank');
check('iOS declares its speech usage string',
  Boolean(appJson.expo.ios.infoPlist.NSSpeechRecognitionUsageDescription),
  'iOS rejects a build that asks for speech without a reason');

console.log('\n== a transcript survives the round trip ==');
const source = readFileSync(join(here, '..', 'src', 'localApi.js'), 'utf8');
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
  constructor(base, name) { this.uri = `${base}/${name}`; }
  get exists() { return true; }
  create() {}
}
const body = source
  .replace(/import \* as SQLite from 'expo-sqlite';/, 'const SQLite = __sqlite;')
  .replace(/import \{ Directory, File, Paths \} from 'expo-file-system';/,
    'const { Directory, File, Paths } = __fs;')
  .replace(/export (async function|function|const)/g, '$1');
const names = [...source.matchAll(/export (?:async )?(?:function|const) (\w+)/g)].map((m) => m[1]);
const api = new Function('__sqlite', '__fs', 'URLSearchParams',
  `${body}\nreturn { ${names.join(', ')} };`)(
  fakeSqlite, { File: FakeFile, Directory: FakeDirectory, Paths: { document: 'file:///doc' } },
  URLSearchParams,
);

await api.openDatabase();
await api.claimRecording({ id: 'lec1', title: 'Cell division', fileName: 'lec1.wav' });
disk.set('file:///doc/recordings/lec1.wav', 5_000_000);
await api.finishRecording({ id: 'lec1', durationMs: 600_000, sizeBytes: 5_000_000 });
await api.saveTranscript('lec1', '  mitosis produces two identical daughter cells  ');

let res = await api.handleApi({
  method: 'POST', path: '/api/lectures',
  body: { audio: { __recording: 'lec1' }, title: 'Cell division', create_workspace: 'true' },
});
const workspaceId = res.body.workspace_id;
res = await api.handleApi({ method: 'GET', path: `/api/workspaces/${workspaceId}`, body: null });
const session = res.body.sessions[0];

check('the transcript is stored', session.transcript === 'mitosis produces two identical daughter cells',
  session.transcript);
check('it is trimmed, not stored with its padding', !session.transcript.startsWith(' '));
check('status flips to ready so the page shows it', session.transcription_status === 'ready',
  session.transcription_status);
check('progress reads complete', session.transcription_progress === 1, session.transcription_progress);

console.log('\n== an empty transcript is not passed off as a real one ==');
await api.claimRecording({ id: 'lec2', title: 'Silent', fileName: 'lec2.wav' });
disk.set('file:///doc/recordings/lec2.wav', 1000);
await api.saveTranscript('lec2', '   ');
res = await api.handleApi({ method: 'POST', path: '/api/lectures',
  body: { audio: { __recording: 'lec2' }, title: 'Silent', create_workspace: 'true' } });
res = await api.handleApi({ method: 'GET', path: `/api/workspaces/${res.body.workspace_id}`, body: null });
check('silence stays unavailable rather than ready',
  res.body.sessions[0].transcription_status === 'unavailable', res.body.sessions[0].transcription_status);

console.log('\n== re-transcribing is offered only where it can work ==');
res = await api.handleApi({ method: 'POST', path: '/api/lectures/lec1/retranscribe', body: {} });
check('a wav recording can be re-read', res.status === 200, res);

await api.claimRecording({ id: 'old1', title: 'Old m4a', fileName: 'old1.m4a' });
disk.set('file:///doc/recordings/old1.m4a', 1000);
res = await api.handleApi({ method: 'POST', path: '/api/lectures/old1/retranscribe', body: {} });
check('an m4a says plainly that it cannot be', res.status === 503 && /cannot be transcribed/.test(res.body.detail),
  res);

console.log('\n' + pass + '/' + total + ' passed');
process.exit(pass === total ? 0 : 1);
