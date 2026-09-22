/**
 * Guards on the injected bridge itself.
 *
 * The bridge is a string, not compiled code, so ordinary mistakes in it do not
 * surface until a phone renders white. These are the ones that have actually
 * happened or would be silent.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'bridge.js'), 'utf8');
const captureSource = readFileSync(
  join(here, '..', '..', 'frontend', 'src', 'components', 'RecordScreen.jsx'),
  'utf8',
);

let pass = 0, total = 0;
function check(label, ok, detail) {
  total++; if (ok) pass++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '   -> ' + String(detail).slice(0, 300)));
}

const open = source.indexOf('String.raw`');
const close = source.lastIndexOf('`;');
const body = source.slice(open + 'String.raw`'.length, close);

console.log('== the template survives being a template ==');
check('the script body was extracted', open > 0 && close > open && body.length > 500, body.length);
check('no stray backtick closes it early', !body.includes('`'),
  'a backtick inside the injected script ends the template and breaks the build');
check('no ${ } that would interpolate unexpectedly', !/\$\{/.test(body),
  'String.raw still interpolates ${...}');

console.log('\n== it runs before the document exists ==');
// This one shipped: documentElement is null in a pre-content script, and the
// throw aborted the rest of the bridge, so fetch was never replaced.
const guarded = /if \(document\.documentElement\)/.test(body)
  || /document\.documentElement\s*&&/.test(body);
check('documentElement is guarded, not assumed', guarded,
  'a pre-content script has no documentElement yet');

console.log('\n== it does not lean on APIs a WebView may not have ==');
check('does not call the Response constructor', !/new\s+Response\s*\(/.test(body),
  'not every WebView exposes Response');

console.log('\n== it takes over what the page needs ==');
for (const [label, pattern] of [
  ['fetch', /window\.fetch\s*=/],
  ['MediaRecorder', /window\.MediaRecorder\s*=/],
  ['getUserMedia', /getUserMedia\s*=/],
  ['the settle callback native replies through', /window\.__cnSettle\s*=/],
  ['the metering hook the waveform reads', /window\.__cnSetLevel\s*=/],
]) {
  check(`${label} is installed`, pattern.test(body), 'missing from the bridge');
}

console.log('\n== native recording handoff ==');
const doneStart = captureSource.indexOf('async function finish()');
const doneEnd = captureSource.indexOf('\n  function ', doneStart);
const doneBody = captureSource.slice(doneStart, doneEnd);
// Expo hands over its file token only once stop() has run, so the page must
// reach recorder.stop() without first requiring a chunk - and it must not then
// call an empty result a failure on the native side.
check('stopping is never gated on a chunk having arrived',
  !/if \(!recorder \|\| !chunksRef\.current\.length/.test(doneBody)
    && /phase !== 'paused'/.test(doneBody),
  'the page must call native stop before its file token exists');
check('an empty blob is only an error off the native path',
  /window\.__CN_NATIVE__ === true/.test(doneBody)
    && /!blob\.size && !nativeDeliversOnStop/.test(doneBody),
  'the native recorder legitimately produces no blob here');

const stopStart = body.indexOf('ShimRecorder.prototype.stop');
const stopEnd = body.indexOf('ShimRecorder.isTypeSupported', stopStart);
const stopBody = body.slice(stopStart, stopEnd);
check('the bridge emits its recording token before the stop event',
  stopBody.indexOf("__emit('dataavailable'") >= 0
    && stopBody.indexOf("__emit('dataavailable'") < stopBody.indexOf("__emit('stop'"),
  'the page builds its upload blob from dataavailable before it handles stop');
check('quick recording controls wait for the native start command',
  /this\.__operation = Promise\.resolve\(\)/.test(body)
    && /self\.__operation = self\.__operation\.then\(function \(\) \{ return call\('rec\.stop'/.test(body),
  'pause, resume, and stop must not overtake asynchronous native preparation');
check('cancellation takes its own native discard path',
  /ShimRecorder\.prototype\.discard/.test(body) && /call\('rec\.cancel'/.test(body),
  'sliding to cancel must not save an orphaned native recording');

console.log('\n== a native recorder can finish without an early chunk ==');
const dom = new JSDOM('<div id="root">ready</div>', {
  runScripts: 'outside-only',
  url: 'http://localhost/',
});
const { window } = dom;
const operations = [];
window.ReactNativeWebView = {
  postMessage(message) {
    const request = JSON.parse(message);
    if (!request.id) return;

    operations.push(request.channel);
    const result = request.channel === 'rec.start' || request.channel === 'rec.stop'
      ? { id: 'native-recording-1' }
      : { ok: true };
    // Delaying start makes Pause and Done race it as they can on a real phone.
    const delay = request.channel === 'rec.start' ? 20 : 0;
    setTimeout(() => window.__cnSettle(request.id, true, result), delay);
  },
};
window.eval(body);

const stream = await window.navigator.mediaDevices.getUserMedia({ audio: true });
const recorder = new window.MediaRecorder(stream);
let tokenBlob;
const stopped = new Promise((resolve, reject) => {
  recorder.addEventListener('dataavailable', (event) => { tokenBlob = event.data; });
  recorder.addEventListener('error', (event) => reject(event.error));
  recorder.addEventListener('stop', resolve);
});
recorder.start(1000);
recorder.pause();
recorder.stop();
await Promise.race([
  stopped,
  new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for native stop')), 500)),
]);

check('start, pause, and stop reach native in order',
  operations.join(',') === 'mic.permission,rec.start,rec.pause,rec.stop', operations);
check('stop produces the native-file token as its first audio data',
  tokenBlob?.size > 0 && tokenBlob.type === 'audio/mp4', tokenBlob?.size);
dom.window.close();

console.log('\n== failures get reported rather than swallowed ==');
check('window error is reported', /addEventListener\('error'/.test(body));
check('unhandled rejections are reported', /addEventListener\('unhandledrejection'/.test(body));
check('a mounted-but-empty root is reported', /childNodes\.length === 0/.test(body),
  'a blank page throws nothing; it has to be detected');

console.log('\n== it is ES5, because it runs untranspiled ==');
check('no arrow functions', !/=>/.test(body), 'arrow functions in an untranspiled injected script');
check('no let or const', !/(^|[;\s{])(let|const)\s/.test(body), 'use var in the injected script');

console.log('\n' + pass + '/' + total + ' passed');
// exitCode rather than exit(): sql.js tears its WASM heap down asynchronously,
// and exiting out from under it aborts the process even when every check passed.
process.exitCode = pass === total ? 0 : 1;
