// session-reset.js — "Opnieuw beginnen": what a parent would otherwise do by hand in the browser settings.
// Forgets this browser's anonymous account (a fresh one is made at the next start), empties the app's offline copy,
// removes the service worker and reloads. Nothing else is touched: the theme and other preferences stay.
// Also removes the offline copy of the database (Firestore's own IndexedDB, see index.html): a new start must not begin with old data.
// Nothing in the database changes (a parent at the gate has no link yet), and nothing here needs a password.
import { db } from './data.js';

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
