// cron/push.mjs — the push server. Run it every minute while testing (afterwards every 5 minutes):
//   node push.mjs
// What it does, only while the test switch (settings/push.mode = 'test') or the push switch of Ritten ruilen (settings/push.live = true) is on
// (otherwise it does nothing at all, and says so):
//   1. makes the push key pair once (secrets folder, push-vapid.json) and publishes the PUBLIC half in settings/pushKey, so the app can subscribe;
//   2. runs the check that the app only does while someone has it open: a Ritten-ruilen offer still open at 18:00 the day before is announced
//      once to the offerer and the day coordinator (same rules as checkRitbeurs in ritbeurs-data.js; the first one to write wins);
//   3. sends every due entry of pushQueue/ and notes per device what was sent (sentTo/failedTo), so nothing goes out twice. Where it goes is
//      decided by routeEntry (push.js): a REAL notification goes to the devices of the family it is for, as a plain message, while live is on
//      (only notifications made after live was switched on, and only to phones switched on before that notification); made-up scenarios, the
//      "Stuur naar mijn toestel" button and (while live is off) copies of real ones go to the coordinator's test devices only, labelled
//      "Test · Ouder van Saar", while the test switch is on;
//   4. removes devices the push service says are gone, expired queue entries and expired made-up notifications;
//   5. reports itself in settings/pushStatus, so Beheer can show that the server is alive.
// Safe to run at any time and as often as you like; a lock keeps two runs from overlapping.
// Needs: the service account with "Cloud Datastore User" (calendar-key.json). Writes the push key file in the secrets folder (mode 600).
process.env.TZ = 'Europe/Amsterdam';   // 18:00 and the quiet hours are Amsterdam time, whatever time zone the host is in
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readServiceAccount, tokenProvider } from './lib/google-auth.mjs';
import { createFirestore, decodeFields } from './lib/firestore-rest.mjs';
import { ensureVapidFile, sendPush } from './lib/webpush.mjs';
import { dataDir, loadConfig, secretsDir, codeDir, isMainModule } from './lib/setup.mjs';
import { skipReason } from './lib/run-window.mjs';

// Reads cost quota (Firestore free plan: 50,000 a day for the whole app). So: no runs at night (the quiet hours of a family are 22:00-06:00 by
// default, so nothing is lost: an entry that was due waits and goes out from 05:00), and only read what a run really needs.
export const PUSH_QUIET = { fromHour: 0, toHour: 5 };

// The app modules this job reuses (and everything they import). scripts/build-cron.mjs copies them to <cron folder>/app/.
export const PUSH_APP_MODULES = ['push.js', 'notif-text.js', 'ritbeurs.js', 'dates.js', 'state.js'];

export async function loadPushApp(dir = codeDir) {
  const base = existsSync(join(dir, 'app', 'push.js')) ? join(dir, 'app') : join(dir, '..');
  const load = f => import(pathToFileURL(join(base, f)).href);
  const [push, text, ritbeurs, dates, state] = await Promise.all(PUSH_APP_MODULES.map(load));
  return { ...push, ...text, ...ritbeurs, ...dates, S: state.S };
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
async function readDoc(firestore, path) {
  const d = await firestore.getDocument(path);
  return d ? { data: decodeFields(d.fields), updateTime: d.updateTime } : null;
}

// ---------- the key pair ----------
// Makes the key file when it is not there yet and publishes the public key when the database has another one. Returns the keys.
export async function ensureVapid({ firestore, file, subject, now = Date.now(), log = console.log }) {
  const { vapid, created } = ensureVapidFile(file, subject);
  if (created) log('Push: new key pair made (' + file + ')');
  const published = await readDoc(firestore, 'settings/pushKey');
  if (!published || published.data.publicKey !== vapid.publicKey) {
    await firestore.setDocument('settings/pushKey', { publicKey: vapid.publicKey, updatedAt: now });
    log('Push: public key published in settings/pushKey');
  }
  return vapid;
}

// ---------- "niet gedekt": an offer still open at 18:00 the day before ----------
// The same rule as checkRitbeurs in the app, done on the server so it also happens when nobody has the app open. The offer is changed
// only in the version that was read and the notifications are CREATED (never overwritten), all in one commit: when the app (or a second
// run) was first, nothing is written. Returns the number of offers announced.
export async function runUncovered({ firestore, app, now = Date.now(), log = console.log }) {
  const sw = await readDoc(firestore, 'settings/ritbeurs');
  if (!app.normalizeRitbeurs(sw && sw.data).on) return 0;
  const offers = await readCollection(firestore, 'offers');
  app.refreshWeekKey();
  const weekKey = app.S.currentWeekKey;
  // Only an offer that is open, from this week, not announced yet and past its 18:00 deadline needs anything else. Without one (almost always)
  // the families and the day coordinators are not read at all.
  const due = offers.filter(({ data: o }) => o && o.status === 'open' && o.weekKey === weekKey && !o.uncoveredAt && app.urgency(o.date, now) === 'late' && app.rideStartMs(o.date, o.time) > now);
  if (!due.length) return 0;
  const [families, dcDoc] = await Promise.all([readCollection(firestore, 'families'), readDoc(firestore, 'settings/dayCoordinators')]);
  const fams = Object.fromEntries(families.map(f => [f.id, f.data]));
  const dayCoordinators = dcDoc ? dcDoc.data : {};
  let announced = 0;
  for (const { id, data: o, updateTime } of due) {
    const dc = dayCoordinators[o.day];
    const recipients = [...new Set([o.offeredBy, dc].filter(to => to && fams[to]))];
    const writes = [{ update: 'offers/' + id, fields: { uncoveredAt: now }, updateTime }];
    for (const to of recipients) {
      const doc = app.notificationDoc({ kind: 'uncovered', to, offer: o, sourceId: id, fromFamilyId: '', nowMs: now, quiet: app.normalizeQuiet(fams[to].ritbeursQuiet) });
      const path = `families/${to}/notifications/${app.notificationId('uncovered', id, to)}`;
      writes.push({ create: path, data: doc });
      writes.push({ create: 'pushQueue/' + app.queueKey(path), data: app.queueDoc({ path, toFamilyId: to, kind: 'uncovered', deliverAt: doc.deliverAt, expiresAt: doc.expiresAt, nowMs: now, test: false }) });
    }
    if (await firestore.commit(writes)) { announced++; log(`Push: offer ${id} not covered, ${recipients.length} notification(s) made`); }
  }
  return announced;
}

// ---------- the sending ----------
export async function runPush({ firestore, app, send = sendPush, vapidFile, subject, now = Date.now(), log = console.log, warn = console.error }) {
  const settings = await readDoc(firestore, 'settings/push');
  const switches = app.normalizePush(settings && settings.data);
  const mode = switches.mode, live = switches.live;
  if (mode !== 'test' && !live) { log('Push: test and push switch are both off, nothing done'); return { mode, live, sent: 0, pending: 0, failed: 0, removed: 0 }; }

  const vapid = await ensureVapid({ firestore, file: vapidFile, subject, now, log });
  const announced = await runUncovered({ firestore, app, now, log });

  // The queue first: when it is empty (almost always) there is nothing to send, and the devices and the families are not read at all.
  const queue = await readCollection(firestore, 'pushQueue');
  const looked = queue.length > 0;
  let fams = {}, devices = {};
  if (looked) {
    const [deviceDocs, familyDocs] = await Promise.all([readCollection(firestore, 'pushDevices'), readCollection(firestore, 'families')]);
    fams = Object.fromEntries(familyDocs.map(f => [f.id, f.data]));
    // Only real push addresses. The database rules decide who may store one: the coordinator (a test device, owner 'coordinator') and a member
    // for the own family (familyId, only while live is on). devicesFor picks the ones an entry may go to.
    devices = Object.fromEntries(deviceDocs.filter(d => app.isPushEndpoint(d.data.endpoint)).map(d => [d.id, d.data]));
  }
  app.refreshWeekKey();
  const nameOf = id => (fams[id] && (fams[id].parentName || fams[id].girlName)) || '';

  let sent = 0, failed = 0, pending = 0, removed = 0;
  const targetCache = new Map();
  const targetOf = async path => { if (!targetCache.has(path)) targetCache.set(path, await readDoc(firestore, path)); return targetCache.get(path); };

  for (const { id: key, data: entry, updateTime } of queue.sort((a, b) => (a.data.createdAt || 0) - (b.data.createdAt || 0))) {
    if (!entry || typeof entry !== 'object' || !(entry.expiresAt > now)) {
      // Expired: the entry goes, and a made-up notification with it (real ones are removed by their own family's app).
      if (await firestore.commit([{ delete: 'pushQueue/' + key }])) removed++;
      if (entry && typeof entry.path === 'string' && entry.path.startsWith('testNotifications/')) await firestore.deleteDocument(entry.path);
      continue;
    }
    const route = app.routeEntry(entry, settings && settings.data);
    if (route === 'none') continue;   // its switch is off (or it is a test copy and only live is on): leave it, it expires by itself
    const pool = app.devicesFor(route, entry, devices);
    const plan = app.entryPlan({ entry, devices: pool, nowMs: now });
    if (plan.state === 'wacht') { pending++; continue; }
    if (plan.state === 'geen-toestel') { if (route === 'coordinator') pending++; continue; }   // a family without a phone simply gets no push
    if (plan.state === 'klaar') continue;
    // state 'open': there are devices that still have to get it.
    const target = await targetOf(entry.path);
    if (!target) { if (await firestore.commit([{ delete: 'pushQueue/' + key }])) removed++; continue; }   // the notification itself is gone
    const text = app.notificationText(target.data, { nameOf, currentWeekKey: app.S.currentWeekKey });
    if (!text) {
      // A kind this version does not know (a newer app wrote it): give it up once, instead of complaining every minute.
      warn(`Push: ${entry.path} has a kind this version does not know (${target.data.kind}); given up`);
      await firestore.commit([{ update: 'pushQueue/' + key, fields: { failedTo: Object.fromEntries(plan.targets.map(id => [id, app.MAX_FAILS])) }, updateTime }]);
      continue;
    }
    const payload = JSON.stringify(route === 'family'
      ? app.buildLivePayload({ text, key })
      : app.buildPayload({ text, who: app.recipientLabel(fams[entry.toFamilyId], entry.toFamilyId), key, forFamilyId: entry.toFamilyId }));
    const sentTo = { ...(entry.sentTo || {}) }, failedTo = { ...(entry.failedTo || {}) };
    for (const deviceId of plan.targets) {
      const d = pool[deviceId];
      const res = await send({ subscription: { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth }, payload, vapid, topic: key, now });
      if (res.ok) {
        sentTo[deviceId] = now; sent++;
        await firestore.commit([{ update: 'pushDevices/' + deviceId, fields: { lastOkAt: now } }]);
      } else if (res.gone) {
        await firestore.deleteDocument('pushDevices/' + deviceId); delete devices[deviceId]; delete pool[deviceId]; removed++;
        warn(`Push: device ${deviceId} is gone (HTTP ${res.status}); removed`);
      } else {
        failedTo[deviceId] = (failedTo[deviceId] || 0) + 1; failed++;
        warn(`Push: sending to device ${deviceId} failed (${res.status || res.error}); try ${failedTo[deviceId]} of ${app.MAX_FAILS}`);
      }
    }
    // Remember what was done, in the version that was read (an entry deleted or changed meanwhile is left alone; the tag collapses a repeat).
    await firestore.commit([{ update: 'pushQueue/' + key, fields: { sentTo, failedTo }, updateTime }]);
  }

  // The device counts are only known when the devices were read (a non-empty queue); the app only uses lastRunAt, sent and pending.
  const testDevices = Object.values(devices).filter(d => d.owner === 'coordinator').length;
  const familyDevices = Object.values(devices).filter(d => typeof d.familyId === 'string' && d.familyId).length;
  await firestore.setDocument('settings/pushStatus', { lastRunAt: now, mode, live, sent, failed, pending, ...(looked ? { devices: testDevices, familyDevices } : {}), announced });
  log(`Push (test ${mode === 'test' ? 'on' : 'off'}, live ${live ? 'on' : 'off'}): ${sent} sent, ${failed} failed, ${pending} waiting, ${removed} removed, ${announced} offer(s) announced${looked ? `, ${testDevices} test device(s), ${familyDevices} family device(s)` : ', queue empty'}`);
  return { mode, live, sent, failed, pending, removed, announced };
}

// ---------- a lock, so two runs never overlap ----------
export async function withLock(file, fn, { now = Date.now(), staleMs = 5 * 60 * 1000, log = console.log } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  let fd;
  try { fd = openSync(file, 'wx'); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let age = 0;
    try { age = now - statSync(file).mtimeMs; } catch (err) { /* it just went away: try once more below */ }
    if (Math.abs(age) < staleMs) { log('Push: another run is busy; skipped'); return null; }
    try { unlinkSync(file); } catch (err) { /* someone else did */ }
    try { fd = openSync(file, 'wx'); } catch (err) { log('Push: another run is busy; skipped'); return null; }
  }
  try { writeSync(fd, String(process.pid)); closeSync(fd); fd = null; return await fn(); }
  finally { if (fd != null) { try { closeSync(fd); } catch (e) { /* closed */ } } try { unlinkSync(file); } catch (e) { /* gone */ } }
}

if (isMainModule(import.meta.url)) {
  try {
    const why = skipReason({ nowMs: Date.now(), quiet: PUSH_QUIET });
    if (why) { console.log('Push: ' + why + ', nothing done'); process.exit(0); }
    const { projectId, referer } = loadConfig();
    const account = readServiceAccount(join(secretsDir(), 'calendar-key.json'));
    const firestore = createFirestore({ projectId, getToken: tokenProvider({ account }) });
    const app = await loadPushApp();
    await withLock(join(dataDir(), 'push.lock'), () => runPush({ firestore, app, vapidFile: join(secretsDir(), 'push-vapid.json'), subject: referer }));
  } catch (e) { console.error('PUSH FAILED: ' + e.message); process.exit(1); }
}
