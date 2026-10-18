// Run with: node deploy-test-env.test.js
// The test environment (test.azcarpool.nl): a test build has its own database, is recognisable as test, never mentions the
// live address, and can only be uploaded to the test folder (and a live build only to the live folder).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeploy, readTestConfig, TEST_SITE, DEFAULT_SITE, SOURCE_SITE, TEST_BANNER_TEXT, inlineScriptHashes } from '../scripts/build-deploy.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'az-testenv-'));
const config = (project = 'az-carpool-test') => `export const firebaseConfig = {\n  apiKey: "k",\n  authDomain: "${project}.firebaseapp.com",\n  projectId: "${project}",\n  storageBucket: "${project}.firebasestorage.app",\n  messagingSenderId: "1",\n  appId: "1:1:web:1",\n};\nexport const googleCalendarApiKey = "cal";\n`;
const cfgFile = join(tmp, 'firebase-config.js'); writeFileSync(cfgFile, config());
const out = join(tmp, 'dist-test');
const r = buildDeploy({ env: 'test', out, testConfigFile: cfgFile });
const read = f => readFileSync(join(out, f), 'utf8');
const have = c => spawnSync('sh', ['-c', `command -v ${c}`]).status === 0;
const script = join(repo, 'scripts/deploy-rsync.sh');
const run = (src, dest) => spawnSync('bash', [script, src, dest], { encoding: 'utf8' });

console.log('=== the test build ===');
await test('is made for the test address by default and says it is a test build', () => {
  assert.equal(r.site, TEST_SITE); assert.equal(r.env, 'test');
  assert.equal(read('.deploy-target').trim(), 'test');
});
await test('uses the test database config, not the live one', () => {
  assert.match(read('firebase-config.js'), /projectId: "az-carpool-test"/);
  for (const f of r.files) if (/\.(html|js|json)$/.test(f)) assert.ok(!/projectId:\s*"az-carpool"/.test(read(f)), f);
  assert.match(readFileSync(join(repo, 'firebase-config.js'), 'utf8'), /projectId: "az-carpool"/, 'the live config in the repo is untouched');
});
await test('no file mentions the live address or GitHub Pages; the app and its links point to the test site', () => {
  for (const f of r.files) if (/\.(html|js|css|json)$/.test(f)) { const t = read(f); assert.ok(!t.includes(DEFAULT_SITE), f); assert.ok(!t.includes(SOURCE_SITE), f); }
  assert.ok(read('index.html').includes(TEST_SITE + 'app.js'));
  assert.ok(read('constants.js').includes(`APP_URL = "${TEST_SITE}"`));
});
await test('every page shows the test banner, the tab title says TEST, and the installed app has another name', () => {
  const h = read('index.html');
  assert.ok(h.includes(`<div id="topbar">\n<div class="envBar" role="note">${TEST_BANNER_TEXT}</div>`));
  assert.match(h, /<title>TEST – AZ Carpool Aalsmeer<\/title>/);
  assert.equal(JSON.parse(read('manifest.json')).name, 'AZ Carpool TEST');
});
await test('the Content-Security-Policy still matches the inline scripts (the banner adds only a style, no script)', () => {
  const hashes = inlineScriptHashes(read('index.html'));
  assert.ok(hashes.length >= 1);
  for (const h of hashes) assert.ok(read('.htaccess').includes(h), h);
});
await test('is complete: everything it points to is in the folder (same check as the live build)', () => {
  assert.ok(['index.html', 'service-worker.js', 'app.js', '.htaccess', 'robots.txt', 'firebase-config.js'].every(f => r.files.includes(f)));
});

console.log('=== a live build is not changed by any of this ===');
await test('the live build has the live database, no banner and says live', () => {
  const live = buildDeploy({ out: join(tmp, 'dist-live') });
  const l = f => readFileSync(join(tmp, 'dist-live', f), 'utf8');
  assert.equal(l('.deploy-target').trim(), 'live');
  assert.match(l('firebase-config.js'), /projectId: "az-carpool"/);
  assert.ok(!l('index.html').includes('envBar'));
  assert.ok(l('index.html').includes('<title>AZ Carpool Aalsmeer</title>'));
  assert.equal(live.site, DEFAULT_SITE);
});

console.log('=== safety ===');
await test('refuses a test config that is not filled in, that has no project, or that is the live project', () => {
  const f = join(tmp, 'bad.js');
  writeFileSync(f, config().replace('"k"', '"VUL-IN"')); assert.throws(() => readTestConfig(f), /not filled in/);
  writeFileSync(f, 'export const firebaseConfig = {};'); assert.throws(() => readTestConfig(f), /no projectId/);
  writeFileSync(f, config('az-carpool')); assert.throws(() => readTestConfig(f), /LIVE Firebase project/);
  assert.throws(() => readTestConfig(join(tmp, 'missing.js')), /not found/);
});
await test('refuses to build a test version for the live address, or an unknown environment', () => {
  assert.throws(() => buildDeploy({ env: 'test', out: join(tmp, 'x'), site: DEFAULT_SITE, testConfigFile: cfgFile }), /live address/);
  assert.throws(() => buildDeploy({ env: 'staging', out: join(tmp, 'y') }), /env must be/);
});
await test('the config in the repo for the test site is never the live project (it may still say VUL-IN until it is filled in)', () => {
  const t = readFileSync(join(repo, 'deploy/test/firebase-config.js'), 'utf8');
  assert.ok(!/projectId:\s*"az-carpool"/.test(t));
});
if (have('rsync') && have('bash')) {
  await test('a test build can only go to domains/test.azcarpool.nl/public_html/, a live build only to domains/azcarpool.nl/public_html/', () => {
    const live = join(tmp, 'dist-live');
    for (const bad of ['u@h:domains/azcarpool.nl/public_html/', 'u@h:domains/test.azcarpool.nl/', 'u@h:domains/wattgetimed.nl/public_html/', 'u@h:domains/test.azcarpool.nl/public_html/../x/']) {
      const x = run(out, bad); assert.notEqual(x.status, 0, bad); assert.match(x.stderr, /refusing/, bad);
    }
    const x = run(live, 'u@h:domains/test.azcarpool.nl/public_html/'); assert.notEqual(x.status, 0); assert.match(x.stderr, /refusing/);
    const ok = run(out, 'u@h:domains/test.azcarpool.nl/public_html/');   // fails at ssh, but must pass the guard
    assert.doesNotMatch(ok.stderr, /refusing/);
  });
  await test('uploads the test site to a local folder without the marker file, and a second run changes nothing', () => {
    const dest = join(tmp, 'public_html'); mkdirSync(dest);
    const a = run(out, dest); assert.equal(a.status, 0, a.stderr);
    assert.ok(existsSync(join(dest, 'index.html')) && existsSync(join(dest, '.htaccess')));
    assert.ok(!existsSync(join(dest, '.deploy-target')));
    const b = run(out, dest); assert.equal(b.status, 0, b.stderr);
    assert.ok(!/^[<>ch.*][fdLDS]/m.test(b.stdout.replace(/^==.*$/gm, '').replace(/^\.d\.\.t\.+ .*$/gm, '')), b.stdout);
  });
  await test('a marker with an unknown value is refused', () => {
    const odd = join(tmp, 'odd'); buildDeploy({ env: 'test', out: odd, testConfigFile: cfgFile });
    writeFileSync(join(odd, '.deploy-target'), 'prod\n');
    const x = run(odd, 'u@h:domains/azcarpool.nl/public_html/'); assert.notEqual(x.status, 0); assert.match(x.stderr, /expected live or test/);
  });
}

console.log('=== the workflow ===');
await test('runs only by hand, builds the test version, uploads only to the test folder with the same two secrets, and checks that the live database is not used', () => {
  const y = readFileSync(join(repo, '.github/workflows/deploy-test.yml'), 'utf8');
  assert.match(y, /on:\s*\n\s*workflow_dispatch:\s*\n/); assert.doesNotMatch(y, /\bpush:|pull_request:|schedule:/);
  assert.match(y, /TARGET_DIR: domains\/test\.azcarpool\.nl\/public_html\//); assert.match(y, /SITE: https:\/\/test\.azcarpool\.nl/);
  assert.match(y, /npm run build:deploy:test/); assert.match(y, /deploy-rsync\.sh dist-test\//);
  assert.doesNotMatch(y, /domains\/azcarpool\.nl/); assert.doesNotMatch(y, /azcarpool-cron/);
  assert.deepEqual([...new Set([...y.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]))].sort(), ['DEPLOY_KEY', 'DEPLOY_USER']);
  assert.ok(y.indexOf('npm test') < y.indexOf('deploy-rsync.sh'));
  assert.match(y, /StrictHostKeyChecking=yes/); assert.match(y, /permissions:\s*\n\s*contents: read/);
  assert.match(y, /LIVE database/);
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
