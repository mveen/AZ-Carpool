// weekrooster-data.js — Afwijkend weekrooster, the database side. The rules are in weekrooster.js; the screens are in ui-weekrooster*.js.
//
// The feature switch (settings/weekrooster): with mode "uit" (the default, also for a missing document or an unknown value) nothing of the new
// flow is shown, read or written; the Firestore rules check the same switch, so an app that is still open stops too.
// Requests (weekRequests/<weekKey>_<day>_<familyId>): the own ones are read document by document (10 known ids: this week and next week, five
// days); the requests of the other families (times only) come in through ONE listener on the collection. Only while the switch is on for this person.
import { t } from './i18n.js';
import { S } from './state.js';
import { isRealCoordinator, dayCoordinatorFor, myFamilyId, myLinkedFamilyId } from './coordinator.js';
import { showToast } from './ui-common.js';
import { effectiveCars, rideTime, famTime, computeRideDeparture, ovGirlsFor } from './rides.js';
import { keepOv } from './ov.js';
import { buildAdvice } from './weekrooster-impact.js';
import { deviationExpiryMs, deviationKey, weekKeyDayIso } from './dates.js';
import { cleanCars, currentDeviationDoc, db, recordLastUpdate, returnByPublicTransportDoc } from './data.js';
import { renderDeviationTab } from './ui-deviation.js';
import { renderMyWeek } from './ui-myweek.js';
import { renderSchedule } from './ui-schedule.js';
import { REQUEST_DAYS, acceptRequest, buildRequests, desiredMarks, pendingForDay, decidedDays, nextWeekKey, normalizeWeekrooster, requestId, weekroosterDoc, weekroosterVisible, withdrawRequest } from './weekrooster.js';

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
  // The FIXED rooster: the one-off times of an agreed request (deviation.times) do not count here, so a day put back to it can be recognised.
  const devs = {};
  Object.entries(S.deviations || {}).forEach(([k, d]) => { if (d && d.times) { const { times, ...rest } = d; devs[k] = rest; } else devs[k] = d; });
  const st = { ...S, deviations: devs };
  const out = {};
  REQUEST_DAYS.forEach(day => {
    out[day] = which === 'next'
      ? { heen: famTime(familyId, day, 'heen'), terug: famTime(familyId, day, 'terug') }
      : { heen: rideTime(familyId, day, 'heen', st), terug: rideTime(familyId, day, 'terug', st) };
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
// - Every family also reads the requests of the other families, THIS week only (a day coordinator to decide, a parent for the note): what was handed in as
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
  // Every linked family reads the open requests of the others (times only), for the parent's note: ONE listener on the collection, filtered
  // on this week by the server (so older weeks are not read).
  const key = fid ? fid + '|' + S.currentWeekKey : '';
  if (key === (S.dayRequestsKey || '')) return;
  stopDayRequestListeners();
  S.dayRequests = {}; S.dayRequestsKey = key;
  if (!key) return;
  const wk = S.currentWeekKey;
  S.dayRequestsUnsubs.push(db.collection('weekRequests').whereEqual('weekKey', wk).onSnapshot(snap => {
    const next = {};
    snap.docs.forEach(d => { const r = d.data(); if (r && r.weekKey === wk && r.familyId !== fid) next[d.id] = r; });
    S.dayRequests = next; retries = 0;
    renderMyWeek(); renderSchedule();
  }, () => resyncSoon()));   // not allowed or offline: nothing to show, try again later
}

// ---------- writing ----------
// A family put a day back on its fixed rooster: its one-off times come off the cars of that day (the cars themselves stay as they are, only the
// departure time of the car she sits in is calculated again). Returns [{ key, doc }] for the shifts that had a one-off time of her.
function revertedTimesDocs(day, familyId) {
  const out = [];
  ['heen', 'terug'].forEach(dir => {
    const cur = currentDeviationDoc(day, dir);
    if (!cur || !cur.times || !Object.prototype.hasOwnProperty.call(cur.times, familyId)) return;
    const { [familyId]: gone, ...times } = cur.times;
    const key = deviationKey(day, dir), without = { ...cur }; delete without.times;
    if (Object.keys(times).length) without.times = times;
    const st = { ...S, deviations: { ...S.deviations, [key]: without } };
    without.cars = (cur.cars || []).map(c => (c.girlIds || []).includes(familyId) ? { ...c, departureTime: computeRideDeparture(day, dir, c.girlIds, st) } : c);
    out.push({ key, doc: without });
  });
  return out;
}

// The shifts of this week the own daughter is marked "rijdt niet mee" on: { Ma: { heen: false, terug: true }, ... }. This is what Mijn week shows
// and what the planning uses, so it is also what the week form opens with (a toggle in Mijn week and the form are two views of the same marks).
export function currentMarks(familyId) {
  const out = {};
  REQUEST_DAYS.forEach(day => { out[day] = { heen: ovGirlsFor(day, undefined, 'heen').includes(familyId), terug: ovGirlsFor(day, undefined, 'terug').includes(familyId) }; });
  return out;
}

// A family hands in the week form (one document per changed day, in one batch). days: { Do: { rides, heen, terug } } for every day of the form.
// - New times wait for the day coordinator ('pending'); "rijdt niet mee" is applied at once on the current week ('direct'): the whole day as a request
//   plus a mark per shift, one emptied time (or the unticked day) only as the mark of that shift (the database only takes 'direct' for a whole day off).
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
      weekKey, familyId, days, standard: standardTimes(familyId, which), existing: S.weekRequests, nowMs, directTimes: which === 'this',   // next week has no cars yet: there it stays a request
      test: weekroosterMode() === 'test', shiftOff: which === 'this',
      isPast: day => isDayPast(weekKey, day),
      deciderOf: deciderFamilyOf,
    });
    // This week the marks per shift follow the form: only the shifts whose mark really changes are written.
    const wanted = which === 'this' ? desiredMarks({ days, standard: standardTimes(familyId, which), isPast: day => isDayPast(weekKey, day) }) : {};
    const markChanges = {};
    Object.entries(wanted).forEach(([day, m]) => ['heen', 'terug'].forEach(dir => { if (m[dir] !== ovGirlsFor(day, undefined, dir).includes(familyId)) (markChanges[day] = markChanges[day] || []).push(dir); }));
    // The own day of a day coordinator is direct: the cars change at once (same change as Overnemen). Without a sound arrangement it stays a request.
    const devDocs = {};
    built.writes.forEach(w => {
      if (w.doc.status !== 'direct' || w.doc.rides === false) return;
      // A day whose marks change in the same save stays a request: the cars of this day are changed by the marks, not planned twice.
      if (markChanges[w.doc.day]) { w.doc.status = 'pending'; delete w.doc.decidedAt; delete w.doc.decidedBy; return; }
      const plan = directPlan(w.doc.day, { ...w.doc, id: w.id });
      if (plan) Object.assign(devDocs, plan);
      else { w.doc.status = 'pending'; delete w.doc.decidedAt; delete w.doc.decidedBy; }
    });
    const batch = db.batch();
    built.writes.forEach(w => batch.set('weekRequests/' + w.id, w.doc));
    // Days back on the fixed rooster: withdraw what was open (pending, direct or accepted), undo an earlier "rijdt niet mee" and take the
    // one-off times of this family off the cars again.
    const localWithdrawn = {};
    built.skipped.filter(s => s.why === 'same').forEach(s => {
      const id = requestId(weekKey, s.day, familyId), old = S.weekRequests[id];
      if (!old || !['pending', 'direct', 'accepted'].includes(old.status)) return;
      const { decidedAt, decidedBy, ...rest } = withdrawRequest(old, nowMs);   // a withdrawn request carries no decision (the rules want that for an accepted one)
      localWithdrawn[id] = rest; batch.set('weekRequests/' + id, rest);
      if (which !== 'this') return;
      const docs = old.rides === false ? [] : revertedTimesDocs(s.day, familyId);   // a "rijdt niet mee" day: its marks come off through the marks below
      docs.forEach(r => { if (r) devDocs[r.key] = r.doc; });
    });
    // The marks per shift, built on top of what this save already changes to the same shifts (one-off times, cars), so nothing is lost.
    const markDocs = {};
    const kept = S.deviations;
    try {
      S.deviations = { ...S.deviations, ...devDocs };
      Object.entries(markChanges).forEach(([day, dirs]) => dirs.forEach(dir => {
        const r = returnByPublicTransportDoc(day, familyId, wanted[day][dir], dir);
        markDocs[r.key] = r.doc; S.deviations = { ...S.deviations, [r.key]: r.doc };
      }));
    } finally { S.deviations = kept; }
    Object.assign(devDocs, markDocs);
    Object.entries(devDocs).forEach(([key, d]) => batch.set('deviations/' + key, d));
    if (!built.writes.length && !Object.keys(localWithdrawn).length && !Object.keys(markDocs).length) return { ok: false, written: [], skipped: built.skipped };
    await batch.commit();
    // What was just saved shows at once, also when the live listeners are not running (yet).
    S.weekRequests = { ...S.weekRequests, ...Object.fromEntries(built.writes.map(w => [w.id, w.doc])), ...localWithdrawn };
    if (Object.keys(devDocs).length) { S.deviations = { ...S.deviations, ...devDocs }; recordLastUpdate('Deviation'); }
    return { ok: true, written: built.writes.map(w => w.doc), skipped: built.skipped };
  } catch (e) {
    showToast(t('data.opslaan_mislukt') + (e && e.message || e));
    return none;
  } finally { S.wrBusy = false; }
}

// The family takes back its open (pending) requests of one week, or of one day when onlyDay is given. Returns true when something was withdrawn.
export async function withdrawWeekRequests(which, onlyDay) {
  if (!db || !weekroosterOn() || !myLinkedFamilyId() || S.wrBusy) return false;
  const familyId = myFamilyId(), weekKey = weekKeyFor(which), nowMs = Date.now();
  const open = REQUEST_DAYS.map(day => S.weekRequests[requestId(weekKey, day, familyId)]).filter(r => r && r.status === 'pending' && (!onlyDay || r.day === onlyDay));
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

// Mijn week switched her back on for a shift: she is no longer off the whole day, so the "rijdt niet mee" request of that day (a whole day off)
// is withdrawn. What is still off lives on as the mark of that shift (the week form reads the marks). Returns true when a request was withdrawn.
export async function releaseNotRidingRequest(day) {
  if (!db || !weekroosterOn() || !myLinkedFamilyId()) return false;
  const familyId = myFamilyId(), id = requestId(weekKeyFor('this'), day, familyId), old = S.weekRequests[id];
  if (!old || old.rides !== false || !['direct', 'accepted'].includes(old.status)) return false;
  const { decidedAt, decidedBy, ...rest } = withdrawRequest(old, Date.now());
  try {
    await db.doc('weekRequests/' + id).set(rest);
    S.weekRequests = { ...S.weekRequests, [id]: rest };
    return true;
  } catch (e) { showToast(t('data.opslaan_mislukt') + (e && e.message || e)); return false; }
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
export function adviceForDay(day, only) {
  const requests = only || pendingOfDay(day), directions = {};
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

// A day coordinator changing the own daughter on a day he decides himself: the same one-off change as "Overnemen", for this one request.
// Returns the deviation documents to write ({ key: doc }), or null when that is not possible (no sound arrangement) or nothing changes:
// the caller then keeps it a normal request.
export function directPlan(day, request) {
  const advice = adviceForDay(day, [request]), dirs = Object.keys(advice.directions);
  if (!dirs.length || dirs.some(d => advice.directions[d].variants.zuinig.noSolution)) return null;
  const out = {};
  dirs.forEach(dir => {
    const prev = currentDeviationDoc(day, dir), v = advice.directions[dir].variants.zuinig;
    out[deviationKey(day, dir)] = { day, direction: dir, weekKey: S.currentWeekKey, expiresAt: deviationExpiryMs(), cars: cleanCars(v.cars), ...keepOv(prev, v.cars), times: { ...((prev && prev.times) || {}), ...v.times } };
  });
  return out;
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
// "Klaar" after the day coordinator planned a day by hand (Zelf indelen): the plan IS the decision, so the pending requests of that day
// become 'accepted' (the same as Overnemen, but the cars stay as they are). Without this the amber card in Mijn week of the askers would
// stay until the day is over. ONE batch; returns { ok, n, undo } (n = 0 when nothing was waiting).
export async function closeDayRequests(day) {
  if (!db || !weekroosterOn() || !myLinkedFamilyId() || S.wrBusy) return { ok: false, n: 0 };
  const open = pendingOfDay(day);
  if (!open.length) return { ok: true, n: 0 };
  const nowMs = Date.now(), me = myFamilyId();
  S.wrBusy = true;
  try {
    const batch = db.batch();
    const agreed = open.map(r => ({ id: r.id, before: stripId(r), after: acceptRequest(stripId(r), me, nowMs) }));
    agreed.forEach(a => batch.set('weekRequests/' + a.id, a.after));
    await batch.commit();
    applyLocal({}, agreed.map(a => [a.id, a.after]));
    const undo = async () => {
      if (!db) return false;
      try {
        const b = db.batch();
        agreed.forEach(a => b.set('weekRequests/' + a.id, a.before));
        await b.commit();
        applyLocal({}, agreed.map(a => [a.id, a.before]));
        return true;
      } catch (e) { showToast(t('data.mislukt') + (e && e.message || e)); return false; }
    };
    return { ok: true, n: agreed.length, undo };
  } catch (e) {
    showToast(t('data.opslaan_mislukt') + (e && e.message || e));
    return { ok: false, n: 0 };
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
