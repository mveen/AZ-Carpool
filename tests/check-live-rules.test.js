// Run with: node check-live-rules.test.js
// scripts/check-live-rules.mjs: compares the published Firestore rules with firebase/firestore.rules. No network: fetch is replaced.
import assert from 'node:assert/strict';
import { normalizeRules, firstDifference, fetchLiveRules, checkProjects, DEFAULT_PROJECTS } from '../scripts/check-live-rules.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const RULES = "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{d}/documents {\n  }\n}\n";
// A fake Firebase Rules API: one release and one rule set per project.
const fakeApi = (live, calls = []) => async (url, opts) => {
  calls.push({ url, auth: opts.headers.authorization });
  const m = url.match(/projects\/([^/]+)\/releases\/cloud\.firestore$/);
  if (m) return live[m[1]] === undefined ? json(404, { error: { message: 'not found' } }) : json(200, { rulesetName: `projects/${m[1]}/rulesets/R1` });
  const s = url.match(/projects\/([^/]+)\/rulesets\/R1$/);
  if (s) return json(200, { source: { files: [{ name: 'firestore.rules', content: live[s[1]] }] } });
  return json(500, {});
};
const getToken = async () => 'TOKEN';

console.log('=== comparing rules ===');
await test('line endings, trailing spaces and blank lines at the ends are not a difference', () => {
  assert.equal(firstDifference(RULES, RULES.replace(/\n/g, '\r\n') + '\n\n'), 0);
  assert.equal(firstDifference(RULES, RULES.replace('cloud.firestore {\n', 'cloud.firestore {   \n')), 0);
  assert.equal(normalizeRules('\n\na \r\nb  \n\n'), 'a\nb');
});
await test('any other change is a difference, and the first differing line is named', () => {
  assert.equal(firstDifference(RULES, RULES.replace("'2'", "'3'")), 1);
  assert.equal(firstDifference(RULES, RULES.replace('{d}', '{x}')), 3);
  assert.equal(firstDifference(RULES, RULES + 'extra\n'), 6);
});

console.log('=== asking Firebase ===');
await test('it reads the published release and its rule set with the bearer token', async () => {
  const calls = [];
  assert.equal(await fetchLiveRules({ projectId: 'p1', getToken, fetchFn: fakeApi({ p1: RULES }, calls) }), RULES);
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c.auth === 'Bearer TOKEN'));
  assert.match(calls[0].url, /firebaserules\.googleapis\.com\/v1\/projects\/p1\/releases\/cloud\.firestore$/);
});
await test('an error from Firebase (no access, no rules) is reported with the project, not hidden', async () => {
  await assert.rejects(fetchLiveRules({ projectId: 'p9', getToken, fetchFn: fakeApi({}) }), /p9: HTTP 404 not found/);
});
await test('a rule set with more than one file is refused (the comparison would be a guess)', async () => {
  const fetchFn = async url => url.endsWith('cloud.firestore') ? json(200, { rulesetName: 'projects/p/rulesets/R1' }) : json(200, { source: { files: [{ content: 'a' }, { content: 'b' }] } });
  await assert.rejects(fetchLiveRules({ projectId: 'p', getToken, fetchFn }), /expected one rules file, found 2/);
});

console.log('=== checking projects ===');
await test('both projects equal: all ok', async () => {
  const r = await checkProjects({ repoRules: RULES, projects: DEFAULT_PROJECTS, getToken, fetchFn: fakeApi({ 'az-carpool': RULES, 'az-carpool-test': RULES }) });
  assert.deepEqual(r.map(x => x.ok), [true, true]);
});
await test('a live project that is behind is flagged, the other stays ok', async () => {
  const r = await checkProjects({ repoRules: RULES, projects: DEFAULT_PROJECTS, getToken, fetchFn: fakeApi({ 'az-carpool': RULES.replace('{d}', '{x}'), 'az-carpool-test': RULES }) });
  assert.deepEqual(r.map(x => [x.projectId, x.ok, x.line]), [['az-carpool', false, 3], ['az-carpool-test', true, 0]]);
});
await test('an error on one project does not hide the result of the other', async () => {
  const r = await checkProjects({ repoRules: RULES, projects: ['a', 'b'], getToken, fetchFn: fakeApi({ b: RULES }) });
  assert.equal(r[0].ok, false); assert.match(r[0].error, /HTTP 404/); assert.equal(r[1].ok, true);
});
await test('the default projects are the live and the test project', () => { assert.deepEqual(DEFAULT_PROJECTS, ['az-carpool', 'az-carpool-test']); });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
