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
test('day names are lowercase in the middle of a sentence, capitalised as heading', () => {
  const s = text(render(sampleParentState, { deviationDay: 'Do' }));
  assert.match(s, /Donderdag Wijzigingen hier gelden alleen voor donderdag deze week/);
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
  assert.match(text(dom.html('tab-deviation')), /Vrijdag Wijzigingen hier gelden alleen voor vrijdag/);
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

console.log('\n=== editing one day ===');
test('a parent editing Tuesday sees both directions with drivers, and a way back to the standard rooster', () => {
  const s = text(render(sampleParentState, { deviationDay: 'Di', matchFeeds: feeds }));
  assert.match(s, / Dinsdag Wijzigingen hier gelden alleen voor dinsdag deze week en verdwijnen dit weekend vanzelf\. Heen · Aalsmeer/);
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
import { conclusieCardHtml, flexSignupHtml, oneOnOneHtml } from '../ui-deviation.js';
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

console.log('\n=== 1-op-1 afstemmen (US-04) ===');
test('every driver on the day gets a WhatsApp button, with the label for the day coordinator\'s role', () => {
  const html = render(sampleParentState, { deviationDay: 'Di' });
  assert.match(html, /href="https:\/\/wa\.me\/31633333333\?text=Hi!%20Over%20de%20rit%20heen%20van%20dinsdag%2029%20september/);
  assert.match(text(html), /WhatsApp Kees de Vries Stem 1-op-1 af, de dagcoördinator deelt het besluit\./);
  assert.match(html, /aria-label="Stem 1-op-1 af met Kees de Vries via WhatsApp"/);
});
test('no button for yourself, for a car without driver, or for a driver without phone number', () => {
  sampleParentState({ links: { p1: { familyId: 'f1' } } });      // Jan drives on Monday (heen)
  const cars = [{ driverFamilyId: 'f1', girlIds: ['f1'] }, { driverFamilyId: null, girlIds: ['f5'] }, { driverFamilyId: 'f5', girlIds: ['f6'] }];
  S.families.f5 = { ...S.families.f5, parentPhone1: '', parentPhone2: '' };
  assert.equal(oneOnOneHtml('Ma', 'heen', cars), '');
});
test('the hint text appears once per direction, not once per driver', () => {
  sampleParentState({ links: { p1: { familyId: 'f6' } } });
  const html = withFakeNow(NOW, () => oneOnOneHtml('Ma', 'heen', [{ driverFamilyId: 'f1', girlIds: ['f1'] }, { driverFamilyId: 'f2', girlIds: ['f2'] }]));
  assert.equal((html.match(/oneOnOneBtn/g) || []).length, 2); assert.equal((html.match(/Stem 1-op-1 af, de dagcoördinator deelt het besluit\./g) || []).length, 1);
});

console.log('\n=== Flex aanmelden (US-05) ===');
const flexFamily = { parentName: 'Lotte Flex', girlName: 'Lotte', familyType: 'flex', capacity: 3, parentPhone1: '0677777777', parentPhone2: '', phoneKeys: ['0677777777'], schedule: {}, availability: {} };
function flexParent(patch = {}) { return sampleParentState({ me: 'p9', links: { p9: { familyId: 'f9' } }, families: { ..._sampleFamilies(), f9: flexFamily }, ...patch }); }
test('a Flex parent sees a signup block per direction, with time, car choice, ride-along and drive-yourself', () => {
  const html = render(flexParent, { deviationDay: 'Ma' });
  assert.equal((html.match(/class="group flexSignup"/g) || []).length, 2);
  const s = text(html);
  assert.match(s, /Flex: aanmelden voor deze dag Flex-leden rijden alleen mee op dagen dat ze zich aanmelden\. Lotte Flex Aankomst in Alkmaar/);
  assert.match(s, /Klaar om op te halen/); assert.match(s, /Rij mee/); assert.match(s, /Ik rijd zelf/);
  assert.match(html, /<option value="0">Auto: Jan Jansen<\/option>/);
});
test('a fixed parent does not see the block; the coordinator sees every Flex family', () => {
  const fams = { ..._sampleFamilies(), f9: flexFamily };
  assert.doesNotMatch(render(sampleParentState, { deviationDay: 'Ma', families: fams }), /flexSignup/);
  assert.match(render(sampleCoordinatorState, { deviationDay: 'Ma', families: fams }), /class="group flexSignup"/);
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
  const html = render(flexParent, { deviationDay: 'Ma', deviations: dev });
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
  const html = render(sampleParentState, { deviationDay: 'Ma' });
  assert.match(html, /<select class="devLocSel"[^>]*data-day="Ma" data-direction="heen" data-caridx="0"><option value="" selected>Standaard: Busstation<\/option><option value="busstation" >Busstation<\/option><option value="a4-de-hoek" >A4-De Hoek<\/option><option value="de-parel" >De Parel<\/option>/);
});
test('the saved choice is preselected; the default of the direction follows Beheer', () => {
  const dev = { Ma_heen: { day: 'Ma', direction: 'heen', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f1', girlIds: ['f1'], departureTime: '07:30', locationId: 'de-parel' }] } };
  const html = render(sampleParentState, { deviationDay: 'Ma', deviations: dev, locationsDoc: { defaults: { heen: 'a4-de-hoek', terug: 'busstation' } } });
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
