// scripts/restore-backup.mjs — puts a back-up file back into a database, document by document, exactly as it was saved.
//
//   node scripts/restore-backup.mjs --backup FILE --key KEYFILE                 dry run: shows what would change, writes nothing
//   node scripts/restore-backup.mjs --backup FILE --key KEYFILE --write         writes the documents that are missing or different
//   ... --write --delete-extra                                                   also removes documents that are NOT in the back-up
//   ... --only families,settings                                                 only these collections (top-level names)
//
// The database is the project of the key file (a service account with the role "Cloud Datastore User"). For the LIVE project
// (az-carpool) a write also needs  --live az-carpool  typed out, so a slip cannot overwrite live.
// FILE is a firestore-YYYY-MM-DD.jsonl.gz as made by cron/backup.mjs (on the host) or scripts/offsite-backup.mjs (on the Mac).
// Documents that are already equal are not written again. After writing, the database is read back and compared.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { readServiceAccount, tokenProvider } from '../cron/lib/google-auth.mjs';
import { createFirestore } from '../cron/lib/firestore-rest.mjs';
import { isMainModule } from '../cron/lib/setup.mjs';

export const LIVE_PROJECT = 'az-carpool';

// The documents of a back-up file: [{ path, fields }]. Fails on a broken line or a path used twice.
export function readBackupFile(file) {
  const text = gunzipSync(readFileSync(file)).toString('utf8');
  const docs = [], seen = new Set();
  text.split('\n').forEach((line, i) => {
    if (!line) return;
    let rec; try { rec = JSON.parse(line); } catch (e) { throw new Error(`Line ${i + 1} of the back-up is not valid JSON`); }
    if (!rec.path || typeof rec.path !== 'string' || rec.path.split('/').length % 2) throw new Error(`Line ${i + 1} of the back-up has no document path`);
    if (seen.has(rec.path)) throw new Error(`The back-up holds ${rec.path} twice`);
    seen.add(rec.path); docs.push({ path: rec.path, fields: rec.fields || {} });
  });
  if (!docs.length) throw new Error('The back-up file holds no documents');
  return docs;
}

// PURE. The same text for the same content, whatever the order of the keys.
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
export const inScope = (path, only) => !only || !only.length || only.includes(path.split('/')[0]);

// PURE. What a restore has to do: write = missing or different, same = already equal, extra = in the database but not in the back-up.
export function planRestore(backupDocs, currentDocs, { only } = {}) {
  const now = new Map(currentDocs.filter(d => inScope(d.path, only)).map(d => [d.path, canonical(d.fields || {})]));
  const write = [], same = [];
  const wanted = new Set();
  for (const d of backupDocs) {
    if (!inScope(d.path, only)) continue;
    wanted.add(d.path);
    if (now.get(d.path) === canonical(d.fields)) same.push(d.path);
    else write.push({ path: d.path, fields: d.fields, isNew: !now.has(d.path) });
  }
  const extra = [...now.keys()].filter(p => !wanted.has(p)).sort();
  return { write, same, extra };
}

async function readAll(fs) {
  const docs = [];
  for await (const x of fs.walk()) if (!x.missing) docs.push({ path: x.path, fields: x.doc.fields || {} });
  return docs;
}
async function pool(items, fn, size = 5) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// `fs` is a createFirestore() (or a fake in the tests). Without `write` nothing is changed.
export async function restore({ fs, docs, write = false, deleteExtra = false, only = [] }) {
  const plan = planRestore(docs, await readAll(fs), { only });
  const result = { toWrite: plan.write.length, created: plan.write.filter(w => w.isNew).length, same: plan.same.length, extra: plan.extra, written: 0, deleted: 0, verified: false };
  if (!write) return result;
  await pool(plan.write, async w => { await fs.setDocumentRaw(w.path, w.fields); result.written++; });
  if (deleteExtra) await pool(plan.extra, async p => { await fs.deleteDocument(p); result.deleted++; });
  const after = planRestore(docs, await readAll(fs), { only });
  if (after.write.length) throw new Error(`After writing, ${after.write.length} documents still differ from the back-up (first: ${after.write[0].path}).`);
  if (deleteExtra && after.extra.length) throw new Error(`After deleting, ${after.extra.length} extra documents are still there (first: ${after.extra[0]}).`);
  result.verified = true;
  return result;
}

// PURE. May this run write? Live needs its project name typed out.
export function checkTarget({ projectId, write, live }) {
  if (!projectId) throw new Error('The key file has no project_id.');
  if (write && projectId === LIVE_PROJECT && live !== LIVE_PROJECT) throw new Error(`This key writes to the LIVE database (${LIVE_PROJECT}). Add  --live ${LIVE_PROJECT}  if that is really what you want.`);
  if (live && live !== projectId) throw new Error(`--live ${live} does not match the project of the key (${projectId}).`);
}

async function main() {
  const has = n => process.argv.includes(n);
  const arg = n => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
  const backup = arg('--backup'), keyFile = arg('--key'), write = has('--write');
  if (!backup || !keyFile) { console.error('Usage: node scripts/restore-backup.mjs --backup FILE --key KEYFILE [--write] [--delete-extra] [--only a,b] [--live az-carpool]'); process.exit(2); }
  const only = (arg('--only') || '').split(',').map(s => s.trim()).filter(Boolean);
  const account = readServiceAccount(resolve(keyFile));
  checkTarget({ projectId: account.project_id, write, live: arg('--live') });
  const docs = readBackupFile(resolve(backup));
  const fs = createFirestore({ projectId: account.project_id, getToken: tokenProvider({ account }) });
  console.log(`Back-up: ${docs.length} documents. Database: ${account.project_id}.` + (only.length ? ` Only: ${only.join(', ')}.` : ''));
  const r = await restore({ fs, docs, write, deleteExtra: has('--delete-extra'), only });
  console.log(`${r.toWrite} to write (${r.created} missing, ${r.toWrite - r.created} different), ${r.same} already equal, ${r.extra.length} in the database but not in the back-up.`);
  if (r.extra.length) console.log('  Not in the back-up: ' + r.extra.slice(0, 10).join(', ') + (r.extra.length > 10 ? `, ... (${r.extra.length - 10} more)` : ''));
  if (!write) { console.log('Dry run: nothing was written. Add --write to apply it.'); return; }
  console.log(`Done: ${r.written} written, ${r.deleted} deleted. Read back and compared: equal to the back-up.`);
}

if (isMainModule(import.meta.url)) main().catch(e => { console.error('RESTORE FAILED: ' + e.message); process.exit(1); });
