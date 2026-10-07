// period-backup.js — back-ups of a "periode met andere tijden" (pure functions: no screen, no database).
// A back-up holds the three layers of ONE period as they were at one moment: the period itself (name, dates, deadline), the times the
// families handed in (periodEntries) and the temporary rooster (periodCars). The coordinator can test freely and then put it all back.
// Stored as periodBackups/<firstDay>_<ms> (made by hand) or periodBackups/<firstDay>_auto (made by the app just before a restore).
import { deadlineMs, normalizePeriod, storedPeriod, validatePeriod } from './period.js';

export const PERIOD_BACKUP_MAX = 10;   // hand-made back-ups per period; the automatic one is extra

export const backupId = (firstDay, ms) => firstDay + '_' + ms;
export const autoBackupId = firstDay => firstDay + '_auto';

const plain = o => (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
const ofPeriod = (all, firstDay) => Object.fromEntries(Object.entries(plain(all)).filter(([, d]) => d && d.periodFirstDay === firstDay));
const clone = x => JSON.parse(JSON.stringify(x));

// The document to store. `entries` and `cars` are the whole collections (S.periodEntries, S.periodCars); only this period's part is kept.
export function buildPeriodBackup(period, entries, cars, { now, by, auto } = {}){
  const p = normalizePeriod(period);
  return clone({ periodFirstDay: p.firstDay, createdAt: now, by: by || '', auto: !!auto, period: p, entries: ofPeriod(entries, p.firstDay), cars: ofPeriod(cars, p.firstDay) });
}

// A stored back-up that is complete and consistent, or null. A broken document is ignored, never restored.
export function validBackup(raw){
  if(!raw || typeof raw !== 'object') return null;
  const period = storedPeriod(raw.period);
  if(!period || period.firstDay !== raw.periodFirstDay || typeof raw.createdAt !== 'number') return null;
  const entries = plain(raw.entries), cars = plain(raw.cars);
  if([...Object.values(entries), ...Object.values(cars)].some(d => !d || d.periodFirstDay !== period.firstDay)) return null;
  return { periodFirstDay: period.firstDay, createdAt: raw.createdAt, by: String(raw.by || ''), auto: !!raw.auto, period, entries, cars };
}

// The valid back-ups of one period, newest first, each with its document id. `all` = { id: stored document }.
export function backupsFor(all, firstDay){
  return Object.entries(plain(all)).map(([id, raw]) => { const b = validBackup(raw); return b ? { id, ...b } : null; })
    .filter(b => b && b.periodFirstDay === firstDay).sort((a, b) => b.createdAt - a.createdAt);
}

export const countManual = (all, firstDay) => backupsFor(all, firstDay).filter(b => !b.auto).length;

const daysKey = e => JSON.stringify(e && e.days || {});
const carsKey = c => JSON.stringify({ d: c && c.date, r: c && c.direction, c: c && c.cars });   // when and by whom it was made does not count

// What is different now compared with a back-up: families whose handed-in times differ (new, changed or removed), shifts of the
// temporary rooster that differ, and whether the period itself (dates, deadline) differs. Used for the warning before a restore.
export function changesSince(backup, entries, cars, period){
  const curE = ofPeriod(entries, backup.periodFirstDay), curC = ofPeriod(cars, backup.periodFirstDay);
  const diff = (a, b, key) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(id => !a[id] || !b[id] || key(a[id]) !== key(b[id])).length;
  const now = period ? normalizePeriod(period) : null;
  return { families: diff(backup.entries, curE, daysKey), shifts: diff(backup.cars, curC, carsKey), period: !now || JSON.stringify(now) !== JSON.stringify(backup.period) };
}

// What to write to put the period back exactly as the back-up has it, in ONE batch (all or nothing):
//   sets    [[path, data], ...]  the period, every handed-in entry and every shift of the back-up
//   deletes [path, ...]          entries and shifts that exist now but not in the back-up
// `others` = the other periods now (a back-up whose dates collide with one of them is refused: periods never share a day).
// -> { ok:true, sets, deletes } or { ok:false, error:<text key>, overlap }
export function planRestore(backup, others, entries, cars){
  const b = validBackup(backup);
  if(!b) return { ok: false, error: 'period.backup.err.broken', overlap: null };
  const v = validatePeriod(b.period, others);
  if(!v.ok) return { ok: false, error: v.overlap ? 'period.err.overlap' : 'period.backup.err.broken', overlap: v.overlap };
  const curE = ofPeriod(entries, b.periodFirstDay), curC = ofPeriod(cars, b.periodFirstDay);
  const sets = [['periods/' + b.periodFirstDay, { ...b.period, deadlineAt: deadlineMs(b.period) }]];
  Object.entries(b.entries).forEach(([id, d]) => sets.push(['periodEntries/' + id, d]));
  Object.entries(b.cars).forEach(([id, d]) => sets.push(['periodCars/' + id, d]));
  const deletes = [
    ...Object.keys(curE).filter(id => !b.entries[id]).map(id => 'periodEntries/' + id),
    ...Object.keys(curC).filter(id => !b.cars[id]).map(id => 'periodCars/' + id),
  ];
  return { ok: true, sets, deletes, overlap: null };
}
