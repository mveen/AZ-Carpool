// Run with: node message-texts.test.js
// The WhatsApp messages are the app's "one tap" output, so their exact wording is pinned here. The first
// group tests the pure builders with hand-made input; the second group tests the wrappers against the
// state of the running app (the expected strings are what the live app produced before the refactor).
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
import { installFakeDom, resetState, sampleParentState, sampleCoordinatorState, withFakeNow, NOW } from './test-support.js';
import {
  dayHeading, activeDeviationDayLabelFrom, buildWhatsAppMessageFrom, buildMyWeekMessageFrom, buildDayMessageFrom,
  reserveAskTextFrom, driverAskTextFrom, buildWhatsAppMessage, buildMyWeekWhatsAppMessage, buildDayWhatsAppMessage,
  activeDeviationDayLabel, waDayLabel, reserveAskText, driverAskText,
} from './message-texts.js';

installFakeDom();
const day = { Ma: new Date(2026, 8, 28), Di: new Date(2026, 8, 29), Wo: new Date(2026, 8, 30), Do: new Date(2026, 9, 1), Vr: new Date(2026, 9, 2) };
const names = { f1: 'Jan', f2: 'Piet' };
const girls = { f1: 'Eline', f2: 'Jahaimy', f3: 'Anouk' };
function ctx(over = {}) {
  return {
    cars: () => [], hasDeviation: () => false, dateFor: d => new Date(day[d]),
    driverName: id => (id ? names[id] || '?' : 'nog geen chauffeur'), girlName: id => girls[id] || id, matchLabel: d => d.teamLabel || '',
    ...over,
  };
}

console.log('=== dayHeading / deviation label ===');
test('dayHeading: capitals plus the date number', () => { assert.equal(dayHeading('Ma', day.Ma), 'MA 28'); });
test('no deviations: "deze week"', () => { assert.equal(activeDeviationDayLabelFrom(ctx()), 'deze week'); });
test('one or more days with a deviation are named in full, joined with "en"', () => {
  assert.equal(activeDeviationDayLabelFrom(ctx({ hasDeviation: (d, dir) => d === 'Di' && dir === 'heen' })), 'Dinsdag');
  assert.equal(activeDeviationDayLabelFrom(ctx({ hasDeviation: d => d === 'Di' || d === 'Vr' })), 'Dinsdag en Vrijdag');
});

console.log('\n=== generic message ===');
test('names the changed days and links to Mijn week', () => {
  assert.equal(buildWhatsAppMessageFrom(ctx({ hasDeviation: d => d === 'Di' })),
    'Het schema is bijgewerkt voor Dinsdag. Zie Mijn week voor de impact: https://mveen.github.io/AZ-Carpool/#myweek');
});

console.log('\n=== Mijn week message ===');
const myFam = { girlName: 'Jahaimy', parentName: 'Piet', schedule: { Ma: { heen: '08:30', terug: '17:30' }, Di: { heen: '10:15', terug: '' }, Wo: { heen: '', terug: '' } } };
test('one line per day with a time; days without any time are left out', () => {
  const text = buildMyWeekMessageFrom(ctx({
    myId: 'f2', myFam, matchRides: [],
    cars: (d, dir) => (d === 'Ma' && dir === 'heen' ? [{ girlIds: ['f1', 'f2'], driverFamilyId: 'f1', departureTime: '07:30' }] : []),
  }));
  assert.equal(text, [
    'Carpool deze week – Jahaimy:',
    'MA 28 — heen: 07:30 met Jan | terug: 17:30 (nog niet ingepland)',
    'DI 29 — heen: 10:15 (nog niet ingepland) | terug: –',
    '',
    'https://mveen.github.io/AZ-Carpool/#myweek',
  ].join('\n'));
});
test('a day with a deviation is marked "(gewijzigd)"', () => {
  const text = buildMyWeekMessageFrom(ctx({ myId: 'f2', myFam, matchRides: [], hasDeviation: (d, dir) => d === 'Di' && dir === 'heen' }));
  assert.match(text, /DI 29 \(gewijzigd\) — heen: 10:15/);
  assert.doesNotMatch(text, /MA 28 \(gewijzigd\)/);
});
test('the car time is used when the car has one, else the girl\'s own time', () => {
  const car = { girlIds: ['f2'], driverFamilyId: 'f1' };
  const text = buildMyWeekMessageFrom(ctx({ myId: 'f2', myFam, matchRides: [], cars: (d, dir) => (d === 'Ma' && dir === 'heen' ? [car] : []) }));
  assert.match(text, /MA 28 — heen: 08:30 met Jan/);
});
test('match rides are sorted into the week by date and described with team, opponent, time and driver', () => {
  const kick = new Date(2026, 9, 3, 10, 30).getTime(); // Saturday
  const text = buildMyWeekMessageFrom(ctx({
    myId: 'f2', myFam, cars: () => [],
    matchRides: [{ doc: { startMs: kick, summary: 'AZ O15-1-Hoorn O15-2', teamLabel: 'AZ O15-1' }, car: { departureTime: '09:15', driverFamilyId: 'f1' } }],
  }));
  const lines = text.split('\n');
  assert.equal(lines[lines.length - 3], 'ZA 3 — wedstrijd AZ O15-1 vs Hoorn O15-2: vertrek 09:15 met Jan');
});
test('nothing planned at all: says so instead of an empty list', () => {
  const text = buildMyWeekMessageFrom(ctx({ myId: 'f9', myFam: { girlName: 'Nieuw', schedule: {} }, matchRides: [] }));
  assert.equal(text, 'Carpool deze week – Nieuw:\nGeen ritten ingesteld deze week.\n\nhttps://mveen.github.io/AZ-Carpool/#myweek');
});

console.log('\n=== one-day message (Wijzigen) ===');
test('lists every car of the day per direction, earliest first, with driver and passengers', () => {
  const cars = { heen: [{ girlIds: ['f3'], driverFamilyId: 'f2', departureTime: '08:00' }, { girlIds: ['f1', 'f2'], driverFamilyId: 'f1', departureTime: '07:30' }], terug: [] };
  const text = buildDayMessageFrom(ctx({ cars: (d, dir) => cars[dir], hasDeviation: (d, dir) => dir === 'heen' }), 'Ma');
  assert.equal(text, [
    'Aangepast schema Maandag 28 sep:', '',
    'Heen · Aalsmeer → Alkmaar (aangepast):', '• 07:30 – Jan: Eline, Jahaimy', '• 08:00 – Piet: Anouk', '',
    'Terug · Alkmaar → Aalsmeer:', '• geen ritten', '',
    'https://mveen.github.io/AZ-Carpool/#myweek',
  ].join('\n'));
});
test('a car without driver or time is still listed', () => {
  const text = buildDayMessageFrom(ctx({ cars: (d, dir) => (dir === 'heen' ? [{ girlIds: ['f1'], driverFamilyId: null }] : []) }), 'Di');
  assert.match(text, /• --:-- – nog geen chauffeur: Eline/);
});
test('cars without passengers are not listed', () => {
  const text = buildDayMessageFrom(ctx({ cars: () => [{ girlIds: [], driverFamilyId: 'f1' }] }), 'Di');
  assert.equal((text.match(/• geen ritten/g) || []).length, 2);
});

console.log('\n=== "can you drive?" asks ===');
test('reserve ask names direction, date and time', () => {
  assert.equal(reserveAskTextFrom('maandag 28 september', 'heen', '07:30'), 'Hi! Zou jij de rit heen van maandag 28 september om 07:30 kunnen doen?');
  assert.equal(reserveAskTextFrom('maandag 28 september', 'terug', ''), 'Hi! Zou jij de rit terug van maandag 28 september om ? kunnen doen?');
});
test('driver reminder ends with a space so the coordinator can keep typing', () => {
  assert.equal(driverAskTextFrom('maandag 28 september', '07:30'), 'Hi! Je rijdt de rit van maandag 28 september om 07:30. ');
});

console.log('\n=== wrappers over the running app state (regression: exact text of the live app) ===');
test('parent view: Mijn week message', () => {
  sampleParentState();
  withFakeNow(NOW, () => assert.equal(buildMyWeekWhatsAppMessage(), [
    'Carpool deze week – Jahaimy:',
    'MA 28 — heen: 07:30 met Jan Jansen | terug: 17:30 met Piet Pieters',
    'DI 29 (gewijzigd) — heen: 10:15 (nog niet ingepland) | terug: 17:30 (nog niet ingepland)',
    'DO 1 — heen: 10:15 (nog niet ingepland) | terug: 18:00 (nog niet ingepland)',
    'VR 2 — heen: 11:00 (nog niet ingepland) | terug: 17:00 (nog niet ingepland)',
    '', 'https://mveen.github.io/AZ-Carpool/#myweek',
  ].join('\n')));
});
test('coordinator view: one-day message for Monday', () => {
  sampleCoordinatorState();
  withFakeNow(NOW, () => assert.equal(buildDayWhatsAppMessage('Ma'), [
    'Aangepast schema Maandag 28 sep:', '',
    'Heen · Aalsmeer → Alkmaar:', '• 07:30 – Jan Jansen: Eline, Jahaimy', '',
    'Terug · Alkmaar → Aalsmeer:', '• 17:30 – Piet Pieters: Eline, Jahaimy, Saar', '',
    'https://mveen.github.io/AZ-Carpool/#myweek',
  ].join('\n')));
});
test('generic message and helpers follow the current deviations', () => {
  sampleCoordinatorState();
  withFakeNow(NOW, () => {
    assert.equal(activeDeviationDayLabel(), 'Dinsdag');
    assert.match(buildWhatsAppMessage(), /^Het schema is bijgewerkt voor Dinsdag\./);
    assert.equal(waDayLabel('Wo'), 'WO 30');
    assert.equal(reserveAskText('Ma', 'heen', '07:30'), 'Hi! Zou jij de rit heen van maandag 28 september om 07:30 kunnen doen?');
    assert.equal(driverAskText('Ma', '07:30'), 'Hi! Je rijdt de rit van maandag 28 september om 07:30. ');
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
