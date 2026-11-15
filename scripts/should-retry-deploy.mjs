// scripts/should-retry-deploy.mjs: decides whether a failed deploy run is worth ONE automatic restart.
// Used by .github/workflows/deploy-retry.yml. Reads the JSON of `GET /repos/.../actions/runs/ID/jobs` on stdin and prints `retry` or `skip`.
//
// Why: mijn.host sometimes shows its own bot check ("One moment, please...") to the one GitHub computer that is running the deploy, for
// minutes, instead of the site. The upload itself worked, only the check afterwards (or the robot smoke test) was blocked. A restart of the
// failed jobs runs on another computer with another address and almost always passes.
// Only steps that talk to the host are restarted. A failing test, build or missing secret is a real problem and is never restarted.
import { fileURLToPath } from 'node:url';

// Step names (see deploy.yml and deploy-test.yml) that talk to the host.
export const HOST_STEPS = /^(Upload|Check that the (new|test) version|Smoke test)/;

export function shouldRetry(jobsJson) {
  const jobs = (jobsJson && jobsJson.jobs) || [];
  const failedSteps = jobs.flatMap(j => (j.steps || []).filter(s => s.conclusion === 'failure').map(s => s.name));
  if (!failedSteps.length) return false;                 // nothing failed in a step (cancelled, or the setup broke): leave it
  return failedSteps.every(name => HOST_STEPS.test(name)); // one real failure (tests, build, secrets) anywhere = no restart
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => input += c);
  process.stdin.on('end', () => {
    let json = null;
    try { json = JSON.parse(input); } catch { /* not JSON: skip */ }
    console.log(json && shouldRetry(json) ? 'retry' : 'skip');
  });
}
