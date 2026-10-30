// Run with: node weekrooster-impact.test.js
// "Wie merkt dit" (weekrooster-impact.js): what a request would change for other families IF the day coordinator agrees.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { sampleFamilies, assertNoUnusedImports } from './test-support.js';
import { expectedImpact, buildAdvice, buildKeepAdvice, evaluateCars } from '../weekrooster-impact.js';

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
console.log('=== the advice with the cars as they are (buildKeepAdvice) ===');
const fam = (time, cap = 4) => ({ capacity: cap, schedule: { Ma: { heen: time, terug: time } }, availability: { Ma: { heen: true, terug: true } } });
const kf = { saar: fam('17:00'), noor: fam('17:00'), lotte: fam('17:00'), eva: fam('17:00'), fenna: fam('17:00'), julia: fam('17:00'), sara: fam('17:00'), roos: fam('17:00') };
const kcars = [
  { driverFamilyId: 'saar', girlIds: ['eva', 'noor'], departureTime: '16:00' },
  { driverFamilyId: 'lotte', girlIds: ['lotte', 'fenna'], departureTime: '16:00' },
  { driverFamilyId: 'julia', girlIds: ['julia', 'sara'], departureTime: '16:00' },
  { driverFamilyId: 'roos', girlIds: ['roos'], departureTime: '16:00' },
];
const keep = (requests, extra = {}) => buildKeepAdvice({ day: 'Ma', direction: 'heen', cars: kcars, requests, timeOf: id => kf[id].schedule.Ma.heen, families: kf, settings: {}, prefs: { rules: [] }, priority: {}, ...extra });
const ask = [{ familyId: 'eva', rides: true, time: '17:30' }, { familyId: 'lotte', rides: true, time: '17:30' }];
test('keep: the best plan has the least waiting, uses only the cars that drive now, and nobody gets a new chauffeur', () => {
  const a = keep(ask);
  assert.equal(a.fallback, null);
  assert.equal(a.best.waitMinutes, 0);
  assert.equal(a.best.extraWait, 0);
  assert.deepEqual(a.best.cars.map(c => c.driverFamilyId).sort(), ['julia', 'lotte', 'roos', 'saar'], 'the same four drivers');
  const together = a.best.cars.find(c => c.girlIds.includes('eva'));
  assert.ok(together.girlIds.includes('lotte'), 'Eva and Lotte ride together, so both arrive at 17:30 without waiting');
  assert.equal(together.departureTime, '16:30', 'heen: 17:30 minus the 60 minutes of driving');
  assert.ok(a.best.familiesChanged.length <= 3 && !a.best.familiesChanged.includes('julia') && !a.best.familiesChanged.includes('roos'), 'the drivers who are not involved do not notice');
  assert.deepEqual(a.best.times, { eva: '17:30', lotte: '17:30' });
});
test('keep: the alternative has MORE waiting than the best plan (it is the second best, not a copy with two girls swapped)', () => {
  const a = keep(ask);
  assert.ok(a.alt, 'there is an alternative'); assert.ok(a.alt.waitMinutes > a.best.waitMinutes);
  assert.deepEqual(a.alt.cars.map(c => c.driverFamilyId).sort(), ['julia', 'lotte', 'roos', 'saar']);
});
test('keep: a girl whose time moved is not counted as moving; only girls that change car are', () => {
  const a = keep(ask);
  assert.ok(a.best.moved.length >= 1 && a.best.moved.length <= 2);
  assert.ok(!a.best.moved.includes('roos') && !a.best.moved.includes('julia') && !a.best.moved.includes('sara'));
  const none = keep([{ familyId: 'noor', rides: true, time: '17:00' }]);
  assert.deepEqual(none.best.moved, [], 'a request that changes nothing moves nobody');
});
test('keep: seats and the time spread are hard: a full car does not take a girl, a car does not span more than 3 hours', () => {
  const small = { ...kf, lotte: fam('17:00', 3) };   // 2 seats: Lotte and Fenna fill it
  const a = keep([{ familyId: 'eva', rides: true, time: '17:30' }], { families: small });
  const lotte = a.best.cars.find(c => c.driverFamilyId === 'lotte');
  assert.ok(lotte.girlIds.length <= 2);
  const far = keep([{ familyId: 'eva', rides: true, time: '23:00' }]);
  far.best.cars.forEach(c => { const m = c.girlIds.map(id => (far.best.times[id] || '17:00')); assert.ok(m.length === 1 || !m.includes('23:00') || m.every(x => x === '23:00')); });
});
test('keep: "rijdt niet mee" takes the girl out; a car that still has a girl keeps at least one', () => {
  const a = keep([{ familyId: 'noor', rides: false, time: '' }, { familyId: 'eva', rides: false, time: '' }]);
  assert.ok(!a.best.cars.some(c => c.girlIds.includes('eva') || c.girlIds.includes('noor')));
  assert.ok(!a.best.cars.some(c => c.driverFamilyId === 'saar'), 'the car of Saar had only those two girls: it does not drive');
  assert.deepEqual(a.best.times, { noor: '', eva: '' });
});
test('keep: terug waits for the last one; the waiting is counted the other way round', () => {
  const a = keep([{ familyId: 'eva', rides: true, time: '16:30' }], { direction: 'terug' });
  assert.equal(a.best.waitMinutes, 0, 'Eva is in a car with girls at 17:00 only if she waits 30; the plan puts her where nobody waits');
  const lot = a.best.cars.find(c => c.girlIds.includes('eva'));
  assert.equal(lot.departureTime, lot.girlIds.length === 1 ? '16:30' : '17:00');
});
test('keep: "eigen ouder rijdt mee" (terug) is hard: the girl sits in the car of her own parent', () => {
  const rules = [{ type: 'ownCar', girlId: 'saar' }];
  const cars2 = [{ driverFamilyId: 'saar', girlIds: ['saar', 'noor'], departureTime: '17:00' }, { driverFamilyId: 'lotte', girlIds: ['lotte'], departureTime: '17:00' }];
  const a = keep([{ familyId: 'saar', rides: true, time: '17:30' }], { direction: 'terug', cars: cars2, prefs: { rules } });
  assert.ok(a.best.cars.find(c => c.driverFamilyId === 'saar').girlIds.includes('saar'));
});
test('keep: when nothing fits in the existing cars, there is no best plan and the normal advice is given as the fallback', () => {
  const tiny = { ...kf, saar: fam('17:00', 2) };
  const a = buildKeepAdvice({ day: 'Ma', direction: 'heen', cars: [{ driverFamilyId: 'saar', girlIds: ['noor'], departureTime: '16:00' }], requests: [{ familyId: 'eva', rides: true, time: '17:00' }, { familyId: 'fenna', rides: true, time: '17:00' }], timeOf: id => kf[id].schedule.Ma.heen, families: tiny, settings: {}, prefs: { rules: [] }, priority: {} });
  assert.equal(a.best, null); assert.ok(a.fallback && Array.isArray(a.fallback.cars));
});
test('keep: "samen reizen" is a tie-breaker after the waiting', () => {
  const rules = [{ type: 'together', ids: ['eva', 'noor'] }];
  const a = keep([{ familyId: 'lotte', rides: true, time: '17:30' }], { prefs: { rules } });
  const car = a.best.cars.find(c => c.girlIds.includes('eva'));
  assert.ok(car.girlIds.includes('noor'));
});
test('keep: deterministic and pure', () => {
  const ctx = { day: 'Ma', direction: 'heen', cars: kcars, requests: ask, timeOf: id => kf[id].schedule.Ma.heen, families: kf, settings: {}, prefs: { rules: [] }, priority: {} };
  const before = JSON.stringify(ctx), x = JSON.stringify(buildKeepAdvice(ctx)), y = JSON.stringify(buildKeepAdvice(ctx));
  assert.equal(x, y); assert.equal(JSON.stringify(ctx), before);
});
console.log('=== the numbers of a changed proposal (evaluateCars) ===');
{
  const fm = { saar: fam('16:00'), lotte: fam('16:30'), julia: fam('17:00', 5), roos: fam('15:00') };
  const base = { day: 'Ma', direction: 'heen', families: fm, settings: {}, prefs: { rules: [] }, timeOf: id => ({ saar: '16:00', lotte: '16:30', julia: '17:00', roos: '15:00' })[id],
    cars: [{ driverFamilyId: 'saar', girlIds: ['saar'], departureTime: '15:00' }, { driverFamilyId: 'julia', girlIds: ['julia', 'roos'], departureTime: '14:00' }], requests: [] };
  test('evaluate: waiting is measured from the departure time that is set on the car; late is not waiting', () => {
    const e = evaluateCars(base, [{ driverFamilyId: 'saar', girlIds: ['saar', 'lotte'], departureTime: '15:00' }, { driverFamilyId: 'julia', girlIds: ['julia', 'roos'], departureTime: '14:00' }]);
    assert.equal(e.waitOf.saar, 0); assert.equal(e.waitOf.lotte, 30); assert.equal(e.waitOf.roos, 0); assert.equal(e.waitOf.julia, 120);
    assert.equal(e.waitMinutes, 150); assert.deepEqual(e.late, []); assert.deepEqual(e.moved, []);
    const late = evaluateCars(base, [{ driverFamilyId: 'saar', girlIds: ['saar'], departureTime: '16:00' }, { driverFamilyId: 'julia', girlIds: ['julia', 'roos'], departureTime: '14:00' }]);
    assert.deepEqual(late.late, ['saar']); assert.ok(late.problems.some(p => p.key === 'late'));
  });
  test('evaluate: seats, the time spread and girls without a car are problems; the drivers who notice it are counted', () => {
    const e = evaluateCars({ ...base, families: { ...fm, saar: fam('16:00', 2) } }, [{ driverFamilyId: 'saar', girlIds: ['saar', 'lotte'], departureTime: '15:00' }, { driverFamilyId: 'julia', girlIds: ['julia'], departureTime: '16:00' }]);
    assert.ok(e.problems.some(p => p.key === 'seats' && p.id === 'saar')); assert.ok(e.problems.some(p => p.key === 'unplaced' && p.ids.includes('roos')));
    const far = evaluateCars({ ...base, timeOf: id => ({ saar: '08:00', lotte: '16:30', julia: '17:00', roos: '15:00' })[id] }, [{ driverFamilyId: 'saar', girlIds: ['saar', 'lotte'], departureTime: '07:00' }, { driverFamilyId: 'julia', girlIds: ['julia', 'roos'], departureTime: '14:00' }]);
    assert.ok(far.problems.some(p => p.key === 'gap'));
    const moved = evaluateCars(base, [{ driverFamilyId: 'saar', girlIds: ['saar', 'roos'], departureTime: '14:00' }, { driverFamilyId: 'julia', girlIds: ['julia'], departureTime: '16:00' }]);
    assert.deepEqual(moved.moved, ['roos']); assert.deepEqual(moved.familiesChanged.sort(), ['julia', 'saar']);
  });
  test('evaluate: terug counts the waiting from her time until the car leaves; a girl who asks is not a driver who "notices it"', () => {
    const b = { ...base, direction: 'terug', requests: [{ familyId: 'lotte', rides: true, time: '17:30' }] };
    const e = evaluateCars(b, [{ driverFamilyId: 'saar', girlIds: ['saar', 'lotte'], departureTime: '17:30' }, { driverFamilyId: 'julia', girlIds: ['julia', 'roos'], departureTime: '17:00' }]);
    assert.equal(e.waitOf.saar, 90); assert.equal(e.waitOf.lotte, 0); assert.ok(!e.familiesChanged.includes('lotte'));
  });
  test('keep advice: familiesChanged only holds drivers, not the parents of the girls in the car', () => {
    const r = buildKeepAdvice({ ...base, requests: [{ familyId: 'roos', rides: true, time: '16:30' }] });
    assert.ok(r.best.familiesChanged.every(id => base.cars.some(c => c.driverFamilyId === id)));
  });
}
test('weekrooster-impact.js imports nothing it does not use', () => assertNoUnusedImports('weekrooster-impact.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
