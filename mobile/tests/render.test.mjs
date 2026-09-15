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
await settle(1500);

const root = dom.window.document.getElementById('root');

console.log('== the page boots ==');
check('no script errors while loading', pageErrors.length === 0, pageErrors.join(' | '));
check('#root exists', Boolean(root));
check('React mounted something into it', root && root.childNodes.length > 0,
  'root is empty - this is the white screen');

console.log('\n== the bridge replaced the browser APIs ==');
check('fetch was taken over', dom.window.__CN_BRIDGE__ === true);
check('the page knows it is in the native shell', dom.window.__CN_NATIVE__ === true);
check('MediaRecorder is the shim', typeof dom.window.MediaRecorder === 'function');

console.log('\n== the UI actually rendered ==');
const text = root ? root.textContent : '';
check('the library heading is on screen', /class|lecture/i.test(text), text.slice(0, 200));
check('it is not just an error page', !/something went wrong/i.test(text), text.slice(0, 200));

console.log('\n== a real /api round trip happened through the bridge ==');
const rows = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
check('the local API created its schema', rows.length > 0 && rows[0].values.length >= 5,
  rows[0]?.values?.flat());

console.log('\n' + pass + '/' + total + ' passed');
if (pageErrors.length) {
  console.log('\npage errors:\n  ' + pageErrors.slice(0, 5).join('\n  '));
}
process.exit(pass === total ? 0 : 1);
