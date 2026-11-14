// Automatic smoke test of the TEST site: a robot opens the site, logs in as the coordinator and as a parent,
// opens every tab and fails on any error. It does so twice: in Chromium and in WebKit (the engine of Safari on the iPhone). Used by the deploy pipeline: green -> live, red -> live stays untouched.
// Run by hand: SMOKE_SITE=https://test.azcarpool.nl SMOKE_PHONE=... SMOKE_CODE_COORD=... SMOKE_CODE_PARENT=... node scripts/smoke-test.mjs
// It only ever talks to the test site and refuses any address that is not the test site.
import { pathToFileURL } from 'node:url';

export const TEST_ORIGIN = 'https://test.azcarpool.nl';
export const TABS = ['myweek', 'schedule', 'deviation', 'matches'];
// The robot browsers. chromium = Chrome / Android; webkit = the engine of Safari on the iPhone (the owner has no iPhone to try on).
export const ENGINES = ['chromium', 'webkit'];

// Which browsers to use: all of them, or the ones named in SMOKE_BROWSERS (e.g. "chromium" for a quick run by hand).
export function readEngines(env = process.env) {
  const asked = String(env.SMOKE_BROWSERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const unknown = asked.filter(e => !ENGINES.includes(e));
  if (unknown.length) throw new Error(`SMOKE_BROWSERS: unknown browser ${unknown.join(', ')} (choose from ${ENGINES.join(', ')}).`);
  return asked.length ? ENGINES.filter(e => asked.includes(e)) : [...ENGINES];
}

export function readSmokeConfig(env = process.env) {
  const site = String(env.SMOKE_SITE || TEST_ORIGIN).replace(/\/+$/, '');
  if (site !== TEST_ORIGIN) throw new Error(`The smoke test only runs against ${TEST_ORIGIN} (got "${site}").`);
  const need = ['SMOKE_PHONE', 'SMOKE_CODE_COORD', 'SMOKE_CODE_PARENT'];
  const missing = need.filter(n => !String(env[n] || '').trim());
  if (missing.length) throw new Error(`Missing: ${missing.join(', ')} (GitHub secrets, see README -> Test environment).`);
  const phone = String(env.SMOKE_PHONE).trim();
  const coord = String(env.SMOKE_CODE_COORD).trim(), parent = String(env.SMOKE_CODE_PARENT).trim();
  if (coord === parent) throw new Error('SMOKE_CODE_COORD and SMOKE_CODE_PARENT must be different codes.');
  return { site, phone, roles: [{ name: 'coordinator', code: coord, beheer: true }, { name: 'parent', code: parent, beheer: false }] };
}

// Browser noise that is not an app error (e.g. the favicon of a tab, Google fonts blocked by an ad blocker).
// Also harmless: in Safari the Firebase sign-in code tries to fetch a Google helper script (apis.google.com/js/api.js, only needed for
// "log in with Google" windows, which this app does not have). The site's Content-Security-Policy refuses it on purpose; the app works without.
export function isHarmless(msg) {
  return /favicon|ERR_BLOCKED_BY_CLIENT|Failed to load resource: net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED)/i.test(msg)
    || /^Refused to load https:\/\/apis\.google\.com\/js\/api\.js\S* because it does not appear in the script-src directive of the Content Security Policy/.test(msg);
}

// The host (mijn.host) sometimes answers with its own wait page ("One moment, please...", a bot check) instead of a file of the site.
// A robot browser does not get past it: the page reloads itself every 5 seconds and asks for /z<40 hex digits>, which answers 404.
// That is not an app error, so the robot recognises it, waits and tries that login again (see withHostRetry).
// Seen on 2026-11-14: answered by "openresty" with the header cf-edge-cache, while the site itself is served by LiteSpeed.
export function isHostWaitPage({ url = '', headers = {} } = {}) {
  let path = ''; try { path = new URL(url).pathname; } catch { path = String(url); }
  if (/^\/z[0-9a-f]{40}$/.test(path)) return true;
  return /openresty/i.test(headers.server || '') && 'cf-edge-cache' in headers;
}

export const HOST_RETRIES = 4, HOST_RETRY_WAIT_MS = 30000;
// Runs one check (one login in one browser). Problems WITHOUT the host's wait page count at once. With it, the check is repeated
// (up to `tries` times in total, `waitMs` apart); if it never gets through, the run fails and says the wait page was the reason.
export async function withHostRetry(run, { who = '', tries = HOST_RETRIES, waitMs = HOST_RETRY_WAIT_MS, log = console.log, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  for (let n = 1; ; n++) {
    const { problems, hostWait } = await run();
    if (!problems.length || !hostWait) return problems;
    if (n >= tries) return [`${who}: the wait page of the host ("One moment, please...") got in the way ${tries} times in a row. This is the host's bot check, not an app error: run the workflow again later, or ask mijn.host to switch it off for this site.`, ...problems];
    log(`${who}: the wait page of the host got in the way (try ${n} of ${tries}); waiting ${Math.round(waitMs / 1000)} s and trying again`);
    await sleep(waitMs);
  }
}

async function loadPlaywright() {
  try { return await import('playwright'); }
  catch (e) { if (process.env.PLAYWRIGHT_MODULE) return await import(process.env.PLAYWRIGHT_MODULE); throw e; }
}

async function checkRole(browser, cfg, role, log, engine = 'chromium') {
  const problems = [];
  let hostWait = false;
  const who = `${engine} ${role.name}`;
  const ctxOpts = { ignoreHTTPSErrors: !!process.env.SMOKE_IGNORE_HTTPS_ERRORS };
  if (process.env.HTTPS_PROXY && process.env.SMOKE_USE_PROXY) ctxOpts.proxy = { server: process.env.HTTPS_PROXY };
  const ctx = await browser.newContext({ ...ctxOpts, viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !isHarmless(m.text())) problems.push(`${who}: console: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`${who}: page error: ${e.message}`));
  // The console only says "404"; name the address (without what comes after the ?, which can hold a key), so the cause is in the log.
  page.on('response', r => { if (isHostWaitPage({ url: r.url(), headers: r.headers() })) hostWait = true; if (r.status() >= 400) log(`${who}: ${r.status()} ${r.url().split('?')[0]}`); });
  page.on('requestfailed', r => { const u = r.url(); if (u.startsWith(cfg.site) && !isHarmless(r.failure()?.errorText || '')) problems.push(`${who}: request failed: ${u}`); });
  try {
    await page.goto(cfg.site + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#gatePhone', { timeout: 30000 });
    await page.fill('#gatePhone', cfg.phone);
    await page.fill('#gateCode', role.code);
    await page.click('#gateSubmit');
    await page.waitForSelector('button.navtab[data-tab="myweek"]', { state: 'visible', timeout: 30000 });
    log(`${who}: logged in`);
    const beheerVisible = await page.isVisible('#navBeheer');
    if (beheerVisible !== role.beheer) problems.push(`${who}: Beheer tab ${beheerVisible ? 'is' : 'is not'} visible`);
    for (const tab of role.beheer ? [...TABS, 'beheer'] : TABS) {
      await page.click(`button.navtab[data-tab="${tab}"]`);
      await page.waitForSelector(`#tab-${tab}`, { state: 'visible', timeout: 15000 });
      await page.waitForTimeout(800);
      const text = ((await page.textContent(`#tab-${tab}`)) || '').trim();
      if (text.length < 5) problems.push(`${who}: tab ${tab} is empty`);
      log(`${who}: tab ${tab} ok`);
    }
    const sw = await page.evaluate(async () => !!(await navigator.serviceWorker?.getRegistration()));
    if (!sw) problems.push(`${who}: no service worker registered`);
  } catch (e) {
    problems.push(`${who}: ${e.message.split('\n')[0]}`);
  } finally { await ctx.close(); }
  return { problems, hostWait };
}

export async function runSmoke(env = process.env, log = console.log) {
  const cfg = readSmokeConfig(env);
  const engines = readEngines(env);
  const pw = await loadPlaywright();
  const problems = [];
  for (const engine of engines) {
    const browser = await pw[engine].launch(engine === 'chromium' && env.CHROMIUM_PATH ? { executablePath: env.CHROMIUM_PATH } : {});
    try { for (const role of cfg.roles) problems.push(...await withHostRetry(() => checkRole(browser, cfg, role, log, engine), { who: `${engine} ${role.name}`, log })); }
    finally { await browser.close(); }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSmoke().then(p => {
    if (p.length) { console.error('\nSMOKE TEST FAILED:\n - ' + p.join('\n - ')); process.exit(1); }
    console.log('\nSMOKE TEST OK');
  }).catch(e => { console.error('SMOKE TEST ERROR: ' + e.message); process.exit(1); });
}
