// Run with: node cron-match-calendars.test.js
// cron/match-calendars.mjs: the daily calendar fetch on the server must store exactly what the app itself would store
// (matches.js loadAllMatches), keep earlier matches of a calendar that fails, and never wipe the cache.
import assert from 'node:assert/strict';
import { installFakeDom, resetState, useFakeDb, withFakeNowAsync, NOW } from './test-support.js';
import { S } from '../state.js';
import { loadAllMatches, feedsSignature as clientSignature } from '../matches.js';
import { encodeFields, decodeFields } from '../cron/lib/firestore-rest.mjs';
import { runMatches, buildMatchCache, eventsFromItems, calendarUrl, feedsSignature } from '../cron/match-calendars.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
installFakeDom();
const now = new Date(NOW).getTime();
const feeds = [{ calendarId: 'a@group.calendar.google.com', label: 'AZ O15-1' }, { calendarId: 'b@group.calendar.google.com', label: 'AZ O17-1' }];
const body = (id, summary) => ({ items: [
  { id: id + '1', summary, location: 'Hoorn', start: { dateTime: '2026-10-03T10:30:00+02:00' } },
  { id: id + '2', start: { dateTime: '2026-10-04T10:30:00+02:00' } },
  { id: id + '3', summary: 'Zonder tijd' },
  { id: id + '4', summary: 'Hele dag', start: { date: '2026-10-10' } },
] });
const ok = b => ({ ok: true, status: 200, json: async () => b });
const bad = (status, message) => ({ ok: false, status, json: async () => ({ error: { message } }) });
// The two routes a calendar answer can take: by calendar id in the URL.
const router = (map, seen = []) => async (url, init) => {
  seen.push({ url: String(url), init });
  const id = decodeURIComponent(String(url).match(/calendars\/([^/]+)\/events/)[1]);
  const r = map[id]; if (!r) throw new Error('offline'); return typeof r === 'function' ? r() : r;
};
// A fake Firestore with the same calls as cron/lib/firestore-rest.mjs.
function fakeFirestore(seed = {}) {
  const data = { ...seed }; const writes = [];
  return { data, writes,
    getDocument: async p => data[p] ? { name: p, fields: encodeFields(data[p]) } : null,
    setDocument: async (p, d) => { writes.push(p); data[p] = decodeFields(encodeFields(d)); } };
}
const quiet = { log: () => {}, warn: () => {} };

console.log('=== same result as the app ===');
await test('the cache document is identical to what loadAllMatches stores, and the Calendar request is the same', async () => {
  const answers = { [feeds[0].calendarId]: ok(body('a', 'AZ O15-1-Hoorn O15-2')), [feeds[1].calendarId]: ok(body('b', 'Ajax O17-1-AZ O17-1')) };
  // the app
  const fake = useFakeDb({}); resetState({ matchFeeds: feeds, matchFeedsLoaded: true });
  const clientSeen = []; const realFetch = globalThis.fetch;
  globalThis.fetch = router(answers, clientSeen);
  try { await withFakeNowAsync(NOW, () => loadAllMatches()); } finally { globalThis.fetch = realFetch; }
  const appDoc = fake.get('settings/matchCache');
  // the server
  const fs = fakeFirestore({ 'settings/matchFeeds': { feeds } });
  const seen = []; await runMatches({ firestore: fs, apiKey: 'test-key', referer: 'https://azcarpool.nl/', now, fetchFn: router(answers, seen), ...quiet });
  assert.deepEqual(fs.data['settings/matchCache'], appDoc);
  // The app counts 30 calendar days in local time, the server 30 x 24 hours: across the autumn clock change that is one hour apart. Nothing else may differ.
  const parts = u => { const x = new URL(u); const max = Date.parse(x.searchParams.get('timeMax')); x.searchParams.delete('timeMax'); return { rest: x.toString(), max }; };
  assert.equal(seen.length, clientSeen.length);
  seen.forEach((sv, i) => { const a = parts(sv.url), b = parts(clientSeen[i].url); assert.equal(a.rest, b.rest); assert.ok(Math.abs(a.max - b.max) <= 3600000); });
  assert.equal(fs.data['settings/matchCache'].matches.length, 4, 'two calendars, a valid timed event and a whole-day event each');
});
await test('the "calendars signature" is the same as the app\'s', () => {
  for (const f of [[], feeds, [...feeds].reverse(), [{ calendarId: 'z' }, { label: 'no id' }, null]]) assert.equal(feedsSignature(f), clientSignature(f));
});
await test('the request carries the website address as Referer (the Calendar key only works for our websites)', async () => {
  const fs = fakeFirestore({ 'settings/matchFeeds': { feeds: [feeds[0]] } }); const seen = [];
  await runMatches({ firestore: fs, apiKey: 'K', referer: 'https://azcarpool.nl/', now, fetchFn: router({ [feeds[0].calendarId]: ok({ items: [] }) }, seen), ...quiet });
  assert.equal(seen[0].init.headers.referer, 'https://azcarpool.nl/'); assert.match(seen[0].url, /key=K&singleEvents=true/);
});
await test('the window runs from yesterday to 30 days ahead, at most 50 events', () => {
  const u = new URL(calendarUrl(feeds[0], 'K', now));
  assert.equal(u.searchParams.get('timeMin'), new Date(now - 86400000).toISOString());
  assert.equal(u.searchParams.get('timeMax'), new Date(now + 30 * 86400000).toISOString()); assert.equal(u.searchParams.get('maxResults'), '50');
});
await test('events without a start or a title are skipped; whole-day events use the date', () => {
  const e = eventsFromItems(body('a', 'X-Y').items, feeds[0]);
  assert.deepEqual(e.map(x => x.eventId), ['a1', 'a4']); assert.equal(e[1].startMs, Date.parse('2026-10-10'));
});

console.log('=== when a calendar fails ===');
const previous = { fetchedAt: now - 86400000, feedsSig: feedsSignature(feeds), partial: false, matches: [
  { calendarId: feeds[0].calendarId, eventId: 'old-a', teamLabel: 'AZ O15-1', summary: 'old a', location: '', startMs: now + 86400000 },
  { calendarId: feeds[1].calendarId, eventId: 'old-b', teamLabel: 'AZ O17-1', summary: 'old b', location: '', startMs: now + 86400000 },
  { calendarId: feeds[1].calendarId, eventId: 'gone-b', teamLabel: 'AZ O17-1', summary: 'played long ago', location: '', startMs: now - 5 * 86400000 },
] };
await test('the matches of the calendar that failed are kept, the cache is marked partial (the app will retry it) and a warning is printed', async () => {
  const fs = fakeFirestore({ 'settings/matchFeeds': { feeds }, 'settings/matchCache': previous }); const warned = [];
  await runMatches({ firestore: fs, apiKey: 'K', referer: 'r', now, fetchFn: router({ [feeds[0].calendarId]: ok(body('a', 'AZ O15-1-Hoorn O15-2')), [feeds[1].calendarId]: bad(403, 'Forbidden') }), log: () => {}, warn: w => warned.push(w) });
  const doc = fs.data['settings/matchCache'];
  assert.equal(doc.partial, true);
  assert.deepEqual(doc.matches.map(m => m.eventId), ['a1', 'a4', 'old-b']);
  assert.match(warned[0], /AZ O17-1 failed \(HTTP 403 — Forbidden\)/);
});
await test('when every calendar fails, nothing is written and the job reports an error', async () => {
  const fs = fakeFirestore({ 'settings/matchFeeds': { feeds }, 'settings/matchCache': previous });
  await assert.rejects(runMatches({ firestore: fs, apiKey: 'K', referer: 'r', now, fetchFn: router({}), ...quiet }), /Every calendar failed.*unchanged/);
  assert.deepEqual(fs.writes, []);
});
await test('no calendars in Beheer: an empty cache for the empty set, like the app', async () => {
  const fs = fakeFirestore({});
  await runMatches({ firestore: fs, apiKey: 'K', referer: 'r', now, fetchFn: router({}), ...quiet });
  assert.deepEqual(fs.data['settings/matchCache'], { fetchedAt: now, feedsSig: '', partial: false, matches: [] });
});
await test('buildMatchCache: the order is the order of the calendars in Beheer', () => {
  const r = buildMatchCache({ feeds, results: [{ ok: true, events: [{ calendarId: feeds[0].calendarId, eventId: '1', startMs: now }] }, { ok: true, events: [{ calendarId: feeds[1].calendarId, eventId: '2', startMs: now }] }], previous: null, now });
  assert.deepEqual(r.doc.matches.map(m => m.eventId), ['1', '2']); assert.equal(r.doc.partial, false);
});
await test('only settings/matchCache is ever written', async () => {
  const fs = fakeFirestore({ 'settings/matchFeeds': { feeds } });
  await runMatches({ firestore: fs, apiKey: 'K', referer: 'r', now, fetchFn: router({ [feeds[0].calendarId]: ok({ items: [] }), [feeds[1].calendarId]: ok({ items: [] }) }), ...quiet });
  assert.deepEqual(fs.writes, ['settings/matchCache']);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
