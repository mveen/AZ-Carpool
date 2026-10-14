// Run with: node push-access.test.js
// push-access.js: who sees the notification test features. During the test phase only the coordinator; the restriction is ONE flag in ONE file.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { COORDINATOR_ONLY, pushVisibleFor } from '../push-access.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const coordinator = { coordinatorConfig: { uid: 'u-coord' }, me: 'u-coord', links: {} };
const parent = { coordinatorConfig: { uid: 'u-coord' }, me: 'u-parent', links: { 'u-parent': { familyId: 'f1' } } };

console.log('=== while the restriction is on ===');
await test('the flag is on', () => { assert.equal(COORDINATOR_ONLY, true); });
await test('the coordinator sees it, also when testing as a parent (Testweergave) or when looking at the app as a parent', () => {
  assert.equal(pushVisibleFor(coordinator), true);
  assert.equal(pushVisibleFor({ ...coordinator, impersonateFamilyId: 'f2' }), true);
  assert.equal(pushVisibleFor({ ...coordinator, viewAsParent: true }), true);
});
await test('a coordinator family (coordinator through a linked family) sees it too', () => {
  assert.equal(pushVisibleFor({ coordinatorConfig: { familyId: 'f1' }, me: 'u-parent', links: { 'u-parent': { familyId: 'f1' } } }), true);
});
await test('a parent, a browser without a family, nobody known and a broken state do not see it', () => {
  assert.equal(pushVisibleFor(parent), false);
  assert.equal(pushVisibleFor({ ...parent, impersonateFamilyId: 'f2' }), false);
  assert.equal(pushVisibleFor({ coordinatorConfig: { uid: 'u-coord' }, me: 'u-x', links: {} }), false);
  assert.equal(pushVisibleFor({ coordinatorConfig: null, me: 'u-coord', links: {} }), false);
  assert.equal(pushVisibleFor({ coordinatorConfig: { uid: 'u-coord' }, me: null, links: {} }), false);
});

console.log('\n=== taking the restriction off ===');
await test('with the flag off every member (a linked family or the coordinator) sees it; someone outside still does not', async () => {
  // The module is copied with the flag turned off and its imports made absolute, so this tests the real code path of "after the test phase".
  const src = readFileSync(join(root, 'push-access.js'), 'utf8').replace('COORDINATOR_ONLY = true', 'COORDINATOR_ONLY = false')
    .replace("'./state.js'", `'${pathToFileURL(join(root, 'state.js')).href}'`).replace("'./coordinator.js'", `'${pathToFileURL(join(root, 'coordinator.js')).href}'`);
  const file = join(mkdtempSync(join(tmpdir(), 'az-access-')), 'push-access-open.mjs');
  writeFileSync(file, src);
  const open = await import(pathToFileURL(file).href);
  assert.equal(open.COORDINATOR_ONLY, false);
  assert.equal(open.pushVisibleFor(parent), true); assert.equal(open.pushVisibleFor(coordinator), true);
  assert.equal(open.pushVisibleFor({ coordinatorConfig: { uid: 'u-coord' }, me: 'u-x', links: {} }), false);
});
await test('the restriction lives in this one file: no other module knows the flag, and the push screens and functions all ask pushVisible', () => {
  const files = readdirSync(root).filter(f => /\.(js|mjs)$/.test(f) && f !== 'push-access.js');
  assert.deepEqual(files.filter(f => /COORDINATOR_ONLY/.test(readFileSync(join(root, f), 'utf8'))), []);
  assert.match(readFileSync(join(root, 'ui-push.js'), 'utf8').match(/export function pushCardHtml[\s\S]*?\n}/)[0], /pushVisible\(\)/);
  assert.match(readFileSync(join(root, 'ui-push.js'), 'utf8').match(/export function refreshPushCard[\s\S]*?\n}/)[0], /pushVisible\(\)/);
  assert.match(readFileSync(join(root, 'ui-push.js'), 'utf8').match(/export function applyPendingPushOpen[\s\S]*?\n}/)[0], /pushVisible\(\)/);
  assert.match(readFileSync(join(root, 'push-data.js'), 'utf8'), /const allowed = \(\) => !!db && pushVisible\(\) && isRealCoordinator\(\);/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
