/** The native meter -> WebView waveform contract. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const bridgeSource = readFileSync(join(here, '..', 'src', 'bridge.js'), 'utf8');
const appSource = readFileSync(join(here, '..', 'App.js'), 'utf8');
const waveSource = readFileSync(
  join(here, '..', '..', 'frontend', 'src', 'components', 'Waveform.jsx'), 'utf8',
);

let pass = 0, total = 0;
function check(label, ok, detail) {
  total++; if (ok) pass++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '   -> ' + String(detail).slice(0, 300)));
}

const open = bridgeSource.indexOf('String.raw`');
const body = bridgeSource.slice(open + 'String.raw`'.length, bridgeSource.lastIndexOf('`;'));

console.log('== native actually produces a level ==');
check('WAV recorder emits amplitude events', /recorder\.addListener\('onRecorderAmplitude'/.test(appSource));
check('metering frequency is configured', /setAmplitudeUpdateFrequency\(METERING_HERTZ\)/.test(appSource));
check('native dBFS levels are pushed into the page', /__cnSetLevel/.test(appSource));
check('one recorder owns capture and pause/resume',
  /recorder\.startRecording/.test(appSource)
    && /recorder\.pauseRecording/.test(appSource)
    && /recorder\.resumeRecording/.test(appSource));

console.log('\n== the page and the bridge agree on the gate constants ==');
const gateMatch = waveSource.match(/\(rms - ([\d.]+)\) \/ ([\d.]+)/);
check('the page gate was found', Boolean(gateMatch), waveSource.slice(0, 120));
const [, floorInPage, spanInPage] = gateMatch ?? [];
check(`bridge uses the page silence floor (${floorInPage})`,
  body.includes('SILENCE_FLOOR = ' + floorInPage), 'floor drifted from Waveform.jsx');
check(`bridge uses the page gate span (${spanInPage})`,
  body.includes('GATE_SPAN = ' + spanInPage), 'span drifted from Waveform.jsx');

console.log('\n== a pushed level comes back as the right bar height ==');
const dom = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.ReactNativeWebView = { postMessage() {} };
window.AnalyserNode = function AnalyserNode() {};
window.AnalyserNode.prototype.getFloatTimeDomainData = function () {
  throw new Error('real analyser should not be reached for a fake stream');
};
window.AudioContext = function AudioContext() {};
window.AudioContext.prototype.createAnalyser = function () {
  const node = new window.AnalyserNode(); node.fftSize = 1024; return node;
};
window.AudioContext.prototype.createMediaStreamSource = function () {
  throw new Error('real source should not be reached for a fake stream');
};
window.eval(body);

const context = new window.AudioContext();
const analyser = context.createAnalyser();
const stream = { __cnFake: true };
context.createMediaStreamSource(stream).connect(analyser);
const samples = new Float32Array(1024);
function heightFor(level) {
  window.__cnSetLevel(level);
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const value of samples) sum += value * value;
  const rms = Math.sqrt(sum / samples.length);
  const gated = Math.max(0, (rms - Number(floorInPage)) / Number(spanInPage));
  return Math.min(1, gated ** 0.55);
}
const heightAt = (level) => {
  let sum = 0;
  for (let i = 0; i < 40; i++) sum += heightFor(level);
  return sum / 40;
};
const silent = heightAt(0), quiet = heightAt(.25), speech = heightAt(.5), loud = heightAt(1);
check('silence draws flat', silent < .05, silent);
check('a quiet voice is visible but not full', quiet > .2 && quiet < .75, quiet);
check('a normal voice sits mid-scale', speech > .45 && speech < .95, speech);
check('the loudest level reaches the top', loud > .9, loud);
check('the response is monotonic', silent < quiet && quiet < speech && speech < loud,
  [silent, quiet, speech, loud]);
dom.window.close();

console.log('\n' + pass + '/' + total + ' passed');
// exitCode rather than exit(): sql.js tears its WASM heap down asynchronously,
// and exiting out from under it aborts the process even when every check passed.
process.exitCode = pass === total ? 0 : 1;
