// notice.js — the "melding voor iedereen": a short notice the coordinator switches on or off in Beheer and that
// every user sees as a thin yellow bar at the top of the app. Pure logic only (no DOM, no database).
// Stored in settings/notice: { on, text, offDate, offTime, offAt, updatedAt }. `offAt` (ms) is the moment it switches off by itself.
import { isValidIsoDate, isValidTime } from './period.js';

export const NOTICE_MAX = 100;

// One line of plain text, at most NOTICE_MAX characters. Never HTML: the UI escapes it again when it shows it.
export function cleanNoticeText(s){
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, NOTICE_MAX).trim();
}

// What the app keeps in memory (S.notice) for any stored (or missing, or broken) document.
export function normalizeNotice(raw){
  const r = raw && typeof raw === 'object' ? raw : {};
  const offDate = isValidIsoDate(r.offDate) ? r.offDate : '';
  const offTime = isValidTime(r.offTime) ? r.offTime : '';
  return { on: r.on === true, text: cleanNoticeText(r.text), offDate, offTime };
}

// The moment (ms, local time of the phone, like deadlines in period.js) the notice switches off, or null when it has no end.
export function noticeOffAt(n){
  const v = normalizeNotice(n);
  if(!v.offDate || !v.offTime) return null;
  const [y, m, d] = v.offDate.split('-').map(Number); const [hh, mm] = v.offTime.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

// Is the notice visible at `nowMs`? On, has text, and its end moment (when set) has not passed.
export function noticeActive(n, nowMs){
  const v = normalizeNotice(n);
  if(!v.on || !v.text) return false;
  const off = noticeOffAt(v);
  return off === null || nowMs < off;
}

// Checks what the coordinator typed. Returns { ok, errors: [i18n keys], value }.
// Rules: switched on => text needed; a date needs a time and the other way round; the end must lie in the future when on.
export function validateNotice(draft, nowMs){
  const raw = draft || {};
  const value = normalizeNotice(raw);
  const errors = [];
  const hadDate = String(raw.offDate || '').trim() !== '', hadTime = String(raw.offTime || '').trim() !== '';
  if((hadDate && !value.offDate) || (hadTime && !value.offTime)) errors.push('notice.err.invalidOff');
  else if(hadDate !== hadTime) errors.push('notice.err.offBoth');
  if(value.on && !value.text) errors.push('notice.err.noText');
  const off = noticeOffAt(value);
  if(value.on && off !== null && off <= nowMs) errors.push('notice.err.offPast');
  return { ok: errors.length === 0, errors, value };
}

// The document written to settings/notice.
export function noticeDoc(value, nowMs){
  const v = normalizeNotice(value);
  return { on: v.on, text: v.text, offDate: v.offDate, offTime: v.offTime, offAt: noticeOffAt(v), updatedAt: nowMs };
}
