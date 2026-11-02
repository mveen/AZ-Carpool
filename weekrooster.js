// weekrooster.js — Afwijkend weekrooster (aanvragen, advies, akkoord): the rules, as pure functions. No DOM, no database.
//
// The feature is always on: there is no switch and no "old" situation any more.
//
// A request is ONE document per family per day: weekRequests/<weekKey>_<day>_<familyId>. It holds only times and "rijdt mee ja/nee".
// There is deliberately NO field for a reason or any free text (privacy). The fixed rooster counts until a request is accepted.
//   { weekKey, day, familyId, rides, heen, terug, status, createdAt, updatedAt, [decidedAt, decidedBy], [test] }
//   status: 'pending'   waits for the day coordinator (a request)
//           'direct'    applied at once (only "rijdt niet mee"; a day coordinator's own new times are a request like any other)
//           'accepted'  the day coordinator agreed (decidedBy = the family id of whoever decided)
//           'withdrawn' the family took it back
//   A pending request whose day has passed counts as 'expired' (derived, never written).
import { isTime } from './ritbeurs.js';

export const REQUEST_DAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr'];
export const REQUEST_STATUSES = ['pending', 'direct', 'accepted', 'withdrawn'];
// The only fields a request may have. A test (here and in the rules) refuses anything else, so no reason or text can sneak in.
// 'test' is a leftover: requests made while the feature was still in test mode carry test: true. It is never written any more, but such a
// document stays valid.
export const REQUEST_FIELDS = ['weekKey', 'day', 'familyId', 'rides', 'heen', 'terug', 'status', 'createdAt', 'updatedAt', 'decidedAt', 'decidedBy', 'test'];

// ---------- the request ----------
export function requestId(weekKey, day, familyId) { return weekKey + '_' + day + '_' + familyId; }
const isWeekKey = v => typeof v === 'string' && /^\d{4}-W\d{2}$/.test(v);

// Is this a request the database may hold? (Mirrors firebase/firestore.rules.)
export function isValidRequest(d) {
  if (!d || typeof d !== 'object') return false;
  if (Object.keys(d).some(k => !REQUEST_FIELDS.includes(k))) return false;
  if (!isWeekKey(d.weekKey) || !REQUEST_DAYS.includes(d.day) || typeof d.familyId !== 'string' || !d.familyId) return false;
  if (typeof d.rides !== 'boolean' || !REQUEST_STATUSES.includes(d.status)) return false;
  if (typeof d.heen !== 'string' || typeof d.terug !== 'string') return false;
  if (d.rides) {   // each direction is a time or empty (no ride that way), but not both empty
    if ((d.heen !== '' && !isTime(d.heen)) || (d.terug !== '' && !isTime(d.terug)) || (d.heen === '' && d.terug === '')) return false;
  } else if (d.heen !== '' || d.terug !== '') return false;           // "rijdt niet mee": no times are kept
  if (typeof d.createdAt !== 'number' || typeof d.updatedAt !== 'number') return false;
  if ('decidedAt' in d && typeof d.decidedAt !== 'number') return false;
  if ('decidedBy' in d && typeof d.decidedBy !== 'string') return false;
  if ('test' in d && d.test !== true) return false;
  return true;
}

// Direct or a request? Rules (section 2 of the brief):
//  - only the own daughter can be changed (otherwise null: this is not allowed at all);
//  - "rijdt niet mee" is always direct (also for a day coordinator);
//  - everything else waits for the day coordinator, who plans the day on ALL changes at once. That includes the day coordinator's own
//    daughter: her new times are a request in the same advice, so she can be moved up (voorgetrokken) when that fits the day best.
export function decideMode({ ownDaughter, rides }) {
  if (!ownDaughter) return null;
  return rides === false ? 'direct' : 'pending';
}

// Which shifts of a form day say "rijdt niet mee": the unticked day, or an emptied time. Only a shift she has in the fixed rooster can be off
// (an empty time on a shift she does not have is just that). all = every shift she has is off, so the whole day is "rijdt niet mee".
//   f: { rides, heen, terug } as filled in   std: { heen, terug } the fixed times
export function offOf(f, std) {
  const sH = (std && std.heen) || '', sT = (std && std.terug) || '';
  const rides = f.rides !== false;
  const heen = sH !== '' && (!rides || String(f.heen || '').trim() === '');
  const terug = sT !== '' && (!rides || String(f.terug || '').trim() === '');
  return { heen, terug, all: (heen || terug) && (sH === '' || heen) && (sT === '' || terug) };
}

// The marks (per shift) a filled-in form asks for, for the days that are still open: { Wo: { heen: true, terug: false } }.
export function desiredMarks({ days, standard, isPast }) {
  const out = {};
  for (const day of REQUEST_DAYS) {
    const f = days && days[day];
    if (!f || (isPast && isPast(day))) continue;
    const { heen, terug } = offOf(f, (standard && standard[day]) || { heen: '', terug: '' });
    out[day] = { heen, terug };
  }
  return out;
}

// Turns the filled-in week form into the documents to write.
//   weekKey, familyId: who and which week
//   days: { Do: { rides: true, heen: '16:30', terug: '17:45' }, ... }  (only the days the form shows as changed)
//   standard: { Do: { heen: '16:00', terug: '17:00' }, ... }  the fixed rooster of the daughter
//   isPast(day): true for a day that is over (not changeable)
//   existing: { <requestId>: doc }  what is stored already, to keep createdAt when a request is replaced
// Returns { writes: [{ id, doc }], skipped: [{ day, why }] }. A day that equals the fixed rooster is skipped ('same'), a past day too ('past'),
// and a day that equals what is already handed in or applied ('unchanged').
// New times are always a request; "Rijdt niet mee" is always direct.
export function buildRequests({ weekKey, familyId, days, standard, isPast, existing, nowMs, shiftOff = false }) {
  const writes = [], skipped = [];
  for (const day of REQUEST_DAYS) {
    const f = days && days[day];
    if (!f) continue;
    if (isPast && isPast(day)) { skipped.push({ day, why: 'past' }); continue; }
    const std = (standard && standard[day]) || { heen: '', terug: '' };
    let rides = f.rides !== false;
    let heen = rides ? String(f.heen || '').trim() : '';
    let terug = rides ? String(f.terug || '').trim() : '';
    if (shiftOff) {
      // This week: an emptied time (or an unticked day) is "rijdt niet mee" on that shift and is applied at once as a mark (see offOf), not as a
      // request. A request is only made for the whole day off, or for a time that really differs on a shift she still rides.
      const off = offOf(f, std);
      if (off.all) { rides = false; heen = ''; terug = ''; }
      else {
        if (off.heen) heen = '';
        if (off.terug) terug = '';
        if ((off.heen || heen === std.heen) && (off.terug || terug === std.terug)) { skipped.push({ day, why: 'same' }); continue; }
      }
    }
    if (rides && heen === std.heen && terug === std.terug) { skipped.push({ day, why: 'same' }); continue; }
    if (rides && ((heen !== '' && !isTime(heen)) || (terug !== '' && !isTime(terug)) || (heen === '' && terug === ''))) { skipped.push({ day, why: 'time' }); continue; }
    const id = requestId(weekKey, day, familyId);
    const old = existing && existing[id];
    // What is already handed in (or applied) for this day is not written again: it would turn an accepted request back into a pending one.
    if (old && ['pending', 'direct', 'accepted'].includes(old.status) && old.rides === rides && old.heen === heen && old.terug === terug) { skipped.push({ day, why: 'unchanged' }); continue; }
    const mode = decideMode({ ownDaughter: true, rides });
    const doc = { weekKey, day, familyId, rides, heen, terug, status: mode, createdAt: old && typeof old.createdAt === 'number' ? old.createdAt : nowMs, updatedAt: nowMs };
    writes.push({ id, doc });
  }
  return { writes, skipped };
}

// The ISO week after this one ('2026-W53' -> '2027-W01'), or null for something that is not a week key.
export function nextWeekKey(weekKey) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(weekKey || ''));
  if (!m) return null;
  const DAY = 86400000;
  const mondayOf = (y, w) => { const j4 = Date.UTC(y, 0, 4); return j4 - ((new Date(j4).getUTCDay() + 6) % 7) * DAY + (w - 1) * 7 * DAY; };
  const nextMonday = mondayOf(+m[1], +m[2]) + 7 * DAY;
  const year = new Date(nextMonday + 3 * DAY).getUTCFullYear();   // the Thursday decides which year the week belongs to
  const week = Math.round((nextMonday - mondayOf(year, 1)) / (7 * DAY)) + 1;
  return year + '-W' + String(week).padStart(2, '0');
}

// The form as it opens: per day what is handed in (a pending, direct or accepted request of this family) or else the fixed rooster.
//   standard: { Ma: { heen, terug }, ... }   requests: { <id>: doc }   Returns { Ma: { rides, heen, terug, requested } }
// marks (this week only): { Wo: { heen: true, terug: false } } = the shifts marked "rijdt niet mee" now. They are the truth for riding or not:
// a marked shift shows an empty time, a day with every shift marked shows "Rijdt mee" unticked. A "rijdt niet mee" request without marks is ignored.
export function weekFormFrom({ weekKey, familyId, standard, requests, marks }) {
  const out = {};
  for (const day of REQUEST_DAYS) {
    const std = (standard && standard[day]) || { heen: '', terug: '' };
    const r = requests && requests[requestId(weekKey, day, familyId)];
    const live = r && (r.status === 'pending' || r.status === 'direct' || r.status === 'accepted') && !(marks && r.rides === false);
    if (marks) {
      const m = marks[day] || {};
      const markH = !!m.heen && !!std.heen, markT = !!m.terug && !!std.terug;
      if (markH || markT) {
        if ((std.heen === '' || markH) && (std.terug === '' || markT)) { out[day] = { rides: false, heen: std.heen, terug: std.terug, requested: r && live ? r.status : '' }; continue; }
        out[day] = { rides: true, heen: markH ? '' : (live ? r.heen : std.heen), terug: markT ? '' : (live ? r.terug : std.terug), requested: live ? r.status : '' };
        continue;
      }
    }
    out[day] = live
      ? { rides: r.rides !== false, heen: r.rides === false ? std.heen : r.heen, terug: r.rides === false ? std.terug : r.terug, requested: r.status }
      : { rides: true, heen: std.heen, terug: std.terug, requested: '' };
  }
  return out;
}

// The requests of one family for one week that are still open for it (pending) or were applied at once (direct), in week order.
export function openRequestsOf(requests, weekKey, familyId, nowMs, dayEndOf) {
  return REQUEST_DAYS
    .map(day => ({ day, doc: requests && requests[requestId(weekKey, day, familyId)] }))
    .filter(x => x.doc && (x.doc.status === 'direct' || requestState(x.doc, nowMs, dayEndOf ? dayEndOf(x.day) : undefined) === 'pending'))
    .map(x => ({ day: x.day, ...x.doc }));
}

// The state of one request, for the screens. A pending request of a day that is over has expired: the fixed rooster stayed.
// dayEndMs: the moment that day is over (end of the day).
export function requestState(doc, nowMs, dayEndMs) {
  if (!doc) return 'none';
  if (doc.status === 'pending' && typeof dayEndMs === 'number' && nowMs >= dayEndMs) return 'expired';
  return REQUEST_STATUSES.includes(doc.status) ? doc.status : 'none';
}
// "Tijden aanpassen" and withdrawing are possible as long as nobody has accepted it and the day is not over.
export function canChangeRequest(doc, nowMs, dayEndMs) { return requestState(doc, nowMs, dayEndMs) === 'pending'; }
export function withdrawRequest(doc, nowMs) { return { ...doc, status: 'withdrawn', updatedAt: nowMs }; }
// The day coordinator agrees. Only a pending request can be accepted.
export function acceptRequest(doc, deciderFamilyId, nowMs) {
  if (!doc || doc.status !== 'pending') return null;
  return { ...doc, status: 'accepted', decidedAt: nowMs, decidedBy: deciderFamilyId, updatedAt: nowMs };
}
// Which requests of a day still need the day coordinator, oldest first (one advice for the day, all in one agreement).
export function pendingForDay(requests, weekKey, day, nowMs, dayEndMs) {
  return Object.entries(requests || {})
    .filter(([, r]) => r && r.weekKey === weekKey && r.day === day && requestState(r, nowMs, dayEndMs) === 'pending')
    .sort((a, b) => a[1].createdAt - b[1].createdAt || (a[0] < b[0] ? -1 : 1))
    .map(([id, r]) => ({ id, ...r }));
}

// What a stale cleanup may remove: requests of another week than the current planning week (never newer weeks) and all withdrawn ones.
export function staleRequestIds(requests, currentWeekKey) {
  return Object.entries(requests || {}).filter(([, r]) => r && ((isWeekKey(r.weekKey) && r.weekKey < currentWeekKey) || r.status === 'withdrawn')).map(([id]) => id);
}

// ---------- the day coordinator's view (phase 3) ----------
// The weekdays this family decides (deciderOf(day) = family id of the day coordinator, or of the real coordinator when none is set).
export function decidedDays(deciderOf, familyId) {
  return familyId ? REQUEST_DAYS.filter(day => deciderOf(day) === familyId) : [];
}
// How many requests of a week still wait for a decision, per day ({ Do: 2 }; only days with a number above zero).
export function actionCounts(requests, weekKey, days, nowMs, dayEndOf) {
  const out = {};
  for (const day of days || []) {
    const n = pendingForDay(requests, weekKey, day, nowMs, dayEndOf ? dayEndOf(day) : undefined).length;
    if (n > 0) out[day] = n;
  }
  return out;
}
// The log of one day ("Recente wijzigingen"): requests and direct changes that are still in force (not withdrawn, not expired), newest first.
export function recentChanges(requests, weekKey, day, nowMs, dayEnd) {
  return Object.entries(requests || {})
    .filter(([, r]) => r && r.weekKey === weekKey && r.day === day && ['pending', 'direct', 'accepted'].includes(requestState(r, nowMs, dayEnd)))
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt || (a[0] < b[0] ? -1 : 1))
    .map(([id, r]) => ({ id, ...r, state: requestState(r, nowMs, dayEnd) }));
}

// "Zelf gewijzigd": a deviation of this week and day that someone who does not decide that day changed by hand (selfBy, selfAt on the deviation).
// For the log of the day coordinator; one entry per direction, newest first by the caller.
export function selfChanges(deviations, weekKey, day, deciderFamilyId) {
  return ['heen', 'terug'].map(direction => ({ direction, d: (deviations || {})[day + '_' + direction] }))
    .filter(({ d }) => d && d.weekKey === weekKey && d.selfBy && d.selfBy !== deciderFamilyId && typeof d.selfAt === 'number')
    .map(({ direction, d }) => ({ id: 'dev_' + day + '_' + direction, familyId: d.selfBy, direction, updatedAt: d.selfAt, state: 'self' }));
}
