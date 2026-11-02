// Run with: node weekrooster-plan.test.js
// weekrooster-plan.js: the day coordinator's changes to the proposal (pure functions on a list of cars).
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { assertNoUnusedImports } from './test-support.js';
import { timeAfter, departureFor, withGirlIn, withDeparture, withDriver, withPlace, withDestination, withNewCar, withoutGirl, unplacedIn, withoutEmptyCars } from '../weekrooster-plan.js';

const times = { a: '08:00', b: '09:00', c: '10:00', d: '08:30' };
const ctx = (direction = 'heen', requests = []) => ({
  day: 'Do', direction, settings: { travelLeadMinutes: 60 }, requests, timeOf: id => times[id] || '',
  cars: [{ driverFamilyId: 'p', girlIds: ['a', 'b'] }, { driverFamilyId: 'q', girlIds: ['c'] }],
});
const cars = () => [{ driverFamilyId: 'p', girlIds: ['a', 'b'], departureTime: '07:00' }, { driverFamilyId: 'q', girlIds: ['c'], departureTime: '09:00' }];

console.log('=== times ===');
test('timeAfter: the asked time, "" for a girl who stays home, else the time she has', () => {
  const c = ctx('heen', [{ familyId: 'b', rides: true, time: '11:00' }, { familyId: 'c', rides: false, time: '' }]);
  assert.equal(timeAfter(c, 'a'), '08:00'); assert.equal(timeAfter(c, 'b'), '11:00'); assert.equal(timeAfter(c, 'c'), ''); assert.equal(timeAfter(c, 'zz'), '');
});
test('departureFor: heen = earliest arrival minus the travel time, terug = the latest ready time', () => {
  assert.equal(departureFor(ctx('heen'), ['a', 'b']), '07:00'); assert.equal(departureFor(ctx('terug'), ['a', 'b']), '09:00');
  assert.equal(departureFor({ ...ctx('heen'), settings: {} }, ['a']), '07:00', 'the default travel time is 60 minutes');
});

console.log('=== moving a girl ===');
test('withGirlIn: out of her car, into the other; both departure times are calculated again; the input is not changed', () => {
  const input = cars(), out = withGirlIn(ctx(), input, 'a', 'q');
  assert.deepEqual(out.map(c => [c.driverFamilyId, c.girlIds, c.departureTime]), [['p', ['b'], '08:00'], ['q', ['c', 'a'], '07:00']]);
  assert.deepEqual(input, cars());
});
test('withGirlIn: a time chosen by hand stays; a car left without girls disappears; an unknown driver changes nothing', () => {
  const hand = cars().map(c => (c.driverFamilyId === 'p' ? { ...c, depManual: true, departureTime: '06:30' } : c));
  assert.equal(withGirlIn(ctx(), hand, 'a', 'q').find(c => c.driverFamilyId === 'p').departureTime, '06:30');
  assert.deepEqual(withGirlIn(ctx(), cars(), 'c', 'p').map(c => c.driverFamilyId), ['p']);
  const same = cars(); assert.equal(withGirlIn(ctx(), same, 'a', 'zz'), same);
  assert.deepEqual(withGirlIn(ctx(), cars(), 'a', 'p').map(c => c.girlIds), [['a', 'b'], ['c']], 'already there: nothing moves');
});

console.log('=== time, driver, place, arrival ===');
test('withDeparture: a time by hand is marked; "" calculates it again', () => {
  const hand = withDeparture(ctx(), cars(), 'p', '06:45');
  assert.deepEqual(hand.find(c => c.driverFamilyId === 'p'), { driverFamilyId: 'p', girlIds: ['a', 'b'], departureTime: '06:45', depManual: true });
  const back = withDeparture(ctx(), hand, 'p', '');
  assert.equal(back.find(c => c.driverFamilyId === 'p').departureTime, '07:00'); assert.equal('depManual' in back.find(c => c.driverFamilyId === 'p'), false);
  assert.equal(hand.find(c => c.driverFamilyId === 'q').departureTime, '09:00');
});
test('withDriver: another driver for the car, never one who already drives in this shift', () => {
  assert.deepEqual(withDriver(cars(), 'p', 'r').map(c => c.driverFamilyId), ['r', 'q']);
  const same = cars(); assert.equal(withDriver(same, 'p', 'q'), same); assert.equal(withDriver(same, 'p', ''), same);
});
test('withPlace: a place from Beheer, free text, or back to the standard place', () => {
  let out = withPlace(cars(), 'p', { locationId: 'busstation' }); assert.equal(out[0].locationId, 'busstation');
  out = withPlace(out, 'p', { locationText: 'Dorpsstraat 1' }); assert.equal(out[0].locationText, 'Dorpsstraat 1'); assert.equal('locationId' in out[0], false);
  out = withPlace(out, 'p', {}); assert.equal('locationId' in out[0] || 'locationText' in out[0], false);
});
test('withDestination: ATC is stored; the standard arrival is stored as nothing', () => {
  let out = withDestination(cars(), 'p', 'ATC'); assert.equal(out[0].destination, 'ATC');
  out = withDestination(out, 'p', 'AFC'); assert.equal('destination' in out[0], false);
  const atc = [{ ...cars()[0], stdDestination: 'ATC' }]; assert.equal('destination' in withDestination(atc, 'p', 'ATC')[0], false);
});

console.log('=== a car for another driver, who is not placed ===');
test('withNewCar adds an empty car once; a girl can move into it; the empty car is easy to drop', () => {
  const out = withNewCar(cars(), 'r'); assert.equal(out.length, 3); assert.equal(withNewCar(out, 'r'), out); const base = cars(); assert.equal(withNewCar(base, ''), base);
  assert.deepEqual(withoutEmptyCars(out).length, 2);
  const moved = withGirlIn(ctx(), out, 'c', 'r'); assert.deepEqual(moved.map(c => [c.driverFamilyId, c.girlIds, c.departureTime]), [['p', ['a', 'b'], '07:00'], ['r', ['c'], '09:00']]);
});
test('unplacedIn: girls who ride after the requests and sit in no car', () => {
  const c = ctx('heen', [{ familyId: 'x', rides: true, time: '09:00' }, { familyId: 'b', rides: false, time: '' }]);
  assert.deepEqual(unplacedIn(c, [{ driverFamilyId: 'p', girlIds: ['a'] }, { driverFamilyId: 'q', girlIds: ['c'] }]), ['x']);
  assert.deepEqual(unplacedIn(c, [{ driverFamilyId: 'p', girlIds: ['a', 'x'] }, { driverFamilyId: 'q', girlIds: ['c'] }]), []);
});
test('withoutGirl: out of her car, the departure is calculated again; a car left empty disappears; the input is not changed', () => {
  const c = ctx('heen'), input = cars(), out = withoutGirl(c, input, 'a');
  assert.deepEqual(out.find(x => x.driverFamilyId === 'p').girlIds, ['b']); assert.equal(out.find(x => x.driverFamilyId === 'p').departureTime, '08:00');   // b rides 09:00, minus 60
  assert.deepEqual(withoutGirl(c, input, 'c').map(x => x.driverFamilyId), ['p']);
  assert.deepEqual(input, cars()); assert.deepEqual(withoutGirl(c, input, 'zz'), input);
});
test('weekrooster-plan.js imports nothing it does not use', () => assertNoUnusedImports('weekrooster-plan.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
