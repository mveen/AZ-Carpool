// scripts/build-deploy.mjs — `npm run build:deploy`
// Builds the folder that is uploaded to the web host (default: dist/). It contains only the files the app needs
// (the ASSETS list of service-worker.js, the service worker itself, and the server settings in deploy/), and it
// swaps the fixed GitHub Pages address for the address of the new site. The source files in the repo are not changed,
// so GitHub Pages keeps working exactly as before.
//
//   node scripts/build-deploy.mjs                              -> dist/ for https://azcarpool.nl/
//   node scripts/build-deploy.mjs --out some/dir --site https://example.nl/
//   node scripts/build-deploy.mjs --env test                   -> dist-test/ for https://test.azcarpool.nl/ (own database, test banner)
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const SOURCE_SITE = 'https://mveen.github.io/AZ-Carpool/';
export const DEFAULT_SITE = 'https://azcarpool.nl/';
export const TEST_SITE = 'https://test.azcarpool.nl/';
// The live Firebase project. A test build must never be pointed at it.
export const LIVE_FIREBASE_PROJECT = 'az-carpool';
export const TEST_BANNER_TEXT = 'TESTOMGEVING · oefen hier, dit is niet de echte app';
const TEXT_TYPES = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Placeholder in deploy/.htaccess that is replaced by the CSP hashes of the inline scripts of index.html.
export const HASH_PLACEHOLDER = '__INLINE_SCRIPT_HASHES__';

// CSP source entries ('sha256-...') for every inline <script> in a page, so the policy needs no 'unsafe-inline' for scripts.
export function inlineScriptHashes(html) {
  const out = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    out.push(`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  }
  return [...new Set(out)];
}

// The files listed in ASSETS of service-worker.js ('./' is the start page, index.html).
export function assetList(rootDir = root) {
  const src = readFileSync(join(rootDir, 'service-worker.js'), 'utf8');
  const block = src.match(/const ASSETS = \[([\s\S]*?)\];/);
  if (!block) throw new Error('ASSETS list not found in service-worker.js');
  const files = [...block[1].matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(Boolean);
  return [...new Set([...files, 'index.html', 'service-worker.js'])].sort();
}

// Relative files that a shipped page or script points to: import ... from './x.js', import('./x.js'), href/src="./x".
export function relativeReferences(file, text) {
  const refs = new Set();
  if (extname(file) === '.html') {
    for (const m of text.matchAll(/\b(?:href|src)="(\.\/[^"#?]+)"/g)) refs.add(m[1]);
  } else if (extname(file) === '.js' || extname(file) === '.mjs') {
    for (const m of text.matchAll(/\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) refs.add(m[1]);
  }
  return [...refs];
}

// The Firebase config of the test environment, checked: filled in, and not the live project.
export function readTestConfig(file) {
  if (!existsSync(file)) throw new Error(`Test config not found: ${file}`);
  const text = readFileSync(file, 'utf8');
  if (text.includes('VUL-IN')) throw new Error('deploy/test/firebase-config.js is not filled in yet (it still says VUL-IN). Copy the values of the TEST Firebase project into it.');
  const project = (text.match(/projectId:\s*"([^"]+)"/) || [])[1];
  if (!project) throw new Error('deploy/test/firebase-config.js has no projectId.');
  if (project === LIVE_FIREBASE_PROJECT) throw new Error(`deploy/test/firebase-config.js points to the LIVE Firebase project (${LIVE_FIREBASE_PROJECT}). The test environment needs its own project.`);
  return text;
}

// What makes the test site recognisable: tab title, a dark bar on top of every screen, and another name when installed on a phone.
export function markAsTest(rel, text) {
  if (rel === 'index.html') {
    const title = '<title>AZ Carpool Aalsmeer</title>';
    const top = '<div id="topbar">';
    if (!text.includes(title) || !text.includes(top) || !text.includes('</head>')) throw new Error('index.html changed: cannot add the test banner (title, #topbar or </head> not found)');
    const css = '<style>.envBar{background:var(--action-bg,#14161a);color:var(--action-ink,#fff);font:var(--type-caption);text-align:center;padding:calc(var(--space-2,6px) + env(safe-area-inset-top,0px)) var(--page-gutter,18px) var(--space-2,6px)}</style>';
    return text.replace(title, '<title>TEST – AZ Carpool Aalsmeer</title>')
      .replace('</head>', css + '\n</head>')
      .replace(top, top + `\n<div class="envBar" role="note">${TEST_BANNER_TEXT}</div>`);
  }
  if (rel === 'manifest.json') {
    const m = JSON.parse(text);
    m.name = 'AZ Carpool TEST'; m.short_name = 'AZ TEST';
    return JSON.stringify(m, null, 2) + '\n';
  }
  return text;
}

export function buildDeploy({ rootDir = root, out = join(root, 'dist'), env = 'live', site = env === 'test' ? TEST_SITE : DEFAULT_SITE, testConfigFile = join(rootDir, 'deploy/test/firebase-config.js') } = {}) {
  if (env !== 'live' && env !== 'test') throw new Error(`env must be live or test (got ${env})`);
  if (!/^https:\/\/[^/\s]+\/$/.test(site)) throw new Error(`site must look like https://example.nl/ (got ${site})`);
  if (env === 'test' && site === DEFAULT_SITE) throw new Error('A test build must never be made for the live address.');
  const testConfig = env === 'test' ? readTestConfig(testConfigFile) : null;
  const assets = assetList(rootDir);
  const missing = assets.filter(f => !existsSync(join(rootDir, f)));
  if (missing.length) throw new Error('Listed in service-worker.js but not in the repo: ' + missing.join(', '));

  rmSync(out, { recursive: true, force: true });
  const written = [];
  const put = (rel, data) => { const to = join(out, rel); mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, data); written.push(rel); };

  let configSwapped = false;
  for (const rel of assets) {
    if (env === 'test' && rel === 'firebase-config.js') { put(rel, testConfig); configSwapped = true; continue; }
    const buf = readFileSync(join(rootDir, rel));
    if (!TEXT_TYPES.has(extname(rel))) { put(rel, buf); continue; }
    let text = buf.toString('utf8').split(SOURCE_SITE).join(site);
    if (env === 'test') text = markAsTest(rel, text.split(DEFAULT_SITE).join(site));   // APP_URL (links in WhatsApp texts) must not point to the live site either
    put(rel, text);
  }
  if (env === 'test' && !configSwapped) throw new Error('firebase-config.js is not in the ASSETS list of service-worker.js, so the test config cannot replace it.');
  // Server settings (.htaccess, robots.txt) live in deploy/.
  const serverDir = join(rootDir, 'deploy');
  for (const name of existsSync(serverDir) ? readdirSync(serverDir) : []) {
    if (statSync(join(serverDir, name)).isFile()) put(name, readFileSync(join(serverDir, name)));
  }

  // The Content-Security-Policy in .htaccess allows exactly the inline scripts that index.html has now (their hashes), nothing else.
  if (written.includes('.htaccess') && written.includes('index.html')) {
    const hashes = inlineScriptHashes(readFileSync(join(out, 'index.html'), 'utf8'));
    const htaccess = readFileSync(join(out, '.htaccess'), 'utf8');
    if (htaccess.includes(HASH_PLACEHOLDER)) put('.htaccess', htaccess.split(HASH_PLACEHOLDER).join(hashes.join(' ')));
  }

  // Tells deploy-rsync.sh which server folder this build may go to (the file itself is never uploaded).
  put('.deploy-target', env + '\n');

  // Safety checks: nothing may still point to the old address, and every file that is pointed to must be in the folder.
  const problems = [];
  for (const rel of written) {
    if (!TEXT_TYPES.has(extname(rel))) continue;
    const text = readFileSync(join(out, rel), 'utf8');
    if (text.includes(SOURCE_SITE)) problems.push(`${rel} still contains ${SOURCE_SITE}`);
    if (env === 'test' && text.includes(DEFAULT_SITE)) problems.push(`${rel} still contains the live address ${DEFAULT_SITE}`);
    if (env === 'test' && /"projectId":\s*"az-carpool"|projectId:\s*"az-carpool"/.test(text)) problems.push(`${rel} still contains the live Firebase project`);
    for (const ref of relativeReferences(rel, text)) {
      const target = join(dirname(join(out, rel)), ref);
      if (!existsSync(target)) problems.push(`${rel} points to ${ref}, which is not in the upload folder (add it to ASSETS in service-worker.js)`);
    }
  }
  if (problems.length) throw new Error('Upload folder is not complete:\n  ' + problems.join('\n  '));
  return { out, files: [...new Set(written)].sort(), site, env };
}

// Command line
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
  try {
    const env = arg('--env') || 'live';
    const opts = { env, out: arg('--out') ? resolve(arg('--out')) : join(root, env === 'test' ? 'dist-test' : 'dist') };
    if (arg('--site')) opts.site = arg('--site');
    const r = buildDeploy(opts);
    console.log(`Upload folder ready: ${r.out}\n${r.files.length} files, ${r.env} environment, address ${r.site}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
