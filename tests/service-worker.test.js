// Run with: node service-worker.test.js
// The service worker: which requests it keeps for offline use, and that it never keeps an error page.
// service-worker.js runs in a browser worker, so here it gets a small fake `self`, `caches` and `fetch`.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}

const handlers = {}, store = new Map();
globalThis.self = { location: { origin: 'https://mveen.github.io' }, addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting() {}, clients: { claim() {} } };
globalThis.caches = {
  open: async () => ({ addAll: async () => {}, put: async (req, res) => { store.set(req.url, res); } }),
  match: async req => store.get(req.url),
  keys: async () => [], delete: async () => true,
};
let network = async () => new Response('ok');
globalThis.fetch = req => network(req);
await import('../service-worker.js');

// Sends one request through the worker. `responded` tells whether the worker took the request over (respondWith) or left it to the browser.
async function run(url, method = 'GET') {
  const req = { url, method };
  let promise = null;
  handlers.fetch({ request: req, respondWith: p => { promise = p; } });
  const res = promise ? await promise : null;
  await new Promise(r => setTimeout(r, 0));
  return { responded: !!promise, res, cached: store.has(url) };
}
const reset = () => { store.clear(); network = async () => new Response('ok'); };

console.log('=== what is kept ===');
await test('the app\'s own files and the Firebase SDK are cached', async () => {
  reset();
  for (const u of ['https://mveen.github.io/AZ-Carpool/app.js', 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js']) {
    const r = await run(u); assert.ok(r.responded && r.cached, u);
  }
});
await test('Firestore, Google Calendar and OpenRouteService requests are left alone and never stored (API keys, addresses, family data)', async () => {
  reset();
  for (const u of ['https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?database=x&key=SECRET',
    'https://www.googleapis.com/calendar/v3/calendars/a/events?key=SECRET', 'https://api.openrouteservice.org/geocode/search?api_key=SECRET&text=Alkmaar']) {
    const r = await run(u); assert.equal(r.responded, false, u); assert.equal(r.cached, false, u);
  }
});
await test('only GET is handled', async () => { reset(); const r = await run('https://mveen.github.io/AZ-Carpool/app.js', 'POST'); assert.equal(r.responded, false); });

console.log('=== errors and offline ===');
await test('an error response (404, 500) is passed on but never cached', async () => {
  reset();
  for (const status of [404, 500]) {
    network = async () => new Response('nope', { status });
    const r = await run('https://mveen.github.io/AZ-Carpool/app.js');
    assert.equal(r.res.status, status); assert.equal(r.cached, false, 'status ' + status);
  }
});
await test('a failed good copy is not replaced by a later error; offline gives the last good copy', async () => {
  reset();
  await run('https://mveen.github.io/AZ-Carpool/app.js');
  network = async () => new Response('nope', { status: 500 }); await run('https://mveen.github.io/AZ-Carpool/app.js');
  network = async () => { throw new TypeError('offline'); };
  const r = await run('https://mveen.github.io/AZ-Carpool/app.js');
  assert.equal(await r.res.text(), 'ok');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
