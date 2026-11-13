// match-bus.js — away matches that the team plays by bus. The bus leaves from and returns to AFC '34, so the carpool of such a match goes
// from the pick-up place (Busstation) to AFC '34 and, after the match, back from AFC '34.
//
// Where it lives (all additive, nothing existing changes, no new Firestore rule):
//   settings/matchFeeds.feeds[i].bus      true = this team's away matches go by bus (default for the team, Beheer → Wedstrijdkalenders)
//   settings/matchFeeds.feeds[i].busNot   text, comma separated: an opponent that contains one of these words is NOT by bus (e.g. "Ajax")
//   matchCarpools/<slug>.bus              true / false = this match differs from, or confirms, the default; missing = the default of the team
//   matchCarpools/<slug>.busDepart        "HH:MM" the bus leaves AFC '34 ("" = not known yet)
//   matchCarpools/<slug>.busBack          "HH:MM" the bus is back at AFC '34, about ("" = not known yet)
//   matchCarpools/<slug>.cars[i].pickupTime  "HH:MM" this car picks the players up at AFC '34 after the match (optional)
// The functions here are PURE (no screen, no database) except setMatchBus, which stores in one transaction.
import { db } from './data.js';

export const BUS_DRIVE_MIN = 40;    // drive from the pick-up place to AFC '34, rough: the car is suggested this long before it must be there
export const BUS_MARGIN_MIN = 20;   // spare time at AFC '34 before the bus leaves

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const validTime = s => HHMM.test(String(s || ''));
const toMin = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const fromMin = n => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');

// The words of the "niet met de bus tegen" field: lower case, no empty ones.
export function busNotList(text) {
  return String(text || '').split(/[,;\n]/).map(s => s.trim().toLowerCase()).filter(Boolean);
}

// Does this team's default say "by bus" for this opponent?
export function busDefaultFor(feed, opponent) {
  if (!feed || feed.bus !== true) return false;
  const opp = String(opponent || '').toLowerCase();
  return !busNotList(feed.busNot).some(word => opp.includes(word));
}

// The bus state of one match. `a` = analyzeMatch(summary) of the match, `feed` = the team's calendar entry (or undefined), `doc` = matchCarpools/<slug> (or null).
//   applies  only an away match can go by bus (a home match never shows the bus)
//   on       the bus is used for this match
//   changed  the match differs from the default of the team (shown as "Aangepast")
//   depart / back  the two bus times, '' when not filled in (or not a time)
export function busState(a, feed, doc) {
  const applies = !!a && a.isHome === false;
  const def = applies && busDefaultFor(feed, a.opponent);
  const set = applies && doc && typeof doc.bus === 'boolean';
  const on = applies && (set ? doc.bus : def);
  return {
    applies, on, changed: !!set && doc.bus !== def,
    depart: on && doc && validTime(doc.busDepart) ? doc.busDepart : '',
    back: on && doc && validTime(doc.busBack) ? doc.busBack : '',
  };
}

// The car must be at AFC '34 BUS_DRIVE_MIN minutes after it leaves; it is suggested to leave that long (plus the margin) before the bus.
export function suggestedBusCarDeparture(depart) {
  if (!validTime(depart)) return '';
  const m = toMin(depart) - BUS_DRIVE_MIN - BUS_MARGIN_MIN;
  return m < 0 ? '' : fromMin(m);
}
export function carArrival(departureTime) {
  if (!validTime(departureTime)) return '';
  const m = toMin(departureTime) + BUS_DRIVE_MIN;
  return m >= 24 * 60 ? '' : fromMin(m);
}
// True when the car would reach AFC '34 after the bus has left.
export function carMissesBus(departureTime, depart) {
  const arr = carArrival(departureTime);
  return !!arr && validTime(depart) && toMin(arr) > toMin(depart);
}
// When this car picks up after the match: its own time, else the time of the bus.
export function pickupOf(car, state) {
  return (car && validTime(car.pickupTime) ? car.pickupTime : '') || (state && state.back) || '';
}

// What is stored for the bus times (no undefined: Firestore refuses it). Returns {ok:false} when a time is filled in wrongly.
export function busPatch({ on, depart, back }) {
  const d = String(depart || '').trim(), b = String(back || '').trim();
  if ((d && !validTime(d)) || (b && !validTime(b))) return { ok: false };
  return { ok: true, patch: { bus: !!on, busDepart: d, busBack: b } };
}

// Stores bus fields on the carpool document of a match, in one transaction on the fresh document (a car that somebody added a moment ago stays).
// `info` = the match fields of the document (see carpoolInfo in ui-matches.js); `fromId` = where it is stored now (an old name-keyed document moves over to `slug`).
export async function setMatchBus({ info, slug, fromId, patch }) {
  const path = id => 'matchCarpools/' + id;
  const ids = [...new Set([fromId || slug, slug])];
  return db.transact(async tx => {
    const snaps = {};
    for (const id of ids) snaps[id] = await tx.get(path(id));   // all reads first, then the writes
    const first = snaps[ids[0]], last = snaps[ids[ids.length - 1]];
    const base = (first.exists ? first.data() : null) || (last.exists ? last.data() : null);
    tx.set(path(slug), { ...(base || {}), ...(info || {}), cars: (base && base.cars) || [], ...patch });
    if (ids.length > 1 && ids[0] !== slug) tx.delete(path(ids[0]));
    return { ok: true };
  });
}
