// Run with: node matches.test.js
// Weekend/weekday match calendars: parsing the calendar summary, finding the stored carpool for a match,
// the "this week" windows, and fetching from Google Calendar (fetch is replaced by a stub; the database is
// the in-memory fake — nothing here touches the network).
import assert from 'node:assert/strict';
import { isPracticeMatch, practiceIdOf, practiceSummary, practiceToMatch, practiceMatchList, buildPracticeDoc } from '../matches.js';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, resetState, useFakeDb, withFakeNow, withFakeNowAsync, NOW, sampleFamilies } from './test-support.js';
import { S } from '../state.js';
import {
  activeMatchFeeds, matchLabel, analyzeMatch, matchSlug, carpoolFor, matchesThisWeek, matchesNext8Days,
  loadAllMatches, currentMatchList, docToMatch, matchCarpoolsOnDate, myMatchRides, suggestedMatchDeparture, matchCarCapacityState,
} from '../matches.js';

const dom = installFakeDom();
const feeds = [{ calendarId: 'cal1@group.calendar.google.com', label: 'AZ O15-1' }];
const m = (over = {}) => ({ calendarId: 'cal1@group.calendar.google.com', eventId: 'e1', teamLabel: 'AZ O15-1', summary: 'AZ O15-1-Hoorn O15-2', location: '', start: new Date('2026-10-03T10:30:00+02:00'), ...over });

console.log('=== analyzeMatch: which team is the opponent ===');
test('AZ at home: the away team is the opponent', () => {
  assert.deepEqual(analyzeMatch('AZ O15-1-Hoorn O15-2'), { opponent: 'Hoorn O15-2', isHome: true, home: 'AZ O15-1', away: 'Hoorn O15-2' });
});
test('AZ away: the home team is the opponent', () => {
  const a = analyzeMatch('Ajax O15-1-AZ O15-1'); assert.equal(a.opponent, 'Ajax O15-1'); assert.equal(a.isHome, false);
});
test('a numbering hyphen (NFC O15-1) is not the separator — only a hyphen before a letter is', () => {
  const a = analyzeMatch('NFC O15-1-AZ MO15-2'); assert.equal(a.home, 'NFC O15-1'); assert.equal(a.away, 'AZ MO15-2'); assert.equal(a.opponent, 'NFC O15-1');
});
test('a summary without a separator is returned whole', () => {
  assert.deepEqual(analyzeMatch('Training'), { opponent: 'Training', isHome: null, home: 'Training', away: '' });
});

console.log('\n=== labels and ids ===');
test('the team name is looked up live from the Beheer feeds by calendar id, so renames show everywhere', () => {
  resetState({ matchFeeds: [{ calendarId: 'c', label: 'Nieuwe naam' }] });
  assert.equal(matchLabel({ calendarId: 'c', teamLabel: 'Oude naam' }), 'Nieuwe naam');
  assert.equal(matchLabel({ calendarId: 'other', teamLabel: 'Bewaarde naam' }), 'Bewaarde naam');
  assert.equal(matchLabel(null), '');
});
test('matchSlug: calendar id + event id, made safe for a document id', () => {
  assert.equal(matchSlug(m()), 'ev_cal1_group_calendar_google_com__e1');
});
test('matchSlug: old matches without ids fall back to team name + kick-off time', () => {
  resetState({ matchFeeds: feeds });
  assert.equal(matchSlug(m({ eventId: '' })), 'azo151' + '_' + new Date('2026-10-03T10:30:00+02:00').getTime());
});

console.log('\n=== carpoolFor: finding the stored carpool of a match ===');
test('by id first', () => {
  resetState({ matchCarpools: { [matchSlug(m())]: { cars: [1] } } });
  assert.deepEqual(carpoolFor(m()), { id: matchSlug(m()), doc: { cars: [1] } });
});
test('same calendar and kick-off but a re-issued event id is still the same match', () => {
  resetState({ matchCarpools: { ev_old: { calendarId: m().calendarId, startMs: m().start.getTime(), cars: [] } } });
  assert.equal(carpoolFor(m()).id, 'ev_old');
});
test('an old name-keyed document is found by team name and time, and flagged legacy', () => {
  resetState({ matchFeeds: feeds });
  const legacyId = ('AZ O15-1_' + m().start.getTime()).toLowerCase().replace(/[^a-z0-9_]/g, '');
  resetState({ matchFeeds: feeds, matchCarpools: { [legacyId]: { startMs: m().start.getTime(), cars: [] } } });
  const r = carpoolFor(m()); assert.equal(r.id, legacyId); assert.equal(r.legacy, true);
});
test('nothing stored: doc is null, id is where it will be saved', () => {
  resetState({}); assert.deepEqual(carpoolFor(m()), { id: matchSlug(m()), doc: null });
});

console.log('\n=== time windows ===');
test('matchesThisWeek: from now until the end of the planning week, earliest first', () => {
  withFakeNow(NOW, () => {
    const list = [m({ start: new Date('2026-10-01T18:00:00+02:00') }), m({ start: new Date('2026-09-29T18:00:00+02:00') }), m({ start: new Date('2026-10-06T18:00:00+02:00') }), m({ start: new Date('2026-09-30T12:00:00+02:00') })];
    assert.deepEqual(matchesThisWeek(list).map(x => x.start.toISOString()), ['2026-09-30T10:00:00.000Z', '2026-10-01T16:00:00.000Z']);
  });
});
test('on Saturday the window runs to the end of NEXT week; a match later today is still included, one after that week is not', () => {
  withFakeNow('2026-10-03T09:00:00+02:00', () => {
    const list = [m({ start: new Date('2026-10-03T10:30:00+02:00') }), m({ start: new Date('2026-10-06T18:00:00+02:00') }), m({ start: new Date('2026-10-13T18:00:00+02:00') }), m({ start: new Date('2026-10-03T08:00:00+02:00') })];
    assert.deepEqual(matchesThisWeek(list).map(x => x.start.toISOString()), ['2026-10-03T08:30:00.000Z', '2026-10-06T16:00:00.000Z']);
  });
});
test('matchesNext8Days: a rolling window that always shows next Saturday', () => {
  withFakeNow('2026-10-04T09:00:00+02:00', () => { // Sunday
    const list = [m({ start: new Date('2026-10-10T10:30:00+02:00') }), m({ start: new Date('2026-10-13T10:30:00+02:00') }), m({ start: new Date('2026-10-03T10:30:00+02:00') })];
    assert.deepEqual(matchesNext8Days(list).map(x => x.start.toISOString()), ['2026-10-10T08:30:00.000Z']);
  });
});

console.log('\n=== stored carpools ===');
const kick = new Date('2026-10-03T10:30:00+02:00').getTime();
test('docToMatch turns a stored carpool back into a match', () => {
  const d = docToMatch({ calendarId: 'c', eventId: 'e', teamLabel: 'T', summary: 'A-B', location: 'L', startMs: kick });
  assert.equal(d.start.getTime(), kick); assert.equal(d.location, 'L');
  assert.equal(docToMatch({ startMs: kick }).summary, '');
});
test('matchCarpoolsOnDate: only carpools with cars, on that calendar day, earliest first', () => {
  resetState({ matchCarpools: { a: { startMs: kick, cars: [{}] }, b: { startMs: kick - 3600000, cars: [{}] }, c: { startMs: kick, cars: [] }, d: { startMs: kick + 86400000, cars: [{}] } } });
  assert.deepEqual(matchCarpoolsOnDate(new Date(kick)).map(e => e[0]), ['b', 'a']);
});
test('myMatchRides: cars where my family drives or my daughter rides, this planning week only', () => {
  resetState({ matchCarpools: {
    a: { startMs: kick, cars: [{ driverFamilyId: 'f2', girlIds: [] }, { driverFamilyId: 'f1', girlIds: ['f2'] }, { driverFamilyId: 'f1', girlIds: ['f3'] }] },
    later: { startMs: kick + 14 * 86400000, cars: [{ driverFamilyId: 'f2', girlIds: [] }] },
    past: { startMs: new Date('2026-09-20T10:00:00+02:00').getTime(), cars: [{ driverFamilyId: 'f2', girlIds: [] }] },
  } });
  withFakeNow(NOW, () => {
    const rides = myMatchRides('f2');
    assert.equal(rides.length, 2);
    assert.deepEqual(rides.map(r => [r.driving, r.daughter]), [[true, false], [false, true]]);
  });
});
test('suggestedMatchDeparture: three and a half hours before kick-off', () => {
  assert.equal(suggestedMatchDeparture(new Date(2026, 9, 3, 10, 30)), '07:00');
});
test('matchCarCapacityState compares chosen passengers with the driver\'s seats (only a warning)', () => {
  resetState({ families: sampleFamilies() });
  dom.doc.getElementById('matchCarDriver_x').value = 'f1'; // 4 seats total -> 3 passengers
  const s = matchCarCapacityState('x');
  assert.deepEqual(s, { n: 0, cap: 3, driverId: 'f1', over: false });
});

console.log('\n=== Google Calendar fetching ===');
const realFetch = globalThis.fetch;
function stubFetch(handler) { globalThis.fetch = async (url) => handler(String(url)); }
const okBody = { items: [
  { id: 'e1', summary: 'AZ O15-1-Hoorn O15-2', location: 'Hoorn', start: { dateTime: '2026-10-03T10:30:00+02:00' } },
  { id: 'e2', start: { dateTime: '2026-10-04T10:30:00+02:00' } },
  { id: 'e3', summary: 'Zonder tijd' },
] };
await testAsync('loadAllMatches waits until the calendars from Beheer have arrived', async () => {
  resetState({ matchFeedsLoaded: false }); stubFetch(() => { throw new Error('should not fetch'); });
  await loadAllMatches(); assert.deepEqual(S.matches, []);
});
await testAsync('loadAllMatches keeps valid events, calls the API with the key, and caches them in the database', async () => {
  const fake = useFakeDb({});
  resetState({ matchFeeds: feeds, matchFeedsLoaded: true });
  const urls = []; stubFetch(url => { urls.push(url); return { ok: true, json: async () => okBody }; });
  await withFakeNowAsync(NOW, () => loadAllMatches());
  assert.equal(S.matches.length, 1); assert.equal(S.matches[0].eventId, 'e1'); assert.equal(S.matches[0].teamLabel, 'AZ O15-1');
  assert.equal(S.matchesSource, 'live'); assert.deepEqual(S.matchFetchFailedTeams, []);
  assert.match(urls[0], /calendars\/cal1%40group\.calendar\.google\.com\/events\?key=test-key&singleEvents=true/);
  assert.equal(fake.get('settings/matchCache').matches[0].summary, 'AZ O15-1-Hoorn O15-2');
  assert.equal(currentMatchList(), S.matches);
});
await testAsync('a failing calendar is reported with its HTTP status and message', async () => {
  useFakeDb({}); resetState({ matchFeeds: feeds, matchFeedsLoaded: true });
  stubFetch(() => ({ ok: false, status: 403, json: async () => ({ error: { message: 'Forbidden' } }) }));
  await loadAllMatches();
  assert.equal(S.matchFetchFailedTeams.length, 1);
  assert.equal(S.matchFetchFailedTeams[0].label, 'AZ O15-1'); assert.equal(S.matchFetchFailedTeams[0].error, 'HTTP 403 — Forbidden');
});
await testAsync('after a failure the last cached matches from the database are shown, not an empty list', async () => {
  useFakeDb({}); resetState({ matchFeeds: feeds, matchFeedsLoaded: true, matchFetchFailedTeams: [{ label: 'x', error: 'y' }], cachedMatches: [m()] });
  stubFetch(() => { throw new Error('offline'); });
  await loadAllMatches();
  assert.equal(currentMatchList().length, 1);
});
await testAsync('a missing API key is reported instead of calling Google', async () => {
  const fake = useFakeDb({}); fake.sdk.signInAnonymously; resetState({ matchFeeds: feeds, matchFeedsLoaded: true });
  const { initDb, createFirestoreDb } = await import('../data.js');
  initDb(createFirestoreDb({ sdk: fake.sdk, firestoreDb: {}, auth: {}, calendarApiKey: '' }));
  stubFetch(() => { throw new Error('should not fetch'); });
  await loadAllMatches();
  assert.match(S.matchFetchFailedTeams[0].error, /API-key/);
});
test('activeMatchFeeds returns the feeds from Beheer', () => { resetState({ matchFeeds: feeds }); assert.equal(activeMatchFeeds(), S.matchFeeds); });
await testAsync('a calendar that never answers is cut off after the time limit: loading finishes and the cached matches stay (the app does not hang)', async () => {
  useFakeDb({}); resetState({ matchFeeds: feeds, matchFeedsLoaded: true, matchFetchFailedTeams: [{ label: 'x', error: 'y' }], cachedMatches: [m()] });
  stubFetch(() => new Promise(() => {}));
  const keepAlive = setInterval(() => {}, 1000);   // test-support unrefs timers: keep the process alive until the limit fires
  try { await loadAllMatches(); } finally { clearInterval(keepAlive); }
  assert.equal(currentMatchList().length, 1, 'it finished, and the last cached matches are still shown');
});
globalThis.fetch = realFetch;

console.log('\n=== calculateMatchDistances (US-21) ===');
import { initDb, createFirestoreDb } from '../data.js';
import { createFakeFirestore } from './fake-db.js';
import { calculateMatchDistances } from '../matches.js';
import { forgetAttempts } from '../distance.js';
function dbWithKey(seed) { const fake = createFakeFirestore(seed); initDb(createFirestoreDb({ sdk: fake.sdk, firestoreDb: fake.firestoreDb, auth: fake.auth, calendarApiKey: 'k' })); return fake; }
const awayMatch = { calendarId: 'cal1', eventId: 'e9', teamLabel: 'AZ', summary: 'Ajax O15-1-AZ O15-1', location: 'De Toekomst, Amsterdam', start: new Date('2026-10-03T10:00:00+02:00') };
function stubOrs() { const urls = []; globalThis.fetch = async url => { urls.push(url); return { ok: true, json: async () => url.includes('/geocode/') ? { features: [{ geometry: { coordinates: [4.9, 52.3] } }] } : { features: [{ properties: { summary: { distance: 25400 } } }] } }; }; return urls; }
const member = { me: 'p1', links: { p1: { familyId: 'f2' } }, matchDistancesLoaded: true, matchDistances: {}, orsApiKey: 'KEY' };   // the key comes from settings/apiKeys
await testAsync('an away match without a stored distance is calculated once and stored for everyone', async () => {
  forgetAttempts(); const fake = dbWithKey({}); const urls = stubOrs(); resetState(member);
  const calls = await calculateMatchDistances([awayMatch]);
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(fake.get('settings/matchDistances')), ['ev_cal1__e9']);
  assert.equal(fake.get('settings/matchDistances').ev_cal1__e9.km, 25.4);
  assert.equal(S.matchDistances.ev_cal1__e9.loc, 'De Toekomst, Amsterdam');
  assert.match(urls[0], /text=Busstation%20Aalsmeer%2C%20Aalsmeer%2C%20Nederland/);
  assert.equal(await calculateMatchDistances([awayMatch]), 0, 'not calculated again');
});
await testAsync('the address entered for the busstation in Beheer is the starting point', async () => {
  forgetAttempts(); dbWithKey({}); const urls = stubOrs();
  resetState({ ...member, locationsDoc: { places: [{ id: 'busstation', address: 'Stationsweg 1, Aalsmeer' }] } });
  await calculateMatchDistances([awayMatch]);
  assert.match(urls[0], /text=Stationsweg%201%2C%20Aalsmeer/);
});
await testAsync('nothing is calculated without an API key (or with the placeholder), before the stored distances are loaded, or for a non-member', async () => {
  forgetAttempts(); const urls = stubOrs();
  dbWithKey({}); resetState({ ...member, orsApiKey: '' }); assert.equal(await calculateMatchDistances([awayMatch]), 0);
  resetState({ ...member, orsApiKey: 'PASTE_YOUR_OPENROUTESERVICE_API_KEY_HERE' }); assert.equal(await calculateMatchDistances([awayMatch]), 0);
  dbWithKey({}); resetState({ ...member, matchDistancesLoaded: false }); assert.equal(await calculateMatchDistances([awayMatch]), 0);
  resetState({ me: 'x', links: {}, matchDistancesLoaded: true }); assert.equal(await calculateMatchDistances([awayMatch]), 0);
  assert.equal(urls.length, 0);
});
await testAsync('AFC/ATC matches are never calculated; a home match elsewhere is calculated like an away match', async () => {
  forgetAttempts(); dbWithKey({}); const urls = stubOrs(); resetState(member);
  assert.equal(await calculateMatchDistances([{ ...awayMatch, eventId: 'a', location: "AFC'34" }]), 0);
  assert.equal(urls.length, 0);
  assert.equal(await calculateMatchDistances([{ ...awayMatch, eventId: 'b', summary: 'AZ O15-1-Hoorn O15-2', location: 'Sportpark Hoorn' }]), 1);
  assert.equal(urls.length, 3);   // two address lookups and one route
});
await testAsync('when the distance cannot be stored (rules not published) the screen still gets the value', async () => {
  forgetAttempts(); const fake = dbWithKey({}); stubOrs(); resetState(member); fake.failWrites('settings/matchDistances', 'permission-denied');
  await calculateMatchDistances([awayMatch]);
  assert.equal(S.matchDistances.ev_cal1__e9.km, 25.4);
});

console.log('\n=== practice matches ===');
test('a practice summary is split at its own marker: a hyphen in the opponent or a digit at its start is no problem', () => {
  const away = analyzeMatch(practiceSummary('AZ O15-1', 'Spa-Rotterdam O15', false));
  assert.deepEqual([away.opponent, away.isHome, away.home, away.away], ['Spa-Rotterdam O15', false, 'Spa-Rotterdam O15', 'AZ O15-1']);
  const home = analyzeMatch(practiceSummary('AZ O15-1', '1. FC Köln', true));
  assert.deepEqual([home.opponent, home.isHome], ['1. FC Köln', true]);
  assert.doesNotMatch(home.opponent + home.away, /\u200B/);
});
test('practiceToMatch: the shape of a calendar match, event id practice_<id>, team name from Beheer, own carpool id', () => {
  resetState({ matchFeeds: feeds });
  const x = practiceToMatch('abc', { calendarId: feeds[0].calendarId, teamLabel: 'oude naam', opponent: 'FC Volendam O15', isHome: true, location: "AFC '34, Alkmaar", startMs: 1790000000000 });
  assert.equal(x.eventId, 'practice_abc'); assert.equal(isPracticeMatch(x), true); assert.equal(practiceIdOf(x), 'abc');
  assert.equal(matchLabel(x), 'AZ O15-1'); assert.equal(analyzeMatch(x.summary).opponent, 'FC Volendam O15'); assert.equal(analyzeMatch(x.summary).isHome, true);
  assert.equal(matchSlug(x), 'ev_cal1_group_calendar_google_com__practice_abc'); assert.equal(x.start.getTime(), 1790000000000);
  assert.equal(practiceToMatch('d', { calendarId: feeds[0].calendarId, opponent: 'X', isHome: false, startMs: 1 }).summary.endsWith('AZ O15-1'), true);
  assert.equal(isPracticeMatch(m()), false); assert.equal(practiceIdOf(m()), '');
});
test('currentMatchList adds the practice matches to the calendar matches, live or cached; broken documents are left out', () => {
  const p = { calendarId: feeds[0].calendarId, teamLabel: 'AZ O15-1', opponent: 'X', isHome: true, location: 'Y', startMs: 1790000000000 };
  resetState({ matchFeeds: feeds, matches: [m()], matchesSource: 'live', practiceMatches: { p1: p } });
  assert.deepEqual(currentMatchList().map(x => x.eventId), ['e1', 'practice_p1']);
  resetState({ matchFeeds: feeds, matches: [], matchesSource: 'cache', cachedMatches: [m({ eventId: 'c1' })], practiceMatches: { p1: p } });
  assert.deepEqual(currentMatchList().map(x => x.eventId), ['c1', 'practice_p1']);
  resetState({ matchFeeds: feeds, practiceMatches: { kapot: { opponent: 'X' } } });
  assert.deepEqual(currentMatchList(), []); assert.deepEqual(practiceMatchList(), []);
});
const PNOW = new Date('2026-09-30T10:00:00+02:00').getTime();
const pin = (over = {}) => ({ calendarId: feeds[0].calendarId, opponent: '  FC   Volendam O15 ', isHome: true, location: " AFC '34, Alkmaar ", date: '2026-10-03', time: '11:00', ...over });
test('buildPracticeDoc: a valid form becomes the document to store (trimmed, team name from the calendar list, start in local time)', () => {
  const r = buildPracticeDoc(pin(), feeds, PNOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.doc, { calendarId: feeds[0].calendarId, teamLabel: 'AZ O15-1', opponent: 'FC Volendam O15', isHome: true, location: "AFC '34, Alkmaar", startMs: new Date('2026-10-03T11:00:00+02:00').getTime() });
  assert.equal(buildPracticeDoc(pin({ isHome: false }), feeds, PNOW).doc.isHome, false);
});
test('buildPracticeDoc: every missing or wrong field is reported, nothing is made', () => {
  assert.deepEqual(buildPracticeDoc({}, feeds, PNOW), { ok: false, errors: { team: true, opponent: true, location: true, date: true } });
  assert.deepEqual(buildPracticeDoc(pin({ calendarId: 'weg' }), feeds, PNOW).errors, { team: true });
  assert.deepEqual(buildPracticeDoc(pin({ opponent: '   ' }), feeds, PNOW).errors, { opponent: true });
  assert.deepEqual(buildPracticeDoc(pin({ location: '' }), feeds, PNOW).errors, { location: true });
});
test('buildPracticeDoc: the date must exist and the kick-off must be in the future', () => {
  for (const bad of [{ date: '2026-09-29' }, { date: '2026-09-30', time: '09:59' }, { date: '2026-02-30' }, { time: '25:00' }, { time: '11:75' }, { date: '' }, { time: '' }, { date: '03-10-2026' }])
    assert.deepEqual(buildPracticeDoc(pin(bad), feeds, PNOW).errors, { date: true }, JSON.stringify(bad));
  assert.equal(buildPracticeDoc(pin({ date: '2026-09-30', time: '10:01' }), feeds, PNOW).ok, true);
});
test('buildPracticeDoc: very long texts are cut to their maximum', () => {
  const d = buildPracticeDoc(pin({ opponent: 'x'.repeat(200), location: 'y'.repeat(500) }), feeds, PNOW).doc;
  assert.equal(d.opponent.length, 60); assert.equal(d.location.length, 120);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
