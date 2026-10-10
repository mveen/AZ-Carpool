// Run with: node ui-myweek.test.js
// The Mijn week tab: what one parent sees of their own daughter's week (read-only overview).
import assert from 'node:assert/strict';
import fs from 'node:fs';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, sampleParentState, useFakeDb, sampleDbSeed, withFakeNow, NOW, expectSnapshot, resetState, oneP } from './test-support.js';
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
  assert.match(text(render({ me: 'x', links: {} })), /Je hebt geen eigen gezin/);
});

console.log('\n=== a parent\'s week ===');
test('there is no hero card any more: the week starts with the rides to arrange (alert cards with a Regelen button)', () => {
  const s = text(render({}));
  assert.doesNotMatch(s, /plekken/);
  assert.match(s, /^Donderdag heen · aankomst 10:15 Jahaimy heeft nog geen rit Regelen Donderdag terug · klaar 18:00/);
});
test('Monday: rides along with Jan (heen), drives herself (terug) with everyone in the car', () => {
  const s = text(render({}));
  assert.match(s, /Maandag 28 sep 07:30 vertrek Heen · Busstation → AFC (&#39;|')34 Jan Jansen J Op AFC (&#39;|')34 om 08:30/);
  assert.match(s, /17:30 vertrek Terug · AFC (&#39;|')34 → Busstation Jij rijdt Eline, Jahaimy, Saar J Klaar om 17:30/);
});
test('a ride with a deviation this week is tagged "Gewijzigd", also when she has no car yet', () => {
  const s = text(render({}));
  assert.match(s, /Dinsdag 29 sep 10:15 vertrek Heen · Busstation → AFC (&#39;|')34 Nog geen rit Gewijzigd/);
});
test('days without any time for this girl are not shown (Wednesday)', () => {
  assert.ok(!/WO 30/.test(text(render({}))));
});
test('the share button moved to the header (ui-shell); the page itself has none', () => {
  assert.doesNotMatch(render({}), /wa-hero/);
  assert.match(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /id="shareToggle"/);
});
test('the day cards are pinned as a snapshot', () => { expectSnapshot('ui-myweek', 'parent Jahaimy', render({})); });

console.log('\n=== a match carpool ===');
test('a Saturday match carpool appears under its own day with the ride details', () => {
  const s = text(render({ matchCarpools, matchFeeds: [{ calendarId: 'cal1', label: 'AZ O15-1' }] }));
  assert.match(s, /Zaterdag 3 okt 09:15 vertrek Wedstrijd AZ O15-1 \(Thuis\) vs Hoorn O15-2 Jan Jansen Aftrap 10:30 · Sportpark Hoorn/);
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

test('matchInfoHtml uses the shared classes (matchInfo, noteLine), no inline font size', () => {
  resetState({ matchFeeds: [{ calendarId: 'c', label: 'AZ' }] });
  const html = matchInfoHtml({ calendarId: 'c', summary: 'AZ O15-1-Hoorn O15-2', location: 'Hoorn', start: new Date(kick) });
  assert.match(html, /class="matchInfo"/); assert.match(html, /class="noteLine matchWhen"/); assert.doesNotMatch(html, /font-size/);
});

console.log('\n=== navigation ===');
test('goToWijzigen remembers the chosen day for the Wijzigen tab', () => {
  sampleParentState(); goToWijzigen('Di'); assert.equal(S.deviationDay, 'Di');
  goToWijzigen(); assert.equal(S.deviationDay, 'Di'); // no day given: the open day stays
  goToWijzigen(null); assert.equal(S.deviationDay, 'Di');
});



console.log('\n=== Dagcoördinator vandaag and Flex (US-02, US-05) ===');
test('Mijn week shows the day coordinator of tomorrow; the name opens the contact sheet (no direct WhatsApp link)', () => {
  const html = render({ dayCoordinators: { Do: 'f3' } });
  assert.match(text(html), /Dagcoördinator morgen: Kees de Vries/);
  assert.match(html, /<button type="button" class="nameLink" data-contact="f3" data-contact-text="Hi! Een vraag over de carpool van morgen: ">Kees de Vries<\/button>/);
  assert.doesNotMatch(html, /wa\.me/);
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
  assert.doesNotMatch(s, /heeft nog geen rit/);
  assert.match(s, /Maandag 28 sep/); assert.match(s, /Jan Jansen/); assert.doesNotMatch(s, /09:00|16:00|Op AFC/, 'no fixed times for a Flex daughter');
  assert.doesNotMatch(s, /Donderdag 1 okt/);
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
test('every upcoming ride (heen and terug, Thursday and Friday) has a "Rijdt mee" switch, on by default', () => {
  const html = render({});
  assert.match(html, /<button type="button" class="switch on" role="switch" aria-checked="true" aria-label="Rijdt mee Terug Donderdag" data-ovtoggle="Do" data-ovdir="terug" data-ovon="1">/);
  assert.match(html, /aria-label="Rijdt mee Heen Donderdag" data-ovtoggle="Do" data-ovdir="heen" data-ovon="1"/);
  assert.match(html, /data-ovtoggle="Vr" data-ovdir="terug" data-ovon="1"/);
  const found = [...html.matchAll(/data-ovtoggle="(\w+)" data-ovdir="(\w+)"/g)].map(m => m[1] + '_' + m[2]);
  assert.deepEqual(found, ['Do_heen', 'Do_terug', 'Vr_heen', 'Vr_terug']);
});
test('days that are already past (Monday, Tuesday; "now" is Wednesday) and days without a ride have no button', () => {
  const html = render({});
  ['Ma', 'Di', 'Wo'].forEach(d => assert.ok(!html.includes(`data-ovtoggle="${d}"`), d));
});
test('when marked: status "Rijdt niet mee", no departure time, the switch is off, and no "niet ingepland" alert for that ride', () => {
  const dev = { Do_terug: { day: 'Do', direction: 'terug', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [], ovGirlIds: ['f2'], ovFrom: { f2: null } } };
  const html = render({ deviations: dev }); const s = text(html);
  assert.match(s, /– vertrek Terug · AFC (&#39;|')34 → Busstation Jahaimy rijdt niet mee/);
  assert.match(html, /class="switch" role="switch" aria-checked="false"[^>]*data-ovtoggle="Do" data-ovdir="terug" data-ovon="0"/);
  assert.match(html, /class="rideRow rideRow--off"/);
  assert.doesNotMatch(s, /Toch meerijden/);
  assert.doesNotMatch(s, /Donderdag terug · klaar 18:00 Jahaimy heeft nog geen rit/);
});
test('an unmarked, unplanned ride still gets the "Regelen" alert', () => {
  assert.match(text(render({})), /Donderdag heen · aankomst 10:15 Jahaimy heeft nog geen rit Regelen/);
});
async function pressOv(day, on, direction = 'terug') {
  const btn = { dataset: { ovtoggle: day, ovon: on ? '1' : '0', ovdir: direction } };
  const box = dom.el('tab-myweek'); const q = box.querySelectorAll;
  box.querySelectorAll = s => s === '[data-ovtoggle]' ? [btn] : q(s);
  try { await withFakeNowAsync(NOW, async () => { sampleParentState(); renderMyWeek(); await btn.onclick(); }); } finally { box.querySelectorAll = q; }
}
await testAsync('pressing the switch stores the mark (no reason asked) and confirms', async () => {
  const fake = useFakeDb(sampleDbSeed());
  await pressOv('Ma', true);
  const d = fake.get('deviations/Ma_terug');
  assert.ok(d.ovGirlIds.includes('f2')); assert.ok(!d.cars[0].girlIds.includes('f2'));
  assert.match(dom.doc.getElementById('toast').innerHTML, /Jahaimy rijdt niet mee/);
});
await testAsync('pressing the heen switch stores the mark on the heen ride only', async () => {
  const fake = useFakeDb(sampleDbSeed());
  await pressOv('Ma', true, 'heen');
  assert.ok(fake.get('deviations/Ma_heen').ovGirlIds.includes('f2')); assert.equal(fake.get('deviations/Ma_terug'), undefined);
  assert.match(dom.doc.getElementById('toast').innerHTML, /Jahaimy rijdt niet mee/);
});
test('the ride shows where it starts and ends, as plain text without a map button', () => {
  const html = render({});
  assert.match(text(html), /07:30 vertrek Heen · Busstation → AFC (&#39;|')34/);
  assert.doesNotMatch(html, /geoBtn|Kaart/);
});
function withUserAgent(ua, fn) { const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua }, configurable: true }); try { return fn(); } finally { if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator; } }
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126 Mobile', IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/605.1', LAPTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126';
test('US-22: on iPhone and laptop the location is a Google Maps link, on Android a geo link', () => {
  assert.match(withUserAgent(IPHONE, () => locationLinkHtml('De Toekomst, Amsterdam')), /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=De%20Toekomst%2C%20Amsterdam"/);
  assert.match(withUserAgent(LAPTOP, () => locationLinkHtml('De Toekomst')), /href="https:\/\/www\.google\.com\/maps\//);
  assert.match(withUserAgent(ANDROID, () => locationLinkHtml('De Toekomst')), /href="geo:0,0\?q=De%20Toekomst"/);
});
test('US-22: matchInfoHtml(geo) makes the location a route link (Wedstrijd tab); the tile in Mijn week leads there', () => {
  const m = { calendarId: 'cal1', eventId: 'e5', summary: 'Ajax O15-1-AZ O15-1', location: 'De Toekomst, Amsterdam', start: new Date('2026-10-03T10:00:00+02:00') };
  resetState({ matchFeeds: [{ calendarId: 'cal1', label: 'AZ O15-1' }] });
  const info = withUserAgent(ANDROID, () => matchInfoHtml(m, { geo: true }));
  assert.match(info, /<a class="geoLink" href="geo:0,0\?q=De%20Toekomst%2C%20Amsterdam" aria-label="Route plannen naar De Toekomst, Amsterdam">De Toekomst, Amsterdam<\/a>/);
  assert.doesNotMatch(info, /google/i);
  assert.doesNotMatch(info, /geo:0,0\?q=Busstation%20Aalsmeer/, 'the start is the current position, not the busstation');
  const html = withUserAgent(ANDROID, () => render({ matchesSource: 'live', matches: [m], matchFeeds: [{ calendarId: 'cal1', label: 'AZ O15-1' }] }));
  assert.match(html, /<button type="button" class="matchTile" data-gomatchcarpool="1">/);
  assert.match(text(html), /Wedstrijden deze week za 3 okt · AZ O15-1 \(Uit\) · Ajax O15-1 Aftrap 10:00 · carpool nog niet geregeld/);
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
  assert.match(matchInfoHtml(awayM), /<div class="matchDist">± 25,4 km enkele reis · ± € 5,08 carpoolkosten<\/div>/);
});
test('US-21: no location: "locatie onbekend" and no number', () => {
  resetState({});
  const html = matchInfoHtml({ ...awayM, location: '' });
  assert.match(html, /locatie onbekend/); assert.doesNotMatch(html, /km/);
});
test('US-21: AFC/ATC use the fixed distance from Beheer, or say it is not set', () => {
  resetState({ locationsDoc: { fixedKm: { AFC: 36 } } });
  assert.match(matchInfoHtml({ ...awayM, location: "AFC'34" }), /<div class="matchDist">36 km enkele reis · € 7,20 carpoolkosten<\/div>/);   // fixed distance: no "±"
  assert.match(matchInfoHtml({ ...awayM, location: 'ATC' }), /vaste afstand ATC nog niet ingesteld/);
});
test('US-21: a home match elsewhere shows no distance; a calculation in progress shows nothing without an API key', () => {
  resetState({});
  assert.doesNotMatch(matchInfoHtml({ ...awayM, summary: 'AZ O15-1-Hoorn O15-2', location: 'Sportpark Hoorn' }), /matchDist/);
  assert.doesNotMatch(matchInfoHtml(awayM), /matchDist/);
});

test('US-21: with a real API key a match that is still being calculated says so; without a key (or the placeholder) it stays silent', () => {
  resetState({ orsApiKey: 'REALKEY' });
  assert.match(matchInfoHtml(awayM), /afstand wordt berekend/);
  resetState({ orsApiKey: '' });
  assert.doesNotMatch(matchInfoHtml(awayM), /matchDist/);
  resetState({ orsApiKey: 'PASTE_YOUR_OPENROUTESERVICE_API_KEY_HERE' });
  assert.doesNotMatch(matchInfoHtml(awayM), /matchDist/);
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
test('a day shows the handed-in times and the car of the temporary rooster', () => {
  const s = text(render({ ...period40(), deviations: {} }));
  assert.match(s, /Dinsdag 29 sep 08:00 vertrek Heen · Busstation → AFC (&#39;|')34 Kees de Vries J Op AFC (&#39;|')34 om 09:00/);
  assert.match(s, /12:00 vertrek Terug · AFC (&#39;|')34 → Busstation Kees de Vries J Klaar om 12:00/);
});
test('a day she does not ride is gone, and is not reported as "niet ingepland"', () => {
  const s = text(render({ ...period40(), deviations: {} }));
  assert.doesNotMatch(s, /Maandag/);
});
test('outside the days with a temporary rooster the week is exactly as before', () => {
  const s = text(render({ ...period40(), deviations: {} }));
  assert.match(s, /Donderdag heen · aankomst 10:15/); assert.match(s, /Vrijdag heen · aankomst 11:00/);
  assert.equal(text(render({ periods: {} })), text(render({})));
});
test('a one-off change from Wijzigen goes before the temporary rooster', () => {
  const dev = { Di_terug: { day: 'Di', direction: 'terug', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '12:30' }] } };
  const s = text(render({ ...period40(), deviations: dev }));
  assert.match(s, /12:30 vertrek Terug · AFC (&#39;|')34 → Busstation Jan Jansen Gewijzigd J Klaar om 12:00/);
});

test('passengers in a car are listed A-Z, whatever order they were added in', () => {
  const s = text(render({}));
  const m = s.match(/rijdt[^]*?·\s*([^]*?)(?:Regelen|$)/);
  assert.ok(m);
  for (const line of s.match(/(?:[A-Z][a-z]+, )+[A-Z][a-z]+/g) || []) {
    const parts = line.split(', ');
    assert.deepEqual(parts, [...parts].sort((a, b) => a.localeCompare(b, 'nl')), line);
  }
});

test('design v2: no "je dochter" any more; the alert names the daughter', () => {
  assert.match(text(render({})), /Jahaimy heeft nog geen rit/); assert.doesNotMatch(text(render({})), /[Jj]e dochter/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
