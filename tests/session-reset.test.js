// Run with: node session-reset.test.js
// "Opnieuw beginnen": forgets the browser's anonymous account, empties the offline copy, removes the service worker, reloads.
// And the guard that lets the gate restart the app by itself only once per tab session.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, resetState, useFakeDb } from './test-support.js';
import { resetSession, clearOfflineCopy, shouldAutoReset, clearAutoReset, shouldHeal, healFirestoreState, installFirestoreHeal, FIRESTORE_ASSERT, HEAL_WINDOW_MS } from '../session-reset.js';

installFakeDom();
const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

console.log('=== resetSession ===');
await testAsync('signs out, deletes every cache, removes the service worker and reloads - in that order', async () => {
  const fake = useFakeDb({}); resetState({ me: 'u1' });
  const log = [];
  const cacheApi = { keys: async () => ['a', 'b'], delete: async k => { log.push('cache:' + k); return true; } };
  const nav = { serviceWorker: { getRegistrations: async () => [{ unregister: async () => { log.push('sw'); } }] } };
  const win = { location: { reload: () => log.push('reload') } };
  await resetSession({ win, nav, cacheApi });
  assert.equal(fake.signOutCount(), 1);
  assert.deepEqual(log, ['cache:a', 'cache:b', 'sw', 'reload']);
});
await testAsync('removes the offline copy of the database (only Firestore\'s own) between the caches and the service worker', async () => {
  useFakeDb({}); resetState({ me: 'u1' });
  const log = [];
  const idb = { databases: async () => [{ name: 'firestore/[DEFAULT]/az-carpool/main' }, { name: 'other-app' }, { name: 'firestore/[DEFAULT]/az-carpool/main-x' }, {}], deleteDatabase: n => { log.push('idb:' + n); } };
  const cacheApi = { keys: async () => ['a'], delete: async k => { log.push('cache:' + k); return true; } };
  const nav = { serviceWorker: { getRegistrations: async () => [{ unregister: async () => { log.push('sw'); } }] } };
  await resetSession({ win: { location: { reload: () => log.push('reload') } }, nav, cacheApi, idb });
  assert.deepEqual(log, ['cache:a', 'idb:firestore/[DEFAULT]/az-carpool/main', 'idb:firestore/[DEFAULT]/az-carpool/main-x', 'sw', 'reload']);
});
await testAsync('clearOfflineCopy: no IndexedDB, no databases() (older browsers) or a failing one never stops the reset', async () => {
  assert.equal(await clearOfflineCopy(null), 0);
  assert.equal(await clearOfflineCopy({}), 0);
  await assert.rejects(clearOfflineCopy({ databases: async () => { throw new Error('no'); } }));
  useFakeDb({}); resetState({ me: 'u1' });
  const log = [];
  await resetSession({ win: { location: { reload: () => log.push('reload') } }, nav: {}, cacheApi: null, idb: { databases: async () => { throw new Error('no'); } } });
  assert.deepEqual(log, ['reload']);
});
await testAsync('still reloads when one of the steps fails or does not exist', async () => {
  useFakeDb({}); resetState({ me: 'u1' });
  const log = [];
  await resetSession({ win: { location: { reload: () => log.push('reload') } }, nav: {}, cacheApi: { keys: async () => { throw new Error('no cache'); } } });
  assert.deepEqual(log, ['reload']);
  await resetSession({ win: { location: { reload: () => log.push('reload2') } }, nav: { serviceWorker: { getRegistrations: async () => { throw new Error('x'); } } }, cacheApi: null });
  assert.deepEqual(log, ['reload', 'reload2']);
});
await testAsync('works with an older index.html that cannot sign out (no signOut in the SDK)', async () => {
  const fake = useFakeDb({}); delete fake.sdk.signOut; resetState({ me: 'u1' });
  const log = [];
  await resetSession({ win: { location: { reload: () => log.push('reload') } }, nav: {}, cacheApi: null });
  assert.deepEqual(log, ['reload']);
});
await testAsync('does not touch the theme or other preferences in localStorage', async () => {
  useFakeDb({}); resetState({ me: 'u1' }); localStorage.setItem('view-as', 'parent');
  await resetSession({ win: { location: { reload() {} } }, nav: {}, cacheApi: null });
  assert.equal(localStorage.getItem('view-as'), 'parent');
});

console.log('\n=== only once by itself ===');
await testAsync('the first time says yes, the second time no (no reload loop); clearing allows it again', async () => {
  const st = memStore();
  assert.equal(shouldAutoReset(st), true); assert.equal(shouldAutoReset(st), false);
  clearAutoReset(st); assert.equal(shouldAutoReset(st), true);
});
await testAsync('without usable storage it never restarts by itself', async () => {
  assert.equal(shouldAutoReset(null), false);
  assert.equal(shouldAutoReset({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }), false);
  assert.doesNotThrow(() => clearAutoReset(null));
});

import { assertNoUnusedImports } from './test-support.js';
await testAsync('session-reset.js imports nothing it does not use', async () => assertNoUnusedImports('session-reset.js'));


console.log('=== v221: self-repair for Firestore "Unexpected state" ===');
await testAsync('the pattern matches the Firestore assertion text and nothing else', () => {
  assert.ok(FIRESTORE_ASSERT.test('FIRESTORE (10.14.1) INTERNAL ASSERTION FAILED: Unexpected state'));
  assert.ok(!FIRESTORE_ASSERT.test('Missing or insufficient permissions.'));
});
await testAsync('shouldHeal: once per 10 minutes per tab, again after that, never without storage', () => {
  const st = memStore();
  assert.equal(shouldHeal(st, 1000), true); assert.equal(shouldHeal(st, 1000 + 5000), false);
  assert.equal(shouldHeal(st, 1000 + HEAL_WINDOW_MS + 1), true);
  assert.equal(shouldHeal(null), false);
});
await testAsync('the first assertion removes only the offline copy and reloads; the second within 10 minutes shows a message and does not reload', async () => {
  useFakeDb({}); resetState({ me: 'u1' });
  const log = []; const st = memStore();
  const idb = { databases: async () => [{ name: 'firestore/[DEFAULT]/x/main' }, { name: 'firebaseLocalStorageDb' }], deleteDatabase: n => log.push('del:' + n) };
  const win = { location: { reload: () => log.push('reload') } };
  const toasts = [];
  assert.equal(await healFirestoreState({ store: st, win, idb, toast: m => toasts.push(m), now: 5000 }), 'reloaded');
  assert.deepEqual(log, ['del:firestore/[DEFAULT]/x/main', 'reload'], 'the sign-in database is left alone');
  assert.equal(await healFirestoreState({ store: st, win, idb, toast: m => toasts.push(m), now: 6000 }), 'message');
  assert.equal(log.length, 2); assert.match(toasts[0], /Sluit andere tabbladen/);
});
await testAsync('installFirestoreHeal reacts to an error event and to a rejection with that text, and ignores other errors', async () => {
  useFakeDb({}); resetState({ me: 'u1' });
  const handlers = {}; const toasts = [];
  const store = memStore(); store.setItem('az-firestore-heal', String(Date.now()));   // already healed a moment ago: only the message shows
  const win = { addEventListener: (n, f) => { handlers[n] = f; }, sessionStorage: store, location: { reload: () => { throw new Error('no reload expected'); } } };
  installFirestoreHeal(win, { toast: m => toasts.push(m) });
  handlers.error({ message: 'something else' }); await new Promise(r => setImmediate(r)); assert.equal(toasts.length, 0);
  handlers.error({ message: 'FIRESTORE (10.14.1) INTERNAL ASSERTION FAILED: Unexpected state' }); await new Promise(r => setImmediate(r));
  assert.equal(toasts.length, 1);
  handlers.unhandledrejection({ reason: { message: 'FIRESTORE (10.14.1) INTERNAL ASSERTION FAILED: Unexpected state' } }); await new Promise(r => setImmediate(r));
  assert.equal(toasts.length, 2);
});
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
