// cron/lib/setup.mjs — where the cron jobs find their settings, secrets and output folder.
// Layout on the host (all outside the web folder):  ~/azcarpool-cron/  code (this folder)
//                                                   ~/azcarpool-secrets/  the two key files (never in git)
//                                                   ~/azcarpool-data/backups/  the nightly back-ups
//                                                   ~/domains/azcarpool.nl/public_html/agenda/  the calendar files (agenda.mjs)
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const codeDir = join(dirname(fileURLToPath(import.meta.url)), '..');
// True when this file is the one node was started with (not just imported, e.g. by a test). Compares REAL paths: a start through a
// symbolic link (macOS temp folders, a host whose /home is a link) must still run the job, instead of silently doing nothing with exit 0.
export function isMainModule(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try { return realpathSync(argv1) === realpathSync(fileURLToPath(metaUrl)); } catch (e) { return false; }
}
export const secretsDir = () => process.env.AZ_SECRETS || join(homedir(), 'azcarpool-secrets');
export const dataDir = () => process.env.AZ_DATA || join(homedir(), 'azcarpool-data');
// The folder with the calendar files (the only job output that lives INSIDE the web folder, so calendar apps can fetch it).
export const agendaDir = () => process.env.AZ_AGENDA_DIR || join(homedir(), 'domains', 'azcarpool.nl', 'public_html', 'agenda');

// config.json is made by the build from firebase-config.js (public values only: project id and the Calendar key).
export function loadConfig(dir = codeDir) {
  let c;
  try { c = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')); } catch (e) { throw new Error('config.json is missing or broken (it is made by `npm run build:cron`)'); }
  for (const k of ['projectId', 'calendarApiKey', 'referer']) if (!c[k]) throw new Error(`config.json has no ${k}`);
  return c;
}
