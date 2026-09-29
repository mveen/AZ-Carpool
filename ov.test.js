// Run with: node ov.test.js
// "Terug met OV" (US-06): pure rules for marking a daughter as going home by public transport.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { ovIds, isOv, applyOv, keepOv } from './ov.js';

const dep = ids => ids.length ? 'dep:' + ids.join('+') : '';
const cars = () => [
  { driverFamilyId: 'd1', girlIds: ['a', 'b'], departureTime: '17:00' },
  { driverFamilyId: 'd2', girlIds: ['c'], departureTime: '17:30' },
];

console.log('=== reading ===');
test('ovIds/isOv read the marked girls, and cope with nothing', () => {
  assert.deepEqual(ovIds(null), []); assert.deepEqual(ovIds({}), []);
  assert.deepEqual(ovIds({ ovGirlIds: ['a'] }), ['a']);
  assert.equal(isOv({ ovGirlIds: ['a'] }, 'a'), true); assert.equal(isOv({ ovGirlIds: ['a'] }, 'b'), false);
});

console.log('\n=== marking OV ===');
test('marking takes the girl out of her car, remembers the driver and recalculates the departure time', () => {
  const r = applyOv({ cars: cars() }, 'a', true, dep);
  assert.deepEqual(r.cars[0].girlIds, ['b']); assert.equal(r.cars[0].departureTime, 'dep:b');
  assert.deepEqual(r.cars[1].girlIds, ['c']);
  assert.deepEqual(r.ovGirlIds, ['a']); assert.deepEqual(r.ovFrom, { a: 'd1' });
});
test('a girl who is in no car can still be marked (she drops out of the "not planned" list)', () => {
  const r = applyOv({ cars: cars() }, 'z', true, dep);
  assert.deepEqual(r.ovGirlIds, ['z']); assert.deepEqual(r.ovFrom, { z: null });
  assert.deepEqual(r.cars.map(c => c.girlIds), [['a', 'b'], ['c']]);
});
test('marking twice keeps one entry', () => {
  const r1 = applyOv({ cars: cars() }, 'a', true, dep);
  const r2 = applyOv(r1, 'a', true, dep);
  assert.deepEqual(r2.ovGirlIds, ['a']);
});
test('the input is not changed', () => {
  const c = cars(); applyOv({ cars: c }, 'a', true, dep);
  assert.deepEqual(c, cars());
});
test('a car that becomes empty stays in the list with no girls and no departure time', () => {
  const r = applyOv({ cars: cars() }, 'c', true, dep);
  assert.deepEqual(r.cars[1].girlIds, []); assert.equal(r.cars[1].departureTime, '');
});

console.log('\n=== unmarking ===');
test('unmarking puts her back in the car of the same driver', () => {
  const on = applyOv({ cars: cars() }, 'a', true, dep);
  const off = applyOv(on, 'a', false, dep);
  assert.deepEqual(off.cars[0].girlIds, ['b', 'a']); assert.equal(off.cars[0].departureTime, 'dep:b+a');
  assert.deepEqual(off.ovGirlIds, []); assert.deepEqual(off.ovFrom, {});
});
test('when that driver no longer has a car she is simply unmarked (not planned again)', () => {
  const on = applyOv({ cars: cars() }, 'a', true, dep);
  const off = applyOv({ ...on, cars: on.cars.filter(c => c.driverFamilyId !== 'd1') }, 'a', false, dep);
  assert.deepEqual(off.cars.map(c => c.girlIds), [['c']]); assert.deepEqual(off.ovGirlIds, []);
});
test('a girl who was in no car stays in no car after unmarking', () => {
  const on = applyOv({ cars: cars() }, 'z', true, dep);
  const off = applyOv(on, 'z', false, dep);
  assert.deepEqual(off.cars.map(c => c.girlIds), [['a', 'b'], ['c']]); assert.deepEqual(off.ovGirlIds, []);
});

console.log('\n=== other edits of the terug cars ===');
test('keepOv keeps the marks of girls who are still in no car, and stores nothing when nobody is marked', () => {
  assert.deepEqual(keepOv({ ovGirlIds: ['a'], ovFrom: { a: 'd1' } }, [{ girlIds: ['b'] }]), { ovGirlIds: ['a'], ovFrom: { a: 'd1' } });
  assert.deepEqual(keepOv(null, [{ girlIds: ['b'] }]), {});
  assert.deepEqual(keepOv({}, []), {});
});
test('keepOv drops the mark of a girl who was put back in a car by hand', () => {
  assert.deepEqual(keepOv({ ovGirlIds: ['a', 'x'], ovFrom: { a: 'd1', x: 'd2' } }, [{ girlIds: ['a'] }]), { ovGirlIds: ['x'], ovFrom: { x: 'd2' } });
  assert.deepEqual(keepOv({ ovGirlIds: ['a'], ovFrom: { a: 'd1' } }, [{ girlIds: ['a'] }]), {});
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
