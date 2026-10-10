// Run with: node app.test.js
// App start-up and glue: init (sign-in, coordinator lookup), tab switching, default tab, week rollover, renderAll.
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
import { installFakeDom, sampleCoordinatorState, sampleParentState, resetState, useFakeDb, sampleDbSeed, withFakeNow, withFakeNowAsync, NOW } from './test-support.js';
import { S } from '../state.js';
import { recomputeCanEdit } from '../coordinator.js';
import { syncCoordinatorNav, bootstrap, init, activateTab, chooseDefaultTab, renderAll, afterLinksChanged, checkWeekRollover } from '../app.js';

const dom = installFakeDom();
const status = () => dom.doc.getElementById('whoami').innerHTML;

// The fake DOM has no nav buttons; give it four so tab switching can be observed.
function installNav() {
  const tabs = ['schedule', 'myweek', 'deviation', 'profile', 'beheer'];
  const buttons = tabs.map(tab => {
    const cls = new Set(); const attrs = {};
    return { dataset: { tab }, classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) }, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; }, getAttribute: k => attrs[k] ?? null, addEventListener() {} };
  });
  dom.doc.querySelectorAll = sel => (sel.startsWith('nav button') ? buttons : []);
  dom.doc.querySelector = sel => { const m = sel.match(/data-tab="(\w+)"/); return m ? buttons.find(b => b.dataset.tab === m[1]) : null; };
  return buttons;
}

console.log('=== tabs ===');
test('activateTab shows only the chosen tab and marks its button current', () => {
  const buttons = installNav(); resetState({});
  dom.el('tab-gate').style.display = 'none';
  activateTab('deviation');
  assert.equal(dom.el('tab-deviation').style.display, 'block');
  assert.equal(dom.el('tab-schedule').style.display, 'none');
  assert.equal(buttons.find(b => b.dataset.tab === 'deviation').getAttribute('aria-current'), 'page');
  assert.equal(buttons.find(b => b.dataset.tab === 'schedule').getAttribute('aria-current'), null);
});
test('activateTab puts the screen name in the header and shows the share button on Mijn week only', () => {
  installNav(); resetState({}); dom.el('tab-gate').style.display = 'none';
  activateTab('deviation'); assert.equal(dom.el('headerTitle').textContent, 'Wijzigen'); assert.equal(dom.el('shareToggle').hidden, true);
  activateTab('myweek'); assert.equal(dom.el('headerTitle').textContent, 'Mijn week'); assert.equal(dom.el('shareToggle').hidden, false);
});
test('the Beheer tab follows the coordinator view: shown for the coordinator, hidden for "Bekijk als: Ouder" and for parents', () => {
  sampleCoordinatorState({ links: { coord: { familyId: 'f1' } } }); syncCoordinatorNav(); assert.equal(dom.el('navBeheer').style.display, '');
  S.viewAsParent = true; recomputeCanEdit(); syncCoordinatorNav(); assert.equal(dom.el('navBeheer').style.display, 'none');
  sampleParentState(); syncCoordinatorNav(); assert.equal(dom.el('navBeheer').style.display, 'none');
});
test('the Wedstrijden tab label is short ("Wedstrijd") only when the coordinator has five tabs', () => {
  sampleParentState(); syncCoordinatorNav(); assert.equal(dom.el('navMatchesLabel').textContent, 'Wedstrijden');
  sampleCoordinatorState(); syncCoordinatorNav(); assert.equal(dom.el('navMatchesLabel').textContent, 'Wedstrijd');
});
test('activateTab leaves the tabs alone while the gate is showing', () => {
  installNav(); resetState({});
  dom.el('tab-gate').style.display = 'block'; dom.el('tab-myweek').style.display = 'none';
  activateTab('myweek');
  assert.equal(dom.el('tab-myweek').style.display, 'none');
});
test('an unknown tab name changes nothing', () => {
  installNav(); resetState({}); dom.el('tab-gate').style.display = 'none'; dom.el('tab-profile').style.display = 'none';
  activateTab('nope');
  assert.equal(dom.el('tab-profile').style.display, 'none');
});
test('default tab: everyone, coordinator included, starts on Mijn week (home); Rooster mode stays standard for the coordinator', () => {
  installNav(); useFakeDb(sampleDbSeed());
  sampleCoordinatorState({ defaultTabChosen: false });
  withFakeNow(NOW, () => chooseDefaultTab());
  assert.equal(S.roosterMode, 'standard'); assert.equal(S.defaultTabChosen, true);
  assert.equal(dom.el('tab-myweek').style.display, 'block');
  assert.equal(dom.el('tab-schedule').style.display, 'none');
  sampleParentState({ defaultTabChosen: false });
  withFakeNow(NOW, () => chooseDefaultTab());
  assert.equal(S.roosterMode, 'week');
  assert.equal(dom.el('tab-myweek').style.display, 'block');
});
test('the default tab is chosen once, and not before the app is ready', () => {
  installNav(); useFakeDb(sampleDbSeed());
  sampleParentState({ defaultTabChosen: false, appReady: false });
  chooseDefaultTab(); assert.equal(S.defaultTabChosen, false);
  sampleParentState({ defaultTabChosen: true, roosterMode: 'standard' });
  chooseDefaultTab(); assert.equal(S.roosterMode, 'standard');
});
test('a tab from the URL hash is respected: no default tab switch', () => {
  const buttons = installNav(); useFakeDb(sampleDbSeed());
  sampleParentState({ defaultTabChosen: false, hashTabApplied: true });
  dom.el('tab-deviation').style.display = 'block'; dom.el('tab-myweek').style.display = 'none';
  withFakeNow(NOW, () => chooseDefaultTab());
  assert.equal(dom.el('tab-myweek').style.display, 'none');
});

console.log('\n=== rendering ===');
test('renderAll fills every tab for a parent', () => {
  installNav(); useFakeDb(sampleDbSeed()); sampleParentState({ linksLoaded: true, coordinatorExists: true });
  ['tab-schedule', 'tab-myweek', 'tab-deviation', 'tab-profile'].forEach(id => { dom.el(id).innerHTML = ''; });
  withFakeNow(NOW, () => renderAll());
  ['tab-schedule', 'tab-myweek', 'tab-deviation', 'tab-profile'].forEach(id => assert.ok(dom.html(id).length > 50, id + ' has content'));
});

console.log('\n=== start-up ===');
await testAsync('init signs in, reads the coordinator config and marks the app ready', async () => {
  installNav(); useFakeDb(sampleDbSeed(), { uid: 'coord' });
  resetState({ appReady: false });
  await withFakeNowAsync(NOW, () => init());
  assert.equal(S.me, 'coord'); assert.equal(S.appReady, true); assert.equal(S.coordinatorExists, true);
  assert.equal(S.coordinatorConfig.uid, 'coord');
});
await testAsync('init on an empty database sees no coordinator yet, so the claim screen can follow', async () => {
  installNav(); useFakeDb({}, { uid: 'u9' }); resetState({ appReady: false });
  await withFakeNowAsync(NOW, () => init());
  assert.equal(S.coordinatorExists, false); assert.equal(S.appReady, true);
});
await testAsync('a failed sign-in shows a connection error and never marks the app ready', async () => {
  installNav();
  const fake = useFakeDb({}); resetState({ appReady: false });
  const { initDb } = await import('../data.js');
  initDb({ signIn: async () => { throw new Error('offline'); }, doc: () => { throw new Error('unused'); } });
  await withFakeNowAsync(NOW, () => init());
  assert.equal(S.appReady, false);
  assert.match(status(), /Niet verbonden/);
});

console.log('\n=== links and week rollover ===');
test('afterLinksChanged marks links as loaded and re-renders', () => {
  installNav(); useFakeDb(sampleDbSeed()); sampleParentState({ linksLoaded: false, coordinatorExists: true, defaultTabChosen: false });
  withFakeNow(NOW, () => afterLinksChanged());
  assert.equal(S.linksLoaded, true); assert.equal(S.defaultTabChosen, true);
});
test('checkWeekRollover moves to the new planning week once Saturday starts', () => {
  installNav(); useFakeDb(sampleDbSeed()); sampleParentState({ linksLoaded: true, coordinatorExists: true });
  withFakeNow('2026-10-03T00:30:00+02:00', () => checkWeekRollover());
  assert.equal(S.currentWeekKey, '2026-W41');
});
test('the minute check and the return to the app both refresh the period task (badge and card change with the clock)', () => {
  const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(src, /setInterval\(\(\)=>\{[^}]*refreshPeriodTask\(\)/); assert.match(src, /visibilitychange[^\n]*refreshPeriodTask\(\)/);
});
await testAsync('update check: foreground asks for a new service worker; a takeover reloads once, the first install never', async () => {
  const saved = { navigator: globalThis.navigator, location: globalThis.location, window: globalThis.window };
  const run = async (controller) => {
    const listeners = {}, docListeners = {}; let updates = 0, reloads = 0;
    const sw = { controller, addEventListener: (t, f) => { listeners[t] = f; }, register: async () => ({ update: async () => { updates++; } }) };
    Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: sw }, configurable: true });
    Object.defineProperty(globalThis, 'location', { value: { hash: '', reload: () => { reloads++; } }, configurable: true });
    globalThis.window = { addEventListener() {} };
    const realAdd = dom.doc.addEventListener, realHidden = dom.doc.hidden;
    dom.doc.addEventListener = (t, f) => { docListeners[t] = f; }; dom.doc.hidden = false;
    const realSetInterval = globalThis.setInterval; globalThis.setInterval = () => 0;
    try { installNav(); bootstrap(); } finally { globalThis.setInterval = realSetInterval; dom.doc.addEventListener = realAdd; dom.doc.hidden = realHidden; }
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const afterRegister = updates;
    resetState({}); docListeners.visibilitychange();
    listeners.controllerchange(); listeners.controllerchange();
    return { afterRegister, updates, reloads };
  };
  try {
    const upgrade = await run({});
    assert.equal(upgrade.afterRegister, 1); assert.equal(upgrade.updates, 2); assert.equal(upgrade.reloads, 1);
    const first = await run(null);
    assert.equal(first.reloads, 0);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); }
  }
});
test('checkWeekRollover does nothing within the same week', () => {
  installNav(); useFakeDb(sampleDbSeed()); sampleParentState({ linksLoaded: true, coordinatorExists: true });
  withFakeNow(NOW, () => checkWeekRollover());
  assert.equal(S.currentWeekKey, '2026-W40');
});

test('renderAll shows the maintenance page to a parent, not to the coordinator', () => {
  sampleParentState({ maintenance: { on: true, text: 'Terug om 8' } });
  withFakeNow(NOW, () => renderAll());
  assert.equal(dom.el('maintenanceOverlay').style.display, 'flex'); assert.match(dom.html('maintenanceOverlay'), /Terug om 8/);
  sampleCoordinatorState({ maintenance: { on: true, text: 'Terug om 8' } });
  withFakeNow(NOW, () => renderAll());
  assert.equal(dom.el('maintenanceOverlay').style.display, 'none'); assert.equal(dom.el('maintenanceBanner').style.display, 'flex');
});

test('renderAll draws the notice bar', () => {
  sampleCoordinatorState({ notice: { on: true, text: 'Test melding', offDate: '', offTime: '' } });
  withFakeNow(NOW, () => renderAll());
  assert.match(dom.html('noticeBanner'), /Test melding/);
});

test('opening the app and coming back to the foreground both record the session', () => {
  const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(src, /syncListeners\(\);\s*recordSession\(\);/); assert.match(src, /visibilitychange[^\n]*recordSession\(\)/);
});

test('the minute timer logs shifts that have taken place (logPassedShifts) when the week did not roll over', () => {
  const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(src, /else if\(S\.appReady\) logPassedShifts\(\)/);
});

test('the minute check and coming back to the app run the Ritbeurs checks (late offers, housekeeping)', () => {
  const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ checkRitbeurs \} from '\.\/ritbeurs-data\.js'/);
  assert.equal((src.match(/checkRitbeurs\(\)/g) || []).length, 2);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
