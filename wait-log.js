// wait-log.js — the waiting time of the players (speelsters), per week, month or year, for the Beheer card "Wachttijd" (pure functions, no screen, no database).
// It reads the ride log (rideLog/<date>_<heen|terug>, see ride-log.js): every car of a shift that was logged since this function exists holds
// `waits: { girlId: minutes }`, how long each girl waited on that ride (measured as the advice does: heen she waits for what is left to her time
// after the car arrived; terug she waits from her time until the car leaves). Rides logged before that have no `waits` and are not counted at all,
// so an average never gets pulled down by rides we know nothing about. A ride the coordinator removed (`removed`) does not count either.
import { getISOWeekKey, weekKeyDayIso } from './dates.js';

const isIso = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const girlLabel = f => (f && (f.girlName || f.parentName)) || '';

// period: { weekKey } | { year, month } | { year }. A ride counts when its date is inside it.
const inPeriod = (d, p) => !p || (p.weekKey ? d.weekKey === p.weekKey : ((!p.year || +d.date.slice(0, 4) === p.year) && (!p.month || +d.date.slice(5, 7) === p.month)));

// The ISO week key `delta` weeks before / after `weekKey` ('2026-W40'); null for a wrong key.
export function shiftWeekKey(weekKey, delta){
  const monday = weekKeyDayIso(weekKey, 'Ma');
  if(!monday) return null;
  const [y, m, d] = monday.split('-').map(Number);
  return getISOWeekKey(new Date(y, m - 1, d + 7 * delta));
}

// One row per girl that waited at least once in the period: { key, name, rides, total, average, heen, terug, longest }.
//   rides: the rides she was in that have waiting data; total: minutes; average: minutes per ride; heen / terug: average per direction (null when none).
export function waitTally(logs, families, p){
  const rows = new Map();
  Object.values(logs || {}).forEach(d => {
    if(!d || !isIso(d.date) || !Array.isArray(d.cars) || !inPeriod(d, p)) return;
    const dir = d.direction === 'terug' ? 'terug' : 'heen';
    d.cars.forEach(c => {
      if(!c || c.removed || !c.waits) return;
      Object.entries(c.waits).forEach(([id, w]) => {
        if(typeof w !== 'number' || !isFinite(w) || w < 0) return;
        if(!rows.has(id)) rows.set(id, { key: id, name: girlLabel(families && families[id]) || '?', rides: 0, total: 0, longest: 0, n: { heen: 0, terug: 0 }, sum: { heen: 0, terug: 0 } });
        const r = rows.get(id);
        r.rides++; r.total += w; r.longest = Math.max(r.longest, w); r.n[dir]++; r.sum[dir] += w;
      });
    });
  });
  return [...rows.values()].map(({ n, sum, ...r }) => ({
    ...r, average: r.total / r.rides, heen: n.heen ? sum.heen / n.heen : null, terug: n.terug ? sum.terug / n.terug : null,
  }));
}

// Longest total waiting first, then by name: the order the card shows.
export const sortWaitRows = rows => [...rows].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'nl'));

// The team over a set of rows: { girls, rides, total, average (minutes per ride, all girls together), perGirl (average of the totals), min, max (the
// fewest / most minutes a girl waited in total) }. Everything 0 when nobody waited in the period.
export function waitSummary(rows){
  const n = rows.length, rides = rows.reduce((s, r) => s + r.rides, 0), total = rows.reduce((s, r) => s + r.total, 0);
  const totals = rows.map(r => r.total);
  return { girls: n, rides, total, average: rides ? total / rides : 0, perGirl: n ? total / n : 0, min: n ? Math.min(...totals) : 0, max: n ? Math.max(...totals) : 0 };
}

// Does a girl wait clearly more than the team? Her average per ride against the team's, with a margin of `margin` minutes (default 10)
// so a small difference is not called a complaint. Only meaningful from `minRides` rides (default 3).
export const WAIT_MARGIN_MIN = 10, WAIT_MIN_RIDES = 3;
export function waitsMore(row, summary, margin = WAIT_MARGIN_MIN, minRides = WAIT_MIN_RIDES){
  return row.rides >= minRides && row.average >= summary.average + margin;
}

// The years that have waiting data, newest first; always including `thisYear`.
export function waitYears(logs, thisYear){
  const ys = new Set(Object.values(logs || {}).filter(d => d && isIso(d.date) && Array.isArray(d.cars) && d.cars.some(c => c && !c.removed && c.waits)).map(d => +d.date.slice(0, 4)));
  ys.add(thisYear);
  return [...ys].sort((a, b) => b - a);
}

// Minutes as people read them: 95 -> "1 u 35 min", 40 -> "40 min", 0 -> "0 min".
export function fmtMinutes(m){
  const r = Math.round(m || 0);
  return r >= 60 ? `${Math.floor(r / 60)} u${r % 60 ? ' ' + (r % 60) + ' min' : ''}` : `${r} min`;
}
