// Run with: node cron-purge.test.js
// cron/purge.mjs: the weekly clean-up on the server. It must log the driven rides exactly like the app does (data.js logPassedShifts),
// delete only expired changes of an OLDER week, never delete when logging failed, and work whatever time zone the host is in.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installFakeDom, resetState, sampleCoordinatorState, sampleDbSeed, useFakeDb, withFakeNowAsync } from './test-support.js';
import { S } from '../state.js';
import { logPassedShifts } from '../data.js';
import { encodeFields, decodeFields } from '../cron/lib/firestore-rest.mjs';
import { buildCron } from '../scripts/build-cron.mjs';
import { runPurge, staleDeviations, staleErrorLogs, LOG_KEEP_DAYS, loadApp, APP_MODULES } from '../cron/purge.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
installFakeDom();

// Saturday 3 October 2026, 00:05 in Amsterdam: week 40 (28 Sep - 2 Oct) has just ended, the planning week is 41.
const SAT = '2026-10-03T00:05:00+02:00';
const satMs = new Date(SAT).getTime();
const EXPIRES_W40 = new Date('2026-10-03T00:00:00+02:00').getTime(), EXPIRES_W41 = new Date('2026-10-10T00:00:00+02:00').getTime();
const car = (driver, girls, time) => ({ driverFamilyId: driver, girlIds: girls, reserveFamilyIds: [], departureTime: time });
const dev = (day, direction, weekKey, expiresAt, cars) => ({ day, direction, weekKey, expiresAt, cars });
// The database as it is on Saturday morning: standard rooster (Ma), one-off changes of week 40 and one of week 41.
function seed() {
  const s = sampleDbSeed();
  delete s['deviations/Di_heen'];
  s['deviations/Di_heen'] = dev('Di', 'heen', '2026-W40', EXPIRES_W40, [car('f3', ['f1', 'f4'], '09:15')]);
  s['deviations/Do_terug'] = dev('Do', 'terug', '2026-W40', EXPIRES_W40, [car('f4', ['f2'], '17:00')]);
  s['deviations/Wo_heen'] = dev('Wo', 'heen', '2026-W41', EXPIRES_W41, [car('f1', ['f3'], '10:30')]);
  s['deviations/Vr_heen'] = { day: 'Vr', direction: 'heen', cars: [car('f2', ['f1'], '10:00')] };   // very old: no week, no expiry
  return s;
}

// A fake Firestore with the same calls as cron/lib/firestore-rest.mjs. Every document gets an updateTime that changes when it is written.
function fakeFirestore(seedDocs, { failSet = false } = {}) {
  const data = new Map(Object.entries(seedDocs).map(([k, v]) => [k, structuredClone(v)]));
  const version = new Map([...data.keys()].map(k => [k, 'v1']));
  const calls = { set: [], del: [] };
  const root = 'projects/az-carpool/databases/(default)/documents';
  return { data, version, calls,
    listDocuments: async c => [...data.keys()].filter(k => k.startsWith(c + '/') && k.split('/').length === 2).sort()
      .map(k => ({ name: `${root}/${k}`, fields: encodeFields(data.get(k)), createTime: 't', updateTime: version.get(k) })),
    getDocument: async p => data.has(p) ? { name: `${root}/${p}`, fields: encodeFields(data.get(p)), createTime: 't', updateTime: version.get(p) } : null,
    setDocument: async (p, d) => { if (failSet) throw new Error('Firestore POST failed: HTTP 503 down'); calls.set.push(p); data.set(p, decodeFields(encodeFields(d))); version.set(p, 'v' + Math.random()); },
    deleteDocument: async (p, { updateTime } = {}) => { if (updateTime && version.get(p) !== updateTime) return false; calls.del.push(p); data.delete(p); version.delete(p); return true; },
  };
}
const quiet = () => { const warnings = []; return { log: () => {}, warn: w => warnings.push(w), warnings }; };
const run = (fs, extra = {}) => withFakeNowAsync(SAT, async () => runPurge({ firestore: fs, app: await loadApp(), now: satMs, ...quiet(), ...extra }));

console.log('=== which changes may go ===');
await test('only an older week whose own expiry has passed; never a newer week; no week / no expiry counts as old', () => {
  const l = (id, data) => ({ id, data });
  const list = [l('a', { weekKey: '2026-W40', expiresAt: 100 }), l('b', { weekKey: '2026-W41', expiresAt: 100 }), l('c', { weekKey: '2026-W40', expiresAt: 999 }),
    l('d', {}), l('e', { weekKey: '2026-W39' }), l('f', { weekKey: '2026-W40', expiresAt: 500 })];
  assert.deepEqual(staleDeviations(list, '2026-W41', 500).map(x => x.id), ['a', 'd', 'e', 'f']);
});
await test('the year change sorts right: 2026-W53 is older than 2027-W01', () => {
  assert.equal(staleDeviations([{ id: 'x', data: { weekKey: '2026-W53', expiresAt: 1 } }], '2027-W01', 2).length, 1);
});

console.log('=== the weekly purge ===');
await test('the rides are logged exactly like the app does it (same documents), including the ride on a one-off change', async () => {
  // the app: the coordinator's browser, a moment after Saturday 00:00
  const fake = useFakeDb(seed());
  sampleCoordinatorState({ deviations: Object.fromEntries(fake.collection('deviations')), rideLog: {}, rideLogLoaded: true, deviationsLoaded: true, currentWeekKey: '2026-W40' });
  const n = await withFakeNowAsync(SAT, () => logPassedShifts());
  const appLog = Object.fromEntries(fake.collection('rideLog'));
  assert.ok(n >= 3, 'the app logged ' + n);
  assert.ok(appLog['2026-09-29_heen'], 'Tuesday heen (a one-off change) is in the log');
  // the server
  resetState();
  const fs = fakeFirestore(seed());
  const res = await run(fs);
  const serverLog = Object.fromEntries([...fs.data].filter(([k]) => k.startsWith('rideLog/')).map(([k, v]) => [k.slice(8), v]));
  assert.deepEqual(serverLog, appLog);
  assert.equal(res.logged, n);
});
await test('the changes of the ended week are deleted, the new week\'s change stays', async () => {
  resetState();
  const fs = fakeFirestore(seed());
  const res = await run(fs);
  assert.deepEqual(fs.calls.del.sort(), ['deviations/Di_heen', 'deviations/Do_terug', 'deviations/Vr_heen']);
  assert.ok(fs.data.has('deviations/Wo_heen'));
  assert.deepEqual([res.deleted, res.skipped, res.kept], [3, 0, 1]);
});
await test('before Friday 19:00 nothing is deleted (the week is still running)', async () => {
  resetState();
  const fs = fakeFirestore(seed());
  const friday = new Date('2026-10-02T18:55:00+02:00').getTime();
  await withFakeNowAsync('2026-10-02T18:55:00+02:00', async () => runPurge({ firestore: fs, app: await loadApp(), now: friday, ...quiet() }));
  assert.deepEqual(fs.calls.del, ['deviations/Vr_heen'], 'only the old one without a week goes');
  assert.ok(fs.data.has('deviations/Di_heen') && fs.data.has('deviations/Do_terug'));
});
await test('when logging fails nothing is deleted and the job stops with the error', async () => {
  resetState();
  const fs = fakeFirestore(seed(), { failSet: true });
  await assert.rejects(run(fs), /HTTP 503/);
  assert.deepEqual(fs.calls.del, []); assert.equal([...fs.data.keys()].filter(k => k.startsWith('deviations/')).length, 4);
});
await test('a change that was edited after it was read is left alone, with a warning', async () => {
  resetState();
  const fs = fakeFirestore(seed());
  const orig = fs.setDocument;
  fs.setDocument = async (p, d) => { await orig(p, d); fs.version.set('deviations/Di_heen', 'edited-meanwhile'); };   // someone saves a change while the job logs
  const q = quiet();
  const res = await run(fs, q);
  assert.ok(fs.data.has('deviations/Di_heen')); assert.equal(res.skipped, 1); assert.match(q.warnings[0], /1 change/);
});
await test('running it again does nothing: nothing new to log, nothing left to delete', async () => {
  resetState();
  const fs = fakeFirestore(seed());
  await run(fs);
  resetState();
  const again = await run(fs);
  assert.deepEqual([again.logged, again.deleted], [0, 0]);
});
await test('a database without any changes is fine', async () => {
  resetState();
  const s = seed(); Object.keys(s).filter(k => k.startsWith('deviations/')).forEach(k => delete s[k]);
  const res = await run(fakeFirestore(s));
  assert.equal(res.deleted, 0);
});

console.log('=== Friday 19:00 ===');
const FRI = '2026-10-02T19:05:00+02:00';
const EXPIRES_FRI_W40 = new Date('2026-10-02T19:00:00+02:00').getTime(), EXPIRES_FRI_W41 = new Date('2026-10-09T19:00:00+02:00').getTime();
function seedFriday() {
  const s = seed();
  s['deviations/Di_heen'].expiresAt = EXPIRES_FRI_W40;      // made after the change: expires Friday 19:00
  s['deviations/Wo_heen'].expiresAt = EXPIRES_FRI_W41;
  return s;                                                  // Do_terug keeps the old Saturday 00:00 expiry (made before the change)
}
await test('Friday 19:05: the changes of the ended week with the new expiry go, the coming week stays, an old Saturday expiry waits for the Saturday run', async () => {
  resetState();
  const fs = fakeFirestore(seedFriday());
  const now = new Date(FRI).getTime();
  const first = await withFakeNowAsync(FRI, async () => runPurge({ firestore: fs, app: await loadApp(), now, ...quiet() }));
  assert.deepEqual(fs.calls.del.sort(), ['deviations/Di_heen', 'deviations/Vr_heen']);
  assert.ok(fs.data.has('deviations/Do_terug') && fs.data.has('deviations/Wo_heen'));
  assert.equal(first.kept, 2);
  // the Saturday 00:05 run (kept as a catch-up) removes the one that still carried the old expiry
  const sat = new Date(SAT).getTime();
  await withFakeNowAsync(SAT, async () => runPurge({ firestore: fs, app: await loadApp(), now: sat, ...quiet() }));
  assert.ok(!fs.data.has('deviations/Do_terug')); assert.ok(fs.data.has('deviations/Wo_heen'));
});
await test('Friday 18:59 the new expiry has not passed yet: nothing of the running week is deleted', async () => {
  resetState();
  const fs = fakeFirestore(seedFriday());
  const now = new Date('2026-10-02T18:59:00+02:00').getTime();
  await withFakeNowAsync('2026-10-02T18:59:00+02:00', async () => runPurge({ firestore: fs, app: await loadApp(), now, ...quiet() }));
  assert.deepEqual(fs.calls.del, ['deviations/Vr_heen'], 'only the old one without a week goes');
});

console.log('=== the host ===');
await test('a host in another time zone (UTC) still counts Friday 19:05 in Amsterdam time', () => {
  const code = `await import(${JSON.stringify(new URL('../cron/purge.mjs', import.meta.url).href)});
    const d = new Date('2026-10-02T17:05:00Z'); console.log(d.getDay(), d.getHours());`;
  const x = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { PATH: process.env.PATH, TZ: 'UTC' } });
  assert.equal(x.stdout.trim(), '5 19', x.stdout + x.stderr);
});
await test('a host in another time zone (UTC) still counts Saturday 00:05 in Amsterdam time', () => {
  const code = `await import(${JSON.stringify(new URL('../cron/purge.mjs', import.meta.url).href)});
    console.log(new Date('2026-10-02T22:05:00Z').getDay(), process.env.TZ);`;
  const x = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { PATH: process.env.PATH, TZ: 'UTC' } });
  assert.equal(x.stdout.trim(), '6 Europe/Amsterdam', x.stdout + x.stderr);
});
await test('the copy that is uploaded to the host (cron folder + app/) does the same as the repo', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'az-purge-'));
  try {
    const built = buildCron({ out: join(tmp, 'dist-cron') });
    assert.ok(APP_MODULES.every(f => built.files.includes('app/' + f)));
    assert.ok(!built.files.some(f => /^app\/ui-|^app\/data\.js|^app\/app\.js/.test(f)), 'no screen code on the host: ' + built.files.join());
    // a fresh process, because the app modules (and their state) of the repo are already loaded here
    const dist = join(tmp, 'dist-cron');
    const driver = `import { runPurge, loadApp } from ${JSON.stringify(join(dist, 'purge.mjs'))};
      import { encodeFields } from ${JSON.stringify(join(dist, 'lib/firestore-rest.mjs'))};
      const docs = ${JSON.stringify(Object.fromEntries([...fakeFirestore(seed()).data]))};
      const fs = {
        listDocuments: async c => Object.keys(docs).filter(k => k.startsWith(c + '/')).map(k => ({ name: 'x/' + k, fields: encodeFields(docs[k]), createTime: 't', updateTime: 'v1' })),
        getDocument: async () => null, setDocument: async () => {}, deleteDocument: async () => true };
      const Real = Date, fixed = ${satMs};
      globalThis.Date = class extends Real { constructor(...a) { if (a.length === 0) super(fixed); else super(...a); } static now() { return fixed; } };
      const r = await runPurge({ firestore: fs, app: await loadApp(${JSON.stringify(dist)}), now: ${satMs}, log: () => {}, warn: () => {} });
      console.log(JSON.stringify(r));`;
    const x = spawnSync(process.execPath, ['--input-type=module', '-e', driver], { encoding: 'utf8', env: { PATH: process.env.PATH, TZ: 'UTC' } });
    assert.equal(x.status, 0, x.stdout + x.stderr);
    const r = JSON.parse(x.stdout.trim().split('\n').pop());
    assert.ok(r.logged >= 3); assert.deepEqual([r.deleted, r.skipped, r.kept], [3, 0, 1]);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

console.log('=== the error log (errorLog/): entries older than 30 days go ===');
const DAY = 24 * 60 * 60 * 1000;
const logDoc = (at, extra = {}) => ({ at, where: 'gate', code: 'link-denied', msg: '', v: 'v88', ua: 'iOS Safari 17', ...extra });
await test('staleErrorLogs: older than 30 days, or without a usable time stamp; exactly 30 days stays', () => {
  const l = (id, data) => ({ id, data });
  const list = [l('old', { at: satMs - 31 * DAY }), l('edge', { at: satMs - 30 * DAY }), l('new', { at: satMs - DAY }), l('none', {}), l('text', { at: 'yesterday' })];
  assert.deepEqual(staleErrorLogs(list, satMs).map(x => x.id), ['old', 'none', 'text']); assert.equal(LOG_KEEP_DAYS, 30);
});
await test('the weekly purge deletes old error-log entries, keeps recent ones and reports the number', async () => {
  resetState();
  const fs = fakeFirestore({ ...seed(), 'errorLog/u1_0': logDoc(satMs - 45 * DAY), 'errorLog/u1_1': logDoc(satMs - 2 * DAY), 'errorLog/u2_0': logDoc(satMs - 31 * DAY), 'errorLog/u3_5': { where: 'x' } });
  const logs = []; const res = await run(fs, { log: m => logs.push(m) });
  assert.deepEqual(fs.calls.del.filter(p => p.startsWith('errorLog/')).sort(), ['errorLog/u1_0', 'errorLog/u2_0', 'errorLog/u3_5']);
  assert.ok(fs.data.has('errorLog/u1_1')); assert.equal(res.logsDeleted, 3);
  assert.ok(logs.some(m => /Error log: 3 entries older than 30 days deleted/.test(m)));
});
await test('an entry that was rewritten while the job ran is left alone', async () => {
  resetState();
  const fs = fakeFirestore({ ...seed(), 'errorLog/u1_0': logDoc(satMs - 45 * DAY) });
  const real = fs.listDocuments; fs.listDocuments = async c => { const r = await real(c); if (c === 'errorLog') fs.version.set('errorLog/u1_0', 'changed'); return r; };
  const res = await run(fs);
  assert.ok(fs.data.has('errorLog/u1_0')); assert.equal(res.logsDeleted, 0);
});
await test('no error log at all is fine, and a failing clean-up never stops the ride logging or the deviations purge', async () => {
  resetState();
  let fs = fakeFirestore(seed()); let res = await run(fs);
  assert.equal(res.logsDeleted, 0); assert.deepEqual([res.deleted, res.skipped, res.kept], [3, 0, 1]);
  resetState();
  fs = fakeFirestore({ ...seed(), 'errorLog/u1_0': logDoc(1) });
  const real = fs.listDocuments; fs.listDocuments = async c => { if (c === 'errorLog') throw new Error('Firestore GET failed: HTTP 503'); return real(c); };
  const q = quiet(); res = await run(fs, q);
  assert.ok(res.logged >= 3); assert.deepEqual([res.deleted, res.skipped, res.kept], [3, 0, 1]); assert.equal(res.logsDeleted, 0);
  assert.ok(q.warnings.some(w => /could not clean the error log/.test(w)));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
