// Run with: node site-tunnel.test.js
// .github/scripts/open-site-tunnel.sh: the robot (smoke test) job reaches the TEST site from inside the host through an SSH forward, with its
// own restricted key. Safe by construction: test site only, never the deploy key, never fails the job, and without the secret nothing changes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const script = join(repo, '.github/scripts/open-site-tunnel.sh');
const sh = readFileSync(script, 'utf8');
const wf = f => readFileSync(join(repo, '.github/workflows', f), 'utf8');
const have = spawnSync('sh', ['-c', 'command -v bash']).status === 0;
const runScript = (args, env = {}) => spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });

console.log('=== the script ===');
await test('it only works for the test site: any other address is refused before anything happens', () => {
  if (!have) return;
  for (const site of ['azcarpool.nl', 'www.azcarpool.nl', 'evil.example', 'test.azcarpool.nl.evil.example']) {
    const r = runScript([site], { TUNNEL_KEY: 'x', SSH_USER: 'u', SSH_HOST: 'h', SSH_PORT: '1' });
    assert.equal(r.status, 2, site); assert.match(r.stdout, /only for test\.azcarpool\.nl/);
  }
});
await test('without the TUNNEL_KEY secret it does nothing and the job goes on (exit 0)', () => {
  if (!have) return;
  const r = runScript(['test.azcarpool.nl']);
  assert.equal(r.status, 0); assert.match(r.stdout, /no TUNNEL_KEY secret/);
});
await test('a key that is not a key is reported and the job goes on, without touching /etc/hosts or starting ssh', () => {
  if (!have) return;
  const r = runScript(['test.azcarpool.nl'], { TUNNEL_KEY: 'not a key', SSH_USER: 'u', SSH_HOST: 'h', SSH_PORT: '1', HOME: '/tmp/az-tunnel-test-home' });
  assert.equal(r.status, 0); assert.match(r.stdout, /TUNNEL_KEY does not start with/);
});
await test('it never uses the deploy key, only forwards to the site itself, and checks the real certificate (no -k)', () => {
  assert.ok(!/DEPLOY_KEY/.test(sh));
  assert.match(sh, /target="\$\{TUNNEL_TARGET:-\$site\}"/);
  assert.match(sh, /-L "127\.0\.0\.1:443:\$target:443"/);
  assert.doesNotMatch(sh, /curl[^\n]*(-k\b|--insecure)/);
  assert.match(sh, /StrictHostKeyChecking=yes/); assert.match(sh, /deploy\/known_hosts/);
  assert.doesNotMatch(sh, /\brsync\b|\bscp\b|\bsftp\b|--delete/);
});
await test('when the tunnel does not work it is taken away again (hosts line, ssh) and the job goes on', () => {
  assert.match(sh, /undo\(\) \{[\s\S]*sed -i[\s\S]*\/etc\/hosts[\s\S]*pkill[\s\S]*exit 0/);
  assert.match(sh, /not the site/);   // a wrong answer (another site, "domain reserved") is not accepted
  assert.equal([...sh.matchAll(/^exit 0$/gm)].length, 1);
  assert.doesNotMatch(sh, /exit 1/);
});
await test('it says in the log what the host answered through the tunnel (real file or wait page): that is the evidence we are waiting for', () => {
  assert.match(sh, /through the tunnel the host answered: its WAIT PAGE/);
  assert.match(sh, /through the tunnel the host answered: the REAL FILE/);
});

console.log('=== the workflows ===');
for (const f of ['deploy.yml', 'deploy-test.yml']) {
  await test(`${f}: the robot job opens the tunnel right before the smoke test, with the restricted key and never the deploy key`, () => {
    const t = wf(f); assert.ok(t.includes('\n  smoke:\n'));
    const j = t.slice(t.indexOf('\n  smoke:\n') + 1).split(/\n  [a-z-]+:\n/)[0];   // the smoke job only
    const a = j.indexOf('open-site-tunnel.sh test.azcarpool.nl'), b = j.indexOf('node scripts/smoke-test.mjs');
    assert.ok(a > 0 && a < b, 'tunnel before the smoke test');
    assert.ok(j.indexOf('playwright install') < a, 'browsers installed first');
    assert.match(j, /TUNNEL_KEY: \$\{\{ secrets\.TUNNEL_KEY \}\}/);
    assert.ok(!/DEPLOY_KEY/.test(j));
    assert.match(j, /SSH_HOST: h70\.mijn\.host/); assert.match(j, /SSH_PORT: '26'/);
  });
}
await test('the live job never gets the tunnel key', () => {
  const t = wf('deploy.yml'); const live = t.slice(t.indexOf('\n  deploy-live:\n'));
  assert.ok(!/TUNNEL_KEY|open-site-tunnel/.test(live));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
