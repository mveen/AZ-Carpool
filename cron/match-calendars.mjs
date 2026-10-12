// cron/match-calendars.mjs — once a day: fetch the team calendars from Google Calendar and store the result in
// settings/matchCache, exactly like the first member of the day does in the app (matches.js: loadAllMatches).
// The app then finds a cache from today and does not fetch anything itself. If this job is down, the app still
// fetches by itself, so nothing breaks.
//   node match-calendars.mjs
// Needs: the service account with "Cloud Datastore User" (reads settings/matchFeeds, writes settings/matchCache).
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readServiceAccount, tokenProvider } from './lib/google-auth.mjs';
import { createFirestore, decodeFields } from './lib/firestore-rest.mjs';
import { loadConfig, secretsDir } from './lib/setup.mjs';

export const MATCH_HORIZON_DAYS = 29;   // same as matches.js

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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { projectId, calendarApiKey, referer } = loadConfig();
    const account = readServiceAccount(join(secretsDir(), 'calendar-key.json'));
    const firestore = createFirestore({ projectId, getToken: tokenProvider({ account }) });
    await runMatches({ firestore, apiKey: calendarApiKey, referer });
  } catch (e) { console.error('MATCH CALENDARS FAILED: ' + e.message); process.exit(1); }
}
