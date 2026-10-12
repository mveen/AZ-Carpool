// cron/lib/setup.mjs — where the cron jobs find their settings, secrets and output folder.
// Layout on the host (all outside the web folder):  ~/azcarpool-cron/  code (this folder)
//                                                   ~/azcarpool-secrets/  the two key files (never in git)
//                                                   ~/azcarpool-data/backups/  the nightly back-ups
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const codeDir = join(dirname(fileURLToPath(import.meta.url)), '..');
export const secretsDir = () => process.env.AZ_SECRETS || join(homedir(), 'azcarpool-secrets');
export const dataDir = () => process.env.AZ_DATA || join(homedir(), 'azcarpool-data');

// config.json is made by the build from firebase-config.js (public values only: project id and the Calendar key).
export function loadConfig(dir = codeDir) {
  let c;
  try { c = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')); } catch (e) { throw new Error('config.json is missing or broken (it is made by `npm run build:cron`)'); }
  for (const k of ['projectId', 'calendarApiKey', 'referer']) if (!c[k]) throw new Error(`config.json has no ${k}`);
  return c;
}
