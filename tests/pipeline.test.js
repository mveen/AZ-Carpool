// Run with: node pipeline.test.js
// The pipeline itself (.github/, run-tests.js, scripts/run-workflow-lint.sh): what keeps it fast, safe and checked.
// Not the content of the deploy (that is deploy-rsync.test.js, smoke-test.test.js, check-site.test.js and deploy-test-env.test.js).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const read = f => readFileSync(join(repo, f), 'utf8');
const WF = join(repo, '.github/workflows');
const workflows = readdirSync(WF).filter(f => f.endsWith('.yml'));
const actionFiles = ['.github/actions/ssh-setup/action.yml', '.github/actions/playwright/action.yml'];
const job = (y, n) => { const a = y.indexOf(`\n  ${n}:\n`); assert.ok(a >= 0, 'no job ' + n); const rest = y.slice(a + 1); const m = rest.slice(1).search(/\n  [a-z-]+:\n/); return m < 0 ? rest : rest.slice(0, m + 1); };

console.log('=== every action is pinned ===');
await test('every action from outside the repo is pinned to a full commit hash (a tag can be moved, a hash cannot)', () => {
  const all = [...workflows.map(f => read('.github/workflows/' + f)), ...actionFiles.map(read)].join('\n');
  const uses = [...all.matchAll(/^\s*(?:- )?uses: (\S+)/gm)].map(m => m[1]).filter(u => !u.startsWith('./'));
  assert.ok(uses.length >= 10, 'found ' + uses.length);
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, u);
});
await test('every local action that a workflow uses exists', () => {
  for (const f of workflows) for (const m of read('.github/workflows/' + f).matchAll(/uses: (\.\/\.github\/actions\/[\w-]+)/g)) assert.ok(existsSync(join(repo, m[1], 'action.yml')), f + ': ' + m[1]);
});

console.log('=== one SSH setup, one Playwright setup ===');
await test('the deploy key is put in place in ONE action; no workflow writes it by hand', () => {
  const a = read(actionFiles[0]);
  assert.match(a, /cp "\$KNOWN_HOSTS" ~\/\.ssh\/known_hosts/); assert.match(a, /KNOWN_HOSTS: \$\{\{ github\.action_path \}\}\/\.\.\/\.\.\/deploy\/known_hosts/);
  assert.ok(existsSync(join(repo, '.github/deploy/known_hosts'))); assert.match(a, /BEGIN OPENSSH PRIVATE KEY/); assert.match(a, /ssh-keygen -y/); assert.match(a, /chmod 600 ~\/\.ssh\/deploy_key/);
  for (const f of ['deploy.yml', 'deploy-test.yml', 'rollback.yml']) {
    const y = read('.github/workflows/' + f);
    assert.match(y, /uses: \.\/(tools\/)?\.github\/actions\/ssh-setup/, f); assert.doesNotMatch(y, /> ~\/\.ssh\/deploy_key/, f); assert.doesNotMatch(y, /known_hosts ~\/\.ssh/, f);
  }
});
await test('the SSH setup comes before every step that uses the key, in every job that uploads', () => {
  for (const [f, jobs] of [['deploy.yml', ['deploy-test', 'deploy-live']], ['deploy-test.yml', ['deploy']], ['rollback.yml', ['rollback']]]) {
    const y = read('.github/workflows/' + f);
    for (const j of jobs) { const b = job(y, j); assert.ok(b.indexOf('ssh-setup') > 0 && b.indexOf('ssh-setup') < b.indexOf('deploy-rsync.sh '), f + ' ' + j); assert.ok(b.indexOf('ssh-setup') < b.indexOf('check-site.sh'), f + ' ' + j); }
  }
});
await test('the Playwright version is written in one place only, and its browsers are cached', () => {
  const a = read(actionFiles[1]);
  assert.match(a, /actions\/cache@[0-9a-f]{40}/); assert.match(a, /path: ~\/\.cache\/ms-playwright/); const v = (a.match(/playwright@(\d+\.\d+\.\d+)/) || [])[1]; assert.ok(v, 'one exact version'); assert.ok(a.includes('key: playwright-') && new RegExp('key: playwright-.*' + v.replace(/\./g, '\\.')).test(a), 'the cache key carries the same version');
  assert.ok(+v.split('.')[1] >= 61 || +v.split('.')[0] > 1, 'Playwright 1.61 or newer: older ones cannot install browsers on ubuntu 26.04 (ubuntu-latest)');
  for (const f of workflows) assert.doesNotMatch(read('.github/workflows/' + f), /playwright@\d/, f);
});

console.log('=== the gate, and not testing twice ===');
await test('lint is part of the deploy gate: it runs next to the tests, and LIVE waits for tests, lint, the test site and the smoke test', () => {
  const y = read('.github/workflows/deploy.yml');
  assert.match(job(y, 'lint'), /bash scripts\/run-lint\.sh/); assert.doesNotMatch(job(y, 'lint'), /needs:/); assert.doesNotMatch(job(y, 'tests'), /needs:/);
  const live = job(y, 'deploy-live');
  assert.match(live, /needs: \[tests, lint, deploy-test, smoke\]/); assert.match(live, /needs\.tests\.result == 'success'/); assert.match(live, /needs\.lint\.result == 'success'/);
});
await test('the test site chain starts at once (no wait for the tests); nothing that touches live comes before the tests are green', () => {
  const y = read('.github/workflows/deploy.yml');
  assert.doesNotMatch(job(y, 'deploy-test'), /needs:/);
  const beforeLive = y.slice(0, y.indexOf('\n  deploy-live:\n'));
  assert.doesNotMatch(beforeLive.replace(/#[^\n]*/g, ''), /domains\/azcarpool\.nl|RULES_KEY_LIVE|build:deploy\n|azcarpool-cron/);
});
await test('after a merge the tests run once (in deploy.yml), on pull requests in tests.yml: no push trigger in tests.yml', () => {
  const t = read('.github/workflows/tests.yml');
  assert.match(t, /on:\s*\n\s*pull_request:\s*\n/); assert.doesNotMatch(t.replace(/#[^\n]*/g, ''), /\bpush:/);
  assert.match(job(read('.github/workflows/deploy.yml'), 'tests'), /run: npm test/);
});
await test('lint.yml checks the pipeline too: actionlint + shellcheck, pinned to a version and a checksum', () => {
  assert.match(job(read('.github/workflows/lint.yml'), 'workflows'), /bash scripts\/run-workflow-lint\.sh/);
  const s = read('scripts/run-workflow-lint.sh');
  assert.match(s, /^VERSION=\d+\.\d+\.\d+$/m); assert.match(s, /^SHA256=[0-9a-f]{64}\b/m); assert.match(s, /sha256sum -c/); assert.match(s, /shellcheck -S warning/);
});

console.log('=== rollback ===');
await test('rollback: only by hand, needs a ref, same lock as the deploy, only the live folder and the two deploy secrets, no rules, no cron jobs', () => {
  const y = read('.github/workflows/rollback.yml');
  assert.match(y, /on:\s*\n\s*workflow_dispatch:\s*\n\s*inputs:\s*\n\s*ref:/); assert.doesNotMatch(y.replace(/#[^\n]*/g, ''), /\bpush:|pull_request:|schedule:/);
  assert.match(y, /required: true/); assert.match(y, /group: deploy-azcarpool\n\s*cancel-in-progress: false/);
  assert.match(y, /TARGET_DIR: domains\/azcarpool\.nl\/public_html\//); assert.doesNotMatch(y, /test\.azcarpool/);
  assert.deepEqual([...new Set([...y.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]))].sort(), ['DEPLOY_KEY', 'DEPLOY_USER']);
  assert.doesNotMatch(y, /publish-rules|RULES_KEY|build:cron|azcarpool-cron/); assert.match(y, /permissions:\s*\n\s*contents: read/); assert.match(y, /StrictHostKeyChecking=yes/);
});
await test('rollback: the tools come from the running version (tools/), only the app from the chosen ref (src/): an old version needs no knowledge of today\'s pipeline', () => {
  const y = read('.github/workflows/rollback.yml');
  assert.match(y, /uses: actions\/checkout@[0-9a-f]{40} # v\d+\n\s*with:\n\s*path: tools\n/);
  assert.match(y, /uses: actions\/checkout@[0-9a-f]{40} # v\d+\n\s*with:\n\s*ref: \$\{\{ inputs\.ref \}\}\n\s*path: src\n/);
  assert.equal([...y.matchAll(/\$\{\{ inputs\.ref \}\}/g)].length, 1, 'inputs.ref is used once: in the checkout, never in a shell command');
  assert.match(y, /working-directory: src\n\s*run: npm run build:deploy/); assert.match(y, /uses: \.\/tools\/\.github\/actions\/ssh-setup/);
  assert.ok(y.indexOf('npm run build:deploy') < y.indexOf('deploy-rsync.sh src/dist/') && y.indexOf('deploy-rsync.sh src/dist/') < y.indexOf('check-site.sh live "$SITE" src/dist'));
  assert.match(y, /bash tools\/scripts\/deploy-rsync\.sh src\/dist\//); assert.match(y, /bash tools\/\.github\/scripts\/check-site\.sh live/); assert.match(y, /scripts\/build-deploy\.mjs/);
});

console.log('=== run-tests.js ===');
await test('the tests run side by side (TEST_JOBS=1 for one by one), printed in file order', () => {
  const s = read('run-tests.js');
  assert.match(s, /TEST_JOBS/); assert.match(s, /availableParallelism/); assert.match(s, /Math\.min\(4,/); assert.match(s, /Printed in file order/); assert.doesNotMatch(s, /spawnSync\(process\.execPath/);
});
await test('npm run lock refuses to count without rsync (the count would be 9 too low for CI); it stops before running any test', () => {
  const d = mkdtempSync(join(tmpdir(), 'az-rt-')); mkdirSync(join(d, 'tests'));
  copyFileSync(join(repo, 'run-tests.js'), join(d, 'run-tests.js'));
  const r = spawnSync(process.execPath, ['run-tests.js', '--lock'], { cwd: d, encoding: 'utf8', env: { ...process.env, PATH: join(d, 'nothing-here') } });
  assert.equal(r.status, 1); assert.match(r.stderr, /Cannot lock: rsync is not installed/); assert.ok(!existsSync(join(d, 'tests.lock.json')) && !existsSync(join(d, 'test-count.js')));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
