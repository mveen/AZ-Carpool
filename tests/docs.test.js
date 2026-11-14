// Run with: node docs.test.js
// The README is the map (what lives where, how to test and deploy); the notes per feature live in docs/functies/. This keeps the
// README from growing back into a logbook, and keeps "see README, <section>" in code comments findable.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const readme = readFileSync(join(repo, 'README.md'), 'utf8');
const MAX_README_BYTES = 40000;   // may only be lowered; a new feature gets its own file in docs/functies/

test('the README stays a map: under ' + MAX_README_BYTES + ' bytes', () => { assert.ok(Buffer.byteLength(readme) < MAX_README_BYTES, 'README.md is ' + Buffer.byteLength(readme) + ' bytes: put feature notes in docs/functies/'); });
test('every feature file named in the README exists, and every file in docs/functies/ is named in the README', () => {
  const linked = [...readme.matchAll(/\]\((docs\/functies\/[\w-]+\.md)\)/g)].map(m => m[1]);
  assert.ok(linked.length >= 11);
  for (const f of linked) assert.ok(existsSync(join(repo, f)), f);
  for (const f of readdirSync(join(repo, 'docs/functies'))) assert.ok(linked.includes('docs/functies/' + f), f + ' is not in the README table');
});
test('sections that code comments point to ("see README, ...") can be found through the README', () => {
  for (const name of ['Planningslogica', 'Push-meldingen (test en live)', 'Ruilen', 'Test environment']) assert.ok(readme.includes(name), name);
});
test('the README still explains testing, deploying, the test environment and rollback itself', () => {
  for (const h of ['## Run the tests', '## Deploy', '### Test environment', '### Cron jobs on the host', '## Rollback', '## Files']) assert.ok(readme.includes(h), h);
});
test('a change to docs/ alone needs no new app version (CACHE_NAME check skips docs/)', () => {
  assert.match(readFileSync(join(repo, '.github/scripts/check-cache-bump.sh'), 'utf8'), /grep -vE '\^\([^']*\|docs\/\|/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
