// Run with: node ui-install-prompt.test.js
// The one-time "put the app on your home screen" sheet: off by default (feature toggle), per-device memory,
// which phones get which offer, and what the buttons do.
import assert from 'node:assert/strict';
import fs from 'node:fs';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, sampleParentState, resetState, withFakeNow, NOW } from './test-support.js';
import { S } from '../state.js';
import * as ip from '../ui-install-prompt.js';

const dom = installFakeDom();
const realGetById = dom.doc.getElementById;
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_FIREFOX = 'Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0';
const IPHONE_WHATSAPP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const setUA = (userAgent, extra = {}) => Object.defineProperty(globalThis, 'navigator', { value: { userAgent, ...extra }, configurable: true, writable: true });

// A sheet we can look into: the overlay, and the two buttons by selector.
function installSheet() {
  const buttons = { '#installPromptLater': { onclick: null, focus() {} }, '#installPromptOk': { onclick: null, focus() {} } };
  const ov = { html: '', mounted: false, removed: false, className: '', id: '', addEventListener() {}, remove() { ov.removed = true; }, buttons,
    set innerHTML(v) { ov.html = v; }, get innerHTML() { return ov.html; }, querySelector: sel => buttons[sel] || null };
  dom.doc.createElement = () => ov; dom.doc.body.appendChild = () => { ov.mounted = true; };
  dom.doc.getElementById = id => (id === 'sheetOverlay' ? (ov.mounted && !ov.removed ? ov : null) : realGetById(id));
  return ov;
}
const sheetOpen = ov => ov.mounted && !ov.removed;
const stored = () => JSON.parse(localStorage.getItem('install-prompt') || 'null');
const ready = (patch = {}) => { dom.reset(); sampleParentState({ linksLoaded: true, ...patch }); setUA(IPHONE_SAFARI); globalThis.location = { hash: '', search: '', href: 'https://mveen.github.io/AZ-Carpool/' }; };
// A fresh copy of the module (the preview switch is read once per page load).
let n = 0; const fresh = () => import('../ui-install-prompt.js?copy=' + (++n));
const ON = () => localStorage.setItem('install-prompt-preview', '1');   // switches the toggle on for the test, like ?installprompt=1 would

console.log('=== the feature toggle ===');
test('the toggle is OFF in the code that gets deployed', () => {
  assert.equal(ip.INSTALL_PROMPT_ENABLED, false);
  assert.match(fs.readFileSync(new URL('../ui-install-prompt.js', import.meta.url), 'utf8'), /export const INSTALL_PROMPT_ENABLED = false;/);
});
test('with the toggle off nothing is shown, however ready the phone is', () => {
  ready(); const ov = installSheet();
  assert.equal(ip.blockedReason(), 'off'); assert.equal(ip.showInstallPrompt(), false); assert.equal(ip.maybeShowInstallPrompt(0), false);
  assert.equal(sheetOpen(ov), false); assert.equal(stored(), null);
});
await testAsync('?installprompt=1 switches it on for this device only, and forgets earlier answers; =0 switches it off again', async () => {
  ready(); localStorage.setItem('install-prompt', JSON.stringify({ v: 1, n: 3, until: 0, done: true }));
  globalThis.location = { search: '?installprompt=1' }; let m = await fresh();
  assert.equal(m.isEnabled(), true); assert.equal(stored(), null); assert.equal(localStorage.getItem('install-prompt-preview'), '1');
  globalThis.location = { search: '' }; m = await fresh(); assert.equal(m.isEnabled(), true, 'stays on for this device');
  globalThis.location = { search: '?installprompt=0' }; m = await fresh(); assert.equal(m.isEnabled(), false); assert.equal(localStorage.getItem('install-prompt-preview'), null);
});
await testAsync('the preview parameter is read once per page load: later checks do not wipe what the sheet stored', async () => {
  ready(); globalThis.location = { search: '?installprompt=1' }; const m = await fresh(); installSheet();
  assert.equal(m.showInstallPrompt(), true); assert.equal(stored().n, 1);
  m.blockedReason(); m.blockedReason(); assert.equal(stored().n, 1);
});
await testAsync('broken storage never throws and never switches the toggle on', async () => {
  ready(); const realStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  try { globalThis.location = { search: '?installprompt=1' }; const m = await fresh(); assert.equal(m.isEnabled(), false); assert.equal(m.showInstallPrompt(), false); }
  finally { globalThis.localStorage = realStorage; }
});

console.log('\n=== which phone gets which offer ===');
test('iPhone in Safari (or Chrome/Firefox on iOS) gets the three-step explanation', () => {
  ready(); assert.equal(ip.installPromptKind(), 'ios');
  setUA(IPHONE_SAFARI.replace('Version/17.5 Mobile/15E148 Safari/604.1', 'CriOS/126.0 Mobile/15E148 Safari/604.1')); assert.equal(ip.installPromptKind(), 'ios');
});
test('an iPhone in-app browser (WhatsApp, Instagram) gets nothing: it has no "Zet op beginscherm"', () => {
  ready(); setUA(IPHONE_WHATSAPP); assert.equal(ip.installPromptKind(), '');
});
test('already on the home screen (standalone) or installed: nothing', () => {
  ready(); setUA(IPHONE_SAFARI, { standalone: true }); assert.equal(ip.installPromptKind(), '');
  ready(); globalThis.matchMedia = q => ({ matches: /standalone/.test(q) }); assert.equal(ip.installPromptKind(), ''); globalThis.matchMedia = () => ({ matches: false });
  ready({ appIsInstalled: true }); assert.equal(ip.installPromptKind(), '');
});
test('Android/Chrome gets the real install button when the browser handed us the install dialog, otherwise nothing', () => {
  ready({ deferredInstallPrompt: { prompt() {} } }); setUA(ANDROID_CHROME); assert.equal(ip.installPromptKind(), 'native');
  ready(); setUA(ANDROID_CHROME); assert.equal(ip.installPromptKind(), '');   // Chrome without an install dialog (already offered/declined): nothing
});
test('Firefox on Android never gets an install dialog, so it gets its own menu explanation', () => {
  ready(); setUA(ANDROID_FIREFOX); assert.equal(ip.installPromptKind(), 'firefox');
  ready(); setUA(ANDROID_FIREFOX, { standalone: false }); ON(); const ov = installSheet(); ip.showInstallPrompt();
  assert.match(ov.html, /Tik op het menu \(drie puntjes\)/); assert.match(ov.html, /Kies “Installeren”/); assert.match(ov.html, /Open AZ Carpool vanaf het nieuwe icoon/);
  assert.doesNotMatch(ov.html, /deel-icoon/); assert.match(ov.html, />Begrepen</);
});
test('a desktop browser gets nothing', () => { ready(); setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15'); assert.equal(ip.installPromptKind(), ''); });

console.log('\n=== when it may come up ===');
test('only once the app is ready and the person is linked (not on the gate screen), and not on top of another sheet', () => {
  ready(); ON(); installSheet(); assert.equal(ip.blockedReason(), '');
  ready({ linksLoaded: false }); ON(); assert.equal(ip.blockedReason(), 'not-ready');
  ready({ appReady: false }); ON(); assert.equal(ip.blockedReason(), 'not-ready');
  ready(); ON(); dom.el('tab-gate').style.display = 'block'; assert.equal(ip.blockedReason(), 'gate');
  ready(); ON(); const ov = installSheet(); ov.mounted = true; assert.equal(ip.blockedReason(), 'sheet-open');
});
test('when the phone cannot remember (private mode), we do not ask at all', () => {
  ready(); ON(); installSheet(); const real = localStorage.setItem;
  localStorage.setItem = (k, v) => { if (k === 'install-prompt-probe') throw new Error('quota'); return real(k, v); };
  assert.equal(ip.blockedReason(), 'no-storage'); localStorage.setItem = real;
});
test('"Later" means two weeks: not before, again after; and never more than three times', () => {
  ready(); ON(); installSheet(); const base = Date.now(), day = 24 * 3600 * 1000;
  localStorage.setItem('install-prompt', JSON.stringify({ v: 1, n: 1, until: base + 14 * day, done: false }));
  assert.equal(ip.blockedReason(base + 13 * day), 'later'); assert.equal(ip.blockedReason(base + 14 * day), '');
  localStorage.setItem('install-prompt', JSON.stringify({ v: 1, n: 3, until: 0, done: false })); assert.equal(ip.blockedReason(base + 99 * day), 'done');
  localStorage.setItem('install-prompt', JSON.stringify({ v: 1, n: 0, until: 0, done: true })); assert.equal(ip.blockedReason(base + 99 * day), 'done');
});
test('a damaged or unknown stored value is treated as "never shown"', () => {
  ready(); localStorage.setItem('install-prompt', '{oops'); assert.equal(ip.readState().n, 0);
  localStorage.setItem('install-prompt', JSON.stringify({ v: 9, done: true })); assert.equal(ip.readState().done, false);
});

console.log('\n=== the sheet and its buttons ===');
test('iOS: title, three steps with icons, Later and Begrepen; no inline styles', () => {
  ready(); ON(); const ov = installSheet(); withFakeNow(NOW, () => assert.equal(ip.showInstallPrompt(), true));
  assert.equal(sheetOpen(ov), true); assert.equal(ov.id, 'sheetOverlay'); assert.equal(ov.className, 'sheetOverlay');
  assert.match(ov.html, /Zet AZ Carpool op je beginscherm/); assert.match(ov.html, /Tik op het deel-icoon/); assert.match(ov.html, /Kies “Zet op beginscherm”/); assert.match(ov.html, /Open AZ Carpool vanaf het nieuwe icoon/);
  assert.equal((ov.html.match(/class="settingsRow"><svg/g) || []).length, 3);
  assert.match(ov.html, /id="installPromptLater">Later</); assert.match(ov.html, /id="installPromptOk">Begrepen</);
  assert.doesNotMatch(ov.html.replace(/<svg[\s\S]*?<\/svg>/g, ''), /style=/, 'only the icon helper sets styles, this sheet adds none'); assert.match(ov.html, /role="dialog"/);
});
test('showing counts as asked: any way out (outside tap, Escape, "Later") is a "Later"', () => {
  ready(); ON(); const ov = installSheet(); withFakeNow(NOW, () => ip.showInstallPrompt());
  const s = stored(); assert.equal(s.n, 1); assert.equal(s.done, false); assert.equal(s.until, new Date(NOW).getTime() + 14 * 24 * 3600 * 1000);
  ov.buttons['#installPromptLater'].onclick(); assert.equal(sheetOpen(ov), false); assert.equal(stored().done, false);
});
await testAsync('"Begrepen" closes the sheet and it never comes back', async () => {
  ready(); ON(); const ov = installSheet(); ip.showInstallPrompt();
  await ov.buttons['#installPromptOk'].onclick(); assert.equal(sheetOpen(ov), false); assert.equal(stored().done, true);
  assert.equal(ip.blockedReason(Date.now() + 365 * 24 * 3600 * 1000), 'done');
});
await testAsync('Android: "Installeer app" opens the browser dialog; accepted = done, cancelled = it may ask again later', async () => {
  let asked = 0;
  ready({ deferredInstallPrompt: { prompt() { asked++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) } }); setUA(ANDROID_CHROME); ON();
  let ov = installSheet(); ip.showInstallPrompt();
  assert.doesNotMatch(ov.html, /Tik op het deel-icoon/); assert.match(ov.html, />Installeer app</); assert.match(ov.html, /Eén tik/);
  await ov.buttons['#installPromptOk'].onclick(); assert.equal(asked, 1); assert.equal(stored().done, true); assert.equal(S.deferredInstallPrompt, null);
  ready({ deferredInstallPrompt: { prompt() { asked++; }, userChoice: Promise.resolve({ outcome: 'dismissed' }) } }); setUA(ANDROID_CHROME); ON();
  ov = installSheet(); ip.showInstallPrompt(); await ov.buttons['#installPromptOk'].onclick(); assert.equal(stored().done, false); assert.equal(stored().n, 1);
});
await testAsync('a failing browser dialog does not break anything or mark the install as done', async () => {
  ready({ deferredInstallPrompt: { prompt() { throw new Error('nope'); }, userChoice: Promise.resolve({ outcome: 'accepted' }) } }); setUA(ANDROID_CHROME); ON();
  const ov = installSheet(); ip.showInstallPrompt(); await ov.buttons['#installPromptOk'].onclick(); assert.equal(stored().done, false);
});
// Timers made by the module are caught here and run by hand, so the tests do not depend on the clock.
function catchTimers(fn) {
  const real = globalThis.setTimeout, queued = [];
  globalThis.setTimeout = f => { queued.push(f); return 0; };
  try { fn(); } finally { globalThis.setTimeout = real; }
  return () => queued.forEach(f => f());
}
await testAsync('maybeShowInstallPrompt waits, checks again, and puts at most one sheet up per page load', async () => {
  const m = await fresh(); ready(); ON(); const ov = installSheet(); let results = [];
  const fire = catchTimers(() => { results = [m.maybeShowInstallPrompt(0), m.maybeShowInstallPrompt(0)]; });
  assert.deepEqual(results, [true, false], 'the second call finds it already scheduled'); assert.equal(sheetOpen(ov), false, 'not yet');
  fire(); assert.equal(sheetOpen(ov), true); assert.equal(stored().n, 1);
  assert.equal(m.maybeShowInstallPrompt(0), false, 'blocked: a sheet is open and it was asked');
});
await testAsync('if something else took the screen during the wait, it stays away this time and does not use up a showing', async () => {
  const m = await fresh(); ready(); ON(); const ov = installSheet();
  const fire = catchTimers(() => assert.equal(m.maybeShowInstallPrompt(0), true));
  ov.mounted = true;   // another sheet appears while we wait
  fire(); assert.equal(stored(), null);
});
await testAsync('after such a miss the next chance (e.g. the next links update) can still show it', async () => {
  const m = await fresh(); ready(); ON(); const ov = installSheet();
  let fire = catchTimers(() => m.maybeShowInstallPrompt(0)); ov.mounted = true; fire(); ov.mounted = false;
  fire = catchTimers(() => assert.equal(m.maybeShowInstallPrompt(0), true)); fire(); assert.equal(sheetOpen(ov), true); assert.equal(stored().n, 1);
});

console.log('\n=== wiring ===');
test('app.js asks for the sheet when the links are loaded and when the browser offers the install dialog', () => {
  const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ maybeShowInstallPrompt \} from '\.\/ui-install-prompt\.js'/);
  assert.equal((src.match(/maybeShowInstallPrompt\(\)/g) || []).length, 2);
});
test('the new module is in the service worker file list, and every text it uses exists', () => {
  assert.match(fs.readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8'), /'\.\/ui-install-prompt\.js'/);
  const used = [...fs.readFileSync(new URL('../ui-install-prompt.js', import.meta.url), 'utf8').matchAll(/['"]((?:installprompt|common)\.[\w]+)['"]/g)].map(m => m[1]);
  const texts = fs.readFileSync(new URL('../texts-nl.js', import.meta.url), 'utf8');
  assert.ok(used.length >= 8); used.forEach(k => assert.match(texts, new RegExp("['\"]" + k.replace('.', '\\.') + "['\"]\\s*:")));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
