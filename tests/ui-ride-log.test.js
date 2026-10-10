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
import { logPassedShifts, setRideRemoved } from '../data.js';
import { tally } from '../ride-log.js';
import { rideLogCardHtml, rideLogView, stepRideLog, exportRideLog, wireRideLogCard, showRideLogScreen, askRemoveRide, changeRide } from '../ui-ride-log.js';

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

console.log('=== the screens: family and all shifts ===');
const viewOf = (screen, extra = {}) => ({ mode: 'month', year: 2026, month: 9, screen, ...extra });
test('the overview opens a family (a real button per family) and the all-shifts screen', () => {
  sampleCoordinatorState({ rideLog: rideLog() });
  const h = rideLogCardHtml(NOW);
  assert.match(h, /<button type="button" class="rideLogOpen" data-rlfam="f1" aria-label="Toon shifts van Eline"/);
  assert.ok(h.includes('data-rlall')); assert.match(text(h), /Alle shifts bekijken/); assert.match(text(h), /Tik op een gezin/);
});
test('rideLogView only knows the screens family (with a family) and all', () => {
  sampleCoordinatorState({ rideLog: {}, rideLogView: viewOf('family', { familyKey: 'f1' }) });
  assert.deepEqual(rideLogView(NOW), viewOf('family', { familyKey: 'f1' }));
  sampleCoordinatorState({ rideLog: {}, rideLogView: viewOf('family') });
  assert.equal(rideLogView(NOW).screen, undefined, 'a family screen without a family is the overview');
  sampleCoordinatorState({ rideLog: {}, rideLogView: viewOf('nonsense') });
  assert.equal(rideLogView(NOW).screen, undefined);
  sampleCoordinatorState({ rideLog: {}, rideLogView: viewOf('all') });
  assert.equal(rideLogView(NOW).screen, 'all');
});
test('the family screen lists only that family\'s rides of the period, each with a remove button that says which ride', () => {
  sampleCoordinatorState({ rideLog: rideLog(), rideLogView: viewOf('family', { familyKey: 'f1' }) });
  const h = rideLogCardHtml(NOW), s = text(h);
  assert.match(s, /Eline/); assert.match(s, /1 shifts · 1 heen · 0 terug/); assert.match(s, /ma 28 sep/); assert.match(s, /heen/);
  assert.ok(h.includes('data-rlremove data-rlid="a" data-rlidx="0" data-rlfid="f1"'));
  assert.equal((h.match(/data-rlremove/g) || []).length, 1, 'not the ride of f2, not the one of August');
  assert.match(h, /aria-label="Verwijder shift Eline, ma 28 sep, heen"/);
  assert.ok(h.includes('data-rlback'));
});
test('the family screen of a family without rides says so', () => {
  sampleCoordinatorState({ rideLog: rideLog(), rideLogView: viewOf('family', { familyKey: 'f4' }) });
  const s = text(rideLogCardHtml(NOW));
  assert.match(s, /0 shifts · 0 heen · 0 terug/); assert.match(s, /Geen shifts in deze periode/);
});
test('the all-shifts screen: every ride of the period by day, heen before terug, with the number of shifts', () => {
  sampleCoordinatorState({ rideLog: rideLog(), rideLogView: viewOf('all') });
  const h = rideLogCardHtml(NOW), s = text(h);
  assert.match(s, /Alle shifts/); assert.match(s, /2 shifts · nieuwste eerst/); assert.match(s, /ma 28 sep/);
  assert.equal((h.match(/data-rlremove/g) || []).length, 2);
  assert.ok(h.indexOf('data-rlfid="f1"') < h.indexOf('data-rlfid="f2"'), 'heen (f1) is above terug (f2)');
});
test('year mode on the all-shifts screen shows the rides of the whole year', () => {
  sampleCoordinatorState({ rideLog: rideLog(), rideLogView: viewOf('all', { mode: 'year' }) });
  assert.match(text(rideLogCardHtml(NOW)), /3 shifts · nieuwste eerst/);
});
test('removed rides are listed apart with a restore button and are not in the counts', () => {
  const l = rideLog(); l.a = { ...l.a, cars: [{ ...l.a.cars[0], removed: true }] };
  sampleCoordinatorState({ rideLog: l, rideLogView: viewOf('family', { familyKey: 'f1' }) });
  const h = rideLogCardHtml(NOW), s = text(h);
  assert.match(s, /0 shifts · 0 heen · 0 terug/); assert.match(s, /Verwijderd \(1\)/); assert.match(s, /telt niet mee/);
  assert.ok(h.includes('data-rlrestore data-rlid="a" data-rlidx="0" data-rlfid="f1"')); assert.ok(!h.includes('data-rlremove'));
  sampleCoordinatorState({ rideLog: l, rideLogView: null });
  assert.match(text(rideLogCardHtml(NOW)), /1 shifts gereden/, 'the overview does not count it either');
});
test('names stay escaped on the shift lists', () => {
  sampleCoordinatorState({ rideLog: { x: { date: '2026-09-02', direction: 'heen', cars: [{ familyId: 'gone', name: '<img src=x>', girls: 1 }] } }, rideLogView: viewOf('all') });
  const h = rideLogCardHtml(NOW);
  assert.ok(!h.includes('<img src=x>')); assert.match(h, /&lt;img src=x&gt;/); assert.match(text(h), /1 meid/);
});
test('stepping keeps the screen; showRideLogScreen goes to a family, to all, and back', () => {
  sampleCoordinatorState({ rideLog: {}, rideLogView: viewOf('family', { familyKey: 'f1' }) });
  stepRideLog(-1, NOW);
  assert.deepEqual([S.rideLogView.screen, S.rideLogView.familyKey, S.rideLogView.month], ['family', 'f1', 8]);
  showRideLogScreen('all', undefined, NOW); assert.equal(S.rideLogView.screen, 'all'); assert.equal(S.rideLogView.familyKey, undefined);
  showRideLogScreen('family', 'f2', NOW); assert.deepEqual([S.rideLogView.screen, S.rideLogView.familyKey], ['family', 'f2']);
  showRideLogScreen(null, undefined, NOW); assert.equal(S.rideLogView.screen, undefined); assert.equal(S.rideLogView.month, 8, 'the period is kept');
});
test('asking to remove opens a sheet with the ride and what changes; an unknown ride opens nothing', () => {
  sampleCoordinatorState({ rideLog: rideLog(), rideLogView: viewOf('family', { familyKey: 'f1' }) });
  dom.doc.body.appendChild = c => { dom.doc.body.children.push(c); return c; };   // the export test above replaced it
  dom.doc.body.children.length = 0;
  askRemoveRide('a', 0, 'f1', NOW);
  const html = dom.doc.body.children.at(-1).innerHTML, s = text(html);
  assert.match(html, /role="dialog"/); assert.match(s, /Deze shift verwijderen\?/); assert.match(s, /ma 28 sep · heen · Eline/);
  assert.match(s, /van 1 naar 0 shifts in september 2026/); assert.match(s, /Verwijder shift/); assert.doesNotMatch(s, /Annuleren/);   // design v2: sheets close by tapping outside
  dom.doc.body.children.length = 0;
  askRemoveRide('nope', 0, 'f1', NOW); askRemoveRide('a', 0, 'f2', NOW);
  assert.equal(dom.doc.body.children.length, 0);
});

console.log('=== removing and restoring ===');
await testAsync('a removed ride is stored, stops counting, is not logged again by logPassedShifts, and comes back on restore', async () => {
  const fake = useFakeDb(sampleDbSeed());
  sampleCoordinatorState({ rideLog: {}, rideLogLoaded: true, deviationsLoaded: true });
  await logPassedShifts();
  const id = '2026-09-28_heen', count = () => Object.fromEntries(tally(S.rideLog, S.families, { year: 2026, month: 9 }).map(r => [r.key, r.total])).f1;
  const before = count();
  assert.equal(await changeRide(id, 0, 'f1', true), true);
  assert.equal(fake.get('rideLog/' + id).cars[0].removed, true, 'stored');
  assert.equal(count(), before - 1);
  assert.match(dom.el('toast').innerHTML, /Shift verwijderd/);
  assert.equal(await logPassedShifts(), 0, 'the shift is not logged again');
  assert.equal(fake.get('rideLog/' + id).cars[0].removed, true);
  assert.equal(await changeRide(id, 0, 'f1', false), true);
  assert.equal(fake.get('rideLog/' + id).cars[0].removed, undefined);
  assert.equal(count(), before); assert.match(dom.el('toast').innerHTML, /Shift teruggezet/);
});
await testAsync('a ride that is not there (another family at that place, unknown shift) is refused, nothing is stored', async () => {
  const fake = useFakeDb(sampleDbSeed());
  sampleCoordinatorState({ rideLog: {}, rideLogLoaded: true, deviationsLoaded: true });
  await logPassedShifts();
  const stored = JSON.stringify(fake.collection('rideLog'));
  assert.equal(await changeRide('2026-09-28_heen', 0, 'f9', true), false);
  assert.equal(await changeRide('2026-09-28_heen', 7, 'f1', true), false);
  assert.equal(await changeRide('1999-01-01_heen', 0, 'f1', true), false);
  assert.match(dom.el('toast').innerHTML, /Opslaan mislukt/);
  assert.equal(JSON.stringify(fake.collection('rideLog')), stored);
});
await testAsync('a parent cannot remove a ride', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'rideLog/2026-09-28_heen': doc('2026-09-28', 'heen', 'f1') });
  sampleParentState({ rideLog: { '2026-09-28_heen': doc('2026-09-28', 'heen', 'f1') } });
  assert.equal(await setRideRemoved('2026-09-28_heen', 0, 'f1', true), false);
  assert.equal(fake.get('rideLog/2026-09-28_heen').cars[0].removed, undefined);
});

test('design v2: ui-ride-log.js only uses variables from tokens.css in its inline styles', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../ui-ride-log.js', import.meta.url), 'utf8');
  const tokens = fs.readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
  const unknown = [...src.matchAll(/var\((--[\w-]+)\)/g)].map(x => x[1]).filter(v => !tokens.includes(v + ':'));
  assert.deepEqual(unknown, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
