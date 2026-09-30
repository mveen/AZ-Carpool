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
