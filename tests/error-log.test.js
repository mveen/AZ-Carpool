// Run with: node error-log.test.js
// The app's own error log: what is stored (and what never is), the limits the Firestore rules rely on, queueing when there is no session,
// the coordinator's clean-up, and the catch-all for errors nobody handled.
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
import { installFakeDom, resetState, useFakeDb } from './test-support.js';
import { S } from '../state.js';
import {
  scrub, describeBrowser, buildEntry, staleLogIds, logError, flushErrorLog, loadQueuedErrors, installGlobalErrorLogging,
  purgeOldErrorLogs, clearErrorLog, LOG_SLOTS, LOG_KEEP_DAYS, _resetErrorLogForTests, _queuedForTests,
} from '../error-log.js';

installFakeDom();
const DAY = 24 * 60 * 60 * 1000;
const settle = () => new Promise(r => setImmediate(r));   // (setTimeout is unref'd by test-support: it would not keep the process alive)
const fresh = (seed = {}, state = { me: 'u1' }) => { _resetErrorLogForTests(); localStorage.removeItem('az-error-queue'); const fake = useFakeDb(seed); resetState(state); return fake; };

console.log('=== what is stored ===');
test('scrub removes phone numbers, codes of many digits, links, e-mail addresses and invite paths', () => {
  const s = scrub('Fout 0621708024 bij invites/CODE1234 en 2863061108 via https://azcarpool.nl/x?a=1 van jan@example.nl');
  assert.doesNotMatch(s, /0621708024|2863061108|CODE1234|azcarpool\.nl|jan@example/);
  assert.match(s, /#/); assert.match(s, /<link>/); assert.match(s, /<mail>/);
});
test('scrub keeps short numbers (line numbers, counts), makes one line and shortens', () => {
  assert.equal(scrub('regel 42\n kolom 7'), 'regel 42 kolom 7');
  assert.equal(scrub('x'.repeat(500), 200).length, 200);
  assert.equal(scrub(null), ''); assert.equal(scrub(undefined), '');
});
test('describeBrowser gives only OS, browser and major version', () => {
  assert.equal(describeBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'iOS Safari 17');
  assert.equal(describeBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'), 'Android Chrome 126');
  assert.equal(describeBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0'), 'Mac Firefox 128');
  assert.equal(describeBrowser('Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36'), 'Android Samsung 25');
  assert.equal(describeBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0'), 'Windows Edge 126');
  assert.equal(describeBrowser(''), '? ?');
});
test('an entry has exactly the fields the Firestore rules allow, within their limits', () => {
  const e = buildEntry({ where: 'gate'.repeat(30), code: 'c'.repeat(200), message: 'm'.repeat(900), now: 5, ua: 'x'.repeat(500) });
  assert.deepEqual(Object.keys(e).sort(), ['at', 'code', 'msg', 'ua', 'v', 'where']);
  assert.equal(typeof e.at, 'number'); assert.ok(e.where.length <= 40 && e.code.length <= 60 && e.msg.length <= 200 && e.v.length <= 20 && e.ua.length <= 60);
});
test('the number of slots is 10, as the rule "<uid>_[0-9]" assumes', () => assert.equal(LOG_SLOTS, 10));

console.log('\n=== writing ===');
await testAsync('logError writes errorLog/<uid>_<slot> with a scrubbed message and no personal data', async () => {
  const fake = fresh();
  assert.equal(logError({ where: 'gate', code: 'link-denied', message: 'telefoon 0621708024 code 2863061108' }), true);
  await settle();
  const rows = fake.collection('errorLog');
  assert.equal(rows.length, 1); assert.match(rows[0][0], /^u1_[0-9]$/);
  assert.equal(rows[0][1].where, 'gate'); assert.equal(rows[0][1].code, 'link-denied');
  assert.doesNotMatch(JSON.stringify(rows[0][1]), /0621708024|2863061108/);
});
await testAsync('the same message within a minute is logged once; a different one is logged too', async () => {
  const fake = fresh();
  assert.equal(logError({ where: 'gate', code: 'a', message: 'x' }), true);
  assert.equal(logError({ where: 'gate', code: 'a', message: 'x' }), false);
  assert.equal(logError({ where: 'gate', code: 'b', message: 'x' }), true);
  await settle(); assert.equal(fake.collection('errorLog').length, 2);
});
await testAsync('a runaway loop is capped: at most 10 entries per page load', async () => {
  const fake = fresh();
  const results = Array.from({ length: 15 }, (_, i) => logError({ where: 'loop', code: 'c' + i, message: 'm' }));
  assert.equal(results.filter(Boolean).length, 10);
  await settle(); await settle(); assert.ok(fake.collection('errorLog').length <= LOG_SLOTS);
});
await testAsync('without a session it is kept (also on the phone) and sent as soon as there is one', async () => {
  const fake = fresh({}, { me: null });
  logError({ where: 'start', code: 'signin-unavailable', message: 'offline' });
  await settle();
  assert.equal(fake.collection('errorLog').length, 0); assert.equal(_queuedForTests().length, 1);
  assert.match(localStorage.getItem('az-error-queue'), /signin-unavailable/);
  S.me = 'u9'; assert.equal(await flushErrorLog(), 1);
  assert.match(fake.collection('errorLog')[0][0], /^u9_[0-9]$/); assert.equal(_queuedForTests().length, 0);
});
await testAsync('a queue saved by an earlier start is picked up again', async () => {
  const fake = fresh({}, { me: null });
  localStorage.setItem('az-error-queue', JSON.stringify([{ at: 1, where: 'start', code: 'old', msg: '', v: 'v1', ua: '?' }]));
  loadQueuedErrors(); S.me = 'u2'; await flushErrorLog();
  assert.equal(fake.collection('errorLog')[0][1].code, 'old');
});
await testAsync('a failing write keeps the entry for later and never throws or logs itself', async () => {
  const fake = fresh(); fake.failWrites('errorLog/', 'permission-denied');
  assert.doesNotThrow(() => logError({ where: 'gate', code: 'x', message: 'y' }));
  await settle();
  assert.equal(_queuedForTests().length, 1); assert.equal(fake.collection('errorLog').length, 0);
  assert.equal(await flushErrorLog(), 1);   // the next try works
});
await testAsync('logError never throws, even for strange input', async () => {
  fresh();
  assert.doesNotThrow(() => { logError(); logError({}); logError({ where: null, code: {}, message: { toString() { throw new Error('boom'); } } }); });
});

console.log('\n=== catching what nobody handled ===');
function fakeWin() { const h = {}; return { h, addEventListener: (t, f) => { h[t] = f; } }; }
await testAsync('uncaught errors and rejected promises are logged; browser extensions and "Script error." are not', async () => {
  const fake = fresh(); const w = fakeWin(); installGlobalErrorLogging(w);
  w.h.error({ message: 'x is not defined', filename: 'https://azcarpool.nl/ui-myweek.js?v=3', lineno: 12 });
  w.h.error({ message: 'Script error.', filename: '' });
  w.h.error({ message: 'boom', filename: 'chrome-extension://abc/content.js', lineno: 1 });
  w.h.error({ message: 'ResizeObserver loop completed with undelivered notifications.', filename: '' });
  w.h.unhandledrejection({ reason: { code: 'unavailable', message: 'Failed to get document' } });
  await settle(); await settle();
  const rows = fake.collection('errorLog').map(r => r[1]);
  assert.equal(rows.length, 2);
  assert.ok(rows.some(r => r.where === 'js' && /x is not defined \(ui-myweek\.js:12\)/.test(r.msg)));
  assert.ok(rows.some(r => r.code === 'unavailable'));
});
test('installGlobalErrorLogging does nothing without a window', () => { assert.doesNotThrow(() => installGlobalErrorLogging(null)); });

console.log('\n=== clean-up (coordinator) ===');
test('staleLogIds picks entries older than 30 days and those without a usable time', () => {
  const now = 100 * DAY;
  const list = [{ id: 'a', data: { at: now - 31 * DAY } }, { id: 'b', data: { at: now - 29 * DAY } }, { id: 'c', data: {} }, { id: 'd', data: { at: 'x' } }];
  assert.deepEqual(staleLogIds(list, now), ['a', 'c', 'd']); assert.equal(LOG_KEEP_DAYS, 30);
});
await testAsync('purgeOldErrorLogs deletes only the old entries', async () => {
  const now = Date.now();
  const seed = { 'errorLog/u1_0': { at: now - 40 * DAY }, 'errorLog/u1_1': { at: now - DAY } };
  const fake = fresh(seed, { me: 'coord', errorLog: { 'u1_0': seed['errorLog/u1_0'], 'u1_1': seed['errorLog/u1_1'] } });
  assert.equal(await purgeOldErrorLogs(), 1);
  assert.deepEqual(fake.collection('errorLog').map(r => r[0]), ['u1_1']); assert.deepEqual(Object.keys(S.errorLog), ['u1_1']);
});
await testAsync('clearErrorLog removes everything', async () => {
  const fake = fresh({ 'errorLog/u1_0': { at: 1 }, 'errorLog/u2_3': { at: 2 } }, { me: 'coord', errorLog: { u1_0: {}, u2_3: {} } });
  assert.equal(await clearErrorLog(), 2); assert.equal(fake.collection('errorLog').length, 0); assert.deepEqual(S.errorLog, {});
});

import { assertNoUnusedImports } from './test-support.js';
test('error-log.js imports nothing it does not use', () => assertNoUnusedImports('error-log.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
