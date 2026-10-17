// cron/lib/run-window.mjs — when a cron job may do its work. Every run of a job reads from the (shared, free-plan) database, so a job that
// fires every 5 or 30 minutes all night, or far more often than anyone looks at the result, eats the daily read quota for nothing.
// PURE helpers (the time comes in as an argument); the only file access is in lastRunAt / markRun, which the jobs call from their main block.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const TZ = 'Europe/Amsterdam';

// The hour of day (0-23) in Amsterdam, whatever the time zone of the host is.
export function amsterdamHour(nowMs) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs));
  return Number(parts.find(p => p.type === 'hour').value);
}

// true while the Amsterdam hour is in [fromHour, toHour): e.g. { fromHour: 0, toHour: 5 } = from 00:00 until 04:59.
export function inQuietWindow(nowMs, { fromHour, toHour }) {
  const h = amsterdamHour(nowMs);
  return fromHour <= toHour ? h >= fromHour && h < toHour : h >= fromHour || h < toHour;
}

// true when the last run is less than minGapMs ago (a missing / invalid last run is never "too soon"; a last run in the future is ignored).
export function tooSoon(lastMs, nowMs, minGapMs) {
  if (typeof lastMs !== 'number' || !isFinite(lastMs) || lastMs > nowMs) return false;
  return nowMs - lastMs < minGapMs;
}

// Why a job should not run now, or '' when it should. quiet: { fromHour, toHour } or null; minGapMs: 0 = no limit.
export function skipReason({ nowMs, quiet = null, lastMs = null, minGapMs = 0 }) {
  if (quiet && inQuietWindow(nowMs, quiet)) return 'quiet hours';
  if (minGapMs > 0 && tooSoon(lastMs, nowMs, minGapMs)) return 'ran less than ' + Math.round(minGapMs / 60000) + ' minutes ago';
  return '';
}

export function lastRunAt(file) {
  try { const n = Number(readFileSync(file, 'utf8').trim()); return isFinite(n) && n > 0 ? n : null; } catch (e) { return null; }
}
export function markRun(file, nowMs) {
  try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, String(nowMs), { mode: 0o600 }); } catch (e) { /* best effort: a job must never fail on this */ }
}
