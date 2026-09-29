// Run with: node schedule-changes.test.js
// Plain Node, no dependencies. Exits non-zero if any test fails.
import assert from 'node:assert/strict';
import {
  diffSchedules, mergePendingChanges, collectPendingChanges, countPendingChanges, describeChange,
} from '../schedule-changes.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + (e && e.message)); }
}

console.log('diffSchedules');
test('no changes → empty list', () => {
  const s = { Ma: { heen: '08:30', terug: '17:00' } };
  assert.deepEqual(diffSchedules(s, structuredClone(s)), []);
});
test('detects a changed heen time', () => {
  assert.deepEqual(
    diffSchedules({ Ma: { heen: '08:30', terug: '17:00' } }, { Ma: { heen: '09:15', terug: '17:00' } }),
    [{ day: 'Ma', direction: 'heen', from: '08:30', to: '09:15' }]);
});
test('detects added and cleared times', () => {
  assert.deepEqual(
    diffSchedules({ Di: { heen: '', terug: '14:45' } }, { Di: { heen: '08:15', terug: '' } }),
    [{ day: 'Di', direction: 'heen', from: '', to: '08:15' },
     { day: 'Di', direction: 'terug', from: '14:45', to: '' }]);
});
test('missing day objects and undefined schedules count as empty', () => {
  assert.deepEqual(diffSchedules(undefined, { Vr: { terug: '13:00' } }),
    [{ day: 'Vr', direction: 'terug', from: '', to: '13:00' }]);
  assert.deepEqual(diffSchedules({}, {}), []);
});
test('whitespace-only differences are ignored', () => {
  assert.deepEqual(diffSchedules({ Wo: { heen: '08:30' } }, { Wo: { heen: ' 08:30 ' } }), []);
});
test('multiple days come back in weekday order, heen before terug', () => {
  const r = diffSchedules(
    { Vr: { heen: '1' }, Ma: { terug: '1' }, Wo: { heen: '1', terug: '1' } },
    { Vr: { heen: '2' }, Ma: { terug: '2' }, Wo: { heen: '2', terug: '2' } });
  assert.deepEqual(r.map((c) => c.day + c.direction), ['Materug', 'Woheen', 'Woterug', 'Vrheen']);
});

console.log('mergePendingChanges');
test('adds new changes with meta', () => {
  const r = mergePendingChanges([], [{ day: 'Ma', direction: 'heen', from: '08:30', to: '09:00' }], { at: 5, by: 'Jan' });
  assert.deepEqual(r, [{ day: 'Ma', direction: 'heen', from: '08:30', to: '09:00', at: 5, by: 'Jan' }]);
});
test('repeated edits keep the original "from"', () => {
  let p = mergePendingChanges([], [{ day: 'Ma', direction: 'heen', from: '08:30', to: '09:00' }], { at: 1, by: 'Jan' });
  p = mergePendingChanges(p, [{ day: 'Ma', direction: 'heen', from: '09:00', to: '09:15' }], { at: 2, by: 'Jan' });
  assert.deepEqual(p, [{ day: 'Ma', direction: 'heen', from: '08:30', to: '09:15', at: 2, by: 'Jan' }]);
});
test('changing back to the original time removes the entry', () => {
  let p = mergePendingChanges([], [{ day: 'Ma', direction: 'heen', from: '08:30', to: '09:00' }], { at: 1 });
  p = mergePendingChanges(p, [{ day: 'Ma', direction: 'heen', from: '09:00', to: '08:30' }], { at: 2 });
  assert.deepEqual(p, []);
});
test('unrelated pending entries are kept and result is sorted', () => {
  const pending = [{ day: 'Vr', direction: 'terug', from: '13:00', to: '15:30', at: 1, by: 'A' }];
  const r = mergePendingChanges(pending, [{ day: 'Di', direction: 'heen', from: '08:15', to: '08:30' }], { at: 2, by: 'B' });
  assert.deepEqual(r.map((c) => c.day), ['Di', 'Vr']);
  assert.equal(r[1].by, 'A');
});
test('does not mutate its inputs', () => {
  const pending = [{ day: 'Ma', direction: 'heen', from: '08:30', to: '09:00', at: 1, by: 'A' }];
  const snapshot = structuredClone(pending);
  mergePendingChanges(pending, [{ day: 'Ma', direction: 'heen', from: '09:00', to: '10:00' }], { at: 2 });
  assert.deepEqual(pending, snapshot);
});
test('handles null/undefined inputs', () => {
  assert.deepEqual(mergePendingChanges(undefined, undefined), []);
});

console.log('collectPendingChanges / countPendingChanges');
const fams = {
  evi: { girlName: 'Evi', parentName: 'Jan', timeChanges: [{ day: 'Ma', direction: 'heen', from: 'a', to: 'b', at: 10 }] },
  jet: { girlName: 'Jet', parentName: 'Piet', timeChanges: [
    { day: 'Di', direction: 'heen', from: 'a', to: 'b', at: 20 },
    { day: 'Di', direction: 'terug', from: 'a', to: 'b', at: 30 }] },
  saar: { girlName: 'Saar', parentName: 'Kees' },
  lois: { girlName: 'Loïs', timeChanges: [] },
};
test('only families with pending changes, newest first', () => {
  const r = collectPendingChanges(fams);
  assert.deepEqual(r.map((f) => f.familyId), ['jet', 'evi']);
  assert.equal(r[0].latestAt, 30);
});
test('counts individual changes', () => {
  assert.equal(countPendingChanges(fams), 3);
  assert.equal(countPendingChanges({}), 0);
  assert.equal(countPendingChanges(undefined), 0);
});

console.log('describeChange');
test('formats heen and terug, including empty times', () => {
  assert.equal(describeChange({ day: 'Ma', direction: 'heen', from: '08:30', to: '09:15' }),
    'Ma · Heen (aankomst Alkmaar): 08:30 → 09:15');
  assert.equal(describeChange({ day: 'Vr', direction: 'terug', from: '', to: '13:00' }),
    'Vr · Terug (klaar om op te halen): geen tijd → 13:00');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
