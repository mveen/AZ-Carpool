// push-scenarios.js — the made-up situations of "Meldingen testen" in Beheer. PURE: everything comes in through `ctx`.
// A scenario builds the notifications that a real situation would create, with the SAME functions the app uses for real ones
// (notificationDoc, backupRecipients, ridersToWarn from ritbeurs.js), but it only returns documents; push-data.js stores them in
// testNotifications/, never in offers, backupMoments, deviations or a family's own notifications.
//
// ctx: {
//   personaId,                   the family whose notifications the coordinator wants to experience ("Ouder van Saar")
//   families,                    { id: family }
//   nowMs, simMs,                the real moment, and the moment the scenario pretends it is (for quiet hours)
//   quietOf(familyId),           the quiet hours of a family
//   ridesOf(familyId),           [{ day, direction, date, time }] the rides a family drives this week
//   moments,                     { id: backupMoment } as they are now
//   busy(familyId, date, time),  does the family already drive around that time?
//   dayCoordinatorOf(day),       family id of the day coordinator or ''
//   weekKey, fallbackRide        a ride { day, direction, date, time } to use when nobody drives anything this week
// }
import { backupRecipients, deliverAtMs, momentCovers, notificationDoc, notificationId, ridersToWarn, toMin } from './ritbeurs.js';
import { TEST_NOTIFICATION_MS } from './push.js';

export const SCENARIOS = [
  { id: 'rijVrij', kind: 'offerBackup' },
  { id: 'overgenomen', kind: 'taken' },
  { id: 'backup', kind: 'backupForRide' },
  { id: 'nietGedekt', kind: 'uncovered' },
  { id: 'dagcoordinator', kind: 'takenDayCoordinator' },
];
export const TIME_CHOICES = ['nu', 'nacht'];

// The moment the scenario pretends it is: now, or "in the middle of the night" (23:30, or now when it already is quiet).
export function scenarioMoment(choice, nowMs, quiet){
  if(choice !== 'nacht') return nowMs;
  const d = new Date(nowMs);
  if(deliverAtMs(nowMs, quiet) > nowMs) return nowMs;
  d.setHours(23, 30, 0, 0);
  return d.getTime() > nowMs ? d.getTime() : nowMs + 24 * 3600 * 1000;
}

const firstOther = (families, personaId) => Object.keys(families || {}).sort().find(id => id !== personaId) || '';
const nextRide = (rides, nowMs, startMs) => (rides || []).filter(r => startMs(r) > nowMs).sort((a, b) => startMs(a) - startMs(b))[0] || null;

// Why a back-up family does or does not get "Rit vrij" for an offered ride. Same conditions as backupRecipients (a test keeps them equal).
//   [{ familyId, receives, reason }]  reason: 'ok' | 'niet-gedekt' | 'eigen-rit' | 'bezig' | 'dubbel'
export function explainBackups({ offer, moments, busy }){
  const out = [], seen = new Set();
  Object.values(moments || {}).forEach(m => {
    if(!m || !m.familyId) return;
    let reason = 'ok';
    if(!momentCovers(m, offer.date, offer.time)) reason = 'niet-gedekt';
    else if(m.familyId === offer.offeredBy) reason = 'eigen-rit';
    else if(seen.has(m.familyId)) reason = 'dubbel';
    else if(m.onlyIfFree !== false && typeof busy === 'function' && busy(m.familyId)) reason = 'bezig';
    if(reason === 'ok') seen.add(m.familyId);
    out.push({ familyId: m.familyId, receives: reason === 'ok', reason });
  });
  return out;
}

// Builds one scenario. Returns { id, kind, ride, rows, explain } with rows = [{ id, toFamilyId, doc, persona, why }],
// or { error: 'geenGezin' | 'geenAnder' } when it cannot be made (no persona, or no second family to play the other side).
export function buildScenario(id, ctx){
  const def = SCENARIOS.find(s => s.id === id);
  const { personaId, families, nowMs } = ctx;
  if(!def || !personaId || !families || !families[personaId]) return { error: 'geenGezin' };
  const other = firstOther(families, personaId);
  if(!other) return { error: 'geenAnder' };
  const startMs = r => new Date(`${r.date}T${r.time || '23:59'}:00`).getTime();
  const rideOf = fid => nextRide((ctx.ridesOf(fid) || []).map(r => ({ ...r })), nowMs, startMs) || ctx.fallbackRide;
  const stamp = String(nowMs);
  const rows = [];
  const add = (to, extra, persona, why) => {
    if(!to || !families[to] || rows.some(r => r.toFamilyId === to)) return;
    const sourceId = `test-${id}-${stamp}`;
    const doc = notificationDoc({ kind: def.kind, to, sourceId, nowMs: ctx.simMs, quiet: ctx.quietOf(to), ...extra });
    doc.createdAt = nowMs; doc.expiresAt = nowMs + TEST_NOTIFICATION_MS;
    rows.push({ id: notificationId(def.kind, sourceId, to), toFamilyId: to, doc, persona, why });
  };
  const offerOf = (ride, by) => ({ weekKey: ctx.weekKey, day: ride.day, direction: ride.direction, date: ride.date, time: ride.time, offeredBy: by });
  let ride = null, explain = [];

  if(id === 'rijVrij'){
    // The other family offers one of its rides; the persona is a back-up. Real back-ups are listed too.
    ride = (nextRide((ctx.ridesOf(other) || []), nowMs, startMs)) || ctx.fallbackRide;
    const offer = offerOf(ride, other);
    const busy = fid => ctx.busy(fid, offer.date, offer.time);
    const natural = backupRecipients({ offer, moments: ctx.moments, busy });
    explain = explainBackups({ offer, moments: ctx.moments, busy });
    add(personaId, { offer, fromFamilyId: other }, true, natural.includes(personaId) ? 'echt' : 'gekozen');
    natural.forEach(to => add(to, { offer, fromFamilyId: other }, false, 'echt'));
  } else if(id === 'overgenomen'){
    ride = rideOf(personaId);
    add(personaId, { offer: offerOf(ride, personaId), fromFamilyId: other }, true, 'gekozen');
  } else if(id === 'backup'){
    // The other family reports a back-up moment around the persona's ride; every driver inside it is warned.
    ride = rideOf(personaId);
    const before = (toMin(ride.time) == null ? 15 * 60 : toMin(ride.time)) - 60, after = before + 120;
    const hhmm = m => `${String(Math.max(0, Math.floor(m / 60))).padStart(2, '0')}:${String(Math.max(0, m) % 60).padStart(2, '0')}`;
    const moment = { familyId: other, date: ride.date, from: hhmm(before), to: hhmm(Math.min(after, 23 * 60 + 59)), onlyIfFree: true };
    const riders = ridersToWarn({ moment, rides: Object.keys(families).flatMap(fid => (ctx.ridesOf(fid) || []).map(r => ({ ...r, familyId: fid }))) });
    add(personaId, { moment, fromFamilyId: other, offer: offerOf(ride, personaId) }, true, riders.includes(personaId) ? 'echt' : 'gekozen');
    riders.forEach(to => add(to, { moment, fromFamilyId: other, offer: offerOf(ride, to) }, false, 'echt'));
  } else if(id === 'nietGedekt'){
    // 18:00 the day before and nobody took the persona's offer: the offerer and the day coordinator hear it.
    ride = rideOf(personaId);
    const offer = offerOf(ride, personaId);
    add(personaId, { offer, fromFamilyId: '' }, true, 'gekozen');
    add(ctx.dayCoordinatorOf(ride.day), { offer, fromFamilyId: '' }, false, 'echt');
  } else if(id === 'dagcoordinator'){
    // Someone took over a ride; the persona plays the day coordinator.
    const taker = Object.keys(families).sort().find(f => f !== personaId && f !== other) || other;
    ride = rideOf(other);
    add(personaId, { offer: offerOf(ride, other), fromFamilyId: taker }, true, 'gekozen');
  }
  return { id, kind: def.kind, ride, rows, explain };
}
