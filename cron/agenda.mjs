// cron/agenda.mjs — the calendar subscriptions: for every family with a link, two .ics files with the next 3 weeks of rides: the rides the family drives and the rides their daughter sits in.
//   node agenda.mjs
// The family's links (Instellingen > Agenda) are https://azcarpool.nl/agenda/<secret>.ics. The secrets are in calendarTokens/<familyId> (daughter)
// and driverCalendarTokens/<familyId> (parents), made by the app.
// This job reads the database, asks the SAME app code as Mijn week what the rides are (calendar-feed.js + rides.js), and writes
// <web folder>/agenda/<secret>.ics. Calendar apps fetch that file by themselves (Google about once a day, Apple more often).
// Safe to run at any time and as often as you like: a file whose content did not change is not rewritten; a file whose link was removed is deleted.
// Needs: the service account with "Cloud Datastore User" (calendar-key.json). Writes only inside the agenda folder.
process.env.TZ = 'Europe/Amsterdam';   // the shift times are Amsterdam time, whatever time zone the host is in
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readServiceAccount, tokenProvider } from './lib/google-auth.mjs';
import { createFirestore, decodeFields } from './lib/firestore-rest.mjs';
import { agendaDir, dataDir, loadConfig, secretsDir, codeDir, isMainModule } from './lib/setup.mjs';
import { skipReason, lastRunAt, markRun } from './lib/run-window.mjs';

// This job reads 9 whole collections per run, and calendar apps only fetch the file every hour at best (Google about once a day). So the job
// does its work at most once an hour (the cron line may stay every 30 minutes) and not at night. Reads cost quota (Firestore free plan: 50,000 a day).
export const AGENDA_QUIET = { fromHour: 0, toHour: 6 };
export const AGENDA_MIN_GAP_MS = 50 * 60 * 1000;

// Change check (quota): most runs find nothing new. Before reading the 9 collections the job reads a handful of small documents: the two "last
// update" stamps of the app (Rooster, Wijzigen) and the two link collections (a new or removed link must show up at once). Together with the Amsterdam
// date and whether the planning week has ended (the 3 weeks of the calendar move at Friday 19:00 and at midnight) that is the SIGNATURE of the data.
// Same signature as at the last full run, and that run less than AGENDA_FULL_MAX_AGE_MS ago: nothing is read or written. The stamps are best effort in
// the app and not every change records one (a period, a match carpool, a family), so a full run still happens every 3 hours as a safety net.
export const AGENDA_FULL_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const STATE_FILE = 'agenda.state.json';

// PURE. The signature from what was read ({ rooster, deviation }: the `at` of the stamp or ''; tokens: [{ id, token }] of both link collections).
export function agendaSignature({ rooster = '', deviation = '', tokens = [], nowMs, weekEnded = false }) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
  const links = tokens.map(t => t.id + ':' + t.token).sort().join(',');
  return JSON.stringify({ rooster: String(rooster), deviation: String(deviation), links, day, weekEnded: !!weekEnded });
}
// PURE. true = do the full run. A missing or unreadable state, a changed signature, a last full run in the future or too long ago: yes.
export function needsFullRun({ signature, state, nowMs, maxAgeMs = AGENDA_FULL_MAX_AGE_MS }) {
  if (!state || typeof state.signature !== 'string' || typeof state.fullAt !== 'number') return true;
  if (state.signature !== signature) return true;
  if (state.fullAt > nowMs || nowMs - state.fullAt >= maxAgeMs) return true;
  return false;
}
// The small reads (about 11 documents). Never throws for a missing document; a read error does throw, and the caller then does the full run.
export async function readAgendaSignature({ firestore, now = Date.now() }) {
  const atOf = async path => { const d = await firestore.getDocument(path); const f = d ? decodeFields(d.fields) : null; return f && f.at != null ? f.at : ''; };
  const list = async (path, role) => (await firestore.listDocuments(path)).filter(d => d.createTime)
    .map(d => ({ id: role + '/' + d.name.slice(d.name.lastIndexOf('/') + 1), token: (decodeFields(d.fields) || {}).token || '' }));
  const [rooster, deviation, girl, driver] = await Promise.all([atOf('settings/lastUpdateRooster'), atOf('settings/lastUpdateDeviation'), list('calendarTokens', 'girl'), list('driverCalendarTokens', 'driver')]);
  const d = new Date(now), weekEnded = d.getDay() === 6 || d.getDay() === 0 || (d.getDay() === 5 && d.getHours() >= 19);
  return agendaSignature({ rooster, deviation, tokens: [...girl, ...driver], nowMs: now, weekEnded });
}
export function readAgendaState(file) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return null; } }
export function writeAgendaState(file, state) { try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(state), { mode: 0o600 }); } catch (e) { /* best effort */ } }

// The app modules this job reuses (and everything they import). scripts/build-cron.mjs copies them to <cron folder>/app/.
export const AGENDA_APP_MODULES = ['calendar-feed.js', 'rides.js', 'period.js', 'state.js', 'i18n.js'];

export async function loadAgendaApp(dir = codeDir) {
  const base = existsSync(join(dir, 'app', 'calendar-feed.js')) ? join(dir, 'app') : join(dir, '..');
  const load = f => import(pathToFileURL(join(base, f)).href);
  const [feed, rides, period, state, i18n] = await Promise.all(AGENDA_APP_MODULES.map(load));
  return { ...feed, ...rides, ...period, t: i18n.t, S: state.S };
}

// What the web server needs to know about this folder: plain text/calendar, never a directory listing, no search engines.
// Each rule is guarded, so a host without that Apache module still serves the files instead of an error page.
export const HTACCESS = `# Made by cron/agenda.mjs. Do not edit: it is rewritten when it differs.
Options -Indexes
<IfModule mod_mime.c>
  AddType text/calendar .ics
  AddCharset UTF-8 .ics
</IfModule>
<IfModule mod_headers.c>
  <FilesMatch "\\.ics$">
    Header set Cache-Control "public, max-age=900"
    Header set X-Robots-Tag "noindex, nofollow"
  </FilesMatch>
</IfModule>
`;

const lastPart = name => name.slice(name.lastIndexOf('/') + 1);
async function readCollection(firestore, path) {
  const out = {};
  for (const doc of await firestore.listDocuments(path)) {
    if (!doc.createTime) continue;   // an "empty" parent that only holds sub-collections
    out[lastPart(doc.name)] = decodeFields(doc.fields);
  }
  return out;
}
const readDoc = async (firestore, path) => { const d = await firestore.getDocument(path); return d ? decodeFields(d.fields) : null; };

// PURE. Two files with the same events are the same calendar: only the time stamp differs between two runs.
const sameCalendar = (a, b) => a.replace(/^DTSTAMP:.*\r?\n/gm, '') === b.replace(/^DTSTAMP:.*\r?\n/gm, '');

// Writes a file so a calendar app never fetches a half-written one: a temporary file in the same folder, then a rename.
function writeAtomic(file, text) { const tmp = file + '.tmp'; writeFileSync(tmp, text, { mode: 0o644 }); renameSync(tmp, file); }

export async function runAgenda({ firestore, app, outDir, now = Date.now(), log = console.log, warn = console.error }) {
  const { S } = app;
  const [families, groups, deviations, periodsColl, periodEntries, periodCars, matchCarpools, tokens, driverTokens] = await Promise.all(
    ['families', 'groups', 'deviations', 'periods', 'periodEntries', 'periodCars', 'matchCarpools', 'calendarTokens', 'driverCalendarTokens'].map(c => readCollection(firestore, c)));
  const [legacy, locations, planning] = await Promise.all(['settings/period', 'settings/locations', 'settings/planning'].map(p => readDoc(firestore, p)));
  Object.assign(S, {
    families, groups, deviations, periodEntries, periodCars, matchCarpools, locationsDoc: locations,
    periods: app.mergePeriods(periodsColl, legacy),
    settings: { ...S.settings, ...(planning || {}) },
  });

  // Which links are valid: a well-formed secret, of a family that exists, used once only (over both kinds of link: a secret is a file name).
  // 'girl' = the calendar with the rides the daughter sits in, 'driver' = the calendar with the rides the family drives.
  const wanted = new Map();   // secret -> { familyId, role }
  const seen = new Map();
  for (const [role, docs] of [['girl', tokens], ['driver', driverTokens]]) {
    for (const [familyId, doc] of Object.entries(docs)) {
      const token = doc && doc.token;
      if (typeof token !== 'string' || !app.TOKEN_RE.test(token)) { warn(`WARNING: the ${role} link of ${familyId} is not a valid secret and is ignored`); continue; }
      if (!families[familyId]) continue;   // a family that was removed: its file goes away below
      if (seen.has(token)) { warn(`WARNING: two links have the same secret (${seen.get(token)} and ${role} ${familyId}); both are ignored`); wanted.delete(token); continue; }
      seen.set(token, `${role} ${familyId}`); wanted.set(token, { familyId, role });
    }
  }

  mkdirSync(outDir, { recursive: true, mode: 0o755 });
  const ht = join(outDir, '.htaccess');
  if (!existsSync(ht) || readFileSync(ht, 'utf8') !== HTACCESS) writeAtomic(ht, HTACCESS);

  let written = 0, unchanged = 0, removed = 0;
  for (const [token, { familyId, role }] of wanted) {
    const f = families[familyId];
    const name = role === 'driver'
      ? app.t('agenda.kalendernaam_rijden', { name: f.parentName || f.girlName || familyId })
      : app.t('agenda.kalendernaam', { name: f.girlName || f.parentName || familyId });
    const events = role === 'driver' ? app.driverFeedEvents(familyId, S, now) : app.feedEvents(familyId, S, now);
    const text = app.buildIcs({ name, events, nowMs: now });
    const file = join(outDir, token + '.ics');
    if (existsSync(file) && sameCalendar(readFileSync(file, 'utf8'), text)) { unchanged++; continue; }
    writeAtomic(file, text); written++;
  }

  // Remove files whose link no longer exists. Not when no family was read at all: that looks like a read problem, not a real change.
  if (Object.keys(families).length) {
    for (const name of readdirSync(outDir)) {
      const m = /^(.+)\.ics$/.exec(name);
      if (m && app.TOKEN_RE.test(m[1]) && !wanted.has(m[1])) { unlinkSync(join(outDir, name)); removed++; }
    }
  }
  log(`Agenda: ${wanted.size} calendars, ${written} written, ${unchanged} unchanged, ${removed} removed`);
  return { calendars: wanted.size, written, unchanged, removed };
}

if (isMainModule(import.meta.url)) {
  try {
    const stamp = join(dataDir(), 'agenda.lastrun');
    const why = skipReason({ nowMs: Date.now(), quiet: AGENDA_QUIET, lastMs: lastRunAt(stamp), minGapMs: AGENDA_MIN_GAP_MS });
    if (why) { console.log('Agenda: ' + why + ', nothing done'); process.exit(0); }
    const { projectId } = loadConfig();
    const account = readServiceAccount(join(secretsDir(), 'calendar-key.json'));
    const firestore = createFirestore({ projectId, getToken: tokenProvider({ account }) });
    const stateFile = join(dataDir(), STATE_FILE);
    let signature = null;
    try { signature = await readAgendaSignature({ firestore }); } catch (e) { console.error('Agenda: change check failed (' + e.message + '), doing the full run'); }
    if (signature && !needsFullRun({ signature, state: readAgendaState(stateFile), nowMs: Date.now() })) {
      markRun(stamp, Date.now());
      console.log('Agenda: nothing changed, nothing done');
      process.exit(0);
    }
    await runAgenda({ firestore, app: await loadAgendaApp(), outDir: agendaDir() });
    markRun(stamp, Date.now());
    if (signature) writeAgendaState(stateFile, { signature, fullAt: Date.now() });
  } catch (e) { console.error('AGENDA FAILED: ' + e.message); process.exit(1); }
}
