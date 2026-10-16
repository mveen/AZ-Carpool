// Run with: node push-scenarios.test.js
// push-scenarios.js: the made-up situations of "Meldingen testen". They must build exactly the notifications the app builds for real situations
// (same functions), from the point of view of the family the coordinator chose, and must never need a database.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { SCENARIOS, buildScenario, explainBackups, scenarioMoment } from '../push-scenarios.js';
import { backupRecipients, notificationDoc, normalizeQuiet } from '../ritbeurs.js';
import { TEST_NOTIFICATION_MS } from '../push.js';

const NOW = new Date('2026-09-30T10:00:00+02:00').getTime();
const families = { f1: { girlName: 'Saar', parentName: 'Ouder Saar' }, f2: { girlName: 'Noor', parentName: 'Ouder Noor' }, f3: { girlName: 'Lois', parentName: 'Ouder Lois' }, f4: { girlName: 'Eline', parentName: 'Ouder Eline' } };
const ride = (day, date, time, direction = 'heen') => ({ day, direction, date, time });
const RIDES = { f1: [ride('Do', '2026-10-01', '16:15')], f2: [ride('Do', '2026-10-01', '16:30'), ride('Vr', '2026-10-02', '08:00')], f3: [ride('Do', '2026-10-01', '16:45')], f4: [] };
const MOMENTS = {
  m1: { familyId: 'f3', date: '2026-10-01', from: '16:00', to: '17:00', onlyIfFree: false },
  m2: { familyId: 'f4', date: '2026-10-01', from: '16:00', to: '17:00', onlyIfFree: true },
  m3: { familyId: 'f1', date: '2026-10-01', from: '08:00', to: '09:00', onlyIfFree: true },
};
const ctx = (extra = {}) => ({
  personaId: 'f1', families, nowMs: NOW, simMs: NOW, quietOf: () => normalizeQuiet(), ridesOf: id => RIDES[id] || [], moments: MOMENTS,
  busy: (fid, date, time) => fid === 'f4' && date === '2026-10-01' && time === '16:30', dayCoordinatorOf: day => day === 'Do' ? 'f3' : '',
  weekKey: '2026-W40', fallbackRide: ride('Do', '2026-10-01', '16:15'), ...extra,
});

console.log('=== the five situations ===');
test('there are five scenarios, one for each kind of Ritten-ruilen notification', () => {
  assert.deepEqual(SCENARIOS.map(s => s.kind).sort(), ['backupForRide', 'offerBackup', 'taken', 'takenDayCoordinator', 'uncovered']);
});
test('every scenario gives the chosen family its notification, first, of the right kind, made up of the same fields as a real one', () => {
  for (const s of SCENARIOS) {
    const r = buildScenario(s.id, ctx());
    assert.equal(r.error, undefined, s.id); assert.equal(r.kind, s.kind);
    const first = r.rows[0];
    assert.equal(first.toFamilyId, 'f1', s.id); assert.equal(first.persona, true); assert.equal(first.doc.kind, s.kind); assert.equal(first.doc.toFamilyId, 'f1');
    assert.deepEqual(Object.keys(first.doc).sort(), Object.keys(notificationDoc({ kind: s.kind, to: 'f1', sourceId: 'x', nowMs: 1, quiet: normalizeQuiet() })).sort(), s.id);
    assert.match(first.id, new RegExp(`^${s.kind}_test-${s.id}-${NOW}_f1$`)); assert.equal(first.doc.read, false);
  }
});
test('made-up notifications are made now and vanish after a day', () => {
  const r = buildScenario('overgenomen', ctx());
  assert.equal(r.rows[0].doc.createdAt, NOW); assert.equal(r.rows[0].doc.expiresAt, NOW + TEST_NOTIFICATION_MS);
});
test('"een rit komt vrij": another family offers a ride; real back-ups for it get it too, and the chosen family is flagged as real or chosen', () => {
  const r = buildScenario('rijVrij', ctx());
  // f2's first ride (Thu 16:30). Real back-ups: f3 (moment covers, not required to be free) yes; f4 is busy; f1 has no moment covering it.
  assert.equal(r.ride.date, '2026-10-01'); assert.equal(r.ride.time, '16:30');
  assert.deepEqual(r.rows.map(x => [x.toFamilyId, x.persona, x.why]), [['f1', true, 'gekozen'], ['f3', false, 'echt']]);
  assert.equal(r.rows[0].doc.fromFamilyId, 'f2'); assert.equal(r.rows[0].doc.time, '16:30'); assert.equal(r.rows[0].doc.day, 'Do');
  const asBackup = buildScenario('rijVrij', ctx({ personaId: 'f3' }));
  // as f3 the offering family is f1 (16:15): f3's own moment covers it, and f4 is not busy at that time
  assert.deepEqual(asBackup.rows.map(x => [x.toFamilyId, x.why]), [['f3', 'echt'], ['f4', 'echt']]);
});
test('"Wie krijgt dit?" explains every back-up moment, with the same answer as the real rule', () => {
  const offer = { weekKey: '2026-W40', day: 'Do', direction: 'heen', date: '2026-10-01', time: '16:30', offeredBy: 'f2' };
  const busy = fid => ctx().busy(fid, offer.date, offer.time);
  const ex = explainBackups({ offer, moments: MOMENTS, busy });
  assert.deepEqual(ex.map(e => [e.familyId, e.reason]), [['f3', 'ok'], ['f4', 'bezig'], ['f1', 'niet-gedekt']]);
  assert.deepEqual(ex.filter(e => e.receives).map(e => e.familyId), backupRecipients({ offer, moments: MOMENTS, busy }));
  // the offerer's own moment, and a second moment of the same family
  const more = { ...MOMENTS, m4: { familyId: 'f2', date: '2026-10-01', from: '16:00', to: '17:00' }, m5: { familyId: 'f3', date: '2026-10-01', from: '16:00', to: '17:00', onlyIfFree: false } };
  const ex2 = explainBackups({ offer, moments: more, busy });
  assert.deepEqual(ex2.map(e => e.reason), ['ok', 'bezig', 'niet-gedekt', 'eigen-rit', 'dubbel']);
  assert.deepEqual(ex2.filter(e => e.receives).map(e => e.familyId), backupRecipients({ offer, moments: more, busy }));
});
test('"iemand neemt mijn rit over": the chosen family\'s own next ride, taken by another family', () => {
  const r = buildScenario('overgenomen', ctx());
  assert.deepEqual(r.rows.map(x => x.toFamilyId), ['f1']); assert.equal(r.ride.time, '16:15'); assert.equal(r.rows[0].doc.fromFamilyId, 'f2'); assert.equal(r.rows[0].doc.time, '16:15');
});
test('"een back-up meldt zich": every driver inside the moment is warned, the chosen family always', () => {
  const r = buildScenario('backup', ctx());
  assert.equal(r.rows[0].doc.fromFamilyId, 'f2'); assert.equal(r.rows[0].doc.momentFrom, '15:15'); assert.equal(r.rows[0].doc.momentTo, '17:15'); assert.equal(r.rows[0].doc.date, '2026-10-01');
  assert.deepEqual(r.rows.map(x => [x.toFamilyId, x.why]), [['f1', 'echt'], ['f3', 'echt']]);   // f3 drives at 16:45: inside 15:15-17:15
  assert.deepEqual(buildScenario('backup', ctx({ ridesOf: id => id === 'f3' ? [] : RIDES[id] || [] })).rows.map(x => x.toFamilyId), ['f1']);
});
test('"niet gedekt": the chosen family and the day coordinator of that day', () => {
  const r = buildScenario('nietGedekt', ctx());
  assert.deepEqual(r.rows.map(x => [x.toFamilyId, x.persona, x.why]), [['f1', true, 'gekozen'], ['f3', false, 'echt']]);
  assert.equal(r.rows[0].doc.fromFamilyId, '');
  assert.deepEqual(buildScenario('nietGedekt', ctx({ dayCoordinatorOf: () => '' })).rows.map(x => x.toFamilyId), ['f1']);
  assert.deepEqual(buildScenario('nietGedekt', ctx({ dayCoordinatorOf: () => 'f1' })).rows.map(x => x.toFamilyId), ['f1']);
});
test('"ik ben dagcoördinator": the chosen family hears who took the ride over', () => {
  const r = buildScenario('dagcoordinator', ctx());
  assert.deepEqual(r.rows.map(x => x.toFamilyId), ['f1']); assert.notEqual(r.rows[0].doc.fromFamilyId, 'f1'); assert.ok(families[r.rows[0].doc.fromFamilyId]);
});
test('nobody drives anything this week: the ride given in the context is used', () => {
  const r = buildScenario('overgenomen', ctx({ ridesOf: () => [], fallbackRide: ride('Vr', '2026-10-02', '16:15') }));
  assert.equal(r.ride.date, '2026-10-02'); assert.equal(r.rows[0].doc.day, 'Vr');
});
test('a ride that already started is not used', () => {
  const r = buildScenario('overgenomen', ctx({ ridesOf: id => id === 'f1' ? [ride('Di', '2026-09-29', '08:00'), ride('Vr', '2026-10-02', '08:00')] : [] }));
  assert.equal(r.ride.date, '2026-10-02');
});

console.log('\n=== what cannot be made ===');
test('no chosen family, an unknown family or only one family: a clear error and nothing built', () => {
  assert.deepEqual(buildScenario('taken', ctx()), { error: 'geenGezin' });
  assert.deepEqual(buildScenario('overgenomen', ctx({ personaId: '' })), { error: 'geenGezin' });
  assert.deepEqual(buildScenario('overgenomen', ctx({ personaId: 'zz' })), { error: 'geenGezin' });
  assert.deepEqual(buildScenario('overgenomen', ctx({ families: { f1: families.f1 } })), { error: 'geenAnder' });
});

console.log('\n=== pretending it is night ===');
test('the quiet hours of the chosen family decide when a night-time notification is delivered', () => {
  const night = scenarioMoment('nacht', NOW, normalizeQuiet());
  assert.equal(new Date(night).getHours(), 23); assert.equal(new Date(night).getMinutes(), 30); assert.ok(night > NOW);
  const r = buildScenario('overgenomen', ctx({ simMs: night }));
  assert.equal(r.rows[0].doc.deliverAt, new Date('2026-10-01T06:00:00+02:00').getTime()); assert.ok(r.rows[0].doc.deliverAt > NOW);
  assert.equal(r.rows[0].doc.createdAt, NOW);
  assert.equal(buildScenario('overgenomen', ctx()).rows[0].doc.deliverAt, NOW);
});
test('"now" stays now; at night-time it already is quiet, so now is used; custom quiet hours are respected', () => {
  assert.equal(scenarioMoment('nu', NOW, normalizeQuiet()), NOW); assert.equal(scenarioMoment('anders', NOW, normalizeQuiet()), NOW);
  const late = new Date('2026-09-30T23:45:00+02:00').getTime(); assert.equal(scenarioMoment('nacht', late, normalizeQuiet()), late);
  const none = { from: '03:00', to: '03:00' };
  assert.ok(scenarioMoment('nacht', NOW, none) !== NOW);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
