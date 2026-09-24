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
  join(here, '..', '..', 'frontend', 'src', 'screens', 'RecordScreen.jsx'), 'utf8',
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
check('a quantised English model is downloaded once',
  /ggml-small\.en-q5_1\.bin/.test(whisper) && /File\.createDownloadTask/.test(whisper), whisper);
// The guard exists to catch a half-finished download. If it is ever left
// below the real file size, a truncated model reaches whisper.cpp and fails
// somewhere far less obvious than here.
check('the size guard matches the model it now downloads',
  /MIN_MODEL_BYTES = 150 \* 1024 \* 1024/.test(whisper),
  'small.en-q5_1 is ~181MB; a guard sized for base.en would pass a truncated file');
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

console.log('\n== the grouping runs, not just matches ==');
// The grouping is pure, so lift it out of the module and exercise it. Its
// dependencies are the two constants above it and nothing else.
const groupingEnd = whisper.indexOf('* Transcribe a PCM WAV');
const groupingSource = whisper.slice(
  whisper.indexOf('/** Roughly a comfortable line'),
  whisper.lastIndexOf('/**', groupingEnd),
);
const groupIntoLines = new Function(`${groupingSource}\nreturn groupIntoLines;`)();

// What whisper.cpp actually emits with maxLen: 1 and split_on_word off: one
// piece per token, word-initial tokens carrying a leading space and subword
// continuations carrying none.
const tokens = [
  { text: ' Mit', t0: 0, t1: 20 }, { text: 'osis', t0: 20, t1: 45 },
  { text: ' produces', t0: 45, t1: 90 }, { text: ' two', t0: 90, t1: 110 },
  { text: ' identical', t0: 110, t1: 170 },
  { text: ' daughter', t0: 170, t1: 215 }, { text: ' cells', t0: 215, t1: 260 },
  { text: '.', t0: 260, t1: 265 },
];
const [first] = groupIntoLines(tokens);
check('subword tokens are rejoined into words',
  first.text === 'Mitosis produces two identical daughter cells.', first.text);
check('punctuation stays tight against its word',
  first.words.map((w) => w.word).join('') === 'Mitosis produces two identical daughter cells.',
  first.words);
check('a rejoined word spans its first piece to its last',
  first.words[0].start === 0 && first.words[0].end === 0.45, first.words[0]);
check('the line ends when the sentence does',
  first.start_seconds === 0 && first.end_seconds === 2.65, first);

// A model that ignored maxLen returns whole sentences; claiming word timing
// there would light a full line at once.
const sentences = groupIntoLines([
  { text: ' The cell divides in two.', t0: 0, t1: 300 },
  { text: ' Each half carries the same genes.', t0: 300, t1: 640 },
]);
check('whole-sentence pieces claim no word timing',
  sentences.length === 2 && !sentences[0].words, sentences[0]);
check('empty input groups to nothing', groupIntoLines([]).length === 0);

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

// Two defects in the capture module, both fixed in a patch that a plain
// `npm install` would undo without the postinstall hook.
//
// The first is latent: one byte array is reused per read and all of it was
// encoded, so a short read would re-send the tail of the previous chunk.
// Measured on a Galaxy S23+ every read filled the buffer, so it never fired
// there - the recorded stutter came from the second defect, not this one.
//
// The second is what was heard. stop() only lowers a flag, so a thread could
// still be reading when the next take began and two recorders ran at once.
// Their chunks interleaved into one file, which measured as 5.5s of audio from
// 4.0s of recording, with a step across every chunk seam twice the size of the
// steps within a chunk - two streams spliced together, not one recorded twice.
const captureModule = join(
  here, '..', 'node_modules', '@fugood', 'react-native-audio-pcm-stream',
  'android', 'src', 'main', 'java', 'com', 'imxiqi', 'rnliveaudiostream',
  'RNLiveAudioStreamModule.java',
);
if (existsSync(captureModule)) {
  const capture = readFileSync(captureModule, 'utf8');
  check('the installed recorder encodes only the bytes it read',
    /encodeToString\(buffer, 0, bytesRead,/.test(capture)
      && !/encodeToString\(buffer, Base64/.test(capture),
    'encoding the whole buffer re-sends the previous chunk on a short read');
  // stop() only lowers a flag, so a thread can still be inside read() when the
  // next take begins. Sharing the recorder field let it read from, release, or
  // null a recorder that now belongs to that newer take.
  check('a take reads from its own recorder, not the shared field',
    /final AudioRecord active = recorder;/.test(capture)
      && /active\.read\(buffer, 0, buffer\.length\)/.test(capture)
      && /if \(recorder == active\)/.test(capture),
    'a finishing thread must not touch the recorder that replaced it');
  check('a finishing take stands down when the next one starts',
    /private volatile int session/.test(capture)
      && /while \(isRecording && session == mySession\)/.test(capture),
    'two threads on one stream write the same audio twice');
  check('the stop flag is visible across threads',
    /private volatile boolean isRecording/.test(capture),
    'a non-volatile flag can leave the recording thread running after stop');
}
check('the patch that fixes it is in the repo',
  existsSync(join(here, '..', 'patches', '@fugood+react-native-audio-pcm-stream+1.1.4.patch')));
check('an install reapplies it',
  JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).scripts.postinstall === 'patch-package',
  'without this the build silently ships the stutter again');
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
// Cancelling is still a sustained gesture rather than a button, but the
// redesign moved it into the finish sheet beside the save, so the two ways a
// take can end are read together. What must not come back is a plain
// destructive button.
check('cancel remains a slide, not a button',
  /<VFSlideToCancel/.test(captureView)
    && !/label="Cancel"/.test(captureView));
check('finish is offered but refused until the take is paused',
  /<VFButton label=\{COPY\.finishBtn\} disabled=\{phase === 'recording'\}/.test(captureView));
// The original layout jump this guarded against was the cancel slot appearing
// on pause. Slide-to-cancel now lives in the sheet, so the only control that
// changes with the phase is the Finish chip - and it is always in the layout,
// changing opacity rather than presence, for exactly the same reason.
check('nothing enters the layout on pause, preventing a jump',
  /className=\{`rec-finish\$\{phase === 'paused' \? '' : ' is-hidden'\}`\}/.test(captureView)
    && /\.rec-finish\.is-hidden \{[\s\S]{0,80}opacity: 0/.test(styles));

console.log('\n== the shell accepts what the recorder actually returns ==');
// This one shipped. pcmRecorder answers with the state it is now in, so a
// successful resume is 'recording'; App.js demanded 'resumed' and threw on
// every resume that had in fact worked. The bridge then kept the rejected
// promise as its operation chain, so the following stop was never sent, and
// finishing a take failed with a stale message about resuming.
function recorderReturns(name) {
  const start = pcm.indexOf(`export function ${name}(`);
  const body = pcm.slice(start, pcm.indexOf('\n}', start));
  return [...body.matchAll(/return '([^']+)'/g)].map((m) => m[1]);
}
for (const [fn, channel] of [['pauseRecording', 'rec.pause'], ['resumeRecording', 'rec.resume']]) {
  // 'idle' means it was not recording, which is a real failure. Every other
  // value the recorder can return is a success the shell has to accept.
  const wins = recorderReturns(fn).filter((value) => value !== 'idle');
  const from = app.indexOf(`channel === '${channel}'`);
  // Comments get stripped first. The explanation of this very bug quotes the
  // value it is about, which was enough to make the check pass against the
  // broken code it was written to catch.
  const guard = app.slice(from, app.indexOf('reply(', from))
    .replace(/^\s*\/\/.*$/gm, '');
  const refused = wins.filter((value) => !guard.includes(`'${value}'`));
  check(`${channel} accepts what ${fn} returns (${wins.join(', ')})`,
    wins.length > 0 && refused.length === 0,
    `the shell throws on: ${refused.join(', ')}`);
}
check('a failed pause or resume cannot poison the operation chain',
  !/self\.__operation\.catch\(function \(\) \{\}\);/.test(bridge),
  'the caught promise has to become __operation, or the next stop is never sent');


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
  .replace(/import \{ ON_DEVICE_MODEL \} from '\.\/onDeviceWhisper';/,
    "const ON_DEVICE_MODEL = { name: 'Whisper Small English' };")
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
  res.body.transcription_delivery === 'on_device' && res.body.transcription_engine === 'Whisper Small English', res.body);

console.log('\n' + pass + '/' + total + ' passed');
// exitCode rather than exit(): sql.js tears its WASM heap down asynchronously,
// and exiting out from under it aborts the process even when every check passed.
process.exitCode = pass === total ? 0 : 1;
