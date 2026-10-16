// Run with: node build-cron.test.js
// scripts/build-cron.mjs and cron/run.sh: the folder for the host is complete and holds no secrets, and run.sh finds a
// suitable Node.js, runs the right job and refuses anything else.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCron, cronConfig, CRON_REFERER } from '../scripts/build-cron.mjs';
import { APP_MODULES } from '../cron/purge.mjs';
import { AGENDA_APP_MODULES } from '../cron/agenda.mjs';
import { PUSH_APP_MODULES } from '../cron/push.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'az-cron-'));
const out = join(tmp, 'dist-cron');
const r = buildCron({ out });
const bash = spawnSync('sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const runSh = (args, env = {}) => spawnSync(bash, [join(out, 'run.sh'), ...args], { encoding: 'utf8', env: { ...env } });

console.log('=== the cron folder ===');
await test('holds the jobs, the helpers, the few app modules the purge, agenda and push jobs reuse and config.json, and nothing else', () => {
  const own = r.files.filter(f => !f.startsWith('app/'));
  assert.deepEqual(own, ['agenda.mjs', 'backup.mjs', 'config.json', 'lib/firestore-rest.mjs', 'lib/google-auth.mjs', 'lib/setup.mjs', 'lib/webpush.mjs', 'match-calendars.mjs', 'package.json', 'purge.mjs', 'push.mjs', 'run.sh', 'selftest.mjs']);
  // the app code the purge, agenda and push jobs reuse: only what rides.js, calendar-feed.js and push.js need, no screens, no database code
  assert.deepEqual(r.files.filter(f => f.startsWith('app/')).sort(), ['app/calendar-feed.js', 'app/constants.js', 'app/dates.js', 'app/escape.js', 'app/i18n.js', 'app/locations.js', 'app/notif-text.js', 'app/ov.js', 'app/period.js', 'app/planning.js', 'app/push.js', 'app/ride-log.js', 'app/rides.js', 'app/ritbeurs.js', 'app/state.js', 'app/texts-nl.js']);
});
await test('config.json carries the public values from firebase-config.js (project, Calendar key, the website as Referer)', () => {
  const c = JSON.parse(readFileSync(join(out, 'config.json'), 'utf8'));
  assert.deepEqual(c, cronConfig(repo)); assert.equal(c.projectId, 'az-carpool'); assert.match(c.calendarApiKey, /^AIza/); assert.equal(c.referer, CRON_REFERER);
  assert.equal(c.referer, 'https://azcarpool.nl/');
});
await test('no key file or secret is ever in the repo\'s cron folder or in the build (the build refuses it)', () => {
  const fake = join(tmp, 'repo'); mkdirSync(join(fake, 'cron'), { recursive: true });
  for (const f of [...APP_MODULES, ...AGENDA_APP_MODULES, ...PUSH_APP_MODULES]) writeFileSync(join(fake, f), '');
  writeFileSync(join(fake, 'cron/run.sh'), '#!/bin/sh'); writeFileSync(join(fake, 'cron/backup-key.json'), '{}');
  writeFileSync(join(fake, 'firebase-config.js'), 'export const firebaseConfig = {\n projectId: "p",\n};\nexport const googleCalendarApiKey = "AIzaX";\n');
  assert.throws(() => buildCron({ rootDir: fake, out: join(tmp, 'x') }), /secret-looking files/);
  assert.equal(existsSync(join(repo, 'cron/backup-key.json')), false);
});
await test('the jobs only read their key from the secrets folder outside the code, and write only to the data folder', () => {
  const all = ['backup.mjs', 'match-calendars.mjs', 'purge.mjs', 'agenda.mjs', 'push.mjs'].map(f => readFileSync(join(repo, 'cron', f), 'utf8')).join('\n');
  assert.match(all, /secretsDir\(\), 'backup-key\.json'/); assert.match(all, /secretsDir\(\), 'calendar-key\.json'/);
  assert.doesNotMatch(all, /console\.(log|error)\([^)]*(private_key|account\b)/);
});

console.log('=== run.sh ===');
await test('an unknown or missing job is refused with exit code 2', () => {
  for (const args of [[], ['bogus'], ['backup; rm -rf /']]) { const x = runSh(args, { PATH: process.env.PATH }); assert.equal(x.status, 2, args.join()); assert.match(x.stderr, /usage/); }
});
await test('selftest runs with the Node.js on the path and reports the missing key files as warnings, not as failures', () => {
  const x = runSh(['selftest'], { PATH: process.env.PATH, HOME: tmp, AZ_SELFTEST_OFFLINE: '1' });
  assert.equal(x.status, 0, x.stdout + x.stderr);
  assert.match(x.stdout, /^node: .*\(v\d+\)/m); assert.match(x.stdout, /WARN backup-key\.json not uploaded yet/); assert.match(x.stdout, /WARN calendar-key\.json not uploaded yet/);
});
await test('finds Node.js in the hosting panel\'s nodevenv folder when it is not on the path, and takes the newest', () => {
  const home = join(tmp, 'home'); const real = process.execPath;
  for (const v of ['18', '24']) { const d = join(home, 'nodevenv', 'app', v, 'bin'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'node'), `#!/bin/sh\nif [ "$1" = "-p" ]; then echo ${v}; exit 0; fi\nexec "${real}" "$@"\n`); chmodSync(join(d, 'node'), 0o755); }
  const x = runSh(['selftest'], { PATH: '/nonexistent', HOME: home, AZ_SELFTEST_OFFLINE: '1' });
  assert.match(x.stdout, /^node: .*\/nodevenv\/app\/24\/bin\/node \(v24\)/m, x.stdout + x.stderr);
});
await test('no Node.js 20+ anywhere: a clear error, exit code 1', () => {
  const home = join(tmp, 'home-old'); const d = join(home, 'nodevenv', 'app', '16', 'bin'); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'node'), '#!/bin/sh\necho 16\n'); chmodSync(join(d, 'node'), 0o755);
  const x = runSh(['backup'], { PATH: '/nonexistent', HOME: home });
  // A machine that has its own newer Node under /usr or /opt/alt would legitimately pass; only assert the failure when none exists.
  if (!existsSync('/usr/local/bin/node') && !existsSync('/usr/bin/node') && !existsSync('/opt/alt')) { assert.equal(x.status, 1); assert.match(x.stderr, /no Node\.js 20 or newer/); }
});
await test('purge is a known job and a missing app copy or key file fails loudly', () => {
  const x = runSh(['purge'], { PATH: process.env.PATH, HOME: tmp });
  assert.equal(x.status, 1); assert.match(x.stderr, /PURGE FAILED: Cannot read the key file/);
});
await test('agenda is a known job and a missing key file fails loudly', () => {
  const x = runSh(['agenda'], { PATH: process.env.PATH, HOME: tmp });
  assert.equal(x.status, 1); assert.match(x.stderr, /AGENDA FAILED: Cannot read the key file/);
});
await test('push is a known job and a missing key file fails loudly', () => {
  const x = runSh(['push'], { PATH: process.env.PATH, HOME: tmp });
  assert.equal(x.status, 1); assert.match(x.stderr, /PUSH FAILED: /);
});
await test('the push job keeps its own key pair in the secrets folder and nowhere else', () => {
  const src = readFileSync(join(repo, 'cron', 'push.mjs'), 'utf8');
  assert.match(src, /secretsDir\(\), 'push-vapid\.json'/); assert.match(src, /secretsDir\(\), 'calendar-key\.json'/);
  assert.doesNotMatch(src, /console\.(log|error)\([^)]*(privateKey|private_key)/);
  assert.match(readFileSync(join(repo, 'cron', 'run.sh'), 'utf8'), /usage: run\.sh backup\|matches\|purge\|agenda\|push\|selftest/);
});
await test('a job without its key file fails loudly (stderr, exit 1) instead of silently', () => {
  const x = runSh(['backup'], { PATH: process.env.PATH, HOME: tmp });
  assert.equal(x.status, 1); assert.match(x.stderr, /BACK-UP FAILED: Cannot read the key file/);
  const y = runSh(['matches'], { PATH: process.env.PATH, HOME: tmp });
  assert.equal(y.status, 1); assert.match(y.stderr, /MATCH CALENDARS FAILED: Cannot read the key file/);
});

await test('a job started through a symbolic link still runs (macOS temp folders are links) instead of silently doing nothing with exit 0', () => {
  const link = join(tmp, 'link-to-dist-cron'); symlinkSync(out, link);
  for (const [job, text] of [['purge', /PURGE FAILED: Cannot read the key file/], ['backup', /BACK-UP FAILED: Cannot read the key file/], ['matches', /MATCH CALENDARS FAILED: Cannot read the key file/]]) {
    const x = spawnSync(bash, [join(link, 'run.sh'), job], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp } });
    assert.equal(x.status, 1, job + ': ' + x.stdout + x.stderr); assert.match(x.stderr, text);
  }
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
