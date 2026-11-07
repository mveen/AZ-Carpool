// day-change-notice.js — "Melding dagwijzigingen": a hint in the screen where a day's changes are processed ("Wijzigingen voor <dag>").
// Changes can still come in until the day before, so processing them too early makes times and cars change again. The hint is shown
// until a time on the day before (default 11:00); the coordinator switches it on and off and sets that time in Beheer.
// Pure logic only (no DOM, no database). Stored in settings/dayChangeNotice: { on, until, updatedAt }.
import { isValidIsoDate, isValidTime } from './period.js';

export const DEFAULT_UNTIL = '11:00';

// What the app keeps in memory (S.dayChangeNotice) for any stored (or missing, or broken) document. No document = switched on, 11:00.
export function normalizeDayChangeNotice(raw){
  const r = raw && typeof raw === 'object' ? raw : {};
  return { on: r.on !== false, until: isValidTime(r.until) ? r.until : DEFAULT_UNTIL };
}

const pad = n => String(n).padStart(2, '0');
const isoOfLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The moment (ms, local time of the phone) up to which the hint is shown for the day 'YYYY-MM-DD': the day before, at `until`.
export function dayChangeNoticeCutoffMs(dayIso, until){
  const [y, m, d] = String(dayIso).split('-').map(Number), [hh, mm] = String(until).split(':').map(Number);
  return new Date(y, m - 1, d - 1, hh, mm, 0, 0).getTime();
}

// null = no hint. Otherwise { dayBeforeIso, isToday }: the day before the day, and whether that is today (the text then says "vandaag").
export function dayChangeNoticeFor(cfg, dayIso, nowMs){
  const v = normalizeDayChangeNotice(cfg);
  if(!v.on || !isValidIsoDate(dayIso)) return null;
  const cutoff = dayChangeNoticeCutoffMs(dayIso, v.until);
  if(nowMs >= cutoff) return null;
  const [y, m, d] = dayIso.split('-').map(Number);
  const before = new Date(y, m - 1, d - 1);
  return { dayBeforeIso: isoOfLocal(before), isToday: isoOfLocal(before) === isoOfLocal(new Date(nowMs)) };
}

// Checks what the coordinator filled in. Returns { ok, errors: [i18n keys], value }.
export function validateDayChangeNotice(draft){
  const raw = draft || {};
  const errors = [];
  if(!isValidTime(raw.until)) errors.push('dayNotice.err.time');
  return { ok: errors.length === 0, errors, value: { on: !!raw.on, until: isValidTime(raw.until) ? raw.until : DEFAULT_UNTIL } };
}

// The document written to settings/dayChangeNotice.
export function dayChangeNoticeDoc(value, nowMs){
  const v = normalizeDayChangeNotice(value);
  return { on: v.on, until: v.until, updatedAt: nowMs };
}
