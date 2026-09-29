// Run with: node flex.test.js
// Flex signup: pure car edits (join as passenger, drive yourself, sign off) and the departure time they give.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { flexDeparture, flexIsSignedUp, carsWithFreeSeat, flexJoinCar, flexDriveOwn, flexSignOff } from '../flex.js';

const car = (driverFamilyId, girlIds, departureTime = '07:30') => ({ driverFamilyId, girlIds, departureTime, reserveFamilyIds: [] });

console.log('=== departure time ===');
test('heen: leaves the travel lead before the arrival time', () => { assert.equal(flexDeparture('heen', '', '09:00', 60), '08:00'); });
test('heen: the earliest need wins', () => {
  assert.equal(flexDeparture('heen', '07:30', '09:00', 60), '07:30');
  assert.equal(flexDeparture('heen', '08:30', '09:00', 60), '08:00');
});
test('terug: the latest ready time wins', () => {
  assert.equal(flexDeparture('terug', '', '16:00', 60), '16:00');
  assert.equal(flexDeparture('terug', '17:00', '16:00', 60), '17:00');
  assert.equal(flexDeparture('terug', '15:00', '16:00', 60), '16:00');
});
test('no valid time keeps the existing departure', () => { assert.equal(flexDeparture('heen', '07:30', '', 60), '07:30'); });
test('a missing lead falls back to 60 minutes', () => { assert.equal(flexDeparture('heen', '', '09:00', undefined), '08:00'); });

console.log('\n=== signed up? / free seats ===');
test('signed up as passenger or as driver', () => {
  assert.equal(flexIsSignedUp([car('f1', ['f1', 'f9'])], 'f9'), true);
  assert.equal(flexIsSignedUp([car('f9', ['f2'])], 'f9'), true);
  assert.equal(flexIsSignedUp([car('f1', ['f1'])], 'f9'), false);
  assert.equal(flexIsSignedUp(undefined, 'f9'), false);
});
test('only cars with a driver and a free seat can be joined', () => {
  const seats = { f1: 2, f2: 3, f3: 1 };
  const cars = [car('f1', ['f1', 'f4']), car('f2', ['f2']), car(null, ['f5']), car('f3', ['f3'])];
  assert.deepEqual(carsWithFreeSeat(cars, id => seats[id]), [1]);
});

console.log('\n=== join, drive, sign off ===');
test('joining adds the girl and moves the departure; the input is not changed', () => {
  const cars = [car('f1', ['f1'], '07:30')];
  const out = flexJoinCar(cars, 0, 'f9', '08:00', 'heen', 60);
  assert.deepEqual(out[0].girlIds, ['f1', 'f9']);
  assert.equal(out[0].departureTime, '07:00');
  assert.deepEqual(cars[0].girlIds, ['f1']);
});
test('joining twice does not add her twice', () => {
  const out = flexJoinCar([car('f1', ['f1', 'f9'])], 0, 'f9', '09:00', 'heen', 60);
  assert.deepEqual(out[0].girlIds, ['f1', 'f9']);
});
test('driving yourself adds a new car with you as driver and passenger', () => {
  const out = flexDriveOwn([car('f1', ['f1'])], 'f9', '16:30', 'terug', 60);
  assert.equal(out.length, 2);
  assert.deepEqual(out[1], { driverFamilyId: 'f9', girlIds: ['f9'], reserveFamilyIds: [], departureTime: '16:30' });
});
test('signing off as passenger removes only her', () => {
  const out = flexSignOff([car('f1', ['f1', 'f9']), car('f2', ['f2'])], 'f9');
  assert.deepEqual(out.map(c => c.girlIds), [['f1'], ['f2']]);
});
test('signing off as a driver alone removes her car', () => {
  assert.deepEqual(flexSignOff([car('f9', ['f9']), car('f1', ['f1'])], 'f9').map(c => c.driverFamilyId), ['f1']);
});
test('signing off as a driver with other riders leaves the car without a driver', () => {
  const out = flexSignOff([car('f9', ['f9', 'f2'])], 'f9');
  assert.deepEqual(out.map(c => [c.driverFamilyId, c.girlIds]), [[null, ['f2']]]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
