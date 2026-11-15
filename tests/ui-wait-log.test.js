// Run with: node ui-wait-log.test.js
// Wachttijd speelsters: the Beheer card (week / month / year view, stepping, the sentence about who waits more).
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, useFakeDb, sampleDbSeed, sampleCoordinatorState } from './test-support.js';
import { logPassedShifts } from '../data.js';
import { S } from '../state.js';
import { waitLogCardHtml, waitLogView, stepWaitLog, wireWaitLogCard } from '../ui-wait-log.js';

installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const NOW = new Date('2026-09-30T10:00:00+02:00');   // week 40
const doc = (date, weekKey, direction, waits) => ({ date, weekKey, day: 'Ma', direction, cars: [{ familyId: 'f1', name: 'x', girls: Object.keys(waits).length, waits }] });
// f2 waits a lot (3 rides, average 40), f3 little (3 rides, average 10)
const rideLog = () => ({
  a: doc('2026-09-28', '2026-W40', 'heen', { f2: 60, f3: 10 }), b: doc('2026-09-28', '2026-W40', 'terug', { f2: 30, f3: 10 }),
  c: doc('2026-09-29', '2026-W40', 'heen', { f2: 30, f3: 10 }), d: doc('2026-10-05', '2026-W41', 'heen', { f3: 20 }),
});

console.log('=== the card ===');
test('starts on the current month and shows the girls with rides, total and average, the longest waiter first', () => {
  sampleCoordinatorState({ rideLog: rideLog() });
  assert.deepEqual(waitLogView(NOW), { mode: 'month', weekKey: '2026-W40', year: 2026, month: 9 });
  const h = waitLogCardHtml(NOW), s = text(h);
  assert.match(s, /Wachttijd speelsters/); assert.match(s, /september 2026/);
  assert.match(s, /6 ritten · gemiddeld 25 min per rit · gemiddeld 1 u 15 min per speelster/);
  assert.ok(h.indexOf('Jahaimy') < h.indexOf('Anouk'), 'f2 (longest) before f3');
  assert.match(s, /2 u 40 min/);
});
test('says clearly who waits more than the rest (10 minutes above the average, from 3 rides), and that nobody does when nobody does', () => {
  sampleCoordinatorState({ rideLog: rideLog() });
  assert.match(text(waitLogCardHtml(NOW)), /1 speelster wacht duidelijk langer dan de rest: Jahaimy\./);
  sampleCoordinatorState({ rideLog: { a: doc('2026-09-28', '2026-W40', 'heen', { f2: 20, f3: 20 }), b: doc('2026-09-29', '2026-W40', 'heen', { f2: 20, f3: 20 }), c: doc('2026-09-30', '2026-W40', 'heen', { f2: 20, f3: 20 }) } });
  assert.match(text(waitLogCardHtml(NOW)), /Geen speelster wacht duidelijk langer dan de rest\./);
});
test('week mode shows one week with its number and dates; year mode the whole year', () => {
  sampleCoordinatorState({ rideLog: rideLog(), waitLogView: { mode: 'week', weekKey: '2026-W41' } });
  let s = text(waitLogCardHtml(NOW));
  assert.match(s, /Week 41/); assert.match(s, /1 ritten · gemiddeld 20 min per rit/);
  sampleCoordinatorState({ rideLog: rideLog(), waitLogView: { mode: 'year', year: 2026 } });
  s = text(waitLogCardHtml(NOW)); assert.match(s, /7 ritten/); assert.match(s, /2026/);
});
test('rides without waiting data: the card says nothing is stored yet, with no table', () => {
  sampleCoordinatorState({ rideLog: { a: { date: '2026-09-28', weekKey: '2026-W40', direction: 'heen', cars: [{ familyId: 'f1', girls: 2 }] } } });
  const h = waitLogCardHtml(NOW);
  assert.match(text(h), /nog geen wachttijd vastgelegd/); assert.ok(!/<table/.test(h));
});
test('a period without rides says so, while the log has data elsewhere', () => {
  sampleCoordinatorState({ rideLog: rideLog(), waitLogView: { mode: 'month', year: 2026, month: 1 } });
  const s = text(waitLogCardHtml(NOW));
  assert.match(s, /Geen wachttijd vastgelegd in deze periode/); assert.ok(!/nog geen wachttijd vastgelegd/.test(s));
});
test('the card has no inline style (new code uses classes)', () => {
  sampleCoordinatorState({ rideLog: rideLog() });
  assert.ok(!/style="/.test(waitLogCardHtml(NOW).replace(/<svg[\s\S]*?<\/svg>/g, '')));
});

console.log('=== stepping ===');
test('month steps wrap over the year; week steps over the year end; year steps by one', () => {
  sampleCoordinatorState({ rideLog: {}, waitLogView: { mode: 'month', year: 2026, month: 1 } });
  stepWaitLog(-1, NOW); assert.deepEqual([S.waitLogView.year, S.waitLogView.month], [2025, 12]);
  stepWaitLog(1, NOW); stepWaitLog(1, NOW); assert.deepEqual([S.waitLogView.year, S.waitLogView.month], [2026, 1].map((v, i) => i ? 2 : v));
  S.waitLogView = { mode: 'week', weekKey: '2026-W01' }; stepWaitLog(-1, NOW); assert.equal(S.waitLogView.weekKey, '2025-W52');
  S.waitLogView = { mode: 'year', year: 2026 }; stepWaitLog(-1, NOW); assert.equal(S.waitLogView.year, 2025);
});
test('the buttons switch the mode and step', () => {
  sampleCoordinatorState({ rideLog: rideLog() });
  const modes = ['week', 'year'].map(m => ({ dataset: { wlmode: m } })), steps = [{ dataset: { wlstep: '1' } }];
  document.querySelectorAll = sel => sel === '[data-wlmode]' ? modes : sel === '[data-wlstep]' ? steps : [];
  wireWaitLogCard();
  modes[0].onclick(); assert.equal(S.waitLogView.mode, 'week');
  const was = S.waitLogView.weekKey; steps[0].onclick();
  assert.equal(S.waitLogView.mode, 'week'); assert.notEqual(S.waitLogView.weekKey, was);
  modes[1].onclick(); assert.equal(S.waitLogView.mode, 'year');
});

console.log('=== the coordinator\'s app writes the waiting into the log ===');
try {
  const fake = useFakeDb(sampleDbSeed());
  sampleCoordinatorState({ rideLog: {}, rideLogLoaded: true, deviationsLoaded: true });
  await logPassedShifts();
  const cars = fake.collection('rideLog').flatMap(([, d]) => d.cars);
  assert.ok(cars.length >= 5);
  assert.ok(cars.every(c => c.waits && Object.keys(c.waits).length === c.girls && Object.values(c.waits).every(w => Number.isInteger(w) && w >= 0)), 'every car holds the waiting of each of its girls');
  assert.match(text(waitLogCardHtml(new Date('2026-09-30T10:00:00+02:00'))), /Wachttijd speelsters/);
  passed++; console.log('  ✓ logPassedShifts stores the waiting per girl, and the card can show it');
} catch (e) { failed++; console.log('  ✗ logPassedShifts stores the waiting per girl\n     ', e.message); }

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
