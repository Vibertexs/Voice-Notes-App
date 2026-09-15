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

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'bridge.js'), 'utf8');

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

console.log('\n== failures get reported rather than swallowed ==');
check('window error is reported', /addEventListener\('error'/.test(body));
check('unhandled rejections are reported', /addEventListener\('unhandledrejection'/.test(body));
check('a mounted-but-empty root is reported', /childNodes\.length === 0/.test(body),
  'a blank page throws nothing; it has to be detected');

console.log('\n== it is ES5, because it runs untranspiled ==');
check('no arrow functions', !/=>/.test(body), 'arrow functions in an untranspiled injected script');
check('no let or const', !/(^|[;\s{])(let|const)\s/.test(body), 'use var in the injected script');

console.log('\n' + pass + '/' + total + ' passed');
process.exit(pass === total ? 0 : 1);
