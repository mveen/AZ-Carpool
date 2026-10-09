// ride-log.js — the log of rides that were driven, for the solidarity overview in Beheer (pure functions, no screen, no database).
// One document per shift that has taken place: rideLog/<YYYY-MM-DD>_<heen|terug>. It holds one entry per car that had a driver and
// at least one girl, so a family that drove twice on one day (heen and terug) counts twice. A shift is only logged after it has
// taken place (the latest departure time of its cars has passed). The coordinator's app writes the log (data.js, logPassedShifts).
// Nothing in the log is ever read back into the planning: it only feeds the counts and the CSV export.
import { DAYS } from './constants.js';

export const DIRECTIONS = ['heen', 'terug'];

export const rideLogId = (iso, direction) => `${iso}_${direction}`;
const isIso = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const familyLabel = f => (f && (f.girlName || f.parentName)) || '';

// The moment a shift is over: the latest departure time of its cars on that date (local time), else the end of that day.
export function shiftEndMs(iso, cars){
  const [y, m, d] = String(iso).split('-').map(Number);
  const times = (cars || []).map(c => /^(\d{1,2}):(\d{2})$/.exec(String(c.departureTime || ''))).filter(Boolean).map(x => +x[1] * 60 + +x[2]);
  const mins = times.length ? Math.max(...times) : 24 * 60;
  return new Date(y, m - 1, d, 0, mins).getTime();
}

// The document to store for one shift, or null when there is nothing to log yet: not over, or no car with a driver and a girl.
// cars: the cars that actually ran (effectiveCars). families: for the names as they are today.
export function buildRideLogDoc({ iso, day, direction, weekKey, cars, families, nowMs }){
  if(!isIso(iso) || !DIRECTIONS.includes(direction)) return null;
  const driven = (cars || []).filter(c => c && c.driverFamilyId && (c.girlIds || []).length);
  if(!driven.length || shiftEndMs(iso, cars) > nowMs) return null;
  return {
    date: iso, day, direction, weekKey, loggedAt: nowMs,
    cars: driven.map(c => ({ familyId: c.driverFamilyId, name: familyLabel(families && families[c.driverFamilyId]), girls: c.girlIds.length })),
  };
}

// The candidate shifts to log: every day + direction of the given weeks (week keys). `carsOf(weekKey, day, direction)` gives the cars.
// `isoOf(weekKey, day)` gives the date. Shifts that are already in the log (`logged`: { id: doc }) are skipped.
export function newLogDocs({ weekKeys, carsOf, isoOf, families, logged, nowMs }){
  const out = [];
  weekKeys.forEach(weekKey => DAYS.forEach(([day]) => DIRECTIONS.forEach(direction => {
    const iso = isoOf(weekKey, day), id = iso && rideLogId(iso, direction);
    if(!id || (logged && logged[id])) return;
    const doc = buildRideLogDoc({ iso, day, direction, weekKey, cars: carsOf(weekKey, day, direction), families, nowMs });
    if(doc) out.push([id, doc]);
  })));
  return out;
}

// ---------- counting ----------
const entries = logs => Object.values(logs || {}).filter(d => d && isIso(d.date) && Array.isArray(d.cars));
// The cars of a log document that count: a car the coordinator removed (`removed: true`) stays in the log, so the shift is not logged again, but is not counted.
const live = d => d.cars.filter(c => c && !c.removed);
// period: { year, month } (month 1-12, optional); a ride counts when its date is inside it.
const inPeriod = (iso, p) => !p || ((!p.year || +iso.slice(0, 4) === p.year) && (!p.month || +iso.slice(5, 7) === p.month));

// One row per family, in the order of `families` and then drivers that are only in the log (a deleted family).
// { key, familyId, name, parent, total, heen, terug, months:[12 counts of p.year] }
export function tally(logs, families, p){
  const rows = new Map();
  const row = (id, name) => {
    if(!rows.has(id)){
      const f = families && families[id];
      rows.set(id, { key: id, familyId: f ? id : null, name: f ? familyLabel(f) : name || '?', parent: f ? f.parentName || '' : '', total: 0, heen: 0, terug: 0, months: Array(12).fill(0) });
    }
    return rows.get(id);
  };
  Object.keys(families || {}).forEach(id => row(id));
  entries(logs).forEach(d => live(d).forEach(c => {
    if(!c.familyId) return;
    const r = row(c.familyId, c.name);
    if(p && p.year && +d.date.slice(0, 4) === p.year) r.months[+d.date.slice(5, 7) - 1]++;
    if(!inPeriod(d.date, p)) return;
    r.total++; r[d.direction === 'terug' ? 'terug' : 'heen']++;
  }));
  return [...rows.values()];
}

// Most rides first, then by name; the order the overview shows.
export const sortRows = rows => [...rows].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'nl'));

// Summary of a set of rows: how many rides, how many families took part, the average per family, the fewest and the most.
export function spread(rows){
  const total = rows.reduce((s, r) => s + r.total, 0), n = rows.length;
  const totals = rows.map(r => r.total);
  return { total, families: n, average: n ? total / n : 0, min: n ? Math.min(...totals) : 0, max: n ? Math.max(...totals) : 0, idle: rows.filter(r => !r.total).length };
}

// The years that have rides, newest first; always including `thisYear`.
export function logYears(logs, thisYear){
  const ys = new Set(entries(logs).filter(d => live(d).length).map(d => +d.date.slice(0, 4)));
  ys.add(thisYear);
  return [...ys].sort((a, b) => b - a);
}

// ---------- the rides behind the counts ----------
// One row per car (= one shift driven by one family) in the period, newest day first; on one day heen before terug.
// `removed`: false gives the rides that count, true the ones the coordinator removed.
// { id: docId, index: place of the car in the doc, date, day, direction, familyId, name, parent, girls, loggedAt, removed }
export function shiftList(logs, families, p, removed = false){
  const rows = [];
  Object.entries(logs || {}).forEach(([id, d]) => {
    if(!d || !isIso(d.date) || !Array.isArray(d.cars) || !inPeriod(d.date, p)) return;
    d.cars.forEach((c, index) => {
      if(!c || !c.familyId || !!c.removed !== removed) return;
      const f = families && families[c.familyId];
      rows.push({ id, index, date: d.date, day: d.day || '', direction: d.direction === 'terug' ? 'terug' : 'heen', familyId: c.familyId,
        name: f ? familyLabel(f) : c.name || '?', parent: f ? f.parentName || '' : '', girls: c.girls || 0, loggedAt: d.loggedAt || 0, removed: !!c.removed });
    });
  });
  return rows.sort((a, b) => b.date.localeCompare(a.date) || (a.direction === b.direction ? 0 : a.direction === 'heen' ? -1 : 1) || a.name.localeCompare(b.name, 'nl'));
}

// The document with one car removed (or put back): a copy, or null when the car is not there (the log changed meanwhile).
// `familyId` guards against a log that was shifted under the coordinator's finger.
export function withCarRemoved(doc, index, familyId, removed){
  const car = doc && Array.isArray(doc.cars) ? doc.cars[index] : null;
  if(!car || car.familyId !== familyId) return null;
  const cars = doc.cars.map((c, i) => {
    if(i !== index) return c;
    const { removed: _was, ...rest } = c;
    return removed ? { ...rest, removed: true } : rest;
  });
  return { ...doc, cars };
}

// ---------- export (CSV, semicolon-separated, UTF-8 with BOM: opens in Excel / LibreOffice like the family back-up) ----------
const BOM = '﻿';
const FORMULA_START = /^[=+\-@\t\r]/;
const cell = v => {
  let s = v == null ? '' : String(v);
  if(FORMULA_START.test(s) && !/^[+-]?[\d\s().,-]+$/.test(s)) s = "'" + s;   // a name like "=HYPERLINK(..)" must not run as a formula
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = rows => BOM + rows.map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
export const MONTH_HEADERS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

// Per family, per month of one year, plus the total, heen and terug.
export function yearCsv(logs, families, year){
  const rows = sortRows(tally(logs, families, { year }));
  return toCsv([
    ['Gezin', 'Ouder', ...MONTH_HEADERS, `Totaal ${year}`, 'Heen', 'Terug'],
    ...rows.map(r => [r.name, r.parent, ...r.months, r.total, r.heen, r.terug]),
  ]);
}

// Every ride in the log, one row per car, oldest first (all years).
export function ridesCsv(logs, families){
  const rows = [];
  entries(logs).sort((a, b) => a.date.localeCompare(b.date) || String(a.direction).localeCompare(String(b.direction))).forEach(d => live(d).forEach(c => {
    const f = families && families[c.familyId];
    rows.push([d.date, d.day || '', d.direction, f ? familyLabel(f) : c.name || '', f ? f.parentName || '' : '', c.girls || '']);
  }));
  return toCsv([['Datum', 'Dag', 'Richting', 'Chauffeur (gezin)', 'Ouder', 'Aantal meiden'], ...rows]);
}

export const rideLogFileName = (kind, year, now = new Date()) =>
  kind === 'year' ? `gereden-shifts-${year}.csv` : `alle-ritten-${now.toISOString().slice(0, 10)}.csv`;
