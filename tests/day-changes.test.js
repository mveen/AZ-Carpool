// Run with: node day-changes.test.js
// dayChanges(): the difference between the standard cars and this week's cars for one day+direction.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { dayChanges } from '../day-changes.js';

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

import { overwrittenChanges } from '../day-changes.js';
console.log('\n=== overwrittenChanges: earlier changes a plan takes back ===');
{
  const B = [car('f1', ['f1', 'f3'], '17:00'), car('f2', ['f2', 'f4'], '18:00')];
  test('a plan that keeps the earlier changes overwrites nothing', () => {
    const now = [car('f1', ['f1', 'f3'], '17:00'), car('f2', ['f2', 'f4'], '18:30')];
    assert.deepEqual(overwrittenChanges(B, now, now, []), []);
    assert.deepEqual(overwrittenChanges(B, B, B, []), [], 'no earlier changes: nothing to take back');
  });
  test('an earlier time change that the plan sets back is overwritten, with the car in the plan', () => {
    const now = [car('f1', ['f1', 'f3'], '17:00'), car('f2', ['f2', 'f4'], '18:30')];
    assert.deepEqual(overwrittenChanges(B, now, B, []), [{ item: { type: 'time', driverId: 'f2', time: '18:30' }, after: { driverId: 'f2', time: '18:00' } }]);
  });
  test('a girl who moved earlier and is moved again: overwritten, "after" is her car in the plan', () => {
    const now = [car('f1', ['f1'], '17:00'), car('f2', ['f2', 'f4', 'f3'], '18:00')];
    assert.deepEqual(overwrittenChanges(B, now, B, []), [{ item: { type: 'moved', girlId: 'f3', driverId: 'f2', time: '18:00' }, after: { driverId: 'f1', time: '17:00' } }]);
  });
  test('changes about a girl who asked (or was set by hand) never count', () => {
    const now = [car('f1', ['f1'], '17:00'), car('f2', ['f2', 'f4', 'f3'], '18:00')];
    assert.deepEqual(overwrittenChanges(B, now, B, ['f3']), []);
  });
  test('a car that is gone in the plan has no "after"; the same item kept at another moment is not overwritten', () => {
    const now = [car('f1', ['f1', 'f3'], '17:00'), car('f9', ['f2', 'f4'], '18:00')];
    const plan = [car('f1', ['f1', 'f3', 'f2', 'f4'], '17:00')];
    assert.deepEqual(overwrittenChanges(B, now, plan, []), [{ item: { type: 'driver', driverId: 'f9', fromDriverId: 'f2', time: '18:00' }, after: null }]);
    const keep = [car('f1', ['f1', 'f3'], '17:00'), car('f9', ['f2', 'f4'], '19:00')];   // the driver swap stays, only the time moves: the swap is kept
    assert.deepEqual(overwrittenChanges(B, now, keep, []), []);
  });
  test('a girl who stays in the same car is NOT overwritten, even when the matching of the cars with the standard rooster changes (v239)', () => {
    const base = [car('c', ['jah', 'c2'], '08:00'), car('j', ['j1', 'j3'], '07:45')];
    const now = [car('c', ['c2'], '08:00'), car('j', ['j1', 'j3', 'jah'], '07:45')];   // earlier: Jahaimy went to j's car
    const plan = [car('j', ['jah', 'l', 's'], '07:45'), car('c', ['c2'], '08:00')];   // the plan matches j's car with c's standard car, so the item "moved" disappears; she still sits with j
    assert.ok(dayChanges(base, now).some(i => i.type === 'moved' && i.girlId === 'jah' && i.driverId === 'j'));
    assert.ok(!overwrittenChanges(base, now, plan, ['l', 's']).some(o => o.item.girlId === 'jah'), 'same car before and after: nothing was taken back');
  });
  test('a time change that stays the same in the plan, or a driver swap whose car is still there, is not overwritten', () => {
    const base = [car('c', ['c1'], '08:00'), car('j', ['j1'], '07:45')];
    const now = [car('c', ['c1'], '08:30'), car('x', ['j1'], '07:45')];   // earlier: c leaves 08:30, x drives j's girl
    const plan = [car('x', ['j1', 'c1'], '08:30')];
    const over = overwrittenChanges(base, now, plan, []);
    assert.ok(!over.some(o => o.item.type === 'driver'), 'x still drives');
  });
  test('missing input is treated as no cars; a girl out earlier who rides in the plan has her car as "after"', () => {
    assert.deepEqual(overwrittenChanges(undefined, undefined, undefined), []);
    const now = [car('f1', ['f1', 'f3'], '17:00'), car('f2', ['f2'], '18:00')];   // Evi (f4) out
    assert.deepEqual(overwrittenChanges(B, now, B, []), [{ item: { type: 'out', girlId: 'f4' }, after: { driverId: 'f2', time: '18:00' } }]);
  });
}

import { assertNoUnusedImports } from './test-support.js';
test('day-changes.js imports nothing it does not use', () => assertNoUnusedImports('day-changes.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

console.log('\n=== arrival place ===');
test('the same car arriving somewhere else is a place change (one-off choice or standard of the car)', () => {
  assert.deepEqual(dayChanges([car('f1', ['f1'])], [{ ...car('f1', ['f1']), destination: 'ATC' }]), [{ type: 'place', driverId: 'f1', time: '07:30', place: 'ATC' }]);
  assert.deepEqual(dayChanges([{ ...car('f1', ['f1']), stdDestination: 'ATC' }], [{ ...car('f1', ['f1']), stdDestination: 'ATC', destination: 'AFC' }]), [{ type: 'place', driverId: 'f1', time: '07:30', place: 'AFC' }]);
});
test('no place change when both say AFC, or both ATC (one-off or standard)', () => {
  assert.deepEqual(dayChanges([car('f1', ['f1'])], [{ ...car('f1', ['f1']), destination: 'AFC' }]), []);
  assert.deepEqual(dayChanges([{ ...car('f1', ['f1']), stdDestination: 'ATC' }], [{ ...car('f1', ['f1']), destination: 'ATC' }]), []);
});
