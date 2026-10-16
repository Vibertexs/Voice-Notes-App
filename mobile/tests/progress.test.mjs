/**
 * The progress bar between Whisper's reports.
 *
 * whisper.cpp reports once per 30 seconds of audio, so an honest bar sits still
 * for a long time. These check that the smoother keeps it moving without ever
 * lying about being finished or going backwards.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checker } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'progressSmoother.js'), 'utf8');
const { createProgressSmoother } = new Function(`${source.replace(/export function/g, 'function')}\nreturn { createProgressSmoother };`)();

const { check, done } = checker();

/** A smoother on a fake clock, so a minute of work takes no time. */
function rig(audioSeconds, options = {}) {
  let clock = 1_000_000;
  const seen = [];
  const smoother = createProgressSmoother({
    audioSeconds, onChange: (value) => seen.push(value), now: () => clock,
    schedule: () => 1, cancel: () => {}, ...options,
  });
  return {
    smoother, seen,
    wait: (seconds) => { clock += seconds * 1000; smoother.tick(); },
    last: () => seen[seen.length - 1],
  };
}

console.log('== a short clip: one window, one report ==');
{
  const r = rig(20);
  check('it knows a 20 second clip is one window', r.smoother.windows === 1);
  r.smoother.report(0.24);
  check('model ready reads 24%', Math.abs(r.last() - 0.24) < 1e-9, r.seen);
  r.wait(4);
  check('four seconds in, the bar has moved past 24%', r.last() > 0.3, r.seen);
  r.wait(60);
  check('however long it takes, it never claims to be done', r.last() < 1, r.last());
  r.smoother.report(1);
  check('Whisper finishing reads exactly 100%', r.last() === 1);
}

console.log('\n== a lecture: many windows ==');
{
  const r = rig(600);
  check('ten minutes is twenty windows', r.smoother.windows === 20);
  r.smoother.report(0.24);
  r.wait(8);
  const early = r.last();
  r.smoother.report(0.24 + 0.76 / 20);
  check('a real report moves the bar to at least its checkpoint', r.last() >= 0.24 + 0.76 / 20 - 1e-9, r.last());
  r.wait(8);
  const later = r.last();
  check('it keeps creeping toward the next checkpoint', later > 0.24 + 0.76 / 20, later);
  check('...but stays short of it', later < 0.24 + (2 * 0.76) / 20, later);
  check('and it moved forward from the first stretch', later > early);
}

console.log('\n== it only ever moves forward ==');
{
  const r = rig(300);
  r.smoother.report(0.24);
  for (let i = 0; i < 5; i++) r.wait(3);
  const high = r.last();
  r.smoother.report(0.24);                       // a late or repeated report
  check('a stale report does not pull the bar back', r.last() >= high, [high, r.last()]);
  check('every value announced was larger than the one before',
    r.seen.every((value, i) => i === 0 || value > r.seen[i - 1]), r.seen);
}

console.log('\n== it learns how fast this phone is ==');
{
  const slow = rig(300);                           // ten windows
  slow.smoother.report(0.24);
  slow.wait(40);                                    // the first window took 40s, not the assumed 10s
  slow.smoother.report(0.24 + 0.76 / 10);
  const after = slow.last();
  slow.wait(10);
  const creep = slow.last() - after;

  const fast = rig(300);
  fast.smoother.report(0.24);
  fast.wait(2);
  fast.smoother.report(0.24 + 0.76 / 10);
  const fastAfter = fast.last();
  fast.wait(10);
  const fastCreep = fast.last() - fastAfter;
  check('on a slower phone it creeps more slowly', creep < fastCreep, { creep, fastCreep });
}

console.log('\n== the model download is left alone ==');
{
  const r = rig(300);
  r.smoother.report(0.1);
  r.wait(30);
  check('before the model is ready nothing is invented', r.last() === 0.1 && r.seen.length === 1, r.seen);
}

console.log('\n== stopping ==');
{
  let cancelled = 0;
  const r = rig(300, { schedule: () => 7, cancel: () => { cancelled++; } });
  r.smoother.begin();
  r.smoother.report(1);
  check('finishing cancels the timer', cancelled === 1);
  r.wait(10);
  check('and nothing is announced after it', r.last() === 1);
}

done();
