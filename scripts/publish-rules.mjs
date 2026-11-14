// scripts/publish-rules.mjs — compares firebase/firestore.rules with the rules that are LIVE in a Firebase project, and publishes them.
//   node scripts/publish-rules.mjs --project az-carpool-test --key key.json             -> compare only (changes nothing)
//   node scripts/publish-rules.mjs --project az-carpool-test --key key.json --diff      -> compare and show the lines that differ
//   node scripts/publish-rules.mjs --project az-carpool-test --key key.json --publish   -> publish when they differ
// Used by the deploy pipeline (.github/workflows/deploy.yml) and by hand through Actions -> "Databaseregels" (rules.yml), so nobody has
// to paste the rules into the Firebase console any more. No libraries: Google's Firebase Rules REST API with the service-account login of the cron jobs.
// The key is a service account of THAT project with the role "Firebase Rules Admin" only; it is a GitHub secret, never in the repo.
// Safety: the key must belong to the project named (a test key can never publish to live), the rules must compile at Google first,
// and after publishing the live rules are read back and compared.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readServiceAccount, tokenProvider } from '../cron/lib/google-auth.mjs';

export const RULES_API = 'https://firebaserules.googleapis.com/v1';
export const RULES_SCOPE = 'https://www.googleapis.com/auth/firebase';
export const RELEASE = 'cloud.firestore';          // the release name of the default Firestore database
export const RULES_FILE = 'firebase/firestore.rules';
export const KNOWN_PROJECTS = ['az-carpool', 'az-carpool-test'];
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// PURE. Line endings and trailing blank lines are not a difference (the console adds or strips them).
export const normalise = text => String(text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '') + '\n';
// PURE. How many lines differ, for the log (not a full diff: the rules can say things about the data model).
export function differingLines(a, b) {
  const x = normalise(a).split('\n'), y = normalise(b).split('\n'); let n = Math.abs(x.length - y.length);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) n++;
  return n;
}

// PURE. The lines that are only live ("live> ") or only in the repo ("repo> "), in file order: enough to see what a publish would change.
export function diffLines(liveText, repoText) {
  const a = normalise(liveText).split('\n'), b = normalise(repoText).split('\n');
  const count = l => l.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const ca = count(a), cb = count(b), out = [];
  for (const x of a) { if ((cb.get(x) || 0) > 0) cb.set(x, cb.get(x) - 1); else if (x.trim()) out.push('live> ' + x); }
  for (const x of b) { if ((ca.get(x) || 0) > 0) ca.set(x, ca.get(x) - 1); else if (x.trim()) out.push('repo> ' + x); }
  return out;
}

export function createRulesApi({ project, getToken, fetchFn = fetch }) {
  const call = async (method, path, body) => {
    const res = await fetchFn(`${RULES_API}/${path}`, { method, headers: { authorization: 'Bearer ' + await getToken(), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    let data = {}; try { data = await res.json(); } catch (e) { /* handled below */ }
    if (!res.ok) throw new Error(`Firebase Rules API: ${method} ${path.split('?')[0]} -> HTTP ${res.status} ${(data.error && data.error.message) || ''}`.trim());
    return data;
  };
  const releaseName = `projects/${project}/releases/${RELEASE}`;
  return {
    // The rules text that is live now ('' when the project has never had rules published).
    async liveSource() {
      let release;
      try { release = await call('GET', releaseName); } catch (e) { if (/HTTP 404/.test(e.message)) return { text: '', rulesetName: '' }; throw e; }
      const ruleset = await call('GET', release.rulesetName);
      const files = (ruleset.source && ruleset.source.files) || [];
      return { text: files.map(f => f.content || '').join('\n'), rulesetName: release.rulesetName };
    },
    // Does Google accept the rules (syntax and meaning)? Returns the list of problems that would stop a publish.
    async compileErrors(text) {
      const r = await call('POST', `projects/${project}:test`, { source: { files: [{ name: 'firestore.rules', content: text }] } });
      return (r.issues || []).filter(i => i.severity === 'ERROR').map(i => `line ${(i.sourcePosition && i.sourcePosition.line) || '?'}: ${i.description}`);
    },
    async publish(text, hadRelease) {
      const ruleset = await call('POST', `projects/${project}/rulesets`, { source: { files: [{ name: 'firestore.rules', content: text }] } });
      if (hadRelease) await call('PATCH', releaseName, { release: { name: releaseName, rulesetName: ruleset.name }, updateMask: 'rulesetName' });
      else await call('POST', `projects/${project}/releases`, { name: releaseName, rulesetName: ruleset.name });
      return ruleset.name;
    },
  };
}

// The whole job. Returns { same, published, lines }. Throws when something is wrong (nothing is half done: a new ruleset that is not
// released changes nothing for the app).
export async function runRules({ project, account, publish = false, showDiff = false, rulesText, fetchFn = fetch, log = console.log }) {
  if (!KNOWN_PROJECTS.includes(project)) throw new Error(`Unknown project "${project}" (expected ${KNOWN_PROJECTS.join(' or ')}).`);
  if (account.project_id !== project) throw new Error(`The key belongs to project "${account.project_id}", not to "${project}": refused.`);
  if (!/rules_version\s*=\s*'2'/.test(rulesText) || !/service\s+cloud\.firestore/.test(rulesText)) throw new Error(`${RULES_FILE} does not look like Firestore rules: refused.`);
  const api = createRulesApi({ project, getToken: tokenProvider({ account, scope: RULES_SCOPE, fetchFn }), fetchFn });
  const live = await api.liveSource();
  const lines = differingLines(live.text, rulesText);
  if (normalise(live.text) === normalise(rulesText)) { log(`${project}: the live rules are the same as ${RULES_FILE}. Nothing to do.`); return { same: true, published: false, lines: 0 }; }
  log(`${project}: the live rules DIFFER from ${RULES_FILE} (${lines} line${lines === 1 ? '' : 's'}).`);
  if (showDiff) for (const l of diffLines(live.text, rulesText)) log('  ' + l);
  if (!publish) return { same: false, published: false, lines };
  const errors = await api.compileErrors(rulesText);
  if (errors.length) throw new Error(`${RULES_FILE} does not compile, nothing was published:\n  ` + errors.join('\n  '));
  const name = await api.publish(normalise(rulesText), !!live.rulesetName);
  const after = await api.liveSource();
  if (normalise(after.text) !== normalise(rulesText)) throw new Error('Published, but the live rules read back differently. Check the Firebase console.');
  log(`${project}: published (${name.split('/').pop()}). The previous rules stay in the Firebase console under Rules -> history, to put back by hand if needed.`);
  return { same: false, published: true, lines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : ''; };
  const has = n => process.argv.includes('--' + n);
  (async () => {
    if (!arg('project') || !arg('key')) throw new Error('usage: node scripts/publish-rules.mjs --project az-carpool-test --key key.json [--publish] [--diff] [--fail-if-different]');
    const r = await runRules({ project: arg('project'), account: readServiceAccount(arg('key')), publish: has('publish'), showDiff: has('diff'), rulesText: readFileSync(join(root, RULES_FILE), 'utf8') });
    if (!r.same && !r.published && has('fail-if-different')) process.exit(1);
  })().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
}
