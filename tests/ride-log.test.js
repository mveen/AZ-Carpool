// Run with: node ride-log.test.js
// Gereden shifts: when a shift counts, the stored document, the counts per month / year, the spread and the CSV export (pure functions).
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { sampleFamilies } from './test-support.js';
import { buildRideLogDoc, logYears, newLogDocs, rideLogFileName, rideLogId, ridesCsv, shiftEndMs, shiftList, sortRows, spread, tally, withCarRemoved, yearCsv } from '../ride-log.js';

const fams = sampleFamilies();
const NOW = new Date('2026-09-30T10:00:00+02:00').getTime();
const car = (driver, n = 2, time = '07:30') => ({ driverFamilyId: driver, girlIds: Array.from({ length: n }, (_, i) => 'g' + i), departureTime: time });
const doc = (iso, direction, ...drivers) => ({ date: iso, day: 'Ma', direction, cars: drivers.map(d => ({ familyId: d, name: d, girls: 2 })) });
const logs = {
  a: doc('2026-09-28', 'heen', 'f1'), b: doc('2026-09-28', 'terug', 'f2'), c: doc('2026-10-01', 'heen', 'f1', 'f3'),
  d: doc('2026-10-05', 'terug', 'f1'), e: doc('2025-12-15', 'heen', 'f1'),
};

console.log('=== when a shift counts ===');
test('the id is the date and the direction', () => assert.equal(rideLogId('2026-09-28', 'heen'), '2026-09-28_heen'));
test('a shift is over at the latest departure time of its cars; without a time at the end of that day', () => {
  assert.equal(shiftEndMs('2026-09-28', [car('f1', 2, '07:30'), car('f2', 2, '08:15')]), new Date(2026, 8, 28, 8, 15).getTime());
  assert.equal(shiftEndMs('2026-09-28', [{ driverFamilyId: 'f1', girlIds: ['g'] }]), new Date(2026, 8, 29).getTime());
});
test('a shift that has not taken place yet is not logged (today 17:30 at 10:00), one that has is', () => {
  const base = { iso: '2026-09-30', day: 'Wo', direction: 'terug', weekKey: '2026-W40', families: fams, nowMs: NOW };
  assert.equal(buildRideLogDoc({ ...base, cars: [car('f1', 2, '17:30')] }), null);
  assert.equal(buildRideLogDoc({ ...base, cars: [car('f1', 2, '09:00')] }).cars.length, 1);
});
test('a car without a driver or without girls is not a driven ride', () => {
  const base = { iso: '2026-09-28', day: 'Ma', direction: 'heen', weekKey: '2026-W40', families: fams, nowMs: NOW };
  assert.equal(buildRideLogDoc({ ...base, cars: [{ girlIds: ['g'], departureTime: '07:30' }] }), null);
  assert.equal(buildRideLogDoc({ ...base, cars: [{ driverFamilyId: 'f1', girlIds: [], departureTime: '07:30' }] }), null);
  const d = buildRideLogDoc({ ...base, cars: [car('f1', 3), { girlIds: ['g'] }] });
  assert.deepEqual(d.cars, [{ familyId: 'f1', name: fams.f1.girlName, girls: 3 }]);
});
test('a wrong date or direction gives nothing', () => {
  assert.equal(buildRideLogDoc({ iso: 'x', day: 'Ma', direction: 'heen', cars: [car('f1')], families: fams, nowMs: NOW }), null);
  assert.equal(buildRideLogDoc({ iso: '2026-09-28', day: 'Ma', direction: 'zij', cars: [car('f1')], families: fams, nowMs: NOW }), null);
});
test('newLogDocs walks the weeks, skips shifts already in the log and shifts that are not over', () => {
  const isoOf = (wk, day) => ({ '2026-W40': { Ma: '2026-09-28', Wo: '2026-09-30', Vr: '2026-10-02' } }[wk] || {})[day] || null;
  const carsOf = (wk, day, dir) => (day === 'Ma' ? [car('f1')] : day === 'Wo' && dir === 'terug' ? [car('f2', 2, '17:30')] : day === 'Vr' ? [car('f3')] : []);
  const r = newLogDocs({ weekKeys: ['2026-W40'], carsOf, isoOf, families: fams, logged: { '2026-09-28_terug': {} }, nowMs: NOW });
  assert.deepEqual(r.map(([id]) => id), ['2026-09-28_heen']);
});

console.log('=== counting ===');
test('tally: one row per family, zero for a family that never drove; heen and terug counted apart', () => {
  const rows = tally(logs, fams, { year: 2026 });
  const by = Object.fromEntries(rows.map(r => [r.key, r]));
  assert.equal(Object.keys(fams).length, rows.length);
  assert.deepEqual([by.f1.total, by.f1.heen, by.f1.terug], [3, 2, 1]);
  assert.deepEqual([by.f2.total, by.f3.total, by.f4.total], [1, 1, 0]);
});
test('a month counts only that month; the months array always covers the whole year', () => {
  const by = Object.fromEntries(tally(logs, fams, { year: 2026, month: 9 }).map(r => [r.key, r]));
  assert.equal(by.f1.total, 1); assert.equal(by.f2.total, 1); assert.equal(by.f3.total, 0);
  assert.equal(by.f1.months[8], 1); assert.equal(by.f1.months[9], 2); assert.equal(by.f1.months[11], 0);
});
test('a year sees other years apart, and no period counts everything', () => {
  assert.equal(tally(logs, fams, { year: 2025 }).find(r => r.key === 'f1').total, 1);
  assert.equal(tally(logs, fams).find(r => r.key === 'f1').total, 4);
});
test('a driver of a deleted family stays in the overview with the stored name', () => {
  const rows = tally({ x: { date: '2026-09-28', direction: 'heen', cars: [{ familyId: 'gone', name: 'Oud gezin', girls: 2 }] } }, fams, { year: 2026 });
  const r = rows.find(x => x.key === 'gone');
  assert.equal(r.name, 'Oud gezin'); assert.equal(r.familyId, null); assert.equal(r.total, 1);
});
test('broken documents are ignored', () => {
  const rows = tally({ a: null, b: { date: 'x', cars: [] }, c: { date: '2026-09-28' } }, fams, { year: 2026 });
  assert.equal(rows.reduce((s, r) => s + r.total, 0), 0);
});
test('sortRows: most rides first; spread: total, average, fewest, most, idle', () => {
  const rows = sortRows(tally(logs, fams, { year: 2026 }));
  assert.equal(rows[0].key, 'f1'); assert.ok(rows[rows.length - 1].total === 0);
  const s = spread(rows);
  assert.equal(s.total, 5); assert.equal(s.families, Object.keys(fams).length); assert.equal(s.max, 3); assert.equal(s.min, 0);
  assert.equal(s.idle, Object.keys(fams).length - 3);
  assert.deepEqual(spread([]), { total: 0, families: 0, average: 0, min: 0, max: 0, idle: 0 });
});
test('logYears: years with rides, newest first, always this year', () => {
  assert.deepEqual(logYears(logs, 2026), [2026, 2025]);
  assert.deepEqual(logYears({}, 2026), [2026]);
});

console.log('=== export ===');
test('year CSV: BOM, semicolons, one row per family with 12 months, total, heen, terug', () => {
  const csv = yearCsv(logs, fams, 2026);
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.ok(csv.startsWith('﻿'));
  assert.equal(lines.length, 1 + Object.keys(fams).length);
  assert.equal(lines[0], 'Gezin;Ouder;jan;feb;mrt;apr;mei;jun;jul;aug;sep;okt;nov;dec;Totaal 2026;Heen;Terug');
  const f1 = lines[1].split(';');
  assert.equal(f1.length, 17); assert.deepEqual(f1.slice(10, 12), ['1', '2']); assert.deepEqual(f1.slice(14), ['3', '2', '1']);
});
test('rides CSV: every ride, oldest first, one row per car', () => {
  const lines = ridesCsv(logs, fams).replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Datum;Dag;Richting;Chauffeur (gezin);Ouder;Aantal meiden');
  assert.equal(lines.length, 1 + 6);
  assert.ok(lines[1].startsWith('2025-12-15;Ma;heen;'));
});
test('a name that looks like a formula is made harmless, a name with a semicolon is quoted', () => {
  const f = { x: { girlName: '=HYPERLINK("http://e.x")', parentName: 'A;B' } };
  const csv = yearCsv({}, f, 2026);
  assert.ok(csv.includes('"\'=HYPERLINK(""http://e.x"")"')); assert.ok(csv.includes('"A;B"'));
});
test('file names carry the year or the date', () => {
  assert.equal(rideLogFileName('year', 2026), 'gereden-shifts-2026.csv');
  assert.equal(rideLogFileName('all', 2026, new Date('2026-10-08T10:00:00Z')), 'alle-ritten-2026-10-08.csv');
});

console.log('=== removed rides ===');
const removedOne = () => { const l = structuredClone(logs); l.c = withCarRemoved(l.c, 1, 'f3', true); return l; };
test('withCarRemoved marks one car, keeps the others, leaves the original alone; putting it back drops the mark', () => {
  const d = withCarRemoved(logs.c, 1, 'f3', true);
  assert.deepEqual(d.cars.map(c => !!c.removed), [false, true]);
  assert.equal(logs.c.cars[1].removed, undefined, 'the original is not changed');
  assert.deepEqual(withCarRemoved(d, 1, 'f3', false).cars, logs.c.cars);
});
test('withCarRemoved gives null when the car is not there or belongs to another family', () => {
  assert.equal(withCarRemoved(logs.c, 5, 'f3', true), null);
  assert.equal(withCarRemoved(logs.c, 1, 'f1', true), null);
  assert.equal(withCarRemoved(null, 0, 'f1', true), null);
});
test('a removed ride is not counted: not in the tally, the spread, the years or the CSV', () => {
  const l = removedOne();
  assert.equal(Object.fromEntries(tally(logs, fams, { year: 2026 }).map(r => [r.key, r])).f3.total, 1);
  const by = Object.fromEntries(tally(l, fams, { year: 2026 }).map(r => [r.key, r]));
  assert.equal(by.f3.total, 0); assert.equal(by.f1.total, 3);
  assert.equal(by.f3.months[9], 0, 'the month counts do not include it either');
  assert.equal(spread(tally(l, fams, { year: 2026, month: 10 })).total, 2);
  assert.ok(ridesCsv(logs, fams).includes('Anouk')); assert.ok(!ridesCsv(l, fams).includes('Anouk'));
  const onlyOld = { ...logs, e: withCarRemoved(logs.e, 0, 'f1', true) };
  assert.deepEqual(logYears(logs, 2026), [2026, 2025]); assert.deepEqual(logYears(onlyOld, 2026), [2026]);
});
test('shiftList: newest day first, heen before terug on one day, then by name; only the period asked for', () => {
  const rows = shiftList(logs, fams, { year: 2026, month: 10 });
  assert.deepEqual(rows.map(r => [r.date, r.direction, r.name]), [['2026-10-05', 'terug', 'Eline'], ['2026-10-01', 'heen', 'Anouk'], ['2026-10-01', 'heen', 'Eline']]);
  assert.deepEqual(shiftList({ x: doc('2026-09-28', 'terug', 'f1'), y: doc('2026-09-28', 'heen', 'f2') }, fams, { year: 2026 }).map(r => r.direction), ['heen', 'terug']);
  assert.equal(shiftList(logs, fams, { year: 2025 }).length, 1); assert.equal(shiftList(logs, fams).length, 6);
});
test('shiftList tells where a ride is stored, and removed=true gives only the removed ones', () => {
  const l = removedOne();
  const r = shiftList(l, fams, { year: 2026 }, true);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].id, r[0].index, r[0].familyId, r[0].removed, r[0].girls], ['c', 1, 'f3', true, 2]);
  assert.ok(!shiftList(l, fams, { year: 2026 }).some(x => x.removed));
  assert.equal(shiftList(l, fams, { year: 2026 }).length, 4);
});
test('a family that is no longer in the app still shows with the name stored in the log', () => {
  const r = shiftList({ z: { date: '2026-09-01', direction: 'heen', cars: [{ familyId: 'gone', name: 'Oud gezin', girls: 1 }] } }, fams, {});
  assert.deepEqual([r[0].name, r[0].parent], ['Oud gezin', '']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
