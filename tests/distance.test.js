// Run with: node distance.test.js
// Projected distance of away matches (US-21). The routing service is always a fake here; nothing goes online.
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
import { hasApiKey, distanceInfo, roundKm, geocode, routeKm, ensureDistances, forgetAttempts, fetchWithTimeout, ORS_BASE } from '../distance.js';

const fixedKm = { AFC: 36, ATC: null };

console.log('=== what to show (distanceInfo) ===');
test('an away match with a stored result shows that distance', () => {
  assert.deepEqual(distanceInfo({ isHome: false, location: 'Sportpark Hoorn', stored: { loc: 'Sportpark Hoorn', km: 42.3 }, fixedKm }), { kind: 'km', km: 42.3 });
});
test('a missing location shows "unknown", never a number', () => {
  assert.deepEqual(distanceInfo({ isHome: false, location: '', fixedKm }), { kind: 'unknown' });
  assert.deepEqual(distanceInfo({ isHome: false, location: '   ', fixedKm }), { kind: 'unknown' });
  assert.deepEqual(distanceInfo({ isHome: null, location: undefined, fixedKm }), { kind: 'unknown' });
});
test('a location that could not be found (stored as unknown) shows "unknown"', () => {
  assert.deepEqual(distanceInfo({ isHome: false, location: 'Nergens', stored: { loc: 'Nergens', unknown: true }, fixedKm }), { kind: 'unknown' });
});
test('when the calendar location changed, the stored result no longer applies (calculate again)', () => {
  assert.deepEqual(distanceInfo({ isHome: false, location: 'Nieuw adres', stored: { loc: 'Oud adres', km: 10 }, fixedKm }), { kind: 'pending' });
});
test('an away match without a stored result is pending', () => {
  assert.deepEqual(distanceInfo({ isHome: false, location: 'Sportpark Hoorn', fixedKm }), { kind: 'pending' });
});
test('AFC and ATC use the fixed distance from Beheer, never a calculated one', () => {
  assert.deepEqual(distanceInfo({ isHome: false, location: "AFC'34, Alkmaar", stored: { loc: "AFC'34, Alkmaar", km: 99 }, fixedKm }), { kind: 'fixed', km: 36 });
  assert.deepEqual(distanceInfo({ isHome: true, location: 'AFC', fixedKm }), { kind: 'fixed', km: 36 });
  assert.deepEqual(distanceInfo({ isHome: false, location: 'ATC Alkmaar', fixedKm }), { kind: 'fixedMissing', venue: 'ATC' });
});
test('a home match at another place is calculated like an away match (pending until stored)', () => {
  assert.deepEqual(distanceInfo({ isHome: true, location: 'Sportpark Aalsmeer', fixedKm }), { kind: 'pending' });
  assert.deepEqual(distanceInfo({ isHome: true, location: 'Sportpark Aalsmeer', stored: { loc: 'Sportpark Aalsmeer', km: 3.2 }, fixedKm }), { kind: 'km', km: 3.2 });
});
test('roundKm: one decimal below 100 km, whole km above', () => {
  assert.equal(roundKm(42.349), 42.3); assert.equal(roundKm(120.4), 120);
});

console.log('\n=== OpenRouteService calls ===');
const ok = body => ({ ok: true, json: async () => body });
function fakeOrs({ geo = {}, meters = 42300, fail = null } = {}) {
  const urls = [];
  const fetchFn = async url => {
    urls.push(url);
    if (fail) { if (fail === 'throw') throw new Error('offline'); return { ok: false, status: fail, json: async () => ({}) }; }
    if (url.includes('/geocode/search')) {
      const text = decodeURIComponent(url.match(/text=([^&]*)/)[1]);
      const c = text in geo ? geo[text] : [4.8, 52.3];
      return ok({ features: c ? [{ geometry: { coordinates: c } }] : [] });
    }
    return ok({ features: [{ properties: { summary: { distance: meters, duration: 2000 } } }] });
  };
  return { fetchFn, urls };
}
await testAsync('geocode returns lon/lat of the first hit, and null for no hit', async () => {
  const f = fakeOrs({ geo: { Hoorn: [5.06, 52.64], Nergens: null } });
  assert.deepEqual(await geocode(f.fetchFn, 'K', 'Hoorn'), { lon: 5.06, lat: 52.64 });
  assert.equal(await geocode(f.fetchFn, 'K', 'Nergens'), null);
  assert.ok(f.urls[0].startsWith(ORS_BASE + '/geocode/search?api_key=K&text=Hoorn'));
});
await testAsync('routeKm: geocodes both places, asks for the car route and returns km', async () => {
  const f = fakeOrs({ geo: { A: [4.76, 52.26], B: [5.06, 52.64] }, meters: 42349 });
  const r = await routeKm({ fetchFn: f.fetchFn, apiKey: 'K', originText: 'A', destinationText: 'B' });
  assert.deepEqual(r, { ok: true, km: 42.3 });
  assert.equal(f.urls.length, 3);
  assert.match(f.urls[2], /\/v2\/directions\/driving-car\?api_key=K&start=4\.76,52\.26&end=5\.06,52\.64$/);
});
await testAsync('routeKm: an address that is not found is a final "notfound"', async () => {
  const f = fakeOrs({ geo: { B: null } });
  assert.deepEqual(await routeKm({ fetchFn: f.fetchFn, apiKey: 'K', originText: 'A', destinationText: 'B' }), { ok: false, reason: 'notfound' });
  assert.equal(f.urls.length, 2, 'no route is requested');
});
await testAsync('routeKm: a service error is reported as "error" (try again later), not as "notfound"', async () => {
  const r1 = await routeKm({ fetchFn: fakeOrs({ fail: 403 }).fetchFn, apiKey: 'K', originText: 'A', destinationText: 'B' });
  assert.equal(r1.ok, false); assert.equal(r1.reason, 'error'); assert.match(r1.error, /403/);
  const r2 = await routeKm({ fetchFn: fakeOrs({ fail: 'throw' }).fetchFn, apiKey: 'K', originText: 'A', destinationText: 'B' });
  assert.equal(r2.reason, 'error');
});

console.log('\n=== calculated once, stored per match ===');
const matches = [
  { key: 'm1', isHome: false, location: 'Sportpark Hoorn' },
  { key: 'm2', isHome: false, location: '' },
  { key: 'm3', isHome: false, location: "AFC'34" },
  { key: 'm4', isHome: true, location: 'Sportpark Aalsmeer' },
  { key: 'm5', isHome: false, location: 'Nergens' },
  { key: 'm6', isHome: false, location: 'Al opgeslagen' },
];
await testAsync('every match that still needs it (home or away) is calculated; the result is stored per match', async () => {
  forgetAttempts();
  const f = fakeOrs({ geo: { Nergens: null } }); const saved = {};
  const calls = await ensureDistances({ matches, storedByKey: { m6: { loc: 'Al opgeslagen', km: 5 } }, fixedKm, fetchFn: f.fetchFn, apiKey: 'K', originText: 'Busstation Aalsmeer', store: async (k, v) => { saved[k] = v; } });
  assert.equal(calls, 3);   // m1 (away), m4 (home elsewhere), m5 (not found); m2 has no location, m3 is AFC (fixed), m6 is stored
  assert.deepEqual(Object.keys(saved).sort(), ['m1', 'm4', 'm5']);
  assert.equal(saved.m1.km, 42.3); assert.equal(saved.m1.loc, 'Sportpark Hoorn'); assert.equal(saved.m4.km, 42.3);
  assert.equal(saved.m5.unknown, true); assert.equal(saved.m5.km, undefined);
});
await testAsync('a second run in the same session asks nothing again', async () => {
  const f = fakeOrs(); let n = 0;
  const calls = await ensureDistances({ matches: [matches[0]], storedByKey: {}, fixedKm, fetchFn: f.fetchFn, apiKey: 'K', originText: 'x', store: async () => { n++; } });
  assert.equal(calls, 0); assert.equal(f.urls.length, 0); assert.equal(n, 0);
});
await testAsync('a network error stores nothing', async () => {
  forgetAttempts(); const saved = {};
  await ensureDistances({ matches: [matches[0]], storedByKey: {}, fixedKm, fetchFn: fakeOrs({ fail: 'throw' }).fetchFn, apiKey: 'K', originText: 'x', store: async (k, v) => { saved[k] = v; } });
  assert.deepEqual(saved, {});
});
await testAsync('without an API key (or the placeholder) nothing is requested', async () => {
  forgetAttempts(); const f = fakeOrs();
  for (const apiKey of [undefined, '', 'PASTE_YOUR_OPENROUTESERVICE_API_KEY_HERE']) {
    assert.equal(await ensureDistances({ matches, storedByKey: {}, fixedKm, fetchFn: f.fetchFn, apiKey, originText: 'x', store: async () => {} }), 0);
  }
  assert.equal(f.urls.length, 0);
});

console.log('\n=== resilience: time limit and circuit breaker ===');
await testAsync('fetchWithTimeout: a service that never answers is cut off and the request is aborted', async () => {
  let aborted = false;
  const hang = (url, opts) => new Promise(() => { opts.signal.addEventListener('abort', () => { aborted = true; }); });
  await assert.rejects(fetchWithTimeout(hang, 'x', 20), /timeout/);
  assert.equal(aborted, true);
});
await testAsync('fetchWithTimeout: a normal answer passes through', async () => {
  const r = await fetchWithTimeout(async () => ({ ok: true }), 'x', 1000);
  assert.deepEqual(r, { ok: true });
});
await testAsync('routeKm: a hanging service becomes an "error" (try again later)', async () => {
  const hang = () => new Promise(() => {});
  const r = await Promise.race([
    routeKm({ fetchFn: hang, apiKey: 'K', originText: 'A', destinationText: 'B' }),
    new Promise(res => setTimeout(() => res('still waiting'), 11000)),
  ]);
  assert.equal(r.reason, 'error'); assert.match(r.error, /timeout/);
});
await testAsync('circuit breaker: after 2 failed matches in a row the rest is not requested', async () => {
  forgetAttempts(); const f = fakeOrs({ fail: 503 }); const saved = {};
  const many = ['a', 'b', 'c', 'd', 'e'].map(k => ({ key: k, isHome: false, location: 'Plaats ' + k }));
  const calls = await ensureDistances({ matches: many, storedByKey: {}, fixedKm, fetchFn: f.fetchFn, apiKey: 'K', originText: 'x', store: async (k, v) => { saved[k] = v; } });
  assert.equal(calls, 2); assert.deepEqual(saved, {});
  assert.equal(f.urls.length, 2, 'one failing request per match, none after the breaker opened');
  // the skipped matches are not marked as attempted: a later run may still do them
  const f2 = fakeOrs(); const saved2 = {};
  const calls2 = await ensureDistances({ matches: many, storedByKey: {}, fixedKm, fetchFn: f2.fetchFn, apiKey: 'K', originText: 'x', store: async (k, v) => { saved2[k] = v; } });
  assert.equal(calls2, 3); assert.deepEqual(Object.keys(saved2).sort(), ['c', 'd', 'e']);
});
await testAsync('circuit breaker: a "not found" address does not count as a service failure', async () => {
  forgetAttempts(); const f = fakeOrs({ geo: { 'Plaats a': null, 'Plaats b': null, 'Plaats c': null } }); const saved = {};
  const many = ['a', 'b', 'c'].map(k => ({ key: k, isHome: false, location: 'Plaats ' + k }));
  assert.equal(await ensureDistances({ matches: many, storedByKey: {}, fixedKm, fetchFn: f.fetchFn, apiKey: 'K', originText: 'x', store: async (k, v) => { saved[k] = v; } }), 3);
  assert.equal(Object.keys(saved).length, 3);
});

test('hasApiKey: the placeholder of firebase-config.js is not a key', () => {
  assert.equal(hasApiKey('abc123'), true); assert.equal(hasApiKey(''), false); assert.equal(hasApiKey(undefined), false);
  assert.equal(hasApiKey('PASTE_YOUR_OPENROUTESERVICE_API_KEY_HERE'), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
