// Run with: node push-data.test.js
// push-data.js: everything of the push test phase that reads or writes the database or the browser's push service. Coordinator only.
// The point of these tests: nothing is stored or sent for anyone else, made-up scenarios never touch real data, and the switch decides what is queued.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, useFakeDb, withFakeNowAsync, NOW, sampleCoordinatorState, sampleParentState, sampleDbSeed, assertNoUnusedImports } from './test-support.js';
import { S } from '../state.js';
import {
  clearTests, enablePush, findThisDevice, personaName, previewItems, pushMode, pushSupport, rememberedPersona, removeDevice, runScenario, scenarioContext, sendToMyDevice,
  setDeviceCategory, setPersona, setPushMode, stopPushListeners, syncPushListeners,
} from '../push-data.js';
import { deviceDoc, deviceId } from '../push.js';
import { notificationDoc, normalizeQuiet } from '../ritbeurs.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const toast = () => text(dom.doc.getElementById('toast').innerHTML);
const tick = () => new Promise(r => setImmediate(r));   // (setTimeout is unref'd by the test support: it would not keep the test alive)
const NOWMS = new Date(NOW).getTime();
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/this-phone';
const KEYS = { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) };

// What the app writes for real. A scenario must never change any of it.
const REAL = /^(offers|backupMoments|deviations|groups|families|links|invites|settings\/ritbeurs)/;
const realStore = fake => JSON.stringify([...fake.store.entries()].filter(([k]) => REAL.test(k)).sort());
// A coordinator; Saar's family is f6. `push` patches the push part of the state.
function asCoordinator(seed = {}, push = {}, patch = {}) {
  const fake = useFakeDb({ ...sampleDbSeed(), ...seed });
  sampleCoordinatorState({ ...patch });
  Object.assign(S.push, push);
  return fake;
}
// A browser that can do push: the service worker is ready, there is no subscription yet.
function browser({ permission = 'default', answer = 'granted', sub = null, subscribeFails = false, userAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36', standalone = true } = {}) {
  const calls = { subscribe: [], unsubscribe: 0, request: 0 };
  let current = sub;
  const subscription = { endpoint: ENDPOINT, toJSON: () => ({ endpoint: ENDPOINT, keys: KEYS }), unsubscribe: async () => { calls.unsubscribe++; current = null; return true; } };
  const pushManager = { getSubscription: async () => current, subscribe: async o => { calls.subscribe.push(o); if (subscribeFails) throw new Error('push service down'); current = subscription; return subscription; } };
  const Notification = { permission, requestPermission: async () => { calls.request++; Notification.permission = answer; return answer; } };
  return { calls, g: { navigator: { userAgent, standalone, serviceWorker: { ready: Promise.resolve({ pushManager }) } }, PushManager: function PushManager() {}, Notification, matchMedia: () => ({ matches: false }) } };
}

console.log('=== the master switch ===');
await test('the coordinator switches the test on and off; the choice is stored and shown at once', async () => {
  const fake = asCoordinator();
  assert.equal(pushMode(), 'uit');
  assert.equal(await setPushMode('test'), true);
  assert.equal(fake.get('settings/push').mode, 'test'); assert.equal(pushMode(), 'test'); assert.match(toast(), /Test staat aan/);
  assert.equal(await setPushMode('uit'), true); assert.equal(fake.get('settings/push').mode, 'uit'); assert.equal(pushMode(), 'uit');
});
await test('there is no way to store a live mode: anything but "test" is stored as uit', async () => {
  const fake = asCoordinator();
  await setPushMode('live'); assert.equal(fake.get('settings/push').mode, 'uit');
  await setPushMode(undefined); assert.equal(fake.get('settings/push').mode, 'uit');
});
await test('a parent cannot switch it: nothing is written', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState();
  assert.equal(await setPushMode('test'), false); assert.equal(fake.get('settings/push'), undefined); assert.match(toast(), /Alleen de coördinator/);
});
await test('a failing database shows the error and does not pretend it worked', async () => {
  const fake = asCoordinator(); fake.failWrites('settings/push', 'permission-denied');
  assert.equal(await setPushMode('test'), false); assert.equal(pushMode(), 'uit'); assert.match(toast(), /permission-denied/);
});

console.log('\n=== this browser ===');
await test('support: ok, no push in this browser, or an iPhone that has not put the app on the home screen', () => {
  assert.equal(pushSupport(browser().g), 'ok');
  assert.equal(pushSupport({ navigator: {}, matchMedia: () => ({ matches: false }) }), 'geenSupport');
  assert.equal(pushSupport(browser({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', standalone: false }).g), 'iosInstalleren');
  assert.equal(pushSupport(browser({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', standalone: true }).g), 'ok');
});
await test('enabling asks permission, subscribes with the server key and stores the device for the coordinator', async () => {
  const fake = asCoordinator({}, { key: { publicKey: 'BAAA' + 'A'.repeat(83) } }), b = browser();
  const r = await enablePush(b.g);
  const id = deviceId(ENDPOINT);
  assert.deepEqual(r, { ok: true, id }); assert.equal(b.calls.request, 1); assert.equal(b.calls.subscribe.length, 1);
  assert.equal(b.calls.subscribe[0].userVisibleOnly, true); assert.equal(b.calls.subscribe[0].applicationServerKey.length, 65);
  const d = fake.get('pushDevices/' + id);
  assert.equal(d.owner, 'coordinator'); assert.equal(d.uid, 'coord'); assert.equal(d.endpoint, ENDPOINT); assert.equal(d.p256dh, KEYS.p256dh); assert.equal(d.label, 'Chrome op Android'); assert.deepEqual(d.categories, { ritbeurs: true });
  assert.equal(S.push.thisDeviceId, id); assert.match(toast(), /testmeldingen/);
});
await test('enabling twice (or from a browser that is already subscribed) keeps the choices made for that device', async () => {
  const id = deviceId(ENDPOINT);
  const old = deviceDoc({ endpoint: ENDPOINT, ...KEYS, label: 'Oud label', uid: 'coord', nowMs: 5 }); old.categories = { ritbeurs: false };
  const fake = asCoordinator({ ['pushDevices/' + id]: old }, { key: { publicKey: 'BAAA' + 'A'.repeat(83) } });
  const b = browser({ permission: 'granted' });
  assert.equal((await enablePush(b.g)).ok, true); assert.equal(b.calls.request, 0);
  assert.deepEqual(fake.get('pushDevices/' + id).categories, { ritbeurs: false }); assert.equal(fake.get('pushDevices/' + id).createdAt, 5);
  assert.equal((await enablePush(browser({ permission: 'granted', sub: { endpoint: ENDPOINT, toJSON: () => ({ endpoint: ENDPOINT, keys: KEYS }) } }).g)).ok, true);
  assert.equal(fake.collection('pushDevices').length, 1);
});
await test('every way it can go wrong gives a clear reason and stores nothing', async () => {
  const key = { publicKey: 'BAAA' + 'A'.repeat(83) };
  let fake = asCoordinator({}, {});
  assert.deepEqual(await enablePush(browser().g), { ok: false, reason: 'geenSleutel' });
  asCoordinator({}, { key });
  assert.deepEqual(await enablePush(browser({ answer: 'denied' }).g), { ok: false, reason: 'geweigerd' });
  assert.deepEqual(await enablePush(browser({ permission: 'denied' }).g), { ok: false, reason: 'geweigerd' });
  assert.deepEqual(await enablePush({ navigator: {}, matchMedia: () => ({ matches: false }) }), { ok: false, reason: 'geenSupport' });
  assert.deepEqual(await enablePush(browser({ userAgent: 'iPhone Safari', standalone: false }).g), { ok: false, reason: 'iosInstalleren' });
  assert.deepEqual(await enablePush(browser({ subscribeFails: true }).g), { ok: false, reason: 'mislukt' }); assert.match(toast(), /push service down/);
  fake = asCoordinator({}, { key });
  const bad = browser(); const badSub = { endpoint: 'https://evil.example/x', toJSON: () => ({ endpoint: 'https://evil.example/x', keys: KEYS }) };
  bad.g.navigator.serviceWorker = { ready: Promise.resolve({ pushManager: { getSubscription: async () => badSub, subscribe: async () => badSub } }) };
  assert.deepEqual(await enablePush(bad.g), { ok: false, reason: 'ongeldig' });
  assert.deepEqual(fake.collection('pushDevices'), []);
});
await test('a push service that never answers ends in a clear message after the time limit, and stores nothing', async () => {
  const fake = asCoordinator({}, { key: { publicKey: 'BAAA' + 'A'.repeat(83) } }), b = browser({ permission: 'granted' });
  const never = new Promise(() => {});
  b.g.navigator.serviceWorker = { ready: Promise.resolve({ pushManager: { getSubscription: async () => null, subscribe: () => never } }) };
  const alive = setInterval(() => {}, 1000);   // (the test support's timers do not keep the process alive on their own)
  try { assert.deepEqual(await enablePush(b.g, { timeoutMs: 30 }), { ok: false, reason: 'mislukt' }); } finally { clearInterval(alive); }
  assert.match(toast(), /pushdienst van je browser antwoordt niet/); assert.deepEqual(fake.collection('pushDevices'), []);
  const c = browser({ permission: 'granted' }); c.g.navigator.serviceWorker = { ready: never };   // no service worker at all
  const alive2 = setInterval(() => {}, 1000);
  try { assert.deepEqual(await enablePush(c.g, { timeoutMs: 30 }), { ok: false, reason: 'mislukt' }); } finally { clearInterval(alive2); }
});
await test('a parent can not enable anything, whatever the browser says', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState(); S.push.key = { publicKey: 'BAAA' + 'A'.repeat(83) };
  const b = browser();
  assert.deepEqual(await enablePush(b.g), { ok: false, reason: 'niet-toegestaan' }); assert.equal(b.calls.subscribe.length, 0); assert.deepEqual(fake.collection('pushDevices'), []);
});
await test('which device is this browser? Found through its subscription; unknown without one', async () => {
  asCoordinator();
  assert.equal(await findThisDevice(browser().g), ''); assert.equal(await findThisDevice(browser({ sub: { endpoint: ENDPOINT } }).g), deviceId(ENDPOINT));
  assert.equal(await findThisDevice({ navigator: {}, matchMedia: () => ({ matches: false }) }), '');
});
await test('removing a device deletes it; this browser also cancels its subscription; a parent cannot', async () => {
  const id = deviceId(ENDPOINT), other = 'dother';
  const fake = asCoordinator({ ['pushDevices/' + id]: deviceDoc({ endpoint: ENDPOINT, ...KEYS, uid: 'coord', nowMs: 1 }), ['pushDevices/' + other]: deviceDoc({ endpoint: 'https://fcm.googleapis.com/fcm/send/laptop', ...KEYS, uid: 'coord', nowMs: 1 }) }, { thisDeviceId: id });
  const b = browser({ sub: { endpoint: ENDPOINT, unsubscribe: async () => { b.calls.unsubscribe++; return true; } } });
  assert.equal(await removeDevice(other, b.g), true); assert.equal(b.calls.unsubscribe, 0); assert.equal(fake.get('pushDevices/' + other), undefined);
  assert.equal(await removeDevice(id, b.g), true); assert.equal(b.calls.unsubscribe, 1); assert.equal(fake.get('pushDevices/' + id), undefined); assert.equal(S.push.thisDeviceId, '');
  const f2 = useFakeDb({ ...sampleDbSeed(), 'pushDevices/x': { owner: 'coordinator' } }); sampleParentState();
  assert.equal(await removeDevice('x', b.g), false); assert.ok(f2.get('pushDevices/x'));
});
await test('the Ritten-ruilen category of a device can be switched off and on', async () => {
  const id = deviceId(ENDPOINT);
  const fake = asCoordinator({ ['pushDevices/' + id]: deviceDoc({ endpoint: ENDPOINT, ...KEYS, uid: 'coord', nowMs: 1 }) });
  S.push.devices = { [id]: fake.get('pushDevices/' + id) };
  assert.equal(await setDeviceCategory(id, 'ritbeurs', false), true); assert.deepEqual(fake.get('pushDevices/' + id).categories, { ritbeurs: false });
  assert.equal(await setDeviceCategory(id, 'ritbeurs', true), true); assert.deepEqual(fake.get('pushDevices/' + id).categories, { ritbeurs: true });
  assert.equal(await setDeviceCategory('nope', 'ritbeurs', true), false);
});

console.log('\n=== who am I (the persona) ===');
await test('choosing a family is remembered on this device and shown as "Ouder van Saar"', () => {
  asCoordinator();
  setPersona('f6'); assert.equal(S.push.personaId, 'f6'); assert.equal(personaName(), 'Ouder van Saar'); assert.equal(rememberedPersona(), 'f6');
  setPersona('nobody'); assert.equal(S.push.personaId, ''); assert.equal(personaName(), ''); assert.equal(rememberedPersona(), '');
});
await test('the real notifications of the chosen family are followed, and dropped when another family is chosen', async () => {
  const n = notificationDoc({ kind: 'taken', to: 'f6', offer: { weekKey: '2026-W40', day: 'Do', direction: 'heen', date: '2026-10-01', time: '16:15' }, sourceId: 's1', fromFamilyId: 'f2', nowMs: NOWMS, quiet: normalizeQuiet() });
  asCoordinator({ 'families/f6/notifications/n1': n });
  setPersona('f6'); await tick();
  assert.deepEqual(Object.keys(S.push.personaNotifs), ['n1']);
  setPersona('f3'); await tick();
  assert.deepEqual(S.push.personaNotifs, {}); assert.equal(S.push.personaFor, 'f3');
  setPersona(''); assert.equal(S.push.personaFor, null);
});

console.log('\n=== the listeners ===');
await test('the coordinator follows the key, the status, the devices, the queue and the made-up notifications; stopping clears them', async () => {
  const id = deviceId(ENDPOINT);
  const fake = asCoordinator({ 'settings/pushKey': { publicKey: 'K' }, 'settings/pushStatus': { lastRunAt: 5 }, ['pushDevices/' + id]: { label: 'x' }, 'pushQueue/q': { path: 'p' }, 'testNotifications/t': { kind: 'taken' } });
  syncPushListeners(); await tick();
  assert.deepEqual(S.push.key, { publicKey: 'K' }); assert.deepEqual(S.push.status, { lastRunAt: 5 }); assert.deepEqual(Object.keys(S.push.devices), [id]);
  assert.deepEqual(Object.keys(S.push.queue), ['q']); assert.deepEqual(Object.keys(S.push.tests), ['t']); assert.equal(S.push.unsubs.length, 5);
  syncPushListeners(); assert.equal(S.push.unsubs.length, 5, 'not started twice');
  stopPushListeners(); assert.equal(S.push.unsubs.length, 0); assert.equal(fake.listenerCount(), 0); assert.deepEqual(S.push.devices, {}); assert.equal(S.push.key, null);
});
await test('a made-up notification that arrives while the coordinator is in Testweergave shows up in that family\'s inbox at once', async () => {
  const fake = asCoordinator({}, {}, { impersonateFamilyId: 'f6', ritbeurs: { on: true }, rbView: 'ritbeurs', links: { coord: { familyId: 'f1' } } });
  syncPushListeners(); await tick();
  assert.doesNotMatch(dom.html('tab-deviation'), /neemt je rit over/);
  await fake.sdk.setDoc(fake.sdk.doc(null, 'testNotifications', 'x1'), { ...notificationDoc({ kind: 'taken', to: 'f6', offer: { weekKey: '2026-W40', day: 'Do', direction: 'heen', date: '2026-10-01', time: '16:15' }, sourceId: 's', fromFamilyId: 'f2', nowMs: NOWMS - 1000, quiet: normalizeQuiet() }), expiresAt: NOWMS + 3600e3 });
  await tick(); await tick();
  assert.match(dom.html('tab-deviation'), /neemt je rit over/); stopPushListeners();
});
await test('a parent never starts a listener on the push data', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState();
  syncPushListeners(); await tick();
  assert.equal(S.push.unsubs.length, 0); assert.equal(fake.listenerCount(), 0);
});

console.log('\n=== scenarios ===');
const TESTMODE = { 'settings/push': { mode: 'test' } };
await test('with the switch on uit a scenario only makes the made-up notification for the preview: nothing is queued', async () => {
  const fake = asCoordinator(); setPersona('f6');
  const before = realStore(fake);
  const res = await withFakeNowAsync(NOW, () => runScenario('overgenomen', 'nu'));
  assert.equal(res.rows.length, 1);
  assert.deepEqual(fake.collection('pushQueue'), []); assert.equal(fake.collection('testNotifications').length, 1);
  const [id, doc] = fake.collection('testNotifications')[0];
  assert.match(id, /^taken_test-overgenomen-\d+_f6$/); assert.equal(doc.toFamilyId, 'f6'); assert.equal(doc.kind, 'taken');
  assert.equal(realStore(fake), before); assert.match(toast(), /Situatie afgespeeld/);
});
await test('with the switch on test the chosen family\'s notification is also queued for the server, due when its quiet hours allow', async () => {
  const fake = asCoordinator(TESTMODE); S.pushSettings = { mode: 'test' }; setPersona('f6');
  await withFakeNowAsync(NOW, () => runScenario('overgenomen', 'nu'));
  const q = fake.collection('pushQueue');
  assert.equal(q.length, 1); const [key, entry] = q[0];
  assert.match(key, /^testNotifications__taken_test-overgenomen-\d+_f6$/);
  assert.equal(entry.test, true); assert.equal(entry.toFamilyId, 'f6'); assert.equal(entry.kind, 'taken'); assert.equal(entry.path, 'testNotifications/' + fake.collection('testNotifications')[0][0]);
  assert.equal(entry.deliverAt, NOWMS); assert.match(toast(), /binnen een paar minuten/);
});
await test('pretending it is night makes the notification wait for the quiet hours to end, also in the queue', async () => {
  const fake = asCoordinator(TESTMODE); S.pushSettings = { mode: 'test' }; setPersona('f6');
  await withFakeNowAsync(NOW, () => runScenario('overgenomen', 'nacht'));
  const [, doc] = fake.collection('testNotifications')[0]; const [, entry] = fake.collection('pushQueue')[0];
  assert.ok(doc.deliverAt > NOWMS); assert.equal(entry.deliverAt, doc.deliverAt); assert.equal(S.push.timeChoice, 'nacht');
});
await test('no scenario ever touches real data: offers, back-up moments, deviations, groups, families, links and a family\'s own notifications stay as they were', async () => {
  const fake = asCoordinator({ ...TESTMODE, 'offers/o1': { status: 'open' }, 'backupMoments/m1': { familyId: 'f2', date: '2026-10-01', from: '15:00', to: '17:00', onlyIfFree: true }, 'settings/ritbeurs': { on: true }, 'families/f6/notifications/real1': { kind: 'taken' } });
  S.pushSettings = { mode: 'test' }; S.moments = { m1: fake.get('backupMoments/m1') }; setPersona('f6');
  const before = realStore(fake);
  for (const id of ['rijVrij', 'overgenomen', 'backup', 'nietGedekt', 'dagcoordinator']) { assert.ok(await withFakeNowAsync(NOW, () => runScenario(id, 'nu')), id); assert.equal(realStore(fake), before, id); }
  assert.ok(fake.writes.every(([, p]) => /^(testNotifications|pushQueue)\//.test(p)), 'only test notifications and the queue were written');
});
await test('what the last scenario did stays available for "Wie krijgt dit?"', async () => {
  asCoordinator(); setPersona('f6');
  await withFakeNowAsync(NOW, () => runScenario('rijVrij', 'nu'));
  assert.equal(S.push.last.id, 'rijVrij'); assert.equal(S.push.last.rows[0].toFamilyId, 'f6'); assert.ok(Array.isArray(S.push.last.explain)); assert.equal(Object.keys(S.push.tests).length, 1);
});
await test('without a chosen family, with one family only, or as a parent: a clear message and nothing written', async () => {
  const fake = asCoordinator();
  assert.equal(await runScenario('overgenomen', 'nu'), null); assert.match(toast(), /Kies eerst/); assert.deepEqual(fake.collection('testNotifications'), []);
  const one = useFakeDb({ 'config/coordinator': { uid: 'coord' }, 'families/f1': { parentName: 'A', girlName: 'B' } }); sampleCoordinatorState({ families: { f1: { parentName: 'A', girlName: 'B' } } }); setPersona('f1');
  assert.equal(await runScenario('overgenomen', 'nu'), null); assert.match(toast(), /tweede gezin/); assert.deepEqual(one.collection('testNotifications'), []);
  const p = useFakeDb(sampleDbSeed()); sampleParentState(); S.push.personaId = 'f6';
  assert.equal(await runScenario('overgenomen', 'nu'), null); assert.deepEqual(p.collection('testNotifications'), []);
});
await test('the context takes the next working day of the planning week for a ride that does not exist yet', () => {
  asCoordinator(); const c = scenarioContext('f6', 'nu', NOWMS);
  assert.equal(c.fallbackRide.date, '2026-10-01'); assert.equal(c.fallbackRide.day, 'Do'); assert.equal(c.fallbackRide.time, '16:15');
  // Saturday: the planning week is the coming one, so its first day is used
  S.currentWeekKey = '2026-W42';
  const sat = scenarioContext('f6', 'nu', new Date('2026-10-10T12:00:00+02:00').getTime());
  assert.equal(sat.fallbackRide.date, '2026-10-12'); assert.equal(sat.fallbackRide.day, 'Ma');
});

console.log('\n=== "stuur naar mijn toestel" and clearing ===');
await test('a made-up or real notification is queued again for the server right now, as its own entry', async () => {
  const n = notificationDoc({ kind: 'taken', to: 'f6', offer: {}, sourceId: 's1', fromFamilyId: 'f2', nowMs: NOWMS, quiet: normalizeQuiet() });
  const fake = asCoordinator(TESTMODE); S.pushSettings = { mode: 'test' }; setPersona('f6'); await tick();   // (the listener first reports the family's own notifications: none)
  S.push.tests = { t1: { ...n, deliverAt: NOWMS + 6 * 3600000 } }; S.push.personaNotifs = { r1: n };
  assert.equal(await withFakeNowAsync(NOW, () => sendToMyDevice('testNotifications/t1')), true);
  assert.equal(await withFakeNowAsync(NOW, () => sendToMyDevice('families/f6/notifications/r1')), true);
  const q = Object.fromEntries(fake.collection('pushQueue'));
  const a = q[`testNotifications__t1__m${NOWMS}`], b = q[`families__f6__notifications__r1__m${NOWMS}`];
  assert.equal(a.deliverAt, NOWMS); assert.equal(a.test, true); assert.equal(b.test, false); assert.equal(b.path, 'families/f6/notifications/r1'); assert.equal(b.toFamilyId, 'f6');
});
await test('it needs the switch on test, and a notification that still exists', async () => {
  const fake = asCoordinator(); setPersona('f6'); S.push.tests = { t1: { kind: 'taken', toFamilyId: 'f6' } };
  assert.equal(await sendToMyDevice('testNotifications/t1'), false); assert.match(toast(), /Zet eerst de test aan/);
  S.pushSettings = { mode: 'test' };
  assert.equal(await sendToMyDevice('testNotifications/gone'), false); assert.match(toast(), /bestaat niet meer/); assert.deepEqual(fake.collection('pushQueue'), []);
});
await test('clearing removes the made-up notifications and their queue entries, and leaves real queue entries alone', async () => {
  const fake = asCoordinator({ 'testNotifications/t1': { kind: 'taken' }, 'testNotifications/t2': { kind: 'taken' }, 'pushQueue/a': { test: true }, 'pushQueue/b': { test: false } });
  S.push.tests = { t1: {}, t2: {} }; S.push.queue = { a: { test: true }, b: { test: false } };
  assert.equal(await clearTests(), true);
  assert.deepEqual(fake.collection('testNotifications'), []); assert.deepEqual(fake.collection('pushQueue').map(([k]) => k), ['b']); assert.deepEqual(S.push.tests, {});
});

console.log('\n=== the preview ===');
await test('shows the made-up and the real notifications of the chosen family, newest first, with their state and what was done with the push', async () => {
  const mk = (extra = {}) => ({ ...notificationDoc({ kind: 'taken', to: 'f6', offer: { weekKey: '2026-W40', day: 'Do', direction: 'heen', date: '2026-10-01', time: '16:15' }, sourceId: 's', fromFamilyId: 'f2', nowMs: NOWMS, quiet: normalizeQuiet() }), ...extra });
  asCoordinator(); setPersona('f6');
  S.push.tests = { t1: mk({ createdAt: NOWMS - 1000 }), t2: mk({ createdAt: NOWMS - 500, deliverAt: NOWMS + 3600000 }), other: { ...mk(), toFamilyId: 'f3' } };
  S.push.personaNotifs = { r1: mk({ createdAt: NOWMS - 2000 }), junk: { kind: 'toekomst', toFamilyId: 'f6', createdAt: NOWMS } };
  S.push.queue = { q1: { path: 'testNotifications/t1', sentTo: { d1: 5 } }, q2: { path: 'families/f6/notifications/r1' } };
  const items = previewItems(NOWMS);
  assert.deepEqual(items.map(i => [i.id, i.source, i.state, i.push]), [['t2', 'test', 'wacht', 'geen'], ['t1', 'test', 'bezorgd', 'verstuurd'], ['r1', 'echt', 'bezorgd', 'wachtrij']]);
  assert.equal(items[0].text.title, 'Ouder Piet Pieters'.replace('Ouder ', '') + ' neemt je rit over');
  S.push.personaId = ''; assert.deepEqual(previewItems(NOWMS), []);
});

await test('the module imports nothing it does not use', () => { assertNoUnusedImports('push-data.js'); assertNoUnusedImports('push.js'); assertNoUnusedImports('push-scenarios.js'); assertNoUnusedImports('notif-text.js'); assertNoUnusedImports('push-access.js'); });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
