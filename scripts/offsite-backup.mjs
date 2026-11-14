// scripts/offsite-backup.mjs — the copy of the database on the OWNER'S OWN COMPUTER (a second place, apart from the host).
// Started every hour by macOS (launchd, see scripts/install-mac-backup.sh). It does nothing when today's copy is already there,
// so a laptop that was off or offline catches up by itself at the next start or the next hour it is online.
// It reads the database directly (not the host), so it also works when the host is gone. Rolling: only the newest copy is kept.
//
// Layout on the computer (outside Documents, so macOS asks no folder permission):
//   ~/azcarpool-backup/backup-key.json          read-only key (role "Cloud Datastore Viewer"), never in git
//   ~/azcarpool-backup/firestore-YYYY-MM-DD.jsonl.gz   the newest copy (same format as the host's back-ups)
//   ~/azcarpool-backup/backup.log                last lines of what happened
//   ~/azcarpool-backup/code/                     a copy of this script and what it needs (made by the installer)
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runBackup, backupName } from '../cron/backup.mjs';
import { readServiceAccount, tokenProvider } from '../cron/lib/google-auth.mjs';
import { createFirestore } from '../cron/lib/firestore-rest.mjs';
import { isMainModule } from '../cron/lib/setup.mjs';

export const LIVE_PROJECT = 'az-carpool';
export const KEEP = { daily: 1, monthlyDays: 0 };   // rolling: only the newest copy
export const STALE_DAYS = 3;                        // warn on screen when the newest copy is older than this
export const LOG_LINES = 200;
const NAME = /^firestore-(\d{4})-(\d{2})-(\d{2})\.jsonl\.gz$/;

export const offsiteDir = (env = process.env) => env.AZ_OFFSITE_DIR || join(homedir(), 'azcarpool-backup');

// PURE. The newest back-up file in a list of names (null when there is none).
export const newestBackup = names => names.filter(n => NAME.test(n)).sort().pop() || null;
// PURE. Is a new copy needed? Not when today's file (Amsterdam date) is already there.
export const needsRun = (names, now = Date.now()) => !names.includes(backupName(now));
// PURE. Whole days between the date in a back-up file name and now (Infinity without a file).
export function ageDays(name, now = Date.now()) {
  const m = name && name.match(NAME);
  return m ? Math.floor((now - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000) : Infinity;
}
// PURE. The text of the on-screen warning, or '' when no warning is needed.
export function staleWarning(names, now = Date.now()) {
  const newest = newestBackup(names);
  if (!newest) return 'Er is nog geen back-up van AZ Carpool op deze computer gelukt.';
  const days = ageDays(newest, now);
  return days > STALE_DAYS ? `De back-up van AZ Carpool op deze computer is ${days} dagen oud.` : '';
}
// PURE. Adds a line to the log text and keeps only the last LOG_LINES lines.
export function appendLog(text, line, max = LOG_LINES) {
  return [...String(text || '').split('\n').filter(Boolean), line].slice(-max).join('\n') + '\n';
}

function notify(text) {   // best effort, macOS only: a notification on screen
  if (process.platform !== 'darwin') return;
  try { execFile('osascript', ['-e', `display notification ${JSON.stringify(text)} with title "AZ Carpool back-up"`], () => {}); } catch (e) { /* no notification */ }
}

// One run. Returns { status: 'skipped' | 'done' | 'failed', message }. Never throws: launchd starts it again next hour.
export async function runOffsite({ dir = offsiteDir(), now = Date.now(), makeFirestore, warn = notify } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
  const logFile = join(dir, 'backup.log');
  const stamp = new Date(now).toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' });
  const note = line => { try { writeFileSync(logFile, appendLog(existsSync(logFile) ? readFileSync(logFile, 'utf8') : '', `${stamp}  ${line}`), { mode: 0o600 }); } catch (e) { /* the log is not worth failing for */ } };
  if (!needsRun(readdirSync(dir), now)) return { status: 'skipped', message: `Today's copy is already there (${backupName(now)}).` };
  try {
    const firestore = makeFirestore ? makeFirestore() : (() => {
      const account = readServiceAccount(join(dir, 'backup-key.json'));
      if (account.project_id !== LIVE_PROJECT) throw new Error(`backup-key.json belongs to project "${account.project_id}", not to ${LIVE_PROJECT}`);
      return createFirestore({ projectId: LIVE_PROJECT, getToken: tokenProvider({ account }), retries: 1 });
    })();
    const r = await runBackup({ firestore, dir, now, keep: KEEP, log: () => {}, warn: () => {} });
    const message = `Copy made: ${r.name}, ${r.docs} documents` + (r.pruned.length ? ` (older copy removed: ${r.pruned.join(', ')})` : '');
    note(message);
    return { status: 'done', message };
  } catch (e) {
    const message = `No copy made: ${e.message}. Next try within the hour.`;
    note(message);
    const w = staleWarning(readdirSync(dir), now);
    if (w) warn(w + ' Kijk in ~/azcarpool-backup/backup.log.');
    return { status: 'failed', message };
  }
}

if (isMainModule(import.meta.url)) {
  const r = await runOffsite();
  if (r.status !== 'skipped' || process.stdout.isTTY) console.log(r.message);   // the hourly "already there" would only fill launchd.log
  process.exit(r.status === 'failed' ? 1 : 0);
}
