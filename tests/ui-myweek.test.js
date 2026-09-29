// Run with: node ui-myweek.test.js
// The Mijn week tab: what one parent sees of their own daughter's week (read-only overview).
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
import { installFakeDom, sampleParentState, useFakeDb, sampleDbSeed, withFakeNow, NOW, expectSnapshot, resetState } from './test-support.js';
import { S } from '../state.js';
import { renderMyWeek, matchInfoHtml, goToWijzigen } from '../ui-myweek.js';

const dom = installFakeDom();
useFakeDb(sampleDbSeed());
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const kick = new Date('2026-10-03T10:30:00+02:00').getTime();
const matchCarpools = { ev_cal1__e1: { calendarId: 'cal1', eventId: 'e1', teamLabel: 'AZ O15-1', summary: 'AZ O15-1-Hoorn O15-2', location: 'Sportpark Hoorn', startMs: kick, cars: [{ driverFamilyId: 'f1', girlIds: ['f2', 'f4'], departureTime: '09:15' }] } };
function render(patch) { withFakeNow(NOW, () => { sampleParentState(patch); renderMyWeek(); }); return dom.html('tab-myweek'); }

console.log('=== who is looking ===');
test('an unrecognised visitor is asked to reload', () => {
  assert.match(text(render({ me: null })), /Mijn week Kon je account niet herkennen\. Herlaad de pagina\./);
});
test('a visitor who is not linked to a daughter yet is sent to Mijn gezin', () => {
  assert.match(text(render({ me: 'x', links: {} })), /Koppel eerst je dochter via 'Mijn gezin'/);
});

console.log('\n=== a parent\'s week ===');
test('header: daughter, parent and passenger seats', () => {
  assert.match(text(render({})), /^Jahaimy Ouder: Piet Pieters · 4 passagiersplekken/);
});
test('rides to arrange are listed first, with a Regelen button', () => {
  const s = text(render({}));
  assert.match(s, /Jahaimy heeft nog geen rit Donderdag · Heen \(10:15\): niet ingepland Regelen/);
});
test('Monday: rides along with Jan (heen), drives herself (terug) with everyone in the car', () => {
  const s = text(render({}));
  assert.match(s, /MA 28 sep 08:30 \/ 17:30 Heen · Aalsmeer → Alkmaar 07:30 Rijdt mee met: Jan Jansen/);
  assert.match(s, /Terug · Alkmaar → Aalsmeer 17:30 Jij rijdt · Eline, Jahaimy, Saar/);
});
test('a day with a deviation this week says "Wijziging actief"', () => {
  const s = text(render({}));
  assert.match(s, /DI 29 sep 10:15 \/ 17:30 Heen · Aalsmeer → Alkmaar 10:15 niet ingepland Wijziging actief/);
});
test('days without any time for this girl are not shown (Wednesday)', () => {
  assert.ok(!/WO 30/.test(text(render({}))));
});
test('the WhatsApp share button is present', () => {
  assert.match(render({}), /id="wa-hero"/);
});
test('the day cards are pinned as a snapshot', () => { expectSnapshot('ui-myweek', 'parent Jahaimy', render({})); });

console.log('\n=== a match carpool ===');
test('a Saturday match carpool appears under its own day with the ride details', () => {
  const s = text(render({ matchCarpools, matchFeeds: [{ calendarId: 'cal1', label: 'AZ O15-1' }] }));
  assert.match(s, /ZA 3 okt Wedstrijd Wedstrijd: AZ O15-1 \(Thuis\) vs Hoorn O15-2 09:15 Rijdt mee met: Jan Jansen Aftrap 10:30 · Sportpark Hoorn/);
  expectSnapshot('ui-myweek', 'parent with match carpool', dom.html('tab-myweek'));
});
test('matchInfoHtml: team, home/away, opponent, date, time and location (HTML-escaped)', () => {
  resetState({ matchFeeds: [{ calendarId: 'c', label: 'AZ <O15>' }] });
  const html = matchInfoHtml({ calendarId: 'c', summary: 'AZ O15-1-Hoorn O15-2', location: 'A&B', start: new Date(kick) });
  assert.match(text(html), /AZ &lt;O15&gt; \(Thuis\) vs Hoorn O15-2 zaterdag 3 oktober · 10:30 · A&amp;B/);
});
test('matchInfoHtml: an away match', () => {
  resetState({});
  assert.match(text(matchInfoHtml({ summary: 'Ajax O15-1-AZ O15-1', teamLabel: 'AZ', start: new Date(kick) })), /\(Uit\) vs Ajax O15-1/);
});

console.log('\n=== navigation ===');
test('goToWijzigen remembers the chosen day for the Wijzigen tab', () => {
  sampleParentState(); goToWijzigen('Di'); assert.equal(S.deviationDay, 'Di');
  goToWijzigen(); assert.equal(S.deviationDay, 'Di'); // no day given: the open day stays
  goToWijzigen(null); assert.equal(S.deviationDay, 'Di');
});



console.log('\n=== Dagcoördinator vandaag and Flex (US-02, US-05) ===');
test('Mijn week shows the day coordinator of tomorrow under the header, with a WhatsApp button', () => {
  const html = render({ dayCoordinators: { Do: 'f3' } });
  assert.match(text(html), /^Jahaimy Ouder: Piet Pieters · 4 passagiersplekken Dagcoördinator morgen: Kees de Vries/);
  assert.match(html, /href="https:\/\/wa\.me\/31633333333\?text=/);
});
test('without a coordinator for tomorrow nothing extra appears', () => {
  assert.doesNotMatch(render({ dayCoordinators: {} }), /Dagcoördinator/);
});
test('a Flex daughter has no "not planned" alerts, and sees only the days she signed up for', () => {
  const fams = sampleParentState().families;
  fams.f9 = { parentName: 'Lotte Flex', girlName: 'Lotte', familyType: 'flex', capacity: 3, parentPhone1: '0677777777',
    schedule: { Ma: { heen: '09:00', terug: '16:00' }, Do: { heen: '09:00', terug: '16:00' } }, availability: {} };
  const dev = { Ma_heen: { day: 'Ma', direction: 'heen', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f1', girlIds: ['f1', 'f9'], departureTime: '07:30' }] } };
  const s = text(render({ me: 'p9', links: { p9: { familyId: 'f9' } }, families: fams, deviations: dev }));
  assert.match(s, /^Lotte Ouder: Lotte Flex/);
  assert.doesNotMatch(s, /heeft nog geen rit/);
  assert.match(s, /MA 28 sep/); assert.match(s, /Rijdt mee met: Jan Jansen/); assert.doesNotMatch(s, /09:00 \/ 16:00/, 'no fixed times for a Flex daughter');
  assert.doesNotMatch(s, /DO 1 okt/);
});
test('a Flex driver is marked "speelster-chauffeur" in a parent\'s ride line', () => {
  const fams = sampleParentState().families;
  fams.f9 = { parentName: 'Lotte Flex', girlName: 'Lotte', familyType: 'flex', capacity: 3, parentPhone1: '0677777777', schedule: {}, availability: {} };
  const dev = { Ma_heen: { day: 'Ma', direction: 'heen', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f9', girlIds: ['f9', 'f2'], departureTime: '07:30' }] } };
  const html = render({ families: fams, deviations: dev });
  assert.match(html, /Lotte Flex <span class="badge flexBadge">speelster-chauffeur<\/span>/);
});

console.log('\n=== Terug met OV, places, distance, route link (US-06, US-15, US-21, US-22) ===');
import { withFakeNowAsync } from './test-support.js';
import { locationLinkHtml } from '../ui-myweek.js';
test('every upcoming terug ride has a "Terug met OV" button (Thursday, Friday); heen never has one', () => {
  const html = render({});
  assert.match(html, /data-ovtoggle="Do" data-ovon="1" aria-pressed="false">Terug met OV<\/button>/);
  assert.match(html, /data-ovtoggle="Vr" data-ovon="1" aria-pressed="false">Terug met OV<\/button>/);
  assert.equal((html.match(/data-ovtoggle=/g) || []).length, 2);
});
test('days that are already past (Monday, Tuesday; "now" is Wednesday) and days without a ride have no button', () => {
  const html = render({});
  ['Ma', 'Di', 'Wo'].forEach(d => assert.ok(!html.includes(`data-ovtoggle="${d}"`), d));
});
test('when marked: status "Terug met OV", no departure time, an undo button, and no "niet ingepland" alert for that ride', () => {
  const dev = { Do_terug: { day: 'Do', direction: 'terug', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [], ovGirlIds: ['f2'], ovFrom: { f2: null } } };
  const html = render({ deviations: dev }); const s = text(html);
  assert.match(s, /Terug · Alkmaar → Aalsmeer – Terug met OV Toch met de auto/);
  assert.match(html, /data-ovtoggle="Do" data-ovon="0" aria-pressed="true"/);
  assert.doesNotMatch(s, /Terug \(17:30\): niet ingepland/);
});
test('an unmarked, unplanned ride still gets the "Regelen" alert', () => {
  assert.match(text(render({})), /Donderdag · Heen \(10:15\): niet ingepland/);
});
async function pressOv(day, on) {
  const btn = { dataset: { ovtoggle: day, ovon: on ? '1' : '0' } };
  const box = dom.el('tab-myweek'); const q = box.querySelectorAll;
  box.querySelectorAll = s => s === '[data-ovtoggle]' ? [btn] : q(s);
  try { await withFakeNowAsync(NOW, async () => { sampleParentState(); renderMyWeek(); await btn.onclick(); }); } finally { box.querySelectorAll = q; }
}
await testAsync('pressing the button stores the mark (no reason asked) and confirms', async () => {
  const fake = useFakeDb(sampleDbSeed());
  await pressOv('Ma', true);
  const d = fake.get('deviations/Ma_terug');
  assert.ok(d.ovGirlIds.includes('f2')); assert.ok(!d.cars[0].girlIds.includes('f2'));
  assert.match(dom.doc.getElementById('toast').innerHTML, /Jahaimy gaat terug met OV/);
});
test('the ride shows where it starts and ends, as plain text without a map button', () => {
  const html = render({});
  assert.match(text(html), /07:30 Busstation → AFC (&#39;|')34/);
  assert.doesNotMatch(html, /geoBtn|Kaart/);
});
function withUserAgent(ua, fn) { const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua }, configurable: true }); try { return fn(); } finally { if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator; } }
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126 Mobile', IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/605.1', LAPTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126';
test('US-22: on iPhone and laptop the location is a Google Maps link, on Android a geo link', () => {
  assert.match(withUserAgent(IPHONE, () => locationLinkHtml('De Toekomst, Amsterdam')), /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=De%20Toekomst%2C%20Amsterdam"/);
  assert.match(withUserAgent(LAPTOP, () => locationLinkHtml('De Toekomst')), /href="https:\/\/www\.google\.com\/maps\//);
  assert.match(withUserAgent(ANDROID, () => locationLinkHtml('De Toekomst')), /href="geo:0,0\?q=De%20Toekomst"/);
});
test('US-22: the match location is a link that plans a route from the phone\'s position (Android: generic geo link)', () => {
  const html = withUserAgent(ANDROID, () => render({ matchesSource: 'live', matches: [{ calendarId: 'cal1', eventId: 'e5', summary: 'Ajax O15-1-AZ O15-1', location: 'De Toekomst, Amsterdam', start: new Date('2026-10-03T10:00:00+02:00') }], matchFeeds: [{ calendarId: 'cal1', label: 'AZ O15-1' }] }));
  assert.match(html, /<a class="geoLink" href="geo:0,0\?q=De%20Toekomst%2C%20Amsterdam" aria-label="Route plannen naar De Toekomst, Amsterdam">De Toekomst, Amsterdam<\/a>/);
  assert.doesNotMatch(html, /google/i);
  assert.doesNotMatch(html, /geo:0,0\?q=Busstation%20Aalsmeer/, 'the start is the current position, not the busstation');
});
test('US-22: the location of a stored match ride is a link too', () => {
  const html = withUserAgent(ANDROID, () => render({ matchCarpools, matchFeeds: [{ calendarId: 'cal1', label: 'AZ O15-1' }] }));
  assert.match(html, /<a class="geoLink" href="geo:0,0\?q=Sportpark%20Hoorn"/);
});
test('US-22: without a location there is no link', () => {
  assert.equal(locationLinkHtml(''), ''); assert.equal(locationLinkHtml(undefined), '');
});
const awayM = { calendarId: 'cal1', eventId: 'e5', summary: 'Ajax O15-1-AZ O15-1', location: 'De Toekomst, Amsterdam', start: new Date('2026-10-03T10:00:00+02:00') };
test('US-21: an away match shows the stored distance', () => {
  resetState({ matchDistances: { ev_cal1__e5: { loc: 'De Toekomst, Amsterdam', km: 25.4 } } });
  assert.match(matchInfoHtml(awayM), /<div class="matchDist">± 25,4 km enkele reis<\/div>/);
});
test('US-21: no location: "locatie onbekend" and no number', () => {
  resetState({});
  const html = matchInfoHtml({ ...awayM, location: '' });
  assert.match(html, /locatie onbekend/); assert.doesNotMatch(html, /km/);
});
test('US-21: AFC/ATC use the fixed distance from Beheer, or say it is not set', () => {
  resetState({ locationsDoc: { fixedKm: { AFC: 36 } } });
  assert.match(matchInfoHtml({ ...awayM, location: "AFC'34" }), /± 36 km enkele reis/);
  assert.match(matchInfoHtml({ ...awayM, location: 'ATC' }), /vaste afstand ATC nog niet ingesteld/);
});
test('US-21: a home match elsewhere shows no distance; a calculation in progress shows nothing without an API key', () => {
  resetState({});
  assert.doesNotMatch(matchInfoHtml({ ...awayM, summary: 'AZ O15-1-Hoorn O15-2', location: 'Sportpark Hoorn' }), /matchDist/);
  assert.doesNotMatch(matchInfoHtml(awayM), /matchDist/);
});

import { initDb, createFirestoreDb } from '../data.js';
import { createFakeFirestore } from './fake-db.js';
test('US-21: with a real API key a match that is still being calculated says so; the placeholder key stays silent', () => {
  const f = createFakeFirestore({});
  const withKey = k => initDb(createFirestoreDb({ sdk: f.sdk, firestoreDb: f.firestoreDb, auth: f.auth, calendarApiKey: 'k', orsApiKey: k }));
  resetState({}); withKey('REALKEY');
  assert.match(matchInfoHtml(awayM), /afstand wordt berekend/);
  withKey('PASTE_YOUR_OPENROUTESERVICE_API_KEY_HERE');
  assert.doesNotMatch(matchInfoHtml(awayM), /matchDist/);
  useFakeDb(sampleDbSeed());
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
