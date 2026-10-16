// Run with: node ui-push-device.test.js
// ui-push-device.js: Instellingen > Push-meldingen. A parent switches the real pushes on for THIS phone. The row only shows while the push switch on
// the Ritten-ruilen card and Ritten ruilen itself are on, for a browser that belongs to a family. A tap on the switch saves at once.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, useFakeDb, sampleCoordinatorState, sampleParentState, sampleDbSeed, expectSnapshot, assertNoUnusedImports } from './test-support.js';
import { S } from '../state.js';
import { openPushSheet, pushMeInnerHtml, pushRowVisible, togglePushMe, wirePushSheet } from '../ui-push-device.js';
import { deviceDoc, deviceId } from '../push.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const toast = () => text(dom.doc.getElementById('toast').innerHTML);
const tick = () => new Promise(r => setImmediate(r));
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/this-phone';
const KEYS = { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) };
const KEY = { publicKey: 'BAAA' + 'A'.repeat(83) };
const LIVE = { mode: 'uit', live: true, liveSince: 1 };
const parent = (patch = {}, seed = {}) => { const fake = useFakeDb({ ...sampleDbSeed(), ...seed }); sampleParentState({ ritbeurs: { on: true }, pushSettings: LIVE, ...patch }); return fake; };

// A browser that can do push, installed as the globals the code looks at.
function withBrowser({ permission = 'default', answer = 'granted', sub = null, userAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36', standalone = true, noPush = false } = {}, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), hadN = globalThis.Notification, hadP = globalThis.PushManager, hadM = globalThis.matchMedia;
  let current = sub; const calls = { subscribe: 0, unsubscribe: 0 };
  const subscription = { endpoint: ENDPOINT, toJSON: () => ({ endpoint: ENDPOINT, keys: KEYS }), unsubscribe: async () => { calls.unsubscribe++; current = null; return true; } };
  const pushManager = { getSubscription: async () => current, subscribe: async () => { calls.subscribe++; current = subscription; return subscription; } };
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent, standalone, ...(noPush ? {} : { serviceWorker: { ready: Promise.resolve({ pushManager }) } }) }, configurable: true, writable: true });
  globalThis.Notification = { permission, requestPermission: async () => { globalThis.Notification.permission = answer; return answer; } };
  if (!noPush) globalThis.PushManager = function PushManager() {}; else delete globalThis.PushManager;
  globalThis.matchMedia = () => ({ matches: false });
  const restore = () => {
    if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator;
    if (hadN === undefined) delete globalThis.Notification; else globalThis.Notification = hadN;
    if (hadP === undefined) delete globalThis.PushManager; else globalThis.PushManager = hadP;
    if (hadM === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = hadM;
  };
  let out; try { out = fn(calls); } catch (e) { restore(); throw e; }
  return out && typeof out.then === 'function' ? out.finally(restore) : (restore(), out);
}
const ready = (extra = {}) => { Object.assign(S.pushMe, { status: 'ready', key: KEY, deviceId: '', on: false, ...extra }); };

console.log('=== who gets the row ===');
await test('only while the push switch AND Ritten ruilen are on, for a browser that belongs to a family', () => {
  parent(); assert.equal(pushRowVisible(), true);
  parent({ pushSettings: { mode: 'test', live: false, liveSince: 0 } }); assert.equal(pushRowVisible(), false, 'push switch off (testing alone does not show it to parents)');
  parent({ pushSettings: null }); assert.equal(pushRowVisible(), false);
  parent({ ritbeurs: { on: false } }); assert.equal(pushRowVisible(), false, 'Ritten ruilen off');
  parent({ ritbeurs: null }); assert.equal(pushRowVisible(), false);
  parent({ links: {} }); assert.equal(pushRowVisible(), false, 'not linked to a family');
  parent({ impersonateFamilyId: 'f6' }); assert.equal(pushRowVisible(), false, 'the coordinator looking as another family: not their phone');
  useFakeDb(sampleDbSeed()); sampleCoordinatorState({ ritbeurs: { on: true }, pushSettings: LIVE }); S.links = {}; assert.equal(pushRowVisible(), false, 'a coordinator without a family');
  sampleCoordinatorState({ ritbeurs: { on: true }, pushSettings: LIVE, links: { coord: { familyId: 'f1' } } }); assert.equal(pushRowVisible(), true, 'a coordinator who is also a parent');
});

console.log('\n=== the sheet ===');
await test('loading and error: a short text, no switch', () => {
  parent(); S.pushMe.status = 'loading'; assert.match(pushMeInnerHtml(), /Even laden/); assert.doesNotMatch(pushMeInnerHtml(), /pushMeOn/);
  S.pushMe.status = 'idle'; assert.match(pushMeInnerHtml(), /Even laden/);
  S.pushMe.status = 'error'; assert.match(text(pushMeInnerHtml()), /Laden is niet gelukt/); assert.doesNotMatch(pushMeInnerHtml(), /pushMeOn/);
});
await test('off, in a browser that can do push: what it is for, a switch that is off, the quiet hours of the family and the privacy line', () => withBrowser({}, () => {
  parent(); ready();
  const html = pushMeInnerHtml(), s = text(html);
  assert.match(s, /Krijg een melding op deze telefoon als er bij Ritten ruilen iets voor jouw gezin is/); assert.match(s, /een rit komt vrij waar jij back-up voor bent/);
  assert.match(html, /<input type="checkbox" role="switch" class="switch" id="pushMeOn">/); assert.doesNotMatch(html, /pushMeOn" checked/); assert.doesNotMatch(html, /disabled/);
  assert.match(s, /Stille uren: van 22:00 tot 06:00/); assert.match(s, /Dit geldt alleen voor deze telefoon/);
  assert.match(s, /push-adres van deze telefoon.*Google, Mozilla of Apple.*niet wat erin staat/); assert.doesNotMatch(html, /style=/);
  S.families.f2.ritbeursQuiet = { from: '21:30', to: '07:00' }; assert.match(text(pushMeInnerHtml()), /van 21:30 tot 07:00/);
  expectSnapshot('ui-push-device', 'sheet, off', html);
}));
await test('on: the switch is on and can be turned off, also when the server key is missing', () => withBrowser({ permission: 'granted' }, () => {
  parent(); ready({ on: true, key: null });
  const html = pushMeInnerHtml(); assert.match(html, /id="pushMeOn" checked>/); assert.doesNotMatch(html, /disabled/); assert.doesNotMatch(text(html), /nog niet klaar/);
}));
await test('every reason it cannot be switched on is said, and the switch is locked', () => {
  parent(); ready();
  withBrowser({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', standalone: false }, () => { const h = pushMeInnerHtml(); assert.match(text(h), /beginscherm/); assert.match(h, /id="pushMeOn" disabled>/); });
  withBrowser({ noPush: true }, () => { const h = pushMeInnerHtml(); assert.match(text(h), /ondersteunt geen pushmeldingen/); assert.match(h, /disabled>/); });
  withBrowser({ permission: 'denied' }, () => { const h = pushMeInnerHtml(); assert.match(text(h), /blokkeert meldingen voor deze site/); assert.match(h, /disabled>/); });
  withBrowser({}, () => { ready({ key: null }); const h = pushMeInnerHtml(); assert.match(text(h), /Push-meldingen zijn nog niet klaar/); assert.match(h, /disabled>/); });
});

console.log('\n=== the switch saves at once ===');
await test('on: the phone is stored for the own family, the sheet shows it on; off: it is removed again', () => withBrowser({}, async calls => {
  const fake = parent({}, { 'settings/pushKey': KEY }); ready({ key: KEY });
  dom.el('pushMeCard').innerHTML = pushMeInnerHtml(); wirePushSheet();
  const sw = dom.el('pushMeOn'); sw.checked = true; sw.onchange();
  assert.equal(sw.disabled, true, 'locked while it works');
  await tick(); await tick(); await tick();
  const id = deviceId(ENDPOINT);
  assert.equal(calls.subscribe, 1); assert.equal(fake.get('pushDevices/' + id).familyId, 'f2'); assert.equal(fake.get('pushDevices/' + id).owner, 'family');
  assert.match(dom.html('pushMeCard'), /id="pushMeOn" checked>/); assert.match(toast(), /Deze telefoon krijgt push-meldingen/);
  const sw2 = dom.el('pushMeOn'); sw2.checked = false; sw2.onchange(); await tick(); await tick(); await tick();
  assert.equal(calls.unsubscribe, 1); assert.equal(fake.get('pushDevices/' + id), undefined); assert.doesNotMatch(dom.html('pushMeCard'), /pushMeOn" checked/); assert.match(toast(), /geen push-meldingen meer/);
  assert.doesNotMatch(dom.html('pushMeCard'), /Opslaan/);
}));
await test('refused permission: the reason is said in a message, nothing is stored and the switch is off again', () => withBrowser({ answer: 'denied' }, async () => {
  const fake = parent(); ready({ key: KEY });
  dom.el('pushMeCard').innerHTML = pushMeInnerHtml(); wirePushSheet();
  const res = await togglePushMe(true);
  assert.deepEqual(res, { ok: false, reason: 'geweigerd' }); assert.match(toast(), /blokkeert meldingen voor deze site/);
  assert.deepEqual(fake.collection('pushDevices'), []); assert.doesNotMatch(dom.html('pushMeCard'), /pushMeOn" checked/);
}));
await test('switching on while the push switch has been turned off meanwhile: nothing is stored', () => withBrowser({}, async () => {
  const fake = parent({ pushSettings: { mode: 'uit', live: false, liveSince: 0 } }); ready({ key: KEY });
  dom.el('pushMeCard').innerHTML = pushMeInnerHtml();
  assert.deepEqual(await togglePushMe(true), { ok: false, reason: 'niet-toegestaan' }); assert.deepEqual(fake.collection('pushDevices'), []);
}));

console.log('\n=== the sheet itself ===');
await test('Instellingen > Push-meldingen opens a sheet with its own title and loads the state of this phone', () => withBrowser({ sub: { endpoint: ENDPOINT } }, async () => {
  parent({}, { 'settings/pushKey': KEY, ['pushDevices/' + deviceId(ENDPOINT)]: deviceDoc({ endpoint: ENDPOINT, ...KEYS, uid: 'p1', nowMs: 1, familyId: 'f2' }) });
  let mounted = null; const created = { innerHTML: '', addEventListener() {} };
  const had = dom.doc.createElement, hadAppend = dom.doc.body.appendChild;
  dom.doc.createElement = () => created; dom.doc.body.appendChild = el => { mounted = el; };
  try { openPushSheet(); } finally { dom.doc.createElement = had; dom.doc.body.appendChild = hadAppend; }
  assert.equal(mounted, created); assert.match(text(created.innerHTML), /^Push-meldingen Even laden/); assert.match(created.innerHTML, /id="pushMeCard"/);
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(S.pushMe.status, 'ready'); assert.equal(S.pushMe.on, true); assert.deepEqual(S.pushMe.key, KEY);
}));
await test('no sheet for a browser without a family of its own', () => {
  parent({ links: {} }); let mounted = false; const hadAppend = dom.doc.body.appendChild; dom.doc.body.appendChild = () => { mounted = true; };
  try { openPushSheet(); } finally { dom.doc.body.appendChild = hadAppend; }
  assert.equal(mounted, false);
});
await test('a parent\'s own switch has no inline styles and the module imports nothing it does not use', () => {
  assert.doesNotMatch(readFileSync(new URL('../ui-push-device.js', import.meta.url), 'utf8'), /style="/);
  assertNoUnusedImports('ui-push-device.js');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
