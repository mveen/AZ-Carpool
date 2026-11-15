// scripts/uptime-check.mjs: is the LIVE site up and complete? Run every hour by .github/workflows/uptime.yml (and by hand: `node scripts/uptime-check.mjs`).
// Read-only: it only GETs public files, logs in nowhere and writes nothing. It checks that
//   - service-worker.js is served and holds a CACHE_NAME,
//   - the start page is served and points to the site's own app.js,
//   - every file in the ASSETS list of the service worker is served (a missing file means a phone that installs the app gets a broken offline copy),
//   - JavaScript files are served as JavaScript (not as an HTML error page).
// The wait page of the host (its bot check, see docs/functies/wachtpagina-host.md) is NOT an outage: when it comes up, the answer is "inconclusive"
// and the run stays green (with a notice), so a bot check never wakes anybody. A real failure turns the run red; GitHub then mails the owner.
import { pathToFileURL } from 'node:url';

export const SITE = 'https://azcarpool.nl';
export const WAIT_TEXT = /One moment, please/;

// The file names in `const ASSETS = [ './', './index.html', ... ];` of service-worker.js.
export function parseAssets(swSource) {
  const m = /const ASSETS = \[([\s\S]*?)\];/.exec(swSource);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map(x => x[1] ?? x[2]);
}
export const cacheNameOf = src => (/CACHE_NAME *= *'([^']+)'/.exec(src) || [])[1] || null;
// './' -> '/', './app.js' -> '/app.js'. Addresses on other sites are not ours to check.
export function assetUrl(site, asset) {
  if (/^https?:\/\//.test(asset)) return asset.startsWith(site + '/') ? asset : null;
  return site + '/' + asset.replace(/^\.\//, '');
}

// Asks for one address; a network error or a 5xx is tried again (after `pauseMs`), a 404 is not. Returns { status, type, text, wait } or { error }.
async function get(fetchImpl, url, { tries = 3, pauseMs = 5000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetchImpl(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
      const type = res.headers.get('content-type') || '';
      const text = /javascript|html|css|json|text|xml/i.test(type) ? await res.text() : (await res.arrayBuffer(), '');
      const out = { status: res.status, type, text, wait: WAIT_TEXT.test(text) };
      if (res.status < 500 || out.wait) return out;
      last = out;
    } catch (e) { last = { error: String(e && e.message || e) }; }
    if (i < tries) await sleep(pauseMs);
  }
  return last;
}

// Result: { state: 'ok' | 'inconclusive' | 'down', problems: [...], notes: [...] }
export async function checkSite({ site = SITE, fetchImpl = fetch, sleep, pauseMs = 5000, log = () => {} } = {}) {
  const opt = { sleep, pauseMs };
  const problems = [], notes = [];
  const sw = await get(fetchImpl, site + '/service-worker.js', opt);
  if (sw.error) return { state: 'down', problems: [`service-worker.js: ${sw.error}`], notes };
  if (sw.wait) return { state: 'inconclusive', problems: [], notes: ['the host answered with its wait page (bot check): the site was not checked'] };
  if (sw.status !== 200) return { state: 'down', problems: [`service-worker.js: HTTP ${sw.status}`], notes };
  const cache = cacheNameOf(sw.text);
  if (!cache) problems.push('service-worker.js has no CACHE_NAME');
  const assets = parseAssets(sw.text);
  if (assets.length < 10) problems.push(`service-worker.js lists only ${assets.length} files in ASSETS (expected the whole app)`);
  log(`service worker ${cache || '?'}, ${assets.length} files in ASSETS`);

  const index = await get(fetchImpl, site + '/', opt);
  if (index.wait) notes.push('start page: the host answered with its wait page');
  else if (index.error || index.status !== 200) problems.push(`start page: ${index.error || 'HTTP ' + index.status}`);
  else if (!index.text.includes(site + '/app.js') && !/app\.js/.test(index.text)) problems.push('start page does not point to app.js');

  let waited = 0;
  for (const a of assets) {
    const url = assetUrl(site, a);
    if (!url || url === site + '/') continue;
    const r = await get(fetchImpl, url, opt);
    if (r.wait) { waited++; continue; }
    if (r.error) problems.push(`${a}: ${r.error}`);
    else if (r.status !== 200) problems.push(`${a}: HTTP ${r.status}`);
    else if (/\.m?js$/.test(a) && !/javascript/i.test(r.type)) problems.push(`${a}: served as ${r.type || 'nothing'}, not as JavaScript`);
  }
  if (waited) notes.push(`${waited} file(s) were answered with the wait page of the host and not checked`);
  if (problems.length) return { state: 'down', problems, notes };
  return { state: notes.length ? 'inconclusive' : 'ok', problems, notes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkSite({ log: console.log }).then(r => {
    for (const n of r.notes) console.log(`::notice::${n}`);
    if (r.state === 'down') { for (const p of r.problems) console.log(`::error::${p}`); console.error(`\nSITE PROBLEM: ${SITE} is not complete or not up.`); process.exit(1); }
    console.log(r.state === 'ok' ? `\nOK: ${SITE} is up and complete.` : `\nInconclusive (bot check of the host in the way): nothing wrong was found.`);
  }).catch(e => { console.error('UPTIME CHECK ERROR: ' + e.message); process.exit(1); });
}
