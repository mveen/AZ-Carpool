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
import { installFakeDom, sampleParentState, sampleFlexParentState, sampleCoordinatorState, useFakeDb, sampleDbSeed, withFakeNow, NOW, expectSnapshot, resetState, oneP } from './test-support.js';
import { S } from '../state.js';
import { renderMyWeek, matchInfoHtml, goToWijzigen } from '../ui-myweek.js';
import { submitWeekRequests, syncWeekRequests } from '../weekrooster-data.js';
import { PH_PATHS } from '../constants.js';

const dom = installFakeDom();
useFakeDb(sampleDbSeed());
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const kick = new Date('2026-10-03T10:30:00+02:00').getTime();
const matchCarpools = { ev_cal1__e1: { calendarId: 'cal1', eventId: 'e1', teamLabel: 'AZ O15-1', summary: 'AZ O15-1-Hoorn O15-2', location: 'Sportpark Hoorn', startMs: kick, cars: [{ driverFamilyId: 'f1', girlIds: ['f2', 'f4'], departureTime: '09:15' }] } };
const MON = '2026-09-28T10:00:00+02:00';   // Monday of the same week: its rides are "today" (days that are over are not shown any more: design v2)
// Mijn week shows ONE day under the day pills. These helpers draw the week as the sum of its days (each day opened in turn), so a test can
// look for a ride on any day; renderDayAt() draws just one (key = the pill's data-mwday value, or '' for the default day).
function renderDayAt(iso, patch, key = '') { let h = ''; withFakeNow(iso, () => { sampleParentState(patch); S.myWeekDay = key; renderMyWeek(); h = dom.html('tab-myweek'); }); return h; }
function renderAt(iso, patch) {
  const first = renderDayAt(iso, patch);
  const keys = [...first.matchAll(/data-mwday="([^"]*)"/g)].map(m => m[1]);
  return keys.length ? first.slice(0, first.indexOf('</div>', first.indexOf('dayPills')) + 6) + keys.map(k => renderDayAt(iso, patch, k).replace(/^[\s\S]*?<\/div>\s*(?=\S)/, '')).join('') : first;
}
function render(patch) { return renderAt(NOW, patch); }
const dayKey = (y, m, d) => new Date(y, m, d).toDateString();

const NOW_MS = new Date(NOW).getTime();
test('no "Rest van de week" label and no "Laatst bijgewerkt" footer, even when update info exists', () => {
  const h = text(render({ lastUpdateRooster: { by: 'Jan', at: NOW_MS }, lastUpdateDeviation: { by: 'Piet', at: NOW_MS } }));
  assert.doesNotMatch(h, /Rest van de week|Laatst bijgewerkt/i);
  assert.ok(h.length > 100, 'the cards still render');
});

console.log('=== who is looking ===');
test('an unrecognised visitor is asked to reload', () => {
  assert.match(text(render({ me: null })), /Mijn week Kon je account niet herkennen\. Herlaad de pagina\./);
});
test('a visitor who is not linked to a daughter yet is sent to Mijn gezin', () => {
  assert.match(text(render({ me: 'x', links: {} })), /Je hebt geen eigen gezin/);
});

console.log('\n=== loading ===');
test('while the data is still coming in: a spinner, and never "heeft nog geen rit"', () => {
  const h = render({ groupsLoaded: false });
  assert.match(h, /class="spinner"/);
  assert.match(text(h), /Je week wordt geladen/);
  assert.doesNotMatch(text(h), /geen rit|Regelen/);
});
test('each of the five listeners holds the spinner until it has answered', () => {
  for (const k of ['familiesLoaded', 'groupsLoaded', 'deviationsLoaded', 'periodsLoaded', 'periodCarsLoaded']) {
    assert.match(render({ [k]: false }), /class="spinner"/, k);
  }
});
test('once everything has answered the rides are drawn, without a spinner', () => {
  const h = render({});
  assert.doesNotMatch(h, /class="spinner"/);
  assert.match(text(h), /heeft nog geen rit/);
});

test('Rooster and Wijzigen also show the spinner (not half-empty cards) until the data is in', async () => {
  const { renderSchedule } = await import('../ui-schedule.js');
  const { renderDeviationTab } = await import('../ui-deviation.js');
  withFakeNow(NOW, () => { sampleParentState({ groupsLoaded: false }); renderSchedule(); renderDeviationTab(); });
  assert.match(dom.html('tab-schedule'), /class="spinner"/);
  assert.match(dom.html('tab-deviation'), /class="spinner"/);
  withFakeNow(NOW, () => { sampleParentState({}); renderSchedule(); renderDeviationTab(); });
  assert.doesNotMatch(dom.html('tab-schedule'), /class="spinner"/);
  assert.doesNotMatch(dom.html('tab-deviation'), /class="spinner"/);
});

console.log('\n=== a parent\'s week ===');
test('there is no hero card any more: the week starts with the rides to arrange (alert cards with a Regelen button)', () => {
  const s = text(render({}));
  assert.doesNotMatch(s, /plekken/);
  assert.match(s, /Tijden wijzigen Do heen · aankomst 10:15 Jahaimy heeft nog geen rit Regelen Do terug · klaar 18:00 Jahaimy heeft nog geen rit Regelen Donderdag 1 okt/);
});
test('Monday (today): rides along with Jan (heen), drives herself (terug) with everyone in the car', () => {
  const s = text(renderAt(MON, {}));
  assert.match(s, /Maandag 28 sep 07:30 Heen Chauffeur Jan Jansen Busstation → AFC (&#39;|')34 Jahaimy aanwezig om 08:30/);
  assert.match(s, /17:30 Terug Chauffeur Jij rijdt AFC (&#39;|')34 → Busstation Passagiers Eline, Jahaimy, Saar Jahaimy klaar om 17:30/);
});
test('days that are over (Monday and Tuesday on a Wednesday) are not shown any more', () => {
  const s = text(render({})); assert.doesNotMatch(s, /Maandag|Dinsdag|Eerder deze week/);
});
test('a ride with a deviation this week is tagged "Gewijzigd", also when she has no car yet', () => {
  const s = text(renderAt(MON, {}));
  assert.match(s, /Dinsdag 29 sep 10:15 Heen Gewijzigd Chauffeur Nog geen rit Busstation → AFC (&#39;|')34/);
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
  assert.match(s, /Zaterdag 3 okt 09:15 vertrek Wedstrijd AZ O15-1 \(Thuis\) vs Hoorn O15-2 Jan Jansen Vertrek vanaf Busstation Aftrap 10:30 · Sportpark Hoorn/);
  expectSnapshot('ui-myweek', 'parent with match carpool', dom.html('tab-myweek'));
});
test('after Friday 19:00 the match carpool of this weekend stays in Mijn week (the week rolls over, the weekend match does not vanish)', () => {
  const s = text(renderAt('2026-10-02T19:02:00+02:00', { matchCarpools, matchFeeds: [{ calendarId: 'cal1', label: 'AZ O15-1' }] }));
  assert.match(s, /Zaterdag 3 okt 09:15 vertrek Wedstrijd AZ O15-1/);
});
test('the cards run in date order: this weekend\'s match comes before next Monday', () => {
  const h = renderAt('2026-10-02T19:02:00+02:00', { matchCarpools, matchFeeds: [{ calendarId: 'cal1', label: 'AZ O15-1' }] });
  const sat = h.indexOf('Zaterdag'), mon = h.indexOf('Maandag');
  assert.ok(sat > -1, 'Saturday card is there');
  assert.ok(mon === -1 || sat < mon, 'Saturday before Monday');
});
test('matchInfoHtml: team, home/away, opponent, date, time and location (HTML-escaped)', () => {
  resetState({ matchFeeds: [{ calendarId: 'c', label: 'AZ <O15>' }] });
  const html = matchInfoHtml({ calendarId: 'c', summary: 'AZ O15-1-Hoorn O15-2', location: 'A&B', start: new Date(kick) });
  assert.match(text(html), /za 3 okt.*aftrap 10:30.*AZ &lt;O15&gt; \(Thuis\) vs Hoorn O15-2.*A&amp;B/);
});
test('matchInfoHtml: an away match', () => {
  resetState({});
  assert.match(text(matchInfoHtml({ summary: 'Ajax O15-1-AZ O15-1', teamLabel: 'AZ', start: new Date(kick) })), /\(Uit\) vs Ajax O15-1/);
});

test('matchInfoHtml uses the shared classes (matchInfo, noteLine), no inline font size', () => {
  resetState({ matchFeeds: [{ calendarId: 'c', label: 'AZ' }] });
  const html = matchInfoHtml({ calendarId: 'c', summary: 'AZ O15-1-Hoorn O15-2', location: 'Hoorn', start: new Date(kick) });
  assert.match(html, /class="matchInfo"/); assert.match(html, /class="tag tag--match"/); assert.match(html, /class="matchKick"/); assert.doesNotMatch(html, /font-size/);
});

console.log('\n=== navigation ===');
test('goToWijzigen remembers the chosen day for the Wijzigen tab', () => {
  sampleFlexParentState(); goToWijzigen('Di'); assert.equal(S.deviationDay, 'Di');
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
  const s = text(renderAt(MON, { me: 'p9', links: { p9: { familyId: 'f9' } }, families: fams, deviations: dev }));
  assert.doesNotMatch(s, /heeft nog geen rit/);
  assert.match(s, /Maandag 28 sep/); assert.match(s, /Jan Jansen/); assert.doesNotMatch(s, /09:00|16:00|Aanwezig om/, 'no fixed times for a Flex daughter');
  assert.doesNotMatch(s, /Donderdag 1 okt/);
});
test('a Flex driver in a parent\'s ride line is shown by name, without a pill', () => {
  const fams = sampleParentState().families;
  fams.f9 = { parentName: 'Lotte Flex', girlName: 'Lotte', familyType: 'flex', capacity: 3, parentPhone1: '0677777777', schedule: {}, availability: {} };
  const dev = { Ma_heen: { day: 'Ma', direction: 'heen', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f9', girlIds: ['f9', 'f2'], departureTime: '07:30' }] } };
  const html = renderAt(MON, { families: fams, deviations: dev });
  assert.match(html, /Lotte Flex/); assert.doesNotMatch(html, /flexBadge|speelster-chauffeur/);
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
  assert.match(s, /– Terug Chauffeur Jahaimy rijdt niet mee AFC (&#39;|')34 → Busstation/);
  assert.match(html, /class="switch" role="switch" aria-checked="false"[^>]*data-ovtoggle="Do" data-ovdir="terug" data-ovon="0"/);
  assert.match(html, /class="rideRow rideRow--off"/);
  assert.doesNotMatch(s, /Toch meerijden/);
  assert.doesNotMatch(s, /Donderdag terug · klaar 18:00 Jahaimy heeft nog geen rit/);
});
test('an unmarked, unplanned ride still gets the "Regelen" alert', () => {
  assert.match(text(render({})), /Do heen · aankomst 10:15 Jahaimy heeft nog geen rit Regelen/);
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
  const html = renderAt(MON, {});
  assert.match(text(html), /07:30 Heen Chauffeur Jan Jansen Busstation → AFC (&#39;|')34/);
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
  assert.match(html, /<div role="button" tabindex="0" class="matchTile" data-gomatchcarpool="1">/);
  assert.match(text(html), /za 3 okt · AZ O15-1 \(Uit\) · Ajax O15-1 De Toekomst, Amsterdam Aftrap 10:00 · carpool nog niet geregeld/);
  assert.match(text(html), /Zaterdag 3 okt za 3 okt · AZ O15-1/);                    // the tile is folded under the day it is played on
  assert.match(html, /matchTile__title.*<div class="matchTile__loc"><a class="geoLink" href="geo:0,0\?q=De%20Toekomst%2C%20Amsterdam".*matchTile__sub/s);   // US-22: the route link stays in Mijn week, directly under the title
});
await testAsync('the match of this week is a folded line under its own day (Saturday); "Volgende week" is last', async () => {
  useFakeDb(sampleDbSeed()); sampleParentState({}); syncWeekRequests(); await new Promise(r => setImmediate(r));
  await withFakeNowAsync(NOW, () => submitWeekRequests('next', { Ma: { rides: true, heen: '08:15', terug: '17:00' } }));
  const m = { calendarId: 'cal1', eventId: 'e5', summary: 'Ajax O15-1-AZ O15-1', location: 'De Toekomst, Amsterdam', start: new Date('2026-10-03T10:00:00+02:00') };
  Object.assign(S, { matchesSource: 'live', matches: [m], matchFeeds: [{ calendarId: 'cal1', label: 'AZ O15-1' }] });   // keep the request that was just handed in
  withFakeNow(NOW, () => { S.myWeekDay = dayKey(2026, 9, 3); renderMyWeek(); });
  const html = dom.html('tab-myweek');
  assert.match(html, /sectionHead__title">Volgende week/, 'the next-week block is on the page');
  const iDay = html.indexOf('class="dayHead"'), iTile = html.indexOf('class="matchTile"'), iNext = html.indexOf('sectionHead__title">Volgende week');
  assert.ok(iDay >= 0 && iTile > iDay, 'the tile sits under the heading of its day'); assert.ok(iNext > iTile, '"Volgende week" comes after the day');
  assert.doesNotMatch(html, /sectionHead__title">Wedstrijden/, 'no separate "Wedstrijden" block any more');
  withFakeNow(NOW, () => { S.myWeekDay = dayKey(2026, 9, 1); renderMyWeek(); });
  assert.doesNotMatch(dom.html('tab-myweek'), /class="matchTile"/, 'another day shows no match');
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
  const s = text(renderAt(MON, { ...period40(), deviations: {} }));
  assert.match(s, /Dinsdag 29 sep 08:00 Heen Chauffeur Kees de Vries Busstation → AFC (&#39;|')34 Jahaimy aanwezig om 09:00/);
  assert.match(s, /12:00 Terug Chauffeur Kees de Vries AFC (&#39;|')34 → Busstation Jahaimy klaar om 12:00/);
});
test('a day she does not ride is gone, and is not reported as "niet ingepland"', () => {
  const s = text(renderAt(MON, { ...period40(), deviations: {} }));
  assert.doesNotMatch(s, /aandag/);
});
test('outside the days with a temporary rooster the week is exactly as before', () => {
  const s = text(render({ ...period40(), deviations: {} }));
  assert.match(s, /Do heen · aankomst 10:15/); assert.match(s, /Vr heen · aankomst 11:00/);
  assert.equal(text(render({ periods: {} })), text(render({})));
});
test('the pill "Gewijzigd" sits in the time column of the ride, under "vertrek", and not next to the driver', () => {
  const dev = { Di_terug: { day: 'Di', direction: 'terug', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '12:30' }] } };
  const html = renderAt(MON, { ...period40(), deviations: dev });
  assert.match(html, /<div class="rideRow__sub">was 12:00<\/div><span class="tag tag--warn">Gewijzigd<\/span><\/div>/); assert.doesNotMatch(html, /<s>12:00/, 'was {time} is not struck through');
  assert.ok(html.indexOf('tag--warn">Gewijzigd') < html.indexOf('rideRow__mid', html.indexOf('tag--warn">Gewijzigd')), 'the pill is in the time column, before the driver column');
});
test('the driver button ends in a (neutral) phone icon, not in ">"', () => {
  const html = renderAt(MON, { ...period40() });
  const i = html.indexOf('class="roundBtn" data-contact'); assert.ok(i > -1, 'a round contact button');
  const btn = html.slice(i, html.indexOf('</button>', i));
  assert.ok(btn.includes(PH_PATHS['phone']), 'phone icon'); assert.ok(!btn.includes(PH_PATHS['caret-right']), 'no caret'); assert.match(btn, /aria-label="Neem contact op met /);
});
test('a one-off change from Wijzigen goes before the temporary rooster', () => {
  const dev = { Di_terug: { day: 'Di', direction: 'terug', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '12:30' }] } };
  const s = text(renderAt(MON, { ...period40(), deviations: dev }));
  assert.match(s, /12:30 Terug was 12:00 Gewijzigd Chauffeur Jan Jansen AFC (&#39;|')34 → Busstation Jahaimy klaar om 12:00/);
});

test('passengers in a car are listed A-Z, whatever order they were added in', () => {
  const s = text(renderAt(MON, {}));
  const m = s.match(/Passagiers [A-Za-z, ]+/);
  assert.ok(m);
  for (const line of s.match(/(?:[A-Z][a-z]+, )+[A-Z][a-z]+/g) || []) {
    const parts = line.split(', ');
    assert.deepEqual(parts, [...parts].sort((a, b) => a.localeCompare(b, 'nl')), line);
  }
});

test('design v2: no "je dochter" any more; the alert names the daughter', () => {
  assert.match(text(render({})), /Jahaimy heeft nog geen rit/); assert.doesNotMatch(text(render({})), /[Jj]e dochter/);
});

test('Afwijkend weekrooster: Mijn week shows the day coordinator\'s action card only for the days this person decides', () => {
  const req = { weekKey: '2026-W40', day: 'Do', familyId: 'f3', rides: true, heen: '11:00', terug: '18:00', status: 'pending', createdAt: 1, updatedAt: 1 };
  useFakeDb(sampleDbSeed());
  sampleParentState({ dayCoordinators: { Do: 'f2' }, dayRequests: { '2026-W40_Do_f3': req } });
  withFakeNow(NOW, () => renderMyWeek()); assert.match(dom.html('tab-myweek'), /data-wraction="Do"/);
  S.dayCoordinators = { Do: 'f3' }; withFakeNow(NOW, () => renderMyWeek()); assert.doesNotMatch(dom.html('tab-myweek'), /data-wraction/);
});

import { assertNoUnusedImports } from './test-support.js';
test('ui-myweek.js imports nothing it does not use', () => assertNoUnusedImports('ui-myweek.js'));

test('a match ride says where the car leaves from (Busstation by default); a practice match is called Oefenwedstrijd', () => {
  const doc = { ...matchCarpools.ev_cal1__e1, eventId: 'practice_p1', cars: [{ driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '09:15', fromId: 'ATC' }] };
  const s = text(render({ matchCarpools: { ev_cal1__practice_p1: doc }, matchFeeds: [{ calendarId: 'cal1', label: 'AZ O15-1' }] }));
  assert.match(s, /Oefenwedstrijd AZ O15-1 \(Thuis\) vs Hoorn O15-2/); assert.match(s, /Vertrek vanaf ATC/);
  assert.match(text(render({})) + text(render({ matchCarpools, matchFeeds: [{ calendarId: 'cal1', label: 'AZ O15-1' }] })), /Vertrek vanaf Busstation/);
});
test('matchInfoHtml: a practice match gets the Oefen tag, a calendar match does not', () => {
  resetState({ matchFeeds: [{ calendarId: 'c', label: 'AZ O15-1' }] });
  const base = { calendarId: 'c', summary: 'AZ O15-1-Hoorn O15-2', location: 'X', start: new Date(kick) };
  assert.match(text(matchInfoHtml({ ...base, eventId: 'practice_p1' })), /za 3 okt Oefen aftrap 10:30/);
  assert.doesNotMatch(text(matchInfoHtml({ ...base, eventId: 'e1' })), /Oefen/);
});

test('Afwijkend weekrooster: Mijn week shows "Tijden wijzigen" for a family with a daughter of their own (not Flex); Testweergave shows that family\'s week', () => {
  useFakeDb(sampleDbSeed());
  sampleFlexParentState({}); withFakeNow(NOW, () => renderMyWeek()); assert.doesNotMatch(dom.html('tab-myweek'), /wrChange/);
  sampleParentState({}); withFakeNow(NOW, () => renderMyWeek()); assert.match(dom.html('tab-myweek'), /id="wrChange"/);
  sampleCoordinatorState({ canEdit: false });
  withFakeNow(NOW, () => renderMyWeek()); assert.match(dom.html('tab-myweek'), /geen eigen gezin/);
  sampleCoordinatorState({ impersonateFamilyId: 'f2', canEdit: false });
  withFakeNow(NOW, () => renderMyWeek()); assert.match(dom.html('tab-myweek'), /id="wrChange"/);
});

test('goToWijzigen: a Flex family opens the Wijzigen tab on that day; a family with a daughter of their own opens the day editor in Rooster (straight in when they decide that day)', () => {
  sampleFlexParentState({}); withFakeNow(NOW, () => goToWijzigen('Di')); assert.equal(S.deviationDay, 'Di'); assert.equal(S.wrEdit, null);
  sampleParentState({ dayCoordinators: { Di: 'f2' } }); withFakeNow(NOW, () => goToWijzigen('Di')); assert.ok(S.wrEdit && S.wrEdit.day === 'Di'); S.wrEdit = null;
});
await testAsync('Wijzigen "Rijdt niet mee" for a day: Mijn week shows both rides switched off, no "geen rit" line and no warning banner for that day', async () => {
  useFakeDb(sampleDbSeed()); sampleParentState({}); syncWeekRequests(); await new Promise(r => setImmediate(r));
  await withFakeNow(NOW, () => submitWeekRequests('this', { Do: { rides: false, heen: '', terug: '' } }));
  withFakeNow(NOW, () => renderMyWeek());
  const h = dom.html('tab-myweek');
  const rows = [...h.matchAll(/<div class="rideRow rideRow--off"[^>]*data-rideday="Do"[\s\S]*?<\/button>/g)].map(m => m[0]);
  assert.equal(rows.length, 2, 'Thursday heen and terug are both drawn as "rijdt niet mee"');
  rows.forEach(r => { assert.match(r, /aria-checked="false"/); assert.doesNotMatch(r, /class="switch on"/); assert.match(text(r), /rijdt niet mee/); });
  assert.doesNotMatch(h, /data-gowijzig="Do"/, 'no "heeft nog geen rit" warning for a day she does not ride');
});
await testAsync('switching a ride of a "Rijdt niet mee" day back on in Mijn week withdraws the whole-day request, the other ride stays off as its mark; the form shows the new marks', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({}); syncWeekRequests(); await new Promise(r => setImmediate(r));
  await withFakeNowAsync(NOW, () => submitWeekRequests('this', { Do: { rides: false, heen: '', terug: '' } }));
  const press = async dir => {
    const btn = { dataset: { ovtoggle: 'Do', ovon: '0', ovdir: dir } };
    const box = dom.el('tab-myweek'); const q = box.querySelectorAll;
    box.querySelectorAll = sel => sel === '[data-ovtoggle]' ? [btn] : q(sel);
    S.wrForm = { which: 'this', days: {} };   // an old copy of the form
    try { await withFakeNowAsync(NOW, async () => { renderMyWeek(); await btn.onclick(); }); } finally { box.querySelectorAll = q; }
    S.deviations = Object.fromEntries([...fake.store.keys()].filter(k => k.startsWith('deviations/')).map(k => [k.slice(11), fake.get(k)]));   // what the live listener does a moment later
  };
  await press('heen');
  const d = fake.get('weekRequests/2026-W40_Do_f2');
  assert.equal(d.status, 'withdrawn'); assert.ok(!('decidedBy' in d) && !('decidedAt' in d));
  assert.equal(S.weekRequests['2026-W40_Do_f2'].status, 'withdrawn', 'the card reads it at once'); assert.ok(!S.wrForm || (S.wrForm.days.Do.heen === '10:15' && S.wrForm.days.Do.terug === ''), 'no old copy of the form is kept: it is rebuilt from the marks (heen back on, terug still off)');
  assert.ok(!(fake.get('deviations/Do_heen').ovGirlIds || []).length); assert.deepEqual(fake.get('deviations/Do_terug').ovGirlIds, ['f2'], 'terug is still off');
  await press('terug');
  assert.ok(!(fake.get('deviations/Do_terug').ovGirlIds || []).length);
});
console.log('\n=== the driver\'s button "Tijd en plek" ===');
await testAsync('a driver sees "Tijd en plek" under the own ride, and nobody else does', async () => {
  const { sampleDeviations } = await import('./test-support.js');
  const DRV = { Do_terug: { day: 'Do', direction: 'terug', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f2', girlIds: ['f1', 'f2'], reserveFamilyIds: [], departureTime: '18:00' }] } };
  const on = render({ deviations: { ...sampleDeviations(), ...DRV } });
  assert.match(on, /data-drivercar="Do\|terug"/); assert.match(on, /aria-label="Tijd en plek"/);
  assert.doesNotMatch(render({ links: { p1: { familyId: 'f4' } }, deviations: { ...sampleDeviations(), ...DRV } }), /data-drivercar/, 'not my car');
});

test('finding 8: the red initial circle is gone; the line names her ("Jahaimy aanwezig om 08:30")', () => {
  const h = renderAt(MON, {});
  assert.doesNotMatch(h, /daughterTime__initial/);
  assert.match(text(h), /Jahaimy aanwezig om 08:30/); assert.doesNotMatch(text(h), /Aanwezig om/);
});

test('design B: the switch says in words what it does ("rijdt mee")', () => {
  const h = renderAt(MON, {});
  assert.match(h, /class="swWrap"/); assert.match(text(h), /rijdt mee/);
});
test('design B: "terug" says "klaar om", "heen" says "aanwezig om"', () => {
  const s = text(renderAt(MON, {}));
  assert.match(s, /Jahaimy aanwezig om 08:30/); assert.match(s, /Jahaimy klaar om 17:30/);
});

await testAsync('an open request changes HER time in the ride row at once ("klaar om" is hers, not the coordinator\'s); the car and the other days stay as they were', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({}); syncWeekRequests(); await new Promise(r => setImmediate(r));
  await withFakeNowAsync(NOW, () => submitWeekRequests('this', { Do: { rides: true, heen: '12:30', terug: '19:00' } }));
  const day = key => { withFakeNow(NOW, () => { S.myWeekDay = key; renderMyWeek(); }); return text(dom.html('tab-myweek')); };   // no state reset: the request just handed in must stay
  const card = day(dayKey(2026, 9, 1));
  assert.match(card, /aanwezig om 12:30/); assert.match(card, /klaar om 19:00/); assert.doesNotMatch(card, /aanwezig om 10:15/);
  assert.match(day(dayKey(2026, 9, 2)), /aanwezig om 11:00/, 'Friday keeps the standard time');
  assert.ok(!fake.get('deviations/Do_heen'), 'no car was changed: that waits for the day coordinator');
});

console.log('\n=== the redesign: day pills, one card per ride ===');
test('the day pills sit at the top; one day is open (today, else the first day); a tap on another pill opens that day', () => {
  const first = renderDayAt(MON, {});
  assert.ok(first.indexOf('class="dayPills') < first.indexOf('wrChange'), 'pills before everything else');
  assert.match(first, /class="dayPill on dayPill--today" data-mwday="[^"]*" aria-pressed="true"/); assert.match(text(first), /Maandag 28 sep 07:30 Heen/); assert.doesNotMatch(text(first), /Dinsdag 29 sep/);
  const tue = renderDayAt(MON, {}, dayKey(2026, 8, 29)); assert.match(text(tue), /Dinsdag 29 sep 10:15 Heen/); assert.doesNotMatch(text(tue), /Maandag 28 sep 07:30/);
  assert.equal(S.myWeekDay, dayKey(2026, 8, 29));
  const stale = renderDayAt(MON, {}, 'Mon Jan 01 2001'); assert.match(text(stale), /Maandag 28 sep/, 'an unknown day falls back to today');
});
test('the amber dot on a pill marks a day with a ride to arrange; its alert card shows only when that day is open', () => {
  const mon = renderDayAt(MON, {}), tue = renderDayAt(MON, {}, dayKey(2026, 8, 29));
  assert.doesNotMatch(mon, /heeft nog geen rit/); assert.match(tue, /Di heen · aankomst 10:15/); assert.doesNotMatch(tue, /Do heen/);
  assert.equal((mon.match(/dayPill__dot/g) || []).length, 3, 'Tuesday, Thursday and Friday'); assert.doesNotMatch(mon.slice(mon.indexOf('dayPill on'), mon.indexOf('</button>', mon.indexOf('dayPill on'))), /dayPill__dot/);
});
test('every ride is its own white card: time and direction, "Chauffeur", route, and her own time with the switch', () => {
  const h = renderDayAt(MON, {});
  assert.equal((h.match(/class="rideRow[ "]/g) || []).length, 2); assert.doesNotMatch(h, /class="rideCard/);
  assert.match(h, /rideRow__head">\s*<div class="rideRow__time"><div class="rideRow__dep">07:30<\/div><div class="rideRow__sub">Heen<\/div>/);
  assert.match(h, /rideRow__lab">Chauffeur/); assert.match(h, /rideRow__route">[^]*?Busstation → AFC/); assert.match(h, /class="rideRow__kid"/);
  assert.doesNotMatch(h, /class="rideRow__driver|driverOnce|vertrek/, 'the name is plain text, the contact is the round phone button');
});
test('the card you drive has the green edge, the filled "Jij rijdt" badge and a labelled passenger list; another driver\'s card does not', () => {
  const h = renderDayAt(MON, {});
  const [heen, terug] = h.split(/(?=<div class="rideRow[ "])/).filter(x => x.startsWith('<div class="rideRow'));
  assert.doesNotMatch(heen, /rideRow--mine|tag--drive|Passagiers/); assert.match(terug, /^<div class="rideRow rideRow--mine"/); assert.match(terug, /tag tag--drive">[^]*?Jij rijdt/); assert.match(terug, /Passagiers<\/span>Eline, Jahaimy, Saar/);
  assert.match(terug, /class="roundBtn" data-drivercar/, 'Tijd en plek: a round icon button, top right'); assert.match(heen, /class="roundBtn" data-contact="f3"|class="roundBtn" data-contact="f/, 'someone else drives: the round phone button');
});
test('a ride she does not take part in says so (no car, no time) and the switch is off; the other ride of that day stays as it is', () => {
  const dev = { Do_terug: { day: 'Do', direction: 'terug', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [], ovGirlIds: ['f2'], ovFrom: { f2: null } } };
  const h = renderDayAt(NOW, { deviations: dev }, dayKey(2026, 9, 1));
  assert.match(text(h), /10:15 Heen Chauffeur Nog geen rit/); assert.match(text(h), /– Terug Chauffeur Jahaimy rijdt niet mee/); assert.match(h, /aria-checked="false"[^>]*data-ovtoggle="Do" data-ovdir="terug"/);
});
test('the pills never run out of room: up to seven (Ma–Vr plus a weekend match day) have a grid class', () => {
  const css = fs.readFileSync(new URL('../components.css', import.meta.url), 'utf8');
  for (const n of [6, 7]) assert.match(css, new RegExp('\\.dayPills--' + n + '\\{'));
});


console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
