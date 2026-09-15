/**
 * Design consistency, as checks rather than opinions.
 *
 * This stylesheet grew by override: the same selector defined four or six
 * times, each layer cancelling the last, until buttons had no hover left and
 * twenty-eight different corner radii were in use. These are the properties
 * that made it feel assembled rather than designed, expressed so that drifting
 * back is a failing test instead of something noticed months later.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', '..', 'frontend', 'src', 'styles.css'), 'utf8');
const appSource = readFileSync(join(here, '..', '..', 'frontend', 'src', 'App.jsx'), 'utf8');
const library = readFileSync(
  join(here, '..', '..', 'frontend', 'src', 'components', 'LibraryView.jsx'), 'utf8');

let pass = 0, total = 0;
function check(label, ok, detail) {
  total++; if (ok) pass++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '   -> ' + String(detail).slice(0, 220)));
}

console.log('== the header that followed every screen is gone ==');
check('no topbar markup', !/className="topbar"/.test(appSource));
check('no topbar styles left behind', !/\.topbar/.test(css));
check('search survived the removal', /onSearch/.test(library), 'the action must live somewhere');
check('settings survived the removal', /onSettings/.test(library));

console.log('\n== corner radii snap to a scale ==');
const radii = [...css.matchAll(/border-radius:\s*([^;]+);/g)]
  .flatMap((m) => m[1].trim().split(/\s+/))
  .filter((value) => value.endsWith('rem'))
  .map((value) => parseFloat(value));
const allowedRadii = new Set([0.5, 0.75, 1, 1.25, 1.5, 2]);
const strayRadii = [...new Set(radii.filter((r) => !allowedRadii.has(r)))];
check(`every rem radius is on the scale (${new Set(radii).size} distinct)`,
  strayRadii.length === 0, strayRadii);

console.log('\n== motion snaps to a scale ==');
const durations = [...css.matchAll(/(?:transition|animation)[^;]*;/g)]
  .flatMap((m) => [...m[0].matchAll(/([\d.]+)s\b/g)].map((d) => parseFloat(d[1])));
const allowedTimes = new Set([0.15, 0.22, 0.4, 0.01]);
const strayTimes = [...new Set(durations.filter((d) => !allowedTimes.has(d)))];
check(`every duration is on the scale (${new Set(durations).size} distinct)`,
  strayTimes.length === 0, strayTimes);
check('reduced motion is honoured', /prefers-reduced-motion/.test(css));

console.log('\n== the button system is not cancelling itself ==');
// A later rule setting transform:none on hover is what flattened the whole
// product: the lift was designed once and then removed three times.
check('no rule cancels the hover lift',
  !/\.button:hover[^{]*\{[^}]*transform:\s*none/.test(css),
  'a later override removed the lift the base rule defines');
check('no rule cancels the hover shadow',
  !/\.button:hover[^{]*\{[^}]*box-shadow:\s*none/.test(css));
check('buttons still lift on hover', /\.button:hover:not\(:disabled\)[^}]*translateY/.test(css));
check('buttons answer a press', /\.button:active:not\(:disabled\)[^}]*scale/.test(css));
check('corners agree with the rest of the product, not pills',
  !/\.button\s*\{[^}]*border-radius:\s*999px/.test(css));

console.log('\n== text shortens instead of clipping ==');
// min-width defaults to auto on a flex child, so a long title widens its own
// row past the screen rather than wrapping. This is most "cut off" bugs.
for (const selector of ['.back-link', '.button', '.class-name', '.title-input']) {
  const guarded = new RegExp(`${selector.replace('.', '\\.')}[^{]*\\{[^}]*(min-width:\\s*0|text-overflow)`)
    .test(css) || new RegExp(`${selector.replace('.', '\\.')}[,\\s][^{]*\\{[^}]*min-width:\\s*0`).test(css);
  check(`${selector} can shrink`, guarded, 'it will push its row wider than the screen');
}
check('the page cannot scroll sideways', /overflow-x:\s*hidden/.test(css));

console.log('\n== nothing needs a mouse ==');
// draggable and dataTransfer are mouse-only APIs. A screen whose only path to
// an action is a drag has no path at all on a phone.
check('every draggable thing also has a tap path',
  !/draggable/.test(library) || /setFiling/.test(library),
  'filing a lecture was drag-only, which does nothing on touch');
check('the instructions do not describe a gesture the device cannot perform',
  !/Drag a lecture onto a class/.test(library),
  'the copy told phone users to drag');

console.log('\n== it is usable with a thumb ==');
check('touch targets are raised on coarse pointers', /@media \(pointer: coarse\)/.test(css));
check('focus is visible and consistent', /:focus-visible[^}]*outline:\s*2px solid var\(--brand\)/.test(css));

console.log('\n== the stylesheet still parses ==');
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
const style = dom.window.document.createElement('style');
style.textContent = css;
dom.window.document.head.appendChild(style);
const sheet = style.sheet;
check('the browser accepts it', Boolean(sheet), 'cssom refused the stylesheet');
check('it has rules, so nothing swallowed the file',
  sheet && sheet.cssRules.length > 200, sheet?.cssRules?.length);
check('braces balance', css.split('{').length === css.split('}').length,
  `${css.split('{').length - 1} open vs ${css.split('}').length - 1} close`);
dom.window.close();

console.log('\n' + pass + '/' + total + ' passed');
process.exitCode = pass === total ? 0 : 1;
