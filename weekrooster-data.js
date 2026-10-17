// weekrooster-data.js — Afwijkend weekrooster, the database side. The rules are in weekrooster.js; the screens are in ui-weekrooster*.js.
//
// The feature switch (settings/weekrooster): with mode "uit" (the default, also for a missing document or an unknown value) nothing of the new
// flow is shown, read or written; the Firestore rules check the same switch, so an app that is still open stops too.
// Requests (weekRequests/<weekKey>_<day>_<familyId>): a family reads only its OWN. They are read document by document (10 known ids: this week
// and next week, five days), and only while the switch is on for this person.
import { t } from './i18n.js';
import { S } from './state.js';
import { isRealCoordinator, dayCoordinatorFor, myFamilyId, myLinkedFamilyId } from './coordinator.js';
import { showToast } from './ui-common.js';
import { effectiveCars, rideTime, famTime } from './rides.js';
import { keepOv } from './ov.js';
import { buildAdvice } from './weekrooster-impact.js';
import { deviationExpiryMs, deviationKey, weekKeyDayIso } from './dates.js';
import { cleanCars, currentDeviationDoc, db, recordLastUpdate, setReturnByPublicTransport } from './data.js';
import { renderDeviationTab } from './ui-deviation.js';
import { renderMyWeek } from './ui-myweek.js';
import { renderSchedule } from './ui-schedule.js';
import { REQUEST_DAYS, acceptRequest, buildRequests, pendingForDay, decidedDays, nextWeekKey, normalizeWeekrooster, requestId, weekroosterDoc, weekroosterVisible, withdrawRequest } from './weekrooster.js';

export function weekroosterMode() { return normalizeWeekrooster(S.weekrooster).mode; }
// Does THIS person see and use the new flow? "test": only the real coordinator (Testweergave does not change that). "aan": everybody.
export function weekroosterOn() { return weekroosterVisible(weekroosterMode(), isRealCoordinator()); }

// The coordinator switches the feature: 'uit' | 'test' | 'aan'. Saves at once. Existing data is never touched.
export async function setWeekrooster(mode) {
  if (!db) { showToast(t('data.geen_verbinding_met_opslag')); return false; }
  if (!isRealCoordinator()) { showToast(t('weekrooster.err.coordinatorOnly')); return false; }
  const next = normalizeWeekrooster({ mode }).mode;
  try {
    await db.doc('settings/weekrooster').set(weekroosterDoc(next, Date.now()));
    S.weekrooster = normalizeWeekrooster({ mode: next });
    showToast(next === 'aan' ? t('weekrooster.saved.aan') : next === 'test' ? t('weekrooster.saved.test') : t('weekrooster.saved.uit'));
    return true;
  } catch (e) { showToast(t('data.mislukt') + (e && e.message || e)); return false; }
}

// ---------- the weeks ----------
// 'this' = the current planning week, 'next' = the week after it.
export function weekKeyFor(which) { return which === 'next' ? nextWeekKey(S.currentWeekKey) : S.currentWeekKey; }

// Is this day of this week over (before today)? Today itself can still be changed, as in Wijzigen now.
export function isDayPast(weekKey, day) {
  const iso = weekKeyDayIso(weekKey, day);
  if (!iso) return false;
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return iso < d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
// The moment a day is over (end of that day, local time), for expiring a request nobody decided.
export function dayEndMs(weekKey, day) {
  const iso = weekKeyDayIso(weekKey, day);
  if (!iso) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d + 1).getTime();
}

// The fixed times of one family for one week: this week it follows the temporary rooster of a period (rideTime), next week the standard.
export function standardTimes(familyId, which) {
  const out = {};
  REQUEST_DAYS.forEach(day => {
    out[day] = which === 'next'
      ? { heen: famTime(familyId, day, 'heen'), terug: famTime(familyId, day, 'terug') }
      : { heen: rideTime(familyId, day, 'heen'), terug: rideTime(familyId, day, 'terug') };
  });
  return out;
}

// Who decides a day: the day coordinator of that weekday, else the real coordinator's family (null when neither is known).
export function deciderFamilyOf(day) {
  const dc = dayCoordinatorFor(S, day);
  if (dc && dc.familyId) return dc.familyId;
  return (S.coordinatorConfig && S.coordinatorConfig.familyId) || null;
}

// ---------- reading ----------
function stopWeekRequestListeners() {
  (S.weekRequestsUnsubs || []).forEach(u => { try { u(); } catch (e) { /* already gone */ } });
  S.weekRequestsUnsubs = [];
}
function stopDayRequestListeners() {
  (S.dayRequestsUnsubs || []).forEach(u => { try { u(); } catch (e) { /* already gone */ } });
  S.dayRequestsUnsubs = [];
}
export function stopWeekRequests() { stopWeekRequestListeners(); stopDayRequestListeners(); S.weekRequests = {}; S.weekRequestsKey = ''; S.dayRequests = {}; S.dayRequestsKey = ''; }

// The weekdays this person decides (day coordinator of that day, or the coordinator's family when no day coordinator is set).
export function myDeciderDays() {
  if (!weekroosterOn() || !myLinkedFamilyId()) return [];
  return decidedDays(deciderFamilyOf, myFamilyId());
}
// All requests of this week that this person may see: the own ones plus, for the days they decide, those of the other families.
export function requestsForDeciding() { return { ...S.dayRequests, ...S.weekRequests }; }

// Keeps the listeners in step with: the switch, who is looking (also in Testweergave) and the planning week. With the switch off for
// this person there are none, and nothing is read.
// - Own requests: 10 known documents (this week and next week, five days).
// - A day coordinator also reads the requests of the other families for the days they decide, THIS week only: what was handed in as
//   "next week" shows up by itself when the week changes (Friday 19:00).
export function syncWeekRequests() {
  const fid = (db && S.me && weekroosterOn() && myLinkedFamilyId()) ? myFamilyId() : null;
  syncOwn(fid);
  syncDays(fid);
}
// A listener that is refused or loses its connection ends for good. Start them again after a pause (at most a few times in a row, so a
// database that keeps refusing is not asked every few seconds); any answer resets the count.
let retries = 0, retryTimer = null;
function resyncSoon() {
  if (retryTimer || retries >= 5) return;
  retries++;
  retryTimer = setTimeout(() => { retryTimer = null; S.weekRequestsKey = ''; S.dayRequestsKey = ''; syncWeekRequests(); }, 5000 * retries);
}
function syncOwn(fid) {
  const key = fid ? fid + '|' + S.currentWeekKey : '';
  if (key === (S.weekRequestsKey || '')) return;
  stopWeekRequestListeners();
  S.weekRequests = {}; S.weekRequestsKey = key;
  if (!fid) return;
  [weekKeyFor('this'), weekKeyFor('next')].forEach(wk => REQUEST_DAYS.forEach(day => {
    const id = requestId(wk, day, fid);
    S.weekRequestsUnsubs.push(db.doc('weekRequests/' + id).onSnapshot(snap => {
      const next = { ...S.weekRequests };
      if (snap.exists) next[id] = snap.data(); else delete next[id];
      S.weekRequests = next; retries = 0;
      renderDeviationTab(); renderMyWeek(); renderSchedule();
    }, () => resyncSoon()));   // no permission or offline: the screens show no requests until it works again
  }));
}
function syncDays(fid) {
  const days = fid ? myDeciderDays() : [];
  const others = fid ? Object.keys(S.families || {}).filter(id => id !== fid).sort() : [];
  const key = days.length && others.length ? [fid, S.currentWeekKey, days.join(''), others.join(',')].join('|') : '';
  if (key === (S.dayRequestsKey || '')) return;
  stopDayRequestListeners();
  S.dayRequests = {}; S.dayRequestsKey = key;
  if (!key) return;
  days.forEach(day => others.forEach(other => {
    const id = requestId(S.currentWeekKey, day, other);
    S.dayRequestsUnsubs.push(db.doc('weekRequests/' + id).onSnapshot(snap => {
      const next = { ...S.dayRequests };
      if (snap.exists) next[id] = snap.data(); else delete next[id];
      S.dayRequests = next; retries = 0;
      renderMyWeek(); renderSchedule();
    }, () => resyncSoon()));   // not allowed (not the day coordinator after all) or offline: nothing to show, try again later
  }));
}

// ---------- writing ----------
// A family hands in the week form (one document per changed day, in one batch). days: { Do: { rides, heen, terug } } for every day of the form.
// - New times wait for the day coordinator ('pending'); "rijdt niet mee" is applied at once on the current week ('direct').
// - A day put back to the fixed rooster withdraws the request that was open for it (and puts a "rijdt niet mee" back).
// Returns { ok, written, skipped } (ok false = nothing was saved).
export async function submitWeekRequests(which, days) {
  const none = { ok: false, error: true, written: [], skipped: [] };   // error: nothing could be saved (the reason was shown, or there was nothing to do for this person)
  if (!db) { showToast(t('data.geen_verbinding_met_opslag')); return none; }
  if (!weekroosterOn() || !myLinkedFamilyId()) return none;
  if (S.wrBusy) return none;   // a double tap makes no double request
  const familyId = myFamilyId(), weekKey = weekKeyFor(which), nowMs = Date.now();
  S.wrBusy = true;
  try {
    const built = buildRequests({
      weekKey, familyId, days, standard: standardTimes(familyId, which), existing: S.weekRequests, nowMs, directTimes: false,
      test: weekroosterMode() === 'test',
      isPast: day => isDayPast(weekKey, day),
      deciderOf: deciderFamilyOf,
    });
    const batch = db.batch();
    built.writes.forEach(w => batch.set('weekRequests/' + w.id, w.doc));
    // Days back on the fixed rooster: withdraw what was open (pending), and undo an earlier "rijdt niet mee".
    const undoRides = [];
    built.skipped.filter(s => s.why === 'same').forEach(s => {
      const id = requestId(weekKey, s.day, familyId), old = S.weekRequests[id];
      if (!old) return;
      if (old.status === 'pending' || old.status === 'direct') batch.set('weekRequests/' + id, withdrawRequest(old, nowMs));
      if (old.status === 'direct' && old.rides === false) undoRides.push(s.day);
    });
    if (!built.writes.length && !built.skipped.some(s => s.why === 'same' && S.weekRequests[requestId(weekKey, s.day, familyId)])) return { ok: false, written: [], skipped: built.skipped };
    await batch.commit();
    // What was just saved shows at once, also when the live listeners are not running (yet).
    const local = { ...S.weekRequests };
    built.writes.forEach(w => { local[w.id] = w.doc; });
    built.skipped.filter(s => s.why === 'same').forEach(s => { const id = requestId(weekKey, s.day, familyId), old = local[id]; if (old && (old.status === 'pending' || old.status === 'direct')) local[id] = withdrawRequest(old, nowMs); });
    S.weekRequests = local;
    // "Rijdt niet mee" counts at once, for the current week (the cars of next week do not exist yet).
    if (which === 'this') {
      for (const w of built.writes) if (w.doc.status === 'direct' && w.doc.rides === false) for (const dir of ['heen', 'terug']) await setReturnByPublicTransport(w.doc.day, familyId, false, dir);
      for (const day of undoRides) for (const dir of ['heen', 'terug']) await setReturnByPublicTransport(day, familyId, true, dir);
    }
    return { ok: true, written: built.writes.map(w => w.doc), skipped: built.skipped };
  } catch (e) {
    showToast(t('data.opslaan_mislukt') + (e && e.message || e));
    return none;
  } finally { S.wrBusy = false; }
}

// The family takes back all its open (pending) requests of one week. Returns true when something was withdrawn.
export async function withdrawWeekRequests(which) {
  if (!db || !weekroosterOn() || !myLinkedFamilyId() || S.wrBusy) return false;
  const familyId = myFamilyId(), weekKey = weekKeyFor(which), nowMs = Date.now();
  const open = REQUEST_DAYS.map(day => S.weekRequests[requestId(weekKey, day, familyId)]).filter(r => r && r.status === 'pending');
  if (!open.length) return false;
  S.wrBusy = true;
  try {
    const batch = db.batch();
    open.forEach(r => batch.set('weekRequests/' + requestId(r.weekKey, r.day, r.familyId), withdrawRequest(r, nowMs)));
    await batch.commit();
    const local = { ...S.weekRequests };
    open.forEach(r => { local[requestId(r.weekKey, r.day, r.familyId)] = withdrawRequest(r, nowMs); });
    S.weekRequests = local;
    return true;
  } catch (e) { showToast(t('data.opslaan_mislukt') + (e && e.message || e)); return false; }
  finally { S.wrBusy = false; }
}

// ---------- the advice and the agreement (phase 4) ----------
export const ADVICE_VARIANTS = ['zuinig', 'gedoe'];
const DIRECTIONS = ['heen', 'terug'];

// The pending requests of a day that this person decides, oldest first.
export function pendingOfDay(day) {
  const wk = S.currentWeekKey;
  return pendingForDay(requestsForDeciding(), wk, day, Date.now(), dayEndMs(wk, day));
}

// The advice for one day: for every direction a pending request changes, the two variants (see weekrooster-impact.js).
// Result: { requests, directions: { heen?: { cars (now), variants }, terug?: ... } }. Nothing is saved.
export function adviceForDay(day) {
  const requests = pendingOfDay(day), directions = {};
  DIRECTIONS.forEach(dir => {
    const touching = requests.filter(r => (r[dir] || '') !== (rideTime(r.familyId, day, dir) || ''));
    if (!touching.length) return;
    const cars = effectiveCars(day, dir).map(c => ({ ...c, girlIds: [...(c.girlIds || [])] }));
    const res = buildAdvice({
      day, direction: dir, cars, requests: touching.map(r => ({ familyId: r.familyId, rides: true, time: r[dir] || '' })),
      timeOf: id => rideTime(id, day, dir), families: S.families, settings: S.settings, prefs: S.prefs, priority: (S.shiftPriority || {})[day + '_' + dir],
    });
    directions[dir] = { cars, ...res };
  });
  return { requests, directions };
}

// "Overnemen": the cars of the chosen variant become this week's one-off change (the same deviations as Wijzigen: cars + the one-off times
// of the askers), and all pending requests of the day become 'accepted'. ONE batch: all or nothing, and the first decision wins (the rules
// refuse a request that is no longer pending). Returns { ok, n, undo } where undo() puts everything back.
export async function acceptDay(day, variant) {
  if (!db) { showToast(t('data.geen_verbinding_met_opslag')); return { ok: false }; }
  if (!weekroosterOn() || !myLinkedFamilyId() || S.wrBusy) return { ok: false };
  const advice = adviceForDay(day), dirs = Object.keys(advice.directions);
  if (!advice.requests.length) return { ok: false };
  if (dirs.some(d => advice.directions[d].variants[variant].noSolution)) { showToast(t('weekrooster.advice.noSolution')); return { ok: false }; }
  const wk = S.currentWeekKey, nowMs = Date.now(), me = myFamilyId();
  S.wrBusy = true;
  try {
    const batch = db.batch(), prevDocs = {}, nextDocs = {};
    dirs.forEach(dir => {
      const key = deviationKey(day, dir), prev = currentDeviationDoc(day, dir), v = advice.directions[dir].variants[variant];
      prevDocs[key] = prev ? JSON.parse(JSON.stringify(prev)) : { day, direction: dir, weekKey: wk, expiresAt: deviationExpiryMs(), cars: cleanCars(advice.directions[dir].cars) };
      nextDocs[key] = { day, direction: dir, weekKey: wk, expiresAt: deviationExpiryMs(), cars: cleanCars(v.cars), ...keepOv(prev, v.cars), times: { ...((prev && prev.times) || {}), ...v.times } };
      batch.set('deviations/' + key, nextDocs[key]);
    });
    const agreed = advice.requests.map(r => ({ id: r.id, before: stripId(r), after: acceptRequest(stripId(r), me, nowMs) }));
    agreed.forEach(a => batch.set('weekRequests/' + a.id, a.after));
    await batch.commit();
    applyLocal(nextDocs, agreed.map(a => [a.id, a.after]));
    recordLastUpdate('Deviation');
    const undo = async () => {
      if (!db) return false;
      try {
        const b = db.batch();
        Object.entries(prevDocs).forEach(([key, d]) => b.set('deviations/' + key, d));
        agreed.forEach(a => b.set('weekRequests/' + a.id, a.before));
        await b.commit();
        applyLocal(prevDocs, agreed.map(a => [a.id, a.before]));
        recordLastUpdate('Deviation');
        return true;
      } catch (e) { showToast(t('data.mislukt') + (e && e.message || e)); return false; }
    };
    return { ok: true, n: advice.requests.length, undo };
  } catch (e) {
    showToast(t('data.opslaan_mislukt') + (e && e.message || e));
    return { ok: false };
  } finally { S.wrBusy = false; }
}
const stripId = r => { const { id, ...doc } = r; return doc; };
// What was just saved shows at once (the live listeners confirm it a moment later).
function applyLocal(devDocs, reqPairs) {
  S.deviations = { ...S.deviations, ...devDocs };
  const own = { ...S.weekRequests }, others = { ...S.dayRequests };
  reqPairs.forEach(([id, doc]) => { if (id in others) others[id] = doc; else own[id] = doc; });
  S.weekRequests = own; S.dayRequests = others;
}

// Tidying up (the real coordinator's browser only, and never while the switch is off): requests of OLDER weeks are removed, test requests included.
// Their week is over, the fixed rooster stayed as it was and nothing else reads them. Returns how many were removed.
export async function purgeStaleWeekRequests() {
  if (!db || !isRealCoordinator() || !weekroosterOn()) return 0;
  let n = 0;
  try {
    const snap = await db.collection('weekRequests').get();
    for (const d of snap.docs) {
      const r = d.data();
      if (r && typeof r.weekKey === 'string' && r.weekKey < S.currentWeekKey) { await db.doc('weekRequests/' + d.id).delete(); n++; }
    }
  } catch (e) { /* best effort: tidying up never blocks the app */ }
  return n;
}
