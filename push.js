// push.js — push notifications, TEST PHASE. PURE logic only: no DOM, no database, no network. Shared by the app (ui-push.js, push-data.js)
// and by the server job (cron/push.mjs), so both sides agree on what a message says and who may get it.
//
// Stored (all additive):
//   settings/push        { mode: 'uit' | 'test', updatedAt }   the master switch; anything else means 'uit'. There is NO live mode yet.
//   settings/pushKey     { publicKey, updatedAt }              the public VAPID key; written by the server job only, read by the app to subscribe
//   settings/pushStatus  { lastRunAt, mode, sent, pending, devices }   written by the server job each run: "is the server alive?"
//   pushDevices/{id}     a browser of the coordinator that wants test pushes (see deviceDoc); coordinator only
//   pushQueue/{key}      one entry per notification that may need a push (see queueDoc); the server sends from this list
//   testNotifications/{id}   made-up notifications of the scenarios in Beheer (same shape as a real notification); coordinator only
// See README, "Meldingen (testfase)".
import { t } from './i18n.js';

export const MAX_FAILS = 5;                        // after this many failed tries a device is given up for that message
export const STATUS_FRESH_MS = 10 * 60 * 1000;     // the server job counts as alive when it reported within this time
export const TEST_NOTIFICATION_MS = 24 * 3600 * 1000;   // made-up notifications and their queue entries vanish after a day
const CATEGORY_OF = { offerBackup: 'ritbeurs', backupForRide: 'ritbeurs', taken: 'ritbeurs', takenDayCoordinator: 'ritbeurs', uncovered: 'ritbeurs' };
export const categoryOf = kind => CATEGORY_OF[kind] || null;

// ---------- the master switch ----------
// Only the exact word 'test' switches anything on; a missing, broken or unknown value (e.g. 'live') means off.
export function normalizePush(raw){
  const r = raw && typeof raw === 'object' ? raw : {};
  return { mode: r.mode === 'test' ? 'test' : 'uit' };
}
export function pushSettingsDoc(mode, nowMs){ return { mode: mode === 'test' ? 'test' : 'uit', updatedAt: nowMs }; }

// Is the server job alive? 'ok' (reported lately), 'stil' (reported, but not lately), 'onbekend' (never reported).
export function serverState(status, nowMs){
  if(!status || typeof status.lastRunAt !== 'number') return 'onbekend';
  return nowMs - status.lastRunAt <= STATUS_FRESH_MS ? 'ok' : 'stil';
}

// ---------- devices ----------
// Browsers only hand out push addresses at these services. The server posts to the address stored in the database, so it only accepts these.
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function isPushEndpoint(url){
  let u;
  try { u = new URL(String(url)); } catch(e) { return false; }
  return u.protocol === 'https:' && !u.username && !u.password && !u.port && PUSH_HOSTS.some(re => re.test(u.hostname));
}
// A short stable id for a push address (two 32-bit hashes, hex). The same browser always gets the same id.
export function deviceId(endpoint){
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  const s = String(endpoint);
  for(let i = 0; i < s.length; i++){
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'd' + (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
export function cleanLabel(s){ return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 40); }
// "Chrome op Android" from a user-agent string; only for the list of devices, never trusted for anything.
export function deviceLabelFromUA(ua){
  const u = String(ua || '');
  const browser = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /(Chrome|CriOS)\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : t('push.toestel.browser');
  const os = /Android/.test(u) ? 'Android' : /iPhone|iPad/.test(u) ? 'iOS' : /Mac OS X|Macintosh/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : '';
  return cleanLabel(os ? t('push.toestel.label', { browser, os }) : browser);
}
// The document stored for one browser. null when the subscription is not usable (so nothing broken is ever stored).
export function deviceDoc({ endpoint, p256dh, auth, label, uid, nowMs }){
  if(!isPushEndpoint(endpoint) || !/^[A-Za-z0-9_-]{87}$/.test(String(p256dh)) || !/^[A-Za-z0-9_-]{22}$/.test(String(auth)) || !uid) return null;
  return { owner: 'coordinator', uid, endpoint, p256dh, auth, label: cleanLabel(label) || t('push.toestel.browser'), categories: { ritbeurs: true }, createdAt: nowMs, lastOkAt: 0 };
}
// Does this device want messages of this kind? A missing setting means yes.
export function deviceWants(device, kind){
  const c = categoryOf(kind);
  if(!c || !device) return false;
  return !(device.categories && device.categories[c] === false);
}

// ---------- who the test message is "for" ----------
// "Ouder van Saar": how the coordinator recognises the family a message was meant for.
export function recipientLabel(family, id){
  const f = family || {};
  if(f.girlName) return t('push.ouderVan', { name: f.girlName });
  return f.parentName || String(id || '');
}

// ---------- the queue ----------
// One entry per notification that may need a push. `path` is where the notification lives (families/<id>/notifications/<id> or testNotifications/<id>).
// The server sends from this list and notes in the entry (sentTo, failedTo) which devices got it, so nothing is sent twice.
export function queueKey(path, suffix){ return String(path).replace(/\//g, '__') + (suffix ? '__' + suffix : ''); }
export function queueDoc({ path, toFamilyId, kind, deliverAt, expiresAt, nowMs, test }){
  return { path, toFamilyId, kind, deliverAt, expiresAt, createdAt: nowMs, test: test === true };
}
// What is left to do for a queue entry at this moment.
//   state: 'verlopen' (past expiry) | 'wacht' (not yet due: quiet hours) | 'geen-toestel' | 'klaar' (everything sent, given up or switched off) | 'open' (devices still to send to)
export function entryPlan({ entry, devices, nowMs }){
  if(!entry || typeof entry !== 'object') return { state: 'verlopen', targets: [] };
  if(!(entry.expiresAt > nowMs)) return { state: 'verlopen', targets: [] };
  if(entry.deliverAt > nowMs) return { state: 'wacht', targets: [], at: entry.deliverAt };
  const ids = Object.keys(devices || {});
  if(!ids.length) return { state: 'geen-toestel', targets: [] };
  const targets = ids.filter(id => deviceWants(devices[id], entry.kind) && !(entry.sentTo && entry.sentTo[id]) && !((entry.failedTo && entry.failedTo[id]) >= MAX_FAILS)).sort();
  return { state: targets.length ? 'open' : 'klaar', targets };
}

// ---------- the message ----------
const clip = (s, n) => { const x = String(s == null ? '' : s); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
// The push shown on the coordinator's device. It says whom it was meant for, then the real text.
//   text = { title, body } from notificationText(); who = recipientLabel(); key = queue key (also the tag: the same message replaces itself).
export function buildPayload({ text, who, key, forFamilyId }){
  return {
    title: clip(t('push.test.titel', { who }), 80),
    body: clip(`${text.title}\n${text.body}`, 400),
    tag: String(key), forFamilyId: String(forFamilyId || ''), test: true,
    url: './?pushas=' + encodeURIComponent(forFamilyId || ''),
  };
}
// "?pushas=f2" -> 'f2'. Anything that is not a plain id gives null (the link comes from a notification, but it is still outside input).
export function parsePushLink(search){
  const m = /[?&]pushas=([A-Za-z0-9_-]{1,64})(?:&|#|$)/.exec(String(search || ''));
  return m ? m[1] : null;
}

// ---------- the preview in Beheer ----------
// What a family would see of one of its notifications at this moment: 'bezorgd' | 'wacht' (quiet hours) | 'verlopen'.
export function previewState(n, nowMs){
  if(!n) return 'verlopen';
  if(n.expiresAt <= nowMs) return 'verlopen';
  return n.deliverAt > nowMs ? 'wacht' : 'bezorgd';
}

// The public key as the browser wants it when subscribing.
export function urlBase64ToUint8Array(s){
  const pad = '='.repeat((4 - String(s).length % 4) % 4);
  const raw = atob((String(s) + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for(let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
// The keys of a browser subscription as base64url text (subscription.getKey gives an ArrayBuffer).
export function bufferToBase64Url(buf){
  const bytes = new Uint8Array(buf || []);
  let s = '';
  for(let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
