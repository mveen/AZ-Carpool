// Run with: node ui-ride-log.test.js
// Gereden shifts: the Beheer card (month / year view, stepping, export) and the coordinator's app writing the log (logPassedShifts).
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, useFakeDb, sampleDbSeed, sampleCoordinatorState, sampleParentState } from './test-support.js';
import { S } from '../state.js';
import { logPassedShifts } from '../data.js';
import { rideLogCardHtml, rideLogView, stepRideLog, exportRideLog, wireRideLogCard } from '../ui-ride-log.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const NOW = new Date('2026-09-30T10:00:00+02:00');
const doc = (iso, direction, ...drivers) => ({ date: iso, day: 'Ma', direction, cars: drivers.map(d => ({ familyId: d, name: d, girls: 2 })) });
const rideLog = () => ({ a: doc('2026-09-28', 'heen', 'f1'), b: doc('2026-09-28', 'terug', 'f2'), c: doc('2026-08-03', 'heen', 'f1'), d: doc('2025-12-15', 'heen', 'f3') });

console.log('=== the card ===');
test('starts on the current month; shows each family with heen, terug, total and the year to date', () => {
  sampleCoordinatorState({ rideLog: rideLog() });
  assert.deepEqual(rideLogView(NOW), { mode: 'month', year: 2026, month: 9 });
  const s = text(rideLogCardHtml(NOW));
  assert.match(s, /Gereden shifts/); assert.match(s, /september 2026/);
  assert.match(s, /2 shifts gereden/); assert.match(s, /minst 0, meest 1/);
  assert.match(s, /Jaar/);
});
test('year mode: totals of the year, no year column', () => {
  sampleCoordinatorState({ rideLog: rideLog(), rideLogView: { mode: 'year', year: 2026 } });
  const h = rideLogCardHtml(NOW), s = text(h);
  assert.match(s, /3 shifts gereden/); assert.match(s, /2026/); assert.ok(!/<th scope="col">Jaar<\/th>/.test(h));
});
test('a family that has not driven in the period is flagged', () => {
  sampleCoordinatorState({ rideLog: rideLog() });
  assert.match(text(rideLogCardHtml(NOW)), /gezinnen nog niet gereden/);
});
test('empty log: says that nothing is stored yet, and the month still shows', () => {
  sampleCoordinatorState({ rideLog: {} });
  const s = text(rideLogCardHtml(NOW));
  assert.match(s, /nog niets vastgelegd/); assert.match(s, /0 shifts gereden/);
});
test('the year list holds the years that have rides', () => {
  sampleCoordinatorState({ rideLog: rideLog() });
  const h = rideLogCardHtml(NOW);
  assert.match(h, /<option value="2026" selected>/); assert.match(h, /<option value="2025">/);
});
test('names are escaped', () => {
  sampleCoordinatorState({ rideLog: {}, families: { x: { girlName: '<img src=x>', parentName: 'P' } } });
  assert.ok(!rideLogCardHtml(NOW).includes('<img src=x>'));
});
test('the buttons for month / year and for the two exports exist', () => {
  sampleCoordinatorState({ rideLog: {} });
  const h = rideLogCardHtml(NOW);
  for (const id of ['data-rlmode="month"', 'data-rlmode="year"', 'id="rideLogExportYear"', 'id="rideLogExportAll"']) assert.ok(h.includes(id), id);
  assert.match(text(h), /Export 2026 \(CSV\)/);
});

console.log('=== stepping ===');
test('stepping back from January goes to December of the year before; forward again returns', () => {
  sampleCoordinatorState({ rideLog: {}, rideLogView: { mode: 'month', year: 2026, month: 1 } });
  stepRideLog(-1, NOW);
  assert.deepEqual([S.rideLogView.year, S.rideLogView.month], [2025, 12]);
  stepRideLog(1, NOW);
  assert.deepEqual([S.rideLogView.year, S.rideLogView.month], [2026, 1]);
});
test('in year mode stepping moves one year', () => {
  sampleCoordinatorState({ rideLog: {}, rideLogView: { mode: 'year', year: 2026 } });
  stepRideLog(-1, NOW);
  assert.equal(S.rideLogView.year, 2025);
});

console.log('=== export ===');
test('the export makes a download with the year CSV and shows a toast', () => {
  sampleCoordinatorState({ rideLog: rideLog() });
  let made = null;
  const a = { click() { made = { href: a.href, name: a.download }; }, remove() {} };
  const realCreate = globalThis.document.createElement, realUrl = globalThis.URL.createObjectURL;
  globalThis.document.createElement = () => a;
  globalThis.document.body.appendChild = () => {};
  let blob = null;
  globalThis.URL.createObjectURL = b => { blob = b; return 'blob:x'; };
  try { exportRideLog('year', NOW); exportRideLog('all', NOW); } finally { globalThis.document.createElement = realCreate; globalThis.URL.createObjectURL = realUrl; }
  assert.equal(made.name, 'alle-ritten-2026-09-30.csv');
  assert.ok(blob && blob.size > 50);
  assert.match(dom.el('toast').innerHTML, /Bestand gemaakt/);
});

console.log('=== writing the log ===');
await testAsync('the coordinator\'s app stores every shift of last week and this week that has taken place, once', async () => {
  const fake = useFakeDb(sampleDbSeed());
  sampleCoordinatorState({ rideLog: {}, rideLogLoaded: true, deviationsLoaded: true });
  const n = await logPassedShifts();
  const stored = fake.collection('rideLog');
  // Last week: the standard rooster (Ma heen f1, Ma terug f2). This week: the same, plus the one-off change on Di heen (family f3).
  assert.deepEqual(stored.map(([id]) => id), ['2026-09-21_heen', '2026-09-21_terug', '2026-09-28_heen', '2026-09-28_terug', '2026-09-29_heen']);
  assert.equal(n, 5);
  assert.deepEqual(stored.find(([id]) => id === '2026-09-29_heen')[1].cars.map(c => c.familyId), ['f3']);
  assert.equal(stored.find(([id]) => id === '2026-09-28_terug')[1].cars[0].familyId, 'f2');
  assert.equal(await logPassedShifts(), 0, 'a second run adds nothing');
  assert.equal(Object.keys(S.rideLog).length, 5);
});
await testAsync('nothing is written before the log and the deviations have been read, or by a parent', async () => {
  let fake = useFakeDb(sampleDbSeed());
  sampleCoordinatorState({ rideLog: {}, rideLogLoaded: false, deviationsLoaded: true });
  assert.equal(await logPassedShifts(), 0);
  sampleCoordinatorState({ rideLog: {}, rideLogLoaded: true, deviationsLoaded: false });
  assert.equal(await logPassedShifts(), 0);
  sampleParentState({ rideLog: {}, rideLogLoaded: true, deviationsLoaded: true });
  assert.equal(await logPassedShifts(), 0);
  assert.equal(fake.collection('rideLog').length, 0);
});
await testAsync('shifts already in the log are left alone (a correction by the coordinator stays)', async () => {
  const fake = useFakeDb(sampleDbSeed());
  const corrected = { date: '2026-09-28', day: 'Ma', direction: 'heen', cars: [{ familyId: 'f4', name: 'x', girls: 1 }] };
  sampleCoordinatorState({ rideLog: { '2026-09-28_heen': corrected }, rideLogLoaded: true, deviationsLoaded: true });
  await logPassedShifts();
  assert.equal(fake.get('rideLog/2026-09-28_heen'), undefined, 'not rewritten');
  assert.equal(fake.collection('rideLog').length, 4);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
