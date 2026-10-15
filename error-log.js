// error-log.js — a small, privacy-safe error log in the app's own database (errorLog/<uid>_<0-9>).
// What goes in: when, where in the app, a short error code, a scrubbed message, the app version and a coarse browser name.
// What never goes in: names, phone numbers, invite codes, e-mail addresses or links (scrub() removes them), nor the family.
// Each browser has 10 slots (a ring: the 11th message replaces the oldest), so one browser can never fill the database.
// Only the coordinator can read or delete the log (firestore.rules); the weekly purge job deletes entries after 30 days.
// Logging must never break the app: every function here swallows its own errors.
import { db } from './data.js';
import { S } from './state.js';
import { APP_VERSION } from './constants.js';

export const LOG_SLOTS = 10;          // entries per browser (must match the rule in firestore.rules)
export const LOG_KEEP_DAYS = 30;      // older entries are removed (purge job + the coordinator's app as safety net)
const MAX_PER_PAGE = 10;              // a runaway loop cannot flood the log
const DEDUPE_MS = 60 * 1000;          // the same message within a minute is logged once
const QUEUE_KEY = 'az-error-queue';
const MAX_QUEUED = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

let counter = 0, accepted = 0, flushing = false;
const lastSeen = new Map();
let queue = [];

// PURE. Text made safe to store: no links, e-mail addresses, invite paths or long digit runs (phone numbers, codes), one line, shortened.
export function scrub(text, max = 200) {
  return String(text == null ? '' : text)
    .replace(/https?:\/\/\S+/gi, '<link>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<mail>')
    .replace(/invites\/[^\s/'"]+/gi, 'invites/#')
    .replace(/\d{5,}/g, '#')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

// PURE. "iOS Safari 17", "Android Chrome 126", "Mac Firefox 128": only family and major version, never the full user-agent string.
export function describeBrowser(ua) {
  const s = String(ua || '');
  const os = /iPhone|iPad|iPod/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux|X11/.test(s) ? 'Linux' : '?';
  const pick = [['Edge', /(?:Edg|EdgA|EdgiOS)\/(\d+)/], ['Samsung', /SamsungBrowser\/(\d+)/], ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/], ['Safari', /Version\/(\d+)[\d.]* .*Safari/]];
  for (const [name, re] of pick) { const m = s.match(re); if (m) return `${os} ${name} ${m[1]}`; }
  return `${os} ?`.slice(0, 60);
}

// PURE. The entry as it is stored. `where` = screen or step ("gate", "start", "js"), `code` = short code ("link-denied", "permission-denied").
export function buildEntry({ where, code, message, now = Date.now(), ua = '' }) {
  return {
    at: now,
    where: scrub(where, 40) || '?',
    code: scrub(code, 60) || '?',
    msg: scrub(message, 200),
    v: String(APP_VERSION).slice(0, 20),
    ua: describeBrowser(ua).slice(0, 60),
  };
}

// PURE. Entries older than the keep period: [{id, data}] -> ids to delete.
export function staleLogIds(entries, now = Date.now(), keepDays = LOG_KEEP_DAYS) {
  const cutoff = now - keepDays * DAY_MS;
  return entries.filter(({ data }) => !data || typeof data.at !== 'number' || data.at < cutoff).map(({ id }) => id);
}

const browserUa = () => { try { return navigator.userAgent; } catch (e) { return ''; } };
const storage = () => { try { return localStorage; } catch (e) { return null; } };
function saveQueue() { try { const st = storage(); if (st) st.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUED))); } catch (e) { /* storage may be blocked */ } }

// Entries that could not be sent last time (offline, no session yet) are picked up again at start-up.
export function loadQueuedErrors() {
  try {
    const st = storage(); const raw = st && st.getItem(QUEUE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) queue = list.filter(e => e && typeof e.at === 'number').slice(-MAX_QUEUED);
  } catch (e) { queue = []; }
}

// Writes what is waiting. Without a session or database it just keeps it (also in localStorage) for later.
export async function flushErrorLog() {
  if (flushing || !queue.length || !db || !S.me) return 0;
  flushing = true; let n = 0;
  try {
    while (queue.length) {
      const slot = counter++ % LOG_SLOTS;
      await db.doc('errorLog/' + S.me + '_' + slot).set(queue[0]);
      queue.shift(); n++;
    }
  } catch (e) { /* stays queued; a failing log is never logged itself */ }
  finally { flushing = false; saveQueue(); }
  return n;
}

// Records one problem. Safe to call anywhere, as often as you like.
export function logError({ where, code, message } = {}) {
  try {
    const entry = buildEntry({ where, code, message, ua: browserUa() });
    const key = entry.where + '|' + entry.code + '|' + entry.msg;
    const last = lastSeen.get(key);
    if (last && entry.at - last < DEDUPE_MS) return false;
    if (accepted >= MAX_PER_PAGE) return false;
    lastSeen.set(key, entry.at); accepted++;
    queue.push(entry); if (queue.length > MAX_QUEUED) queue.shift();
    saveQueue();
    flushErrorLog().catch(() => {});
    return true;
  } catch (e) { return false; }
}

// Errors nobody caught. Browser extensions and the "Script error." of other sites carry no information about this app, so they are skipped.
export function installGlobalErrorLogging(win = globalThis) {
  if (!win || !win.addEventListener) return;
  win.addEventListener('error', e => {
    const file = String((e && e.filename) || '');
    if (/^(chrome|moz|safari-web)-extension:/i.test(file)) return;
    const msg = String((e && e.message) || '');
    if (!msg || /^Script error\.?$/i.test(msg) || /ResizeObserver loop/i.test(msg)) return;
    const where = file.split('/').pop().split('?')[0];
    logError({ where: 'js', code: 'error', message: msg + (where ? ` (${where}:${e.lineno || 0})` : '') });
  });
  win.addEventListener('unhandledrejection', e => {
    const r = e && e.reason;
    logError({ where: 'js', code: (r && r.code) || 'rejection', message: (r && r.message) || String(r || '') });
  });
}

// Coordinator only: removes entries past the keep period (safety net for when the purge job on the server is down).
export async function purgeOldErrorLogs(now = Date.now()) {
  try {
    const entries = Object.entries(S.errorLog || {}).map(([id, data]) => ({ id, data }));
    const ids = staleLogIds(entries, now);
    for (const id of ids) { await db.doc('errorLog/' + id).delete(); delete S.errorLog[id]; }
    return ids.length;
  } catch (e) { return 0; }
}

// Coordinator only: "Wis alles".
export async function clearErrorLog() {
  const ids = Object.keys(S.errorLog || {});
  const batch = db.batch(); ids.forEach(id => batch.delete('errorLog/' + id));
  await batch.commit();
  ids.forEach(id => delete S.errorLog[id]);
  return ids.length;
}

// Test hook: forget what this module remembers (counters, queue). Never called by the app.
export function _resetErrorLogForTests() { counter = 0; accepted = 0; flushing = false; lastSeen.clear(); queue = []; }
export function _queuedForTests() { return queue.slice(); }
