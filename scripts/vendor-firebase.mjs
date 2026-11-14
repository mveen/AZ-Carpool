// scripts/vendor-firebase.mjs — puts the Firebase SDK (app, auth, firestore) in firebase-sdk/, so the app loads it from its
// own site instead of from Google's server (www.gstatic.com).
//   node scripts/vendor-firebase.mjs            -> the version in FIREBASE_VERSION below
//   node scripts/vendor-firebase.mjs 13.4.0     -> another version (then also set FIREBASE_VERSION, bump CACHE_NAME, try it on the test site)
// It downloads the official `firebase` package from the npm registry, takes the three browser files and makes ONE change:
// the files import each other from https://www.gstatic.com/firebasejs/<version>/...; that becomes ./firebase-app.js.
// Nothing is installed in the repo (no node_modules, no package-lock): the three files are the whole dependency.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FIREBASE_VERSION = '13.3.0';
export const FIREBASE_FILES = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'];
export const VENDOR_DIR = 'firebase-sdk';

// PURE. The one change to a file of the package: imports from Google's server become imports from the folder itself.
export function localise(text, version) {
  const from = `https://www.gstatic.com/firebasejs/${version}/`;
  const out = text
    .replace(new RegExp(`(\\bfrom\\s*["'])${from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(firebase-[a-z-]+\\.js["'])`, 'g'), '$1./$2')
    .replace(/\n\/\/# sourceMappingURL=\S+\s*$/, '\n');   // the .map files are not shipped: no dead link
  if (/\b(from|import)\s*\(?\s*["']https?:\/\//.test(out)) throw new Error('a file still imports from another server');
  return out;
}

export function vendorFirebase({ version = FIREBASE_VERSION, rootDir = join(dirname(fileURLToPath(import.meta.url)), '..') } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`version must look like 13.3.0 (got ${version})`);
  const tmp = mkdtempSync(join(tmpdir(), 'az-firebase-'));
  try {
    execFileSync('npm', ['pack', `firebase@${version}`, '--silent', '--pack-destination', tmp], { stdio: ['ignore', 'pipe', 'inherit'] });
    execFileSync('tar', ['xzf', join(tmp, `firebase-${version}.tgz`), '-C', tmp, ...FIREBASE_FILES.map(f => 'package/' + f), 'package/package.json']);
    const pkg = JSON.parse(readFileSync(join(tmp, 'package/package.json'), 'utf8'));
    if (pkg.name !== 'firebase' || pkg.version !== version) throw new Error('unexpected package: ' + pkg.name + '@' + pkg.version);
    const dir = join(rootDir, VENDOR_DIR); mkdirSync(dir, { recursive: true });
    for (const f of FIREBASE_FILES) writeFileSync(join(dir, f), localise(readFileSync(join(tmp, 'package', f), 'utf8'), version));
    writeFileSync(join(dir, 'README.md'), `# Firebase SDK ${version}\n\nThe official Firebase JavaScript SDK (npm package \`firebase@${version}\`, licence ${pkg.license}, © Google LLC), browser files for app, auth and firestore.\nMade by \`node scripts/vendor-firebase.mjs\`. Do not edit by hand: the only change to the originals is that they import each other from this folder instead of from www.gstatic.com.\n`);
    return { version, files: FIREBASE_FILES };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = vendorFirebase({ version: process.argv[2] || FIREBASE_VERSION });
  console.log(`firebase-sdk/ now holds Firebase ${r.version}: ${r.files.join(', ')}`);
}
