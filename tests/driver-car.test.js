// Run with: node driver-car.test.js
// The driver changes the time and the place of the OWN car: the pure rules (who may, what is stored, what survives a recalculation, the soft warning).
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { assertNoUnusedImports } from './test-support.js';
import { driverCarIndex, mayAdjustCar, applyDriverChange, resetDriverChange, differsFromAuto, timeWarning, timeChangeOf } from '../driver-car.js';

const car = (o = {}) => ({ driverFamilyId: 'f2', girlIds: ['f1', 'f2'], departureTime: '17:30', ...o });

console.log('=== who may ===');
test('only the driver of a car may change it: not a passenger, not someone else, not when nobody drives', () => {
  assert.equal(mayAdjustCar(car(), 'f2'), true);
  assert.equal(mayAdjustCar(car(), 'f1'), false);
  assert.equal(mayAdjustCar(car({ driverFamilyId: null }), 'f2'), false);
  assert.equal(mayAdjustCar(null, 'f2'), false); assert.equal(mayAdjustCar(car(), null), false);
  assert.equal(applyDriverChange(car(), 'f1', { time: '18:00' }), null, 'nothing comes out for someone else');
});
test('the car of this driver: the first one with passengers, -1 when there is none', () => {
  const cars = [car({ driverFamilyId: 'f3', girlIds: [] }), car({ driverFamilyId: 'f3' }), car()];
  assert.equal(driverCarIndex(cars, 'f3'), 1, 'an empty car does not count');
  assert.equal(driverCarIndex(cars, 'f2'), 2); assert.equal(driverCarIndex(cars, 'f9'), -1); assert.equal(driverCarIndex(cars, null), -1); assert.equal(driverCarIndex(null, 'f2'), -1);
});

console.log('=== what is stored ===');
test('the time and a place from Beheer are stored on the car', () => {
  const n = applyDriverChange(car(), 'f2', { time: '18:15', locationId: 'de-parel' });
  assert.equal(n.departureTime, '18:15'); assert.equal(n.locationId, 'de-parel'); assert.equal('locationText' in n, false);
  assert.deepEqual(n.girlIds, ['f1', 'f2']);
});
test('free input replaces a place and the other way round; an empty place means the standard place', () => {
  const free = applyDriverChange(car({ locationId: 'de-parel' }), 'f2', { time: '18:00', locationText: 'Hoofdweg 12' });
  assert.equal(free.locationText, 'Hoofdweg 12'); assert.equal('locationId' in free, false);
  const place = applyDriverChange(free, 'f2', { time: '18:00', locationId: 'a4-de-hoek' });
  assert.equal(place.locationId, 'a4-de-hoek'); assert.equal('locationText' in place, false);
  const std = applyDriverChange(place, 'f2', { time: '18:00' });
  assert.equal('locationId' in std, false); assert.equal('locationText' in std, false);
});
test('the input car is never changed', () => {
  const c = car(); applyDriverChange(c, 'f2', { time: '19:00', locationText: 'x' });
  assert.deepEqual(c, car());
});
test('back to automatic: the calculated time, no place of the driver', () => {
  const r = resetDriverChange(car({ locationId: 'de-parel', departureTime: '19:00' }), '18:00');
  assert.equal(r.departureTime, '18:00'); assert.equal('locationId' in r, false);
  assert.equal(resetDriverChange(car(), '').departureTime, '17:30', 'without a calculated time the time stays');
});

console.log('=== differs from automatic ===');
test('another time than calculated, or a place of its own, differs; the calculated time and the standard place do not', () => {
  assert.equal(differsFromAuto(car({ departureTime: '19:00' }), '18:00'), true);
  assert.equal(differsFromAuto(car({ locationId: 'de-parel' }), '17:30'), true);
  assert.equal(differsFromAuto(car({ locationText: 'Hoofdweg 12' }), '17:30'), true);
  assert.equal(differsFromAuto(car(), '17:30'), false); assert.equal(differsFromAuto(null, '17:30'), false);
});

console.log('=== the soft warning ===');
test('heen: later than calculated is a warning, earlier is not. terug: earlier than calculated is a warning, later is not', () => {
  assert.equal(timeWarning('heen', '07:30', '07:00'), 'laat'); assert.equal(timeWarning('heen', '06:30', '07:00'), null);
  assert.equal(timeWarning('terug', '16:30', '17:00'), 'vroeg'); assert.equal(timeWarning('terug', '17:30', '17:00'), null);
});
test('the same time, or a time that cannot be read, gives no warning', () => {
  assert.equal(timeWarning('heen', '07:00', '07:00'), null); assert.equal(timeWarning('terug', '', '17:00'), null); assert.equal(timeWarning('terug', '17:00', ''), null);
});

console.log('=== Mijn week: the time changed ===');
const base = [car({ departureTime: '17:00' }), car({ driverFamilyId: 'f3', girlIds: ['f4'], departureTime: '16:00' })];
test('the time of the same driver differs from the standard rooster: old and new time', () => {
  assert.deepEqual(timeChangeOf(base, car({ departureTime: '17:45' })), { from: '17:00', to: '17:45' });
});
test('the same time, no standard car or no time: no change', () => {
  assert.equal(timeChangeOf(base, car({ departureTime: '17:00' })), null);
  assert.equal(timeChangeOf([], car()), null); assert.equal(timeChangeOf(null, car()), null);
  assert.equal(timeChangeOf(base, car({ departureTime: '' })), null); assert.equal(timeChangeOf(base, null), null);
});
test('another driver takes over: the standard car is the one that shares most girls', () => {
  assert.deepEqual(timeChangeOf(base, car({ driverFamilyId: 'f9', departureTime: '17:20' })), { from: '17:00', to: '17:20' });
  assert.equal(timeChangeOf(base, car({ driverFamilyId: 'f9', girlIds: ['f7'], departureTime: '17:20' })), null, 'nothing in common: no standard car');
});

test('driver-car.js imports nothing it does not use', () => assertNoUnusedImports('driver-car.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
