// cron/purge.mjs — the weekly clean-up, on the server: Friday 19:00 the changes (Wijzigen) of the week that just ended expire.
//   node purge.mjs
// What the app used to do by itself when the first member opened it (data.js: logPassedShifts + purgeStaleDeviations), now done by the host:
//   1. log the rides that were driven (rideLog/<date>_<heen|terug>) with the SAME app code, so a ride that ran on a one-off change is counted;
//   2. delete the deviations of an older week whose own `expiresAt` has passed.
//   3. (first, on its own) delete error-log entries (errorLog/) older than 30 days.
// Nothing is deleted when step 1 failed. A deviation that was changed after it was read is not deleted either.
// Safe to run at any time and as often as you like: it only removes what has expired, and logs only what is not logged yet.
// The app keeps its own purge as a safety net, for when this job is down.
// Needs: the service account with "Cloud Datastore User" (calendar-key.json): reads the data, writes rideLog, deletes deviations.
process.env.TZ = 'Europe/Amsterdam';   // the week, Friday 19:00 and the shift times are Amsterdam time, whatever time zone the host is in
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readServiceAccount, tokenProvider } from './lib/google-auth.mjs';
import { createFirestore, decodeFields } from './lib/firestore-rest.mjs';
import { loadConfig, secretsDir, codeDir } from './lib/setup.mjs';

// The app modules this job reuses (and everything they import). scripts/build-cron.mjs copies them to <cron folder>/app/.
export const APP_MODULES = ['rides.js', 'ride-log.js', 'dates.js', 'period.js', 'state.js'];

// In the repo the app is one folder up; on the host the build put a copy in app/.
export async function loadApp(dir = codeDir) {
  const base = existsSync(join(dir, 'app', 'rides.js')) ? join(dir, 'app') : join(dir, '..');
  const load = f => import(pathToFileURL(join(base, f)).href);
  const [rides, rideLog, dates, period, state] = await Promise.all(APP_MODULES.map(load));
  return { ...rides, ...rideLog, ...dates, ...period, S: state.S };
}

// PURE. Which deviations may go: those of an OLDER week (ISO keys like "2026-W39" sort as text) whose own expiry has passed.
// Same rule as purgeStaleDeviations in data.js (and firestore.rules refuses an earlier delete anyway). Never a newer week's deviation.
export function staleDeviations(list, currentWeekKey, now) {
  return list.filter(({ data }) => {
    const olderWeek = !data.weekKey || data.weekKey < currentWeekKey;
    const expired = typeof data.expiresAt !== 'number' || data.expiresAt <= now;
    return olderWeek && expired;
  });
}

// PURE. Error-log entries (errorLog/, see error-log.js) older than the keep period, or without a usable time stamp. 30 days, same as the app's own safety net.
export const LOG_KEEP_DAYS = 30;
export function staleErrorLogs(list, now, keepDays = LOG_KEEP_DAYS) {
  const cutoff = now - keepDays * 24 * 60 * 60 * 1000;
  return list.filter(({ data }) => typeof data.at !== 'number' || data.at < cutoff);
}

const lastPart = name => name.slice(name.lastIndexOf('/') + 1);
async function readCollection(firestore, path) {
  const out = [];
  for (const doc of await firestore.listDocuments(path)) {
    if (!doc.createTime) continue;   // an "empty" parent that only holds sub-collections
    out.push({ id: lastPart(doc.name), data: decodeFields(doc.fields), updateTime: doc.updateTime });
  }
  return out;
}
const byId = list => Object.fromEntries(list.map(d => [d.id, d.data]));

export async function runPurge({ firestore, app, now = Date.now(), log = console.log, warn = console.error }) {
  const { S } = app;

  // 0. The error log: entries older than 30 days go. Independent of the rest: a problem here never stops the ride logging, nor the other way round.
  let logsDeleted = 0;
  try {
    for (const d of staleErrorLogs(await readCollection(firestore, 'errorLog'), now)) {
      if (await firestore.deleteDocument('errorLog/' + d.id, { updateTime: d.updateTime })) logsDeleted++;
    }
    if (logsDeleted) log(`Error log: ${logsDeleted} entries older than ${LOG_KEEP_DAYS} days deleted`);
  } catch (e) { warn('WARNING: could not clean the error log: ' + e.message); }
  const [deviations, families, groups, periodsColl, periodCars, rideLog] = await Promise.all(
    ['deviations', 'families', 'groups', 'periods', 'periodCars', 'rideLog'].map(c => readCollection(firestore, c)));
  const legacy = await firestore.getDocument('settings/period');

  Object.assign(S, {
    deviations: byId(deviations), families: byId(families), groups: byId(groups), periodCars: byId(periodCars), rideLog: byId(rideLog),
    periods: app.mergePeriods(byId(periodsColl), legacy ? decodeFields(legacy.fields) : null),
  });
  app.refreshWeekKey();   // from Friday 19:00 this is already the coming week

  // 1. Log the rides that were driven: last week and this planning week, like logPassedShifts. A failure stops everything: nothing is deleted.
  const planning = app.effectivePlanningDate(), lastWeek = new Date(planning); lastWeek.setDate(planning.getDate() - 7);
  const docs = app.newLogDocs({
    weekKeys: [app.getISOWeekKey(lastWeek), S.currentWeekKey], families: S.families, logged: S.rideLog, nowMs: now, isoOf: app.weekKeyDayIso,
    carsOf: (weekKey, day, direction) => app.effectiveCars(day, direction, { ...S, currentWeekKey: weekKey }),
  });
  for (const [id, doc] of docs) await firestore.setDocument('rideLog/' + id, doc);

  // 2. Delete the expired deviations, each one only in the version that was read.
  const stale = staleDeviations(deviations, S.currentWeekKey, now);
  let deleted = 0, skipped = 0;
  for (const d of stale) { (await firestore.deleteDocument('deviations/' + d.id, { updateTime: d.updateTime })) ? deleted++ : skipped++; }
  if (skipped) warn(`WARNING: ${skipped} change(s) were changed or removed while the job ran and were left alone`);
  log(`Purge (planning week ${S.currentWeekKey}): ${docs.length} rides logged, ${deleted} of ${deviations.length} changes deleted`);
  return { logged: docs.length, deleted, skipped, kept: deviations.length - stale.length, logsDeleted };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { projectId } = loadConfig();
    const account = readServiceAccount(join(secretsDir(), 'calendar-key.json'));
    const firestore = createFirestore({ projectId, getToken: tokenProvider({ account }) });
    await runPurge({ firestore, app: await loadApp() });
  } catch (e) { console.error('PURGE FAILED: ' + e.message); process.exit(1); }
}
