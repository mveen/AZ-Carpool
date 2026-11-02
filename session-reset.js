// session-reset.js — "Opnieuw beginnen": what a parent would otherwise do by hand in the browser settings.
// Forgets this browser's anonymous account (a fresh one is made at the next start), empties the app's offline copy,
// removes the service worker and reloads. Nothing else is touched: the theme and other preferences stay.
// Also removes the offline copy of the database (Firestore's own IndexedDB, see index.html): a new start must not begin with old data.
// Nothing in the database changes (a parent at the gate has no link yet), and nothing here needs a password.
import { db } from './data.js';
import { t } from './i18n.js';

const FLAG = 'az-auto-reset';

// The gate may restart the app by itself ONCE per tab session; a second failure shows a message instead (no reload loop).
export function shouldAutoReset(store) {
  try { if (!store || store.getItem(FLAG)) return false; store.setItem(FLAG, '1'); return true; } catch (e) { return false; }
}
export function clearAutoReset(store) { try { if (store) store.removeItem(FLAG); } catch (e) { /* ignore */ } }

// Asks the browser to delete Firestore's offline copy. The database is still open in this page, so the browser finishes the delete when the
// page reloads (which the caller does next). Only databases whose name starts with "firestore/" are touched.
export async function clearOfflineCopy(idb = globalThis.indexedDB) {
  if (!idb || !idb.databases) return 0;
  let n = 0;
  for (const d of await idb.databases()) if (d && typeof d.name === 'string' && d.name.startsWith('firestore/')) { idb.deleteDatabase(d.name); n++; }
  return n;
}

export async function resetSession({ win = globalThis.window, nav = globalThis.navigator, cacheApi = globalThis.caches, idb = globalThis.indexedDB } = {}) {
  try { await db.signOut(); } catch (e) { /* carry on: the rest still helps */ }
  try { if (cacheApi && cacheApi.keys) for (const k of await cacheApi.keys()) await cacheApi.delete(k); } catch (e) { /* ignore */ }
  try { await clearOfflineCopy(idb); } catch (e) { /* ignore */ }
  try { if (nav && nav.serviceWorker && nav.serviceWorker.getRegistrations) for (const r of await nav.serviceWorker.getRegistrations()) await r.unregister(); } catch (e) { /* ignore */ }
  try { if (win && win.location) win.location.reload(); } catch (e) { /* ignore */ }
}

// ---------- Self-repair for Firestore's "Unexpected state" ----------
// Firestore 10.14.1 can fail an internal check ("INTERNAL ASSERTION FAILED: Unexpected state"), mostly with several tabs open. The screen then keeps its
// defaults (Ruilen off, no day coordinators) although the data is fine. The cure is the same as by hand: remove the offline copy and start again. Only the
// offline copy goes (the sign-in and the link to the family stay). Once per 10 minutes per tab; a second time within that, or a tab that still holds the
// copy open, gets a message instead of a reload loop.
export const FIRESTORE_ASSERT = /INTERNAL ASSERTION FAILED/i;
export const HEAL_FLAG = 'az-firestore-heal';
export const HEAL_WINDOW_MS = 10 * 60 * 1000;
export function shouldHeal(store, now = Date.now()) {
  try {
    if (!store) return false;
    const last = Number(store.getItem(HEAL_FLAG) || 0);
    if (last && now - last < HEAL_WINDOW_MS) return false;
    store.setItem(HEAL_FLAG, String(now)); return true;
  } catch (e) { return false; }
}
export async function healFirestoreState({ store, win = globalThis.window, idb = globalThis.indexedDB, toast = null, now = Date.now() } = {}) {
  if (!shouldHeal(store, now)) { if (toast) toast(t('heal.sluit_tabs')); return 'message'; }
  try { await clearOfflineCopy(idb); } catch (e) { /* the reload still helps */ }
  try { if (win && win.location) win.location.reload(); } catch (e) { /* nothing to reload (tests) */ }
  return 'reloaded';
}
export function installFirestoreHeal(win = globalThis.window, { toast = null } = {}) {
  if (!win || !win.addEventListener) return;
  let busy = false;
  const check = text => {
    if (busy || !FIRESTORE_ASSERT.test(String(text || ''))) return;
    busy = true;
    let store = null; try { store = win.sessionStorage; } catch (e) { /* none */ }
    healFirestoreState({ store, win, toast }).finally(() => { busy = false; });
  };
  win.addEventListener('error', e => check(e && e.message));
  win.addEventListener('unhandledrejection', e => check(e && e.reason && (e.reason.message || String(e.reason))));
}
