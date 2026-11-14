// Run with: node offsite-backup.test.js
// scripts/offsite-backup.mjs: the rolling copy of the database on the owner's own computer, and scripts/install-mac-backup.sh that schedules it.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { runOffsite, needsRun, newestBackup, ageDays, staleWarning, appendLog, KEEP, STALE_DAYS, LIVE_PROJECT } from '../scripts/offsite-backup.mjs';
import { filesToPrune } from '../cron/backup.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const NOW = Date.parse('2026-11-14T10:00:00Z');
const DAY = 86400000;
const ROOT = 'projects/az-carpool/databases/(default)/documents';
const fakeDb = (docs, fail) => ({ async *walk() { if (fail) throw new Error(fail); for (const [path, fields] of docs) yield { path, missing: false, doc: { name: `${ROOT}/${path}`, fields, createTime: 'c', updateTime: 'u' } }; } });
const docs = [['families/f1', { parentName: { stringValue: 'Jan' } }], ['settings/app', { n: { integerValue: '1' } }]];
const tmp = () => mkdtempSync(join(tmpdir(), 'az-off-'));

console.log('=== when a copy is made ===');
await test('a copy is needed when today\'s file is not there, and not when it is', () => {
  assert.equal(needsRun([], NOW), true);
  assert.equal(needsRun(['firestore-2026-11-13.jsonl.gz', 'backup.log'], NOW), true);
  assert.equal(needsRun(['firestore-2026-11-14.jsonl.gz'], NOW), false);
});
await test('rolling: only the newest copy is kept (no monthly ones either)', () => {
  assert.deepEqual(KEEP, { daily: 1, monthlyDays: 0 });
  assert.deepEqual(filesToPrune(['firestore-2026-11-14.jsonl.gz', 'firestore-2026-11-13.jsonl.gz', 'firestore-2026-11-01.jsonl.gz', 'backup-key.json'], NOW, KEEP), ['firestore-2026-11-13.jsonl.gz', 'firestore-2026-11-01.jsonl.gz']);
});
await test('the newest copy and its age in days', () => {
  assert.equal(newestBackup(['backup.log', 'firestore-2026-11-10.jsonl.gz', 'firestore-2026-11-12.jsonl.gz']), 'firestore-2026-11-12.jsonl.gz');
  assert.equal(newestBackup(['backup.log']), null);
  assert.equal(ageDays('firestore-2026-11-12.jsonl.gz', NOW), 2);
  assert.equal(ageDays(null, NOW), Infinity);
});
await test('a warning only when there is no copy or the newest is older than the limit', () => {
  assert.equal(STALE_DAYS, 3);
  assert.equal(staleWarning(['firestore-2026-11-11.jsonl.gz'], NOW), '');
  assert.match(staleWarning(['firestore-2026-11-10.jsonl.gz'], NOW), /4 dagen oud/);
  assert.match(staleWarning([], NOW), /nog geen back-up/);
});
await test('the log keeps only its last lines', () => {
  assert.equal(appendLog('', 'a'), 'a\n');
  assert.equal(appendLog('a\nb\n', 'c', 2), 'b\nc\n');
});

console.log('=== one run ===');
await test('makes today\'s copy, private to the owner, removes the older copy and writes a log line', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'firestore-2026-11-12.jsonl.gz'), 'old'); writeFileSync(join(dir, 'backup-key.json'), '{}');
  const r = await runOffsite({ dir, now: NOW, makeFirestore: () => fakeDb(docs) });
  assert.equal(r.status, 'done'); assert.match(r.message, /2 documents/);
  assert.deepEqual(readdirSync(dir).sort(), ['backup-key.json', 'backup.log', 'firestore-2026-11-14.jsonl.gz']);
  const lines = gunzipSync(readFileSync(join(dir, 'firestore-2026-11-14.jsonl.gz'))).toString().trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(lines.map(l => l.path), ['families/f1', 'settings/app']);
  assert.equal(statSync(dir).mode & 0o777, 0o700); assert.equal(statSync(join(dir, 'firestore-2026-11-14.jsonl.gz')).mode & 0o777, 0o600);
  assert.match(readFileSync(join(dir, 'backup.log'), 'utf8'), /Copy made: firestore-2026-11-14/);
});
await test('a second run on the same day does nothing (no database read)', async () => {
  const dir = tmp(); let reads = 0;
  await runOffsite({ dir, now: NOW, makeFirestore: () => fakeDb(docs) });
  const r = await runOffsite({ dir, now: NOW + 3600000, makeFirestore: () => { reads++; return fakeDb(docs); } });
  assert.equal(r.status, 'skipped'); assert.equal(reads, 0);
});
await test('offline: nothing is lost, the old copy stays, the next hour tries again; no warning while the copy is fresh', async () => {
  const dir = tmp(); const warned = [];
  writeFileSync(join(dir, 'firestore-2026-11-13.jsonl.gz'), 'yesterday');
  const r = await runOffsite({ dir, now: NOW, makeFirestore: () => fakeDb(docs, 'network error: fetch failed'), warn: w => warned.push(w) });
  assert.equal(r.status, 'failed'); assert.match(r.message, /network error/);
  assert.deepEqual(readdirSync(dir).sort(), ['backup.log', 'firestore-2026-11-13.jsonl.gz']);
  assert.equal(readFileSync(join(dir, 'firestore-2026-11-13.jsonl.gz'), 'utf8'), 'yesterday');
  assert.deepEqual(warned, []);
  const later = await runOffsite({ dir, now: NOW + 3600000, makeFirestore: () => fakeDb(docs) });
  assert.equal(later.status, 'done'); assert.deepEqual(readdirSync(dir).sort(), ['backup.log', 'firestore-2026-11-14.jsonl.gz']);
});
await test('still failing after days: the owner gets a warning on screen', async () => {
  const dir = tmp(); const warned = [];
  writeFileSync(join(dir, 'firestore-2026-11-09.jsonl.gz'), 'old');
  await runOffsite({ dir, now: NOW, makeFirestore: () => fakeDb(docs, 'HTTP 403'), warn: w => warned.push(w) });
  assert.equal(warned.length, 1); assert.match(warned[0], /5 dagen oud/);
});
await test('a missing key or a key of another project fails with a clear message, without touching the old copy', async () => {
  const dir = tmp(); writeFileSync(join(dir, 'firestore-2026-11-13.jsonl.gz'), 'y');
  const a = await runOffsite({ dir, now: NOW, warn: () => {} });
  assert.equal(a.status, 'failed'); assert.match(a.message, /Cannot read the key file/);
  writeFileSync(join(dir, 'backup-key.json'), JSON.stringify({ type: 'service_account', client_email: 'x@y', private_key: 'k', project_id: 'az-carpool-test' }));
  const b = await runOffsite({ dir, now: NOW, warn: () => {} });
  assert.match(b.message, /not to az-carpool/); assert.equal(LIVE_PROJECT, 'az-carpool');
  assert.ok(readdirSync(dir).includes('firestore-2026-11-13.jsonl.gz'));
});

console.log('=== the installer for the Mac ===');
const sh = readFileSync(join(repo, 'scripts/install-mac-backup.sh'), 'utf8');
await test('copies every file the script imports, so the copy outside the repo can run on its own', () => {
  const imports = f => [...readFileSync(join(repo, f), 'utf8').matchAll(/from '(\.\.?\/[^']+)'/g)].map(m => m[1]);
  for (const i of imports('scripts/offsite-backup.mjs')) { assert.ok(i.startsWith('../cron/'), i); assert.ok(sh.includes('$REPO/' + i.slice(3)), 'installer copies ' + i); }
  for (const i of imports('cron/backup.mjs')) { assert.ok(i.startsWith('./lib/'), i); assert.ok(sh.includes('$REPO/cron/' + i.slice(2)), 'installer copies ' + i); }
  for (const lib of ['google-auth', 'firestore-rest', 'setup']) assert.deepEqual(imports(`cron/lib/${lib}.mjs`), [], lib + ' imports nothing local');
});
await test('schedule: at login and every hour; the folder is outside Documents; nothing is switched on when the first copy fails', () => {
  assert.match(sh, /<key>RunAtLoad<\/key><true\/>/); assert.match(sh, /<key>StartInterval<\/key><integer>3600<\/integer>/);
  assert.match(sh, /DIR="\$\{AZ_OFFSITE_DIR:-\$HOME\/azcarpool-backup\}"/);
  assert.ok(sh.indexOf('launchctl bootstrap') > sh.indexOf('if AZ_OFFSITE_DIR="$DIR" "$NODE"'), 'the schedule starts only after a successful copy');
  assert.match(sh, /--remove/);
});
await test('no user name, password or key in the installer', () => { assert.doesNotMatch(sh, /kc\d{5,}|private_key|BEGIN [A-Z ]*PRIVATE/); });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
