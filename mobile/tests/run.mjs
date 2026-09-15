/**
 * Runs every suite and reports one verdict.
 *
 * Exit codes are not trusted here. sql.js aborts during its own teardown on
 * Windows, after a suite has already printed its results, so a passing suite
 * could exit 127 - which silently stopped an && chain and made the remaining
 * suites look like they had run. The verdict comes from each suite's printed
 * "N/N passed" line instead, which is written before any teardown happens.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  'bridge.test.mjs',
  'waveform.test.mjs',
  'transcription.test.mjs',
  'local_api.test.mjs',
  'render.test.mjs',
];

let failed = 0;
const summary = [];

for (const suite of SUITES) {
  const result = spawnSync(process.execPath, [join(here, suite)], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const verdict = [...output.matchAll(/^(\d+)\/(\d+) passed$/gm)].pop();

  if (!verdict) {
    failed++;
    summary.push(`  FAILED   ${suite}  (no result line - the suite did not finish)`);
    process.stdout.write(output);
    continue;
  }

  const [, passed, total] = verdict;
  const ok = passed === total;
  if (!ok) {
    failed++;
    // Only a failing suite is worth the full transcript.
    process.stdout.write(output);
  }
  summary.push(`  ${ok ? 'ok      ' : 'FAILED  '} ${suite.padEnd(26)} ${passed}/${total}`);
}

console.log('\n' + summary.join('\n'));
console.log(failed === 0 ? '\nall suites passed\n' : `\n${failed} suite(s) failed\n`);
process.exit(failed === 0 ? 0 : 1);
