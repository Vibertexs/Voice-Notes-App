/**
 * The private mobile transcription path.
 *
 * Device-native modules cannot run in Node, so this suite checks the pieces we
 * can prove here: Whisper receives a local WAV, model download is the only
 * network operation, the shell has no endpoint fallback, and its results keep
 * their timed shape through SQLite.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, '..', 'App.js'), 'utf8');
const whisper = readFileSync(join(here, '..', 'src', 'onDeviceWhisper.js'), 'utf8');
const bridge = readFileSync(join(here, '..', 'src', 'bridge.js'), 'utf8');
const captureView = readFileSync(
  join(here, '..', '..', 'frontend', 'src', 'components', 'RecordScreen.jsx'), 'utf8',
);
const styles = readFileSync(join(here, '..', '..', 'frontend', 'src', 'styles.css'), 'utf8');
const settingsView = readFileSync(
  join(here, '..', '..', 'frontend', 'src', 'components', 'SettingsDialog.jsx'), 'utf8',
);
const appJson = JSON.parse(readFileSync(join(here, '..', 'app.json'), 'utf8'));

let pass = 0, total = 0;
function check(label, ok, detail) {
  total++; if (ok) pass++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '   -> ' + String(detail).slice(0, 300)));
}

console.log('== Whisper stays on the phone ==');
check('the native binding is installed', existsSync(join(here, '..', 'node_modules', 'whisper.rn')));
check('the local module initializes whisper.cpp',
  /require\('whisper\.rn'\)/.test(whisper) && /loadWhisper\(\)\(\{/.test(whisper));
// whisper.rn is a native module: importing it at module scope in a binary
// built before it was added throws before React renders, and the whole app is
// a red screen. It must be reached for only when it is about to be used.
check('it is loaded lazily, not at import',
  !/^import .*from 'whisper\.rn'/m.test(whisper),
  'a top-level import takes the entire app down on an older dev build');
check('a compact Base English model is downloaded once',
  /ggml-base\.en-q5_1\.bin/.test(whisper) && /File\.createDownloadTask/.test(whisper), whisper);
check('the model download reports progress', /onProgress: \(\{ bytesWritten, totalBytes \}\)/.test(whisper));
check('the recognizer receives an English local-file job',
  /context\.transcribe\(fileUri/.test(whisper) && /language: 'en'/.test(whisper));
check('Whisper timestamps are converted from centiseconds to app seconds',
  /\.t0 \?\? 0\) \/ 100/.test(whisper) && /\.t1 \?\? 0\) \/ 100/.test(whisper));
// whisper.rn reports no word timings (its Android bridge sets
// dtw_token_timestamps = false), so resolution has to come from asking for
// short pieces and regrouping them into lines here.
check('short pieces are requested and regrouped into readable lines',
  /maxLen: 1/.test(whisper) && /function groupIntoLines/.test(whisper),
  'without this a whole line lights at once and the transcript lags the voice');
check('the model module has no audio upload call', !/fetch\(|createUploadTask|uploadAsync/.test(whisper));

console.log('\n== the shell no longer has a server escape hatch ==');
check('old remote helper is removed', !existsSync(join(here, '..', 'src', 'remote.js')));
check('App has no transcription endpoint, host discovery, or remote client',
  !/(TRANSCRIPTION_SERVER|transcribeRemotely|developmentTranscriptionServer|NativeModules\.SourceCode|probe\()/.test(app));
check('every saved capture queues the local Whisper pass',
  /await markTranscriptionPending\(id\);/.test(app) && /transcribeOnDevice\(file\.uri/.test(app));
check('capture is continuous pause-safe PCM WAV',
  /recorder\.startRecording\(\)/.test(app)
    && /const fileName = `\$\{id\}\.wav`;/.test(app)
    && /recorder\.pauseRecording\(\)/.test(app)
    && /recorder\.resumeRecording\(\)/.test(app));
// The recorder writes the container itself, which is the only reason pause can
// leave no gap: while paused the chunks are simply not appended.
const pcm = readFileSync(join(here, '..', 'src', 'pcmRecorder.js'), 'utf8');
check('the WAV it writes is what whisper.cpp reads',
  /SAMPLE_RATE = 16000/.test(pcm) && /CHANNELS = 1/.test(pcm) && /BITS_PER_SAMPLE = 16/.test(pcm),
  'whisper.cpp decodes nothing else - not AAC, not MP3');
check('pausing drops chunks rather than stopping the stream',
  /if \(!state\.recording \|\| state\.paused/.test(pcm),
  'stopping and restarting would split the lecture into two files');
check('the header is patched at the end, not held in memory',
  /handle\.offset = 4/.test(pcm) && /handle\.offset = 40/.test(pcm),
  'an hour of PCM is ~115MB and must never be buffered to compute its length');
check('the page bridge still uses native recording commands',
  /rec\.start/.test(bridge) && /rec\.pause/.test(bridge) && /rec\.resume/.test(bridge) && /rec\.stop/.test(bridge));
check('the transcript settings explain private on-device processing',
  /never sent to a server/.test(settingsView) && /60 MB/.test(settingsView)
    && !/Server address|transcription-server/.test(settingsView));

console.log('\n== pause is required before saving ==');
check('the shell tells the page that native pause exists', /transcription: false, pause: true/.test(app));
check('the page reads capabilities', /caps\.pause !== false/.test(captureView));
check('finish is unavailable until the take is paused',
  /async function finish\(\)[\s\S]{0,420}phase !== 'paused'/.test(captureView));
check('cancel remains a paused-only slide action',
  /rec-cancel-slot \$\{phase === 'paused' \? 'visible' : ''\}/.test(captureView)
    && /\{phase === 'paused' && <SlideToCancel/.test(captureView));
check('the cancel area is reserved before pause, preventing a layout jump',
  /\.rec-cancel-slot \{[\s\S]{0,180}height: 4\.4rem/.test(styles)
    && !/\.rec-cancel-slot\.visible \{[\s\S]{0,120}height: auto/.test(styles));
check('bookmarks capture typed labels without joining the recording layout flow',
  /function BookmarkComposer/.test(captureView)
    && /className="bookmark-composer"/.test(captureView)
    && /\.bookmark-composer,[\s\S]{0,160}position: absolute/.test(styles));

console.log('\n== native config contains no endpoint exception ==');
// Capture is a plain React Native module now, so there is no config plugin to
// look for - the dependency and the permission are what make it real.
const deps = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).dependencies;
check('the PCM capture module is a dependency',
  Boolean(deps['@fugood/react-native-audio-pcm-stream']), Object.keys(deps).join(', '));
check('no recorder that cannot produce PCM WAV crept back in',
  !deps['expo-audio-studio'] && !deps['expo-av'],
  'expo-audio records AAC on Android, which whisper.cpp will not read');
check('RECORD_AUDIO remains declared', appJson.expo.android.permissions.includes('android.permission.RECORD_AUDIO'));
check('Android retains Internet only for the one-time model download', appJson.expo.android.permissions.includes('android.permission.INTERNET'));
check('the HTTP cleartext workaround is removed',
  !JSON.stringify(appJson.expo.plugins).includes('expo-build-properties')
    && !JSON.stringify(appJson.expo).includes('usesCleartextTraffic'));
check('the old system speech recognizer plugin is removed',
  !JSON.stringify(appJson.expo.plugins).includes('expo-speech-recognition'));

console.log('\n== a transcript survives the local round trip ==');
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
await api.saveTranscript('lec1', '  mitosis produces two identical daughter cells  ', [
  { text: 'mitosis produces two identical daughter cells', start_seconds: 12.3, end_seconds: 15.8 },
]);

let res = await api.handleApi({
  method: 'POST', path: '/api/lectures',
  body: { audio: { __recording: 'lec1' }, title: 'Cell division', create_workspace: 'true' },
});
const workspaceId = res.body.workspace_id;
res = await api.handleApi({ method: 'GET', path: `/api/workspaces/${workspaceId}`, body: null });
const session = res.body.sessions[0];
check('the transcript is stored', session.transcript === 'mitosis produces two identical daughter cells', session.transcript);
check('status is ready after local inference', session.transcription_status === 'ready', session.transcription_status);
check('timed segments reach the panel', session.segments[0]?.start_seconds === 12.3, session.segments);

console.log('\n== retry queues only the private device path ==');
api.TRANSCRIPTION_ON_DEVICE.value = false;
res = await api.handleApi({ method: 'POST', path: '/api/lectures/lec1/retranscribe', body: {} });
check('a missing native build says so clearly', res.status === 503, res);
api.TRANSCRIPTION_ON_DEVICE.value = true;
res = await api.handleApi({ method: 'POST', path: '/api/lectures/lec1/retranscribe', body: {} });
check('a WAV queues local Whisper', res.status === 200 && res.body.via === 'device' && res.body.status === 'pending', res);
await api.claimRecording({ id: 'old1', title: 'Legacy', fileName: 'old1.m4a' });
disk.set('file:///doc/recordings/old1.m4a', 1000);
res = await api.handleApi({ method: 'POST', path: '/api/lectures/old1/retranscribe', body: {} });
check('legacy m4a captures explain their local limitation', res.status === 422 && /WAV/.test(res.body.detail), res);
res = await api.handleApi({ method: 'GET', path: '/api/settings', body: null });
check('settings report the on-device engine, not a server',
  res.body.transcription_delivery === 'on_device' && res.body.transcription_engine === 'Whisper Base English', res.body);

console.log('\n' + pass + '/' + total + ' passed');
process.exit(pass === total ? 0 : 1);
