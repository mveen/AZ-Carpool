// scripts/seed-test-data.mjs: `npm run seed:test -- --backup backups/firestore-2026-10-18.jsonl.gz --key backups/test-key.json [--write]`
// Fills the TEST database (az-carpool-test) with a copy of the live data, made from a nightly back-up file (cron/backup.mjs):
//   - the same families, rooster, selection order, day coordinators, settings, one-off changes, periods and so on;
//   - every phone number replaced by one test number, and every family gets a NEW invite code (the old ones never leave the back-up);
//   - left out: the history (ride log), who-is-linked-to-which-browser, sessions, calendar links, push data, the API key, notices and the
//     maintenance switch (see DROP_*): the test browsers link again with the new codes.
// Without --write nothing is written and no key is needed (dry run: only the report). It writes ONLY to the project az-carpool-test: the key file must belong to
// that project, and the project id is fixed in this file. The back-up and the key file stay on your computer (folder backups/ is in .gitignore).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { randomInt } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFirestore, decodeFields } from '../cron/lib/firestore-rest.mjs';
import { readServiceAccount, tokenProvider } from '../cron/lib/google-auth.mjs';
import { normalizePhone } from '../coordinator.js';

export const LIVE_PROJECT = 'az-carpool';
export const TEST_PROJECT = 'az-carpool-test';
export const TEST_PHONE = '0641434197';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Whole collections that are not copied, and why.
export const DROP_COLLECTIONS = {
  links: 'links of browsers to families (test browsers link again with the new codes)',
  sessions: 'sessions of browsers',
  calendarTokens: 'secret calendar links',
  driverCalendarTokens: 'secret calendar links',
  pushDevices: 'push subscriptions of real phones',
  pushQueue: 'push queue',
  testNotifications: 'push tests',
  rideLog: 'history (driven rides)',
  errorLog: 'history (error log)',
};
// Documents in settings/ that are not copied, and why.
export const DROP_SETTINGS = {
  apiKeys: 'secret API key',
  pushKey: 'push server key',
  pushStatus: 'push status of the live server',
  push: 'push switch of the live server',
  maintenance: 'live maintenance switch',
  notice: 'live notice for everyone',
};

function dropReason(path) {
  const parts = path.split('/');
  if (parts.includes('notifications')) return 'inbox notifications (short-lived)';
  if (DROP_COLLECTIONS[parts[0]]) return DROP_COLLECTIONS[parts[0]];
  if (parts[0] === 'settings' && DROP_SETTINGS[parts[1]]) return DROP_SETTINGS[parts[1]];
  return null;
}

// 10 digits, never starting with 0 (so a code can never look like a phone number).
export const randomCode = () => String(randomInt(1, 10)) + String(randomInt(0, 1e9)).padStart(9, '0');

export function readBackup(file) {
  const buf = readFileSync(file);
  const text = (file.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8');
  return text.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}

const PHONE_RE = /(?:\+|\b00)?31[\s-]?\(?0?\)?[\s-]?6(?:[\s-]?\d){8}|\b0[\s-]?6(?:[\s-]?\d){8}/g;

// Anything that must not survive in the copy: old codes, secret tokens, keys, and phone numbers other than the test number.
export function findLeaks(docs, { secrets, testKey }) {
  const leaks = [];
  for (const d of docs) {
    const text = d.path + '\n' + JSON.stringify(d.data);
    for (const s of secrets) if (s.length >= 8 && text.includes(s)) leaks.push(`${d.path}: still contains an old code, token or key (${s.slice(0, 2)}…)`);
    for (const m of text.match(PHONE_RE) || []) if (normalizePhone(m) !== testKey) leaks.push(`${d.path}: contains a phone-like number that is not the test number`);
  }
  return leaks;
}

export function transformBackup(rows, { phone = TEST_PHONE, makeCode = randomCode } = {}) {
  const testKey = normalizePhone(phone);
  const secrets = new Set(); const kept = []; const dropped = {}; const codes = [];
  const oldCodes = new Set(rows.filter(r => /^invites\/[^/]+$/.test(r.path)).map(r => r.path.split('/')[1]));
  const used = new Set(oldCodes);
  for (const r of rows) {
    const parts = r.path.split('/'); const data = decodeFields(r.fields);
    if (parts[0] === 'invites' && parts.length === 2) {
      let code; do { code = makeCode(); } while (used.has(code));
      used.add(code); codes.push({ familyId: data.familyId, code });
      kept.push({ path: `invites/${code}`, data: { familyId: data.familyId } });
      continue;
    }
    const why = dropReason(r.path);
    if (why) {
      dropped[why] = (dropped[why] || 0) + 1;
      if (parts[0] === 'calendarTokens' || parts[0] === 'driverCalendarTokens') { if (typeof data.token === 'string') secrets.add(data.token); }
      if (parts[0] === 'pushDevices') for (const k of ['endpoint', 'auth', 'p256dh']) if (typeof data[k] === 'string') secrets.add(data[k]);
      if (parts[0] === 'settings' && parts[1] === 'apiKeys') for (const v of Object.values(data)) if (typeof v === 'string') secrets.add(v);
      continue;
    }
    if (parts[0] === 'families' && parts.length === 2) {
      for (const k of ['parentPhone1', 'parentPhone2']) if (typeof data[k] === 'string' && data[k].trim()) data[k] = phone;
      if (Array.isArray(data.phoneKeys)) data.phoneKeys = data.phoneKeys.map(() => testKey);
    }
    kept.push({ path: r.path, data });
  }
  for (const c of oldCodes) secrets.add(c);
  const counts = {}; for (const d of kept) counts[d.path.split('/')[0]] = (counts[d.path.split('/')[0]] || 0) + 1;
  return { docs: kept, codes, dropped, counts, leaks: findLeaks(kept, { secrets, testKey }) };
}

// The list the coordinator needs to log in as a family: one row per family, new code, test phone number.
export function codesCsv(docs, codes, phone = TEST_PHONE) {
  const fam = Object.fromEntries(docs.filter(d => /^families\/[^/]+$/.test(d.path)).map(d => [d.path.split('/')[1], d.data]));
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [['gezin-id', 'meisje', 'ouder', 'toegangscode', 'telefoon'].map(q).join(',')];
  for (const c of codes) lines.push([c.familyId, fam[c.familyId]?.girlName, fam[c.familyId]?.parentName, c.code, phone].map(q).join(','));
  return lines.join('\n') + '\n';
}

export function assertTestProject(account) {
  if (!account || account.project_id !== TEST_PROJECT) throw new Error(`This key belongs to project "${account && account.project_id}", not to ${TEST_PROJECT}. Refusing to write.`);
}

async function pool(items, fn, size = 5) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// Empties the test database and writes the copy. `fs` is a createFirestore() for az-carpool-test (or a fake in the tests).
export async function seed({ fs, docs }) {
  const existing = [];
  for await (const x of fs.walk()) if (!x.missing) existing.push(x.path);
  await pool(existing, p => fs.deleteDocument(p));
  await pool(docs, d => fs.setDocument(d.path, d.data));
  const after = [];
  for await (const x of fs.walk()) if (!x.missing) after.push(x.path);
  const want = docs.map(d => d.path).sort(), got = after.sort();
  if (want.length !== got.length || want.some((p, i) => p !== got[i])) throw new Error(`After writing, the test database does not hold exactly the expected ${want.length} documents (it has ${got.length}).`);
  return { deleted: existing.length, written: docs.length };
}

async function main() {
  const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
  const backup = arg('--backup'), keyFile = arg('--key'), write = process.argv.includes('--write');
  if (!backup || (write && !keyFile)) { console.error('Usage: npm run seed:test -- --backup backups/firestore-DATE.jsonl.gz [--key backups/test-key.json --write]   (the key is only needed with --write)'); process.exit(1); }
  const account = write ? readServiceAccount(resolve(keyFile)) : null;
  if (write) assertTestProject(account);
  const res = transformBackup(readBackup(resolve(backup)));
  console.log(`Back-up: ${res.docs.length} documents will be copied (${res.codes.length} families with a new code).`);
  console.log('Copied per collection:', Object.entries(res.counts).map(([k, v]) => `${k} ${v}`).join(', '));
  console.log('Left out:', Object.entries(res.dropped).map(([k, v]) => `${v}× ${k}`).join('; ') || 'nothing');
  if (res.leaks.length) { console.error('\nSTOP: the copy still holds things that must not be copied:\n  ' + res.leaks.join('\n  ')); process.exit(1); }
  console.log('Check: no old code, token, key or other phone number is left in the copy.');
  if (!write) { console.log('\nDry run: nothing was written. Add --write to empty the test database and fill it with this copy.'); return; }
  const fs = createFirestore({ projectId: TEST_PROJECT, getToken: tokenProvider({ account }) });
  const r = await seed({ fs, docs: res.docs });
  const out = resolve(arg('--codes') || join(root, 'backups', 'test-toegangscodes.csv'));
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, codesCsv(res.docs, res.codes), { mode: 0o600 });
  console.log(`\nDone: ${r.deleted} old test documents removed, ${r.written} written to ${TEST_PROJECT}.\nCodes per family: ${out}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
