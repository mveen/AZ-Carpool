// period.js — the "periode met andere tijden" (holiday or exam week): validation and phases. Pure functions,
// no DOM and no Firebase. Dates are 'YYYY-MM-DD' strings and times 'HH:MM' (local time), so no time zone can shift a day.
// Stored as one document, settings/period. Step 1 only sets the period up; parents fill in times in a later step.

export const PERIOD_MAX_WORKDAYS = 10;
export const PERIOD_NAME_MAX = 40;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

// 'YYYY-MM-DD' -> UTC midnight in ms, or null when it is not a real calendar date (e.g. 2026-02-30).
function utcMs(iso){
  const m = ISO.exec(String(iso||'')); if(!m) return null;
  const ms = Date.UTC(+m[1], +m[2]-1, +m[3]);
  const d = new Date(ms);
  return (d.getUTCFullYear()===+m[1] && d.getUTCMonth()===+m[2]-1 && d.getUTCDate()===+m[3]) ? ms : null;
}

export function isValidIsoDate(iso){ return utcMs(iso)!==null; }
export function isValidTime(hm){ return HM.test(String(hm||'')); }

// 0 = Sunday ... 6 = Saturday
export function isoWeekday(iso){ const ms = utcMs(iso); return ms===null? null : new Date(ms).getUTCDay(); }
export function isWorkday(iso){ const d = isoWeekday(iso); return d!==null && d>=1 && d<=5; }

// Monday-Friday days from first to last, both included ([] for invalid input or last before first).
export function periodWorkdays(first, last){
  const a = utcMs(first), b = utcMs(last);
  if(a===null || b===null || b<a) return [];
  const out = [];
  for(let ms=a; ms<=b; ms+=86400000){
    const d = new Date(ms); const wd = d.getUTCDay();
    if(wd>=1 && wd<=5) out.push(d.toISOString().slice(0,10));
  }
  return out;
}

// Turns whatever the form or the database holds into a clean object with all six fields as trimmed strings.
export function normalizePeriod(raw){
  const r = raw && typeof raw==='object' ? raw : {};
  const s = k => String(r[k]==null? '' : r[k]).trim();
  return { name:s('name'), firstDay:s('firstDay'), lastDay:s('lastDay'), opensOn:s('opensOn'), deadlineDate:s('deadlineDate'), deadlineTime:s('deadlineTime') };
}

// -> { ok, errors: [text key, ...], value: normalised period }. `errors` lists every problem, in the order shown to the coordinator.
export function validatePeriod(raw){
  const v = normalizePeriod(raw); const errors = [];
  if(!v.name) errors.push('period.err.name');
  else if(v.name.length>PERIOD_NAME_MAX) errors.push('period.err.nameLong');
  const firstOk = isValidIsoDate(v.firstDay), lastOk = isValidIsoDate(v.lastDay);
  if(!firstOk || !lastOk) errors.push('period.err.days');
  else {
    if(!isWorkday(v.firstDay) || !isWorkday(v.lastDay)) errors.push('period.err.weekend');
    if(v.lastDay < v.firstDay) errors.push('period.err.order');
    else if(periodWorkdays(v.firstDay, v.lastDay).length > PERIOD_MAX_WORKDAYS) errors.push('period.err.tooLong');
  }
  const opensOk = isValidIsoDate(v.opensOn), dlOk = isValidIsoDate(v.deadlineDate) && isValidTime(v.deadlineTime);
  if(!opensOk) errors.push('period.err.opens');
  if(!dlOk) errors.push('period.err.deadline');
  if(opensOk && dlOk && v.deadlineDate < v.opensOn) errors.push('period.err.deadlineBeforeOpen');
  if(dlOk && firstOk && v.deadlineDate >= v.firstDay) errors.push('period.err.deadlineAfterStart');
  return { ok: errors.length===0, errors, value: v };
}

// The stored period, or null when nothing (valid) is stored. A broken document counts as "no period".
export function storedPeriod(raw){
  if(!raw || typeof raw!=='object') return null;
  const r = validatePeriod(raw);
  return r.ok ? r.value : null;
}

// Deadline as a moment in local time (ms), or null.
export function deadlineMs(p){
  const v = normalizePeriod(p);
  if(!isValidIsoDate(v.deadlineDate) || !isValidTime(v.deadlineTime)) return null;
  const [y,m,d] = v.deadlineDate.split('-').map(Number); const [hh,mm] = v.deadlineTime.split(':').map(Number);
  return new Date(y, m-1, d, hh, mm, 0, 0).getTime();
}

// Start of a day (local 00:00) as ms.
function dayStartMs(iso){ const [y,m,d] = iso.split('-').map(Number); return new Date(y, m-1, d, 0, 0, 0, 0).getTime(); }

// Where the period stands at `nowMs`:
//   'none'    no period set
//   'waiting' filling in has not opened yet
//   'open'    parents can fill in until the deadline
//   'closed'  deadline passed, only the coordinator can still change times
//   'over'    the last day is past
export function periodPhase(p, nowMs){
  const v = p && storedPeriod(p); if(!v) return 'none';
  const now = nowMs==null? new Date().getTime() : nowMs;
  const endOfLast = dayStartMs(v.lastDay) + 86400000;
  if(now >= endOfLast) return 'over';
  if(now >= deadlineMs(v)) return 'closed';
  if(now >= dayStartMs(v.opensOn)) return 'open';
  return 'waiting';
}

// ---------- Step 2: the times a family hands in for the period ----------
// One document per family per period: periodEntries/<firstDay>_<familyId>. Per workday of the period:
//   { out: true }                       the daughter does not ride
//   { heen: 'HH:MM', terug: 'HH:MM' }   she rides; a time left out means she does not ride in that direction
// Heen = arrival in Alkmaar, terug = ready to be picked up (same as everywhere in the app).
// The standard rooster (families.schedule) is never changed: the handed-in times live next to it.

const DAY_KEYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr'];

export function periodEntryId(period, familyId){ return normalizePeriod(period).firstDay + '_' + familyId; }
// 'Ma'..'Vr' for a workday, null for a weekend day or a bad date.
export function periodDayKey(iso){ const d = isoWeekday(iso); return d>=1 && d<=5 ? DAY_KEYS[d-1] : null; }

// The standard rooster of one day of the period: { heen, terug } ('' when there is no time).
export function standardDay(family, iso){
  const s = (family && family.schedule && family.schedule[periodDayKey(iso)]) || {};
  return { heen: isValidTime(s.heen) ? s.heen : '', terug: isValidTime(s.terug) ? s.terug : '' };
}

// The form as it starts: the standard rooster. A day without standard times starts as "Rijdt niet mee".
export function defaultEntryDays(period, family){
  const days = {};
  periodWorkdays(period && period.firstDay, period && period.lastDay).forEach(iso => {
    const std = standardDay(family, iso);
    days[iso] = { out: !std.heen && !std.terug, heen: std.heen, terug: std.terug };
  });
  return days;
}

// Form values -> the stored shape, or the problems.
//   raw: { 'YYYY-MM-DD': { out:bool, heen:'HH:MM'|'', terug:'HH:MM'|'' } } for every workday of the period.
//   -> { ok, errors: [{ day, key }], days }   `key` is a text key; `days` holds the stored shape.
export function validateEntry(period, raw){
  const errors = [], days = {};
  const workdays = periodWorkdays(period && period.firstDay, period && period.lastDay);
  const src = raw && typeof raw==='object' ? raw : {};
  if(!workdays.length) return { ok:false, errors:[{ day:'', key:'period.entry.err.noPeriod' }], days:{} };
  workdays.forEach(iso => {
    const d = src[iso];
    if(!d || typeof d!=='object'){ errors.push({ day:iso, key:'period.entry.err.missing' }); return; }
    if(d.out){ days[iso] = { out:true }; return; }
    const heen = String(d.heen==null ? '' : d.heen).trim(), terug = String(d.terug==null ? '' : d.terug).trim();
    if((heen && !isValidTime(heen)) || (terug && !isValidTime(terug))){ errors.push({ day:iso, key:'period.entry.err.time' }); return; }
    if(!heen && !terug){ errors.push({ day:iso, key:'period.entry.err.noTime' }); return; }
    if(heen && terug && terug <= heen){ errors.push({ day:iso, key:'period.entry.err.order' }); return; }
    days[iso] = { ...(heen ? { heen } : {}), ...(terug ? { terug } : {}) };
  });
  return { ok: errors.length===0, errors, days: errors.length? {} : days };
}

// What a day says compared with the standard rooster:
//   { kind:'standard' } | { kind:'out' } | { kind:'times', heen?, terug? }   (only the directions that differ; null = no ride that way)
export function describeEntryDay(family, iso, day){
  const std = standardDay(family, iso);
  const stdOut = !std.heen && !std.terug;
  if(!day || day.out) return stdOut ? { kind:'standard' } : { kind:'out' };
  const heen = day.heen || '', terug = day.terug || '';
  if(heen===std.heen && terug===std.terug) return { kind:'standard' };
  return { kind:'times', ...(heen!==std.heen ? { heen: heen || null } : {}), ...(terug!==std.terug ? { terug: terug || null } : {}) };   // null = does not ride that way
}

// Can this family (or the coordinator for it) hand in times right now, and does a task show?
//   entry: the stored document or undefined   ctx: { hasFamily, isFlex, canEdit (= coordinator) }
//   -> { show: null | 'task' | 'done', canEdit: bool, badge: bool, phase }
// Parents: task from the day filling in opens until the deadline. After the deadline only the coordinator can still change times.
// A Flex family signs up per day in Wijzigen, so it has no task.
export function periodEntryState(period, entry, ctx, nowMs){
  const phase = periodPhase(period, nowMs);
  const none = { show:null, canEdit:false, badge:false, phase };
  const c = ctx || {};
  if(!c.hasFamily || c.isFlex) return none;
  const canEdit = phase==='open' || (phase==='closed' && !!c.canEdit);
  if(!canEdit && !(phase==='closed' && entry)) return none;   // closed for a parent without an entry: the standard rooster applies, nothing to show
  if(phase!=='open' && phase!=='closed') return none;
  return { show: entry ? 'done' : 'task', canEdit, badge: phase==='open' && !entry, phase };
}

// ---------- Step 3: who has handed in (coordinator overview) ----------
// Flex families sign up per day and are not counted. Rows are in the order of `families`.
//   -> { total, done, rows: [{ id, family, done }] }
export function periodProgress(period, families, entries){
  const rows = [];
  Object.entries(families || {}).forEach(([id, family]) => {
    if(!family || family.familyType==='flex') return;
    rows.push({ id, family, done: !!(entries && entries[periodEntryId(period, id)]) });
  });
  return { total: rows.length, done: rows.filter(r => r.done).length, rows };
}

// ---------- Step 4: the temporary rooster ----------
// One document per shift (a date and a direction): periodCars/<firstDay>_<date>_<direction>
//   { periodFirstDay, date, direction, cars: [{ driverFamilyId, girlIds, departureTime }], madeAt, by }
// It exists only once the coordinator made the temporary rooster (or re-planned that shift). Where it exists it replaces the standard
// rooster for that date; one-off changes in Wijzigen (deviations) still go before it.
export function periodShiftId(period, iso, direction){ return normalizePeriod(period).firstDay + '_' + iso + '_' + direction; }

// Pure edits of the cars of one shift of the temporary rooster. cars: [{ driverFamilyId, girlIds, departureTime }].
//   depOf(girlIds) -> departure time; capOf(driverId) -> passenger seats or null (unknown: no limit).
// Each returns { cars, error } where error is null or a text key with its parameters: { key, p1, p2 }.
// target of a move: 'none' (in no car) | 'car:<index>' | 'new:<driverId>' (a new car with that driver).
export function periodMoveGirl(cars, girlId, target, depOf, capOf){
  const next = (cars || []).map(c => ({ ...c, girlIds: (c.girlIds || []).filter(id => id!==girlId) }));
  const touched = new Set();
  (cars || []).forEach((c, i) => { if((c.girlIds || []).includes(girlId)) touched.add(i); });
  const m = /^car:(\d+)$/.exec(String(target)), n = /^new:(.+)$/.exec(String(target));
  if(m){
    const i = +m[1], car = next[i];
    if(!car) return { cars, error: { key:'period.rooster.err.unknown' } };
    const cap = capOf(car.driverFamilyId);
    if(cap!=null && car.girlIds.length >= cap) return { cars, error: { key:'period.rooster.err.full', p1:car.girlIds.length, p2:cap } };
    car.girlIds.push(girlId); touched.add(i);
  } else if(n){
    next.push({ driverFamilyId:n[1], girlIds:[girlId], departureTime:'' }); touched.add(next.length-1);
  } else if(target!=='none') return { cars, error: { key:'period.rooster.err.unknown' } };
  touched.forEach(i => { if(next[i]) next[i].departureTime = next[i].girlIds.length ? depOf(next[i].girlIds) : ''; });
  return { cars: next.filter(c => c.girlIds.length), error: null };
}

export function periodSetDriver(cars, index, driverId, capOf){
  const car = (cars || [])[index];
  if(!car) return { cars, error: { key:'period.rooster.err.unknown' } };
  if((cars || []).some((c, i) => i!==index && driverId && c.driverFamilyId===driverId)) return { cars, error: { key:'period.rooster.err.driverBusy' } };
  const cap = driverId? capOf(driverId) : null;
  if(cap!=null && (car.girlIds || []).length > cap) return { cars, error: { key:'period.rooster.err.full', p1:(car.girlIds || []).length, p2:cap } };
  return { cars: cars.map((c, i) => i===index ? { ...c, driverFamilyId: driverId || '' } : c), error: null };
}
