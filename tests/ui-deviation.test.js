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
import { installFakeDom, sampleParentState, sampleCoordinatorState, useFakeDb, sampleDbSeed, withFakeNow, NOW, expectSnapshot, oneP } from './test-support.js';
import { S } from '../state.js';
import { todayKey } from '../constants.js';
import {
  renderDeviationTab, whatsAppButtonHtml, wireWhatsAppButton, sendWhatsAppUpdate, renderDevDirection,
} from '../ui-deviation.js';

const dom = installFakeDom();
useFakeDb(sampleDbSeed());
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const toastText = () => dom.doc.getElementById('toast').innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const kick = new Date('2026-10-03T10:30:00+02:00').getTime();
const feeds = [{ calendarId: 'cal1', label: 'AZ O15-1' }];
const matchCarpools = { ev_cal1__e1: { calendarId: 'cal1', eventId: 'e1', teamLabel: 'AZ O15-1', summary: 'AZ O15-1-Hoorn O15-2', location: 'Sportpark Hoorn', startMs: kick, cars: [{ driverFamilyId: 'f1', girlIds: ['f2', 'f4'], departureTime: '09:15' }] } };
const liveMatch = { calendarId: 'cal1', eventId: 'e2', teamLabel: 'AZ O15-1', summary: 'Ajax O15-1-AZ O15-1', location: 'De Toekomst', start: new Date('2026-10-01T18:00:00+02:00') };
function render(state, patch) { withFakeNow(NOW, () => { state(patch); S.devOpen = {}; S.devKid = null; S.devUndo = null; S.devFree = {}; renderDeviationTab(); }); return dom.html('tab-deviation'); }
// Same, with every ride card unfolded ("Wijzig"): the form with time, driver, place, arrival and children.
const ALL_KEYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr'].flatMap(d => ['heen', 'terug'].flatMap(dir => [0, 1, 2, 3].map(i => `${d}|${dir}|${i}`)));
function renderOpen(state, patch) { withFakeNow(NOW, () => { state(patch); S.devOpen = Object.fromEntries(ALL_KEYS.map(k => [k, true])); S.devKid = null; S.devUndo = null; S.devFree = {}; renderDeviationTab(); }); return dom.html('tab-deviation'); }

console.log('=== day pills (same design as Rooster) ===');
test('shows the week, one pill per day and the content of one day straight away', () => {
  const html = render(sampleParentState, { matches: [liveMatch], matchesSource: 'live', matchFeeds: feeds, deviationDay: null });
  const s = text(html);
  assert.match(s, /^ma 28 di 29 vandaag 30 do 1 vr 2 Eenmalige ritaanpassing voor deze week .* Week 40 · 28 sep – 2 okt\./);
  assert.equal((html.match(/data-devday=/g) || []).length, 5);
  assert.match(html, /class="dayPills"/);
  assert.doesNotMatch(html, /devDayBtn|grid5/);            // the old day tiles are gone
  const day = todayKey || 'Ma';
  assert.match(html, new RegExp(`dayPill devDayPill on[^"]*" data-devday="${day}"`)); // today (or Monday) is open by default
  assert.match(html, /Heen · Aalsmeer → Alkmaar/);          // day content is loaded without an extra tap
  assert.equal(S.deviationDay, day);
});
test('day names are lowercase in the middle of a sentence, capitalised as heading', () => {
  const s = text(render(sampleParentState, { deviationDay: 'Do' }));
  assert.match(s, /Wijzigingen hier gelden alleen voor donderdag deze week .* Donderdag Heen Heen · Aalsmeer → Alkmaar/);
  const yes = text(render(sampleParentState, { deviationDay: 'Do', dayCoordinators: { Do: 'f2' } }));
  assert.match(yes, /Jij bent dagcoördinator op donderdag\./);
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
  assert.match(text(dom.html('tab-deviation')), /Wijzigingen hier gelden alleen voor vrijdag .* Vrijdag Heen/);
  expectSnapshot('ui-deviation', 'parent day pills with a live match', render(sampleParentState, { matches: [liveMatch], matchesSource: 'live', matchFeeds: feeds, deviationDay: 'Ma' }));
});
test('an unknown day falls back to today (or Monday)', () => {
  render(sampleParentState, { deviationDay: 'Zo' });
  assert.equal(S.deviationDay, todayKey || 'Ma');
});

console.log('\n=== match carpools are not in Wijzigen any more (they live in the Wedstrijden tab) ===');
test('with upcoming matches Wijzigen still shows only one-off ride changes: no match carpool section', () => {
  const html = render(sampleParentState, { matches: [liveMatch], matchesSource: 'live', matchFeeds: feeds, deviationDay: 'Ma' });
  assert.doesNotMatch(html, /matchCarpoolCard|Wedstrijdcarpool|data-addmatchcar|Geen wedstrijden/);
});
test('a day does not show a match card of its own, even when a carpool is stored for that day', () => {
  const home = { calendarId: 'cal1', eventId: 'e1', teamLabel: 'AZ O15-1', summary: 'AZ O15-1-Hoorn O15-2', location: 'Sportpark Hoorn', start: new Date(kick) };
  const html = render(sampleParentState, { matchCarpools, matchFeeds: feeds, matches: [home], matchesSource: 'live', deviationDay: 'Vr' });
  assert.doesNotMatch(html, /data-gomatchcarpool|Alleen lezen|matchCarpoolCard/);
});

console.log('\n=== periode met andere tijden: the card sits on top of Wijzigen ===');
const periodDoc = { name: 'Herfstvakantie', firstDay: '2026-10-26', lastDay: '2026-10-30', opensOn: '2026-10-14', deadlineDate: '2026-10-16', deadlineTime: '12:00' };
test('while filling in is open the task card comes before the weekly changes; without a period Wijzigen is as before', () => {
  const html = withFakeNow('2026-10-15T09:00:00+02:00', () => { sampleParentState({ periods: oneP(periodDoc), periodEntries: {}, periodEntriesLoaded: true }); renderDeviationTab(); return dom.html('tab-deviation'); });
  assert.ok(html.indexOf('id="periodTask_2026-10-26"') > -1 && html.indexOf('id="periodTask_2026-10-26"') < html.indexOf('class="dayPills"'));
  assert.doesNotMatch(render(sampleParentState, { deviationDay: 'Ma' }), /periodTask|periodDone/);
});

console.log('\n=== editing one day ===');
test('a parent editing Tuesday sees both directions with drivers, and a way back to the standard rooster', () => {
  const s = text(renderOpen(sampleParentState, { deviationDay: 'Di', matchFeeds: feeds }));
  assert.match(s, /Wijzigingen hier gelden alleen voor dinsdag deze week en verdwijnen dit weekend vanzelf\. = deze week gewijzigd Dinsdag Heen Heen · Aalsmeer/);
  assert.doesNotMatch(s, /Andere dag/);   // no separate day picker screen any more
  assert.match(s, /Heen · Aalsmeer → Alkmaar [\d:-]+ .*? Klaar Vertrek Chauffeur -- geen chauffeur -- Jan Jansen \(geen beschikbaarheid\) Piet Pieters/);
  assert.match(s, /Terug naar standaard rooster/);
  assert.match(s, /Terug · Alkmaar → Aalsmeer Geen ritten gepland in het standaard Rooster voor dit moment\./);
  expectSnapshot('ui-deviation', 'parent editing Tuesday', dom.html('tab-deviation'));
});
test('a driver without availability gets a warning', () => {
  assert.match(text(renderOpen(sampleParentState, { deviationDay: 'Di' })), /Deze ouder heeft voor dit moment geen beschikbaarheid opgegeven/);
});
test('girls who normally do not ride can still be added to a car', () => {
  const s = text(render(sampleCoordinatorState, { deviationDay: 'Ma' }));
  assert.match(s, /Andere meiden Ook meiden die niet standaard meerijden, kun je hier alsnog aan een auto toevoegen\. Anouk Voeg toe aan auto… Auto: Jan Jansen/);
});
test('Monday: the standard cars are the starting point (Eline and Jahaimy with Jan)', () => {
  const s = text(renderOpen(sampleCoordinatorState, { deviationDay: 'Ma' }));
  assert.match(s, /Heen · Aalsmeer → Alkmaar [\d:-]+ .*? Klaar Vertrek Chauffeur -- geen chauffeur -- Jan Jansen/);
  assert.match(s, /Eline[^]*Jahaimy/);
});
test('renderDevDirection returns the block for a single direction', () => {
  sampleCoordinatorState({ deviationDay: 'Ma' });
  const html = withFakeNow(NOW, () => renderDevDirection('Ma', 'terug'));
  assert.match(text(html), /Terug · Alkmaar → Aalsmeer/);
});

// The match carpools moved to the Wedstrijden tab: see ui-matches.test.js.

console.log('\n=== WhatsApp share button ===');
test('the day screen no longer has the generic "Deel update via WhatsApp" button (only the conclusie-appje)', () => {
  const html = render(sampleCoordinatorState, { deviationDay: 'Ma' });
  assert.doesNotMatch(html, /waUpdateBtn|Deel update via WhatsApp/); assert.match(html, /id="conclusieBtn"/);
});
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

import { withFakeNowAsync } from './test-support.js';
import { backupHtml, conclusieCardHtml, flexSignupHtml } from '../ui-deviation.js';
import { shiftLabel } from '../locations.js';
import { locationsCfg } from '../ui-common.js';
import { sampleFamilies as _sampleFamilies } from './test-support.js';

console.log('\n=== conclusie-appje (US-03) ===');
test('the card shows the drafted text: "volgens schema" when nothing changed', () => {
  const s = text(render(sampleParentState, { deviationDay: 'Vr' }));
  assert.match(s, /Conclusie-appje Vrijdag Controleer de tekst en verstuur hem zelf in de groepsapp\. Vrijdag: volgens schema\. Zie Mijn week: https:\/\/mveen\.github\.io\/AZ-Carpool\/#myweek Open in WhatsApp/);
});
test('with a deviation there is one line per change from Wijzigen', () => {
  const html = render(sampleParentState, { deviationDay: 'Di' });
  assert.match(html, /id="conclusieCard"/);
  assert.match(text(html), /Gewijzigde chauffeur\/tijd: heen Kees de Vries 09:15 Rijdt ook mee heen: Eline, Evi Aangepast schema dinsdag 29 sep Heen · Aalsmeer → Alkmaar \(aangepast\): • 09:15 – Kees de Vries: Eline, Evi/);
});
test('the day coordinator sees the card highlighted, other parents do not', () => {
  const yes = render(sampleParentState, { deviationDay: 'Di', dayCoordinators: { Di: 'f2' } });
  assert.match(yes, /class="card conclusieCard forYou"/); assert.match(text(yes), /Jij bent dagcoördinator op dinsdag\. Deel het besluit met de groep\./);
  assert.match(yes, /id="conclusieBtn"/); assert.doesNotMatch(yes, /id="conclusieBtn"[^>]*secondary/);
  const no = render(sampleParentState, { deviationDay: 'Di', dayCoordinators: { Di: 'f3' } });
  assert.doesNotMatch(no, /conclusieCard forYou/); assert.match(no, /id="conclusieBtn"/, 'others can use the card too');
  const other = render(sampleParentState, { deviationDay: 'Wo', dayCoordinators: { Di: 'f2' } });
  assert.doesNotMatch(other, /conclusieCard forYou/, 'being coordinator on Tuesday does not highlight Wednesday');
});
test('the button opens WhatsApp with the text filled in and sends nothing itself', () => {
  render(sampleParentState, { deviationDay: 'Di' }); dom.opened.length = 0;
  withFakeNow(NOW, () => dom.el('conclusieBtn').onclick());
  assert.equal(dom.opened.length, 1);
  const [url, target] = dom.opened[0];
  assert.match(url, /^https:\/\/wa\.me\/\?text=/); assert.equal(target, '_blank');
  assert.match(decodeURIComponent(url.split('text=')[1]), /^Gewijzigde chauffeur\/tijd: heen Kees de Vries 09:15\nRijdt ook mee heen: Eline, Evi\n\nAangepast schema dinsdag 29 sep\n/);
});
test('the card follows the open day', () => {
  sampleParentState({ deviationDay: 'Ma' });
  assert.match(withFakeNow(NOW, () => conclusieCardHtml('Ma')), /Conclusie-appje Maandag/);
});

console.log('\n=== no 1-op-1 WhatsApp buttons any more (design v2) ===');
test('Wijzigen has no direct WhatsApp buttons per driver; contact goes through the name (contact sheet)', () => {
  const html = render(sampleParentState, { deviationDay: 'Di' });
  assert.doesNotMatch(html, /oneOnOne|Stem af met chauffeur|Stem 1-op-1 af/);
  assert.match(html, /data-contact="f4"/);
});

console.log('\n=== Back-up (reserves op Wijzigen) ===');
test('Back-up lists the reserves of the shift and leaves out the driver of the car', () => {
  sampleCoordinatorState({});
  const cars = [{ driverFamilyId: 'f1', girlIds: ['f1', 'f2'], departureTime: '07:30' }];
  const s = text(withFakeNow(NOW, () => backupHtml('Ma', 'heen', cars))).replace(/ ,/g, ',');
  assert.equal(s, 'Back-up: Piet Pieters, Kees de Vries, Tom Visser');
});
test('a driver of another car in the same shift is not a Back-up', () => {
  sampleCoordinatorState({});
  const cars = [{ driverFamilyId: 'f1', girlIds: ['f1'], departureTime: '07:30' }, { driverFamilyId: 'f2', girlIds: ['f2'], departureTime: '07:30' }];
  const s = text(withFakeNow(NOW, () => backupHtml('Ma', 'heen', cars))).replace(/ ,/g, ',');
  assert.equal(s, 'Back-up: Kees de Vries, Tom Visser');
});
test('each Back-up name opens the contact sheet with the ask for the time of the ride; your own name is plain text', () => {
  sampleParentState({ links: { p1: { familyId: 'f2' } } });   // Piet is a reserve himself
  const cars = [{ driverFamilyId: 'f1', girlIds: ['f1', 'f2'], departureTime: '07:30' }];
  const html = withFakeNow(NOW, () => backupHtml('Ma', 'heen', cars));
  assert.match(html, /data-contact="f3" data-contact-text="Hi! Zou jij de rit heen van maandag 28 september om 07:30 kunnen doen\?"/);
  assert.doesNotMatch(html, /data-contact="f2"/);      // no button for yourself
  assert.doesNotMatch(html, /wa\.me/);
  assert.match(text(html).replace(/ ,/g, ','), /Back-up: Piet Pieters, Kees de Vries, Tom Visser/);
});
test('no Back-up line when nobody is left, or when there is no ride', () => {
  sampleCoordinatorState({});
  assert.equal(backupHtml('Ma', 'heen', []), '');
  const all = [{ driverFamilyId: 'f1', girlIds: ['f1'] }, { driverFamilyId: 'f2', girlIds: ['f2'] }, { driverFamilyId: 'f3', girlIds: ['f3'] }, { driverFamilyId: 'f6', girlIds: ['f6'] }];
  assert.equal(backupHtml('Ma', 'heen', all), '');
});
test('Wijzigen shows the Back-up line for a direction', () => {
  const s = text(render(sampleParentState, { deviationDay: 'Di' }));
  assert.match(s, /Back-up: Piet Pieters, Mo Bakker/);
});

console.log('\n=== Flex aanmelden (US-05) ===');
const flexFamily = { parentName: 'Lotte Flex', girlName: 'Lotte', familyType: 'flex', capacity: 3, parentPhone1: '0677777777', parentPhone2: '', phoneKeys: ['0677777777'], schedule: {}, availability: {} };
function flexParent(patch = {}) { return sampleParentState({ me: 'p9', links: { p9: { familyId: 'f9' } }, families: { ..._sampleFamilies(), f9: flexFamily }, ...patch }); }
test('a Flex parent sees a signup block per direction, with time, car choice, ride-along and drive-yourself', () => {
  const html = render(flexParent, { deviationDay: 'Ma' });
  assert.equal((html.match(/class="fold group flexSignup"/g) || []).length, 2);
  assert.doesNotMatch(html, /<details[^>]*flexSignup[^>]* open/); // collapsed by default
  const s = text(html);
  assert.match(s, /Flex: aanmelden voor deze dag Flex-leden rijden alleen mee op dagen dat ze zich aanmelden\. Lotte Flex Aankomst in Alkmaar/);
  assert.match(s, /Klaar om op te halen/); assert.match(s, /Rij mee/); assert.match(s, /Ik rijd zelf/);
  assert.match(html, /<option value="0">Auto: Jan Jansen<\/option>/);
});
test('a fixed parent does not see the block; the coordinator sees every Flex family', () => {
  const fams = { ..._sampleFamilies(), f9: flexFamily };
  assert.doesNotMatch(render(sampleParentState, { deviationDay: 'Ma', families: fams }), /flexSignup/);
  assert.match(render(sampleCoordinatorState, { deviationDay: 'Ma', families: fams }), /class="fold group flexSignup"/);
});
test('without a Flex family there is no block at all', () => {
  assert.doesNotMatch(render(sampleCoordinatorState, { deviationDay: 'Ma' }), /flexSignup/);
});
test('no free seat: only "ik rijd zelf" is offered; no car of her own: only ride-along', () => {
  flexParent();
  const full = [{ driverFamilyId: 'f5', girlIds: ['f5', 'f6', 'f1'] }];   // f5: capacity 4 = 3 passenger seats, all taken
  const noSeat = withFakeNow(NOW, () => flexSignupHtml('Ma', 'heen', full));
  assert.match(text(noSeat), /Geen auto met een vrije plek\./); assert.match(noSeat, /data-flexdrive/); assert.doesNotMatch(noSeat, /data-flexpass/);
  S.families.f9 = { ...flexFamily, capacity: 1 };
  const noCar = withFakeNow(NOW, () => flexSignupHtml('Ma', 'heen', [{ driverFamilyId: 'f1', girlIds: ['f1'] }]));
  assert.match(text(noCar), /Geen auto beschikbaar om zelf te rijden\./); assert.match(noCar, /data-flexpass/); assert.doesNotMatch(noCar, /data-flexdrive/);
});
test('a Flex girl who is signed up sees "Aangemeld" and a sign-off button instead of the form', () => {
  flexParent();
  const html = withFakeNow(NOW, () => flexSignupHtml('Ma', 'heen', [{ driverFamilyId: 'f1', girlIds: ['f1', 'f9'] }]));
  assert.match(text(html), /Lotte Flex · Aangemeld Afmelden/); assert.match(html, /data-flexoff="Ma\|heen\|f9"/); assert.doesNotMatch(html, /data-flexpass/);
});
test('a Flex driver is marked in the driver dropdown and gets no availability warning', () => {
  const dev = { Ma_heen: { day: 'Ma', direction: 'heen', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f9', girlIds: ['f9'], departureTime: '08:00' }] } };
  const html = renderOpen(flexParent, { deviationDay: 'Ma', deviations: dev });
  assert.match(html, /<option value="f9" selected>Lotte Flex \(speelster-chauffeur\)<\/option>/);
  assert.doesNotMatch(html, /Deze ouder heeft voor dit moment geen beschikbaarheid/);
});

// Runs a signup button handler: the fake page hands out one button for the given selector.
async function clickFlex(selector, key, { time, car } = {}) {
  const btn = { dataset: { [selector.replace(/^\[data-|\]$/g, '')]: key } };
  if (time != null) dom.el('flexTime_' + key).value = time;
  if (car != null) dom.el('flexCar_' + key).value = car;
  const all = dom.doc.querySelectorAll; dom.doc.querySelectorAll = sel => sel === selector ? [btn] : all(sel);
  try { await withFakeNowAsync(NOW, async () => { renderDeviationTab(); await btn.onclick(); }); } finally { dom.doc.querySelectorAll = all; }
}
await testAsync('ride along: she is added to the chosen car in a deviation, and the departure moves earlier when needed', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'families/f9': flexFamily });
  flexParent({ deviationDay: 'Ma' }); S.settings.travelLeadMinutes = 60;
  await clickFlex('[data-flexpass]', 'Ma|heen|f9', { time: '07:45', car: '0' });
  const doc = fake.get('deviations/Ma_heen');
  assert.deepEqual(doc.cars[0].girlIds, ['f1', 'f2', 'f9']); assert.equal(doc.cars[0].departureTime, '06:45');
  assert.equal(doc.weekKey, '2026-W40');
  assert.match(toastText(), /Lotte rijdt mee/);
});
await testAsync('drive yourself: a new car with her as driver is added, terug leaves at her ready time', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'families/f9': flexFamily });
  flexParent({ deviationDay: 'Ma' });
  await clickFlex('[data-flexdrive]', 'Ma|terug|f9', { time: '16:30' });
  const cars = fake.get('deviations/Ma_terug').cars;
  assert.equal(cars.length, 2);
  assert.deepEqual(cars[1], { driverFamilyId: 'f9', girlIds: ['f9'], reserveFamilyIds: [], departureTime: '16:30' });
  assert.equal('baseGroupId' in cars[0], false);
  assert.match(toastText(), /Lotte rijdt zelf/);
});
await testAsync('no time filled in: nothing is saved and she is asked for a time', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'families/f9': flexFamily });
  flexParent({ deviationDay: 'Ma' });
  await clickFlex('[data-flexdrive]', 'Ma|heen|f9', { time: '' });
  assert.equal(fake.get('deviations/Ma_heen'), undefined); assert.match(toastText(), /Vul eerst een tijd in\./);
});
await testAsync('ride along without choosing a car: nothing is saved', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'families/f9': flexFamily });
  flexParent({ deviationDay: 'Ma' });
  await clickFlex('[data-flexpass]', 'Ma|heen|f9', { time: '08:00', car: '' });
  assert.equal(fake.get('deviations/Ma_heen'), undefined); assert.match(toastText(), /Kies een auto/);
});
await testAsync('sign off: she leaves the car again; her own car disappears when she was alone in it', async () => {
  const dev = { Ma_terug: { day: 'Ma', direction: 'terug', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f2', girlIds: ['f1', 'f2', 'f6'], departureTime: '17:30' }, { driverFamilyId: 'f9', girlIds: ['f9'], departureTime: '16:30' }] } };
  const fake = useFakeDb({ ...sampleDbSeed(), 'families/f9': flexFamily, 'deviations/Ma_terug': dev.Ma_terug });
  flexParent({ deviationDay: 'Ma', deviations: dev });
  await clickFlex('[data-flexoff]', 'Ma|terug|f9');
  assert.deepEqual(fake.get('deviations/Ma_terug').cars.map(c => c.driverFamilyId), ['f2']);
  assert.match(toastText(), /Lotte is afgemeld/);
});
await testAsync('a Flex signup shows up in the conclusie-appje as "Rijdt ook mee"', async () => {
  useFakeDb({ ...sampleDbSeed(), 'families/f9': flexFamily });
  flexParent({ deviationDay: 'Ma' });
  await clickFlex('[data-flexpass]', 'Ma|heen|f9', { time: '08:30', car: '0' });
  S.deviations = { Ma_heen: { day: 'Ma', direction: 'heen', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f1', girlIds: ['f1', 'f2', 'f9'], departureTime: '07:30' }] } };
  assert.match(withFakeNow(NOW, () => conclusieCardHtml('Ma')), /Rijdt ook mee heen: Lotte\n/);
});

console.log('\n=== one-off pickup / drop-off place per ride (US-15) ===');
test('every car has a "Plek (eenmalig)" choice with the default first and the three places', () => {
  const html = renderOpen(sampleParentState, { deviationDay: 'Ma' });
  assert.match(html, /<select class="devLocSel devInput"[^>]*data-day="Ma" data-direction="heen" data-caridx="0"><option value="" selected>Standaard: Busstation<\/option><option value="busstation" >Busstation<\/option><option value="a4-de-hoek" >A4-De Hoek<\/option><option value="de-parel" >De Parel<\/option>/);
});
test('the saved choice is preselected; the default of the direction follows Beheer', () => {
  const dev = { Ma_heen: { day: 'Ma', direction: 'heen', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f1', girlIds: ['f1'], departureTime: '07:30', locationId: 'de-parel' }] } };
  const html = renderOpen(sampleParentState, { deviationDay: 'Ma', deviations: dev, locationsDoc: { defaults: { heen: 'a4-de-hoek', terug: 'busstation' } } });
  assert.match(html, /<option value="" >Standaard: A4-De Hoek<\/option>/); assert.match(html, /<option value="de-parel" selected>De Parel<\/option>/);
});
async function pickPlace(value) {
  const sel = { dataset: { day: 'Ma', direction: 'heen', caridx: '0' }, value };
  const all = dom.doc.querySelectorAll; dom.doc.querySelectorAll = s => s === '.devLocSel' ? [sel] : all(s);
  try { await withFakeNowAsync(NOW, async () => { renderDeviationTab(); await sel.onchange(); }); } finally { dom.doc.querySelectorAll = all; }
}
await testAsync('choosing a place stores it on that car of the deviation only; choosing the default removes it again', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({ deviationDay: 'Ma' });
  await pickPlace('a4-de-hoek');
  assert.equal(fake.get('deviations/Ma_heen').cars[0].locationId, 'a4-de-hoek');
  assert.equal(fake.get('deviations/Ma_terug'), undefined, 'the other direction is untouched');
  S.deviations = Object.fromEntries(fake.collection('deviations'));
  await pickPlace('');
  assert.ok(!('locationId' in fake.get('deviations/Ma_heen').cars[0]));
});

console.log('\n=== during a period with a temporary rooster ===');
test('Wijzigen starts from the temporary rooster on a date where it applies: its car, its departure time, the handed-in times', () => {
  const html = withFakeNow(NOW, () => { sampleParentState({ periods: oneP({ name: 'Startweek', firstDay: '2026-09-28', lastDay: '2026-10-02', opensOn: '2026-09-20', deadlineDate: '2026-09-25', deadlineTime: '12:00' }), deviations: {},
    periodCars: { '2026-09-28_2026-09-29_terug': { periodFirstDay: '2026-09-28', date: '2026-09-29', direction: 'terug', madeAt: 1, by: 'x', cars: [{ driverFamilyId: 'f3', girlIds: ['f2'], departureTime: '12:00' }] } },
    periodEntries: { '2026-09-28_f2': { familyId: 'f2', periodFirstDay: '2026-09-28', days: { '2026-09-29': { heen: '09:00', terug: '12:00' } } } } }); S.devOpen = { 'Di|terug|0': true }; return renderDevDirection('Di', 'terug'); });
  assert.match(html, /type="time"[^>]*value="12:00"|value="12:00"[^>]*type="time"/); assert.match(html, /<option value="f3" selected/);
  assert.doesNotMatch(text(html), /Geen ritten gepland in het standaard Rooster/);
});
test('without a temporary rooster nothing changes for Wijzigen', () => {
  const a = withFakeNow(NOW, () => { sampleParentState({ deviations: {} }); return renderDevDirection('Ma', 'heen'); });
  const b = withFakeNow(NOW, () => { sampleParentState({ deviations: {}, periods: oneP({ name: 'x', firstDay: '2026-09-28', lastDay: '2026-10-02', opensOn: '2026-09-20', deadlineDate: '2026-09-25', deadlineTime: '12:00' }), periodCars: {}, periodEntries: {} }); return renderDevDirection('Ma', 'heen'); });
  assert.equal(a, b);
});

test('the "andere meiden" list is A-Z by daughter name', () => {
  const h = render(sampleCoordinatorState, { deviationDay: 'Di' });
  const names = [...h.matchAll(/<span style="flex:1">([^<]+)<\/span>\s*<select class="devAddSel"/g)].map(m => m[1]);
  assert.ok(names.length > 1);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'nl')));
});

console.log('\n=== compact ride card (Ritkaart): one line closed, "Wijzig" unfolds the form ===');
// Runs the handlers of the rendered page for one selector with the given fake elements.
async function fire(selector, el, ev = 'onclick') {
  const all = dom.doc.querySelectorAll; dom.doc.querySelectorAll = s => s === selector ? [el] : all(s);
  try { await withFakeNowAsync(NOW, async () => { renderDeviationTab(); await el[ev](); }); } finally { dom.doc.querySelectorAll = all; }
}
const dev1 = (cars, dir = 'heen') => ({ Ma_heen: { day: 'Ma', direction: 'heen', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [] }, ['Ma_' + dir]: { day: 'Ma', direction: dir, weekKey: '2026-W40', expiresAt: 1791500000000, cars } });
test('closed: one line with time, driver and route, then the passengers; no form fields', () => {
  const html = render(sampleCoordinatorState, { deviationDay: 'Ma' });
  assert.match(text(html), /Heen · Aalsmeer → Alkmaar 0\d:\d\d Jan Jansen Busstation → AFC (?:'|&#39;)34 Wijzig Eline Jahaimy/);
  assert.match(html, /class="devRideHead" data-devtoggle="Ma\|heen\|0" aria-expanded="false"/);
  assert.doesNotMatch(html, /devDriverSel|devLocSel|devDeptimeInp|data-devdest|devKidMore/);
});
test('open: the button says Klaar and shows time, driver, pickup, arrival (AFC \'34 / ATC) and the children', () => {
  const html = renderOpen(sampleCoordinatorState, { deviationDay: 'Ma' });
  const s = text(html);
  assert.match(s, /Jan Jansen Busstation → AFC (?:'|&#39;)34 Klaar/);
  assert.match(s, /Vertrek Chauffeur .* Ophalen \(alleen deze rit\) .* Aankomst AFC (?:'|&#39;)34 Alkmaar ATC Wijdewormer Kinderen Eline ··· Jahaimy ···/);
  assert.doesNotMatch(s, /AZ Trainingscomplex/);              // the arrival button says ATC
  assert.match(html, /data-devdest="AFC"[^>]*aria-pressed="true"/); assert.match(html, /data-devdest="ATC"[^>]*aria-pressed="false"/);
  assert.match(html, /<option value="__free" >Ander adres…<\/option>/);
  assert.doesNotMatch(html, /devLocText/);                    // the free input only appears after "Ander adres…" (or when it holds a value)
});
await testAsync('"Wijzig" opens one ride, "Klaar" closes it again', async () => {
  render(sampleCoordinatorState, { deviationDay: 'Ma' });
  await fire('[data-devtoggle]', { dataset: { devtoggle: 'Ma|heen|0' } });
  assert.equal(S.devOpen['Ma|heen|0'], true);
  assert.match(text(dom.html('tab-deviation')), /Klaar Vertrek Chauffeur/);
  await fire('[data-devtoggle]', { dataset: { devtoggle: 'Ma|heen|0' } });
  assert.ok(!S.devOpen['Ma|heen|0']); assert.doesNotMatch(dom.html('tab-deviation'), /devDriverSel/);
});
await testAsync('"Ander adres…" opens the free input without saving anything; a typed address shows on the closed line', async () => {
  const fake = useFakeDb(sampleDbSeed()); renderOpen(sampleCoordinatorState, { deviationDay: 'Ma' });
  await fire('.devLocSel', { dataset: { day: 'Ma', direction: 'heen', caridx: '0' }, value: '__free' }, 'onchange');
  assert.equal(fake.get('deviations/Ma_heen'), undefined);
  assert.match(dom.html('tab-deviation'), /<input type="text" class="devLocText devInput"/);
});
await testAsync('arrival: choosing ATC stores it on that car only; the header and the route follow; AFC \'34 is the standard again', async () => {
  const fake = useFakeDb(sampleDbSeed()); renderOpen(sampleCoordinatorState, { deviationDay: 'Ma' });
  await fire('[data-devdest]', { dataset: { day: 'Ma', direction: 'heen', caridx: '0', devdest: 'ATC' } });
  assert.equal(fake.get('deviations/Ma_heen').cars[0].destination, 'ATC');
  assert.equal(fake.get('deviations/Ma_terug'), undefined, 'the other direction is untouched');
  S.deviations = Object.fromEntries(fake.collection('deviations'));
  const s = text(render(sampleCoordinatorState, { deviationDay: 'Ma', deviations: S.deviations }));
  assert.match(s, /Heen · Aalsmeer → Wijdewormer \d\d:\d\d Jan Jansen Busstation → ATC Wijzig/);
  assert.match(s, /Terug · Alkmaar → Aalsmeer/);
  assert.match(withFakeNow(NOW, () => shiftLabel({ departureTime: '08:00', destination: 'ATC' }, 'terug', locationsCfg(), 'Ma')), /^08:00 ATC → Busstation$/);
  await fire('[data-devdest]', { dataset: { day: 'Ma', direction: 'heen', caridx: '0', devdest: 'AFC' } });
  assert.ok(!('destination' in fake.get('deviations/Ma_heen').cars[0]));
});
await testAsync('arrival: when the standard rooster car has ATC as standard, choosing AFC is stored as the one-off change and ATC is not', async () => {
  const seed = sampleDbSeed(); seed['groups/Ma_heen_1'] = { ...seed['groups/Ma_heen_1'], stdDestination: 'ATC' };
  const fake = useFakeDb(seed); renderOpen(sampleCoordinatorState, { deviationDay: 'Ma', groups: Object.fromEntries(Object.entries(seed).filter(([k]) => k.startsWith('groups/')).map(([k, v]) => [k.slice(7), v])) });
  await fire('[data-devdest]', { dataset: { day: 'Ma', direction: 'heen', caridx: '0', devdest: 'AFC' } });
  assert.equal(fake.get('deviations/Ma_heen').cars[0].destination, 'AFC');
  await fire('[data-devdest]', { dataset: { day: 'Ma', direction: 'heen', caridx: '0', devdest: 'ATC' } });
  assert.ok(!('destination' in fake.get('deviations/Ma_heen').cars[0]) || fake.get('deviations/Ma_heen').cars[0].destination === undefined);
});
await testAsync('removing a child shows the result with "Ongedaan" in the card; Ongedaan puts her back', async () => {
  const fake = useFakeDb(sampleDbSeed()); renderOpen(sampleCoordinatorState, { deviationDay: 'Ma' });
  await fire('[data-devkid]', { dataset: { devkid: 'Ma|heen|0|f1' } });
  assert.match(dom.html('tab-deviation'), /data-devremove="1"[^>]*data-girl="f1"|data-girl="f1"[^>]*data-devremove="1"/);
  const before = fake.get('deviations/Ma_heen');
  await fire('.devRemoveBtn', { dataset: { day: 'Ma', direction: 'heen', caridx: '0', girl: 'f1' } });
  assert.ok(!fake.get('deviations/Ma_heen').cars[0].girlIds.includes('f1'));
  assert.match(text(dom.html('tab-deviation')), /verwijderd uit deze auto\. Ongedaan/);
  assert.equal(S.devKid, null);
  await fire('[data-devundo]', { dataset: { devundo: '1' } });
  assert.ok(fake.get('deviations/Ma_heen').cars[0].girlIds.includes('f1'));
  assert.equal(S.devUndo, null); assert.doesNotMatch(dom.html('tab-deviation'), /devToast/);
});
await testAsync('moving a child offers one button per other car and shows "Ongedaan" in the card she left', async () => {
  const cars = [{ driverFamilyId: 'f1', girlIds: ['f1', 'f2'], departureTime: '07:30' }, { driverFamilyId: 'f3', girlIds: ['f6'], departureTime: '07:30' }];
  const fake = useFakeDb({ ...sampleDbSeed(), 'deviations/Ma_heen': dev1(cars).Ma_heen }); const d = { ...dev1(cars) };
  renderOpen(sampleCoordinatorState, { deviationDay: 'Ma', deviations: d });
  await fire('[data-devkid]', { dataset: { devkid: 'Ma|heen|0|f2' } });
  assert.match(text(dom.html('tab-deviation')), /Naar Kees de Vries/);
  assert.match(dom.html('tab-deviation'), /class="devKidBtn danger devRemoveBtn"[^>]*>\s*<svg[^>]*>[^]*?<\/svg>\s*<\/button>/);   // trash icon only, no text
  await fire('[data-devmove]', { dataset: { day: 'Ma', direction: 'heen', caridx: '0', girl: 'f2', devmove: '1' } });
  const saved = fake.get('deviations/Ma_heen').cars;
  assert.ok(!saved[0].girlIds.includes('f2')); assert.ok(saved[1].girlIds.includes('f2'));
  assert.match(text(dom.html('tab-deviation')), /verplaatst\. Ongedaan/);
});

test('Ritbeurs: only while the switch is on does Wijzigen show the segment; off leaves the tab exactly as before', () => {
  const off = render(sampleParentState, { ritbeurs: { on: false } });
  assert.doesNotMatch(off, /data-rbview|segmented/);
  const on = render(sampleParentState, { ritbeurs: { on: true } });
  assert.match(on, /class="segmented"[\s\S]*data-rbview="ritbeurs"/);
  assert.match(on, /Eenmalige ritaanpassing voor deze week/);
  S.rbView = 'ritbeurs';
  const rb = render(sampleParentState, { ritbeurs: { on: true }, rbView: 'ritbeurs' });
  assert.match(text(rb), /Ritten die nog een chauffeur zoeken/); assert.doesNotMatch(rb, /Eenmalige ritaanpassing/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
