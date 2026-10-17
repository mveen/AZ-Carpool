// cron/match-calendars.mjs — once a day: fetch the team calendars from Google Calendar and store the result in
// settings/matchCache, exactly like the first member of the day does in the app (matches.js: loadAllMatches).
// The app then finds a cache from today and does not fetch anything itself. If this job is down, the app still
// fetches by itself, so nothing breaks.
//   node match-calendars.mjs
// It then also calculates the car distance of every match that has none yet (settings/matchDistances), with the OpenRouteService key
// from settings/apiKeys. Only the coordinator and this job (service account) can read that key; parents never see it.
// Needs: the service account with "Cloud Datastore User" (reads settings/matchFeeds, apiKeys, locations, practiceMatches; writes settings/matchCache, matchDistances).
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readServiceAccount, tokenProvider } from './lib/google-auth.mjs';
import { createFirestore, decodeFields } from './lib/firestore-rest.mjs';
import { loadConfig, secretsDir, isMainModule, codeDir } from './lib/setup.mjs';

export const MATCH_HORIZON_DAYS = 29;   // same as matches.js

// The app modules the distance step reuses (and everything they import). scripts/build-cron.mjs copies them to <cron folder>/app/.
export const DISTANCE_APP_MODULES = ['distance.js', 'locations.js'];
export async function loadDistanceApp(dir = codeDir) {
  const base = existsSync(join(dir, 'app', 'distance.js')) ? join(dir, 'app') : join(dir, '..');
  const [distance, locations] = await Promise.all(DISTANCE_APP_MODULES.map(f => import(pathToFileURL(join(base, f)).href)));
  return { ...distance, ...locations };
}

// Same key as matchSlug() in matches.js (matches.js itself draws screens, so it cannot run here). A match without calendar and event id has none.
const idPart = s => String(s || '').replace(/[^A-Za-z0-9_-]/g, '_');
export const matchKey = m => (m && m.calendarId && m.eventId ? 'ev_' + idPart(m.calendarId) + '__' + idPart(m.eventId) : '');
export const PRACTICE_PREFIX = 'practice_';   // same as matches.js

// Same as feedsSignature() in matches.js.
export const feedsSignature = feeds => (feeds || []).map(f => f && f.calendarId).filter(Boolean).sort().join(',');

export function calendarUrl(feed, apiKey, now) {
  const timeMin = new Date(now - 86400000), timeMax = new Date(now + (MATCH_HORIZON_DAYS + 1) * 86400000);
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(feed.calendarId)}/events`
    + `?key=${encodeURIComponent(apiKey)}&singleEvents=true&orderBy=startTime`
    + `&timeMin=${encodeURIComponent(timeMin.toISOString())}&timeMax=${encodeURIComponent(timeMax.toISOString())}&maxResults=50`;
}

// PURE. Google's answer -> the match records stored in the cache.
export function eventsFromItems(items, feed) {
  return (items || []).map(ev => {
    const startStr = ev.start && (ev.start.dateTime || ev.start.date);
    if (!startStr || !ev.summary) return null;
    return { calendarId: feed.calendarId, eventId: ev.id || '', teamLabel: feed.label, summary: ev.summary, location: ev.location || '', startMs: new Date(startStr).getTime() };
  }).filter(Boolean);
}

export async function fetchFeed({ feed, apiKey, referer, now, fetchFn = fetch }) {
  try {
    // The Calendar key is restricted to our websites, so Google checks the Referer header; a browser sends it by itself.
    const res = await fetchFn(calendarUrl(feed, apiKey, now), { headers: { referer }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      let detail = '';
      try { const b = await res.json(); detail = b && b.error && b.error.message ? ' — ' + b.error.message : ''; } catch (e) { /* no body */ }
      throw new Error('HTTP ' + res.status + detail);
    }
    return { ok: true, events: eventsFromItems((await res.json()).items, feed) };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}

// PURE. results[i] belongs to feeds[i]. A calendar that failed keeps its previous matches (so a Google hiccup does not
// empty the Wedstrijden tab) and the cache is marked partial, so the app tries that calendar again by itself.
// Returns null when every calendar failed: then the existing cache is left alone.
export function buildMatchCache({ feeds, results, previous, now }) {
  if (feeds.length && results.every(r => !r.ok)) return null;
  const old = (previous && previous.matches) || [];
  const matches = []; const failed = [];
  feeds.forEach((feed, i) => {
    const r = results[i];
    if (r.ok) matches.push(...r.events);
    else { failed.push({ label: feed.label, error: r.error }); matches.push(...old.filter(m => m.calendarId === feed.calendarId && m.startMs >= now - 86400000)); }
  });
  return { doc: { fetchedAt: now, feedsSig: feedsSignature(feeds), partial: failed.length > 0, matches }, failed };
}

export async function runMatches({ firestore, apiKey, referer, now = Date.now(), fetchFn = fetch, log = console.log, warn = console.error }) {
  const feedsDoc = await firestore.getDocument('settings/matchFeeds');
  const feeds = ((feedsDoc && decodeFields(feedsDoc.fields).feeds) || []).filter(f => f && f.calendarId);
  const prevDoc = await firestore.getDocument('settings/matchCache');
  const previous = prevDoc ? decodeFields(prevDoc.fields) : null;
  const results = await Promise.all(feeds.map(feed => fetchFeed({ feed, apiKey, referer, now, fetchFn })));
  const built = buildMatchCache({ feeds, results, previous, now });
  if (!built) throw new Error('Every calendar failed (' + results.map((r, i) => `${feeds[i].label}: ${r.error}`).join('; ') + '): the cache was left unchanged');
  await firestore.setDocument('settings/matchCache', built.doc);
  built.failed.forEach(f => warn(`WARNING: calendar ${f.label} failed (${f.error}); its previous matches were kept`));
  log(`Match calendars: ${built.doc.matches.length} matches from ${feeds.length} calendars` + (built.failed.length ? `, ${built.failed.length} failed` : ''));
  return built;
}

// The matches that need a distance: the calendar matches just stored plus the practice matches parents added in the app.
export function matchesForDistances(cacheMatches, practiceDocs) {
  const list = (cacheMatches || []).map(m => ({ key: matchKey(m), location: m.location }));
  for (const { id, data } of practiceDocs || []) list.push({ key: matchKey({ calendarId: data.calendarId, eventId: PRACTICE_PREFIX + id }), location: data.location });
  return list.filter(m => m.key);
}

// Calculates what is still missing and writes the whole settings/matchDistances document once (stored + new). No key: does nothing.
export async function runDistances({ firestore, app, matches, fetchFn = fetch, log = console.log, warn = console.error }) {
  const keyDoc = await firestore.getDocument('settings/apiKeys');
  const apiKey = String((keyDoc && decodeFields(keyDoc.fields).ors) || '').trim();
  if (!app.hasApiKey(apiKey)) { log('Distances: no OpenRouteService key set, skipped'); return 0; }
  const locDoc = await firestore.getDocument('settings/locations');
  const cfg = app.normalizeLocations(locDoc ? decodeFields(locDoc.fields) : null);
  const bus = cfg.places.find(p => p.id === 'busstation');
  const originText = (bus && bus.address) || 'Busstation Aalsmeer, Aalsmeer, Nederland';
  const storedDoc = await firestore.getDocument('settings/matchDistances');
  const stored = storedDoc ? decodeFields(storedDoc.fields) : {};
  const merged = { ...stored }; let added = 0;
  const calls = await app.ensureDistances({
    matches, storedByKey: stored, fixedKm: cfg.fixedKm, apiKey, originText, fetchFn,
    store: async (key, val) => { merged[key] = val; added++; },
  });
  if (added) await firestore.setDocument('settings/matchDistances', merged);
  log(`Distances: ${calls} routes requested, ${added} stored`);
  return added;
}

if (isMainModule(import.meta.url)) {
  try {
    const { projectId, calendarApiKey, referer } = loadConfig();
    const account = readServiceAccount(join(secretsDir(), 'calendar-key.json'));
    const firestore = createFirestore({ projectId, getToken: tokenProvider({ account }) });
    const built = await runMatches({ firestore, apiKey: calendarApiKey, referer });
    // A problem with distances must never fail the calendar job: the app shows "afstand onbekend" and the next run tries again.
    try {
      const practice = (await firestore.listDocuments('practiceMatches')).filter(d => d.createTime).map(d => ({ id: d.name.slice(d.name.lastIndexOf('/') + 1), data: decodeFields(d.fields) }));
      await runDistances({ firestore, app: await loadDistanceApp(), matches: matchesForDistances(built.doc.matches, practice) });
    } catch (e) { console.error('WARNING: distances not calculated: ' + e.message); }
  } catch (e) { console.error('MATCH CALENDARS FAILED: ' + e.message); process.exit(1); }
}
