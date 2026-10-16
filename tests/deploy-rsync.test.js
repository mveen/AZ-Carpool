// Run with: node deploy-rsync.test.js
// scripts/deploy-rsync.sh and the deploy workflow: the upload is safe (right folder only, right order, no stray deletes)
// and the workflow only needs the five GitHub secrets. The upload itself is tried on a local folder instead of the real host.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeploy } from '../scripts/build-deploy.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const script = join(repo, 'scripts/deploy-rsync.sh');
const tmp = mkdtempSync(join(tmpdir(), 'az-rsync-'));
const have = c => spawnSync('sh', ['-c', `command -v ${c}`]).status === 0;
const run = (src, dest) => spawnSync('bash', [script, src, dest], { encoding: 'utf8' });

console.log('=== the workflow ===');
await test('deploys after a merge to main, never in parallel, with only the two secrets (user and key) and the fixed azcarpool.nl folder', () => {
  const y = readFileSync(join(repo, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(y, /push:\s*\n\s*branches: \[main\]/);
  assert.match(y, /workflow_dispatch:/);
  assert.match(y, /cancel-in-progress: false/);
  assert.match(y, /TARGET_DIR: domains\/azcarpool\.nl\/public_html\//);
  assert.deepEqual([...new Set([...y.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]))].sort(), ['DEPLOY_KEY', 'DEPLOY_USER']);
});
await test('tests run before the upload, and the server identity is pinned in the repo and checked (no blind trust, no copy-paste secret)', () => {
  const y = readFileSync(join(repo, '.github/workflows/deploy.yml'), 'utf8');
  const kh = readFileSync(join(repo, '.github/deploy/known_hosts'), 'utf8').trim().split('\n');
  assert.equal(kh.length, 1);
  assert.match(kh[0], /^\[h70\.mijn\.host\]:26 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5[A-Za-z0-9+/]{48}$/);
  assert.match(y, /SSH_HOST: h70\.mijn\.host/); assert.match(y, /SSH_PORT: '26'/);
  assert.match(y, /cp \.github\/deploy\/known_hosts/);
  assert.ok(y.indexOf('npm test') < y.indexOf('deploy-rsync.sh'));
  assert.match(y, /StrictHostKeyChecking=yes/);
  assert.match(y, /permissions:\s*\n\s*contents: read/);
});

console.log('=== the upload ===');
if (!have('rsync') || !have('bash')) {
  console.log('  (rsync or bash not found: upload tests skipped)');
} else {
  const dist = join(tmp, 'dist');
  buildDeploy({ out: dist, site: 'https://azcarpool.nl/' });
  const dest = join(tmp, 'public_html');
  mkdirSync(join(dest, '.well-known/acme-challenge'), { recursive: true });
  mkdirSync(join(dest, 'cgi-bin'), { recursive: true });
  writeFileSync(join(dest, 'index.html'), 'placeholder of the host');
  writeFileSync(join(dest, 'stray.js'), 'an old file that is no longer part of the app');
  writeFileSync(join(dest, '.well-known/acme-challenge/token'), 'certificate check');
  writeFileSync(join(dest, 'cgi-bin/keep'), 'x');
  const first = run(dist, dest);

  await test('uploads the whole app, including .htaccess', () => {
    assert.equal(first.status, 0, first.stderr);
    for (const f of ['index.html', 'service-worker.js', 'app.js', '.htaccess', 'fonts/onest-latin-400.woff2']) assert.ok(existsSync(join(dest, f)), f);
    assert.equal(readFileSync(join(dest, 'index.html'), 'utf8'), readFileSync(join(dist, 'index.html'), 'utf8'));
  });
  await test('the start page and the service worker go last', () => {
    const out = first.stdout, p2 = out.indexOf('== pass 2');
    assert.ok(p2 > 0);
    assert.ok(!/ (index\.html|service-worker\.js)$/m.test(out.slice(0, p2)), 'must not be in pass 1');
    assert.ok(/ app\.js$/m.test(out.slice(0, p2)));
    assert.ok(/ service-worker\.js$/m.test(out.slice(p2)));
  });
  await test('removes old app files but keeps .well-known and cgi-bin', () => {
    assert.ok(!existsSync(join(dest, 'stray.js')));
    assert.ok(existsSync(join(dest, '.well-known/acme-challenge/token')));
    assert.ok(existsSync(join(dest, 'cgi-bin/keep')));
  });
  await test('files are readable by the web server (644, folders 755)', () => {
    assert.equal(statSync(join(dest, 'app.js')).mode & 0o777, 0o644);
    assert.equal(statSync(join(dest, 'fonts')).mode & 0o777, 0o755);
  });
  await test('a second upload of the same version changes nothing', () => {
    const again = run(dist, dest);
    assert.equal(again.status, 0, again.stderr);
    assert.ok(!/^[<>ch.*][fdLDS]/m.test(again.stdout.replace(/^==.*$/gm, '').replace(/^\.d\.\.t\.+ .*$/gm, '')), again.stdout);
  });
}

console.log('=== safety ===');
await test('refuses any remote folder other than domains/azcarpool.nl/public_html/ (the account also holds other sites)', () => {
  const dist = join(tmp, 'dist2'); buildDeploy({ out: dist, site: 'https://azcarpool.nl/' });
  for (const bad of ['u@h:watt-getimed/', 'u@h:public_html/', 'u@h:domains/wattgetimed.nl/public_html/', 'u@h:', 'u@h:domains/azcarpool.nl/public_html/../x/', 'u@h:/']) {
    const r = run(dist, bad);
    assert.notEqual(r.status, 0, bad); assert.match(r.stderr, /refusing/, bad);
  }
});
await test('refuses a folder that is not the upload folder', () => {
  const empty = join(tmp, 'empty'); mkdirSync(empty);
  const r = run(empty, join(tmp, 'nowhere'));
  assert.notEqual(r.status, 0); assert.match(r.stderr, /upload folder/);
  assert.ok(!existsSync(join(tmp, 'nowhere')));
});

console.log('=== the cron jobs ===');
import { buildCron } from '../scripts/build-cron.mjs';
const cronDist = join(tmp, 'dist-cron');
buildCron({ out: cronDist });
await test('the cron folder goes to azcarpool-cron/ only (and the website folder still only to public_html/)', () => {
  const ok = run(cronDist, 'kc1@host:azcarpool-cron/'); // fails at ssh, but must pass the guard
  assert.doesNotMatch(ok.stderr, /refusing/);
  for (const bad of ['kc1@host:azcarpool-cron', 'kc1@host:domains/azcarpool.nl/public_html/', 'kc1@host:', 'kc1@host:azcarpool-cron/sub/', 'kc1@host:other/azcarpool-cron/']) {
    const r = run(cronDist, bad);
    if (bad === 'kc1@host:azcarpool-cron') continue;   // a missing trailing slash is added, so this is the same folder
    assert.notEqual(r.status, 0, bad); assert.match(r.stderr, /refusing/, bad);
  }
  const web = join(tmp, 'dist-web'); mkdirSync(web); writeFileSync(join(web, 'index.html'), 'x'); writeFileSync(join(web, 'service-worker.js'), 'x');
  const r = run(web, 'kc1@host:azcarpool-cron/');
  assert.match(r.stderr, /refusing/);
});
if (have('rsync') && have('bash')) {
  await test('uploads the cron code privately (700/600), removes files that are gone, and does not touch other things in the destination folder\'s parent', () => {
    const dest = join(tmp, 'azcarpool-cron'); mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'old-job.mjs'), 'gone'); const secrets = join(tmp, 'azcarpool-secrets'); mkdirSync(secrets); writeFileSync(join(secrets, 'backup-key.json'), 'secret');
    const r = run(cronDist, dest);
    assert.equal(r.status, 0, r.stderr);
    for (const f of ['run.sh', 'backup.mjs', 'match-calendars.mjs', 'selftest.mjs', 'config.json', 'lib/google-auth.mjs', 'lib/firestore-rest.mjs']) assert.ok(existsSync(join(dest, f)), f);
    assert.ok(!existsSync(join(dest, 'old-job.mjs')));
    assert.equal(statSync(join(dest, 'run.sh')).mode & 0o777, 0o600); assert.equal(statSync(join(dest, 'lib')).mode & 0o777, 0o700);
    assert.equal(readFileSync(join(secrets, 'backup-key.json'), 'utf8'), 'secret');
  });
}
await test('the workflow uploads the cron jobs after the website is live and checks the host, without any new secret', () => {
  const y = readFileSync(join(repo, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(y, /npm run build:cron/);
  assert.match(y, /deploy-rsync\.sh dist-cron\/ "\$user@\$SSH_HOST:azcarpool-cron\/"/);
  assert.match(y, /run\.sh selftest/);
  assert.ok(y.indexOf('Check that the new version is live') < y.indexOf('deploy-rsync.sh dist-cron/'));
  assert.ok(y.indexOf('npm test') < y.indexOf('deploy-rsync.sh dist-cron/'));
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
