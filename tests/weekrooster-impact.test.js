// Run with: node weekrooster-impact.test.js
// "Wie merkt dit" (weekrooster-impact.js): what a request would change for other families IF the day coordinator agrees.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { sampleFamilies, assertNoUnusedImports } from './test-support.js';
import { expectedImpact, buildAdvice } from '../weekrooster-impact.js';

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
console.log('=== the advice (phase 4) ===');
const advise = (requests, cars, extra = {}) => buildAdvice({ day: 'Ma', direction: 'heen', cars, requests, timeOf: id => families[id].schedule.Ma.heen, families, settings: {}, prefs: { rules: [] }, priority: {}, ...extra });
const one = [{ driverFamilyId: 'f1', girlIds: ['f1', 'f2'], departureTime: '07:30' }];
const two = [{ driverFamilyId: 'f1', girlIds: ['f1'], departureTime: '07:30' }, { driverFamilyId: 'f2', girlIds: ['f2'], departureTime: '07:30' }];
test('two cars become one when the times allow it (Zuinigst); Minste gedoe keeps both cars and moves only the time', () => {
  const a = advise([{ familyId: 'f2', rides: true, time: '08:45' }], two);
  assert.equal(a.carsBefore, 2);
  assert.equal(a.variants.zuinig.carsAfter, 1); assert.deepEqual(a.variants.zuinig.cars[0].girlIds.sort(), ['f1', 'f2']);
  assert.deepEqual(a.variants.zuinig.reasons.map(r => r.key), ['saves', 'free']); assert.equal(a.variants.zuinig.reasons[0].params.n, 1);
  assert.equal(a.variants.gedoe.carsAfter, 2); assert.deepEqual(a.variants.gedoe.familiesChanged, []);
  assert.equal(a.variants.gedoe.cars.find(c => c.driverFamilyId === 'f2').departureTime, '07:45');
  assert.ok(a.variants.gedoe.reasons.some(r => r.key === 'keep'));
  assert.deepEqual(a.variants.zuinig.times, { f2: '08:45' });
});
test('a time far from the rest needs an extra car, in both variants, and the reason says so', () => {
  const a = advise([{ familyId: 'f2', rides: true, time: '12:00' }], one);
  ['zuinig', 'gedoe'].forEach(v => { assert.equal(a.variants[v].carsAfter, 2); assert.equal(a.variants[v].noSolution, false); assert.ok(a.variants[v].reasons.some(r => r.key === 'extra')); });
  assert.deepEqual(a.variants.zuinig.familiesChanged, ['f1'], 'the family that stays notices that a passenger leaves');
});
test('"not this way" ("" as time) takes the girl out of the cars and is stored as an empty time', () => {
  const a = advise([{ familyId: 'f2', rides: true, time: '' }], one);
  ['zuinig', 'gedoe'].forEach(v => { assert.deepEqual(a.variants[v].cars.map(c => c.girlIds), [['f1']]); assert.deepEqual(a.variants[v].times, { f2: '' }); assert.deepEqual(a.variants[v].reasons[0], { key: 'out', params: { ids: ['f2'] } }); });
});
test('a car that grew from an existing one keeps what it had (pickup place etc.); a new car starts clean', () => {
  const cars = [{ driverFamilyId: 'f1', girlIds: ['f1', 'f2'], departureTime: '07:30', locationId: 'x', reserveFamilyIds: ['f3'] }];
  const a = advise([{ familyId: 'f2', rides: true, time: '12:00' }], cars);
  const kept = a.variants.gedoe.cars.find(c => c.driverFamilyId === 'f1'), fresh = a.variants.gedoe.cars.find(c => c.driverFamilyId === 'f2');
  assert.equal(kept.locationId, 'x'); assert.deepEqual(kept.reserveFamilyIds, ['f3']); assert.equal(fresh.locationId, undefined); assert.deepEqual(fresh.reserveFamilyIds, []);
});
test('no complete planning: it says so, and nobody is silently left out of the cars of the advice', () => {
  const tiny = { ...families, f1: { ...families.f1, capacity: 2 }, f2: { ...families.f2, capacity: 1 } };
  const a = advise([{ familyId: 'f2', rides: true, time: '08:30' }, { familyId: 'f3', rides: true, time: '08:30' }], [{ driverFamilyId: 'f1', girlIds: ['f1'] }], { families: { f1: tiny.f1, f2: tiny.f2, f3: { ...families.f3, capacity: 1 } }, timeOf: () => '08:30' });
  assert.equal(a.variants.gedoe.noSolution, true); assert.ok(a.variants.gedoe.reasons.some(r => r.key === 'noSolution'));
});
test('nothing is changed in what was handed in (pure)', () => {
  const ctx = { day: 'Ma', direction: 'heen', cars: two, requests: [{ familyId: 'f2', rides: true, time: '08:45' }], timeOf: id => families[id].schedule.Ma.heen, families, settings: {}, prefs: { rules: [] }, priority: {} };
  const before = JSON.stringify(ctx); buildAdvice(ctx); assert.equal(JSON.stringify(ctx), before);
});
test('weekrooster-impact.js imports nothing it does not use', () => assertNoUnusedImports('weekrooster-impact.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
