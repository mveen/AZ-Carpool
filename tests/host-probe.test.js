// Run with: node host-probe.test.js
// .github/scripts/probe-host.sh and .github/workflows/host-probe.yml: the probe of the host's wait page is READ-ONLY (it can never upload,
// change or delete anything), only starts by hand, and tells a real file from the wait page.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const script = join(repo, '.github/scripts/probe-host.sh');
const sh = readFileSync(script, 'utf8');
const y = readFileSync(join(repo, '.github/workflows/host-probe.yml'), 'utf8');
const have = spawnSync('sh', ['-c', 'command -v bash']).status === 0;

console.log('=== the workflow ===');
await test('only by hand, read-only token, and only the two deploy secrets (no smoke-test logins)', () => {
  assert.match(y, /on:\s*\n\s*workflow_dispatch:\s*\n/); assert.doesNotMatch(y, /\bpush:|pull_request:|schedule:|workflow_run:/);
  assert.match(y, /permissions:\s*\n\s*contents: read/);
  assert.deepEqual([...new Set([...y.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]))].sort(), ['DEPLOY_KEY', 'DEPLOY_USER']);
});
await test('the server identity is pinned and checked, as in the deploy workflows', () => {
  assert.match(y, /cp \.github\/deploy\/known_hosts/); assert.match(y, /StrictHostKeyChecking=yes/);
  assert.match(y, /SSH_HOST: h70\.mijn\.host/); assert.match(y, /SSH_PORT: '26'/);
});
await test('it probes the test site, never the live one', () => {
  assert.match(y, /SITE_HOST: test\.azcarpool\.nl/); assert.doesNotMatch(y, /SITE_HOST: azcarpool\.nl/);
});

console.log('=== the script is read-only ===');
await test('no upload, copy, delete or write command anywhere in the script or the workflow', () => {
  for (const [name, text] of [['script', sh], ['workflow', y]]) {
    assert.doesNotMatch(text, /\brsync\b|\bscp\b|\bsftp\b|--delete|\brm -rf (?!'\$tmp')|\bmv\b|\bchmod\b.*public_html|public_html/, name);
  }
  // the only things run on the host are: command -v curl, a listing of the listening ports (ss/netstat -ltn), and curl (GET)
  const remote = [...sh.matchAll(/\$SSH_CMD "\$SSH_DEST" ('[^']*'|"[^"]*")/g)].map(m => m[1]);
  assert.equal(remote.length, 5);
  assert.ok(remote.every(c => /command -v curl|curl -sS|\(ss -ltn/.test(c)), remote.join(' | '));
  assert.doesNotMatch(sh, /curl[^\n]*(-X |--request|-d |--data|-T |--upload)/);
});
await test('the script has valid bash syntax, and ends a run with success: it only reports', () => {
  if (!have) return;
  assert.equal(spawnSync('bash', ['-n', script]).status, 0);
  assert.match(sh, /return 0\n\}/);
});

console.log('=== telling the answers apart ===');
const dir = mkdtempSync(join(tmpdir(), 'az-probe-'));
const classify = (content, code = '200') => {
  const f = join(dir, 'f'); writeFileSync(f, content);
  return spawnSync('bash', ['-c', `source "${script}"; classify "${f}" ${code}`], { encoding: 'utf8' }).stdout.trim();
};
if (!have) console.log('  (bash not found: answer tests skipped)');
else {
  await test('the service worker is a REAL-FILE', () => assert.equal(classify("const CACHE_NAME = 'az-carpool-v1';"), 'REAL-FILE'));
  await test('the bot check page of the host is a WAIT-PAGE (also with a 200 answer)', () =>
    assert.equal(classify('<html><body>One moment, please...<script>location.reload()</script></body></html>'), 'WAIT-PAGE'));
  await test('an empty answer and another page are told apart, with the status code', () => {
    assert.equal(classify('', '000'), 'NO-ANSWER(HTTP 000)');
    assert.match(classify('<h1>404 Not Found</h1>', '404'), /^OTHER\(HTTP 404, \d+ bytes\)$/);
  });
  await test('the status code is split off the body, also when the body has line breaks', () => {
    const r = spawnSync('bash', ['-c', `source "${script}"; split_answer $'line1\\nline2\\n[HTTP 200]' "${join(dir, 'b')}"`], { encoding: 'utf8' });
    assert.equal(r.stdout.trim(), '200'); assert.equal(readFileSync(join(dir, 'b'), 'utf8'), 'line1\nline2');
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
