// scripts/build-cron.mjs — `npm run build:cron`
// Builds the folder with the cron jobs that is uploaded to ~/azcarpool-cron/ on the host (default: dist-cron/).
// It copies cron/ and adds config.json: the public values the jobs need (Firebase project id, the Calendar key),
// taken from firebase-config.js so they are never typed twice. Key files with secrets are NOT part of this.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { APP_MODULES } from '../cron/purge.mjs';
import { AGENDA_APP_MODULES } from '../cron/agenda.mjs';
import { PUSH_APP_MODULES } from '../cron/push.mjs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CRON_REFERER = 'https://azcarpool.nl/';

export function cronConfig(rootDir = root) {
  const src = readFileSync(join(rootDir, 'firebase-config.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const projectId = (src.match(/projectId:\s*"([^"]+)"/) || [])[1];
  const calendarApiKey = (src.match(/googleCalendarApiKey\s*=\s*"([^"]+)"/) || [])[1];
  if (!projectId || !calendarApiKey) throw new Error('firebase-config.js: projectId or googleCalendarApiKey not found');
  return { projectId, calendarApiKey, referer: CRON_REFERER };
}

function copyTree(from, to, written, prefix = '') {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const f = join(from, name), t = join(to, name);
    if (statSync(f).isDirectory()) copyTree(f, t, written, prefix + name + '/');
    else { writeFileSync(t, readFileSync(f)); written.push(prefix + name); }
  }
}

// The app modules the jobs reuse (cron/purge.mjs APP_MODULES, cron/agenda.mjs AGENDA_APP_MODULES, cron/push.mjs PUSH_APP_MODULES) plus everything they import, so the jobs work with the very
// same code as the app. Static `import ... from './x.js'` only; a missing file is an error, not a silent gap.
export function appClosure(rootDir = root, entries = [...new Set([...APP_MODULES, ...AGENDA_APP_MODULES, ...PUSH_APP_MODULES])]) {
  const seen = new Set(), todo = [...entries];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    if (!existsSync(join(rootDir, f))) throw new Error('app module not found: ' + f);
    seen.add(f);
    const src = readFileSync(join(rootDir, f), 'utf8');
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]\.\/([^'"]+\.js)['"]|(?:^|\n)\s*import\s*['"]\.\/([^'"]+\.js)['"]/g)) todo.push(m[1] || m[2]);
  }
  return [...seen].sort();
}

export function buildCron({ rootDir = root, out = join(root, 'dist-cron') } = {}) {
  const from = join(rootDir, 'cron');
  if (!existsSync(join(from, 'run.sh'))) throw new Error('cron/run.sh not found');
  rmSync(out, { recursive: true, force: true });
  const written = [];
  copyTree(from, out, written);
  mkdirSync(join(out, 'app'), { recursive: true });
  for (const f of appClosure(rootDir)) { writeFileSync(join(out, 'app', f), readFileSync(join(rootDir, f))); written.push('app/' + f); }
  writeFileSync(join(out, 'package.json'), '{\n  "type": "module",\n  "private": true\n}\n'); written.push('package.json');   // so the copied app modules (.js) are read as modules
  writeFileSync(join(out, 'config.json'), JSON.stringify(cronConfig(rootDir), null, 2) + '\n'); written.push('config.json');
  const secret = written.filter(f => /key.*\.json$|\.pem$|\.env$/i.test(f) && f !== 'config.json');
  if (secret.length) throw new Error('Refusing to build: secret-looking files in cron/: ' + secret.join(', '));
  return { out, files: written.sort() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const i = process.argv.indexOf('--out');
    const r = buildCron({ out: i > -1 ? resolve(process.argv[i + 1]) : join(root, 'dist-cron') });
    console.log(`Cron folder ready: ${r.out}\n${r.files.length} files`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
