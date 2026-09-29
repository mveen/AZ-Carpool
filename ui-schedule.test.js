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
import { S } from './state.js';
import { renderSchedule, waPhone, waNameHtml, tripReserveHtml, neededTimesHtml, driverLineHtml, pillsHtml } from './ui-schedule.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
