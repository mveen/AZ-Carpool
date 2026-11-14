// Run with: node deploy-retry.test.js
// scripts/should-retry-deploy.mjs and .github/workflows/deploy-retry.yml: a deploy that failed on the wait page of mijn.host is restarted
// once on another GitHub computer; a real failure (tests, build, secrets) is never restarted.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldRetry, HOST_STEPS } from '../scripts/should-retry-deploy.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const step = (name, conclusion) => ({ name, conclusion });
const run = (...steps) => ({ jobs: [{ steps }] });

console.log('=== the decision ===');
await test('the real failure of 2026-11-14 (check after the live upload got the wait page) is restarted', () => {
  assert.equal(shouldRetry(run(step('Upload to mijn.host', 'success'), step('Check that the new version is live', 'failure'), step('Upload the cron jobs and check the host', 'skipped'))), true);
});
await test('every step that talks to the host in both deploy workflows is recognised', () => {
  for (const f of ['deploy.yml', 'deploy-test.yml']) {
    const y = readFileSync(join(repo, '.github/workflows', f), 'utf8');
    const names = [...y.matchAll(/^ {6}- name: (.+)$/gm)].map(m => m[1].trim());
    const host = names.filter(n => HOST_STEPS.test(n));
    assert.ok(host.length >= 3, f + ' has host steps');
    for (const n of names.filter(n => /^(Run tests|Build|Check that the secrets|Run actions|Install)/.test(n))) assert.ok(!HOST_STEPS.test(n), n);
  }
  const live = readFileSync(join(repo, '.github/workflows/deploy.yml'), 'utf8');
  for (const n of ['Upload to the test site', 'Check that the new version is on the test site', 'Upload to mijn.host', 'Check that the new version is live', 'Upload the cron jobs and check the host']) {
    assert.ok(live.includes('- name: ' + n), n + ' still exists in deploy.yml'); assert.ok(HOST_STEPS.test(n), n);
  }
  const t = readFileSync(join(repo, '.github/workflows/deploy-test.yml'), 'utf8');
  for (const n of ['Upload to mijn.host (test folder only)', 'Check that the test version is live, with the test database', 'Smoke test the test site (coordinator and parent)']) {
    assert.ok(t.includes('- name: ' + n), n + ' still exists in deploy-test.yml'); assert.ok(HOST_STEPS.test(n), n);
  }
});
await test('the smoke test being blocked is restarted too', () => {
  assert.equal(shouldRetry(run(step('Smoke test the test site (coordinator and parent)', 'failure'))), true);
});
await test('failing tests, build or missing secrets are never restarted', () => {
  assert.equal(shouldRetry(run(step('Run tests (never upload a broken app)', 'failure'))), false);
  assert.equal(shouldRetry(run(step('Build the upload folder', 'failure'))), false);
  assert.equal(shouldRetry(run(step('Check that the secrets are set', 'failure'))), false);
});
await test('one real failure next to a host failure means no restart', () => {
  assert.equal(shouldRetry({ jobs: [{ steps: [step('Run tests', 'failure')] }, { steps: [step('Check that the new version is live', 'failure')] }] }), false);
});
await test('no failed step (cancelled, setup broke) or strange input: no restart', () => {
  assert.equal(shouldRetry(run(step('Upload to mijn.host', 'cancelled'))), false);
  assert.equal(shouldRetry({}), false); assert.equal(shouldRetry(null), false); assert.equal(shouldRetry({ jobs: [{}] }), false);
});
await test('the script answers retry or skip on stdin', () => {
  const script = join(repo, 'scripts/should-retry-deploy.mjs');
  const ask = input => spawnSync(process.execPath, [script], { input, encoding: 'utf8' }).stdout.trim();
  assert.equal(ask(JSON.stringify(run(step('Check that the new version is live', 'failure')))), 'retry');
  assert.equal(ask(JSON.stringify(run(step('Run tests', 'failure')))), 'skip');
  assert.equal(ask('not json'), 'skip');
});

console.log('=== the workflow ===');
const y = readFileSync(join(repo, '.github/workflows/deploy-retry.yml'), 'utf8');
await test('it watches exactly the two deploy workflows, by their names', () => {
  assert.match(y, /workflow_run:\s*\n\s*workflows: \['Deploy azcarpool\.nl', 'Deploy test\.azcarpool\.nl'\]\s*\n\s*types: \[completed\]/);
  assert.match(readFileSync(join(repo, '.github/workflows/deploy.yml'), 'utf8'), /^name: Deploy azcarpool\.nl$/m);
  assert.match(readFileSync(join(repo, '.github/workflows/deploy-test.yml'), 'utf8'), /^name: Deploy test\.azcarpool\.nl$/m);
});
await test('it restarts only a failed first attempt, only the failed jobs, after a pause (never a loop)', () => {
  assert.match(y, /conclusion == 'failure'/);
  assert.match(y, /run_attempt == 1/);
  assert.match(y, /gh run rerun "\$RUN_ID" --failed/);
  assert.match(y, /sleep 90/);
  assert.match(y, /answer == 'retry'/);
});
await test('it gets no secrets: only the built-in token, and it never runs code from the failed run', () => {
  assert.deepEqual([...new Set([...y.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]))], []);
  assert.match(y, /permissions:\s*\n\s*actions: write\s*\n\s*contents: read/);
  assert.doesNotMatch(y, /head_branch|head_sha|workflow_run\.head/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
