// Run with: node ui-schedule.test.js
// The Rooster tab ("Deze week" and "Standaardrooster"). Rendered with a tiny fake DOM; each render is also
// pinned as a snapshot (__snapshots__/ui-schedule.snap.json) so an accidental change of the screen shows up.
// Deliberate change of the screen?  UPDATE_SNAPSHOTS=1 npm test
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
import { installFakeDom, sampleCoordinatorState, sampleParentState, useFakeDb, sampleDbSeed, withFakeNow, NOW, expectSnapshot, oneP, sampleGroups } from './test-support.js';
import { S } from '../state.js';
import { moveGirlToGroup, renderSchedule, saveCarPlace, openCarPlaceSheet, openShiftLocationSheet, openMoveSheet, waPhone, tripReserveHtml, neededTimesHtml, driverLineHtml, pillsHtml } from '../ui-schedule.js';

const dom = installFakeDom();
useFakeDb(sampleDbSeed());
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function render(state) { withFakeNow(NOW, () => { state(); renderSchedule(); }); return dom.html('tab-schedule'); }

console.log('=== Standaardrooster (coordinator) ===');
test('Monday: the existing car with its riders, seats left, and the girls who still need a car', () => {
  const html = render(() => sampleCoordinatorState({ roosterMode: 'standard', scheduleDay: 'Ma' }));
  const s = text(html);
  assert.match(s, /Het vaste rooster, elke week gelijk\./);
  assert.match(s, /ma 28 di 29 vandaag 30 do 1 vr 2/); assert.match(s, /Maandag Heen Ophalen: Busstation Opnieuw indelen Busstation → AFC/); // the coordinator's shift tools (design v2)
  assert.match(s, /Niet ingedeeld: Anouk, Evi, Lois, Saar Voorstellen/);
  assert.match(s, /Opnieuw indelen Busstation → AFC (&#39;|')34 2\/3 .*Eline Jahaimy Aankomst Alkmaar nodig: 08:30/);
  assert.match(s, /Back-up: Piet Pieters, Kees de Vries, Tom Visser/);
  assert.match(s, /Nog niet ingedeeld \(4\): Anouk, Evi, Lois, Saar\./);
  expectSnapshot('ui-schedule', 'coordinator standard Monday', html);
});
test('Monday: proposals are offered with the recommended one first', () => {
  const s = text(render(() => sampleCoordinatorState({ roosterMode: 'standard', scheduleDay: 'Ma' })));
  assert.match(s, /Voorstellen: AANBEVOLEN Optie 1: Nieuwe auto: Piet Pieters Piet Pieters: Anouk, Evi, Lois, Saar \(4\/4 pl\.\) Gebruik deze optie/);
  assert.match(s, /Optie 2: Nieuwe auto: Kees de Vries/);
  assert.match(s, /Aangepaste combinatie/);
});
test('an empty day offers a proposal for the girls who have a time', () => {
  const s = text(render(() => sampleCoordinatorState({ roosterMode: 'standard', scheduleDay: 'Wo' })));
  assert.match(s, /Nog geen ritten ingepland\. Niet ingedeeld: Anouk Voorstellen Nog niet ingedeeld: Anouk\./);
  assert.match(s, /Optie 1: Nieuwe auto: Kees de Vries Kees de Vries: Anouk \(1\/5 pl\.\)/);
});

test('own daughter\'s time in the direction title reads "{name} aanwezig {time}" (no place, same for heen and terug)', () => {
  const html = render(() => sampleParentState({ roosterMode: 'week', scheduleDay: 'Ma' }));
  const subs = [...html.matchAll(/sectionHead__sub">([^<]*)</g)].map(m => m[1]).filter(Boolean);
  assert.ok(subs.length >= 1, 'a time line is shown');
  for (const x of subs) assert.match(x, /^\S+ aanwezig \d\d:\d\d$/);
});

console.log('\n=== Deze week (with this week\'s changes) ===');
test('Tuesday: the deviation replaces the standard rooster and is marked "gewijzigd"', () => {
  const html = render(() => sampleCoordinatorState({ roosterMode: 'week', scheduleDay: 'Di' }));
  const s = text(html);
  assert.match(s, /Week 40 · 28 sep – 2 okt · met wijzigingen\./);
  assert.match(s, /Heen gewijzigd 09:15 Kees de Vries Busstation → AFC (&#39;|')34 2\/5 Eline Evi/);
  assert.match(s, /Back-up: Piet Pieters , Mo Bakker/);
  assert.match(s, /Niet ingedeeld: Jahaimy, Lois, Saar Regelen/);   // the dashed box under the cars of that direction
  expectSnapshot('ui-schedule', 'coordinator week Tuesday', html);
});
test('a day without any cars says so', () => {
  const s = text(render(() => sampleCoordinatorState({ roosterMode: 'week', scheduleDay: 'Di' })));
  assert.match(s, /Terug Geen ritten\./);
});

console.log('\n=== parent view ===');
test('a parent sees the week view without the editing buttons', () => {
  const html = render(() => sampleParentState({ roosterMode: 'week', scheduleDay: 'Wo' }));
  assert.match(text(html), /Woensdag Heen Geen ritten\. Niet ingedeeld: Anouk Regelen Terug Geen ritten\. Niet ingedeeld: Eline, Anouk, Lois Regelen/);
  assert.ok(!/Gebruik deze optie/.test(html)); assert.ok(!/Voorstellen/.test(text(html).replace('Voorstellen: AANBEVOLEN', '')));
  expectSnapshot('ui-schedule', 'parent week Wednesday', html);
});

console.log('\n=== small builders ===');
test('waPhone turns a Dutch number into a wa.me number (31...)', () => {
  assert.equal(waPhone('06 12 34 56 78'), '31612345678'); assert.equal(waPhone('+31 6 12345678'), '31612345678'); assert.equal(waPhone(''), '');
});
test('neededTimesHtml: one time, or the range when times differ', () => {
  sampleCoordinatorState();
  assert.match(text(neededTimesHtml('Ma', 'heen', ['f1', 'f2'])), /08:30/);
  assert.match(text(neededTimesHtml('Ma', 'heen', ['f1', 'f3'])), /08:30.10:15/);
});
test('neededTimesHtml: the heen line names the arrival place of its car (Alkmaar, or Wijdewormer for ATC); terug does not', () => {
  sampleCoordinatorState();
  assert.match(text(neededTimesHtml('Ma', 'heen', ['f1'], undefined, { stdDestination: 'ATC' })), /Aankomst Wijdewormer nodig: 08:30/);
  assert.match(text(neededTimesHtml('Ma', 'heen', ['f1'], undefined, { destination: 'ATC' })), /Aankomst Wijdewormer nodig/);
  assert.match(text(neededTimesHtml('Ma', 'heen', ['f1'], undefined, {})), /Aankomst Alkmaar nodig: 08:30/);
  assert.match(text(neededTimesHtml('Ma', 'heen', ['f1'])), /Aankomst Alkmaar nodig: 08:30/);
  assert.doesNotMatch(text(neededTimesHtml('Ma', 'terug', ['f1'], undefined, { destination: 'ATC' })), /Wijdewormer|Alkmaar/);
});
test('pillsHtml: one chip per girl, mine highlighted, a Flex player dashed', () => {
  sampleParentState();
  const fams = S.families; fams.f9 = { parentName: 'Lotte Flex', girlName: 'Lotte', familyType: 'flex', capacity: 3, schedule: {}, availability: {} };
  const html = pillsHtml(['f1', 'f2', 'f9'], 'f2');
  assert.equal((html.match(/class="chip/g) || []).length, 3);
  assert.match(html, /<span class="chip">Eline<\/span>/); assert.match(html, /<span class="chip chip--mine">Jahaimy<\/span>/); assert.match(html, /<span class="chip chip--flex">Lotte · flex<\/span>/);
});
test('driverLineHtml names the driver; tripReserveHtml lists the reserves', () => {
  sampleCoordinatorState();
  assert.match(text(driverLineHtml('f1', 'f9', null)), /Jan Jansen/);
  assert.match(text(tripReserveHtml('Ma', 'heen', [{ driverFamilyId: 'f1', girlIds: ['f1'] }], false)), /Back-up: /);
});

import { dayCoordinatorHtml, dayCoordinatorTarget } from '../ui-schedule.js';

console.log('\n=== Dagcoördinator vandaag (US-02) ===');
// The frozen "today" of the test run is Wednesday, so "morgen" is Thursday (Do).
test('nothing is shown when Beheer has no coordinator for today', () => {
  sampleParentState({ dayCoordinators: { Ma: 'f1' } });
  assert.equal(withFakeNow(NOW, () => dayCoordinatorHtml()), '');
  assert.doesNotMatch(render(() => sampleParentState({ dayCoordinators: {} })), /Dagcoördinator/);
});
test('Rooster shows "Dagcoördinator morgen: <naam>", the name opens the contact sheet', () => {
  const html = render(() => sampleParentState({ dayCoordinators: { Do: 'f3' } }));
  assert.match(text(html), /^Dagcoördinator morgen: Kees de Vries/);
  // The name opens the contact sheet; the WhatsApp text there has no name in it: "Hi! Een vraag over de carpool van morgen: "
  assert.match(html, /<button type="button" class="nameLink" data-contact="f3" data-contact-text="Hi! Een vraag over de carpool van morgen: ">Kees de Vries<\/button>/);
  assert.doesNotMatch(html, /wa\.me/);
});
test('the name comes from the family data, not from the code', () => {
  const html = render(() => sampleParentState({ dayCoordinators: { Do: 'f3' }, families: { ...sampleParentState().families, f3: { ...sampleParentState().families.f3, parentName: 'Merel Test' } } }));
  assert.match(text(html), /^Dagcoördinator morgen: Merel Test/);
  assert.doesNotMatch(html, /Kees de Vries/);
});
test('a coordinator without a phone number still shows the name (the sheet says there is no number)', () => {
  const fams = sampleParentState().families; fams.f3 = { ...fams.f3, parentPhone1: '', parentPhone2: '' };
  const html = render(() => sampleParentState({ dayCoordinators: { Do: 'f3' }, families: fams }));
  assert.match(text(html), /^Dagcoördinator morgen: Kees de Vries/); assert.doesNotMatch(html, /wa\.me/);
});
test('the day coordinator herself is told so, without a button to herself', () => {
  const html = render(() => sampleParentState({ dayCoordinators: { Do: 'f2' } }));
  assert.match(text(html), /^Jij bent dagcoördinator morgen/); assert.doesNotMatch(html, /dayCoordWa/);
});
test('a Flex driver is marked in the "Deze week" driver line', () => {
  const fams = sampleParentState().families; fams.f9 = { parentName: 'Lotte Flex', girlName: 'Lotte', familyType: 'flex', capacity: 3, parentPhone1: '0677777777', schedule: {}, availability: {} };
  const html = withFakeNow(NOW, () => { sampleParentState({ families: fams }); return driverLineHtml('f9', 'f2'); });
  assert.match(html, /Lotte Flex <span class="badge flexBadge">speelster-chauffeur<\/span>/);
});


console.log('\n=== which coordinator is shown ===');
const at = iso => new Date(iso);
test('Monday to Thursday: the coordinator of the NEXT day ("morgen")', () => {
  assert.deepEqual(dayCoordinatorTarget(at('2026-09-28T10:00:00+02:00')), { day: 'Di', when: 'morgen' });
  assert.deepEqual(dayCoordinatorTarget(at('2026-09-29T10:00:00+02:00')), { day: 'Wo', when: 'morgen' });
  assert.deepEqual(dayCoordinatorTarget(at('2026-09-30T10:00:00+02:00')), { day: 'Do', when: 'morgen' });
  assert.deepEqual(dayCoordinatorTarget(at('2026-10-01T10:00:00+02:00')), { day: 'Vr', when: 'morgen' });
});
test('Friday until 19:00: no coordinator is mentioned (changes are purged at 19:00)', () => {
  assert.equal(dayCoordinatorTarget(at('2026-10-02T10:00:00+02:00')), null);
  assert.equal(dayCoordinatorTarget(at('2026-10-02T18:59:00+02:00')), null);
  sampleParentState({ dayCoordinators: { Ma: 'f3', Vr: 'f3', Di: 'f3' } });
  assert.equal(withFakeNow('2026-10-02T10:00:00+02:00', () => dayCoordinatorHtml()), '');
});
test('Friday from 19:00: the coordinator of Monday ("maandag"), like the weekend', () => {
  assert.deepEqual(dayCoordinatorTarget(at('2026-10-02T19:00:00+02:00')), { day: 'Ma', when: 'maandag' });
  sampleParentState({ dayCoordinators: { Ma: 'f3', Vr: 'f1' } });
  assert.match(text(withFakeNow('2026-10-02T21:00:00+02:00', () => dayCoordinatorHtml())), /^Dagcoördinator maandag: Kees de Vries/);
});
test('Saturday and Sunday: the coordinator of Monday ("maandag")', () => {
  assert.deepEqual(dayCoordinatorTarget(at('2026-10-03T10:00:00+02:00')), { day: 'Ma', when: 'maandag' });
  assert.deepEqual(dayCoordinatorTarget(at('2026-10-04T10:00:00+02:00')), { day: 'Ma', when: 'maandag' });
  sampleParentState({ dayCoordinators: { Ma: 'f3', Vr: 'f1' } });
  assert.match(text(withFakeNow('2026-10-04T10:00:00+02:00', () => dayCoordinatorHtml())), /^Dagcoördinator maandag: Kees de Vries/);
});
test('the coordinator of the day itself is not the one shown', () => {
  sampleParentState({ dayCoordinators: { Wo: 'f3' } });
  assert.equal(withFakeNow(NOW, () => dayCoordinatorHtml()), '');
});

console.log('\n=== pickup and drop-off place on the ride (US-15) ===');
test('Rooster "Deze week" and Standaardrooster show the route as plain text, without a map button', () => {
  const week = render(() => sampleParentState({ roosterMode: 'week', scheduleDay: 'Ma' }));
  assert.match(text(week), /07:30 Jan Jansen Busstation → AFC (&#39;|')34/); assert.match(text(week), /17:30 Jij rijdt AFC (&#39;|')34 → Busstation/);
  assert.doesNotMatch(week, /geoBtn|geo:0,0|Kaart/);   // no map button on a shift
  const std = render(() => sampleCoordinatorState({ roosterMode: 'standard', scheduleDay: 'Ma' }));
  assert.match(text(std), /Busstation → AFC (&#39;|')34/);
});
test('a one-off place chosen in Wijzigen shows on that ride only', () => {
  const dev = { Ma_heen: { day: 'Ma', direction: 'heen', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f1', girlIds: ['f1', 'f2'], departureTime: '07:30', locationId: 'de-parel' }] } };
  const s = text(render(() => sampleParentState({ roosterMode: 'week', scheduleDay: 'Ma', deviations: dev })));
  assert.match(s, /07:30 Jan Jansen De Parel → AFC (&#39;|')34/); assert.match(s, /17:30 Jij rijdt AFC (&#39;|')34 → Busstation/);
});

test('without a period the switch has two views and a stale "period" mode falls back to "Deze week"', () => {
  sampleParentState({ roosterMode: 'period', periods: {} });
  const html = withFakeNow(NOW, () => { renderSchedule(); return dom.html('tab-schedule'); });
  assert.equal((html.match(/data-rmode=/g) || []).length, 2); assert.equal(S.roosterMode, 'week');
});
test('the standard views are untouched while a period is set: same html with and without the period', () => {
  const plain = withFakeNow(NOW, () => { sampleParentState({ roosterMode: 'standard' }); renderSchedule(); return dom.html('tab-schedule'); });
  const withPeriod = withFakeNow(NOW, () => { sampleParentState({ roosterMode: 'standard', periods: oneP({ name: 'x', firstDay: '2026-10-26', lastDay: '2026-10-30', opensOn: '2026-10-14', deadlineDate: '2026-10-16', deadlineTime: '12:00' }), periodCars: {}, periodEntries: {}, periodEntriesLoaded: true }); renderSchedule(); return dom.html('tab-schedule'); });
  assert.equal(plain, withPeriod);
});

console.log('\n=== Weekoverzicht-knop ===');
test('Rooster has a Weekoverzicht button in "Deze week" and in the standard rooster; it opens the overview', () => {
  ['week', 'standard'].forEach(mode => {
    dom.doc.body.children.length = 0;
    const html = render(() => sampleCoordinatorState({ roosterMode: mode, scheduleDay: 'Ma' }));
    assert.match(html, /id="ovOpen"[^>]*>[\s\S]*?Weekoverzicht/);
    dom.el('ovOpen').onclick();
    assert.equal(dom.doc.body.children.length, 1);
    assert.equal(dom.doc.body.children[0].id, 'ovOverlay');
  });
});

test('the first option of a planning is only marked "primary" (Aanbevolen) when it is a checked complete planning', () => {
  const html = render(() => sampleCoordinatorState({ roosterMode: 'standard', scheduleDay: 'Ma' }));
  assert.ok(/suggestion primary/.test(html) || !/Aanbevolen/.test(html), 'no Aanbevolen label without the primary styling');
});

console.log('\n=== own departure and arrival place per car (standaardrooster) ===');
const twoCars = () => {
  const g = sampleGroups();
  g.Ma_heen_2 = { day: 'Ma', direction: 'heen', girlIds: ['f5'], driverFamilyId: 'f3', reserveFamilyIds: [], departureTime: '09:00', stdLocationId: 'de-parel', stdDestination: 'ATC' };
  return g;
};
test('two cars of the same shift show their own place and arrival', () => {
  const html = render(() => sampleCoordinatorState({ roosterMode: 'standard', scheduleDay: 'Ma', groups: twoCars() }));
  const s = text(html);
  assert.match(s, /Busstation → AFC (&#39;|')34/);
  assert.match(s, /De Parel → ATC/);
  assert.match(html, /data-shiftloc="Ma_heen_1"/); assert.match(html, /data-shiftloc="Ma_heen_2"/);
});
test('the place button belongs to one car (its group id), not to the whole shift', () => {
  const html = render(() => sampleCoordinatorState({ roosterMode: 'standard', scheduleDay: 'Ma', groups: twoCars() }));
  assert.doesNotMatch(html, /data-shiftloc="Ma\|heen"/);
});
await testAsync('changing the place of one car leaves the other car of the shift alone', async () => {
  const seed = sampleDbSeed(); Object.entries(twoCars()).forEach(([id, g]) => { seed['groups/' + id] = g; });
  const fake = useFakeDb(seed);
  render(() => sampleCoordinatorState({ roosterMode: 'standard', scheduleDay: 'Ma', groups: twoCars() }));
  const ok = await saveCarPlace('Ma_heen_1', { stdLocationId: 'a4-de-hoek', stdDestination: 'ATC' });
  assert.equal(ok, true);
  const g1 = fake.get('groups/Ma_heen_1'), g2 = fake.get('groups/Ma_heen_2');
  assert.equal(g1.stdLocationId, 'a4-de-hoek'); assert.equal(g1.stdDestination, 'ATC');
  assert.equal(g2.stdLocationId, 'de-parel'); assert.equal(g2.stdDestination, 'ATC');
});
test('the sheet opens for one car and lists places plus both arrival options', () => {
  dom.doc.body.children.length = 0;
  render(() => sampleCoordinatorState({ roosterMode: 'standard', scheduleDay: 'Ma', groups: twoCars() }));
  openShiftLocationSheet('Ma_heen_2');
  const sheet = dom.doc.body.children[0];
  assert.equal(sheet.id, 'sheetOverlay');
  assert.match(text(sheet.innerHTML), /Standaardplek van deze auto/);
  assert.match(text(sheet.innerHTML), /De Parel ✓/); assert.match(text(sheet.innerHTML), /Aankomst: ATC ✓/);
  dom.doc.body.children.length = 0;
});

test('the car place sheet is shared: it shows the given title and the car\'s own choices', () => {
  dom.doc.body.children.length = 0;
  render(() => sampleCoordinatorState({ roosterMode: 'standard', scheduleDay: 'Ma', groups: twoCars() }));
  openCarPlaceSheet({ stdLocationId: 'a4-de-hoek', stdDestination: 'ATC' }, 'Ma', 'heen', 'Eigen titel', 'Eigen tekst', () => {});
  const h = text(dom.doc.body.children[0].innerHTML);
  assert.match(h, /Eigen titel/); assert.match(h, /A4-De Hoek ✓/); assert.match(h, /Aankomst: ATC ✓/);
  dom.doc.body.children.length = 0;
});

test('switching Vast rooster / Deze week clears a waiting temporary-rooster swap', () => { assert.equal(S.periodSwap == null, true); });

test('design v2: ui-schedule.js only uses variables from tokens.css in its inline styles', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../ui-schedule.js', import.meta.url), 'utf8');
  const tokens = fs.readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
  const unknown = [...src.matchAll(/var\((--[\w-]+)\)/g)].map(x => x[1]).filter(v => !tokens.includes(v + ':'));
  assert.deepEqual(unknown, []);
});

test('design v2: the move sheet has a car icon per row, dims a full car and has no Annuleren', () => {
  sampleCoordinatorState({ groups: { ...sampleGroups(), Ma_heen_2: { day: 'Ma', direction: 'heen', girlIds: ['f5'], driverFamilyId: 'f3', reserveFamilyIds: [], departureTime: '09:00' } } });
  const el = dom.doc.getElementById('sheetOverlay'); let html = '';
  dom.doc.createElement = () => ({ set innerHTML(v) { html = v; }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] }); dom.doc.body.appendChild = () => {};
  openMoveSheet('Ma_heen_1', 'f1');
  assert.match(html, /<svg[^>]*>.*<\/svg><span class="sheetItem__label">Auto 2/s); assert.doesNotMatch(html, /Annuleren/);
});

test('design v2: the shift tools (Ophalen: <plek>, Opnieuw indelen) are only for the coordinator, in the Vast rooster', () => {
  const coord = render(() => sampleCoordinatorState({ roosterMode: 'standard', scheduleDay: 'Ma' }));
  assert.match(coord, /data-cycleplace="Ma\|heen"/); assert.match(coord, /data-replan="Ma\|terug"/);
  const parent = render(() => sampleParentState({ roosterMode: 'week', scheduleDay: 'Ma' }));
  assert.doesNotMatch(parent, /data-cycleplace|data-replan/);
});

test('Rooster has no "Laatst bijgewerkt" footer, in any mode', () => {
  for (const mode of ['week', 'standard']) {
    const h = render(() => { sampleParentState(); S.roosterMode = mode; S.lastUpdateRooster = { by: 'Jan', at: 1 }; S.lastUpdateDeviation = { by: 'Piet', at: 2 }; });
    assert.doesNotMatch(h, /Laatst bijgewerkt/i);
  }
});
test('Afwijkend weekrooster: Rooster "Deze week" gets the action block only on a day this person decides, and only with the switch on', () => {
  const req = { weekKey: '2026-W40', day: 'Do', familyId: 'f3', rides: true, heen: '11:00', terug: '18:00', status: 'pending', createdAt: 1, updatedAt: 1 };
  useFakeDb(sampleDbSeed());
  sampleParentState({ weekrooster: { mode: 'aan' }, dayCoordinators: { Do: 'f2' }, dayRequests: { '2026-W40_Do_f3': req }, scheduleDay: 'Do', roosterMode: 'week' });
  withFakeNow(NOW, () => renderSchedule()); assert.match(dom.html('tab-schedule'), /id="wrAlert"/);
  S.scheduleDay = 'Wo'; withFakeNow(NOW, () => renderSchedule()); assert.doesNotMatch(dom.html('tab-schedule'), /id="wrAlert"/);
  S.scheduleDay = 'Do'; S.roosterMode = 'standard'; withFakeNow(NOW, () => renderSchedule()); assert.doesNotMatch(dom.html('tab-schedule'), /id="wrAlert"/, 'Vast rooster stays as it is');
  S.roosterMode = 'week'; S.weekrooster = { mode: 'uit' }; withFakeNow(NOW, () => renderSchedule()); assert.doesNotMatch(dom.html('tab-schedule'), /wrAlert|wrLog|Dagcoördinator donderdag/);
});

import { assertNoUnusedImports } from './test-support.js';
await (async () => {
  const toastNow = () => text(dom.doc.getElementById('toast').innerHTML);
  const seed = { 'groups/g1': { day: 'Ma', direction: 'terug', girlIds: ['f2', 'f6'], driverFamilyId: 'f2' }, 'groups/g2': { day: 'Ma', direction: 'terug', girlIds: ['f1'], driverFamilyId: 'f3' } };
  try {
    useFakeDb({ ...sampleDbSeed(), ...seed });
    sampleCoordinatorState({ groups: { g1: seed['groups/g1'], g2: seed['groups/g2'] }, prefs: { rules: [{ type: 'ownCar', girlId: 'f2', direction: 'terug' }] } });
    await moveGirlToGroup('g1', 'f2', 'g2');
    assert.match(toastNow(), /Let op: de eigen ouder rijdt, maar Jahaimy zit in een andere auto/); passed++; console.log('  ✓ moving the daughter away from her driving parent (Vast rooster) saves, then warns softly');
    const fake = useFakeDb({ ...sampleDbSeed(), ...seed });
    sampleCoordinatorState({ groups: { g1: seed['groups/g1'], g2: seed['groups/g2'] }, prefs: { rules: [{ type: 'ownCar', girlId: 'f2', direction: 'terug' }] } });
    await moveGirlToGroup('g1', 'f6', 'g2');
    assert.match(toastNow(), /verplaatst/); assert.doesNotMatch(toastNow(), /Let op/); assert.deepEqual(fake.get('groups/g2').girlIds, ['f1', 'f6']); passed++; console.log('  ✓ a move that keeps parent and daughter together gives no warning');
  } catch (e) { failed++; console.log('  ✗ own-car warning in the Vast rooster\n     ', e.message); }
})();
test('Rooster week view: with the switch off there is no "Toch zelf wijzigen" or "Zelf indelen" under the day', () => {
  sampleParentState({ scheduleDay: 'Ma', roosterMode: 'week' }); withFakeNow(NOW, () => renderSchedule());
  assert.doesNotMatch(dom.html('tab-schedule'), /wroverride|wredit|Toch zelf wijzigen|Zelf indelen/);
});
test('ui-schedule.js imports nothing it does not use', () => assertNoUnusedImports('ui-schedule.js'));

test('Rooster shows the spinner while the data is loading', () => {
  assert.match(render(() => sampleParentState({ familiesLoaded: false })), /class="spinner"/);
  assert.doesNotMatch(render(() => sampleParentState({})), /class="spinner"/);
});

test('the Rooster week view shows the Advies view in place of the day when S.wrAdvice is open (and nothing of it by default)', () => {
  sampleParentState({ scheduleDay: 'Do', roosterMode: 'week' }); S.wrAdvice = null;
  withFakeNow(NOW, () => renderSchedule()); assert.doesNotMatch(dom.html('tab-schedule'), /wrAdvice|wrAccept/);
});
test('Advies and Zelf indelen replace the whole Rooster header block: no coordinator line, tabs, Weekoverzicht or day pills', () => {
  const state = edit => () => { sampleParentState({ scheduleDay: 'Do', roosterMode: 'week', weekrooster: { mode: 'aan' }, dayCoordinators: { Do: 'f2' } }); S.wrAdvice = null; S.wrEdit = edit; };
  const normal = render(state(null)); assert.match(normal, /data-rmode="week"/); assert.match(normal, /dayPills/); assert.match(normal, /id="ovOpen"/);
  const focus = render(state({ day: 'Do', override: false })); assert.match(focus, /id="wrEdit"/); assert.doesNotMatch(focus, /data-rmode|dayPills|id="ovOpen"|coordLine/);
  S.wrEdit = null;
});
console.log('\n=== the driver\'s button "Tijd en plek" ===');
await testAsync('in Rooster "Deze week" the driver gets the button on the own car only, and only while the new flow is on', async () => {
  const { sampleDeviations } = await import('./test-support.js');
  const DRV = { Do_terug: { day: 'Do', direction: 'terug', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f2', girlIds: ['f1', 'f2'], reserveFamilyIds: [], departureTime: '18:00' }] } };
  const mk = patch => () => sampleParentState({ scheduleDay: 'Do', roosterMode: 'week', deviations: { ...sampleDeviations(), ...DRV }, ...patch });
  const on = render(mk({ weekrooster: { mode: 'aan' } }));
  assert.equal((on.match(/data-drivercar=/g) || []).length, 1); assert.match(text(on), /Tijd en plek/);
  assert.doesNotMatch(render(mk({ weekrooster: { mode: 'uit' } })), /data-drivercar/);
  assert.doesNotMatch(render(mk({ weekrooster: { mode: 'aan' }, links: { p1: { familyId: 'f4' } } })), /data-drivercar/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
