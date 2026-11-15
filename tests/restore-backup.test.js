// Run with: node restore-backup.test.js
// scripts/restore-backup.mjs: puts a back-up file back into a database. Tested against a fake database; the real proof against
// the test project az-carpool-test is described in docs/functies/back-up-en-terugzetten.md.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { readBackupFile, canonical, planRestore, restore, checkTarget, inScope, LIVE_PROJECT } from '../scripts/restore-backup.mjs';
import { runBackup } from '../cron/backup.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const S = v => ({ stringValue: v }), I = v => ({ integerValue: String(v) });
// A fake database: a Map path -> fields, with the calls the restore uses.
function fakeDb(initial, { failWrite } = {}) {
  const data = new Map(Object.entries(initial)); const calls = { set: [], del: [] };
  return { data, calls,
    async *walk() { for (const [path, fields] of [...data]) yield { path, missing: false, doc: { name: 'projects/p/databases/(default)/documents/' + path, fields, createTime: 'c', updateTime: 'u' } }; },
    async setDocumentRaw(p, f) { calls.set.push(p); if (failWrite !== p) data.set(p, JSON.parse(JSON.stringify(f))); },
    async deleteDocument(p) { calls.del.push(p); data.delete(p); return true; } };
}
const file = lines => { const f = join(mkdtempSync(join(tmpdir(), 'az-rs-')), 'firestore-2026-11-14.jsonl.gz'); writeFileSync(f, gzipSync(lines.map(l => typeof l === 'string' ? l : JSON.stringify(l)).join('\n') + '\n')); return f; };
const backup = [{ path: 'families/f1', fields: { name: S('Jan'), seats: I(4) } }, { path: 'families/f1/notes/n1', fields: { t: { timestampValue: '2026-11-01T10:00:00Z' } } }, { path: 'settings/app', fields: {} }];

console.log('=== reading a back-up file ===');
await test('reads every document; a document without fields is an empty document', () => {
  const docs = readBackupFile(file([{ path: 'a/1', name: 'x', fields: { n: I(1) }, createTime: 'c' }, { path: 'a/2' }]));
  assert.deepEqual(docs, [{ path: 'a/1', fields: { n: I(1) } }, { path: 'a/2', fields: {} }]);
});
await test('refuses a broken line, a line without a document path, a double path and an empty file', () => {
  assert.throws(() => readBackupFile(file(['{not json'])), /Line 1 .* not valid JSON/);
  assert.throws(() => readBackupFile(file([{ fields: {} }])), /no document path/);
  assert.throws(() => readBackupFile(file([{ path: 'families' }])), /no document path/);
  assert.throws(() => readBackupFile(file([{ path: 'a/1' }, { path: 'a/1' }])), /twice/);
  assert.throws(() => readBackupFile(file([''])), /no documents/);
});
await test('reads the file that the back-up job itself writes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'az-rs-'));
  const db = fakeDb({ 'families/f1': { name: S('Jan') }, 'settings/app': { n: I(2) } });
  const r = await runBackup({ firestore: db, dir, log: () => {}, warn: () => {} });
  assert.deepEqual(readBackupFile(join(dir, r.name)), [{ path: 'families/f1', fields: { name: S('Jan') } }, { path: 'settings/app', fields: { n: I(2) } }]);
});

console.log('=== what a restore would do ===');
await test('the order of the keys does not matter, the values do', () => {
  assert.equal(canonical({ a: I(1), b: { mapValue: { fields: { y: S('1'), x: S('2') } } } }), canonical({ b: { mapValue: { fields: { x: S('2'), y: S('1') } } }, a: I(1) }));
  assert.notEqual(canonical({ a: I(1) }), canonical({ a: { doubleValue: 1 } }));
  assert.notEqual(canonical({ a: { arrayValue: { values: [I(1), I(2)] } } }), canonical({ a: { arrayValue: { values: [I(2), I(1)] } } }));
});
await test('missing and different documents are written, equal ones are not, documents only in the database are listed', () => {
  const now = [{ path: 'families/f1', fields: { seats: I(4), name: S('Jan') } }, { path: 'families/f1/notes/n1', fields: { t: { timestampValue: '2026-11-02T10:00:00Z' } } }, { path: 'links/x', fields: {} }];
  const p = planRestore(backup, now);
  assert.deepEqual(p.same, ['families/f1']);
  assert.deepEqual(p.write.map(w => [w.path, w.isNew]), [['families/f1/notes/n1', false], ['settings/app', true]]);
  assert.deepEqual(p.extra, ['links/x']);
});
await test('--only limits everything to the named collections', () => {
  assert.ok(inScope('families/f1/notes/n1', ['families'])); assert.ok(!inScope('settings/app', ['families'])); assert.ok(inScope('settings/app', []));
  const p = planRestore(backup, [{ path: 'links/x', fields: {} }, { path: 'families/old', fields: {} }], { only: ['families'] });
  assert.deepEqual(p.write.map(w => w.path), ['families/f1', 'families/f1/notes/n1']); assert.deepEqual(p.extra, ['families/old']);
});

console.log('=== restoring ===');
await test('a dry run changes nothing', async () => {
  const db = fakeDb({ 'families/f1': { name: S('Piet') } });
  const r = await restore({ fs: db, docs: backup });
  assert.deepEqual([r.toWrite, r.created, r.same, r.written, r.verified], [3, 2, 0, 0, false]);
  assert.deepEqual(db.calls, { set: [], del: [] }); assert.deepEqual(db.data.get('families/f1'), { name: S('Piet') });
});
await test('with write: the database holds every document exactly as in the back-up; equal documents are not written; extra ones stay', async () => {
  const db = fakeDb({ 'families/f1': { name: S('Piet') }, 'settings/app': {}, 'links/x': { a: I(1) } });
  const r = await restore({ fs: db, docs: backup, write: true });
  assert.deepEqual(db.calls.set.sort(), ['families/f1', 'families/f1/notes/n1']); assert.deepEqual(db.calls.del, []);
  for (const d of backup) assert.deepEqual(db.data.get(d.path), d.fields, d.path);
  assert.deepEqual(db.data.get('families/f1/notes/n1'), { t: { timestampValue: '2026-11-01T10:00:00Z' } }, 'a timestamp stays a timestamp');
  assert.ok(db.data.has('links/x')); assert.deepEqual(r.extra, ['links/x']);
  assert.deepEqual([r.written, r.deleted, r.verified], [2, 0, true]);
});
await test('with delete-extra the database ends up holding exactly the back-up', async () => {
  const db = fakeDb({ 'links/x': { a: I(1) }, 'families/f1': backup[0].fields });
  const r = await restore({ fs: db, docs: backup, write: true, deleteExtra: true });
  assert.deepEqual([...db.data.keys()].sort(), backup.map(d => d.path).sort()); assert.equal(r.deleted, 1);
});
await test('restoring twice writes nothing the second time', async () => {
  const db = fakeDb({});
  await restore({ fs: db, docs: backup, write: true });
  const r = await restore({ fs: db, docs: backup, write: true });
  assert.equal(r.written, 0); assert.equal(r.same, 3);
});
await test('a write that did not arrive is noticed: the run fails instead of saying done', async () => {
  const db = fakeDb({}, { failWrite: 'settings/app' });
  await assert.rejects(restore({ fs: db, docs: backup, write: true }), /1 documents still differ .*settings\/app/);
});

console.log('=== which database ===');
await test('test database: writing is allowed; live: only with its name typed out; a wrong name is refused', () => {
  assert.equal(LIVE_PROJECT, 'az-carpool');
  checkTarget({ projectId: 'az-carpool-test', write: true });
  checkTarget({ projectId: 'az-carpool', write: false });
  assert.throws(() => checkTarget({ projectId: 'az-carpool', write: true }), /LIVE database/);
  checkTarget({ projectId: 'az-carpool', write: true, live: 'az-carpool' });
  assert.throws(() => checkTarget({ projectId: 'az-carpool-test', write: true, live: 'az-carpool' }), /does not match/);
  assert.throws(() => checkTarget({ write: true }), /no project_id/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
