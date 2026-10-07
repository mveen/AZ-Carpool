// Run with: node period-backup.test.js
// Back-ups of a "periode met andere tijden": build, check, what changed since, and the plan for a restore (pure functions).
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import './test-support.js';
import { PERIOD_BACKUP_MAX, backupId, autoBackupId, buildPeriodBackup, validBackup, backupsFor, countManual, changesSince, planRestore } from '../period-backup.js';

const A = { name: 'Herfstvakantie', firstDay: '2026-10-26', lastDay: '2026-10-30', opensOn: '2026-10-14', deadlineDate: '2026-10-16', deadlineTime: '12:00' };
const B = { name: 'Toetsweek', firstDay: '2026-11-09', lastDay: '2026-11-13', opensOn: '2026-10-27', deadlineDate: '2026-11-04', deadlineTime: '12:00' };
const entry = (first, fam, heen, by = 'Ouder') => ({ familyId: fam, periodFirstDay: first, days: { [first]: { heen, terug: '15:00' } }, submittedAt: 111, by });
const shift = (first, date, dir, driver) => ({ periodFirstDay: first, date, direction: dir, cars: [{ driverFamilyId: driver, girlIds: ['f2'], departureTime: '08:00' }], madeAt: 5, by: 'Coördinator' });
const ENTRIES = { '2026-10-26_f2': entry('2026-10-26', 'f2', '09:00'), '2026-10-26_f3': entry('2026-10-26', 'f3', ''), '2026-11-09_f2': entry('2026-11-09', 'f2', '10:00') };
const CARS = { '2026-10-26_2026-10-26_heen': shift('2026-10-26', '2026-10-26', 'heen', 'f1'), '2026-10-26_2026-10-26_terug': shift('2026-10-26', '2026-10-26', 'terug', 'f1'), '2026-11-09_2026-11-09_heen': shift('2026-11-09', '2026-11-09', 'heen', 'f4') };
const NOW = 1790000000000;
const make = (over = {}) => buildPeriodBackup(A, ENTRIES, CARS, { now: NOW, by: 'Michiel', ...over });

console.log('=== ids ===');
test('ids carry the first day; the automatic back-up has one fixed id per period', () => {
  assert.equal(PERIOD_BACKUP_MAX, 10);
  assert.equal(backupId('2026-10-26', NOW), '2026-10-26_1790000000000');
  assert.equal(autoBackupId('2026-10-26'), '2026-10-26_auto');
});

console.log('\n=== buildPeriodBackup ===');
test('holds the period, its entries and its shifts, and nothing of another period', () => {
  const b = make();
  assert.deepEqual(b.period, A); assert.equal(b.periodFirstDay, '2026-10-26'); assert.equal(b.createdAt, NOW); assert.equal(b.by, 'Michiel'); assert.equal(b.auto, false);
  assert.deepEqual(Object.keys(b.entries).sort(), ['2026-10-26_f2', '2026-10-26_f3']);
  assert.deepEqual(Object.keys(b.cars).sort(), ['2026-10-26_2026-10-26_heen', '2026-10-26_2026-10-26_terug']);
});
test('the back-up is a copy: changing the app state afterwards does not change it', () => {
  const entries = { '2026-10-26_f2': entry('2026-10-26', 'f2', '09:00') };
  const b = buildPeriodBackup(A, entries, {}, { now: NOW });
  entries['2026-10-26_f2'].days['2026-10-26'].heen = '07:00';
  assert.equal(b.entries['2026-10-26_f2'].days['2026-10-26'].heen, '09:00');
});
test('a period without anything handed in or made gives empty maps; the automatic flag and a missing name work', () => {
  const b = buildPeriodBackup(B, {}, {}, { now: NOW, auto: true });
  assert.deepEqual(b.entries, {}); assert.deepEqual(b.cars, {}); assert.equal(b.auto, true); assert.equal(b.by, '');
  assert.deepEqual(buildPeriodBackup(A, null, undefined, { now: NOW }).entries, {});
});

console.log('\n=== validBackup, backupsFor ===');
test('a complete back-up is valid, a broken one is not', () => {
  assert.ok(validBackup(make()));
  assert.equal(validBackup(null), null); assert.equal(validBackup('x'), null);
  assert.equal(validBackup({ ...make(), createdAt: 'nu' }), null);
  assert.equal(validBackup({ ...make(), period: { ...A, name: '' } }), null, 'the period inside must be valid');
  assert.equal(validBackup({ ...make(), periodFirstDay: '2026-11-09' }), null, 'id and period must agree');
  assert.equal(validBackup({ ...make(), entries: { '2026-11-09_f2': entry('2026-11-09', 'f2', '10:00') } }), null, 'an entry of another period is refused');
  assert.equal(validBackup({ ...make(), cars: { x: null } }), null);
});
test('backupsFor: only this period, newest first, with the document id; broken ones are skipped', () => {
  const all = {
    [backupId('2026-10-26', 100)]: make({ now: 100 }), [backupId('2026-10-26', 300)]: make({ now: 300 }),
    '2026-10-26_auto': make({ now: 200, auto: true }),
    [backupId('2026-11-09', 400)]: buildPeriodBackup(B, ENTRIES, CARS, { now: 400 }),
    '2026-10-26_broken': { periodFirstDay: '2026-10-26' },
  };
  const list = backupsFor(all, '2026-10-26');
  assert.deepEqual(list.map(b => b.id), ['2026-10-26_300', '2026-10-26_auto', '2026-10-26_100']);
  assert.equal(countManual(all, '2026-10-26'), 2, 'the automatic one does not count');
  assert.deepEqual(backupsFor(all, '2026-12-01'), []); assert.deepEqual(backupsFor(null, '2026-10-26'), []);
});

console.log('\n=== changesSince ===');
test('nothing changed: all zero', () => {
  assert.deepEqual(changesSince(validBackup(make()), ENTRIES, CARS, A), { families: 0, shifts: 0, period: false });
});
test('counts families that handed in, changed or lost their times, per family', () => {
  const b = validBackup(make());
  const entries = { ...ENTRIES, '2026-10-26_f2': entry('2026-10-26', 'f2', '10:30'), '2026-10-26_f4': entry('2026-10-26', 'f4', '09:00') };
  delete entries['2026-10-26_f3'];
  assert.equal(changesSince(b, entries, CARS, A).families, 3, 'one changed, one new, one removed');
  assert.equal(changesSince(b, { ...ENTRIES, '2026-10-26_f2': entry('2026-10-26', 'f2', '09:00', 'Michiel namens ouder') }, CARS, A).families, 0, 'same times, other timestamp or name: no change');
});
test('another period does not count', () => {
  assert.equal(changesSince(validBackup(make()), { ...ENTRIES, '2026-11-09_f9': entry('2026-11-09', 'f9', '10:00') }, { ...CARS }, A).families, 0);
});
test('counts shifts of the temporary rooster that differ, are new or are gone; made-at does not count', () => {
  const b = validBackup(make());
  const cars = { ...CARS, '2026-10-26_2026-10-26_heen': { ...shift('2026-10-26', '2026-10-26', 'heen', 'f9') }, '2026-10-26_2026-10-27_heen': shift('2026-10-26', '2026-10-27', 'heen', 'f1') };
  delete cars['2026-10-26_2026-10-26_terug'];
  assert.equal(changesSince(b, ENTRIES, cars, A).shifts, 3);
  assert.equal(changesSince(b, ENTRIES, { ...CARS, '2026-10-26_2026-10-26_heen': { ...CARS['2026-10-26_2026-10-26_heen'], madeAt: 999, by: 'Iemand anders' } }, A).shifts, 0);
});
test('tells when the period itself (dates, deadline, name) differs, or is gone', () => {
  const b = validBackup(make());
  assert.equal(changesSince(b, ENTRIES, CARS, { ...A, deadlineTime: '18:00' }).period, true);
  assert.equal(changesSince(b, ENTRIES, CARS, null).period, true);
});

console.log('\n=== planRestore ===');
test('writes the period (with its deadline as a moment), every entry and every shift of the back-up', () => {
  const p = planRestore(make(), [], ENTRIES, CARS);
  assert.equal(p.ok, true);
  assert.deepEqual(p.sets[0], ['periods/2026-10-26', { ...A, deadlineAt: new Date('2026-10-16T12:00:00+02:00').getTime() }]);
  assert.deepEqual(p.sets.slice(1).map(s => s[0]).sort(), ['periodCars/2026-10-26_2026-10-26_heen', 'periodCars/2026-10-26_2026-10-26_terug', 'periodEntries/2026-10-26_f2', 'periodEntries/2026-10-26_f3']);
  assert.deepEqual(p.sets.find(s => s[0] === 'periodEntries/2026-10-26_f2')[1], ENTRIES['2026-10-26_f2']);
  assert.deepEqual(p.deletes, []);
});
test('removes what was added after the back-up, and never touches another period', () => {
  const entries = { ...ENTRIES, '2026-10-26_f7': entry('2026-10-26', 'f7', '08:00') };
  const cars = { ...CARS, '2026-10-26_2026-10-27_heen': shift('2026-10-26', '2026-10-27', 'heen', 'f1') };
  const p = planRestore(make(), [], entries, cars);
  assert.deepEqual(p.deletes.sort(), ['periodCars/2026-10-26_2026-10-27_heen', 'periodEntries/2026-10-26_f7']);
  [...p.sets.map(s => s[0]), ...p.deletes].forEach(path => assert.doesNotMatch(path, /2026-11-09/));
});
test('a back-up of a period with nothing handed in clears everything handed in since', () => {
  const p = planRestore(buildPeriodBackup(A, {}, {}, { now: NOW }), [], ENTRIES, CARS);
  assert.equal(p.sets.length, 1); assert.equal(p.deletes.length, 4);
});
test('refused when its dates now share a day with another period, naming that period', () => {
  const p = planRestore(make(), [{ ...B, firstDay: '2026-10-29', lastDay: '2026-11-03' }], ENTRIES, CARS);
  assert.equal(p.ok, false); assert.equal(p.error, 'period.err.overlap'); assert.equal(p.overlap.name, 'Toetsweek');
});
test('a period next to it is fine; a broken back-up is refused', () => {
  assert.equal(planRestore(make(), [B], ENTRIES, CARS).ok, true);
  const p = planRestore({ ...make(), createdAt: null }, [], ENTRIES, CARS);
  assert.equal(p.ok, false); assert.equal(p.error, 'period.backup.err.broken');
  assert.equal(planRestore(null, [], {}, {}).ok, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
