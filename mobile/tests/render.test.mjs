/**
 * Renders the generated page in a DOM, with the bridge in front of it and the
 * real local API behind it.
 *
 * A white screen is the failure this catches. It has no stack and no console on
 * a phone, so the page is booted here instead: if React does not mount, or the
 * first /api call does not come back in a shape the client can use, this fails
 * on a laptop rather than in a lecture.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import initSqlJs from 'sql.js';

const here = dirname(fileURLToPath(import.meta.url));
const { WEB_APP_HTML } = await import(`file://${join(here, '..', 'src', 'webapp.generated.js').replace(/\\/g, '/')}`);
const { BRIDGE_JS } = await import(`file://${join(here, '..', 'src', 'bridge.js').replace(/\\/g, '/')}`);

let pass = 0, total = 0;
function check(label, ok, detail) {
  total++; if (ok) pass++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '   -> ' + String(detail).slice(0, 400)));
}

// --- the local API, behind the bridge, exactly as the shell wires it --------

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
  fakeSqlite,
  { File: FakeFile, Directory: FakeDirectory, Paths: { document: 'file:///doc' } },
  URLSearchParams,
);

// --- boot the page ---------------------------------------------------------

const pageErrors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (error) => pageErrors.push(error.message));

const dom = new JSDOM(WEB_APP_HTML, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'file:///doc/recordings/',
  virtualConsole,
  beforeParse(window) {
    // Stand in for the native side of the bridge.
    window.ReactNativeWebView = {
      postMessage: (raw) => {
        const message = JSON.parse(raw);
        if (message.channel === 'page.error') { pageErrors.push(message.payload.detail); return; }
        if (message.channel === 'api') {
          api.handleApi(message.payload)
            .then((result) => window.__cnSettle(message.id, true, result))
            .catch((error) => window.__cnSettle(message.id, false, { message: String(error) }));
          return;
        }
        window.__cnSettle(message.id, true, { ok: true, id: 'test-recording' });
      },
    };
    window.matchMedia = window.matchMedia || (() => ({
      matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    }));
    window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
    window.scrollTo = () => {};
    window.eval(BRIDGE_JS.replace(/^export const BRIDGE_JS = String\.raw`/, '').replace(/`;\s*$/, ''));
  },
});

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const document_ = dom.window.document;

// Wait for the library to actually arrive rather than sampling at a fixed
// moment. An earlier version of this test slept and then matched loose text,
// so it passed while the page was still on its loading screen - and shipped a
// render crash. Poll for the real page, and fail loudly if it never comes.
let waited = 0;
while (waited < 8000 && !document_.querySelector('.library-page') && !pageErrors.length) {
  await settle(100);
  waited += 100;
}
await settle(200);

const root = document_.getElementById('root');
const text = root ? root.textContent : '';
const onLoadingScreen = /Opening your lecture library/i.test(text);
const onErrorScreen = /Couldn.t open Class Notes/i.test(text);

console.log('== the page boots ==');
check('no script errors while loading', pageErrors.length === 0, pageErrors.join(' | '));
check('#root exists', Boolean(root));
check('React mounted something into it', root && root.childNodes.length > 0,
  'root is empty - this is the white screen');

console.log('\n== and gets past loading, to the real library ==');
check('not stuck on the loading screen', !onLoadingScreen, text.slice(0, 160));
check('not showing the error screen', !onErrorScreen, text.slice(0, 220));
check('the library page rendered', Boolean(document_.querySelector('.library-page')),
  `waited ${waited}ms; body: ${text.slice(0, 160)}`);
check('the classes section is present', /class/i.test(text), text.slice(0, 160));
check('the record button is present', Boolean(
  [...document_.querySelectorAll('button')].find((b) => /record/i.test(b.textContent))),
  [...document_.querySelectorAll('button')].map((b) => b.textContent).slice(0, 8).join(' | '));

console.log('\n== the bridge replaced the browser APIs ==');
check('fetch was taken over', dom.window.__CN_BRIDGE__ === true);
check('the page knows it is in the native shell', dom.window.__CN_NATIVE__ === true);
check('MediaRecorder is the shim', typeof dom.window.MediaRecorder === 'function');

console.log('\n== a real /api round trip happened through the bridge ==');
const rows = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
check('the local API created its schema', rows.length > 0 && rows[0].values.length >= 5,
  rows[0]?.values?.flat());

console.log('\n' + pass + '/' + total + ' passed');
if (pageErrors.length) {
  console.log('\npage errors:\n  ' + pageErrors.slice(0, 5).join('\n  '));
}
process.exit(pass === total ? 0 : 1);
