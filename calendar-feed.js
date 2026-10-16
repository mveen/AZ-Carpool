// calendar-feed.js — the calendar subscription ("agenda") of one family: the next 3 weeks of rides of their daughter as an .ics file.
// PURE (no screen, no database): the server job cron/agenda.mjs, the Profiel card and the tests use it. It asks the SAME rooster code as
// Mijn week (rides.js: effectiveCars, rideTime), so the calendar cannot disagree with the app.
//   rides in      -> feedEvents(familyId, state, nowMs)        -> the rides the daughter sits in
//                 -> driverFeedEvents(familyId, state, nowMs)  -> the rides the family drives itself (the parents' calendar)
//                    both give [{ uid, startMs, endMs, summary, description, location }]
//   .ics text out -> buildIcs({ name, events, nowMs })
import { t } from './i18n.js';
import { DAYS, WEEK_END_HOUR } from './constants.js';
import { effectiveCars, fam, isFlex, ovGirlsFor, plainDriverName, plainGirlName, rideTime } from './rides.js';
import { freeText, matchFromName, normalizeLocations, placeFor, placeName, routeLabel } from './locations.js';
import { getISOWeekKey, weekKeyDayIso } from './dates.js';

export const FEED_WEEKS = 3;                  // the planning week plus the two after it
export const FEED_TIME_ZONE = 'Europe/Amsterdam';
export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;   // the secret part of the link; also checked by firestore.rules and by the job
const RETURN_MINUTES = 45;                    // a "terug" ride has no end time of its own: its event lasts this long

// A new secret for a link: 24 random bytes = 32 URL-safe characters (192 bits: cannot be guessed).
export function newCalendarToken(cryptoObj = globalThis.crypto) {
  const bytes = cryptoObj.getRandomValues(new Uint8Array(24));
  let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_');   // 24 bytes give exactly 32 characters, no padding
}

// ---------- Amsterdam time, whatever time zone the computer is in ----------
const parts = (ms, opts) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: FEED_TIME_ZONE, hourCycle: 'h23', ...opts }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
// 'YYYY-MM-DD' of a moment, as the calendar in Amsterdam shows it.
export function amsterdamDate(ms) { const p = parts(ms, { year: 'numeric', month: '2-digit', day: '2-digit' }); return `${p.year}-${p.month}-${p.day}`; }
// 'HH:MM' of a moment in Amsterdam.
export function amsterdamClock(ms) { const p = parts(ms, { hour: '2-digit', minute: '2-digit' }); return `${p.hour}:${p.minute}`; }
// The moment (ms) at which it is `hhmm` ("07:05") on `iso` ("2026-10-12") in Amsterdam. Two passes cover the summer-time switch.
export function amsterdamToMs(iso, hhmm) {
  const [y, mo, d] = iso.split('-').map(Number), [h, mi] = String(hhmm).split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = ms => { const p = parts(ms, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000; };
  let ms = wall - offsetAt(wall);
  ms = wall - offsetAt(ms);
  return ms;
}
const validTime = s => /^\d{1,2}:\d{2}$/.test(String(s || ''));
const clock = s => { const [h, m] = String(s).split(':'); return h.padStart(2, '0') + ':' + m; };

// The ISO week keys the calendar covers: the planning week (from Friday 19:00 Amsterdam time on: the coming week) and the two after it.
export function feedWeekKeys(nowMs) {
  const [y, m, d] = amsterdamDate(nowMs).split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)), dow = day.getUTCDay();   // 0 = Sunday
  const weekOver = dow === 5 && Number(amsterdamClock(nowMs).slice(0, 2)) >= WEEK_END_HOUR;
  day.setUTCDate(day.getUTCDate() + (dow === 6 ? 2 : dow === 0 ? 1 : weekOver ? 3 : 0));
  const keys = [];
  for (let i = 0; i < FEED_WEEKS; i++) {
    const x = new Date(day); x.setUTCDate(day.getUTCDate() + 7 * i);
    keys.push(getISOWeekKey(new Date(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())));   // local fields on purpose: getISOWeekKey reads those
  }
  return keys;
}

// ---------- the rides ----------
// One ride of the daughter on one shift; null when she has no ride there (no time, "Rijdt niet mee", or not in a car).
function rideEvent(familyId, st, weekKey, day, direction, cfg) {
  const iso = weekKeyDayIso(weekKey, day);
  if (!iso) return null;
  const flex = isFlex(fam(familyId, st));
  const s = flex ? '' : rideTime(familyId, day, direction, st);   // her own time: be there at (heen) / done at (terug)
  const car = effectiveCars(day, direction, st).find(c => (c.girlIds || []).includes(familyId));
  if (!car || ovGirlsFor(day, st, direction).includes(familyId)) return null;
  if (!flex && !s) return null;
  const dep = validTime(car.departureTime) ? car.departureTime : validTime(s) ? s : '';
  if (!dep) return null;

  const startMs = amsterdamToMs(iso, dep);
  const arriveMs = direction === 'heen' && validTime(s) ? amsterdamToMs(iso, s) : 0;
  const endMs = arriveMs > startMs ? arriveMs : startMs + RETURN_MINUTES * 60000;   // heen: until she has to be there

  const place = placeFor(car, direction, cfg, day);
  const driver = car.driverFamilyId === familyId ? t('agenda.zelf_rijden') : plainDriverName(car.driverFamilyId, st);
  const route = routeLabel(car, direction, cfg, day);
  return {
    uid: `${weekKey}-${day}-${direction}-${familyId}@azcarpool.nl`,
    startMs, endMs,
    summary: t('agenda.titel_rit', { dir: direction === 'heen' ? t('dir.heenShort') : t('dir.terugShort'), route }),
    description: [
      t('agenda.chauffeur', { name: driver }),
      validTime(s) ? t(direction === 'heen' ? 'agenda.aanwezig' : 'agenda.klaar', { time: clock(s) }) : '',
      t('agenda.indicatief'),
    ].filter(Boolean).join('\n'),
    location: !freeText(car) && place.address ? `${place.name}, ${place.address}` : placeName(car, direction, cfg, day),
  };
}

// ---------- the rides the family drives ----------
// One ride the family DRIVES on one shift. The girls in the car are named, the family's own daughter too; null when nobody is left in the car
// ("Rijdt niet mee" takes a girl out) or when the family does not drive on that shift.
function driveEvent(familyId, st, weekKey, day, direction, cfg) {
  const iso = weekKeyDayIso(weekKey, day);
  if (!iso) return null;
  const off = ovGirlsFor(day, st, direction);
  const car = effectiveCars(day, direction, st).find(c => c.driverFamilyId === familyId && (c.girlIds || []).some(g => !off.includes(g)));
  if (!car) return null;
  const girls = car.girlIds.filter(g => !off.includes(g));
  const times = girls.map(g => rideTime(g, day, direction, st)).filter(validTime).map(clock).sort();
  const dep = validTime(car.departureTime) ? car.departureTime : (direction === 'heen' ? times[0] : times[times.length - 1]) || '';
  if (!dep) return null;

  const startMs = amsterdamToMs(iso, dep);
  const arriveMs = direction === 'heen' && times[0] ? amsterdamToMs(iso, times[0]) : 0;
  const endMs = arriveMs > startMs ? arriveMs : startMs + RETURN_MINUTES * 60000;   // heen: until the first girl has to be there

  const place = placeFor(car, direction, cfg, day);
  const names = girls.map(g => plainGirlName(g, st)).join(', ');
  return {
    uid: `${weekKey}-${day}-${direction}-drive-${familyId}@azcarpool.nl`,
    startMs, endMs,
    summary: t('agenda.titel_rijden', { dir: (direction === 'heen' ? t('dir.heenShort') : t('dir.terugShort')).toLowerCase(), route: routeLabel(car, direction, cfg, day) }),
    description: [
      t(direction === 'heen' ? 'agenda.ophalen' : 'agenda.mee_terug', { names }),
      direction === 'heen' && times[0] ? t('agenda.aanwezig', { time: times[0] }) : '',
      t('agenda.indicatief'),
    ].filter(Boolean).join('\n'),
    location: !freeText(car) && place.address ? `${place.name}, ${place.address}` : placeName(car, direction, cfg, day),
  };
}

// A match carpool car, for the family that sits in it (role 'girl': only then, a match she is in no car for is none of the calendar's
// business) or that drives it (role 'driver').
function matchEvents(familyId, st, fromMs, toMs, cfg, role = 'girl') {
  const out = [];
  Object.entries(st.matchCarpools || {}).forEach(([slug, d]) => {
    if (!d || !d.startMs || d.startMs < fromMs || d.startMs >= toMs) return;
    (d.cars || []).forEach((c, i) => {
      const mine = role === 'driver' ? c.driverFamilyId === familyId && (c.girlIds || []).length : (c.girlIds || []).includes(familyId);
      if (!mine || !validTime(c.departureTime)) return;
      const startMs = amsterdamToMs(amsterdamDate(d.startMs), c.departureTime);
      const driver = c.driverFamilyId === familyId ? t('agenda.zelf_rijden') : plainDriverName(c.driverFamilyId, st);
      const who = role === 'driver' ? t('agenda.mee', { names: c.girlIds.map(g => plainGirlName(g, st)).join(', ') }) : t('agenda.chauffeur', { name: driver });
      out.push({
        uid: `match-${slug}-${i}-${role === 'driver' ? 'drive-' : ''}${familyId}@azcarpool.nl`,
        startMs, endMs: d.startMs > startMs ? d.startMs : startMs + 2 * 3600000,
        summary: t(role === 'driver' ? 'agenda.titel_wedstrijd_rijden' : 'agenda.titel_wedstrijd', { match: String(d.summary || '').trim() || t('agenda.wedstrijd') }),
        description: [who, t('agenda.vertrek_vanaf', { place: matchFromName(c, cfg) }), t('agenda.aftrap', { time: amsterdamClock(d.startMs) }), t('agenda.indicatief')].join('\n'),
        location: String(d.location || ''),
      });
    });
  });
  return out;
}

// All events of one family for the next 3 weeks, in time order. `st` is the database as the app holds it (S).
function collectEvents(familyId, st, nowMs, rideFn, role) {
  const cfg = normalizeLocations(st.locationsDoc);
  const weekKeys = feedWeekKeys(nowMs), events = [];
  for (const weekKey of weekKeys) {
    const weekState = { ...st, currentWeekKey: weekKey };   // the trick the weekly purge uses: ask the rooster code about another week
    for (const [day] of DAYS) for (const direction of ['heen', 'terug']) {
      const e = rideFn(familyId, weekState, weekKey, day, direction, cfg);
      if (e) events.push(e);
    }
  }
  const from = amsterdamToMs(weekKeyDayIso(weekKeys[0], 'Ma'), '00:00');
  const to = amsterdamToMs(weekKeyDayIso(weekKeys[weekKeys.length - 1], 'Vr'), '23:59') + 2 * 86400000;   // matches also on the weekend after the last Friday
  events.push(...matchEvents(familyId, st, from, to, cfg, role));
  return events.sort((a, b) => a.startMs - b.startMs || a.uid.localeCompare(b.uid));
}
// The rides of the family's daughter (the daughter's calendar).
export function feedEvents(familyId, st, nowMs) { return collectEvents(familyId, st, nowMs, rideEvent, 'girl'); }
// The rides the family drives (the parents' calendar), own daughter included.
export function driverFeedEvents(familyId, st, nowMs) { return collectEvents(familyId, st, nowMs, driveEvent, 'driver'); }

// ---------- the .ics file (RFC 5545) ----------
const icsText = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsStamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// Lines longer than 75 bytes are folded (a line break and a space); never inside a multi-byte character.
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { out.push(cur); cur = ''; bytes = 0; limit = 74; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
export function buildIcs({ name, events, nowMs }) {
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AZ Carpool//Agenda//NL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`, `X-WR-TIMEZONE:${FEED_TIME_ZONE}`, `X-WR-CALDESC:${icsText(t('agenda.omschrijving'))}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  for (const e of events) {
    L.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${icsStamp(nowMs)}`, `DTSTART:${icsStamp(e.startMs)}`, `DTEND:${icsStamp(e.endMs)}`,
      `SUMMARY:${icsText(e.summary)}`, `DESCRIPTION:${icsText(e.description)}`);
    if (e.location) L.push(`LOCATION:${icsText(e.location)}`);
    L.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
