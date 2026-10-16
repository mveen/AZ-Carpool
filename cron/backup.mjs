// cron/backup.mjs — nightly back-up of the whole Firestore database to a compressed file on the host.
//   node backup.mjs
// One line per document in <data>/backups/firestore-YYYY-MM-DD.jsonl.gz, in Firestore's own format
// ({path, name, fields, createTime, updateTime}), so a restore can write every document back unchanged.
// It only READS the database (service account with the role "Cloud Datastore Viewer").
// Keeps the last 30 back-ups plus the one of the 1st of each month for a year. The files hold personal data: folder 700, files 600.
import { createWriteStream, createReadStream, mkdirSync, readdirSync, renameSync, rmSync, chmodSync } from 'node:fs';
import { createGzip, createGunzip } from 'node:zlib';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readServiceAccount, tokenProvider } from './lib/google-auth.mjs';
import { createFirestore } from './lib/firestore-rest.mjs';
import { loadConfig, secretsDir, dataDir, isMainModule } from './lib/setup.mjs';

export const KEEP_DAILY = 30, KEEP_MONTHLY_DAYS = 366;
const NAME = /^firestore-(\d{4})-(\d{2})-(\d{2})\.jsonl\.gz$/;

// Calendar date in Amsterdam, so the file name matches the day the owner sees.
export const dayStamp = (now = Date.now()) => new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
export const backupName = (now = Date.now()) => `firestore-${dayStamp(now)}.jsonl.gz`;

// PURE. Which back-up files may be deleted: everything except the newest `daily`, and the 1st-of-the-month files younger than a year.
// Files that do not have exactly the back-up name are never listed.
export function filesToPrune(names, now = Date.now(), { daily = KEEP_DAILY, monthlyDays = KEEP_MONTHLY_DAYS } = {}) {
  const mine = names.filter(n => NAME.test(n)).sort().reverse();
  const keep = new Set(mine.slice(0, daily));
  for (const n of mine) {
    const [, y, mo, d] = n.match(NAME);
    const ageDays = (now - Date.UTC(+y, +mo - 1, +d)) / 86400000;
    if (d === '01' && ageDays < monthlyDays) keep.add(n);
  }
  return mine.filter(n => !keep.has(n));
}

async function countLines(file) {
  let n = 0;
  const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) { if (line) { JSON.parse(line); n++; } }
  return n;
}

export async function runBackup({ firestore, dir, now = Date.now(), log = console.log, warn = console.error }) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const name = backupName(now), tmp = join(dir, '.tmp-' + name), final = join(dir, name);
  const gz = createGzip(), out = createWriteStream(tmp, { mode: 0o600 });
  gz.pipe(out);
  let docs = 0, collections = new Set();
  try {
    for await (const { path, doc, missing } of firestore.walk()) {
      if (missing) continue;   // a path that only holds sub-collections has no data of its own
      const rec = { path, name: doc.name, fields: doc.fields || {}, createTime: doc.createTime, updateTime: doc.updateTime };
      if (!gz.write(JSON.stringify(rec) + '\n')) await once(gz, 'drain');
      docs++; collections.add(path.split('/')[0]);
    }
    gz.end(); await finished(out);
    if (docs === 0) throw new Error('The database returned no documents at all: nothing saved, nothing deleted');
    const check = await countLines(tmp);
    if (check !== docs) throw new Error(`The back-up file could not be read back correctly (${check} of ${docs} documents)`);
  } catch (e) { gz.destroy(); out.destroy(); rmSync(tmp, { force: true }); throw e; }
  const before = readdirSync(dir).filter(n => NAME.test(n) && n !== name).sort().pop();
  renameSync(tmp, final);
  const doomed = filesToPrune(readdirSync(dir), now);
  for (const n of doomed) rmSync(join(dir, n), { force: true });
  log(`Back-up ${name}: ${docs} documents in ${collections.size} collections` + (doomed.length ? `, ${doomed.length} old back-ups removed` : ''));
  return { name, docs, pruned: doomed, previous: before };
}

if (isMainModule(import.meta.url)) {
  try {
    const { projectId } = loadConfig();
    const account = readServiceAccount(join(secretsDir(), 'backup-key.json'));
    const firestore = createFirestore({ projectId, getToken: tokenProvider({ account }) });
    await runBackup({ firestore, dir: join(dataDir(), 'backups') });
  } catch (e) { console.error('BACK-UP FAILED: ' + e.message); process.exit(1); }
}
