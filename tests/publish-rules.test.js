// Run with: node publish-rules.test.js
// scripts/publish-rules.mjs and its workflows: the database rules go live by themselves, safely. Google is played by a fake here:
// compare changes nothing, publish only when different and only after Google accepted the rules, a key of another project is refused.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRules, normalise, differingLines, diffLines, RELEASE, KNOWN_PROJECTS } from '../scripts/publish-rules.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const RULES = "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} { allow read: if false; }\n  }\n}\n";
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const account = project => ({ type: 'service_account', client_email: 'rules@x.iam.gserviceaccount.com', private_key: privateKey, project_id: project });

// A small Google: one project with (maybe) live rules. Records every call that changes something.
function fakeGoogle({ project = 'az-carpool-test', live = null, issues = [] } = {}) {
  const st = { rulesets: {}, release: null, calls: [], n: 0 };
  if (live !== null) { st.rulesets[`projects/${project}/rulesets/r0`] = live; st.release = `projects/${project}/rulesets/r0`; }
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  st.fetch = async (url, opt = {}) => {
    const u = String(url), method = opt.method || 'GET';
    if (u.includes('oauth2.googleapis.com/token')) return json(200, { access_token: 'tok', expires_in: 3600 });
    assert.equal(opt.headers.authorization, 'Bearer tok');
    const path = u.replace('https://firebaserules.googleapis.com/v1/', '');
    if (method !== 'GET' && !path.endsWith(':test')) st.calls.push(method + ' ' + path);
    if (method === 'GET' && path === `projects/${project}/releases/${RELEASE}`) return st.release ? json(200, { name: path, rulesetName: st.release }) : json(404, { error: { message: 'not found' } });
    if (method === 'GET' && st.rulesets[path] !== undefined) return json(200, { name: path, source: { files: [{ name: 'firestore.rules', content: st.rulesets[path] }] } });
    if (method === 'POST' && path === `projects/${project}:test`) return json(200, { issues });
    if (method === 'POST' && path === `projects/${project}/rulesets`) { const name = `projects/${project}/rulesets/r${++st.n}`; st.rulesets[name] = JSON.parse(opt.body).source.files[0].content; return json(200, { name }); }
    if (method === 'PATCH' && path === `projects/${project}/releases/${RELEASE}`) { const b = JSON.parse(opt.body); assert.equal(b.updateMask, 'rulesetName'); st.release = b.release.rulesetName; return json(200, b.release); }
    if (method === 'POST' && path === `projects/${project}/releases`) { const b = JSON.parse(opt.body); assert.equal(b.name, `projects/${project}/releases/${RELEASE}`); st.release = b.rulesetName; return json(200, b); }
    return json(404, { error: { message: 'unknown ' + method + ' ' + path } });
  };
  st.liveText = () => st.release ? st.rulesets[st.release] : '';
  return st;
}
const run = (g, extra = {}) => runRules({ project: 'az-carpool-test', account: account('az-carpool-test'), rulesText: RULES, fetchFn: g.fetch, log: () => {}, ...extra });

console.log('=== comparing ===');
await test('the same rules (also with Windows line ends or blank lines at the end): nothing to do, nothing is written', async () => {
  for (const live of [RULES, RULES.replace(/\n/g, '\r\n'), RULES + '\n\n']) { const g = fakeGoogle({ live }); assert.deepEqual(await run(g, { publish: true }), { same: true, published: false, lines: 0 }); assert.deepEqual(g.calls, []); }
});
await test('different rules without --publish: reported, nothing is written', async () => {
  const g = fakeGoogle({ live: RULES.replace('if false', 'if true') }); const r = await run(g);
  assert.equal(r.same, false); assert.equal(r.published, false); assert.equal(r.lines, 1); assert.deepEqual(g.calls, []);
});
await test('the difference is shown as lines that are only live or only in the repo', () => {
  assert.deepEqual(diffLines('a\nb\nc\n', 'a\nB\nc\nd\n'), ['live> b', 'repo> B', 'repo> d']);
  assert.equal(differingLines('a\nb\n', 'a\nb\n\n'), 0); assert.equal(normalise('a  \r\nb\n\n\n'), 'a\nb\n');
});

console.log('=== publishing ===');
await test('different rules with --publish: a new ruleset, then the release points to it, and the live rules are read back', async () => {
  const g = fakeGoogle({ live: RULES.replace('if false', 'if true') }); const r = await run(g, { publish: true });
  assert.equal(r.published, true);
  assert.deepEqual(g.calls, ['POST projects/az-carpool-test/rulesets', `PATCH projects/az-carpool-test/releases/${RELEASE}`]);
  assert.equal(g.liveText(), RULES);
});
await test('a project that never had rules: the release is created', async () => {
  const g = fakeGoogle(); const r = await run(g, { publish: true });
  assert.equal(r.published, true); assert.deepEqual(g.calls, ['POST projects/az-carpool-test/rulesets', 'POST projects/az-carpool-test/releases']); assert.equal(g.liveText(), RULES);
});
await test('rules that Google does not accept are never published: the old rules stay live', async () => {
  const old = RULES.replace('if false', 'if true');
  const g = fakeGoogle({ live: old, issues: [{ severity: 'ERROR', description: 'Missing semicolon', sourcePosition: { line: 4 } }, { severity: 'WARNING', description: 'unused' }] });
  await assert.rejects(run(g, { publish: true }), /does not compile, nothing was published[\s\S]*line 4: Missing semicolon/);
  assert.deepEqual(g.calls, []); assert.equal(g.liveText(), old);
});

console.log('=== safety ===');
await test('a key of another project is refused before anything is asked of Google (a test key can never publish to live)', async () => {
  const g = fakeGoogle({ project: 'az-carpool', live: 'x' }); let asked = 0; const f = (...a) => { asked++; return g.fetch(...a); };
  await assert.rejects(runRules({ project: 'az-carpool', account: account('az-carpool-test'), rulesText: RULES, publish: true, fetchFn: f, log: () => {} }), /belongs to project "az-carpool-test", not to "az-carpool"/);
  assert.equal(asked, 0);
});
await test('only the two known projects, and only a real rules file', async () => {
  assert.deepEqual(KNOWN_PROJECTS, ['az-carpool', 'az-carpool-test']);
  await assert.rejects(runRules({ project: 'other', account: account('other'), rulesText: RULES, fetchFn: fakeGoogle().fetch, log: () => {} }), /Unknown project/);
  await assert.rejects(run(fakeGoogle({ live: 'x' }), { rulesText: '', publish: true }), /does not look like Firestore rules/);
});
await test('the real firebase/firestore.rules passes the "looks like rules" check', async () => {
  const g = fakeGoogle({ live: 'old' }); const r = await run(g, { rulesText: readFileSync(join(repo, 'firebase/firestore.rules'), 'utf8') }); assert.equal(r.same, false);
});

console.log('=== the workflows ===');
const deploy = readFileSync(join(repo, '.github/workflows/deploy.yml'), 'utf8');
const job = n => { const a = deploy.indexOf(`\n  ${n}:\n`); assert.ok(a >= 0, n); const rest = deploy.slice(a + 1); const m = rest.slice(1).search(/\n  [a-z-]+:\n/); return m < 0 ? rest : rest.slice(0, m + 1); };
await test('the pipeline publishes to the TEST database before the test upload (so the robot tries app and rules together) with the test key only', () => {
  const j = job('deploy-test');
  assert.match(j, /publish-rules\.mjs --project az-carpool-test --key "\$key" --diff --publish/); assert.match(j, /secrets\.RULES_KEY_TEST/); assert.doesNotMatch(j, /RULES_KEY_LIVE|--project az-carpool /);
  assert.ok(j.indexOf('publish-rules.mjs') < j.indexOf('deploy-rsync.sh'));
});
await test('the pipeline publishes to the LIVE database only in the live job (after a green robot), before the live upload, with the live key only', () => {
  const j = job('deploy-live');
  assert.match(j, /publish-rules\.mjs --project az-carpool --key "\$key" --diff --publish/); assert.match(j, /secrets\.RULES_KEY_LIVE/); assert.doesNotMatch(j, /RULES_KEY_TEST/);
  assert.ok(j.indexOf('publish-rules.mjs') < j.indexOf('deploy-rsync.sh'));
  for (const other of ['tests', 'smoke']) assert.doesNotMatch(job(other), /RULES_KEY|publish-rules/);
});
await test('without the secret the step is skipped with a notice (the pipeline keeps working), and the key file is removed afterwards', () => {
  for (const n of ['deploy-test', 'deploy-live']) { const j = job(n); assert.match(j, /if \[ -z "\$RULES_KEY" \]; then echo "::notice::[^\n]*NOT published[^\n]*exit 0; fi/); assert.match(j, /trap 'rm -f "\$key"' EXIT/); assert.match(j, /chmod 600 "\$key"/); }
});
await test('by hand: Actions -> Databaseregels compares by default and can publish; test by default; it never runs by itself', () => {
  const y = readFileSync(join(repo, '.github/workflows/rules.yml'), 'utf8');
  assert.match(y, /on:\s*\n\s*workflow_dispatch:/); assert.doesNotMatch(y, /\bpush:|pull_request:|schedule:/);
  assert.match(y, /options: \[test, live\]\s*\n\s*default: test/); assert.match(y, /options: \[vergelijken, publiceren\]\s*\n\s*default: vergelijken/);
  assert.match(y, /permissions:\s*\n\s*contents: read/);
});
await test('the rules tests run against the emulator when a pull request touches firebase/, with the port the tests expect', () => {
  const y = readFileSync(join(repo, '.github/workflows/rules-tests.yml'), 'utf8');
  assert.match(y, /pull_request:\s*\n\s*paths:\s*\n\s*- 'firebase\/\*\*'/); assert.match(y, /emulators:exec --only firestore/); assert.match(y, /\|\| bad=1; done; exit \$bad/);
  const cfg = JSON.parse(readFileSync(join(repo, 'firebase/firebase.json'), 'utf8'));
  assert.equal(cfg.emulators.firestore.port, 8089); assert.equal(cfg.firestore.rules, 'firestore.rules');
  assert.match(readFileSync(join(repo, 'firebase/rules-test/secrets-rules.test.mjs'), 'utf8'), /port: 8089/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
