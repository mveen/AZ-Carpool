// Run with: node app.test.js
// App start-up and glue: init (sign-in, coordinator lookup), tab switching, default tab, week rollover, renderAll.
import assert from 'node:assert/strict';
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
import { S } from './state.js';
import { init, activateTab, chooseDefaultTab, renderAll, afterLinksChanged, checkWeekRollover } from './app.js';

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
test('default tab: coordinator starts on Rooster (standard mode), a parent on Mijn week (week mode)', () => {
  installNav(); useFakeDb(sampleDbSeed());
  sampleCoordinatorState({ defaultTabChosen: false });
  withFakeNow(NOW, () => chooseDefaultTab());
  assert.equal(S.roosterMode, 'standard'); assert.equal(S.defaultTabChosen, true);
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
  const { initDb } = await import('./data.js');
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
test('checkWeekRollover does nothing within the same week', () => {
  installNav(); useFakeDb(sampleDbSeed()); sampleParentState({ linksLoaded: true, coordinatorExists: true });
  withFakeNow(NOW, () => checkWeekRollover());
  assert.equal(S.currentWeekKey, '2026-W40');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
