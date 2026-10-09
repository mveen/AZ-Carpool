// ritbeurs-data.js — Ritbeurs: everything that reads or writes the database (offers, taking a ride over, back-up moments,
// notifications, the feature switch). The rules of the game are in ritbeurs.js; the screens are in ui-ritbeurs.js.
//
// The feature switch (settings/ritbeurs): when it is off nothing is shown, nothing can be written to offers, backupMoments or
// notifications (Firestore rules check the same switch), and no notification is made. That is what makes "off" stop everything at once.
import { t } from './i18n.js';
import { S } from './state.js';
import { DAYS } from './constants.js';
import { deviationExpiryMs, deviationKey, refreshWeekKey, weekKeyDayIso } from './dates.js';
import { dayCoordinatorFor, isRealCoordinator, myLinkedFamilyId } from './coordinator.js';
import { effectiveCars, fam, seats } from './rides.js';
import { keepOv } from './ov.js';
import { showToast } from './ui-common.js';
import { cleanCars, currentDeviationDoc, db, recordLastUpdate } from './data.js';
import {
  CONFLICT_MINUTES, applyTakeOver, backupRecipients, buildMoment, buildOffer, hasOpenOffer, momentId, normalizeQuiet, normalizeRitbeurs,
  notificationDoc, notificationId, offerId, ridersToWarn, ritbeursDoc, rideStartMs, stalePaths, takeWarnings, toMin, urgency, deadlineMs,
} from './ritbeurs.js';

const DIRECTIONS = ['heen', 'terug'];

export function ritbeursOn(){ return normalizeRitbeurs(S.ritbeurs).on; }
const isPermissionError = e => /permission|insufficient|denied/i.test(String(e && (e.code || e.message) || e));

// ---------- the feature switch (coordinator) ----------
export async function setRitbeurs(on){
  if(!db){ showToast(t('data.geen_verbinding_met_opslag')); return false; }
  if(!isRealCoordinator()){ showToast(t('ritbeurs.err.coordinatorOnly')); return false; }
  try{
    await db.doc('settings/ritbeurs').set(ritbeursDoc(on, Date.now()));
    S.ritbeurs = normalizeRitbeurs({ on });
    showToast(t(on ? 'ritbeurs.saved.on' : 'ritbeurs.saved.off'));
    return true;
  }catch(e){ showToast(t('data.mislukt') + (e && e.message || e)); return false; }
}

// ---------- rides ----------
// The rides one family drives this planning week: [{ day, direction, date, time, girlIds }], in week order.
export function ridesOf(familyId){
  const out = [];
  DAYS.forEach(([day]) => DIRECTIONS.forEach(direction => {
    const date = weekKeyDayIso(S.currentWeekKey, day);
    effectiveCars(day, direction).forEach(c => {
      if(c.driverFamilyId === familyId) out.push({ day, direction, date, time: c.departureTime || '', girlIds: [...(c.girlIds || [])] });
    });
  }));
  return out;
}
// Every ride of this week, with who drives it (for telling drivers that a back-up is free).
export function allRides(){
  const out = [];
  Object.keys(S.families || {}).forEach(id => ridesOf(id).forEach(r => out.push({ ...r, familyId: id })));
  return out;
}
const busyAround = (familyId, date, time) => ridesOf(familyId).some(r => r.date === date && toMin(r.time) != null && toMin(time) != null && Math.abs(toMin(r.time) - toMin(time)) < CONFLICT_MINUTES);

// What to warn about before the family takes a ride over (see takeWarnings in ritbeurs.js).
export function warningsFor(offer, takerId){
  return takeWarnings({ offer, cars: effectiveCars(offer.day, offer.direction), takerSeats: seats(fam(takerId)), takerRides: ridesOf(takerId) });
}

export function quietOf(familyId){ return normalizeQuiet(S.families[familyId] && S.families[familyId].ritbeursQuiet); }

// Writes a notification into a batch for each recipient (nothing when the switch is off).
function addNotifications(batch, { kind, recipients, offer, moment, sourceId, fromFamilyId, nowMs }){
  if(!ritbeursOn()) return 0;
  const done = new Set();
  recipients.forEach(to => {
    if(!to || done.has(to) || !S.families[to]) return;
    done.add(to);
    batch.set(`families/${to}/notifications/${notificationId(kind, sourceId, to)}`, notificationDoc({ kind, to, offer, moment, sourceId, fromFamilyId, nowMs, quiet: quietOf(to) }));
  });
  return done.size;
}

// ---------- offering, withdrawing, taking over ----------
export async function createOffer(day, direction, message){
  if(!db){ showToast(t('data.geen_verbinding_met_opslag')); return false; }
  const me = myLinkedFamilyId();
  if(!ritbeursOn() || !me) return false;
  refreshWeekKey();
  const ride = ridesOf(me).find(r => r.day === day && r.direction === direction);
  if(!ride){ showToast(t('ritbeurs.err.geenRit')); return false; }
  if(rideStartMs(ride.date, ride.time) <= Date.now()){ showToast(t('ritbeurs.err.alGeweest')); return false; }
  if(hasOpenOffer(S.offers, S.currentWeekKey, day, direction, me)){ showToast(t('ritbeurs.err.alAangeboden')); return false; }
  const nowMs = Date.now();
  const offer = buildOffer({ weekKey: S.currentWeekKey, day, direction, date: ride.date, time: ride.time, familyId: me, message, nowMs });
  const id = offerId({ weekKey: S.currentWeekKey, day, direction, familyId: me, nowMs });
  try{
    const batch = db.batch();
    batch.set('offers/' + id, offer);
    const recipients = backupRecipients({ offer, moments: S.moments, busy: fid => busyAround(fid, offer.date, offer.time) });
    const n = addNotifications(batch, { kind: 'offerBackup', recipients, offer, sourceId: id, fromFamilyId: me, nowMs });
    await batch.commit();
    S.offers[id] = offer;
    showToast(t(n ? 'ritbeurs.toast.aangebodenBackups' : 'ritbeurs.toast.aangeboden', { n }));
    return true;
  }catch(e){ showToast(t('data.opslaan_mislukt') + (e && e.message || e)); return false; }
}

export async function withdrawOffer(id){
  if(!db){ showToast(t('data.geen_verbinding_met_opslag')); return false; }
  const o = S.offers[id], me = myLinkedFamilyId();
  if(!ritbeursOn() || !o || o.status !== 'open' || (o.offeredBy !== me && !isRealCoordinator())) return false;
  try{
    await db.doc('offers/' + id).update({ status: 'withdrawn', withdrawnAt: Date.now() });
    showToast(t('ritbeurs.toast.ingetrokken'));
    return true;
  }catch(e){ showToast(t(isPermissionError(e) ? 'ritbeurs.err.alOvergenomen' : 'data.opslaan_mislukt') + (isPermissionError(e) ? '' : (e && e.message || e))); return false; }
}

// The first yes wins: the offer, the new driver in the rooster and the notifications are written in ONE batch. The database rules only allow
// the change while the offer is still open, so when two people tap at the same moment the second batch fails as a whole and changes nothing.
export async function takeOffer(id){
  if(!db){ showToast(t('data.geen_verbinding_met_opslag')); return false; }
  const me = myLinkedFamilyId(), o = S.offers[id];
  if(!ritbeursOn() || !me || !o) return false;
  if(o.status !== 'open'){ showToast(t('ritbeurs.err.alOvergenomen')); return false; }
  if(o.offeredBy === me){ showToast(t('ritbeurs.err.eigenRit')); return false; }
  refreshWeekKey();
  const newCars = applyTakeOver(effectiveCars(o.day, o.direction), o, me);
  if(!newCars){ showToast(t('ritbeurs.err.geenRit')); return false; }
  const nowMs = Date.now();
  try{
    const batch = db.batch();
    batch.update('offers/' + id, { status: 'taken', takenBy: me, takenAt: nowMs });
    const extra = keepOv(currentDeviationDoc(o.day, o.direction), newCars);
    batch.set('deviations/' + deviationKey(o.day, o.direction), { day: o.day, direction: o.direction, weekKey: S.currentWeekKey, expiresAt: deviationExpiryMs(), cars: cleanCars(newCars), ...(extra || {}) });
    addNotifications(batch, { kind: 'taken', recipients: [o.offeredBy], offer: o, sourceId: id, fromFamilyId: me, nowMs });
    const dc = dayCoordinatorFor(S, o.day);
    if(dc && dc.familyId !== o.offeredBy && dc.familyId !== me) addNotifications(batch, { kind: 'takenDayCoordinator', recipients: [dc.familyId], offer: o, sourceId: id, fromFamilyId: me, nowMs });
    await batch.commit();
    S.rbConfirm = null;
    S.lastDeviationEditDay = o.day;
    recordLastUpdate('Deviation');
    showToast(t('ritbeurs.toast.overgenomen'));
    return true;
  }catch(e){
    S.rbConfirm = null;
    showToast(isPermissionError(e) ? t('ritbeurs.err.teLaat') : t('data.opslaan_mislukt') + (e && e.message || e));
    return false;
  }
}

// ---------- "Ik kan inspringen" ----------
export async function addMoment(raw){
  if(!db){ showToast(t('data.geen_verbinding_met_opslag')); return false; }
  const me = myLinkedFamilyId();
  if(!ritbeursOn() || !me) return false;
  const nowMs = Date.now();
  const moment = buildMoment({ ...raw, familyId: me, nowMs });
  if(!moment){ showToast(t('ritbeurs.err.momentOngeldig')); return false; }
  if(rideStartMs(moment.date, moment.to) <= nowMs){ showToast(t('ritbeurs.err.alGeweest')); return false; }
  const id = momentId({ familyId: me, date: moment.date, from: moment.from, nowMs });
  try{
    const batch = db.batch();
    batch.set('backupMoments/' + id, moment);
    const riders = ridersToWarn({ moment, rides: allRides() });
    const n = addNotifications(batch, { kind: 'backupForRide', recipients: riders, moment, sourceId: id, fromFamilyId: me, nowMs });
    await batch.commit();
    S.moments[id] = moment; S.rbMomentDraft = null;
    showToast(t(n ? 'ritbeurs.toast.momentRijders' : 'ritbeurs.toast.moment', { n }));
    return true;
  }catch(e){ showToast(t('data.opslaan_mislukt') + (e && e.message || e)); return false; }
}

export async function removeMoment(id){
  if(!db) return false;
  const m = S.moments[id];
  if(!m || (m.familyId !== myLinkedFamilyId() && !isRealCoordinator())) return false;
  try{ await db.doc('backupMoments/' + id).delete(); delete S.moments[id]; return true; }
  catch(e){ showToast(t('data.mislukt') + (e && e.message || e)); return false; }
}

// ---------- notifications ----------
export async function markNotificationsRead(){
  const me = myLinkedFamilyId();
  if(!db || !me) return false;
  const unread = Object.entries(S.notifications || {}).filter(([, n]) => n && n.read !== true);
  if(!unread.length) return true;
  try{
    const batch = db.batch();
    unread.forEach(([id]) => batch.update(`families/${me}/notifications/${id}`, { read: true }));
    await batch.commit();
    return true;
  }catch(e){ return false; }
}

// The quiet hours of the own family (instelbaar; standaard 22:00-06:00). Saves at once.
export async function saveQuiet(from, to){
  const me = myLinkedFamilyId();
  if(!db || !me) return false;
  const q = normalizeQuiet({ from, to });
  try{ await db.doc('families/' + me).set({ ritbeursQuiet: q }, { merge: true }); showToast(t('ritbeurs.toast.stilleUren')); return true; }
  catch(e){ showToast(t('data.opslaan_mislukt') + (e && e.message || e)); return false; }
}

// ---------- background checks (on every data change and every minute) ----------
// 1. An offer that is still open after its deadline (18:00 the day before) is announced once to the offerer and the day coordinator.
//    The first app that notices writes it; the rules only allow it while the offer has no `uncoveredAt` yet, so it happens once.
// 2. Housekeeping: everybody removes their own expired notifications; the coordinator also removes offers of earlier weeks and moments that ended.
// Without a server this only runs while someone has the app open.
export async function checkRitbeurs(){
  if(!db || !S.appReady || S.rbBusy || !ritbeursOn() || (!myLinkedFamilyId() && !isRealCoordinator())) return;
  S.rbBusy = true;
  try{
    const nowMs = Date.now();
    for(const [id, o] of Object.entries(S.offers || {})){
      if(!o || o.status !== 'open' || o.weekKey !== S.currentWeekKey || o.uncoveredAt) continue;
      if(urgency(o.date, nowMs) !== 'late' || rideStartMs(o.date, o.time) <= nowMs) continue;
      try{
        const batch = db.batch();
        batch.update('offers/' + id, { uncoveredAt: nowMs });
        const dc = dayCoordinatorFor(S, o.day);
        addNotifications(batch, { kind: 'uncovered', recipients: [o.offeredBy, dc && dc.familyId], offer: o, sourceId: id, fromFamilyId: '', nowMs });
        await batch.commit();
        S.offers[id] = { ...o, uncoveredAt: nowMs };
      }catch(e){ /* another app was first: fine */ }
    }
    const me = myLinkedFamilyId();
    const paths = stalePaths({
      offers: isRealCoordinator() ? S.offers : {}, moments: isRealCoordinator() ? S.moments : {},
      notificationsByFamily: me ? { [me]: S.notifications } : {}, weekKey: S.currentWeekKey, nowMs,
    });
    if(paths.length){
      const batch = db.batch();
      paths.forEach(p => batch.delete(p));
      await batch.commit();
    }
  }catch(e){ /* housekeeping is best-effort */ }
  finally{ S.rbBusy = false; }
}
