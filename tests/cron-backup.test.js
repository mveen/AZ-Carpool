// Run with: node cron-backup.test.js
// cron/backup.mjs: the nightly Firestore back-up. Written to a temporary folder from a fake database.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { runBackup, filesToPrune, backupName, dayStamp } from '../cron/backup.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const ROOT = 'projects/az-carpool/databases/(default)/documents';
const fakeDb = (docs, { fail } = {}) => ({ async *walk() {
  for (const [path, fields, missing] of docs) {
    yield { path, missing: !!missing, doc: { name: `${ROOT}/${path}`, fields, createTime: missing ? undefined : 'c', updateTime: missing ? undefined : 'u' } };
    if (fail && path === fail) throw new Error('Firestore went away');
  }
} });
const silent = { log: () => {}, warn: () => {} };
const NOW = Date.parse('2026-10-12T01:30:00Z');   // 03:30 in Amsterdam
const names = a => a.map(([y, m, d]) => `firestore-${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}.jsonl.gz`);

console.log('=== file names ===');
await test('the file is named after the Amsterdam date, also just after midnight there', () => {
  assert.equal(backupName(NOW), 'firestore-2026-10-12.jsonl.gz');
  assert.equal(dayStamp(Date.parse('2026-10-11T22:30:00Z')), '2026-10-12');
});

console.log('=== which back-ups are removed ===');
await test('keeps the newest 30 and the 1st of each month for a year; removes the rest', () => {
  const all = [];
  for (let i = 0; i < 100; i++) { const d = new Date(NOW - i * 86400000); all.push(`firestore-${d.toISOString().slice(0, 10)}.jsonl.gz`); }
  const doomed = filesToPrune(all, NOW);
  const kept = all.filter(n => !doomed.includes(n));
  assert.ok(all.slice(0, 30).every(n => kept.includes(n)), 'the newest 30 stay');
  assert.ok(kept.includes('firestore-2026-09-01.jsonl.gz') && kept.includes('firestore-2026-08-01.jsonl.gz'), 'monthly ones stay');
  assert.equal(kept.length, 32, '30 + the two 1sts that are older');
  assert.ok(doomed.includes('firestore-2026-08-02.jsonl.gz'));
});
await test('a 1st of the month older than a year goes too', () => {
  assert.deepEqual(filesToPrune(names([[2025, 9, 1], [2026, 10, 12]]), NOW, { daily: 1 }), names([[2025, 9, 1]]));
});
await test('files that are not back-ups are never listed (notes, partial files, other names)', () => {
  assert.deepEqual(filesToPrune(['notes.txt', '.tmp-firestore-2026-01-01.jsonl.gz', 'firestore-2026-01-01.jsonl', 'firestore-2026-1-1.jsonl.gz', 'x/firestore-2026-01-02.jsonl.gz'], NOW, { daily: 0 }), []);
});

console.log('=== making a back-up ===');
const docs = [
  ['families/f1', { parentName: { stringValue: 'Jan' } }],
  ['families/f1/notes/n1', { t: { integerValue: '1' } }],
  ['settings/ghost', undefined, true],
  ['settings/matchCache', { partial: { booleanValue: false } }],
];
await test('writes every real document in Firestore\'s own format, readable back, private to the owner', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'az-bk-')), 'backups');
  const r = await runBackup({ firestore: fakeDb(docs), dir, now: NOW, ...silent });
  assert.equal(r.docs, 3);
  const lines = gunzipSync(readFileSync(join(dir, r.name))).toString().trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(lines.map(l => l.path), ['families/f1', 'families/f1/notes/n1', 'settings/matchCache']);
  assert.deepEqual(lines[0], { path: 'families/f1', name: `${ROOT}/families/f1`, fields: { parentName: { stringValue: 'Jan' } }, createTime: 'c', updateTime: 'u' });
  assert.equal(statSync(dir).mode & 0o777, 0o700); assert.equal(statSync(join(dir, r.name)).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir), [r.name], 'no temporary file is left');
});
await test('running twice on one day replaces that day\'s file; old back-ups beyond the limit are removed in the same run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'az-bk-'));
  for (let i = 1; i <= 40; i++) writeFileSync(join(dir, `firestore-2026-${i <= 28 ? '08' : '07'}-${String(i <= 28 ? i : i - 10).padStart(2, '0')}.jsonl.gz`), 'old');
  writeFileSync(join(dir, 'notes.txt'), 'mine');
  await runBackup({ firestore: fakeDb(docs), dir, now: NOW, ...silent });
  const again = await runBackup({ firestore: fakeDb(docs), dir, now: NOW, ...silent });
  const left = readdirSync(dir);
  assert.ok(left.includes('notes.txt') && left.includes(again.name));
  assert.equal(left.filter(n => n.startsWith('firestore-')).length, 30);
  assert.ok(!left.includes('firestore-2026-07-19.jsonl.gz'), 'the oldest are gone');
});
await test('an empty answer from the database is an error: nothing is saved and nothing is deleted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'az-bk-')); writeFileSync(join(dir, 'firestore-2026-10-01.jsonl.gz'), 'precious');
  await assert.rejects(runBackup({ firestore: fakeDb([]), dir, now: NOW, ...silent }), /no documents at all/);
  assert.deepEqual(readdirSync(dir), ['firestore-2026-10-01.jsonl.gz']);
});
await test('a failure halfway leaves the previous back-up and no half file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'az-bk-')); writeFileSync(join(dir, 'firestore-2026-10-11.jsonl.gz'), 'yesterday');
  await assert.rejects(runBackup({ firestore: fakeDb(docs, { fail: 'families/f1/notes/n1' }), dir, now: NOW, ...silent }), /went away/);
  assert.deepEqual(readdirSync(dir), ['firestore-2026-10-11.jsonl.gz']);
  assert.equal(readFileSync(join(dir, 'firestore-2026-10-11.jsonl.gz'), 'utf8'), 'yesterday');
});
await test('the success line says how many documents', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'az-bk-')); const out = [];
  await runBackup({ firestore: fakeDb(docs), dir, now: NOW, log: l => out.push(l), warn: () => {} });
  assert.deepEqual(out, ['Back-up firestore-2026-10-12.jsonl.gz: 3 documents in 2 collections']);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
