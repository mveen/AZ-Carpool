// Run with: node smoke-test.test.js
// The automatic pipeline: every merge goes to the TEST site first, a robot smoke-tests it, and only a green robot lets
// the live upload run. Also: fixed smoke codes survive a re-seed of the test data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSmokeConfig, isHarmless, TEST_ORIGIN, TABS } from '../scripts/smoke-test.mjs';
import { encodeFields } from '../cron/lib/firestore-rest.mjs';
import { transformBackup, checkFixedCodes } from '../scripts/seed-test-data.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const y = readFileSync(join(repo, '.github/workflows/deploy.yml'), 'utf8');
const job = n => { const a = y.indexOf(`\n  ${n}:\n`); assert.ok(a >= 0, n); const rest = y.slice(a + 1); const m = rest.slice(1).search(/\n  [a-z-]+:\n/); return m < 0 ? rest : rest.slice(0, m + 1); };
const env = { SMOKE_PHONE: '0600000000', SMOKE_CODE_COORD: 'aaaaaaaaaa', SMOKE_CODE_PARENT: 'bbbbbbbbbb' };

console.log('=== the smoke test script ===');
await test('only ever runs against the test site', () => {
  assert.equal(readSmokeConfig(env).site, TEST_ORIGIN);
  assert.throws(() => readSmokeConfig({ ...env, SMOKE_SITE: 'https://azcarpool.nl' }), /only runs against/);
  assert.throws(() => readSmokeConfig({ ...env, SMOKE_SITE: 'https://test.azcarpool.nl.evil.com' }), /only runs against/);
});
await test('needs a phone and two different codes, and says which are missing', () => {
  assert.throws(() => readSmokeConfig({ ...env, SMOKE_CODE_PARENT: '' }), /SMOKE_CODE_PARENT/);
  assert.throws(() => readSmokeConfig({}), /SMOKE_PHONE, SMOKE_CODE_COORD, SMOKE_CODE_PARENT/);
  assert.throws(() => readSmokeConfig({ ...env, SMOKE_CODE_PARENT: 'aaaaaaaaaa' }), /different/);
});
await test('checks a coordinator (with Beheer) and a parent (without), and every main tab', () => {
  const c = readSmokeConfig(env);
  assert.deepEqual(c.roles.map(r => [r.name, r.beheer]), [['coordinator', true], ['parent', false]]);
  assert.deepEqual(TABS, ['myweek', 'schedule', 'deviation', 'matches']);
});
await test('browser noise is ignored, real errors are not', () => {
  assert.ok(isHarmless('Failed to load resource: net::ERR_BLOCKED_BY_CLIENT'));
  assert.ok(!isHarmless('Uncaught TypeError: x is not a function'));
  assert.ok(!isHarmless('FirebaseError: Missing or insufficient permissions'));
});

console.log('=== the pipeline ===');
await test('order: tests -> test site -> smoke -> live', () => {
  assert.match(job('deploy-test'), /needs: tests/);
  assert.match(job('smoke'), /needs: deploy-test/);
  assert.match(job('deploy-live'), /needs: \[deploy-test, smoke\]/);
});
await test('live is only reached when the smoke test is green, or was skipped on purpose by hand', () => {
  const j = job('deploy-live');
  assert.match(j, /needs\.smoke\.result == 'success'/);
  assert.match(j, /needs\.smoke\.result == 'skipped' && inputs\.skip_smoke/);
  assert.match(j, /needs\.deploy-test\.result == 'success'/);
  assert.match(job('smoke'), /if: \$\{\{ !inputs\.skip_smoke \}\}/);
  assert.match(y, /skip_smoke:[\s\S]*?default: false/);
});
await test('the test job uploads to the test folder only, the live job to the live folder only', () => {
  const t = job('deploy-test'), l = job('deploy-live');
  assert.match(t, /TARGET_DIR: domains\/test\.azcarpool\.nl\/public_html\//); assert.match(t, /build:deploy:test/);
  assert.ok(!/azcarpool-cron|domains\/azcarpool\.nl/.test(t));
  assert.match(l, /TARGET_DIR: domains\/azcarpool\.nl\/public_html\//); assert.match(l, /build:deploy\n/);
  assert.ok(!/test\.azcarpool\.nl/.test(l));
});
await test('the smoke job gets only the smoke secrets and never the deploy key', () => {
  const j = job('smoke');
  assert.deepEqual([...new Set([...j.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]))].sort(), ['SMOKE_CODE_COORD', 'SMOKE_CODE_PARENT', 'SMOKE_PHONE']);
  assert.match(j, /SMOKE_SITE: https:\/\/test\.azcarpool\.nl/);
});

console.log('=== fixed codes in the test data ===');
const row = (path, data) => ({ path, name: 'projects/az-carpool/databases/(default)/documents/' + path, fields: encodeFields(data) });
const rows = [
  row('invites/1111111111', { familyId: 'eline' }),
  row('invites/2222222222', { familyId: 'evi' }),
  row('invites/3333333333', { familyId: 'jan' }),
];
let n = 0; const makeCode = () => String(4000000000 + n++);
await test('a fixed code stays the same, the others get new random codes', () => {
  const r = transformBackup(rows, { makeCode, fixedCodes: { eline: 'smokecoord1' } });
  const by = Object.fromEntries(r.codes.map(c => [c.familyId, c.code]));
  assert.equal(by.eline, 'smokecoord1'); assert.ok(r.docs.some(k => k.path === 'invites/smokecoord1'));
  assert.ok(by.evi !== '2222222222' && by.jan !== '3333333333');
});
await test('refuses unknown families, short codes, live codes and duplicates', () => {
  const fam = ['eline', 'evi'];
  assert.throws(() => checkFixedCodes({ nobody: 'abcdefghij' }, fam), /no such family/);
  assert.throws(() => checkFixedCodes({ eline: 'short' }, fam), /8 to 32/);
  assert.throws(() => checkFixedCodes({ eline: '1111111111' }, fam, new Set(['1111111111'])), /live app/);
  assert.throws(() => checkFixedCodes({ eline: 'abcdefghij', evi: 'abcdefghij' }, fam), /same/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
