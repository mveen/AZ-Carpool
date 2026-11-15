// scripts/check-live-rules.mjs: is the Firestore rule set that is LIVE in Firebase the same as firebase/firestore.rules in the repo?
// Usage: node scripts/check-live-rules.mjs <service-account-key.json> [projectId ...]   (default projects: az-carpool az-carpool-test)
// Read-only: it only asks Firebase for the published rules (Firebase Rules REST API) and compares text. It never publishes anything.
// Exit 0 = every project equals the repo file, 1 = a difference or an error. The key is read from disk and never printed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readServiceAccount, tokenProvider } from '../cron/lib/google-auth.mjs';

export const SCOPE_RULES = 'https://www.googleapis.com/auth/cloud-platform';
export const DEFAULT_PROJECTS = ['az-carpool', 'az-carpool-test'];
const API = 'https://firebaserules.googleapis.com/v1';

// Line endings and trailing spaces/blank lines do not count as a difference; everything else does.
export function normalizeRules(text) {
  return String(text).replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
}

// The first line that differs, for a readable message (1-based), or 0 when equal.
export function firstDifference(a, b) {
  const x = normalizeRules(a).split('\n'), y = normalizeRules(b).split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return i + 1;
  return 0;
}

export async function fetchLiveRules({ projectId, getToken, fetchFn = fetch }) {
  const token = await getToken();
  const get = async url => {
    const res = await fetchFn(url, { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000) });
    let data = {}; try { data = await res.json(); } catch (e) { /* handled below */ }
    if (!res.ok) throw new Error(`${projectId}: HTTP ${res.status} ${(data.error && data.error.message) || ''}`.trim());
    return data;
  };
  const release = await get(`${API}/projects/${projectId}/releases/cloud.firestore`);
  if (!release.rulesetName) throw new Error(`${projectId}: no published Firestore rules found`);
  const set = await get(`${API}/${release.rulesetName}`);
  const files = (set.source && set.source.files) || [];
  if (files.length !== 1) throw new Error(`${projectId}: expected one rules file, found ${files.length}`);
  return files[0].content;
}

export async function checkProjects({ repoRules, projects, getToken, fetchFn }) {
  const results = [];
  for (const projectId of projects) {
    try {
      const live = await fetchLiveRules({ projectId, getToken, fetchFn });
      const line = firstDifference(live, repoRules);
      results.push({ projectId, ok: line === 0, line });
    } catch (e) { results.push({ projectId, ok: false, error: e.message }); }
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [keyFile, ...rest] = process.argv.slice(2);
  if (!keyFile) { console.error('Usage: node scripts/check-live-rules.mjs <service-account-key.json> [projectId ...]'); process.exit(2); }
  const repoRules = readFileSync(new URL('../firebase/firestore.rules', import.meta.url), 'utf8');
  const getToken = tokenProvider({ account: readServiceAccount(keyFile), scope: SCOPE_RULES });
  const results = await checkProjects({ repoRules, projects: rest.length ? rest : DEFAULT_PROJECTS, getToken });
  for (const r of results) console.log(r.ok ? `OK     ${r.projectId}: live rules equal firebase/firestore.rules` : r.error ? `ERROR  ${r.projectId}: ${r.error}` : `DIFFER ${r.projectId}: live rules differ from firebase/firestore.rules (first difference at line ${r.line}). Publish the repo file in the Firebase console.`);
  process.exit(results.every(r => r.ok) ? 0 : 1);
}
