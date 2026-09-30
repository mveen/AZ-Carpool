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
import { installFakeDom, resetState, sampleParentState, sampleCoordinatorState, withFakeNow, NOW, oneP } from './test-support.js';
import {
  dayHeading, activeDeviationDayLabelFrom, buildWhatsAppMessageFrom, buildMyWeekMessageFrom, buildDayMessageFrom,
  reserveAskTextFrom, driverAskTextFrom, buildWhatsAppMessage, buildMyWeekWhatsAppMessage, buildDayWhatsAppMessage,
  activeDeviationDayLabel, waDayLabel, reserveAskText, driverAskText,
} from '../message-texts.js';

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

import { buildConclusieFrom, buildConclusieMessage } from '../message-texts.js';

console.log('\n=== conclusie-appje (US-03) ===');
const grp = (driverFamilyId, girlIds, departureTime = '07:30') => ({ driverFamilyId, girlIds, departureTime });
function conclCtx(base, eff) {
  return ctx({ baseCars: (d, dir) => (base[d + '_' + dir] || []), cars: (d, dir) => (eff[d + '_' + dir] || base[d + '_' + dir] || []) });
}
const CURL = 'https://mveen.github.io/AZ-Carpool/#myweek';
test('no deviations: "<Dag>: volgens schema" plus the Mijn week link', () => {
  const base = { Do_heen: [grp('f1', ['f1', 'f2'])] };
  assert.equal(buildConclusieFrom(conclCtx(base, {}), 'Do'), 'Donderdag: volgens schema. Zie Mijn week: ' + CURL);
});
test('a deviation that ends up equal to the standard rooster is still "volgens schema"', () => {
  const base = { Do_heen: [grp('f1', ['f1', 'f2'])] };
  assert.equal(buildConclusieFrom(conclCtx(base, { Do_heen: [grp('f1', ['f1', 'f2'])] }), 'Do'), 'Donderdag: volgens schema. Zie Mijn week: ' + CURL);
});
test('changes first, then the full day schedule; kinds without entries are left out; day name is lowercase mid-sentence', () => {
  const base = { Do_heen: [grp('f1', ['f1', 'f2'])] };
  const out = buildConclusieFrom(conclCtx(base, { Do_heen: [grp('f1', ['f1'])] }), 'Do');
  assert.equal(out, [
    'Rijdt niet mee heen: Jahaimy',
    '',
    'Aangepast schema donderdag 1 okt',
    'Heen · Aalsmeer → Alkmaar (aangepast):',
    '• 07:30 – Jan: Eline',
    'Terug · Alkmaar → Aalsmeer:',
    '• geen ritten',
    '',
    CURL,
  ].join('\n'));
  assert.doesNotMatch(out, /Gewijzigde|ook mee/);
});
test('the five kinds of change come in the agreed order', () => {
  const base = { Ma_heen: [grp('f1', ['f1', 'f2'])], Ma_terug: [grp('f1', ['f1', 'f3'], '17:00')] };
  const eff = { Ma_heen: [grp('f1', ['f1', 'f3'])], Ma_terug: [grp('f1', ['f1', 'f2'], '17:30')] };
  const lines = buildConclusieFrom(conclCtx(base, eff), 'Ma').split('\n');
  assert.deepEqual(lines.slice(0, 6), [
    'Rijdt niet mee heen: Jahaimy',
    'Rijdt niet mee terug: Anouk',
    'Gewijzigde chauffeur/tijd: terug Jan 17:30',
    'Rijdt ook mee heen: Anouk',
    'Rijdt ook mee terug: Jahaimy',
    '',
  ]);
  assert.equal(lines[6], 'Aangepast schema maandag 28 sep');
  assert.equal(lines[7], 'Heen · Aalsmeer → Alkmaar (aangepast):');
  assert.equal(lines.at(-1), CURL);
});
test('a driver who takes over, or a car without driver, is listed as "Gewijzigde chauffeur/tijd"', () => {
  const base = { Do_heen: [grp('f1', ['f2'])], Do_terug: [grp('f1', ['f2'], '17:00')] };
  const out = buildConclusieFrom(conclCtx(base, { Do_heen: [grp('f2', ['f2'], '07:45')], Do_terug: [grp(null, ['f2'], '17:00')] }), 'Do');
  assert.match(out, /^Gewijzigde chauffeur\/tijd: heen Piet 07:45; terug nog geen chauffeur 17:00\n/);
  assert.doesNotMatch(out, /Rijdt niet mee|ook mee/);
  assert.match(out, /\n• 07:45 – Piet: Jahaimy\n/); assert.match(out, /\n• 17:00 – nog geen chauffeur: Jahaimy\n/);
});
test('a Flex driver is a changed car plus a girl who rides "ook mee"; only changed directions say "(aangepast)"', () => {
  const base = { Vr_heen: [grp('f1', ['f1'])], Vr_terug: [grp('f1', ['f1'], '17:00')] };
  const out = buildConclusieFrom(conclCtx(base, { Vr_heen: [grp('f1', ['f1']), grp('f2', ['f2'], '08:00')] }), 'Vr');
  assert.match(out, /^Gewijzigde chauffeur\/tijd: heen Piet 08:00\nRijdt ook mee heen: Jahaimy\n\nAangepast schema vrijdag 2 okt\nHeen · Aalsmeer → Alkmaar \(aangepast\):\n• 07:30 – Jan: Eline\n• 08:00 – Piet: Jahaimy\nTerug · Alkmaar → Aalsmeer:\n• 17:00 – Jan: Eline\n/);
});
test('a Flex girl who joins an existing car is only "Rijdt ook mee"', () => {
  const base = { Vr_heen: [grp('f1', ['f1'])] };
  const out = buildConclusieFrom(conclCtx(base, { Vr_heen: [grp('f1', ['f1', 'f3'])] }), 'Vr');
  assert.match(out, /^Rijdt ook mee heen: Anouk\n\nAangepast schema vrijdag/); assert.doesNotMatch(out, /Gewijzigde/);
});
test('the wrapper reads the running app: Tuesday has a deviation in the sample data', () => {
  sampleParentState();
  const out = withFakeNow(NOW, () => buildConclusieMessage('Di'));
  assert.equal(out, [
    'Gewijzigde chauffeur/tijd: heen Kees de Vries 09:15',
    'Rijdt ook mee heen: Eline, Evi',
    '',
    'Aangepast schema dinsdag 29 sep',
    'Heen · Aalsmeer → Alkmaar (aangepast):',
    '• 09:15 – Kees de Vries: Eline, Evi',
    'Terug · Alkmaar → Aalsmeer:',
    '• geen ritten',
    '',
    CURL,
  ].join('\n'));
  assert.equal(withFakeNow(NOW, () => buildConclusieMessage('Vr')), 'Vrijdag: volgens schema. Zie Mijn week: ' + CURL);
});

console.log('\n=== Terug met OV in the conclusie-appje and Mijn week (US-06) ===');
test('a girl going home by public transport is named in the conclusie-appje, and the day is no longer "volgens schema"', () => {
  const s = buildConclusieFrom(ctx({ baseCars: () => [], ovGirls: () => ['f3'] }), 'Ma');
  assert.match(s, /^Anouk terug met OV\n/); assert.doesNotMatch(s, /volgens schema/);
});
test('several girls: one line with all names', () => {
  assert.match(buildConclusieFrom(ctx({ baseCars: () => [], ovGirls: () => ['f3', 'f1'] }), 'Ma'), /^Anouk, Eline terug met OV\n/);
});
test('her leaving the car is not also reported as "Rijdt niet mee terug"', () => {
  const base = [{ driverFamilyId: 'f1', girlIds: ['f2', 'f3'], departureTime: '17:00' }], now = [{ driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '17:00' }];
  const cx = ctx({ baseCars: (d, dir) => dir === 'terug' ? base : [], cars: (d, dir) => dir === 'terug' ? now : [], ovGirls: () => ['f3'] });
  const s = buildConclusieFrom(cx, 'Ma');
  assert.match(s, /Anouk terug met OV/); assert.doesNotMatch(s, /Rijdt niet mee/);
  assert.match(buildConclusieFrom({ ...cx, ovGirls: () => [] }, 'Ma'), /Rijdt niet mee terug: Anouk/);
});
test('without any OV nothing changes: still "volgens schema"', () => {
  assert.match(buildConclusieFrom(ctx({ baseCars: () => [], ovGirls: () => [] }), 'Ma'), /volgens schema/);
  assert.match(buildConclusieFrom(ctx({ baseCars: () => [] }), 'Ma'), /volgens schema/);
});
test('Mijn week message says "terug met OV" for the marked day', () => {
  const myFam = { girlName: 'Jahaimy', schedule: { Ma: { heen: '08:30', terug: '17:30' } } };
  const s = buildMyWeekMessageFrom(ctx({ myId: 'f2', myFam, matchRides: [], isOv: (d, id) => d === 'Ma' && id === 'f2' }));
  assert.match(s, /MA 28 — heen: 08:30 \(nog niet ingepland\) \| terug: terug met OV/);
});

console.log('\n=== during a period with a temporary rooster ===');
const P40 = { name: 'Startweek', firstDay: '2026-09-28', lastDay: '2026-10-02', opensOn: '2026-09-20', deadlineDate: '2026-09-25', deadlineTime: '12:00' };   // the week of the frozen "now" (Wed 30 Sep 2026)
const shift40 = (iso, direction, cars) => ({ periodFirstDay: '2026-09-28', date: iso, direction, cars, madeAt: 1, by: 'x' });
// f2 is out on Monday and hands in Tuesday 09:00 / 12:00; the temporary rooster is made for Monday (nobody) and Tuesday (Kees drives her).
const period40 = () => ({
  periods: oneP(P40),
  periodEntries: { '2026-09-28_f2': { familyId: 'f2', periodFirstDay: '2026-09-28', days: { '2026-09-28': { out: true }, '2026-09-29': { heen: '09:00', terug: '12:00' } } } },
  periodCars: {
    '2026-09-28_2026-09-28_heen': shift40('2026-09-28', 'heen', []), '2026-09-28_2026-09-28_terug': shift40('2026-09-28', 'terug', []),
    '2026-09-28_2026-09-29_heen': shift40('2026-09-29', 'heen', [{ driverFamilyId: 'f3', girlIds: ['f2'], departureTime: '08:00' }]),
    '2026-09-28_2026-09-29_terug': shift40('2026-09-29', 'terug', [{ driverFamilyId: 'f3', girlIds: ['f2'], departureTime: '12:00' }]),
  },
});
test('the Mijn week message uses the handed-in times; a day she does not ride is left out; a one-off change still counts', () => {
  sampleParentState(period40());
  withFakeNow(NOW, () => assert.equal(buildMyWeekWhatsAppMessage(), [
    'Carpool deze week – Jahaimy:',
    'DI 29 (gewijzigd) — heen: 09:00 (nog niet ingepland) | terug: 12:00 met Kees de Vries',   // Tuesday heen: the one-off change (f3 drives f1 and f4) goes before the temporary rooster
    'DO 1 — heen: 10:15 (nog niet ingepland) | terug: 18:00 (nog niet ingepland)',
    'VR 2 — heen: 11:00 (nog niet ingepland) | terug: 17:00 (nog niet ingepland)',
    '', 'https://mveen.github.io/AZ-Carpool/#myweek',
  ].join('\n')));
});
test('buildMyWeekMessageFrom takes the times from ctx.rideTime when the app gives it, else from the standard schedule', () => {
  const c = ctx({ myId: 'f2', myFam, matchRides: [], rideTime: (id, d, dir) => (d === 'Ma' ? '' : d === 'Di' && dir === 'heen' ? '09:00' : '') });
  const text = buildMyWeekMessageFrom(c);
  assert.match(text, /DI 29 — heen: 09:00 \(nog niet ingepland\) \| terug: –/); assert.doesNotMatch(text, /MA 28/);
  assert.match(buildMyWeekMessageFrom(ctx({ myId: 'f2', myFam, matchRides: [] })), /MA 28 — heen: 08:30/);
});
test('the conclusie compares with the temporary rooster, not with the standard rooster', () => {
  sampleParentState({ ...period40(), deviations: {} });
  const msg = withFakeNow(NOW, () => buildDayWhatsAppMessage('Di'));
  assert.match(msg, /12:00/); assert.match(msg, /Kees de Vries/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
