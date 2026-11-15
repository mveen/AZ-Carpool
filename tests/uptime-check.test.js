// Run with: node uptime-check.test.js
// scripts/uptime-check.mjs and .github/workflows/uptime.yml: the hourly, read-only check that the live site is up and complete.
// The site is always a fake here; nothing goes online.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAssets, cacheNameOf, assetUrl, checkSite, SITE } from '../scripts/uptime-check.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const realSw = readFileSync(join(repo, 'service-worker.js'), 'utf8');
const WAIT = '<html><title>One moment, please...</title></html>';

// A fake site: path -> [status, content-type, body]. Anything not listed is a 404.
const fakeSite = (files, { wait = [], boom = [] } = {}) => {
  const hits = [];
  const fetchImpl = async url => {
    const path = url.slice(SITE.length) || '/'; hits.push(path);
    if (boom.includes(path)) throw new Error('connect ECONNREFUSED');
    if (wait.includes(path)) return new Response(WAIT, { status: 200, headers: { 'content-type': 'text/html' } });
    const f = files[path];
    if (!f) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(f[2], { status: f[0], headers: { 'content-type': f[1] } });
  };
  return { fetchImpl, hits };
};
const ASSET_NAMES = Array.from({ length: 12 }, (_, i) => `./file${i}.js`);
const swSource = (v = 'v9') => `const CACHE_NAME = 'az-carpool-${v}';\nconst ASSETS = [\n  './',\n  './index.html',\n${ASSET_NAMES.map(a => `  '${a}',`).join('\n')}\n];\n`;
const fullSite = (over = {}) => ({
  '/service-worker.js': [200, 'text/javascript', swSource()],
  '/': [200, 'text/html', `<script type="module">import "${SITE}/app.js";</script>`],
  '/index.html': [200, 'text/html', '<html></html>'],
  ...Object.fromEntries(ASSET_NAMES.map(a => ['/' + a.slice(2), [200, 'text/javascript', 'export {};']])),
  ...over,
});
const run = (files, opts) => { const s = fakeSite(files, opts); return checkSite({ fetchImpl: s.fetchImpl, sleep: async () => {}, pauseMs: 0 }).then(r => ({ ...r, hits: s.hits })); };

console.log('=== reading the service worker ===');
await test('finds the CACHE_NAME and every file of the REAL service-worker.js ASSETS list', () => {
  const a = parseAssets(realSw);
  assert.ok(a.length > 30, 'files: ' + a.length); assert.ok(a.includes('./') && a.includes('./index.html') && a.includes('./app.js'));
  assert.match(cacheNameOf(realSw), /^az-carpool-v\d+$/);
});
await test('turns an asset into an address of the site, and leaves other sites alone', () => {
  assert.equal(assetUrl(SITE, './'), SITE + '/'); assert.equal(assetUrl(SITE, './app.js'), SITE + '/app.js');
  assert.equal(assetUrl(SITE, 'https://example.org/x.js'), null); assert.equal(assetUrl(SITE, SITE + '/y.js'), SITE + '/y.js');
});

console.log('=== the site is up ===');
await test('a complete site is OK, and every asset was asked for', async () => {
  const r = await run(fullSite()); assert.equal(r.state, 'ok', JSON.stringify(r)); assert.deepEqual(r.problems, []);
  for (const a of ASSET_NAMES) assert.ok(r.hits.includes('/' + a.slice(2)), a);
});
await test('a missing file of the app is a problem, and the file is named', async () => {
  const f = fullSite(); delete f['/file3.js'];
  const r = await run(f); assert.equal(r.state, 'down'); assert.deepEqual(r.problems, ['./file3.js: HTTP 404']);
});
await test('JavaScript served as an HTML page (an error page) is a problem', async () => {
  const r = await run(fullSite({ '/file1.js': [200, 'text/html', '<html>oops</html>'] })); assert.equal(r.state, 'down'); assert.match(r.problems[0], /file1\.js: served as text\/html/);
});
await test('no service worker, or one without a CACHE_NAME or file list, is down', async () => {
  assert.equal((await run({})).state, 'down');
  const r = await run(fullSite({ '/service-worker.js': [200, 'text/javascript', 'nothing here'] })); assert.equal(r.state, 'down'); assert.equal(r.problems.length, 2);
});
await test('a start page that does not point to app.js is a problem', async () => {
  const r = await run(fullSite({ '/': [200, 'text/html', '<html>old</html>'] })); assert.equal(r.state, 'down'); assert.match(r.problems[0], /start page/);
});
await test('a network error on the service worker is down (after trying again)', async () => {
  const r = await run(fullSite(), { boom: ['/service-worker.js'] }); assert.equal(r.state, 'down'); assert.match(r.problems[0], /ECONNREFUSED/);
});

console.log('=== the wait page of the host is not an outage ===');
await test('the wait page on the service worker: inconclusive, nothing else is asked, no problem', async () => {
  const r = await run(fullSite(), { wait: ['/service-worker.js'] }); assert.equal(r.state, 'inconclusive'); assert.deepEqual(r.problems, []); assert.equal(r.hits.filter(h => h !== '/service-worker.js').length, 0);
});
await test('the wait page on some files: those are not checked, the rest is, and a real problem still counts', async () => {
  const a = await run(fullSite(), { wait: ['/file2.js', '/file4.js'] }); assert.equal(a.state, 'inconclusive'); assert.match(a.notes.join(' '), /2 file\(s\)/);
  const f = fullSite(); delete f['/file5.js'];
  const b = await run(f, { wait: ['/file2.js'] }); assert.equal(b.state, 'down'); assert.deepEqual(b.problems, ['./file5.js: HTTP 404']);
});

console.log('=== the workflow ===');
await test('runs every hour and by hand, reads only (no secrets, read permission), and runs this script', () => {
  const y = readFileSync(join(repo, '.github/workflows/uptime.yml'), 'utf8');
  assert.match(y, /schedule:\s*\n\s*- cron: '\d+ \* \* \* \*'/); assert.match(y, /workflow_dispatch:/);
  assert.match(y, /permissions:\s*\n\s*contents: read/); assert.doesNotMatch(y, /secrets\./); assert.match(y, /run: node scripts\/uptime-check\.mjs/);
  assert.doesNotMatch(y, /\bpush:|pull_request:/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
