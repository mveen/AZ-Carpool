// Run with: node smoke-test.test.js
// The automatic pipeline: every merge goes to the TEST site first, a robot smoke-tests it, and only a green robot lets A failed request is named in the log.
// the live upload run. Also: fixed smoke codes survive a re-seed of the test data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSmokeConfig, readEngines, isHarmless, TEST_ORIGIN, TABS, ENGINES, isHostWaitPage, withHostRetry, HOST_RETRIES, HOST_RETRY_WAIT_MS, waitForSelectorOrHostWait, runSmoke, isHostBlockedProblem, openTab, beheerTabShown } from '../scripts/smoke-test.mjs';
import { encodeFields } from '../cron/lib/firestore-rest.mjs';
import { transformBackup, checkFixedCodes } from '../scripts/seed-test-data.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const y = readFileSync(join(repo, '.github/workflows/deploy.yml'), 'utf8');
const job = n => { const a = y.indexOf(`\n  ${n}:\n`); assert.ok(a >= 0, n); const rest = y.slice(a + 1); const m = rest.slice(1).search(/\n  [a-z-]+:\n/); return m < 0 ? rest : rest.slice(0, m + 1); };
const env = { SMOKE_PHONE: '0600000000', SMOKE_CODE_COORD: 'aaaaaaaaaa', SMOKE_CODE_PARENT: 'bbbbbbbbbb' };

console.log('=== the smoke test script ===');
await test('only ever runs against the test site', () => {
  assert.equal(readSmokeConfig(env).site, TEST_ORIGIN);
  assert.throws(() => readSmokeConfig({ ...env, SMOKE_SITE: 'https://azcarpool.nl' }), /only runs against/);
  assert.throws(() => readSmokeConfig({ ...env, SMOKE_SITE: 'https://test.azcarpool.nl.evil.com' }), /only runs against/);
});
await test('needs a phone and two different codes, and says which are missing', () => {
  assert.throws(() => readSmokeConfig({ ...env, SMOKE_CODE_PARENT: '' }), /SMOKE_CODE_PARENT/);
  assert.throws(() => readSmokeConfig({}), /SMOKE_PHONE, SMOKE_CODE_COORD, SMOKE_CODE_PARENT/);
  assert.throws(() => readSmokeConfig({ ...env, SMOKE_CODE_PARENT: 'aaaaaaaaaa' }), /different/);
});
await test('checks a coordinator (with Beheer) and a parent (without), and every main tab', () => {
  const c = readSmokeConfig(env);
  assert.deepEqual(c.roles.map(r => [r.name, r.beheer]), [['coordinator', true], ['parent', false]]);
  assert.deepEqual(TABS, ['myweek', 'schedule', 'deviation', 'matches']);
});
await test('browser noise is ignored, real errors are not', () => {
  assert.ok(isHarmless('Failed to load resource: net::ERR_BLOCKED_BY_CLIENT'));
  assert.ok(!isHarmless('Uncaught TypeError: x is not a function'));
  assert.ok(!isHarmless('FirebaseError: Missing or insufficient permissions'));
});

console.log('=== the pipeline ===');
await test('order: tests -> test site -> smoke -> live', () => {
  assert.match(job('deploy-test'), /needs: tests/);
  assert.match(job('smoke'), /needs: deploy-test/);
  assert.match(job('deploy-live'), /needs: \[deploy-test, smoke\]/);
});
await test('live is only reached when the smoke test is green, or was skipped on purpose by hand', () => {
  const j = job('deploy-live');
  assert.match(j, /needs\.smoke\.result == 'success'/);
  assert.match(j, /needs\.smoke\.result == 'skipped' && inputs\.skip_smoke/);
  assert.match(j, /needs\.deploy-test\.result == 'success'/);
  assert.match(job('smoke'), /if: \$\{\{ !inputs\.skip_smoke \}\}/);
  assert.match(y, /skip_smoke:[\s\S]*?default: false/);
});
await test('the test job uploads to the test folder only, the live job to the live folder only', () => {
  const t = job('deploy-test'), l = job('deploy-live');
  assert.match(t, /TARGET_DIR: domains\/test\.azcarpool\.nl\/public_html\//); assert.match(t, /build:deploy:test/);
  assert.ok(!/azcarpool-cron|domains\/azcarpool\.nl/.test(t));
  assert.match(l, /TARGET_DIR: domains\/azcarpool\.nl\/public_html\//); assert.match(l, /build:deploy\n/);
  assert.ok(!/test\.azcarpool\.nl/.test(l));
});
await test('the smoke job gets only the smoke secrets, the account name and the restricted tunnel key, and NEVER the deploy key', () => {
  const j = job('smoke');
  assert.ok(!/DEPLOY_KEY/.test(j));
  assert.deepEqual([...new Set([...j.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]))].sort(), ['DEPLOY_USER', 'SMOKE_CODE_COORD', 'SMOKE_CODE_PARENT', 'SMOKE_PHONE', 'TUNNEL_KEY']);
  assert.match(j, /SMOKE_SITE: https:\/\/test\.azcarpool\.nl/);
});

console.log('=== two browsers, and also after a test deploy ===');
await test('the robot uses Chromium and WebKit (the Safari engine of the iPhone) unless SMOKE_BROWSERS names fewer', () => {
  assert.deepEqual(ENGINES, ['chromium', 'webkit']);
  assert.deepEqual(readEngines({}), ['chromium', 'webkit']);
  assert.deepEqual(readEngines({ SMOKE_BROWSERS: 'webkit' }), ['webkit']);
  assert.deepEqual(readEngines({ SMOKE_BROWSERS: ' WebKit , chromium ' }), ['chromium', 'webkit']);
  assert.throws(() => readEngines({ SMOKE_BROWSERS: 'safari' }), /unknown browser safari/);
});
await test('the refused Google helper script in Safari is not an app error, any other refused script is', () => {
  assert.ok(isHarmless('Refused to load https://apis.google.com/js/api.js?onload=__iframefcb586424 because it does not appear in the script-src directive of the Content Security Policy.'));
  assert.ok(!isHarmless('Refused to load https://evil.example/x.js because it does not appear in the script-src directive of the Content Security Policy.'));
  assert.ok(!isHarmless('Refused to load https://test.azcarpool.nl/app.js because it does not appear in the script-src directive of the Content Security Policy.'));
});
await test('both workflows install both browsers', () => {
  const t = readFileSync(join(repo, '.github/workflows/deploy-test.yml'), 'utf8');
  for (const f of [y, t]) assert.match(f, /playwright install --with-deps chromium webkit/);
});
await test('a branch put on the test site by hand is smoke-tested too, after the upload, with only the smoke secrets (and never the deploy key)', () => {
  const t = readFileSync(join(repo, '.github/workflows/deploy-test.yml'), 'utf8');
  const j = t.slice(t.indexOf('\n  smoke:\n')); assert.ok(t.includes('\n  smoke:\n'));
  assert.ok(!/DEPLOY_KEY/.test(j));
  assert.match(j, /needs: deploy\n/); assert.match(j, /node scripts\/smoke-test\.mjs/); assert.match(j, /SMOKE_SITE: https:\/\/test\.azcarpool\.nl/);
  assert.deepEqual([...new Set([...j.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]))].sort(), ['DEPLOY_USER', 'SMOKE_CODE_COORD', 'SMOKE_CODE_PARENT', 'SMOKE_PHONE', 'TUNNEL_KEY']);
});

console.log('=== fixed codes in the test data ===');
const row = (path, data) => ({ path, name: 'projects/az-carpool/databases/(default)/documents/' + path, fields: encodeFields(data) });
const rows = [
  row('invites/1111111111', { familyId: 'eline' }),
  row('invites/2222222222', { familyId: 'evi' }),
  row('invites/3333333333', { familyId: 'jan' }),
];
let n = 0; const makeCode = () => String(4000000000 + n++);
await test('a fixed code stays the same, the others get new random codes', () => {
  const r = transformBackup(rows, { makeCode, fixedCodes: { eline: 'smokecoord1' } });
  const by = Object.fromEntries(r.codes.map(c => [c.familyId, c.code]));
  assert.equal(by.eline, 'smokecoord1'); assert.ok(r.docs.some(k => k.path === 'invites/smokecoord1'));
  assert.ok(by.evi !== '2222222222' && by.jan !== '3333333333');
});
await test('refuses unknown families, short codes, live codes and duplicates', () => {
  const fam = ['eline', 'evi'];
  assert.throws(() => checkFixedCodes({ nobody: 'abcdefghij' }, fam), /no such family/);
  assert.throws(() => checkFixedCodes({ eline: 'short' }, fam), /8 to 32/);
  assert.throws(() => checkFixedCodes({ eline: '1111111111' }, fam, new Set(['1111111111'])), /live app/);
  assert.throws(() => checkFixedCodes({ eline: 'abcdefghij', evi: 'abcdefghij' }, fam), /same/);
});

console.log('=== the wait page of the host (bot check) ===');
await test('the wait page of the host is recognised, an ordinary file or error is not', () => {
  assert.ok(isHostWaitPage({ url: 'https://test.azcarpool.nl/z0f76a1d14fd21a8fb5fd0d03e0fdc3d3cedae52f', headers: { server: 'LiteSpeed' } }));
  assert.ok(isHostWaitPage({ url: 'https://test.azcarpool.nl/z0f76a1d14fd21a8fb5fd0d03e0fdc3d3cedae52f?x=1' }));
  assert.ok(isHostWaitPage({ url: 'https://test.azcarpool.nl/app.js', headers: { server: 'openresty/1.31.1.1', 'cf-edge-cache': 'no-cache' } }));
  assert.ok(!isHostWaitPage({ url: 'https://test.azcarpool.nl/app.js', headers: { server: 'LiteSpeed' } }));
  assert.ok(!isHostWaitPage({ url: 'https://test.azcarpool.nl/zebra.js', headers: { server: 'LiteSpeed' } }));
  assert.ok(!isHostWaitPage({ url: 'https://test.azcarpool.nl/missing.js', headers: { server: 'openresty' } }), 'openresty alone is not enough');
  assert.ok(!isHostWaitPage({}));
});
const noSleep = { sleep: async () => {}, log: () => {}, who: 'chromium parent' };
await test('a clean check runs once', async () => {
  let n = 0; assert.deepEqual(await withHostRetry(async () => { n++; return { problems: [], hostWait: false }; }, noSleep), []); assert.equal(n, 1);
});
await test('a real app error is NOT retried: it fails at once', async () => {
  let n = 0; const p = await withHostRetry(async () => { n++; return { problems: ['tab myweek is empty'], hostWait: false }; }, noSleep);
  assert.equal(n, 1); assert.deepEqual(p, ['tab myweek is empty']);
});
await test('with the wait page of the host the check is repeated, and a later clean try makes it pass', async () => {
  let n = 0; const lines = [], waits = [];
  const p = await withHostRetry(async () => { n++; return n < 3 ? { problems: ['Timeout'], hostWait: true } : { problems: [], hostWait: false }; }, { who: 'webkit parent', log: l => lines.push(l), sleep: async ms => { waits.push(ms); } });
  assert.deepEqual(p, []); assert.equal(n, 3); assert.equal(waits.length, 2); assert.match(lines[0], /webkit parent: the wait page of the host/);
});
await test('a real error on the try after the wait page still fails', async () => {
  let n = 0; const p = await withHostRetry(async () => { n++; return n === 1 ? { problems: ['Timeout'], hostWait: true } : { problems: ['page error: x'], hostWait: false }; }, noSleep);
  assert.equal(n, 2); assert.deepEqual(p, ['page error: x']);
});
await test('the wait page every time: the run fails after the last try and names the cause', async () => {
  let n = 0; const p = await withHostRetry(async () => { n++; return { problems: ['Timeout'], hostWait: true }; }, noSleep);
  assert.equal(n, HOST_RETRIES); assert.match(p[0], /wait page of the host/); assert.match(p[0], /not an app error/); assert.equal(p[1], 'Timeout');
});
await test('the wait page seen but nothing went wrong: no retry needed', async () => {
  let n = 0; assert.deepEqual(await withHostRetry(async () => { n++; return { problems: [], hostWait: true }; }, noSleep), []); assert.equal(n, 1);
});
console.log('=== fast with the wait page: no more 14 minutes ===');
const fakePage = ({ gateAfterMs = null, text = '' } = {}) => {
  const t0 = Date.now(), up = () => gateAfterMs !== null && Date.now() - t0 >= gateAfterMs;
  return { locator: () => ({ count: async () => (up() ? 1 : 0), isVisible: async () => up() }), content: async () => text, waitForTimeout: ms => new Promise(r => setTimeout(r, ms)) };
};
await test('the login screen is found as soon as it is there', async () => {
  assert.equal(await waitForSelectorOrHostWait(fakePage({ gateAfterMs: 0 }), '#gatePhone', { timeoutMs: 500, pollMs: 5 }), 'found');
  assert.equal(await waitForSelectorOrHostWait(fakePage({ gateAfterMs: 30 }), '#gatePhone', { timeoutMs: 500, pollMs: 5 }), 'found');
  assert.equal(await waitForSelectorOrHostWait(fakePage({ gateAfterMs: 0 }), 'button', { timeoutMs: 500, pollMs: 5, visible: true }), 'found');
});
await test('the wait page of the host is recognised at once, not after the full 30 s timeout', async () => {
  const t0 = Date.now();
  assert.equal(await waitForSelectorOrHostWait(fakePage({ text: '<html><body>One moment, please...</body></html>' }), '#gatePhone', { timeoutMs: 5000, pollMs: 5 }), 'wait');
  assert.ok(Date.now() - t0 < 1000, 'took ' + (Date.now() - t0) + ' ms');
  assert.equal(await waitForSelectorOrHostWait(fakePage(), '#gatePhone', { timeoutMs: 5000, pollMs: 5, hostWait: () => true }), 'wait');   // a response already showed it
});
await test('a page with neither the login screen nor the wait page times out (a real problem, not retried as the wait page)', async () => {
  assert.equal(await waitForSelectorOrHostWait(fakePage({ text: '<html>error</html>' }), '#gatePhone', { timeoutMs: 60, pollMs: 5 }), 'timeout');
});
await test('the pause between tries is 20 s (was 30 s) and the robot job gives up after 12 minutes (was 25), so a stuck robot cannot block the queue', () => {
  assert.equal(HOST_RETRY_WAIT_MS, 20000);
  assert.match(job('smoke'), /timeout-minutes: 12/);
  assert.match(readFileSync(join(repo, '.github/workflows/deploy-test.yml'), 'utf8').slice(readFileSync(join(repo, '.github/workflows/deploy-test.yml'), 'utf8').indexOf('\n  smoke:\n')), /timeout-minutes: 12/);
});
const smokeEnv = { SMOKE_PHONE: '0612345678', SMOKE_CODE_COORD: 'aaaaaaaaaa', SMOKE_CODE_PARENT: 'bbbbbbbbbb' };
const fakePw = () => { const launched = []; const mk = e => ({ launch: async () => { launched.push(e); return { close: async () => {} }; } }); return { launched, chromium: mk('chromium'), webkit: mk('webkit') }; };
await test('blocked by the wait page on every try: the other three checks are NOT tried (they would meet it too), and the run names the cause', async () => {
  const pw = fakePw(); const calls = [];
  const problems = await runSmoke(smokeEnv, () => {}, { pw, sleep: async () => {}, check: async (b, c, role, l, engine) => { calls.push(engine + ' ' + role.name); return { problems: ['Timeout'], hostWait: true }; } });
  assert.equal(calls.length, HOST_RETRIES);               // only the first check, with its tries
  assert.ok(calls.every(c => c === 'chromium coordinator'));
  assert.deepEqual(pw.launched, ['chromium']);            // the second browser is not even started
  assert.ok(problems.some(isHostBlockedProblem));
  assert.equal(problems.filter(m => /not tried/.test(m)).length, 3);
  for (const who of ['chromium parent', 'webkit coordinator', 'webkit parent']) assert.ok(problems.some(m => m.startsWith(who + ': not tried')), who);
});
await test('a green run still checks all four (two browsers x two logins)', async () => {
  const pw = fakePw(); const calls = [];
  const problems = await runSmoke(smokeEnv, () => {}, { pw, sleep: async () => {}, check: async (b, c, role, l, engine) => { calls.push(engine + ' ' + role.name); return { problems: [], hostWait: false }; } });
  assert.deepEqual(problems, []); assert.deepEqual(calls, ['chromium coordinator', 'chromium parent', 'webkit coordinator', 'webkit parent']);
});
await test('a real app error does NOT stop the other checks: they all still run and report', async () => {
  const pw = fakePw(); const calls = [];
  const problems = await runSmoke(smokeEnv, () => {}, { pw, sleep: async () => {}, check: async (b, c, role, l, engine) => { calls.push(engine + ' ' + role.name); return { problems: calls.length === 1 ? ['chromium coordinator: tab myweek is empty'] : [], hostWait: false }; } });
  assert.equal(calls.length, 4); assert.deepEqual(problems, ['chromium coordinator: tab myweek is empty']);
});
await test('a wait page that goes away on a later try still lets the whole run pass', async () => {
  const pw = fakePw(); let n = 0; const calls = [];
  const problems = await runSmoke(smokeEnv, () => {}, { pw, sleep: async () => {}, check: async (b, c, role, l, engine) => { calls.push(engine + ' ' + role.name); n++; return n === 1 ? { problems: ['Timeout'], hostWait: true } : { problems: [], hostWait: false }; } });
  assert.deepEqual(problems, []); assert.equal(calls.length, 5);   // 1 blocked try + 4 checks
});
console.log('=== opening a tab ===');
const tabPage = ({ showsAfterClicks = 1 } = {}) => { let clicks = 0; const calls = [];
  return { calls, get clicks() { return clicks; },
    click: async sel => { clicks++; calls.push(sel); },
    waitForSelector: async () => { if (clicks >= showsAfterClicks) return; throw new Error('timeout'); },
    evaluate: async () => ({ visible: ['tab-myweek'], active: ['myweek'], hidden: [] }) }; };
await test('a tab that shows after the first click is clicked once and says nothing', async () => {
  const logs = []; const pg = tabPage({ showsAfterClicks: 1 });
  await openTab(pg, 'deviation', m => logs.push(m), 'webkit parent');
  assert.equal(pg.clicks, 1); assert.deepEqual(logs, []);
});
await test('a click that did not register gets ONE second click, and the log says so', async () => {
  const logs = []; const pg = tabPage({ showsAfterClicks: 2 });
  await openTab(pg, 'deviation', m => logs.push(m), 'webkit parent');
  assert.equal(pg.clicks, 2);
  assert.ok(logs.some(m => /clicking again/.test(m)) && logs.some(m => /after the second click/.test(m)));
  assert.ok(pg.calls.every(c => c === 'button.navtab[data-tab="deviation"]'));
});
await test('a tab that never shows fails with its NAME and what the page looked like, after exactly two clicks', async () => {
  const pg = tabPage({ showsAfterClicks: 99 });
  await assert.rejects(() => openTab(pg, 'deviation', () => {}, 'webkit parent'), e => /tab deviation never showed/.test(e.message) && /visible: \[tab-myweek\]/.test(e.message) && /active nav: \[myweek\]/.test(e.message));
  assert.equal(pg.clicks, 2);
});
console.log('=== the Beheer tab comes a moment after the login (rights are read once the phone is linked) ===');
const beheerPage = ({ showAfterMs = null } = {}) => {
  const t0 = Date.now(), up = () => showAfterMs !== null && Date.now() - t0 >= showAfterMs;
  return {
    waitForSelector: async (sel, { timeout }) => { while (!up()) { if (Date.now() - t0 >= timeout) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } },
    waitForTimeout: ms => new Promise(r => setTimeout(r, ms)), isVisible: async () => up(),
  };
};
await test('the coordinator whose Beheer tab shows a moment late passes (this was the failing smoke test)', async () => {
  assert.equal(await beheerTabShown(beheerPage({ showAfterMs: 60 }), true, { timeoutMs: 500 }), true);
});
await test('the coordinator whose Beheer tab never shows still fails, after the wait', async () => {
  assert.equal(await beheerTabShown(beheerPage(), true, { timeoutMs: 80 }), false);
});
await test('a parent must not get the Beheer tab, not even a moment later', async () => {
  assert.equal(await beheerTabShown(beheerPage(), false, { parentWaitMs: 10 }), false);
  assert.equal(await beheerTabShown(beheerPage({ showAfterMs: 5 }), false, { parentWaitMs: 30 }), true);
});
await test('the smoke job has time for the retries', () => { assert.match(job('smoke'), /timeout-minutes: 12/); });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
