// Run with: node weekrooster-impact.test.js
// "Wie merkt dit" (weekrooster-impact.js): what a request would change for other families IF the day coordinator agrees.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { sampleFamilies, assertNoUnusedImports } from './test-support.js';
import { expectedImpact } from '../weekrooster-impact.js';

const families = sampleFamilies();
const run = (requests, extra = {}) => expectedImpact({
  day: 'Ma', direction: 'heen', cars: [{ girlIds: ['f1', 'f2'], driverFamilyId: 'f1' }], requests, families, settings: {}, prefs: { rules: [] }, priority: {}, ...extra,
});

console.log('=== expected impact ===');
test('the same time as the fixed rooster changes nothing', () => {
  assert.deepEqual(run([{ familyId: 'f2', rides: true, time: '08:30' }]), { carsBefore: 1, carsAfter: 1, changes: [], noSolution: false });
});
test('an earlier arrival of one girl moves the car of the other families', () => {
  const r = run([{ familyId: 'f1', rides: true, time: '07:00' }]);
  assert.equal(r.carsAfter, 1);
  assert.deepEqual(r.changes, [{ familyId: 'f2', from: '07:30', to: '06:00' }]);
});
test('a very different time needs an extra car', () => {
  const r = run([{ familyId: 'f2', rides: true, time: '12:00' }]);
  assert.equal(r.carsBefore, 1); assert.equal(r.carsAfter, 2); assert.equal(r.noSolution, false);
});
test('"rijdt niet mee" leaves the other car as it is', () => {
  const r = run([{ familyId: 'f2', rides: false, time: '' }]);
  assert.equal(r.carsAfter, 1); assert.deepEqual(r.changes, []);
});
test('the family that asks is never listed as "affected"', () => {
  const r = run([{ familyId: 'f2', rides: true, time: '06:30' }]);
  assert.ok(r.changes.every(c => c.familyId !== 'f2'));
});
test('nothing is changed in what was handed in (pure)', () => {
  const ctx = { day: 'Ma', direction: 'heen', cars: [{ girlIds: ['f1', 'f2'], driverFamilyId: 'f1' }], requests: [{ familyId: 'f2', rides: true, time: '12:00' }], families, settings: {}, prefs: { rules: [] }, priority: {} };
  const before = JSON.stringify(ctx); expectedImpact(ctx); assert.equal(JSON.stringify(ctx), before);
});
test('weekrooster-impact.js imports nothing it does not use', () => assertNoUnusedImports('weekrooster-impact.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
