// Run with: node escape.test.js
// escape.js: HTML escaping, standalone. ui-common.js re-exports it; rides.js uses it directly (so the server job stays small).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { esc } from '../escape.js';
import { esc as escFromUiCommon } from '../ui-common.js';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
test('escapes the five HTML characters', () => assert.equal(esc('<a href="x">Tom & \'Jerry\'</a>'), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;'));
test('null and undefined become an empty string, numbers are kept', () => { assert.equal(esc(null), ''); assert.equal(esc(undefined), ''); assert.equal(esc(0), '0'); });
test('ui-common.js hands out the very same function', () => assert.equal(escFromUiCommon, esc));
test('escape.js has no imports, and rides.js does not import the screen code', () => {
  assert.doesNotMatch(readFileSync(new URL('../escape.js', import.meta.url), 'utf8'), /^\s*import\b/m);
  assert.doesNotMatch(readFileSync(new URL('../rides.js', import.meta.url), 'utf8'), /from '\.\/ui-/);
});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
