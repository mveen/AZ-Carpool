// scripts/build-deploy.mjs — `npm run build:deploy`
// Builds the folder that is uploaded to the web host (default: dist/). It contains only the files the app needs
// (the ASSETS list of service-worker.js, the service worker itself, and the server settings in deploy/), and it
// swaps the fixed GitHub Pages address for the address of the new site. The source files in the repo are not changed,
// so GitHub Pages keeps working exactly as before.
//
//   node scripts/build-deploy.mjs                              -> dist/ for https://azcarpool.nl/
//   node scripts/build-deploy.mjs --out some/dir --site https://example.nl/
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_SITE = 'https://mveen.github.io/AZ-Carpool/';
export const DEFAULT_SITE = 'https://azcarpool.nl/';
const TEXT_TYPES = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

export function buildDeploy({ rootDir = root, out = join(root, 'dist'), site = DEFAULT_SITE } = {}) {
  if (!/^https:\/\/[^/\s]+\/$/.test(site)) throw new Error(`site must look like https://example.nl/ (got ${site})`);
  const assets = assetList(rootDir);
  const missing = assets.filter(f => !existsSync(join(rootDir, f)));
  if (missing.length) throw new Error('Listed in service-worker.js but not in the repo: ' + missing.join(', '));

  rmSync(out, { recursive: true, force: true });
  const written = [];
  const put = (rel, data) => { const to = join(out, rel); mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, data); written.push(rel); };

  for (const rel of assets) {
    const buf = readFileSync(join(rootDir, rel));
    put(rel, TEXT_TYPES.has(extname(rel)) ? buf.toString('utf8').split(SOURCE_SITE).join(site) : buf);
  }
  // Server settings (.htaccess, robots.txt) live in deploy/.
  const serverDir = join(rootDir, 'deploy');
  for (const name of existsSync(serverDir) ? readdirSync(serverDir) : []) {
    if (statSync(join(serverDir, name)).isFile()) put(name, readFileSync(join(serverDir, name)));
  }

  // Safety checks: nothing may still point to the old address, and every file that is pointed to must be in the folder.
  const problems = [];
  for (const rel of written) {
    if (!TEXT_TYPES.has(extname(rel))) continue;
    const text = readFileSync(join(out, rel), 'utf8');
    if (text.includes(SOURCE_SITE)) problems.push(`${rel} still contains ${SOURCE_SITE}`);
    for (const ref of relativeReferences(rel, text)) {
      const target = join(dirname(join(out, rel)), ref);
      if (!existsSync(target)) problems.push(`${rel} points to ${ref}, which is not in the upload folder (add it to ASSETS in service-worker.js)`);
    }
  }
  if (problems.length) throw new Error('Upload folder is not complete:\n  ' + problems.join('\n  '));
  return { out, files: written.sort(), site };
}

// Command line
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
  try {
    const r = buildDeploy({ out: arg('--out') ? resolve(arg('--out')) : join(root, 'dist'), site: arg('--site') || DEFAULT_SITE });
    console.log(`Upload folder ready: ${r.out}\n${r.files.length} files, address ${r.site}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
