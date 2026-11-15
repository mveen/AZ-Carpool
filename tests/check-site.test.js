// Run with: node check-site.test.js
// .github/scripts/check-site.sh: after an upload, does the site hold the new version? With the host's wait page (bot check) in the way,
// the files are read on the host itself. Run for real with a fake `curl` (the site) and a fake `ssh` (the host).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const script = join(repo, '.github/scripts/check-site.sh');
const WAIT = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<title>One moment, please...</title>\n<script>setTimeout(function(){window.location.reload();},5000)</script>\n';
const CURL = `#!/bin/bash
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift ;; -w|--max-time|-H) shift ;; -s) ;; *) url="$1" ;; esac; shift; done
path="\${url#$FAKE_SITE/}"
n=$(cat "$FAKE_DIR/count" 2>/dev/null || echo 0); echo $((n+1)) > "$FAKE_DIR/count"
if [ "$n" -lt "\${FAKE_WAIT:-0}" ]; then cp "$FAKE_DIR/wait.html" "$out"; printf 'HTTP 200, 12165 bytes, type text/html'; exit 0; fi
if [ -f "$FAKE_DIR/web/$path" ]; then cp "$FAKE_DIR/web/$path" "$out"; case "$path" in *.js) t="\${FAKE_JS_TYPE:-text/javascript}" ;; *) t=text/html ;; esac; printf 'HTTP 200, 10 bytes, type %s' "$t"
else : > "$out"; printf 'HTTP 404, 0 bytes, type text/html'; fi
`;
const SSH = `#!/bin/bash
for a in "$@"; do last="$a"; done
echo "ssh: $last" >> "$FAKE_DIR/ssh.log"
p=$(printf '%s' "$last" | sed -E "s/^cat '(.*)'$/\\1/")
cat "$FAKE_DIR/host/$p"
`;
const files = (site, { version = 'v9', project = 'az-carpool-test', banner = true } = {}) => ({
  'service-worker.js': `const CACHE_NAME = 'az-carpool-${version}';\n`,
  'index.html': `<html>${banner ? '<div class="envBar">TEST</div>' : ''}<script type="module">import { startApp } from "${site}/app.js";</script></html>`,
  'app.js': "import { t } from './i18n.js';\n",
  'firebase-config.js': `export const firebaseConfig = { projectId: "${project}" };\n`,
});
// One situation: what the site serves (web), what is on the host, and how often the wait page comes first.
function setup({ target = 'live', dist = {}, web = {}, host = {}, wait = 0, ssh = true, jsType, waitTries = '3' } = {}) {
  const site = target === 'live' ? 'https://azcarpool.nl' : 'https://test.azcarpool.nl';
  const remote = target === 'live' ? 'domains/azcarpool.nl/public_html' : 'domains/test.azcarpool.nl/public_html';
  const dir = mkdtempSync(join(tmpdir(), 'az-cs-'));
  const put = (sub, set) => { for (const [f, text] of Object.entries(set)) { mkdirSync(join(dir, sub), { recursive: true }); writeFileSync(join(dir, sub, f), text); } };
  const base = files(site, target === 'live' ? { project: 'az-carpool', banner: false } : {});
  put('dist', { ...base, ...dist }); put('web', { ...base, ...web }); put('host/' + remote, { ...base, ...host });
  mkdirSync(join(dir, 'bin')); writeFileSync(join(dir, 'wait.html'), WAIT);
  for (const [n, src] of [['curl', CURL], ['ssh', SSH]]) { writeFileSync(join(dir, 'bin', n), src); chmodSync(join(dir, 'bin', n), 0o755); }
  const env = { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH, FAKE_DIR: dir, FAKE_SITE: site, FAKE_WAIT: String(wait), CHECK_TRIES: '3', CHECK_WAIT: '0', CHECK_WAIT_TRIES: waitTries, REMOTE_DIR: remote + '/' };
  if (ssh) env.SITE_SSH = 'ssh -p 26 user@host'; else delete env.SITE_SSH;
  if (jsType) env.FAKE_JS_TYPE = jsType;
  const r = spawnSync('bash', [script, target, site, join(dir, 'dist')], { encoding: 'utf8', env });
  let curlCalls = 0; try { curlCalls = +readFileSync(join(dir, 'count'), 'utf8'); } catch (e) { /* site not asked */ }
  let sshLog = ''; try { sshLog = readFileSync(join(dir, 'ssh.log'), 'utf8'); } catch (e) { /* ssh not used */ }
  return { ...r, out: r.stdout + r.stderr, sshLog, curlCalls };
}
const old = { 'service-worker.js': "const CACHE_NAME = 'az-carpool-v8';\n" };

console.log('=== the site answers normally ===');
await test('live: the new version is served -> OK, the host is not asked', () => {
  const r = setup(); assert.equal(r.status, 0, r.out);
  assert.match(r.out, /OK: https:\/\/azcarpool\.nl serves CACHE_NAME = 'az-carpool-v9'/); assert.match(r.out, /app\.js: HTTP 200.*javascript/); assert.equal(r.sshLog, '');
});
await test('test site: the new version with the banner and its own database -> OK', () => {
  const r = setup({ target: 'test' }); assert.equal(r.status, 0, r.out); assert.match(r.out, /OK: https:\/\/test\.azcarpool\.nl serves/);
});
await test('an old version on the site fails (after asking again), and shows what the site answered', () => {
  const r = setup({ web: old }); assert.equal(r.status, 1);
  assert.match(r.out, /Attempt 3, live: CACHE_NAME = 'az-carpool-v8'/); assert.match(r.out, /The site answered: HTTP 200/); assert.match(r.out, /does not serve the new service worker/);
});
await test('a missing service worker fails', () => {
  const r = setup({ web: { 'service-worker.js': '' } }); assert.equal(r.status, 1); assert.match(r.out, /live: nothing/);
});
await test('live: app.js not served as JavaScript fails', () => {
  const r = setup({ jsType: 'text/plain' }); assert.equal(r.status, 1); assert.match(r.out, /app\.js is not served as JavaScript/);
});
await test('live: a start page that does not point to the site\'s own app.js fails', () => {
  const r = setup({ web: { 'index.html': '<html>old</html>' } }); assert.equal(r.status, 1); assert.match(r.out, /start page does not point to/);
});
await test('test site: no banner fails; the LIVE database fails', () => {
  const a = setup({ target: 'test', web: files('https://test.azcarpool.nl', { banner: false }) }); assert.equal(a.status, 1); assert.match(a.out, /test banner is missing/);
  const b = setup({ target: 'test', web: files('https://test.azcarpool.nl', { project: 'az-carpool' }) }); assert.equal(b.status, 1); assert.match(b.out, /LIVE database/);
});

console.log('=== the wait page of the host (bot check) ===');
await test('the wait page a few times, then the file: the site is simply asked again, no host needed', () => {
  const r = setup({ wait: 2 }); assert.equal(r.status, 0, r.out);
  assert.match(r.out, /the wait page of the host \(try 2 of 3\)/); assert.match(r.out, /OK: https:\/\/azcarpool\.nl serves/); assert.equal(r.sshLog, '');
});
await test('the wait page every time: the files are read on the host itself, and a good upload passes (with a warning in the log)', () => {
  const r = setup({ wait: 999 }); assert.equal(r.status, 0, r.out);
  assert.match(r.out, /::warning::https:\/\/azcarpool\.nl\/service-worker\.js: the host keeps answering with its wait page/);
  assert.match(r.out, /Attempt 1, live: CACHE_NAME = 'az-carpool-v9' \(read on the host\)/);
  assert.match(r.out, /OK: the host holds CACHE_NAME = 'az-carpool-v9' \(checked on the host itself/);
  assert.deepEqual(r.sshLog.trim().split('\n'), ["ssh: cat 'domains/azcarpool.nl/public_html/service-worker.js'", "ssh: cat 'domains/azcarpool.nl/public_html/index.html'", "ssh: cat 'domains/azcarpool.nl/public_html/app.js'"]);
});
await test('by default the site is asked only twice per file while it answers with the wait page, then the host is read (a deploy no longer waits minutes for it)', () => {
  const r = setup({ wait: 2, waitTries: '' }); assert.equal(r.status, 0, r.out);
  assert.match(r.out, /the wait page of the host \(try 2 of 2\)/); assert.match(r.out, /checked on the host itself/); assert.match(r.sshLog, /service-worker\.js/);
});
await test('once one file had to be read on the host, the other files are asked on the site only once', () => {
  const r = setup({ wait: 999, waitTries: '' }); assert.equal(r.status, 0, r.out);
  assert.equal(r.curlCalls, 4, 'service worker twice, then start page and app.js once each: ' + r.curlCalls);
});
await test('the wait page every time and the host holds the OLD version: fails at once (the upload did not arrive)', () => {
  const r = setup({ wait: 999, host: old }); assert.equal(r.status, 1); assert.match(r.out, /does not serve the new service worker/); assert.doesNotMatch(r.out, /Attempt 2/);
});
await test('the wait page every time on the test site: banner and database are checked on the host too', () => {
  const ok = setup({ target: 'test', wait: 999 }); assert.equal(ok.status, 0, ok.out); assert.match(ok.sshLog, /test\.azcarpool\.nl\/public_html\/firebase-config\.js/);
  const bad = setup({ target: 'test', wait: 999, host: files('https://test.azcarpool.nl', { project: 'az-carpool' }) }); assert.equal(bad.status, 1); assert.match(bad.out, /LIVE database/);
});
await test('the wait page every time and no SSH configured: fails and says why', () => {
  const r = setup({ wait: 999, ssh: false }); assert.equal(r.status, 1); assert.match(r.out, /keeps answering with the wait page of the host/);
});
await test('the wait page itself is never taken for a file of the app', () => {
  const r = setup({ wait: 999, host: { 'app.js': WAIT } }); assert.equal(r.status, 1); assert.match(r.out, /app\.js on the host does not look like the app/);
});

console.log('=== the workflows ===');
await test('all three upload checks use this script with the SSH fallback, for the right site and folder', () => {
  const live = readFileSync(join(repo, '.github/workflows/deploy.yml'), 'utf8'), t = readFileSync(join(repo, '.github/workflows/deploy-test.yml'), 'utf8');
  assert.equal((live.match(/SITE_SSH="ssh -p \$SSH_PORT [^"]*\$user@\$SSH_HOST" REMOTE_DIR="\$TARGET_DIR" bash \.github\/scripts\/check-site\.sh test "\$SITE" dist-test\n/g) || []).length, 1);
  assert.equal((live.match(/REMOTE_DIR="\$TARGET_DIR" bash \.github\/scripts\/check-site\.sh live "\$SITE" dist\n/g) || []).length, 1);
  assert.equal((t.match(/REMOTE_DIR="\$TARGET_DIR" bash \.github\/scripts\/check-site\.sh test "\$SITE" dist-test\n/g) || []).length, 1);
  for (const y of [live, t]) { assert.match(y, /StrictHostKeyChecking=yes/); assert.doesNotMatch(y, /curl -fsS[^\n]*service-worker\.js/, 'no second, unprotected version check'); }
});
await test('the cron jobs are still uploaded after the check (same job, later step)', () => {
  const live = readFileSync(join(repo, '.github/workflows/deploy.yml'), 'utf8');
  assert.ok(live.indexOf('check-site.sh live') < live.indexOf('Upload the cron jobs and check the host'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
