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
// The guarantee is only real if there is no path that flips it off. A missing
// offline model must mean no transcript, never a silent upload.
check('no code path turns on-device recognition off',
  !/requiresOnDeviceRecognition:\s*(false|onDevice|[a-z]\w*\.\w+)/.test(capture),
  'a variable here is a way for a lecture to leave the phone');

console.log('\n== the language pack installs itself ==');
// Expecting a user to find Android speech settings and install English by
// hand is not a product. The app asks for it, and upgrades when it lands.
check('the app triggers the download itself',
  /androidTriggerOfflineModelDownload/.test(capture),
  'the user would otherwise have to install a language pack by hand');
check('it does not re-open the system dialog on every check',
  /downloadRequested/.test(capture),
  'Android 13 opens a dialog; reopening it repeatedly is its own bug');
check('support is re-checked, not decided once',
  /export async function refreshOnDeviceSupport/.test(capture));
check('the shell keeps watching after the first failure',
  /refreshOnDeviceSupport\(\)/.test(app) && /setInterval\(recheck/.test(app),
  'a pack that arrives later must not need a restart');
check('the page is told when capability changes',
  /cn:caps/.test(app) && /cn:caps/.test(captureView),
  'the capture screen would otherwise keep hiding the transcript panel');
check('Android below 13 is reported, not retried forever',
  /Platform\.Version\) < 33/.test(capture),
  'the download API does not exist before Android 13');
check('every model state has something to say',
  /export function describeModelStatus/.test(capture));

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

console.log('\n== re-transcribing routes to whatever can actually do it ==');
await api.claimRecording({ id: 'old1', title: 'Old m4a', fileName: 'old1.m4a' });
disk.set('file:///doc/recordings/old1.m4a', 1000);

// Nothing available: no server set, and this build has no recogniser.
api.TRANSCRIPTION_ON_DEVICE.value = false;
res = await api.handleApi({ method: 'POST', path: '/api/lectures/lec1/retranscribe', body: {} });
check('with nothing available it says so rather than pretending', res.status === 503, res);

// On-device only: a WAV can be re-read, an m4a cannot, and the message says why.
api.TRANSCRIPTION_ON_DEVICE.value = true;
res = await api.handleApi({ method: 'POST', path: '/api/lectures/lec1/retranscribe', body: {} });
check('on device, a wav is re-read', res.status === 200 && res.body.via === 'device', res);
res = await api.handleApi({ method: 'POST', path: '/api/lectures/old1/retranscribe', body: {} });
check('on device, an m4a explains it cannot be', res.status === 503 && /server/i.test(res.body.detail), res);

// With a server, format stops mattering - it takes anything.
await api.setSetting(api.TRANSCRIPTION_SERVER, 'http://100.76.29.83:8000');
res = await api.handleApi({ method: 'POST', path: '/api/lectures/old1/retranscribe', body: {} });
check('a server takes the m4a the device could not', res.status === 200 && res.body.via === 'server', res);
check('and the lecture is queued, not transcribed inline', res.body.status === 'pending', res.body);

console.log('\n== the queue is what makes an unreachable server survivable ==');
const queued = await api.pendingTranscriptions();
check('the queued lecture is listed', queued.some((row) => row.id === 'old1'), queued.map((r) => r.id));
check('only lectures with audio are queued', queued.every((row) => row.file_name), queued);

console.log('\n== the server address is a setting, not a constant ==');
res = await api.handleApi({ method: 'GET', path: '/api/settings', body: null });
check('settings report the configured server',
  res.body.transcription_server === 'http://100.76.29.83:8000', res.body);
res = await api.handleApi({ method: 'PUT', path: '/api/settings',
  body: { transcription_server: '  https://api.example.com/  ' } });
check('a new address replaces it', res.body.transcription_server === 'https://api.example.com/', res.body);
res = await api.handleApi({ method: 'PUT', path: '/api/settings', body: { transcription_server: '' } });
check('and it can be cleared back to device-only', res.body.transcription_server === '', res.body);

console.log('\n' + pass + '/' + total + ' passed');
process.exit(pass === total ? 0 : 1);
