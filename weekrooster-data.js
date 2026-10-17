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
import { rideTime, famTime } from './rides.js';
import { weekKeyDayIso } from './dates.js';
import { db, setReturnByPublicTransport } from './data.js';
import { renderDeviationTab } from './ui-deviation.js';
import { renderMyWeek } from './ui-myweek.js';
import { REQUEST_DAYS, buildRequests, nextWeekKey, normalizeWeekrooster, requestId, weekroosterDoc, weekroosterVisible, withdrawRequest } from './weekrooster.js';

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
export function stopWeekRequests() { stopWeekRequestListeners(); S.weekRequests = {}; S.weekRequestsKey = ''; }

// Keeps the listeners in step with: the switch, who is looking (also in Testweergave) and the planning week. With the switch off for
// this person there are none, and nothing is read.
export function syncWeekRequests() {
  const fid = (db && S.me && weekroosterOn() && myLinkedFamilyId()) ? myFamilyId() : null;
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
      S.weekRequests = next;
      renderDeviationTab(); renderMyWeek();
    }, () => { /* no permission or offline: the screens simply show no requests */ }));
  }));
}

// ---------- writing ----------
// A family hands in the week form (one document per changed day, in one batch). days: { Do: { rides, heen, terug } } for every day of the form.
// - New times wait for the day coordinator ('pending'); "rijdt niet mee" is applied at once on the current week ('direct').
// - A day put back to the fixed rooster withdraws the request that was open for it (and puts a "rijdt niet mee" back).
// Returns { ok, written, skipped } (ok false = nothing was saved).
export async function submitWeekRequests(which, days) {
  const none = { ok: false, written: [], skipped: [] };
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
    return true;
  } catch (e) { showToast(t('data.opslaan_mislukt') + (e && e.message || e)); return false; }
  finally { S.wrBusy = false; }
}
