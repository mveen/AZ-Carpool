// Run with: node push.test.js
// push.js: the pure rules of the push test phase: the master switch (there is no live mode), which devices are accepted, what is still to be sent
// for a queue entry, what a message says, and how a tapped message finds its family.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import {
  CATEGORIES, MAX_FAILS, PUSH_MODES, STATUS_FRESH_MS, TEST_NOTIFICATION_MS, buildPayload, bufferToBase64Url, categoryOf, cleanLabel, deviceDoc, deviceId, deviceLabelFromUA,
  deviceWants, entryPlan, isPushEndpoint, normalizePush, parsePushLink, previewState, pushSettingsDoc, queueDoc, queueKey, recipientLabel, serverState, urlBase64ToUint8Array,
} from '../push.js';

console.log('=== the master switch ===');
test('there are only two modes: uit and test (no live mode exists)', () => {
  assert.deepEqual(PUSH_MODES, ['uit', 'test']);
});
test('only the exact word "test" switches anything on; missing, broken, unknown or "live" mean off', () => {
  assert.equal(normalizePush({ mode: 'test' }).mode, 'test');
  for (const raw of [null, undefined, {}, [], 'test', 7, { mode: 'live' }, { mode: 'TEST' }, { mode: 'Test ' }, { mode: true }, { mode: null }, { mode: 'uit' }]) assert.equal(normalizePush(raw).mode, 'uit', JSON.stringify(raw));
});
test('the stored document has the mode and the time, and anything but test is stored as uit', () => {
  assert.deepEqual(pushSettingsDoc('test', 5), { mode: 'test', updatedAt: 5 });
  assert.deepEqual(pushSettingsDoc('live', 5), { mode: 'uit', updatedAt: 5 });
  assert.deepEqual(pushSettingsDoc(undefined, 5), { mode: 'uit', updatedAt: 5 });
});
test('the server counts as alive when it reported within 10 minutes', () => {
  assert.equal(serverState(null, 1e9), 'onbekend'); assert.equal(serverState({}, 1e9), 'onbekend'); assert.equal(serverState({ lastRunAt: 'x' }, 1e9), 'onbekend');
  assert.equal(serverState({ lastRunAt: 1e9 - 60000 }, 1e9), 'ok'); assert.equal(serverState({ lastRunAt: 1e9 - STATUS_FRESH_MS }, 1e9), 'ok');
  assert.equal(serverState({ lastRunAt: 1e9 - STATUS_FRESH_MS - 1 }, 1e9), 'stil');
});

console.log('\n=== devices ===');
test('only https addresses of the known push services are accepted', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/Qx', 'https://wns2-par02p.notify.windows.com/w/?token=1']) assert.ok(isPushEndpoint(ok), ok);
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 'https://evilfcm.googleapis.com.nl/x', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x',
    'https://127.0.0.1/x', 'https://localhost/x', 'ftp://fcm.googleapis.com/x', 'not a url', '', null, undefined, 42]) assert.equal(isPushEndpoint(bad), false, String(bad));
});
test('a device id is short, stable and different for different addresses', () => {
  const a = deviceId('https://fcm.googleapis.com/fcm/send/a'), b = deviceId('https://fcm.googleapis.com/fcm/send/b');
  assert.match(a, /^d[0-9a-f]{16}$/); assert.equal(a, deviceId('https://fcm.googleapis.com/fcm/send/a')); assert.notEqual(a, b);
});
test('labels are cleaned and made from the browser description', () => {
  assert.equal(cleanLabel('  Mijn \n  telefoon  '), 'Mijn telefoon'); assert.equal(cleanLabel('x'.repeat(100)).length, 40); assert.equal(cleanLabel(null), '');
  assert.equal(deviceLabelFromUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36'), 'Chrome op Android');
  assert.equal(deviceLabelFromUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'), 'Safari op Mac');
  assert.equal(deviceLabelFromUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'), 'Chrome op Mac');
  assert.equal(deviceLabelFromUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1'), 'Safari op iOS');
  assert.equal(deviceLabelFromUA('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0'), 'Edge op Windows');
  assert.equal(deviceLabelFromUA(''), 'Browser');
});
const keys = { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) };
test('a device document holds the address, the keys and the coordinator as owner; Ritten ruilen is on', () => {
  const d = deviceDoc({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', ...keys, label: 'Chrome op Android', uid: 'u1', nowMs: 9 });
  assert.deepEqual(d, { owner: 'coordinator', uid: 'u1', endpoint: 'https://fcm.googleapis.com/fcm/send/abc', ...keys, label: 'Chrome op Android', categories: { ritbeurs: true }, createdAt: 9, lastOkAt: 0 });
});
test('an unusable subscription is never stored (null)', () => {
  const ok = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', ...keys, uid: 'u1', nowMs: 1 };
  assert.ok(deviceDoc(ok));
  for (const bad of [{ endpoint: 'https://evil.example/x' }, { p256dh: 'short' }, { auth: 'short' }, { p256dh: 'p'.repeat(86) + '=' }, { uid: '' }, { endpoint: '' }]) assert.equal(deviceDoc({ ...ok, ...bad }), null, JSON.stringify(bad));
});
test('a device wants a kind unless its category is switched off; unknown kinds are never wanted', () => {
  assert.deepEqual(CATEGORIES, ['ritbeurs']);
  for (const k of ['offerBackup', 'backupForRide', 'taken', 'takenDayCoordinator', 'uncovered']) { assert.equal(categoryOf(k), 'ritbeurs'); assert.equal(deviceWants({}, k), true, k); assert.equal(deviceWants({ categories: { ritbeurs: false } }, k), false, k); }
  assert.equal(categoryOf('toekomst'), null); assert.equal(deviceWants({}, 'toekomst'), false); assert.equal(deviceWants(null, 'taken'), false);
});
test('"Ouder van Saar": the family a message was meant for', () => {
  assert.equal(recipientLabel({ girlName: 'Saar', parentName: 'Jan' }, 'f1'), 'Ouder van Saar');
  assert.equal(recipientLabel({ parentName: 'Jan' }, 'f1'), 'Jan'); assert.equal(recipientLabel(null, 'f9'), 'f9'); assert.equal(recipientLabel({}, 'f9'), 'f9');
});

console.log('\n=== the queue ===');
test('an entry is named after the notification it is about; a manual send gets its own name', () => {
  assert.equal(queueKey('families/f2/notifications/taken_o1_f2'), 'families__f2__notifications__taken_o1_f2');
  assert.equal(queueKey('testNotifications/x', 'm5'), 'testNotifications__x__m5');
  assert.deepEqual(queueDoc({ path: 'testNotifications/x', toFamilyId: 'f1', kind: 'taken', deliverAt: 5, expiresAt: 9, nowMs: 2, test: true }), { path: 'testNotifications/x', toFamilyId: 'f1', kind: 'taken', deliverAt: 5, expiresAt: 9, createdAt: 2, test: true });
  assert.equal(queueDoc({ path: 'p', nowMs: 1 }).test, false);
});
const devices = { d1: { categories: { ritbeurs: true } }, d2: { categories: { ritbeurs: true } } };
const entry = (extra = {}) => ({ kind: 'taken', deliverAt: 100, expiresAt: 1000, ...extra });
test('what is left to do for an entry: expired, waiting, no device, done or open', () => {
  assert.equal(entryPlan({ entry: entry(), devices, nowMs: 1000 }).state, 'verlopen'); assert.equal(entryPlan({ entry: null, devices, nowMs: 5 }).state, 'verlopen');
  const wait = entryPlan({ entry: entry(), devices, nowMs: 50 }); assert.equal(wait.state, 'wacht'); assert.equal(wait.at, 100); assert.deepEqual(wait.targets, []);
  assert.equal(entryPlan({ entry: entry(), devices: {}, nowMs: 200 }).state, 'geen-toestel');
  assert.deepEqual(entryPlan({ entry: entry(), devices, nowMs: 200 }), { state: 'open', targets: ['d1', 'd2'] });
  assert.equal(entryPlan({ entry: entry({ sentTo: { d1: 1, d2: 1 } }), devices, nowMs: 200 }).state, 'klaar');
});
test('a device that already got it, that gave up, or that switched the category off is skipped; the others still get it', () => {
  assert.deepEqual(entryPlan({ entry: entry({ sentTo: { d1: 150 } }), devices, nowMs: 200 }).targets, ['d2']);
  assert.deepEqual(entryPlan({ entry: entry({ failedTo: { d1: MAX_FAILS - 1, d2: MAX_FAILS } }), devices, nowMs: 200 }).targets, ['d1']);
  assert.deepEqual(entryPlan({ entry: entry(), devices: { d1: { categories: { ritbeurs: false } }, d2: {} }, nowMs: 200 }).targets, ['d2']);
  assert.equal(entryPlan({ entry: entry({ failedTo: { d1: MAX_FAILS, d2: MAX_FAILS } }), devices, nowMs: 200 }).state, 'klaar');
});
test('a message exactly at its due time is due', () => {
  assert.equal(entryPlan({ entry: entry(), devices, nowMs: 100 }).state, 'open');
});

console.log('\n=== the message ===');
test('the title says whom the test was for, the body has the real title and text', () => {
  const p = buildPayload({ text: { title: 'Rit vrij: do 16:15', body: 'Jan biedt een rit aan.' }, who: 'Ouder van Saar', key: 'k1', forFamilyId: 'f1' });
  assert.deepEqual(p, { title: 'Test · Ouder van Saar', body: 'Rit vrij: do 16:15\nJan biedt een rit aan.', tag: 'k1', forFamilyId: 'f1', test: true, url: './?pushas=f1' });
});
test('a message always fits in a push (long texts are shortened), and the address is encoded', () => {
  const p = buildPayload({ text: { title: 't'.repeat(900), body: 'b'.repeat(900) }, who: 'w'.repeat(500), key: 'k', forFamilyId: 'a b&c' });
  assert.ok(Buffer.byteLength(JSON.stringify(p)) < 1500); assert.ok(p.body.endsWith('…')); assert.equal(p.url, './?pushas=a%20b%26c');
});
test('a tapped link gives the family id, and nothing else gets through', () => {
  assert.equal(parsePushLink('?pushas=f2'), 'f2'); assert.equal(parsePushLink('?x=1&pushas=abc_DEF-9&y=2'), 'abc_DEF-9'); assert.equal(parsePushLink('?pushas=f2#myweek'), 'f2');
  for (const bad of ['', null, undefined, '?pushas=', '?pushas=a/b', '?pushas=<script>', '?pushas=' + 'a'.repeat(65), '?other=f1', '?xpushas=f1']) assert.equal(parsePushLink(bad), null, String(bad));
});

console.log('\n=== the preview ===');
test('a notification is delivered, waiting for the quiet hours to end, or expired', () => {
  assert.equal(previewState({ deliverAt: 10, expiresAt: 100 }, 50), 'bezorgd'); assert.equal(previewState({ deliverAt: 60, expiresAt: 100 }, 50), 'wacht');
  assert.equal(previewState({ deliverAt: 10, expiresAt: 50 }, 50), 'verlopen'); assert.equal(previewState(null, 50), 'verlopen');
});
test('made-up notifications live a day', () => { assert.equal(TEST_NOTIFICATION_MS, 24 * 3600 * 1000); });

console.log('\n=== keys in the browser ===');
test('the public key and the subscription keys convert both ways', () => {
  const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i * 7 + 3) % 256);
  const text = bufferToBase64Url(bytes.buffer);
  assert.match(text, /^[A-Za-z0-9_-]{87}$/); assert.deepEqual([...urlBase64ToUint8Array(text)], [...bytes]);
  assert.deepEqual([...urlBase64ToUint8Array('AQID')], [1, 2, 3]); assert.equal(bufferToBase64Url(null), '');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
