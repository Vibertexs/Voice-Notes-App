/**
 * The waveform level path, end to end.
 *
 * Native measures a dBFS level, pushes it into the page, and the page turns a
 * synthetic trace back into a bar height. Two bugs lived in that chain and
 * both looked identical on a phone - a flat meter - so it is measured here
 * rather than eyeballed.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const bridgeSource = readFileSync(join(here, '..', 'src', 'bridge.js'), 'utf8');
// The recorder options live in capture.js and the push loop in App.js, so the
// checks below read both rather than assuming one file holds everything.
const appSource = readFileSync(join(here, '..', 'App.js'), 'utf8')
  + readFileSync(join(here, '..', 'src', 'capture.js'), 'utf8');
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
// This was the first bug: the preset does not enable metering, so metering
// stayed undefined and nothing was ever pushed to the page.
check('metering is switched on explicitly', /isMeteringEnabled:\s*true/.test(appSource),
  'RecordingPresets.HIGH_QUALITY does not enable metering on its own');
check('recorder options are hoisted, not rebuilt each render',
  /^(?:export )?const RECORDING_OPTIONS/m.test(appSource),
  'a fresh options object every render rebuilds the recorder');
check('the level is pushed even when metering is missing',
  !/state\.metering === undefined\) return/.test(appSource),
  'returning early on undefined metering means silence never reaches the page');
check('the push happens on every metering change', /__cnSetLevel/.test(appSource));

console.log('\n== the page and the bridge agree on the gate constants ==');
// If Waveform's maths is ever retuned, the synthetic trace has to follow.
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

// Minimal Web Audio stand-ins: the bridge patches these prototypes.
window.AnalyserNode = function AnalyserNode() {};
window.AnalyserNode.prototype.getFloatTimeDomainData = function () {
  throw new Error('real analyser should not be reached for a fake stream');
};
window.AudioContext = function AudioContext() {};
window.AudioContext.prototype.createAnalyser = function () {
  const node = new window.AnalyserNode();
  node.fftSize = 1024;
  return node;
};
window.AudioContext.prototype.createMediaStreamSource = function () {
  throw new Error('real source should not be reached for a fake stream');
};
window.eval(body);

// Exactly what Waveform.jsx does.
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

// Averaged: the trace carries deliberate jitter so one frame is noisy.
const heightAt = (level) => {
  let sum = 0;
  for (let i = 0; i < 40; i++) sum += heightFor(level);
  return sum / 40;
};

const silent = heightAt(0);
const quiet = heightAt(0.25);
const speech = heightAt(0.5);
const loud = heightAt(1);

console.log(`   level 0.00 -> ${silent.toFixed(3)}`);
console.log(`   level 0.25 -> ${quiet.toFixed(3)}`);
console.log(`   level 0.50 -> ${speech.toFixed(3)}`);
console.log(`   level 1.00 -> ${loud.toFixed(3)}`);

check('silence draws flat', silent < 0.05, silent);
check('a quiet voice is visible but not full', quiet > 0.2 && quiet < 0.75, quiet);
check('a normal voice sits mid-scale', speech > 0.45 && speech < 0.95, speech);
check('the loudest level reaches the top', loud > 0.9, loud);

// This was the second bug: every level above a whisper produced the same
// maximum bar, which reads as a meter that does not respond at all.
check('quiet and loud are actually different heights', loud - quiet > 0.25,
  `quiet ${quiet.toFixed(3)} vs loud ${loud.toFixed(3)} - the meter is saturated`);
check('the response is monotonic', silent < quiet && quiet < speech && speech < loud,
  [silent, quiet, speech, loud]);

dom.window.close();

console.log('\n' + pass + '/' + total + ' passed');
process.exit(pass === total ? 0 : 1);
