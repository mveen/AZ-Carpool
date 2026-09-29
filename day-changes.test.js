// Run with: node day-changes.test.js
// dayChanges(): the difference between the standard cars and this week's cars for one day+direction.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { dayChanges } from './day-changes.js';

const car = (driverFamilyId, girlIds, departureTime = '07:30') => ({ driverFamilyId, girlIds, departureTime });

console.log('=== no change ===');
test('same cars give no items', () => {
  assert.deepEqual(dayChanges([car('f1', ['f1', 'f2'])], [car('f1', ['f1', 'f2'])]), []);
});
test('missing input is treated as no cars', () => {
  assert.deepEqual(dayChanges(undefined, undefined), []);
  assert.deepEqual(dayChanges(null, []), []);
});
test('cars without girls are ignored', () => {
  assert.deepEqual(dayChanges([car('f1', [])], [car('f2', [])]), []);
});

console.log('\n=== girls ===');
test('a girl who is removed is reported as "out"', () => {
  assert.deepEqual(dayChanges([car('f1', ['f1', 'f2'])], [car('f1', ['f1'])]), [{ type: 'out', girlId: 'f2' }]);
});
test('a girl who moves to another car is reported as "moved" with the new driver', () => {
  const items = dayChanges([car('f1', ['f1', 'f2']), car('f3', ['f3', 'f4'])], [car('f1', ['f1']), car('f3', ['f3', 'f4', 'f2'])]);
  assert.deepEqual(items, [{ type: 'moved', girlId: 'f2', driverId: 'f3', time: '07:30' }]);
});
test('a girl without a standard ride is reported as "extra"', () => {
  const items = dayChanges([car('f1', ['f1'])], [car('f1', ['f1', 'f9'])]);
  assert.deepEqual(items, [{ type: 'extra', girlId: 'f9', driverId: 'f1', time: '07:30' }]);
});
test('everybody removed: every girl is "out"', () => {
  const items = dayChanges([car('f1', ['f1', 'f2'])], []);
  assert.deepEqual(items, [{ type: 'out', girlId: 'f1' }, { type: 'out', girlId: 'f2' }]);
});

console.log('\n=== drivers and times ===');
test('a car with a new driver is ONE item, not one per girl', () => {
  const items = dayChanges([car('f1', ['f2', 'f4'])], [car('f3', ['f2', 'f4'])]);
  assert.deepEqual(items, [{ type: 'driver', driverId: 'f3', fromDriverId: 'f1', time: '07:30' }]);
});
test('a car that lost its driver reports driverId null', () => {
  const items = dayChanges([car('f1', ['f2'])], [car(null, ['f2'])]);
  assert.deepEqual(items, [{ type: 'driver', driverId: null, fromDriverId: 'f1', time: '07:30' }]);
});
test('same car, other departure time: "time"', () => {
  assert.deepEqual(dayChanges([car('f1', ['f2'], '07:30')], [car('f1', ['f2'], '07:45')]), [{ type: 'time', driverId: 'f1', time: '07:45' }]);
});
test('a driver change wins over a time change of the same car', () => {
  const items = dayChanges([car('f1', ['f2'], '07:30')], [car('f3', ['f2'], '07:45')]);
  assert.deepEqual(items, [{ type: 'driver', driverId: 'f3', fromDriverId: 'f1', time: '07:45' }]);
});
test('a car that shares no girl with the standard rooster is "newcar"', () => {
  const items = dayChanges([car('f1', ['f2'])], [car('f1', ['f2']), car('f9', ['f9', 'f8'])]);
  assert.deepEqual(items, [{ type: 'newcar', driverId: 'f9', girlIds: ['f9', 'f8'], time: '07:30', extraGirlIds: ['f9', 'f8'] }]);
});
test('a Flex driver who only drives herself is a "newcar" with one girl', () => {
  const items = dayChanges([], [car('f9', ['f9'])]);
  assert.deepEqual(items, [{ type: 'newcar', driverId: 'f9', girlIds: ['f9'], time: '07:30', extraGirlIds: ['f9'] }]);
});

test('a new car only lists as "extra" the girls who have no standard ride at all', () => {
  const items = dayChanges([car('f1', ['f1', 'f2'])], [car('f1', ['f1']), car('f9', ['f9', 'f2'], '08:00')]);
  assert.deepEqual(items, [{ type: 'newcar', driverId: 'f9', girlIds: ['f9', 'f2'], time: '08:00', extraGirlIds: ['f9'] }]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
