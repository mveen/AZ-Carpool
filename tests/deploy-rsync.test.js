// Run with: node deploy-rsync.test.js
// scripts/deploy-rsync.sh and the deploy workflow: the upload is safe (right folder only, right order, no stray deletes)
// and the workflow only needs the five GitHub secrets. The upload itself is tried on a local folder instead of the real host.
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
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
await test('deploys after a merge to main, never in parallel, with only the deploy secrets (user and key) plus the three smoke-test logins, and the fixed azcarpool.nl folder', () => {
  const y = readFileSync(join(repo, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(y, /push:\s*\n\s*branches: \[main\]/);
  assert.match(y, /workflow_dispatch:/);
  assert.match(y, /cancel-in-progress: false/);
  assert.match(y, /TARGET_DIR: domains\/azcarpool\.nl\/public_html\//);
  assert.deepEqual([...new Set([...y.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]))].sort(), ['DEPLOY_KEY', 'DEPLOY_USER', 'SMOKE_CODE_COORD', 'SMOKE_CODE_PARENT', 'SMOKE_PHONE']);
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

  // The check between the two passes, against a small web server (its own process) that serves the destination folder.
  if (!have('curl')) console.log('  (curl not found: served-files check skipped)');
  else {
    const serverJs = `const http=require('http'),fs=require('fs'),path=require('path');const root=process.argv[1],hide=process.argv[2]||'';
      http.createServer((q,r)=>{const f=decodeURIComponent(q.url.split('?')[0]).replace(/^\\/+/,'');const p=path.join(root,f);
        if((hide&&f===hide)||!fs.existsSync(p)||!fs.statSync(p).isFile()){r.writeHead(404);r.end();return;}r.writeHead(200);r.end(fs.readFileSync(p));})
      .listen(0,'127.0.0.1',function(){console.log(this.address().port);});`;
    const serve = (root, hide = '') => new Promise(res => { const c = spawn(process.execPath, ['-e', serverJs, root, hide], { stdio: ['ignore', 'pipe', 'inherit'] }); c.stdout.once('data', d => res({ port: String(d).trim(), stop: () => c.kill() })); });
    const runChecked = (src, to, port) => spawnSync('bash', [script, src, to], { encoding: 'utf8', env: { ...process.env, DEPLOY_CHECK_SITE: `http://127.0.0.1:${port}/`, DEPLOY_CHECK_TRIES: '2', DEPLOY_CHECK_WAIT: '0', DEPLOY_CHECK_GAP: '0' } });
    const fresh = name => { const d = join(tmp, name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'index.html'), 'previous start page'); return d; };

    await test('with DEPLOY_CHECK_SITE: when the site serves every new file, the start page and service worker follow', async () => {
      const to = fresh('served-ok'); const s = await serve(to);
      try { const r = runChecked(dist, to, s.port); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /all \d+ new files are served/);
        assert.ok(r.stdout.indexOf('== check') > r.stdout.indexOf('== pass 1') && r.stdout.indexOf('== check') < r.stdout.indexOf('== pass 2'));
        assert.equal(readFileSync(join(to, 'index.html'), 'utf8'), readFileSync(join(dist, 'index.html'), 'utf8')); } finally { s.stop(); }
    });
    await test('with DEPLOY_CHECK_SITE: when an uploaded file is not served (404), it stops BEFORE the start page and service worker: the previous version stays', async () => {
      const to = fresh('served-not'); const s = await serve(to, 'firebase-sdk/firebase-app.js');
      try { const r = runChecked(dist, to, s.port); assert.equal(r.status, 1); assert.match(r.stderr, /firebase-sdk\/firebase-app\.js\(404\)/); assert.match(r.stderr, /NOT replaced/);
        assert.ok(existsSync(join(to, 'firebase-sdk/firebase-app.js')), 'the file itself was uploaded');
        assert.equal(readFileSync(join(to, 'index.html'), 'utf8'), 'previous start page'); assert.ok(!existsSync(join(to, 'service-worker.js'))); } finally { s.stop(); }
    });
    await test('with DEPLOY_CHECK_SITE: an upload without new files asks the site nothing (no row of requests at every deploy)', async () => {
      const to = fresh('served-again'); const s = await serve(to);
      try { assert.equal(runChecked(dist, to, s.port).status, 0);
        const r = runChecked(dist, to, s.port); assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /no new files in this upload, nothing to ask the site/); assert.doesNotMatch(r.stdout, /new files are served/); } finally { s.stop(); }
    });
    await test('only files that are new on the host are asked for, one at a time with a pause', () => {
      const sh = readFileSync(script, 'utf8');
      assert.match(sh, /grep -E '\^\[<>\]f\\\+\{9\} '/); assert.match(sh, /sleep "\$gap"/); assert.match(sh, /DEPLOY_CHECK_GAP:-0\.5/);
    });
    await test('when the version check after an upload fails, the workflows show what the site answered instead', () => {
      for (const f of ['deploy.yml', 'deploy-test.yml']) assert.match(readFileSync(join(repo, '.github/workflows', f), 'utf8'), /The site answered: HTTP %\{http_code\}/, f);
    });
    await test('both workflows switch the check on for the website uploads (not for the cron folder)', () => {
      const live = readFileSync(join(repo, '.github/workflows/deploy.yml'), 'utf8'), t = readFileSync(join(repo, '.github/workflows/deploy-test.yml'), 'utf8');
      assert.equal((live.match(/DEPLOY_CHECK_SITE="\$SITE" bash scripts\/deploy-rsync\.sh dist(-test)?\//g) || []).length, 2);
      assert.equal((t.match(/DEPLOY_CHECK_SITE="\$SITE" bash scripts\/deploy-rsync\.sh dist-test\//g) || []).length, 1);
      assert.doesNotMatch(live, /DEPLOY_CHECK_SITE[^\n]*dist-cron/);
    });
  }
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
