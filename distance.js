// distance.js — projected car distance of a match (US-21).
// From 'Busstation Aalsmeer' to the match location (calendar location field), fastest car route, calculated ONCE per
// match with OpenRouteService (free tier) and stored in settings/matchDistances so nobody calculates it twice.
// AFC/ATC matches (recognised by name or address) use the fixed distance from Beheer instead. Home and away matches alike. No location, or a location that cannot be found:
// "locatie onbekend", never a number.
import { fixedVenue, parseCoordinates } from './locations.js';

export const ORS_BASE = 'https://api.openrouteservice.org';
const AALSMEER = { lon: 4.7605, lat: 52.2625 }; // bias for the address search

// What to show for one match. PURE.
//   isHome: true/false/null (null = unknown)   location: calendar location text
//   stored: { loc, km } | { loc, unknown:true } | undefined      fixedKm: { AFC, ATC }
// Result: null (show nothing) | {kind:'km'|'fixed', km} | {kind:'fixedMissing', venue} | {kind:'unknown'} | {kind:'pending'}
export function distanceInfo({ isHome, location, stored, fixedKm }) {
  const loc = String(location || '').trim();
  const venue = fixedVenue(loc);
  if (venue) {
    const km = fixedKm && fixedKm[venue];
    return km ? { kind: 'fixed', km } : { kind: 'fixedMissing', venue };
  }
  if (!loc) return { kind: 'unknown' };
  if (stored && stored.loc === loc) return stored.unknown ? { kind: 'unknown' } : { kind: 'km', km: stored.km };
  return { kind: 'pending' };
}

// True for a real key: the placeholder text of firebase-config.js counts as "no key".
export function hasApiKey(k) { return !!k && !/^PASTE_/.test(k); }

export function roundKm(km) { return km >= 100 ? Math.round(km) : Math.round(km * 10) / 10; }

// Resilience: an outside service must never be able to hang the app. Every call gets a time limit.
export const FETCH_TIMEOUT_MS = 10000;
// After this many failed routes in a row the service is treated as down: stop for this session (circuit breaker),
// so a broken or rate-limited service is not hammered once per match.
export const MAX_CONSECUTIVE_ERRORS = 2;

// fetch(url) with a time limit. Rejects with 'timeout' when the service does not answer in time.
export function fetchWithTimeout(fetchFn, url, ms = FETCH_TIMEOUT_MS) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => { if (ctrl) ctrl.abort(); reject(new Error('timeout')); }, ms);
  });
  return Promise.race([Promise.resolve(fetchFn(url, ctrl ? { signal: ctrl.signal } : undefined)), limit])
    .finally(() => clearTimeout(timer));
}

async function getJson(fetchFn, url) {
  const res = await fetchWithTimeout(fetchFn, url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// Address text -> { lon, lat } or null when OpenRouteService finds nothing. GPS text (decimal or degrees-minutes-seconds)
// is used as it is: no search is needed.
export async function geocode(fetchFn, apiKey, text) {
  const gps = parseCoordinates(text);
  if (gps) return { lon: gps.lon, lat: gps.lat };
  const url = `${ORS_BASE}/geocode/search?api_key=${encodeURIComponent(apiKey)}&text=${encodeURIComponent(text)}&size=1`
    + `&focus.point.lon=${AALSMEER.lon}&focus.point.lat=${AALSMEER.lat}`;
  const data = await getJson(fetchFn, url);
  const c = data && data.features && data.features[0] && data.features[0].geometry && data.features[0].geometry.coordinates;
  return c && c.length >= 2 ? { lon: c[0], lat: c[1] } : null;
}

// Fastest car route length in km between two texts.
//   { ok:true, km } | { ok:false, reason:'notfound' } (address unknown: final)  | { ok:false, reason:'error', error } (retry later)
export async function routeKm({ fetchFn, apiKey, originText, destinationText }) {
  try {
    const from = await geocode(fetchFn, apiKey, originText);
    const to = await geocode(fetchFn, apiKey, destinationText);
    if (!from || !to) return { ok: false, reason: 'notfound' };
    const url = `${ORS_BASE}/v2/directions/driving-car?api_key=${encodeURIComponent(apiKey)}`
      + `&start=${from.lon},${from.lat}&end=${to.lon},${to.lat}`;
    const data = await getJson(fetchFn, url);
    const m = data && data.features && data.features[0] && data.features[0].properties && data.features[0].properties.summary && data.features[0].properties.summary.distance;
    if (typeof m !== 'number') return { ok: false, reason: 'notfound' };
    return { ok: true, km: roundKm(m / 1000) };
  } catch (e) { return { ok: false, reason: 'error', error: (e && e.message) || String(e) }; }
}

// Calculates every match that still needs it, one after the other, at most once per session per match+location.
//   matches: [{ key, isHome, location }]   store(key, value) saves { loc, km } or { loc, unknown:true }
//   Returns the number of routes that were requested.
const attempted = new Set();
export function forgetAttempts() { attempted.clear(); }
export async function ensureDistances({ matches, storedByKey, fixedKm, fetchFn, apiKey, originText, store }) {
  if (!hasApiKey(apiKey)) return 0;
  let calls = 0, errorsInARow = 0;
  for (const m of matches) {
    if (errorsInARow >= MAX_CONSECUTIVE_ERRORS) break;   // circuit open: the rest is tried in a later session
    const info = distanceInfo({ isHome: m.isHome, location: m.location, stored: storedByKey[m.key], fixedKm });
    if (!info || info.kind !== 'pending') continue;
    const loc = String(m.location).trim();
    const id = m.key + '|' + loc;
    if (attempted.has(id)) continue;
    attempted.add(id);
    calls++;
    const r = await routeKm({ fetchFn, apiKey, originText, destinationText: loc });
    errorsInARow = r.ok || r.reason === 'notfound' ? 0 : errorsInARow + 1;
    if (r.ok) await store(m.key, { loc, km: r.km, at: Date.now() });
    else if (r.reason === 'notfound') await store(m.key, { loc, unknown: true, at: Date.now() });
    // a network error stores nothing: it is tried again in a later session
  }
  return calls;
}
