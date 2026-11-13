// match-cars.js — the cars of a match carpool (matchCarpools/<slug>.cars): storing them safely, and the change log on the same document.
//
// Why: the screen used to write the WHOLE list of cars from what that browser saw a moment ago. Two parents saving at about the same time
// (or one on a stale screen) could silently undo each other's car. Now every change is a Firestore transaction: it reads the document again,
// applies ONE change (add / edit / remove a car) to the fresh list, and writes it. If somebody else wrote in between, Firestore runs it again
// on the new state. A car is recognised by what it contains (driver, time, riders), so a change that no longer fits (the car was already
// changed or removed by someone else) is refused with a message instead of hitting the wrong car.
//
// The log: every change adds one entry to `log` on the same document (newest last, at most LOG_MAX). The coordinator sees it in the
// Wedstrijden tab. Additive: `log` is a new optional field; documents without it work as before. A document is no longer deleted when its
// last car is removed (cars becomes []), otherwise the log of that very change would be lost; the app still removes the document a day after the match.
import { db } from './data.js';
import { APP_VERSION } from './constants.js';

export const LOG_MAX = 20;

const girlKey = ids => [...(ids || [])].sort().join(',');

// PURE. Same car? Driver, departure time, riders and family members must all match (the pick-up place is not part of the identity).
export function sameCar(a, b) {
  return !!a && !!b
    && (a.driverFamilyId || '') === (b.driverFamilyId || '')
    && (a.departureTime || '') === (b.departureTime || '')
    && girlKey(a.girlIds) === girlKey(b.girlIds)
    && (a.familyCount || 0) === (b.familyCount || 0);
}

// PURE. What the log keeps of a car: who drives, when, and who rides. No undefined values (Firestore refuses them).
export function carBrief(c) {
  return { driverFamilyId: (c && c.driverFamilyId) || '', departureTime: (c && c.departureTime) || '', girlIds: [...((c && c.girlIds) || [])] };
}

// PURE. Applies one change to a list of cars.
//   change = { act:'add', car, undo? } | { act:'edit', before, car } | { act:'del', before }
// Returns { ok:true, cars, entry } (entry = the log line), { ok:true, cars, noop:true } when there is nothing to do (the car is already in /
// already gone / nothing changed), or { ok:false, reason:'gone' } when the car to change is no longer there as it was shown.
export function applyCarChange(cars, change, { by = '', now = Date.now() } = {}) {
  const list = cars || [];
  const entry = (act, car, to) => ({ at: now, by, act, car: carBrief(car), ...(to ? { to: carBrief(to) } : {}), v: String(APP_VERSION).slice(0, 20) });
  if (change.act === 'add') {
    if (list.some(c => sameCar(c, change.car))) return { ok: true, noop: true, cars: list };
    return { ok: true, cars: [...list, change.car], entry: entry(change.undo ? 'undo' : 'add', change.car) };
  }
  const idx = list.findIndex(c => sameCar(c, change.before));
  if (change.act === 'edit') {
    if (idx < 0) return { ok: false, reason: 'gone' };
    const merged = { ...list[idx], ...change.car };
    if (JSON.stringify(merged) === JSON.stringify(list[idx])) return { ok: true, noop: true, cars: list };
    return { ok: true, cars: list.map((c, i) => (i === idx ? merged : c)), entry: entry('edit', list[idx], merged) };
  }
  if (change.act === 'del') {
    if (idx < 0) return { ok: true, noop: true, cars: list };
    return { ok: true, cars: list.filter((_, i) => i !== idx), entry: entry('del', list[idx]) };
  }
  return { ok: false, reason: 'unknown' };
}

// PURE. The log after one more entry: newest last, only the last LOG_MAX kept.
export function appendLog(log, entry) {
  return [...(Array.isArray(log) ? log : []), entry].slice(-LOG_MAX);
}

// PURE. The log newest first, only well-formed entries (a hand-edited document can never break the screen).
export function logEntries(doc, max = 5) {
  const log = doc && Array.isArray(doc.log) ? doc.log : [];
  return log.filter(e => e && typeof e.at === 'number' && e.car).slice().reverse().slice(0, max);
}

// Stores ONE change in a transaction (see the top of this file).
//   info    the match fields of the document (matchSlug, calendarId, eventId, teamLabel, summary, location, startMs); optional when the document exists
//   slug    where the document must end up; fromId = where it is stored now (an old name-keyed document is moved over to `slug`)
//   by      the family id of the person who does it ('' when not linked)
// Returns what applyCarChange returns ({ok:false, reason:'gone'} = refused, nothing was written).
export async function changeMatchCar({ info, slug, fromId, change, by = '', now = Date.now() }) {
  const path = id => 'matchCarpools/' + id;
  const ids = [...new Set([fromId || slug, slug])];
  return db.transact(async tx => {
    const snaps = {};
    for (const id of ids) snaps[id] = await tx.get(path(id));   // all reads first, then the writes
    const first = snaps[ids[0]], last = snaps[ids[ids.length - 1]];
    const base = (first.exists ? first.data() : null) || (last.exists ? last.data() : null);
    const r = applyCarChange(base && base.cars, change, { by, now });
    if (!r.ok || r.noop) return r;
    const log = r.entry ? appendLog(base && base.log, r.entry) : (base && base.log) || [];
    tx.set(path(slug), { ...(base || {}), ...(info || {}), cars: r.cars, ...(log.length ? { log } : {}) });
    if (ids.length > 1 && ids[0] !== slug) tx.delete(path(ids[0]));
    return r;
  });
}
