// Run with: node wait-log.test.js
// Wachttijd speelsters: the counting per week / month / year, the summary, "waits clearly more" and the minutes text (pure functions),
// plus the waiting that is written into the ride log document.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { sampleFamilies } from './test-support.js';
import { buildRideLogDoc, newLogDocs } from '../ride-log.js';
import { fmtMinutes, shiftWeekKey, sortWaitRows, waitSummary, waitTally, waitYears, waitsMore } from '../wait-log.js';

const fams = sampleFamilies();
const doc = (date, weekKey, direction, cars) => ({ date, weekKey, day: 'Ma', direction, cars });
const logs = {
  a: doc('2026-09-28', '2026-W40', 'heen', [{ familyId: 'f1', girls: 2, waits: { f2: 10, f3: 30 } }]),
  b: doc('2026-09-28', '2026-W40', 'terug', [{ familyId: 'f2', girls: 2, waits: { f2: 20, f3: 0 } }]),
  c: doc('2026-10-05', '2026-W41', 'heen', [{ familyId: 'f1', girls: 1, waits: { f3: 60 } }]),
  d: doc('2025-12-15', '2025-W51', 'heen', [{ familyId: 'f1', girls: 1, waits: { f2: 5 } }]),
  old: doc('2026-09-29', '2026-W40', 'heen', [{ familyId: 'f1', girls: 3 }]),   // logged before waiting existed: not counted at all
  gone: doc('2026-09-30', '2026-W40', 'heen', [{ familyId: 'f1', girls: 1, removed: true, waits: { f2: 99 } }]),
};

console.log('=== counting ===');
test('a week counts the rides of that week with waiting data; rides without it or removed do not count', () => {
  const rows = waitTally(logs, fams, { weekKey: '2026-W40' });
  const f2 = rows.find(r => r.key === 'f2'), f3 = rows.find(r => r.key === 'f3');
  assert.deepEqual([f2.rides, f2.total, f2.average, f2.longest], [2, 30, 15, 20]);
  assert.deepEqual([f3.rides, f3.total, f3.average], [2, 30, 15]);
  assert.equal(f2.name, fams.f2.girlName);
});
test('heen and terug are averaged apart; null when she has no ride that way', () => {
  const f2 = waitTally(logs, fams, { weekKey: '2026-W40' }).find(r => r.key === 'f2');
  assert.deepEqual([f2.heen, f2.terug], [10, 20]);
  const f3 = waitTally(logs, fams, { weekKey: '2026-W41' }).find(r => r.key === 'f3');
  assert.deepEqual([f3.heen, f3.terug], [60, null]);
});
test('month and year pick the rides by date', () => {
  assert.equal(waitTally(logs, fams, { year: 2026, month: 10 }).length, 1);
  assert.equal(waitTally(logs, fams, { year: 2026, month: 9 }).find(r => r.key === 'f3').total, 30);
  assert.equal(waitTally(logs, fams, { year: 2026 }).find(r => r.key === 'f3').total, 90);
  assert.deepEqual(waitTally(logs, fams, { year: 2025 }).map(r => [r.key, r.total]), [['f2', 5]]);
});
test('a girl that no longer exists shows as ?; nothing in the log gives no rows; bad numbers are ignored', () => {
  assert.equal(waitTally(logs, {}, { year: 2025 })[0].name, '?');
  assert.deepEqual(waitTally({}, fams, { year: 2026 }), []);
  assert.deepEqual(waitTally({ x: doc('2026-09-28', '2026-W40', 'heen', [{ waits: { f1: -5, f2: 'x', f3: NaN } }]) }, fams, { year: 2026 }), []);
});

console.log('=== summary ===');
test('the team: rides, total, average per ride, average total per girl, fewest and most', () => {
  const s = waitSummary(waitTally(logs, fams, { year: 2026 }));
  assert.deepEqual([s.girls, s.rides, s.total, s.average, s.perGirl, s.min, s.max], [2, 5, 120, 24, 60, 30, 90]);
  assert.deepEqual(waitSummary([]), { girls: 0, rides: 0, total: 0, average: 0, perGirl: 0, min: 0, max: 0 });
});
test('sorted by the longest total waiting first, then by name', () => {
  assert.deepEqual(sortWaitRows(waitTally(logs, fams, { year: 2026 })).map(r => r.key), ['f3', 'f2']);
});
test('"waits clearly more": 10 minutes above the team average and at least 3 rides', () => {
  const s = { average: 20 };
  assert.equal(waitsMore({ rides: 3, average: 30 }, s), true);
  assert.equal(waitsMore({ rides: 3, average: 29 }, s), false);
  assert.equal(waitsMore({ rides: 2, average: 60 }, s), false);
});

console.log('=== weeks, years, minutes ===');
test('weeks step over a year end and keep the ISO week keys', () => {
  assert.equal(shiftWeekKey('2026-W40', 1), '2026-W41');
  assert.equal(shiftWeekKey('2026-W01', -1), '2025-W52');
  assert.equal(shiftWeekKey('2026-W53', 1), '2027-W01');
  assert.equal(shiftWeekKey('nonsense', 1), null);
});
test('years with waiting data, newest first, always with this year', () => {
  assert.deepEqual(waitYears(logs, 2026), [2026, 2025]);
  assert.deepEqual(waitYears({}, 2026), [2026]);
});
test('minutes read as people say them', () => {
  assert.deepEqual([0, 40, 60, 95, 120].map(fmtMinutes), ['0 min', '40 min', '1 u', '1 u 35 min', '2 u']);
  assert.equal(fmtMinutes(14.6), '15 min');
});

console.log('=== written into the ride log ===');
const NOW = new Date('2026-09-30T10:00:00+02:00').getTime();
const car = { driverFamilyId: 'f1', girlIds: ['f2', 'f3'], departureTime: '07:30' };
test('a car in the document holds the waiting per girl; without waitsOf or without waiting it holds none', () => {
  const base = { iso: '2026-09-28', day: 'Ma', direction: 'heen', weekKey: '2026-W40', families: fams, nowMs: NOW, cars: [car] };
  assert.deepEqual(buildRideLogDoc({ ...base, waitsOf: c => ({ f2: 10, f3: 0 }) }).cars[0].waits, { f2: 10, f3: 0 });
  assert.equal('waits' in buildRideLogDoc(base).cars[0], false);
  assert.equal('waits' in buildRideLogDoc({ ...base, waitsOf: () => ({}) }).cars[0], false);
});
test('newLogDocs asks for the waiting with the week, day, direction and car', () => {
  const seen = [];
  const out = newLogDocs({ weekKeys: ['2026-W40'], carsOf: (w, d, dir) => d === 'Ma' && dir === 'heen' ? [car] : [], isoOf: (w, d) => d === 'Ma' ? '2026-09-28' : null,
    families: fams, logged: {}, nowMs: NOW, waitsOf: (w, d, dir, c) => { seen.push([w, d, dir, c.driverFamilyId]); return { f2: 5 }; } });
  assert.deepEqual(seen, [['2026-W40', 'Ma', 'heen', 'f1']]);
  assert.deepEqual(out[0][1].cars[0].waits, { f2: 5 });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
