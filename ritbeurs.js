// ritbeurs.js — Ritbeurs: a driver offers a ride they cannot drive, another driver takes it over (the first yes wins),
// and drivers who are free announce when they could step in ("Ik kan inspringen"). PURE logic only: no DOM, no database.
// Stored: settings/ritbeurs { on, updatedAt } (the feature switch), offers/{id}, backupMoments/{id} and, per family,
// families/{id}/notifications/{id}. See README, "Ritbeurs".

export const RITBEURS_MESSAGE_MAX = 60;
export const DEADLINE_HOUR = 18;          // a ride must be arranged before 18:00 the day before
export const SOON_HOURS = 24;             // within this many hours of the deadline a ride is "soon"
export const CONFLICT_MINUTES = 90;       // another ride of the taker this close to the offered ride is a conflict (a warning, not a block)
export const NOTIFICATION_DAYS = 14;      // how long a notification is kept
export const DEFAULT_QUIET = { from: '22:00', to: '06:00' };
export const MOMENT_PLACES = ['alkmaar', 'aalsmeer', 'onderweg'];

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- the feature switch ----------
// Only a real true switches it on; a missing or broken document means off, so a database problem never turns notifications on.
export function normalizeRitbeurs(raw){
  const r = raw && typeof raw === 'object' ? raw : {};
  return { on: r.on === true };
}
export function ritbeursDoc(on, nowMs){ return { on: on === true, updatedAt: nowMs }; }

// ---------- small helpers ----------
export function isTime(v){ return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v); }
export function isIsoDate(v){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof v === 'string' ? v : '');
  if(!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}
export function toMin(v){ return isTime(v) ? (+v.slice(0, 2)) * 60 + (+v.slice(3, 5)) : null; }

// One line of plain text, at most RITBEURS_MESSAGE_MAX characters. Never HTML: the UI escapes it again when it shows it.
export function cleanMessage(s){
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, RITBEURS_MESSAGE_MAX).trim();
}

// Start of a ride as a moment (ms); a ride without a valid time counts as the end of that day, so it stays visible all day.
export function rideStartMs(dateIso, time){
  if(!isIsoDate(dateIso)) return 0;
  const [y, m, d] = dateIso.split('-').map(Number);
  const min = toMin(time);
  return min == null ? new Date(y, m - 1, d, 23, 59).getTime() : new Date(y, m - 1, d, Math.floor(min / 60), min % 60).getTime();
}

// ---------- the deadline ----------
// 18:00 on the day before the ride (local time of the phone, like the rest of the app).
export function deadlineMs(dateIso){
  if(!isIsoDate(dateIso)) return null;
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(y, m - 1, d - 1, DEADLINE_HOUR, 0, 0, 0).getTime();
}
// 'late' = deadline passed, 'soon' = deadline within SOON_HOURS, 'ok' = plenty of time.
export function urgency(dateIso, nowMs){
  const dl = deadlineMs(dateIso);
  if(dl == null) return 'ok';
  if(nowMs >= dl) return 'late';
  return dl - nowMs <= SOON_HOURS * 3600 * 1000 ? 'soon' : 'ok';
}

// ---------- quiet hours (instelbaar, standaard 22:00-06:00) ----------
export function normalizeQuiet(raw){
  const r = raw && typeof raw === 'object' ? raw : {};
  return { from: isTime(r.from) ? r.from : DEFAULT_QUIET.from, to: isTime(r.to) ? r.to : DEFAULT_QUIET.to };
}
export function inQuiet(minutes, quiet){
  const q = normalizeQuiet(quiet), f = toMin(q.from), e = toMin(q.to);
  if(f === e) return false;                                   // same start and end: no quiet hours
  return f < e ? (minutes >= f && minutes < e) : (minutes >= f || minutes < e);
}
// When a notification for someone with these quiet hours may be delivered (by a push sender, later): now, or when the quiet hours end.
export function deliverAtMs(nowMs, quiet){
  const q = normalizeQuiet(quiet), d = new Date(nowMs);
  if(!inQuiet(d.getHours() * 60 + d.getMinutes(), q)) return nowMs;
  const end = toMin(q.to), t = new Date(nowMs);
  t.setHours(Math.floor(end / 60), end % 60, 0, 0);
  if(t.getTime() <= nowMs) t.setDate(t.getDate() + 1);
  return t.getTime();
}

// ---------- offers ----------
export function offerId({ weekKey, day, direction, familyId, nowMs }){ return `${weekKey}_${day}_${direction}_${familyId}_${nowMs}`; }

export function buildOffer({ weekKey, day, direction, date, time, familyId, message, nowMs }){
  return { weekKey, day, direction, date, time: isTime(time) ? time : '', offeredBy: familyId, message: cleanMessage(message), status: 'open', createdAt: nowMs };
}

// The open offers of this planning week whose ride has not started yet, soonest first.
export function openOffers(offers, weekKey, nowMs){
  return Object.entries(offers || {})
    .map(([id, o]) => ({ id, ...o }))
    .filter(o => o && o.status === 'open' && o.weekKey === weekKey && rideStartMs(o.date, o.time) > nowMs)
    .sort((a, b) => rideStartMs(a.date, a.time) - rideStartMs(b.date, b.time) || a.createdAt - b.createdAt);
}
// Is this ride already on offer (so it cannot be offered twice)?
export function hasOpenOffer(offers, weekKey, day, direction, familyId){
  return Object.values(offers || {}).some(o => o && o.status === 'open' && o.weekKey === weekKey && o.day === day && o.direction === direction && o.offeredBy === familyId);
}

// The car an offer is about: the car of that shift driven by the offering family (the one with the same time when there are several).
export function findCarIndex(cars, offer){
  const idx = (cars || []).map((c, i) => [c, i]).filter(([c]) => c && c.driverFamilyId === offer.offeredBy);
  if(!idx.length) return -1;
  const same = idx.find(([c]) => offer.time && c.departureTime === offer.time);
  return (same || idx[0])[1];
}

// The cars after the taker has taken the ride over: only the driver changes (time, girls and place stay).
export function applyTakeOver(cars, offer, takerId){
  const i = findCarIndex(cars, offer);
  if(i < 0 || !takerId || takerId === offer.offeredBy) return null;
  return (cars || []).map((c, k) => k === i ? { ...c, driverFamilyId: takerId } : { ...c });
}

// What to warn about before taking a ride over. A warning never blocks: the taker decides.
//   takerSeats = free seats in the taker's car; takerRides = [{ day, direction, date, time }] the taker already drives this week.
export function takeWarnings({ offer, cars, takerSeats, takerRides }){
  const i = findCarIndex(cars, offer);
  const need = i < 0 ? 0 : ((cars[i].girlIds || []).length);
  const have = Math.max(0, Number(takerSeats) || 0);
  const at = toMin(offer.time);
  const conflict = at == null ? null : (takerRides || []).find(r => {
    const m = toMin(r.time);
    return r.date === offer.date && m != null && Math.abs(m - at) < CONFLICT_MINUTES;
  }) || null;
  return { seats: { need, have, ok: have >= need }, conflict: conflict ? { day: conflict.day, direction: conflict.direction, time: conflict.time } : null };
}

// ---------- "Ik kan inspringen" ----------
// A moment on one date between two times at which a driver could take over a ride. Returns null when something is not valid.
export function buildMoment({ familyId, date, from, to, place, onlyIfFree, nowMs }){
  if(!familyId || !isIsoDate(date) || !isTime(from) || !isTime(to) || toMin(from) >= toMin(to)) return null;
  return { familyId, date, from, to, place: MOMENT_PLACES.includes(place) ? place : 'onderweg', onlyIfFree: onlyIfFree !== false, createdAt: nowMs };
}
export function momentId({ familyId, date, from, nowMs }){ return `${date}_${from.replace(':', '')}_${familyId}_${nowMs}`; }
export function momentCovers(moment, dateIso, time){
  const m = toMin(time);
  return !!moment && moment.date === dateIso && m != null && m >= toMin(moment.from) && m <= toMin(moment.to);
}
// Moments that have not ended yet, soonest first.
export function activeMoments(moments, nowMs){
  return Object.entries(moments || {}).map(([id, m]) => ({ id, ...m }))
    .filter(m => m && isIsoDate(m.date) && isTime(m.to) && rideStartMs(m.date, m.to) > nowMs)
    .sort((a, b) => rideStartMs(a.date, a.from) - rideStartMs(b.date, b.from));
}

// Who gets a notification when a ride is offered: back-ups whose moment covers the ride (not the offerer; with `onlyIfFree`
// not someone who already drives around that time: busy(familyId) tells). Each family once.
export function backupRecipients({ offer, moments, busy }){
  const out = [];
  Object.values(moments || {}).forEach(m => {
    if(!momentCovers(m, offer.date, offer.time) || m.familyId === offer.offeredBy || out.includes(m.familyId)) return;
    if(m.onlyIfFree !== false && typeof busy === 'function' && busy(m.familyId)) return;
    out.push(m.familyId);
  });
  return out;
}
// Who gets a notification when a back-up adds a moment: drivers with a ride inside it. rides = [{ familyId, date, time }].
export function ridersToWarn({ moment, rides }){
  const out = [];
  (rides || []).forEach(r => {
    if(r.familyId && r.familyId !== moment.familyId && momentCovers(moment, r.date, r.time) && !out.includes(r.familyId)) out.push(r.familyId);
  });
  return out;
}

// ---------- notifications (an in-app inbox now; a push sender can read the same documents later) ----------
export const NOTIFICATION_KINDS = ['offerBackup', 'backupForRide', 'taken', 'takenDayCoordinator', 'uncovered'];

// One id per kind, source (offer or moment) and recipient, so a notification can never be written twice.
export function notificationId(kind, sourceId, toFamilyId){ return `${kind}_${sourceId}_${toFamilyId}`; }

export function notificationDoc({ kind, to, offer, sourceId, fromFamilyId, nowMs, quiet, moment }){
  return {
    kind, toFamilyId: to, sourceId: sourceId || '', fromFamilyId: fromFamilyId || '',
    weekKey: (offer && offer.weekKey) || '', day: (offer && offer.day) || '', direction: (offer && offer.direction) || '',
    date: (offer && offer.date) || (moment && moment.date) || '', time: (offer && offer.time) || '',
    momentFrom: (moment && moment.from) || '', momentTo: (moment && moment.to) || '',
    createdAt: nowMs, deliverAt: deliverAtMs(nowMs, quiet), expiresAt: nowMs + NOTIFICATION_DAYS * DAY_MS, read: false,
  };
}
export function unreadCount(notifications){
  return Object.values(notifications || {}).filter(n => n && n.read !== true).length;
}
export function sortedNotifications(notifications){
  return Object.entries(notifications || {}).map(([id, n]) => ({ id, ...n })).sort((a, b) => b.createdAt - a.createdAt);
}

// ---------- housekeeping ----------
// What the coordinator's app removes: offers of another planning week, moments that ended, notifications that expired.
export function stalePaths({ offers, moments, notificationsByFamily, weekKey, nowMs }){
  const out = [];
  Object.entries(offers || {}).forEach(([id, o]) => { if(o && o.weekKey !== weekKey) out.push('offers/' + id); });
  Object.entries(moments || {}).forEach(([id, m]) => { if(!m || rideStartMs(m.date, m.to) + DAY_MS < nowMs) out.push('backupMoments/' + id); });
  Object.entries(notificationsByFamily || {}).forEach(([fid, list]) => Object.entries(list || {}).forEach(([id, n]) => {
    if(n && n.expiresAt < nowMs) out.push(`families/${fid}/notifications/${id}`);
  }));
  return out;
}
