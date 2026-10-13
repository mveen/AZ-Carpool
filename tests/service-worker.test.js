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
const shown = [], opened = [], order = []; let openClients = [];
const SCOPE = 'https://mveen.github.io/AZ-Carpool/';
globalThis.self = {
  location: { origin: 'https://mveen.github.io' }, addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting() {},
  navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile Safari/537.36' },
  registration: { scope: SCOPE, showNotification: async (title, options) => { shown.push({ title, options }); } },
  clients: { claim() {}, matchAll: async () => { order.push('matchAll'); return openClients; }, openWindow: async url => { order.push('openWindow'); opened.push(url); } },
};
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

console.log('\n=== push (test phase) ===');
// A push event / notification click the way a browser sends them. `waitUntil` collects the promise so the test can wait for it.
async function push(data, { raw } = {}) {
  let p = Promise.resolve();
  handlers.push({ data: data === undefined ? null : { json: () => { if (raw) throw new SyntaxError('bad json'); return data; } }, waitUntil: x => { p = x; } });
  await p;
}
async function click(data, notification = {}) {
  let closed = false, p = Promise.resolve();
  handlers.notificationclick({ notification: { data, close: () => { closed = true; }, ...notification }, waitUntil: x => { p = x; } });
  await p;
  return { closed };
}
const reset2 = () => { shown.length = 0; opened.length = 0; order.length = 0; openClients = []; globalThis.self.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile Safari/537.36'; };
await test('a push shows a notification with the title, text, icon, tag and the family it was meant for', async () => {
  reset2();
  await push({ title: 'Test · Ouder van Saar', body: 'Rit vrij: donderdag 16:15\nJan biedt een rit aan.', tag: 'q1', url: './?pushas=f6', forFamilyId: 'f6' });
  assert.equal(shown.length, 1); assert.equal(shown[0].title, 'Test · Ouder van Saar');
  const o = shown[0].options;
  assert.equal(o.body, 'Rit vrij: donderdag 16:15\nJan biedt een rit aan.'); assert.equal(o.icon, './icon-192.png'); assert.equal(o.tag, 'q1'); assert.deepEqual(o.data, { url: './?pushas=f6', forFamilyId: 'f6' });
});
await test('an empty, broken or odd push still shows a plain AZ Carpool notification instead of failing (browsers take permission back otherwise)', async () => {
  for (const [data, opts] of [[undefined, {}], [{}, {}], [null, {}], ['text', {}], [42, {}], [undefined, { raw: true }], [{ title: 5, body: { x: 1 }, tag: [], url: 7 }, {}]]) {
    reset2(); await push(data, opts);
    assert.equal(shown.length, 1); assert.equal(shown[0].title, 'AZ Carpool'); assert.equal(shown[0].options.body, ''); assert.equal(shown[0].options.tag, undefined); assert.equal(shown[0].options.data.url, './');
  }
});
await test('a huge push is cut to a sensible size', async () => {
  reset2(); await push({ title: 't'.repeat(1000), body: 'b'.repeat(5000), tag: 'x'.repeat(1000), url: 'u'.repeat(1000), forFamilyId: 'f'.repeat(1000) });
  const o = shown[0].options; assert.equal(shown[0].title.length, 120); assert.equal(o.body.length, 500); assert.equal(o.tag.length, 200); assert.equal(o.data.url.length, 300); assert.equal(o.data.forFamilyId.length, 64);
});
await test('tapping closes the notification; an app that is open comes forward and is told which family to open (no new window)', async () => {
  reset2(); const events = []; openClients = [{ url: SCOPE + '?x=1', focus: async () => { events.push('focus'); return { focused: true }; }, postMessage: m => events.push(m) }];
  const r = await click({ url: './?pushas=f6', forFamilyId: 'f6' });
  assert.equal(r.closed, true); assert.deepEqual(events, ['focus', { type: 'push-open', forFamilyId: 'f6' }]); assert.deepEqual(opened, []);
});
await test('a window of another site is not used; without an open app a new window opens at the address of the push', async () => {
  reset2(); openClients = [{ url: 'https://other.example/', focus: async () => assert.fail('wrong window'), postMessage: () => assert.fail('wrong window') }];
  await click({ url: './?pushas=f6', forFamilyId: 'f6' });
  assert.deepEqual(opened, [SCOPE + '?pushas=f6']);
});
await test('an address on another site, or no address at all, opens the start page of the app instead', async () => {
  for (const data of [{ url: 'https://evil.example/phish' }, { url: '//evil.example/x' }, {}, undefined, { url: 5 }, null]) { reset2(); await click(data); assert.deepEqual(opened, [SCOPE], JSON.stringify(data)); }
});
await test('a refused focus does not stop the message to the open app, and the app is opened as a fallback', async () => {
  reset2(); const events = []; openClients = [{ url: SCOPE, focus: async () => { throw new Error('refused'); }, postMessage: m => events.push(m) }];
  await click({ url: './?pushas=f6', forFamilyId: 'f6' }); assert.deepEqual(events, [{ type: 'push-open', forFamilyId: 'f6' }]); assert.deepEqual(opened, [SCOPE + '?pushas=f6']);
});
await test('Firefox on Android: focus() only brings the browser forward, not the tab (it stays hidden): the app is opened as well', async () => {
  reset2(); const events = []; openClients = [{ url: SCOPE, focus: async () => ({ focused: false, visibilityState: 'hidden' }), postMessage: m => events.push(m) }];
  await click({ url: './?pushas=f6', forFamilyId: 'f6' });
  assert.deepEqual(opened, [SCOPE + '?pushas=f6']); assert.equal(events.length, 1);
});
await test('a tab that really came to the front (visible, even when not reported as focused) is enough: no second window', async () => {
  reset2(); openClients = [{ url: SCOPE, focus: async () => ({ focused: false, visibilityState: 'visible' }), postMessage: () => {} }];
  await click({ url: './?pushas=f6', forFamilyId: 'f6' }); assert.deepEqual(opened, []);
});
await test('Firefox: the app is opened at once, as the first thing, without looking at open windows first; the open window is not asked to focus', async () => {
  reset2(); globalThis.self.navigator.userAgent = 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0';
  openClients = [{ url: SCOPE, focus: async () => assert.fail('no focus on Firefox'), postMessage: () => assert.fail('no message on Firefox') }];
  const r = await click({ url: './?pushas=f6', forFamilyId: 'f6' });
  assert.equal(r.closed, true); assert.deepEqual(order, ['openWindow']); assert.deepEqual(opened, [SCOPE + '?pushas=f6']);
  reset2(); globalThis.self.navigator.userAgent = 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0';
  await click({ url: 'https://evil.example/x' }); assert.deepEqual(opened, [SCOPE]);
});
await test('Firefox: a window that cannot be opened does not break the click', async () => {
  reset2(); globalThis.self.navigator.userAgent = 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0';
  const real = self.clients.openWindow; self.clients.openWindow = async () => { throw new Error('popup blocked'); };
  try { await click({ url: './?pushas=f6' }); } finally { self.clients.openWindow = real; }
});
await test('the push files are part of the offline copy (ASSETS)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
  for (const f of ['notif-text.js', 'push.js', 'push-access.js', 'push-scenarios.js', 'push-data.js', 'ui-push.js']) assert.ok(src.includes(`'./${f}'`), f);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
