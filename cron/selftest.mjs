// cron/selftest.mjs — "is this host ready?" Prints one line per check; exits 1 only on a real problem.
// A key file that is not uploaded yet is a WARN (the deploy runs this before the keys exist), a broken one is a FAIL.
import { statSync, existsSync, accessSync, constants as fsConstants } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { dirname, join } from 'node:path';
import { signJwt, readServiceAccount, fetchAccessToken, SCOPE_DATASTORE } from './lib/google-auth.mjs';
import { agendaDir, loadConfig, secretsDir, dataDir } from './lib/setup.mjs';

let failed = 0;
const line = (kind, text) => { console.log(`${kind.padEnd(4)} ${text}`); if (kind === 'FAIL') failed++; };
const guard = async (label, fn) => { try { const r = await fn(); line('ok', label + (r ? ' — ' + r : '')); } catch (e) { line('FAIL', `${label} — ${e.message}`); } };

const major = Number(process.versions.node.split('.')[0]);
line(major >= 20 ? 'ok' : 'FAIL', `node ${process.versions.node} (needs 20 or newer)`);
await guard('config.json', () => { const c = loadConfig(); return `project ${c.projectId}`; });
await guard('signing (RS256)', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  if (signJwt({ account: { client_email: 'x@y', private_key: privateKey }, scope: SCOPE_DATASTORE }).split('.').length !== 3) throw new Error('no token');
});
if (!process.env.AZ_SELFTEST_OFFLINE) {
  await guard('Google reachable', async () => { const r = await fetch('https://firestore.googleapis.com/', { signal: AbortSignal.timeout(15000) }); return 'HTTP ' + r.status; });
}

for (const [file, role] of [['backup-key.json', 'back-up (read only)'], ['calendar-key.json', 'match calendars and weekly purge (read/write data)']]) {
  const path = join(secretsDir(), file);
  if (!existsSync(path)) { line('WARN', `${file} not uploaded yet (${role})`); continue; }
  const mode = statSync(path).mode & 0o077;
  if (mode) line('FAIL', `${file} can be read by other users (run: chmod 600 ${path})`);
  await guard(`${file} logs in to Google`, async () => {
    const account = readServiceAccount(path);
    if (!process.env.AZ_SELFTEST_OFFLINE) await fetchAccessToken({ account, scope: SCOPE_DATASTORE });
    return account.client_email;
  });
}
line('ok', `data folder ${dataDir()}`);
// The calendar files go in the web folder (agenda/). The folder itself is made by the job; the web folder must exist and be writable.
{
  const web = dirname(agendaDir());
  if (!existsSync(web)) line('WARN', `web folder ${web} not found (the agenda job writes the calendar files in ${agendaDir()})`);
  else { try { accessSync(existsSync(agendaDir()) ? agendaDir() : web, fsConstants.W_OK); line('ok', `agenda folder ${agendaDir()}`); } catch (e) { line('FAIL', `agenda folder ${agendaDir()} is not writable`); } }
}
process.exit(failed ? 1 : 0);
