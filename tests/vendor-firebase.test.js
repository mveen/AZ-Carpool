// Run with: node vendor-firebase.test.js
// The Firebase SDK is part of the app's own files (firebase-sdk/, made by scripts/vendor-firebase.mjs): complete, the version the
// script names, importing only from its own folder, and offering everything index.html and data.js ask of it.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIREBASE_VERSION, FIREBASE_FILES, VENDOR_DIR, localise } from '../scripts/vendor-firebase.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const read = f => readFileSync(join(repo, VENDOR_DIR, f), 'utf8');
// The names a bundled file exports: export{a as b,c} at its end.
const exportsOf = f => { const m = read(f).match(/export\s*\{([^}]*)\}\s*;?\s*$/); assert.ok(m, f + ' ends with its export list'); return new Set(m[1].split(',').map(x => x.trim().split(/\s+as\s+/).pop())); };

console.log('=== the files ===');
test('the three files and their note are there', () => { for (const f of [...FIREBASE_FILES, 'README.md']) assert.ok(existsSync(join(repo, VENDOR_DIR, f)), f); });
test('they are the version the script names, and the note says so', () => {
  assert.match(FIREBASE_VERSION, /^\d+\.\d+\.\d+$/);
  assert.ok(read('firebase-app.js').includes(`"${FIREBASE_VERSION}"`)); assert.ok(read('README.md').includes(`firebase@${FIREBASE_VERSION}`));
});
test('no file imports from another server: only from its own folder', () => {
  for (const f of FIREBASE_FILES) {
    const src = read(f);
    assert.doesNotMatch(src, /\b(from|import)\s*\(?\s*["']https?:\/\//, f);
    if (f !== 'firebase-app.js') assert.match(src, /from\s*["']\.\/firebase-app\.js["']/, f);
    assert.doesNotMatch(src, /sourceMappingURL/, f);
  }
});
test('the service worker keeps them for offline use and index.html loads exactly these', () => {
  const sw = readFileSync(join(repo, 'service-worker.js'), 'utf8'), html = readFileSync(join(repo, 'index.html'), 'utf8');
  for (const f of FIREBASE_FILES) { assert.ok(sw.includes(`'./${VENDOR_DIR}/${f}'`), 'ASSETS: ' + f); assert.ok(html.includes(`/${VENDOR_DIR}/${f}"`), 'index.html: ' + f); }
  assert.ok(!html.includes('gstatic') && !sw.includes('gstatic'));
});

console.log('=== what the app asks of them ===');
test('firestore offers every function data.js and index.html use', () => {
  const have = exportsOf('firebase-firestore.js');
  const data = readFileSync(join(repo, 'data.js'), 'utf8');
  const used = (data.match(/const \{([^}]+)\} = sdk;/) || [])[1].split(',').map(s => s.trim()).filter(n => !['signInAnonymously', 'signOut'].includes(n));
  assert.ok(used.length >= 10);
  for (const n of [...used, 'initializeFirestore', 'getFirestore', 'persistentLocalCache', 'persistentMultipleTabManager']) assert.ok(have.has(n), n);
});
test('auth and app offer what index.html imports', () => {
  const auth = exportsOf('firebase-auth.js');
  for (const n of ['initializeAuth', 'getAuth', 'indexedDBLocalPersistence', 'browserLocalPersistence', 'browserSessionPersistence', 'signInAnonymously', 'signOut']) assert.ok(auth.has(n), n);
  assert.ok(exportsOf('firebase-app.js').has('initializeApp'));
});
test('sign-in is set up without the "log in with Google" window helper, with the same three places to remember the login as before', () => {
  const html = readFileSync(join(repo, 'index.html'), 'utf8');
  assert.match(html, /initializeAuth\(app, \{ persistence: \[indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence\] \}\)/);
  assert.doesNotMatch(html, /popupRedirectResolver/);
});

console.log('=== the one change to the originals ===');
test('imports from gstatic become imports from the folder; nothing else changes; a leftover import from another server is refused', () => {
  const src = 'import{a as b}from"https://www.gstatic.com/firebasejs/1.2.3/firebase-app.js";const n="https://www.gstatic.com/firebasejs/1.2.3/firebase-app.js";export{b};\n//# sourceMappingURL=x.js.map\n';
  assert.equal(localise(src, '1.2.3'), 'import{a as b}from"./firebase-app.js";const n="https://www.gstatic.com/firebasejs/1.2.3/firebase-app.js";export{b};\n');
  assert.throws(() => localise('import{a}from"https://www.gstatic.com/firebasejs/9.9.9/firebase-app.js";', '1.2.3'), /another server/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
