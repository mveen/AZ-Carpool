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
import { installFakeDom, sampleCoordinatorState, sampleParentState, useFakeDb, sampleDbSeed, withFakeNow, NOW, expectSnapshot } from './test-support.js';
import { S } from '../state.js';
import { renderSchedule, waPhone, waNameHtml, tripReserveHtml, neededTimesHtml, driverLineHtml, pillsHtml } from '../ui-schedule.js';

const dom = installFakeDom();
useFakeDb(sampleDbSeed());
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function render(state) { withFakeNow(NOW, () => { state(); renderSchedule(); }); return dom.html('tab-schedule'); }

console.log('=== Standaardrooster (coordinator) ===');
test('Monday: the existing car with its riders, seats left, and the girls who still need a car', () => {
  const html = render(() => sampleCoordinatorState({ roosterMode: 'standard', scheduleDay: 'Ma' }));
  const s = text(html);
  assert.match(s, /Het vaste rooster, elke week gelijk\./);
  assert.match(s, /MA 2 ritten/); assert.match(s, /Maandag 7 niet ingedeeld/);
  assert.match(s, /Heen · Aalsmeer → Alkmaar 1 Vertrek 2\/3 plekken Aankomst Alkmaar nodig: 08:30 Eline Jahaimy/);
  assert.match(s, /Reserve: Piet Pieters, Kees de Vries, Tom Visser/);
  assert.match(s, /Nog niet ingedeeld \(4\): Anouk, Evi, Lois, Saar\./);
  expectSnapshot('ui-schedule', 'coordinator standard Monday', html);
});
test('Monday: proposals are offered with the recommended one first', () => {
  const s = text(render(() => sampleCoordinatorState({ roosterMode: 'standard', scheduleDay: 'Ma' })));
  assert.match(s, /Voorstellen: AANBEVOLEN Optie 1: Nieuwe auto: Piet Pieters Piet Pieters: Lois, Saar, Anouk, Evi \(4\/4 pl\.\) Gebruik deze optie/);
  assert.match(s, /Optie 2: Nieuwe auto: Kees de Vries/);
  assert.match(s, /Aangepaste combinatie/);
});
test('an empty day offers a proposal for the girls who have a time', () => {
  const s = text(render(() => sampleCoordinatorState({ roosterMode: 'standard', scheduleDay: 'Wo' })));
  assert.match(s, /Nog geen ritten ingepland\. Nog niet ingedeeld: Anouk\./);
  assert.match(s, /Optie 1: Nieuwe auto: Kees de Vries Kees de Vries: Anouk \(1\/5 pl\.\)/);
});

console.log('\n=== Deze week (with this week\'s changes) ===');
test('Tuesday: the deviation replaces the standard rooster and is marked "gewijzigd"', () => {
  const html = render(() => sampleCoordinatorState({ roosterMode: 'week', scheduleDay: 'Di' }));
  const s = text(html);
  assert.match(s, /Week 40 · 28 sep – 2 okt — het standaardrooster mét de wijzigingen van deze week\./);
  assert.match(s, /Heen · Aalsmeer → Alkmaar gewijzigd 1 Vertrek 09:15 2\/5 plekken/);
  assert.match(s, /Chauffeur: Kees de Vries/); assert.match(s, /Reserve: Piet Pieters , Mo Bakker/);
  assert.match(s, /Heen : Jahaimy, Lois, Saar Regelen/);
  expectSnapshot('ui-schedule', 'coordinator week Tuesday', html);
});
test('a day without any cars says so', () => {
  const s = text(render(() => sampleCoordinatorState({ roosterMode: 'week', scheduleDay: 'Di' })));
  assert.match(s, /Terug · Alkmaar → Aalsmeer Geen ritten\./);
});

console.log('\n=== parent view ===');
test('a parent sees the week view without the editing buttons', () => {
  const html = render(() => sampleParentState({ roosterMode: 'week', scheduleDay: 'Wo' }));
  assert.match(text(html), /Woensdag 4 niet ingedeeld/);
  assert.ok(!/Gebruik deze optie/.test(html)); assert.ok(!/Voorstellen/.test(text(html).replace('Voorstellen: AANBEVOLEN', '')));
  expectSnapshot('ui-schedule', 'parent week Wednesday', html);
});

console.log('\n=== small builders ===');
test('waPhone turns a Dutch number into a wa.me number (31...)', () => {
  assert.equal(waPhone('06 12 34 56 78'), '31612345678'); assert.equal(waPhone('+31 6 12345678'), '31612345678'); assert.equal(waPhone(''), '');
});
test('waNameHtml is a tap-to-WhatsApp link when the family has a phone number, plain text otherwise', () => {
  sampleCoordinatorState();
  const link = waNameHtml('f2', 'Hi! Rijd je?');
  assert.match(link, /href="https:\/\/wa\.me\/31622222222\?text=Hi!%20Rijd%20je%3F"/); assert.match(link, /Piet Pieters/);
  S.families.f2.parentPhone1 = ''; S.families.f2.parentPhone2 = '';
  assert.equal(text(waNameHtml('f2', 'x')), 'Piet Pieters'); assert.ok(!/wa\.me/.test(waNameHtml('f2', 'x')));
});
test('waNameHtml escapes names', () => {
  sampleCoordinatorState(); S.families.f2.parentName = 'P<i>'; S.families.f2.parentPhone1 = '';
  assert.ok(!/<i>/.test(waNameHtml('f2', 'x')));
});
test('neededTimesHtml: one time, or the range when times differ', () => {
  sampleCoordinatorState();
  assert.match(text(neededTimesHtml('Ma', 'heen', ['f1', 'f2'])), /08:30/);
  assert.match(text(neededTimesHtml('Ma', 'heen', ['f1', 'f3'])), /08:30.10:15/);
});
test('pillsHtml: one pill per girl, mine highlighted', () => {
  sampleParentState();
  const html = pillsHtml(['f1', 'f2'], 'f2');
  assert.equal((html.match(/pill/g) || []).length >= 2, true); assert.match(html, /Eline/); assert.match(html, /Jahaimy/);
});
test('driverLineHtml names the driver; tripReserveHtml lists the reserves', () => {
  sampleCoordinatorState();
  assert.match(text(driverLineHtml('f1', 'f9', null)), /Jan Jansen/);
  assert.match(text(tripReserveHtml('Ma', 'heen', [{ driverFamilyId: 'f1', girlIds: ['f1'] }], false)), /Reserve: /);
});

import { dayCoordinatorHtml, dayCoordinatorTarget } from '../ui-schedule.js';

console.log('\n=== Dagcoördinator vandaag (US-02) ===');
// The frozen "today" of the test run is Wednesday, so "morgen" is Thursday (Do).
test('nothing is shown when Beheer has no coordinator for today', () => {
  sampleParentState({ dayCoordinators: { Ma: 'f1' } });
  assert.equal(withFakeNow(NOW, () => dayCoordinatorHtml()), '');
  assert.doesNotMatch(render(() => sampleParentState({ dayCoordinators: {} })), /Dagcoördinator/);
});
test('Rooster shows "Dagcoördinator morgen: <naam>" with a WhatsApp button to that person', () => {
  const html = render(() => sampleParentState({ dayCoordinators: { Do: 'f3' } }));
  assert.match(text(html), /^Dagcoördinator morgen: Kees de Vries/);
  assert.match(html, /href="https:\/\/wa\.me\/31633333333\?text=Hi%20Kees%20de%20Vries!%20Een%20vraag%20over%20de%20carpool%20van%20morgen%3A/);
  assert.match(html, /aria-label="Stuur Kees de Vries een WhatsApp-bericht"/);
});
test('the name comes from the family data, not from the code', () => {
  const html = render(() => sampleParentState({ dayCoordinators: { Do: 'f3' }, families: { ...sampleParentState().families, f3: { ...sampleParentState().families.f3, parentName: 'Merel Test' } } }));
  assert.match(text(html), /^Dagcoördinator morgen: Merel Test/);
  assert.doesNotMatch(html, /Kees de Vries/);
});
test('a coordinator without a phone number gets no WhatsApp button', () => {
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
test('Friday: no coordinator is mentioned (changes are purged at midnight)', () => {
  assert.equal(dayCoordinatorTarget(at('2026-10-02T10:00:00+02:00')), null);
  sampleParentState({ dayCoordinators: { Ma: 'f3', Vr: 'f3', Di: 'f3' } });
  assert.equal(withFakeNow('2026-10-02T10:00:00+02:00', () => dayCoordinatorHtml()), '');
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
  assert.match(text(week), /07:30 Busstation → AFC &#39;34|07:30 Busstation → AFC '34/); assert.match(text(week), /17:30 AFC (&#39;|')34 → Busstation/);
  assert.doesNotMatch(week, /geoBtn|geo:0,0|Kaart/);   // no map button on a shift
  const std = render(() => sampleCoordinatorState({ roosterMode: 'standard', scheduleDay: 'Ma' }));
  assert.match(text(std), /07:30 Busstation → AFC (&#39;|')34/);
});
test('a one-off place chosen in Wijzigen shows on that ride only', () => {
  const dev = { Ma_heen: { day: 'Ma', direction: 'heen', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f1', girlIds: ['f1', 'f2'], departureTime: '07:30', locationId: 'de-parel' }] } };
  const s = text(render(() => sampleParentState({ roosterMode: 'week', scheduleDay: 'Ma', deviations: dev })));
  assert.match(s, /07:30 De Parel → AFC (&#39;|')34/); assert.match(s, /17:30 AFC (&#39;|')34 → Busstation/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
