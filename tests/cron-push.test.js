// Run with: node cron-push.test.js
// cron/push.mjs: the push server of the test phase. It must do NOTHING unless settings/push is 'test', send ONLY to devices the coordinator
// stored, never twice, never during quiet hours, and tell the app it is alive. It also announces an uncovered Ritten-ruilen offer at 18:00,
// exactly once, even when the app (or a second run) was first.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFakeNowAsync } from './test-support.js';
import { decodeFields, encodeFields } from '../cron/lib/firestore-rest.mjs';
import { ensureVapid, loadPushApp, runPush, runUncovered, withLock, PUSH_APP_MODULES } from '../cron/push.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const app = await loadPushApp();
const tmp = mkdtempSync(join(tmpdir(), 'az-pushjob-'));
const vapidFile = join(tmp, 'secrets', 'push-vapid.json');

// Wednesday 30 September 2026. 10:00 = normal day time, 18:05 = just after the 18:00 deadline for Thursday, 23:30 = quiet hours.
const T10 = new Date('2026-09-30T10:00:00+02:00').getTime(), T1805 = new Date('2026-09-30T18:05:00+02:00').getTime(), T2330 = new Date('2026-09-30T23:30:00+02:00').getTime();
const DAY = 24 * 3600 * 1000;

// A fake Firestore with the calls of cron/lib/firestore-rest.mjs, including commit() with its preconditions (exists / updateTime).
function fakeFirestore(seed = {}) {
  const data = new Map(Object.entries(seed).map(([k, v]) => [k, structuredClone(v)]));
  const version = new Map([...data.keys()].map(k => [k, 'v0']));
  let n = 0;
  const calls = { set: [], del: [], commits: [] };
  const root = 'projects/az-carpool/databases/(default)/documents';
  const raw = k => ({ name: `${root}/${k}`, fields: encodeFields(data.get(k)), createTime: 't', updateTime: version.get(k) });
  const fs = {
    data, version, calls,
    listDocuments: async c => [...data.keys()].filter(k => k.startsWith(c + '/') && k.split('/').length === c.split('/').length + 1).sort().map(raw),
    getDocument: async p => data.has(p) ? raw(p) : null,
    setDocument: async (p, d) => { calls.set.push(p); data.set(p, decodeFields(encodeFields(d))); version.set(p, 'v' + ++n); },
    deleteDocument: async p => { calls.del.push(p); data.delete(p); version.delete(p); return true; },
    commit: async writes => {
      for (const w of writes) {   // all preconditions first: all or nothing
        const path = w.update || w.create || w.delete;
        if (w.update && (!data.has(path) || (w.updateTime && version.get(path) !== w.updateTime))) return false;
        if (w.create && data.has(path)) return false;
      }
      for (const w of writes) {
        if (w.update) { data.set(w.update, { ...data.get(w.update), ...decodeFields(encodeFields(w.fields)) }); version.set(w.update, 'v' + ++n); }
        if (w.create) { data.set(w.create, decodeFields(encodeFields(w.data))); version.set(w.create, 'v' + ++n); }
        if (w.delete) { data.delete(w.delete); version.delete(w.delete); }
      }
      calls.commits.push(writes.map(w => w.update || w.create || w.delete));
      return true;
    },
  };
  return fs;
}

const fam = (parent, girl, extra = {}) => ({ parentName: parent, girlName: girl, ...extra });
const FAMILIES = { f1: fam('Ouder Saar', 'Saar'), f2: fam('Ouder Noor', 'Noor'), f3: fam('Ouder Lois', 'Lois'), f4: fam('Ouder Eline', 'Eline') };
const seedFamilies = () => Object.fromEntries(Object.entries(FAMILIES).map(([id, f]) => [`families/${id}`, f]));
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/coordinator-phone';
const device = (extra = {}) => ({ owner: 'coordinator', uid: 'coord', endpoint: ENDPOINT, p256dh: 'p'.repeat(87), auth: 'a'.repeat(22), label: 'Chrome op Android', categories: { ritbeurs: true }, createdAt: 1, lastOkAt: 0, ...extra });
const notif = (to, extra = {}) => app.notificationDoc({ kind: 'taken', to, offer: { weekKey: '2026-W40', day: 'Do', direction: 'heen', date: '2026-10-01', time: '16:15' }, sourceId: 's1', fromFamilyId: 'f2', nowMs: T10, quiet: app.normalizeQuiet(), ...extra });
const queueEntry = (path, to, doc, extra = {}) => app.queueDoc({ path, toFamilyId: to, kind: doc.kind, deliverAt: doc.deliverAt, expiresAt: doc.expiresAt, nowMs: T10, test: path.startsWith('test') });
// A database with the push switch on test, one coordinator device, and the made-up notification "n1" for f1 in the queue.
function base(extra = {}, { mode = 'test' } = {}) {
  const n1 = notif('f1');
  return { ...seedFamilies(), ...(mode ? { 'settings/push': { mode, updatedAt: 1 } } : {}), 'pushDevices/dev1': device(),
    'testNotifications/n1': n1, 'pushQueue/testNotifications__n1': queueEntry('testNotifications/n1', 'f1', n1), ...extra };
}
const sender = (script = () => ({ ok: true, status: 201, gone: false })) => { const sent = []; const fn = async a => { sent.push(a); return script(a, sent.length); }; fn.sent = sent; return fn; };
const logs = () => { const out = { log: [], warn: [] }; out.logFn = m => out.log.push(m); out.warnFn = m => out.warn.push(m); return out; };
const run = (fs, send, now = T10, l = logs()) => withFakeNowAsync(new Date(now).toISOString(), () => runPush({ firestore: fs, app, send, vapidFile, subject: 'https://azcarpool.nl/', now, log: l.logFn, warn: l.warnFn })).then(r => ({ ...r, ...l }));

console.log('=== the master switch ===');
for (const [label, db] of [['missing', base({}, { mode: null })], ['uit', base({ 'settings/push': { mode: 'uit' } })], ['live (does not exist)', base({ 'settings/push': { mode: 'live' } })], ['broken', base({ 'settings/push': { mode: 7 } })]]) {
  await test(`mode ${label}: nothing is sent, nothing is written, no key is made`, async () => {
    const fs = fakeFirestore(db), send = sender();
    const r = await run(fs, send);
    assert.equal(send.sent.length, 0); assert.deepEqual(fs.calls.set, []); assert.deepEqual(fs.calls.commits, []); assert.deepEqual(fs.calls.del, []);
    assert.equal(r.mode, 'uit'); assert.match(r.log[0], /both off/); assert.equal(existsSync(vapidFile), false);
  });
}

console.log('\n=== sending ===');
await test('mode test: the coordinator device gets the message, labelled with the family it was meant for', async () => {
  const fs = fakeFirestore(base()), send = sender();
  const r = await run(fs, send);
  assert.equal(r.sent, 1); assert.equal(send.sent.length, 1);
  const a = send.sent[0], p = JSON.parse(a.payload);
  assert.equal(a.subscription.endpoint, ENDPOINT);
  assert.equal(p.title, 'Test · Ouder van Saar');
  assert.equal(p.body, 'Ouder Noor neemt je rit over\ndonderdag 16:15 is geregeld.');
  assert.equal(p.tag, 'testNotifications__n1'); assert.equal(p.url, './?pushas=f1'); assert.equal(p.forFamilyId, 'f1'); assert.equal(p.test, true);
  assert.deepEqual(Object.keys(fs.data.get('pushQueue/testNotifications__n1').sentTo), ['dev1']);
  assert.ok(fs.data.get('pushDevices/dev1').lastOkAt === T10);
});
await test('a second run sends nothing again', async () => {
  const fs = fakeFirestore(base()), send = sender();
  await run(fs, send); await run(fs, send, T10 + 60000);
  assert.equal(send.sent.length, 1);
});
await test('ONLY the coordinator\'s devices get anything: other owners and other addresses are ignored, ten families change nothing', async () => {
  const db = base({ 'pushDevices/other': device({ owner: 'family', endpoint: 'https://fcm.googleapis.com/fcm/send/a-parent' }), 'pushDevices/evil': device({ endpoint: 'https://evil.example/hook' }), 'pushDevices/http': device({ endpoint: 'http://fcm.googleapis.com/x' }) });
  for (let i = 1; i <= 10; i++) {
    const to = 'f' + (i % 4 + 1), n = notif(to, { sourceId: 'many' + i });
    db['families/' + to + '/notifications/n' + i] = n;
    db['pushQueue/families__' + to + '__notifications__n' + i] = queueEntry(`families/${to}/notifications/n${i}`, to, n);
  }
  const fs = fakeFirestore(db), send = sender();
  const r = await run(fs, send);
  assert.equal(r.sent, 11); assert.deepEqual([...new Set(send.sent.map(a => a.subscription.endpoint))], [ENDPOINT]);
});
await test('a real family notification is sent with the real text, labelled with that family', async () => {
  const n = notif('f3', { kind: 'offerBackup', fromFamilyId: 'f2' });
  const fs = fakeFirestore(base({ 'families/f3/notifications/x1': n, 'pushQueue/families__f3__notifications__x1': queueEntry('families/f3/notifications/x1', 'f3', n) })), send = sender();
  await run(fs, send);
  const p = send.sent.map(a => JSON.parse(a.payload)).find(x => x.forFamilyId === 'f3');
  assert.equal(p.title, 'Test · Ouder van Lois'); assert.match(p.body, /^Rit vrij: donderdag 16:15\nOuder Noor biedt een rit aan/);
});
await test('quiet hours: a message that is not due yet waits and goes out when it is due', async () => {
  const n = notif('f1', { nowMs: T2330, quiet: app.normalizeQuiet() });   // made at 23:30: due at 06:00
  assert.ok(n.deliverAt > T2330);
  const fs = fakeFirestore(base({ 'testNotifications/n1': n, 'pushQueue/testNotifications__n1': queueEntry('testNotifications/n1', 'f1', n) })), send = sender();
  const early = await run(fs, send, T2330);
  assert.equal(send.sent.length, 0); assert.equal(early.pending, 1);
  const later = await run(fs, send, n.deliverAt + 1000);
  assert.equal(send.sent.length, 1); assert.equal(later.sent, 1);
});
await test('a device with Ritten ruilen switched off gets nothing, without complaints', async () => {
  const fs = fakeFirestore(base({ 'pushDevices/dev1': device({ categories: { ritbeurs: false } }) })), send = sender();
  const r = await run(fs, send);
  assert.equal(send.sent.length, 0); assert.deepEqual(r.warn, []);
});
await test('no device yet: the message waits (nothing is lost) and is sent once a device exists', async () => {
  const db = base(); delete db['pushDevices/dev1'];
  const fs = fakeFirestore(db), send = sender();
  const r = await run(fs, send);
  assert.equal(send.sent.length, 0); assert.equal(r.pending, 1);
  fs.data.set('pushDevices/dev1', device()); fs.version.set('pushDevices/dev1', 'v9');
  await run(fs, send, T10 + 60000);
  assert.equal(send.sent.length, 1);
});
await test('two devices: each gets it once; a device added later still gets the old message', async () => {
  const fs = fakeFirestore(base({ 'pushDevices/dev2': device({ endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/laptop' }) })), send = sender();
  await run(fs, send); await run(fs, send, T10 + 60000);
  assert.deepEqual(send.sent.map(a => a.subscription.endpoint).sort(), ['https://fcm.googleapis.com/fcm/send/coordinator-phone', 'https://updates.push.services.mozilla.com/wpush/v2/laptop']);
});

console.log('\n=== when sending goes wrong ===');
await test('"gone" (404/410): the device is removed and the message is not marked as sent to it', async () => {
  const fs = fakeFirestore(base()), send = sender(() => ({ ok: false, status: 410, gone: true }));
  const r = await run(fs, send);
  assert.equal(fs.data.has('pushDevices/dev1'), false); assert.equal(r.removed, 1); assert.match(r.warn.join(), /gone/);
  assert.deepEqual(fs.data.get('pushQueue/testNotifications__n1').sentTo || {}, {});
});
await test('a failure is counted and tried again; after 5 tries it is given up (no more sends, no more complaints)', async () => {
  const fs = fakeFirestore(base()), send = sender(() => ({ ok: false, status: 503, gone: false }));
  let last;
  for (let i = 0; i < 7; i++) last = await run(fs, send, T10 + i * 60000);
  assert.equal(send.sent.length, 5); assert.equal(fs.data.get('pushQueue/testNotifications__n1').failedTo.dev1, 5); assert.deepEqual(last.warn, []);
  assert.equal(fs.data.has('pushDevices/dev1'), true);
});
await test('one failing device does not stop the other', async () => {
  const fs = fakeFirestore(base({ 'pushDevices/dev2': device({ endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/laptop' }) }));
  const send = sender(a => a.subscription.endpoint === ENDPOINT ? { ok: false, status: 500, gone: false } : { ok: true, status: 201, gone: false });
  const r = await run(fs, send);
  assert.equal(r.sent, 1); assert.equal(r.failed, 1); assert.deepEqual(Object.keys(fs.data.get('pushQueue/testNotifications__n1').sentTo), ['dev2']);
});
await test('an entry whose notification is gone, and an expired entry, are cleaned up (a made-up notification goes with its entry)', async () => {
  const db = base();
  db['pushQueue/families__f2__notifications__zz'] = queueEntry('families/f2/notifications/zz', 'f2', notif('f2'));   // the notification itself does not exist
  const old = notif('f4', { nowMs: T10 - 3 * DAY }); old.expiresAt = T10 - DAY;
  db['testNotifications/old'] = old; db['pushQueue/testNotifications__old'] = queueEntry('testNotifications/old', 'f4', old);
  const fs = fakeFirestore(db), send = sender();
  const r = await run(fs, send);
  assert.equal(fs.data.has('pushQueue/families__f2__notifications__zz'), false);
  assert.equal(fs.data.has('pushQueue/testNotifications__old'), false); assert.equal(fs.data.has('testNotifications/old'), false);
  assert.equal(send.sent.length, 1); assert.equal(r.removed, 2);
});
await test('a notification of a kind this version does not know is given up once, not every minute', async () => {
  const n = { ...notif('f1'), kind: 'toekomst' };
  const db = base({ 'testNotifications/n1': n, 'pushQueue/testNotifications__n1': { ...queueEntry('testNotifications/n1', 'f1', n), kind: 'taken' } });
  const fs = fakeFirestore(db), send = sender();
  const a = await run(fs, send), b = await run(fs, send, T10 + 60000);
  assert.equal(send.sent.length, 0); assert.equal(a.warn.length, 1); assert.deepEqual(b.warn, []);
});
await test('an entry that was removed while the job ran is not brought back', async () => {
  const fs = fakeFirestore(base());
  const send = sender(() => { fs.data.delete('pushQueue/testNotifications__n1'); return { ok: true, status: 201, gone: false }; });
  await run(fs, send);
  assert.equal(fs.data.has('pushQueue/testNotifications__n1'), false);
});

console.log('\n=== the key and the status ===');
await test('the key pair is made once and its public half is published for the app; a changed key is published again', async () => {
  const file = join(tmp, 'k2', 'push-vapid.json'), fs = fakeFirestore({}), l = logs();
  const v1 = await ensureVapid({ firestore: fs, file, subject: 's', now: 5, log: l.logFn });
  assert.equal(fs.data.get('settings/pushKey').publicKey, v1.publicKey); assert.equal(fs.data.get('settings/pushKey').updatedAt, 5);
  const before = fs.calls.set.length;
  const v2 = await ensureVapid({ firestore: fs, file, subject: 's', now: 9, log: l.logFn });
  assert.deepEqual(v2, v1); assert.equal(fs.calls.set.length, before);
  fs.data.set('settings/pushKey', { publicKey: 'old' });
  await ensureVapid({ firestore: fs, file, subject: 's', now: 11, log: l.logFn });
  assert.equal(fs.data.get('settings/pushKey').publicKey, v1.publicKey);
});
await test('each run reports itself in settings/pushStatus', async () => {
  const fs = fakeFirestore(base()), send = sender();
  await run(fs, send);
  assert.deepEqual(fs.data.get('settings/pushStatus'), { lastRunAt: T10, mode: 'test', live: false, sent: 1, failed: 0, pending: 0, devices: 1, familyDevices: 0, announced: 0 });
});
await test('the whole job only reads from the database what it needs and writes only its own documents', async () => {
  const fs = fakeFirestore(base()), send = sender();
  await run(fs, send);
  const touched = new Set([...fs.calls.set, ...fs.calls.commits.flat()]);
  for (const p of touched) assert.match(p, /^(settings\/(pushKey|pushStatus)|pushQueue\/|pushDevices\/|offers\/|families\/[^/]+\/notifications\/)/, p);
});

console.log('\n=== live: real pushes to the families ===');
const phone = (fid, extra = {}) => ({ owner: 'family', uid: 'u-' + fid, familyId: fid, endpoint: 'https://fcm.googleapis.com/fcm/send/phone-' + fid, p256dh: 'p'.repeat(87), auth: 'a'.repeat(22), label: 'Chrome op Android', categories: { ritbeurs: true }, createdAt: 1, lastOkAt: 0, ...extra });
const REAL_PATH = 'families/f1/notifications/' + app.notificationId('taken', 's1', 'f1');
// Live on (from a moment before the notification), test off; a real notification for f1 in the queue; one phone of f1 and one of f2.
function liveBase(extra = {}, sw = { mode: 'uit', live: true, liveSince: T10 - 1000, updatedAt: 1 }, entryExtra = {}) {
  const n = notif('f1');
  return { ...seedFamilies(), 'settings/push': sw, 'pushDevices/phone1': phone('f1'), 'pushDevices/phone2': phone('f2'), [REAL_PATH]: n,
    ['pushQueue/' + app.queueKey(REAL_PATH)]: { ...app.queueDoc({ path: REAL_PATH, toFamilyId: 'f1', kind: n.kind, deliverAt: n.deliverAt, expiresAt: n.expiresAt, nowMs: T10 - 500, test: false }), ...entryExtra }, ...extra };
}
await test('live on, test off: a real notification goes to the phones of its own family only, as the plain text that opens Ritten ruilen', async () => {
  const fs = fakeFirestore(liveBase()), send = sender();
  const r = await run(fs, send);
  assert.equal(r.sent, 1); assert.equal(send.sent.length, 1);
  assert.equal(send.sent[0].subscription.endpoint, 'https://fcm.googleapis.com/fcm/send/phone-f1');
  const p = JSON.parse(send.sent[0].payload);
  assert.equal(p.title, 'Ouder Noor neemt je rit over'); assert.equal(p.body, 'donderdag 16:15 is geregeld.');
  assert.equal(p.test, false); assert.equal(p.forFamilyId, ''); assert.equal(p.open, 'ritbeurs'); assert.equal(p.url, './?open=ritbeurs'); assert.ok(!/Test/.test(p.title));
  assert.deepEqual(Object.keys(fs.data.get('pushQueue/' + app.queueKey(REAL_PATH)).sentTo), ['phone1']);
  assert.equal(fs.data.get('pushDevices/phone1').lastOkAt, T10); assert.equal(fs.data.get('pushDevices/phone2').lastOkAt, 0);
});
await test('a family with two phones: both get it, once; a second run sends nothing again', async () => {
  const fs = fakeFirestore(liveBase({ 'pushDevices/phone1b': phone('f1', { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/second' }) })), send = sender();
  assert.equal((await run(fs, send)).sent, 2);
  assert.equal((await run(fs, send)).sent, 0); assert.equal(send.sent.length, 2);
});
await test('live and test both on: the coordinator gets NO test copy of a real notification (only the family does)', async () => {
  const fs = fakeFirestore(liveBase({ 'pushDevices/dev1': device() }, { mode: 'test', live: true, liveSince: T10 - 1000, updatedAt: 1 })), send = sender();
  await run(fs, send);
  assert.deepEqual(send.sent.map(a => a.subscription.endpoint), ['https://fcm.googleapis.com/fcm/send/phone-f1']);
});
await test('a coordinator phone that is also the coordinator\'s own family phone gets the real push as a family phone', async () => {
  const fs = fakeFirestore(liveBase({ 'pushDevices/phone1': device({ familyId: 'f1' }) }, { mode: 'test', live: true, liveSince: T10 - 1000, updatedAt: 1 })), send = sender();
  await run(fs, send);
  assert.equal(send.sent.length, 1); assert.equal(JSON.parse(send.sent[0].payload).test, false);
});
await test('a real notification made before live was switched on is not sent to the family (no old news)', async () => {
  const fs = fakeFirestore(liveBase({}, { mode: 'uit', live: true, liveSince: T10, updatedAt: 1 })), send = sender();
  const r = await run(fs, send);
  assert.equal(r.sent, 0); assert.equal(send.sent.length, 0); assert.ok(fs.data.has('pushQueue/' + app.queueKey(REAL_PATH)), 'left alone, it expires by itself');
});
await test('a phone switched on long after the notification was made does not get it', async () => {
  const fs = fakeFirestore(liveBase({ 'pushDevices/phone1': phone('f1', { createdAt: T10 + 3600000 }) })), send = sender();
  assert.equal((await run(fs, send)).sent, 0);
});
await test('a family without a phone gets no push and the entry is not counted as waiting', async () => {
  const db = liveBase(); delete db['pushDevices/phone1'];
  const fs = fakeFirestore(db), send = sender();
  const r = await run(fs, send);
  assert.equal(r.sent, 0); assert.equal(r.pending, 0); assert.equal(send.sent.length, 0);
});
await test('a phone whose family id is emptied (switched off but kept as a test device) gets nothing', async () => {
  const db = liveBase({ 'pushDevices/phone1': device({ familyId: '' }) });
  const fs = fakeFirestore(db), send = sender();
  assert.equal((await run(fs, send)).sent, 0);
});
await test('quiet hours also hold a real push back: it stays pending until 06:00', async () => {
  const db = liveBase(); const e = db['pushQueue/' + app.queueKey(REAL_PATH)]; e.deliverAt = T10 + 3600000;
  const fs = fakeFirestore(db), send = sender();
  const r = await run(fs, send);
  assert.equal(r.sent, 0); assert.equal(r.pending, 1);
});
await test('live only: made-up situations and hand-sent entries are not sent (they need the test switch); with test on as well they go to the coordinator, labelled', async () => {
  const n1 = notif('f1');
  const seed = { ...liveBase(), 'pushDevices/dev1': device(), 'testNotifications/n1': n1, 'pushQueue/testNotifications__n1': queueEntry('testNotifications/n1', 'f1', n1) };
  delete seed['pushQueue/' + app.queueKey(REAL_PATH)];
  const fs1 = fakeFirestore(seed), send1 = sender();
  assert.equal((await run(fs1, send1)).sent, 0);
  const fs2 = fakeFirestore({ ...seed, 'settings/push': { mode: 'test', live: true, liveSince: T10 - 1000, updatedAt: 1 } }), send2 = sender();
  assert.equal((await run(fs2, send2)).sent, 1);
  assert.equal(send2.sent[0].subscription.endpoint, ENDPOINT); assert.equal(JSON.parse(send2.sent[0].payload).title, 'Test · Ouder van Saar');
  const fs3 = fakeFirestore({ ...liveBase({ 'pushDevices/dev1': device() }, { mode: 'test', live: true, liveSince: T10 - 1000, updatedAt: 1 }, { manual: true }) }), send3 = sender();
  await run(fs3, send3);
  assert.deepEqual(send3.sent.map(a => a.subscription.endpoint), [ENDPOINT], 'a hand-sent copy of a real notification goes to the test device, never to the family');
});
await test('a gone phone of a family is removed and the other phones still get the message', async () => {
  const fs = fakeFirestore(liveBase({ 'pushDevices/phone1b': phone('f1', { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/second' }) })), calls = [];
  const send = sender(a => { calls.push(a.subscription.endpoint); return a.subscription.endpoint.includes('phone-f1') ? { ok: false, status: 410, gone: true } : { ok: true, status: 201, gone: false }; });
  const r = await run(fs, send);
  assert.equal(r.sent, 1); assert.equal(fs.data.has('pushDevices/phone1'), false); assert.equal(fs.data.has('pushDevices/phone1b'), true);
});
await test('the status says live is on and counts the phones of families apart from the test devices', async () => {
  const fs = fakeFirestore(liveBase({ 'pushDevices/dev1': device() }, { mode: 'test', live: true, liveSince: T10 - 1000, updatedAt: 1 })), send = sender();
  await run(fs, send);
  const st = fs.data.get('settings/pushStatus');
  assert.equal(st.live, true); assert.equal(st.mode, 'test'); assert.equal(st.devices, 1); assert.equal(st.familyDevices, 2);
});
await test('live on alone: the job runs (key published, status written) even though the test switch is off', async () => {
  const fs = fakeFirestore(liveBase()), send = sender();
  const r = await run(fs, send);
  assert.equal(r.mode, 'uit'); assert.equal(r.live, true); assert.ok(fs.data.get('settings/pushKey').publicKey); assert.equal(fs.data.get('settings/pushStatus').live, true);
});

console.log('\n=== niet gedekt (18:00 the day before) ===');
const offer = (extra = {}) => ({ weekKey: '2026-W40', day: 'Do', direction: 'heen', date: '2026-10-01', time: '16:15', offeredBy: 'f1', message: '', status: 'open', createdAt: T10 - 3600000, ...extra });
const ritOn = (extra = {}) => base({ 'settings/ritbeurs': { on: true }, 'settings/dayCoordinators': { Do: 'f3' }, 'offers/o1': offer(), ...extra });
const unc = (fs, now = T1805) => withFakeNowAsync(new Date(now).toISOString(), () => runUncovered({ firestore: fs, app, now, log: () => {} }));
await test('an offer still open after 18:00 the day before is announced to the offerer and the day coordinator, once', async () => {
  const fs = fakeFirestore(ritOn());
  assert.equal(await unc(fs), 1);
  assert.equal(fs.data.get('offers/o1').uncoveredAt, T1805);
  for (const to of ['f1', 'f3']) {
    const n = fs.data.get(`families/${to}/notifications/uncovered_o1_${to}`);
    assert.equal(n.kind, 'uncovered'); assert.equal(n.toFamilyId, to); assert.equal(n.read, false);
    assert.equal(fs.data.get(`pushQueue/families__${to}__notifications__uncovered_o1_${to}`).test, false);
  }
  assert.equal(await unc(fs, T1805 + 60000), 0);
});
await test('before 18:00, for another week, already announced, ride already started, Ritten ruilen off: nothing happens', async () => {
  assert.equal(await unc(fakeFirestore(ritOn()), T10), 0);
  assert.equal(await unc(fakeFirestore(ritOn({ 'offers/o1': offer({ weekKey: '2026-W41' }) }))), 0);
  assert.equal(await unc(fakeFirestore(ritOn({ 'offers/o1': offer({ uncoveredAt: 1 }) }))), 0);
  assert.equal(await unc(fakeFirestore(ritOn({ 'offers/o1': offer({ status: 'taken' }) }))), 0);
  assert.equal(await unc(fakeFirestore(ritOn({ 'offers/o1': offer({ date: '2026-09-30', time: '09:00' }) }))), 0);
  assert.equal(await unc(fakeFirestore(ritOn({ 'settings/ritbeurs': { on: false } }))), 0);
  const noSwitch = ritOn(); delete noSwitch['settings/ritbeurs'];
  assert.equal(await unc(fakeFirestore(noSwitch)), 0);
});
await test('quiet hours of the receiving family apply to the announcement', async () => {
  const fs = fakeFirestore(ritOn({ 'families/f1': fam('Ouder Saar', 'Saar', { ritbeursQuiet: { from: '18:00', to: '19:00' } }) }));
  await unc(fs);
  assert.ok(fs.data.get('families/f1/notifications/uncovered_o1_f1').deliverAt > T1805);
  assert.equal(fs.data.get('families/f3/notifications/uncovered_o1_f3').deliverAt, T1805);
});
await test('the app was first (it made a notification already): the server changes nothing, not even the offer', async () => {
  const early = app.notificationDoc({ kind: 'uncovered', to: 'f1', offer: offer(), sourceId: 'o1', fromFamilyId: '', nowMs: T1805 - 1000, quiet: app.normalizeQuiet() });
  const fs = fakeFirestore(ritOn({ 'families/f1/notifications/uncovered_o1_f1': early }));
  assert.equal(await unc(fs), 0);
  assert.equal(fs.data.get('offers/o1').uncoveredAt, undefined); assert.equal(fs.data.has('families/f3/notifications/uncovered_o1_f3'), false);
});
await test('the offer was taken between reading and writing: nothing is written', async () => {
  const fs = fakeFirestore(ritOn());
  const real = fs.commit;
  fs.commit = async w => { fs.data.set('offers/o1', { ...fs.data.get('offers/o1'), status: 'taken' }); fs.version.set('offers/o1', 'changed'); return real(w); };
  assert.equal(await unc(fs), 0);
  assert.equal(fs.data.has('families/f1/notifications/uncovered_o1_f1'), false);
});
await test('a run in test mode announces and sends in one go; with the switch on uit it does not announce at all', async () => {
  const fs = fakeFirestore(ritOn()), send = sender();
  const r = await run(fs, send, T1805);
  assert.equal(r.announced, 1); assert.ok(send.sent.map(a => JSON.parse(a.payload)).some(p => p.forFamilyId === 'f3' && /niet gedekt/.test(p.body)));
  const off = fakeFirestore(ritOn({ 'settings/push': { mode: 'uit' } }));
  await run(off, sender(), T1805);
  assert.equal(off.data.get('offers/o1').uncoveredAt, undefined);
});

console.log('\n=== reads (quota) ===');
// The free plan allows 50,000 reads a day for the whole app, so a run must not read what it does not need.
const spied = fs => { const reads = []; const l = fs.listDocuments, g = fs.getDocument; fs.listDocuments = async c => { reads.push(c); return l(c); }; fs.getDocument = async p => { reads.push(p); return g(p); }; fs.reads = reads; return fs; };
await test('an empty queue: devices and families are not read, the status still says the server is alive (without device counts)', async () => {
  const db = base({ 'settings/ritbeurs': { on: true } }); delete db['testNotifications/n1']; delete db['pushQueue/testNotifications__n1'];
  const fs = spied(fakeFirestore(db)), send = sender();
  const r = await run(fs, send);
  assert.equal(r.sent, 0); assert.equal(send.sent.length, 0);
  assert.ok(!fs.reads.includes('pushDevices') && !fs.reads.includes('families'), 'read: ' + fs.reads.join(', '));
  assert.ok(fs.reads.includes('pushQueue') && fs.reads.includes('offers'));
  const st = fs.data.get('settings/pushStatus');
  assert.equal(st.lastRunAt, T10); assert.equal(st.sent, 0); assert.equal(st.pending, 0); assert.ok(!('devices' in st)); assert.ok(!('familyDevices' in st));
  assert.match(r.log[r.log.length - 1], /queue empty/);
});
await test('a queue with an entry: devices and families are read, as before, and the status carries the device counts', async () => {
  const fs = spied(fakeFirestore(base())), send = sender();
  const r = await run(fs, send);
  assert.equal(r.sent, 1);
  assert.ok(fs.reads.includes('pushDevices') && fs.reads.includes('families'));
  assert.equal(fs.data.get('settings/pushStatus').devices, 1);
});
await test('no offer that is due: the families and the day coordinators are not read; one that is due reads them', async () => {
  const fs1 = spied(fakeFirestore(ritOn()));
  assert.equal(await unc(fs1, T10), 0);
  assert.deepEqual(fs1.reads.filter(r => r === 'families' || r === 'settings/dayCoordinators'), []);
  assert.ok(fs1.reads.includes('offers'));
  const fs2 = spied(fakeFirestore(ritOn()));
  assert.equal(await unc(fs2, T1805), 1);
  assert.ok(fs2.reads.includes('families') && fs2.reads.includes('settings/dayCoordinators'));
});

console.log('\n=== the lock ===');
await test('a run that finds another one busy skips; the lock is released after a run, also after an error; an old lock is taken over', async () => {
  const lock = join(tmp, 'data', 'push.lock'); let ran = 0;
  const real = () => ({ now: globalThis.__RealDate.now(), log: () => {} });   // the tests freeze Date; the lock file's time is the real clock
  assert.equal(await withLock(lock, async () => { ran++; return 'ok'; }, real()), 'ok'); assert.equal(existsSync(lock), false);
  await assert.rejects(withLock(lock, async () => { throw new Error('boom'); }, real()), /boom/); assert.equal(existsSync(lock), false);
  let inner = 'not run';
  await withLock(lock, async () => { inner = await withLock(lock, async () => { ran++; }, real()); }, real());
  assert.equal(inner, null); assert.equal(ran, 1);
  mkdirSync(dirname(lock), { recursive: true }); writeFileSync(lock, '1');
  const old = new Date(globalThis.__RealDate.now() - 3600000); utimesSync(lock, old, old);
  assert.equal(await withLock(lock, async () => 'took over', real()), 'took over');
});

console.log('\n=== the job itself ===');
const here = dirname(fileURLToPath(import.meta.url));
await test('without its settings it stops with exit code 1 and one clear line; the app modules it reuses are the ones listed', () => {
  const r = spawnSync(process.execPath, [join(here, '..', 'cron', 'push.mjs')], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp, AZ_SECRETS: join(tmp, 'none'), AZ_DATA: join(tmp, 'data2') } });
  assert.equal(r.status, 1); assert.match(r.stderr, /^PUSH FAILED: /m);
  assert.deepEqual(PUSH_APP_MODULES, ['push.js', 'notif-text.js', 'ritbeurs.js', 'dates.js', 'state.js']);
  assert.match(readFileSync(join(here, '..', 'cron', 'run.sh'), 'utf8'), /push\)\s+exec "\$best" "\$here\/push\.mjs"/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
