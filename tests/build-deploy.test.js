// Run with: node build-deploy.test.js
// scripts/build-deploy.mjs: the folder that goes to the web host is complete, points to the new address only,
// and leaves the source files (and so GitHub Pages) untouched.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeploy, assetList, relativeReferences, inlineScriptHashes, HASH_PLACEHOLDER, SOURCE_SITE } from '../scripts/build-deploy.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'az-deploy-'));
const SITE = 'https://azcarpool.nl/';
const r = buildDeploy({ out: join(tmp, 'dist'), site: SITE });
const read = f => readFileSync(join(tmp, 'dist', f), 'utf8');

console.log('=== the upload folder ===');
await test('contains every file of the ASSETS list, the service worker and the server settings', () => {
  for (const f of assetList(repo)) assert.ok(r.files.includes(f), f);
  for (const f of ['index.html', 'service-worker.js', '.htaccess', 'robots.txt']) assert.ok(r.files.includes(f), f);
});
await test('does not contain tests, docs, repo files or secrets-style files', () => {
  for (const f of r.files) assert.ok(!/^(tests|scripts|firebase|\.github|\.git)\//.test(f) && !/(\.md|\.mjs|\.lock\.json|package\.json)$/.test(f) && f !== 'CLAUDE.md', f);
});
await test('the start page and app point to the new address and not to GitHub Pages', () => {
  assert.ok(read('index.html').includes(SITE + 'app.js'));
  assert.ok(read('index.html').includes(SITE + 'data.js'));
  assert.ok(read('constants.js').includes(`APP_URL = "${SITE}"`));
  assert.ok(read('app.js').includes(SITE + 'service-worker.js'));
  for (const f of r.files) if (/\.(html|js|css|json)$/.test(f)) assert.ok(!read(f).includes(SOURCE_SITE), f);
});
await test('the source files in the repo are not changed (GitHub Pages keeps working); APP_URL, used in the WhatsApp messages, is already the new address', () => {
  assert.ok(readFileSync(join(repo, 'constants.js'), 'utf8').includes(`APP_URL = "${SITE}"`));
  assert.ok(readFileSync(join(repo, 'index.html'), 'utf8').includes(SOURCE_SITE + 'app.js'));
});
await test('binary files are copied byte for byte', () => {
  assert.deepEqual(readFileSync(join(tmp, 'dist', 'icon-192.png')), readFileSync(join(repo, 'icon-192.png')));
  assert.deepEqual(readFileSync(join(tmp, 'dist', 'fonts/onest-latin-400.woff2')), readFileSync(join(repo, 'fonts/onest-latin-400.woff2')));
});

console.log('=== server settings ===');
await test('.htaccess forces https, never caches the app files and the service worker, and keeps the site out of search engines', () => {
  const h = read('.htaccess');
  assert.match(h, /RewriteRule \^ https:\/\/%\{HTTP_HOST\}%\{REQUEST_URI\} \[L,R=301\]/);
  assert.match(h, /FilesMatch "\\\.\(html\|js\|mjs\|css\|json\)\$"[\s\S]*Cache-Control "no-cache"/);
  assert.match(h, /X-Robots-Tag "noindex, nofollow"/);
  assert.match(h, /AddType text\/javascript \.js/);
});

await test('.htaccess sends a Content-Security-Policy that allows only own files, gstatic and the hashed inline scripts', () => {
  const h = read('.htaccess');
  const csp = (h.match(/Content-Security-Policy "([^"]+)"/) || [])[1] || '';
  assert.ok(csp, 'CSP header present');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  const script = (csp.match(/script-src ([^;]+)/) || [])[1] || '';
  assert.ok(!script.includes('unsafe-inline') && !script.includes('unsafe-eval'), 'no unsafe script sources');
  assert.ok(!script.includes('*'), 'no wildcard script source');
  assert.ok(!h.includes(HASH_PLACEHOLDER), 'placeholder filled in');
  assert.match(h, /X-Frame-Options "DENY"/);
  assert.match(h, /Strict-Transport-Security "max-age=\d+"/);
});
await test('every inline script of the built index.html has its hash in the policy, and the hashes are correct', () => {
  const html = read('index.html'), h = read('.htaccess');
  const hashes = inlineScriptHashes(html);
  assert.ok(hashes.length >= 3, 'index.html has at least its three inline scripts');
  for (const x of hashes) assert.ok(h.includes(x), x);
  assert.equal(inlineScriptHashes('<script>a</script><script src="x.js"></script>')[0], "'sha256-ypeBEsobvcr6wjGzmiPcTaeG7/gUfE5yuYB3ha/uSLs='");
});
await test('connect-src names every host the app talks to', () => {
  const csp = read('.htaccess');
  for (const host of ['firestore.googleapis.com', 'identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'www.googleapis.com', 'api.openrouteservice.org']) {
    assert.ok(csp.includes('https://' + host), host);
  }
});

console.log('=== safety checks ===');
await test('a file that is imported but missing from ASSETS makes the build fail with a clear message', () => {
  const fake = join(tmp, 'fake'); mkdirSync(fake, { recursive: true });
  writeFileSync(join(fake, 'service-worker.js'), "const ASSETS = [\n  './',\n  './index.html',\n  './a.js',\n];\n");
  writeFileSync(join(fake, 'index.html'), '<script type="module" src="./a.js"></script>');
  writeFileSync(join(fake, 'a.js'), "import { x } from './b.js';");
  assert.throws(() => buildDeploy({ rootDir: fake, out: join(tmp, 'fake-out'), site: SITE }), /a\.js points to \.\/b\.js/);
});
await test('a file listed in ASSETS that does not exist makes the build fail', () => {
  const fake = join(tmp, 'fake2'); mkdirSync(fake, { recursive: true });
  writeFileSync(join(fake, 'service-worker.js'), "const ASSETS = [\n  './',\n  './index.html',\n  './gone.js',\n];\n");
  writeFileSync(join(fake, 'index.html'), '<p>x</p>');
  assert.throws(() => buildDeploy({ rootDir: fake, out: join(tmp, 'fake2-out'), site: SITE }), /gone\.js/);
});
await test('a site address that is not https://name/ is refused', () => {
  for (const bad of ['http://azcarpool.nl/', 'https://azcarpool.nl', 'azcarpool.nl', 'https://a.nl/sub/'])
    assert.throws(() => buildDeploy({ out: join(tmp, 'bad'), site: bad }), /site must look like/, bad);
});
await test('relativeReferences finds imports, dynamic imports and page links, and ignores absolute addresses', () => {
  assert.deepEqual(relativeReferences('a.js', "import x from './b.js'; import('./c.js'); import y from 'https://x.nl/d.js';").sort(), ['./b.js', './c.js']);
  assert.deepEqual(relativeReferences('index.html', '<link href="./t.css"><script src="https://x.nl/a.js"></script>'), ['./t.css']);
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
