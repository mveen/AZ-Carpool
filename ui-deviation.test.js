// Run with: node ui-deviation.test.js
// The Wijzigen tab: one-off changes for this week, open to every parent, plus the match carpools and the
// "Deel update via WhatsApp" button.
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
import { installFakeDom, sampleParentState, sampleCoordinatorState, useFakeDb, sampleDbSeed, withFakeNow, NOW, expectSnapshot } from './test-support.js';
import { S } from './state.js';
import { todayKey } from './constants.js';
import {
  renderDeviationTab, matchCarRowHtml, whatsAppButtonHtml, wireWhatsAppButton, sendWhatsAppUpdate, renderWeekendMatchCarpoolCard,
  renderDevDirection, updateMatchCarCapacityWarning,
} from './ui-deviation.js';

const dom = installFakeDom();
useFakeDb(sampleDbSeed());
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const kick = new Date('2026-10-03T10:30:00+02:00').getTime();
const feeds = [{ calendarId: 'cal1', label: 'AZ O15-1' }];
const matchCarpools = { ev_cal1__e1: { calendarId: 'cal1', eventId: 'e1', teamLabel: 'AZ O15-1', summary: 'AZ O15-1-Hoorn O15-2', location: 'Sportpark Hoorn', startMs: kick, cars: [{ driverFamilyId: 'f1', girlIds: ['f2', 'f4'], departureTime: '09:15' }] } };
const liveMatch = { calendarId: 'cal1', eventId: 'e2', teamLabel: 'AZ O15-1', summary: 'Ajax O15-1-AZ O15-1', location: 'De Toekomst', start: new Date('2026-10-01T18:00:00+02:00') };
function render(state, patch) { withFakeNow(NOW, () => { state(patch); renderDeviationTab(); }); return dom.html('tab-deviation'); }

console.log('=== day pills (same design as Rooster) ===');
test('shows the week, one pill per day and the content of one day straight away', () => {
  const html = render(sampleParentState, { matches: [liveMatch], matchesSource: 'live', matchFeeds: feeds, deviationDay: null });
  const s = text(html);
  assert.match(s, /^Wijzigingen · Week 40 · 28 sep – 2 okt Eenmalige ritaanpassing voor deze week/);
  assert.equal((html.match(/data-devday=/g) || []).length, 5);
  assert.match(html, /class="daypills"/);
  assert.doesNotMatch(html, /devDayBtn|grid5/);            // the old day tiles are gone
  const day = todayKey || 'Ma';
  assert.match(html, new RegExp(`daypill devDayPill active" data-devday="${day}"`)); // today (or Monday) is open by default
  assert.match(html, /Heen · Aalsmeer → Alkmaar/);          // day content is loaded without an extra tap
  assert.equal(S.deviationDay, day);
});
test('a day that was changed this week is marked on its pill', () => {
  const html = render(sampleParentState, { deviationDay: 'Ma' });
  assert.match(html, /devDayPill changed" data-devday="Di"/);
  assert.match(text(html), /= deze week gewijzigd/);
});
test('tapping a pill loads that day (like Rooster)', () => {
  render(sampleParentState, { deviationDay: 'Ma' });
  const btn = { dataset: { devday: 'Vr' } };
  const all = dom.doc.querySelectorAll; dom.doc.querySelectorAll = sel => sel === '[data-devday]' ? [btn] : all(sel);
  withFakeNow(NOW, () => { renderDeviationTab(); btn.onclick(); });
  dom.doc.querySelectorAll = all;
  assert.equal(S.deviationDay, 'Vr');
  assert.match(text(dom.html('tab-deviation')), /Vrijdag Wijzigingen hier gelden alleen voor Vrijdag/);
  expectSnapshot('ui-deviation', 'parent day pills with a live match', render(sampleParentState, { matches: [liveMatch], matchesSource: 'live', matchFeeds: feeds, deviationDay: 'Ma' }));
});
test('an unknown day falls back to today (or Monday)', () => {
  render(sampleParentState, { deviationDay: 'Zo' });
  assert.equal(S.deviationDay, todayKey || 'Ma');
});

console.log('\n=== Wedstrijdcarpool is a separate section, not tied to a day ===');
test('upcoming matches can get a carpool from any parent', () => {
  const s = text(render(sampleParentState, { matches: [liveMatch], matchesSource: 'live', matchFeeds: feeds, deviationDay: 'Ma' }));
  assert.match(s, /Wedstrijdcarpool komende dagen Zet een carpool op voor een wedstrijd\./);
  assert.match(s, /AZ O15-1 \(Uit\) vs Ajax O15-1 donderdag 1 oktober · 18:00 · De Toekomst Nog geen carpool ingesteld\. \+ Auto toevoegen/);
});
test('the section shows the same content whichever day is open, after the day content', () => {
  const opts = { matches: [liveMatch], matchesSource: 'live', matchFeeds: feeds };
  const card = h => h.slice(h.indexOf('id="matchCarpoolCard"'));
  const ma = render(sampleParentState, { ...opts, deviationDay: 'Ma' });
  const vr = render(sampleParentState, { ...opts, deviationDay: 'Vr' });
  assert.equal(card(ma), card(vr));
  assert.ok(ma.indexOf('id="matchCarpoolCard"') > ma.indexOf('Terug · Alkmaar'));
});
test('a day no longer shows a read-only match card of its own', () => {
  const home = { calendarId: 'cal1', eventId: 'e1', teamLabel: 'AZ O15-1', summary: 'AZ O15-1-Hoorn O15-2', location: 'Sportpark Hoorn', start: new Date(kick) };
  const html = render(sampleParentState, { matchCarpools, matchFeeds: feeds, matches: [home], matchesSource: 'live', deviationDay: 'Vr' });
  assert.doesNotMatch(html, /data-gomatchcarpool|Alleen lezen/);
});
test('without any match there is a friendly empty message', () => {
  assert.match(text(render(sampleParentState, { matchesSource: 'live', deviationDay: 'Ma' })), /Geen wedstrijden/);
});

console.log('\n=== editing one day ===');
test('a parent editing Tuesday sees both directions with drivers, and a way back to the standard rooster', () => {
  const s = text(render(sampleParentState, { deviationDay: 'Di', matchFeeds: feeds }));
  assert.match(s, / Dinsdag Wijzigingen hier gelden alleen voor Dinsdag deze week en verdwijnen dit weekend vanzelf\. Deel update via WhatsApp/);
  assert.doesNotMatch(s, /Andere dag/);   // no separate day picker screen any more
  assert.match(s, /Heen · Aalsmeer → Alkmaar Vertrek Chauffeur -- geen chauffeur -- Jan Jansen \(geen beschikbaarheid\) Piet Pieters/);
  assert.match(s, /Terug naar standaard rooster/);
  assert.match(s, /Terug · Alkmaar → Aalsmeer Geen ritten gepland in het standaard Rooster voor dit moment\./);
  expectSnapshot('ui-deviation', 'parent editing Tuesday', dom.html('tab-deviation'));
});
test('a driver without availability gets a warning', () => {
  assert.match(text(render(sampleParentState, { deviationDay: 'Di' })), /Deze ouder heeft voor dit moment geen beschikbaarheid opgegeven/);
});
test('girls who normally do not ride can still be added to a car', () => {
  const s = text(render(sampleCoordinatorState, { deviationDay: 'Ma' }));
  assert.match(s, /Andere meiden Ook meiden die niet standaard meerijden, kun je hier alsnog aan een auto toevoegen\. Anouk Voeg toe aan auto… Auto: Jan Jansen/);
});
test('Monday: the standard cars are the starting point (Eline and Jahaimy with Jan)', () => {
  const s = text(render(sampleCoordinatorState, { deviationDay: 'Ma' }));
  assert.match(s, /Heen · Aalsmeer → Alkmaar Vertrek Chauffeur -- geen chauffeur -- Jan Jansen/);
  assert.match(s, /Eline Jahaimy/);
});
test('renderDevDirection returns the block for a single direction', () => {
  sampleCoordinatorState({ deviationDay: 'Ma' });
  const html = withFakeNow(NOW, () => renderDevDirection('Ma', 'terug'));
  assert.match(text(html), /Terug · Alkmaar → Aalsmeer/);
});

console.log('\n=== match carpools ===');
test('matchCarRowHtml describes a car: departure, driver and riders', () => {
  sampleCoordinatorState();
  const s = text(matchCarRowHtml({ driverFamilyId: 'f1', girlIds: ['f2', 'f4'], departureTime: '09:15' }, {}));
  assert.match(s, /09:15/); assert.match(s, /Jan Jansen/); assert.match(s, /Jahaimy/); assert.match(s, /Evi/);
});
test('the weekend carpool card lists the stored cars under their match', () => {
  const home = { calendarId: 'cal1', eventId: 'e1', teamLabel: 'AZ O15-1', summary: 'AZ O15-1-Hoorn O15-2', location: 'Sportpark Hoorn', start: new Date(kick) };
  const s = text(render(sampleParentState, { matchCarpools, matchFeeds: feeds, matches: [home], matchesSource: 'live' }));
  assert.match(s, /AZ O15-1 \(Thuis\) vs Hoorn O15-2 zaterdag 3 oktober · 10:30 · Sportpark Hoorn/); assert.match(s, /09:15/); assert.match(s, /Jan Jansen/);
});
test('the card function returns html for the current state', () => {
  sampleParentState({ matchCarpools, matchFeeds: feeds });
  assert.equal(typeof withFakeNow(NOW, () => renderWeekendMatchCarpoolCard()), 'string');
});
test('capacity warning does not throw when the form is not on screen', () => {
  sampleParentState(); updateMatchCarCapacityWarning('nothing');
});

console.log('\n=== WhatsApp share button ===');
test('the button has the WhatsApp icon and the label "Deel update via WhatsApp"', () => {
  const html = whatsAppButtonHtml('myBtn');
  assert.match(html, /id="myBtn"/); assert.match(html, /<svg/); assert.match(text(html), /Deel update via WhatsApp/);
});
test('sendWhatsAppUpdate opens wa.me with the composed message (URL-encoded), in a new tab', () => {
  sampleParentState(); dom.opened.length = 0;
  withFakeNow(NOW, () => sendWhatsAppUpdate(() => 'Hallo & welkom\nTweede regel'));
  assert.deepEqual(dom.opened[0], ['https://wa.me/?text=Hallo%20%26%20welkom%0ATweede%20regel', '_blank', 'noopener,noreferrer']);
});
test('sendWhatsAppUpdate encodes non-ASCII characters as UTF-8 (en dash, arrow, é)', () => {
  sampleParentState(); dom.opened.length = 0;
  withFakeNow(NOW, () => sendWhatsAppUpdate(() => 'MA – Aalsmeer → Alkmaar café'));
  assert.equal(dom.opened[0][0], 'https://wa.me/?text=MA%20%E2%80%93%20Aalsmeer%20%E2%86%92%20Alkmaar%20caf%C3%A9');
});
test('sendWhatsAppUpdate without a builder uses the generic "schema is bijgewerkt" message', () => {
  sampleParentState(); dom.opened.length = 0;
  withFakeNow(NOW, () => sendWhatsAppUpdate());
  assert.match(decodeURIComponent(dom.opened[0][0]), /^https:\/\/wa\.me\/\?text=Het schema is bijgewerkt voor Dinsdag\./);
});
test('wireWhatsAppButton hooks the click to sending that message', () => {
  sampleParentState(); dom.opened.length = 0;
  wireWhatsAppButton('wa-hero', () => 'Test');
  dom.el('wa-hero').onclick();
  assert.equal(dom.opened.length, 1); assert.equal(dom.opened[0][0], 'https://wa.me/?text=Test');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
