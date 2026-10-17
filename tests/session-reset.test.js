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
import { resetSession, clearOfflineCopy, shouldAutoReset, clearAutoReset } from '../session-reset.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
