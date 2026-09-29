// run-tests.js — `npm test`. Runs every *.test.js in its own process, prints per-file results and a total,
// and enforces the rule "a changed module needs a changed test file" (see README, tests.lock.json).
//
//   npm test            run everything and check the rule
//   npm run lock        after a green run: remember the current module + test versions as the new baseline
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const LOCK = path.join(dir, 'tests.lock.json');
// Files that are tooling, not app modules.
const NOT_MODULES = new Set(['fake-db.js', 'run-tests.js', 'firebase-config.js', 'service-worker.js', 'i18n-codemod.mjs']);
// A module whose tests live in another module's test file.
const TEST_FOR = { 'texts-nl.js': 'i18n.test.js' };

const TESTS = path.join(dir, 'tests');
const files = readdirSync(dir);
const testFiles = readdirSync(TESTS).filter(f => f.endsWith('.test.js')).sort();
const modules = files.filter(f => f.endsWith('.js') && !f.endsWith('.test.js') && !f.startsWith('test-') && !NOT_MODULES.has(f)).sort();
const testOf = m => TEST_FOR[m] || m.replace(/\.js$/, '.test.js');
const hash = f => createHash('sha256').update(readFileSync(path.join(f.endsWith('.test.js') ? TESTS : dir, f))).digest('hex');
const lockNow = () => Object.fromEntries(modules.map(m => [m, { module: hash(m), test: existsSync(path.join(TESTS, testOf(m))) ? hash(testOf(m)) : null }]));

if (process.argv.includes('--lock')) {
  const missing = modules.filter(m => !testFiles.includes(testOf(m)));
  if (missing.length) { console.error('Cannot lock: no test file for', missing.join(', ')); process.exit(1); }
  writeFileSync(LOCK, JSON.stringify(lockNow(), null, 2) + '\n');
  console.log('tests.lock.json updated for', modules.length, 'modules.');
  process.exit(0);
}

let failedFiles = 0, totalPassed = 0, totalFailed = 0;
console.log('Running', testFiles.length, 'test files\n');
for (const f of testFiles) {
  const r = spawnSync(process.execPath, [f], { cwd: TESTS, encoding: 'utf8', env: { ...process.env, TZ: 'Europe/Amsterdam' }, timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/g);
  const last = m ? m[m.length - 1].match(/(\d+) passed, (\d+) failed/) : null;
  const p = last ? +last[1] : 0, x = last ? +last[2] : 0;
  const ok = r.status === 0 && last && x === 0;
  totalPassed += p; totalFailed += x;
  if (!ok) { failedFiles++; if (!last) totalFailed++; }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${f.padEnd(28)} ${last ? `${p} passed, ${x} failed` : 'did not finish (crash or timeout)'}`);
  if (!ok) console.log(out.split('\n').filter(l => /✗|Error|error/.test(l) || l.startsWith('     ')).slice(0, 30).map(l => '      ' + l).join('\n'));
}

// The rule: every module has a test file, and a changed module comes with a changed test file.
console.log('\nRule check: every module change needs a test change');
const problems = [];
const lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : null;
const now = lockNow();
for (const m of modules) {
  if (!testFiles.includes(testOf(m))) { problems.push(`${m}: no test file (${testOf(m)})`); continue; }
  if (!lock) continue;
  const old = lock[m];
  if (!old) continue; // new module: it has a test file, which is what counts
  if (old.module !== now[m].module && old.test === now[m].test) problems.push(`${m} changed, but ${testOf(m)} did not. Add or update a test, then run: npm run lock`);
}
if (!lock) problems.push('tests.lock.json is missing. Run: npm run lock');
if (problems.length) problems.forEach(p => console.log('FAIL  ' + p)); else console.log('PASS  all modules covered');

console.log(`\nTotal: ${totalPassed} passed, ${totalFailed} failed, ${failedFiles} file(s) failing, ${problems.length} rule problem(s)`);
process.exit(failedFiles || problems.length ? 1 : 0);
