// Run with: node ui-weekrooster-edit.test.js
// Afwijkend weekrooster, phase 5: the car editor in Rooster. "Zelf indelen" for the one who decides, "Toch zelf wijzigen" with a warning for
// everybody else, the mark "Zelf gewijzigd" in the log of the day coordinator, and nothing of it while the switch is off.
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
import { installFakeDom, useFakeDb, withFakeNow, withFakeNowAsync, NOW, sampleDbSeed, sampleParentState, assertNoUnusedImports } from './test-support.js';
import { S } from '../state.js';
import { syncWeekRequests } from '../weekrooster-data.js';
import { saveDeviationCars } from '../data.js';
import { effectiveCars } from '../rides.js';
import { renderSchedule } from '../ui-schedule.js';
import { renderDeviationTab } from '../ui-deviation.js';
import { goToWijzigen } from '../ui-myweek.js';
import { mayPlanDay, openDayEditor, scheduleEditHtml, scheduleDayFootHtml, wireEdit } from '../ui-weekrooster-edit.js';
import { scheduleAdviceHtml, wireAdvice } from '../ui-weekrooster-advice.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const tick = () => new Promise(r => setImmediate(r));
const rooster = () => { withFakeNow(NOW, () => renderSchedule()); return dom.html('tab-schedule'); };
const setup = async (patch = {}, extra = {}) => {
  const fake = useFakeDb({ ...sampleDbSeed(), ...extra });
  sampleParentState({ weekrooster: { mode: 'aan' }, dayCoordinators: { Do: 'f3' }, scheduleDay: 'Do', roosterMode: 'week', ...patch });
  syncWeekRequests(); await tick(); return fake;
};
const sheet = () => dom.doc.body.children[dom.doc.body.children.length - 1];   // the sheet that was just opened

console.log('=== one screen ===');
await testAsync('Zelf indelen is one screen: the request card on top (no buttons), no coordinator line or tabs, and Klaar at the bottom closes it', async () => {
  await setup({ dayCoordinators: { Do: 'f2' } }, { 'weekRequests/2026-W40_Do_f3': { weekKey: '2026-W40', day: 'Do', familyId: 'f3', rides: true, heen: '07:00', terug: '15:00', status: 'pending', createdAt: 1, updatedAt: 1 } });
  S.wrEdit = { day: 'Do', override: false };
  const html = rooster(), s = text(html);
  assert.match(html, /id="wrEdit"/); assert.match(s, /Actie nodig voor donderdag/); assert.match(s, /Aanvraag/); assert.doesNotMatch(s, /Advies: /);
  assert.doesNotMatch(html, /data-wrtake|data-wrlook|dayPills|data-rmode|coordLine/);
  assert.match(html, /id="wrEditDone"/); assert.match(html, /id="wrEditDone">Klaar</);
  wireEdit({ querySelectorAll: () => [] }); withFakeNow(NOW, () => dom.doc.getElementById('wrEditDone').onclick());
  assert.equal(S.wrEdit, null); assert.match(rooster(), /dayPills/);
});

await testAsync('from Zelf indelen there is a way back to the Advies (next to Klaar), for who decides the day and only while an advice exists', async () => {
  const req = { 'weekRequests/2026-W40_Do_f3': { weekKey: '2026-W40', day: 'Do', familyId: 'f3', rides: true, heen: '07:00', terug: '15:00', status: 'pending', createdAt: 1, updatedAt: 1 } };
  await setup({ dayCoordinators: { Do: 'f2' } }, req); S.wrEdit = { day: 'Do', override: false };
  let html = rooster(); assert.match(text(html.slice(html.indexOf('<div class="actionBar"'))), /^ *Advies bekijken Klaar/);
  wireEdit({ querySelectorAll: () => [] }); withFakeNow(NOW, () => dom.doc.getElementById('wrEditAdvice').onclick());
  assert.equal(S.wrEdit, null); assert.deepEqual(S.wrAdvice, { day: 'Do' }); html = rooster(); assert.match(html, /id="wrAdvice"/); assert.match(html, /id="wrSelf"/);   // and on to Zelf indelen again
  S.wrAdvice = null;
  await setup({ dayCoordinators: { Do: 'f3' } }, req); S.wrEdit = { day: 'Do', override: true };   // a parent after the warning: no advice of his own
  assert.doesNotMatch(rooster(), /wrEditAdvice/); assert.match(rooster(), /id="wrEditDone"/);
  await setup({ dayCoordinators: { Do: 'f2' } }); S.wrEdit = { day: 'Do', override: false };   // nothing waits: no advice to go back to
  assert.doesNotMatch(rooster(), /wrEditAdvice/);
  S.wrEdit = null;
});

console.log('=== a parent: Toch zelf wijzigen ===');
await testAsync('under the day there is only the small link; no editor is open', async () => {
  await setup(); const html = rooster();
  assert.match(html, /data-wroverride="Do"/); assert.match(text(html), /Toch zelf wijzigen/); assert.doesNotMatch(html, /data-wredit=|id="wrEdit"/);
  assert.equal(mayPlanDay('Do'), false);
});
await testAsync('the link first shows the warning with the name of THAT day\'s coordinator; Terug closes it and changes nothing', async () => {
  await setup({ dayCoordinators: { Do: 'f3', Vr: 'f4' } });
  openDayEditor('Vr'); let s = text(sheet().innerHTML);
  assert.match(s, /Dagcoördinator beslist/); assert.match(s, /De dagcoördinator is Mo Bakker\. Hij\/zij bepaalt de wijziging\. Weet je zeker dat je wilt doorgaan\?/);
  assert.match(sheet().innerHTML, /Doorgaan/); assert.match(sheet().innerHTML, /Terug/);
  dom.doc.getElementById('wrOverrideBack').onclick(); assert.equal(S.wrEdit, null);
  openDayEditor('Do'); s = text(sheet().innerHTML); assert.match(s, /Kees de Vries/);
});
await testAsync('Doorgaan opens the car editor of that day in Rooster, marked as an override', async () => {
  await setup(); openDayEditor('Do'); withFakeNow(NOW, () => dom.doc.getElementById('wrOverrideGo').onclick());
  assert.deepEqual(S.wrEdit, { day: 'Do', override: true });
  const html = rooster(); assert.match(html, /id="wrEdit"/); assert.match(text(html), /Zelf indelen.*Donderdag/); assert.match(text(html), /rechtstreeks aan/);
  assert.match(html, /devDir/); assert.doesNotMatch(html, /dayPills/);
});
await testAsync('a change made that way is marked (selfBy, selfAt); the day coordinator sees "Zelf gewijzigd" in his log, and the deciding family sees no mark on its own change', async () => {
  const fake = await setup(); S.wrEdit = { day: 'Do', override: true };
  await withFakeNowAsync(NOW, async () => {
    const cars = effectiveCars('Do', 'heen').map(c => ({ ...c })); if (!cars.length) cars.push({ driverFamilyId: 'f1', girlIds: ['f2'], reserveFamilyIds: [], departureTime: '09:00' });
    assert.equal(await saveDeviationCars('Do', 'heen', cars, { skipGate: true }), true);
  });
  const d = fake.get('deviations/Do_heen'); assert.equal(d.selfBy, 'f2'); assert.equal(typeof d.selfAt, 'number');
  assert.deepEqual(Object.keys(d).filter(k => /reden|reason|text|note/i.test(k)), [], 'no reason or free text');
  // the day coordinator (f3) looks at the same week
  S.wrEdit = null; sampleParentState({ weekrooster: { mode: 'aan' }, dayCoordinators: { Do: 'f2' }, scheduleDay: 'Do', roosterMode: 'week', deviations: { Do_heen: d }, links: { p1: { familyId: 'f2' } } });
  // f2 is the decider here: his own change shows no mark
  assert.doesNotMatch(rooster(), /Zelf gewijzigd/);
  sampleParentState({ weekrooster: { mode: 'aan' }, dayCoordinators: { Do: 'f3' }, scheduleDay: 'Do', roosterMode: 'week', deviations: { Do_heen: d }, links: { p1: { familyId: 'f3' } } });
  syncWeekRequests(); await tick();
  const s = text(rooster()); assert.match(s, /Zelf gewijzigd/); assert.match(s, /heen zelf aangepast/);
});
await testAsync('a change by the planner himself is never marked', async () => {
  const fake = await setup(); S.wrEdit = { day: 'Do', override: false };
  await withFakeNowAsync(NOW, async () => {
    const cars = [{ driverFamilyId: 'f1', girlIds: ['f2'], reserveFamilyIds: [], departureTime: '09:00' }];
    await saveDeviationCars('Do', 'heen', cars, { skipGate: true });
  });
  assert.equal('selfBy' in fake.get('deviations/Do_heen'), false);
});

console.log('=== the one who decides: Zelf indelen ===');
await testAsync('the day coordinator gets "Zelf indelen" under his day and goes straight into the editor, without a warning', async () => {
  await setup({ dayCoordinators: { Do: 'f2' } });
  const html = rooster(); assert.match(html, /data-wredit="Do"/); assert.doesNotMatch(html, /data-wroverride/); assert.equal(mayPlanDay('Do'), true);
  const before = dom.doc.body.children.length;
  openDayEditor('Do'); assert.deepEqual(S.wrEdit, { day: 'Do', override: false }); assert.equal(dom.doc.body.children.length, before, 'no sheet');
  assert.doesNotMatch(text(scheduleEditHtml()), /rechtstreeks aan/);
});
await testAsync('the Advies view has "Zelf indelen" next to Overnemen; it closes the advice and opens the editor', async () => {
  await setup({ dayCoordinators: { Do: 'f2' } }, { 'weekRequests/2026-W40_Do_f3': { weekKey: '2026-W40', day: 'Do', familyId: 'f3', rides: true, heen: '07:00', terug: '15:00', status: 'pending', createdAt: 1, updatedAt: 1 } });
  S.wrAdvice = { day: 'Do', direction: 'heen', variant: 'zuinig' };
  const html = withFakeNow(NOW, () => scheduleAdviceHtml()); assert.match(html, /id="wrSelf"/); assert.match(html, /id="wrAccept"/);
  wireAdvice({ querySelectorAll: () => [] }); dom.doc.getElementById('wrSelf').onclick();
  assert.equal(S.wrAdvice, null); assert.deepEqual(S.wrEdit, { day: 'Do', override: false });
});
await testAsync('the old way in (Mijn week "Regelen", the Wijzigen link) lands in the Rooster editor; without a day it stays as it was', async () => {
  await setup({ dayCoordinators: { Do: 'f2' } });
  withFakeNow(NOW, () => goToWijzigen('Do')); assert.deepEqual(S.wrEdit, { day: 'Do', override: false }); assert.equal(S.scheduleDay, 'Do');
  S.wrEdit = null; withFakeNow(NOW, () => goToWijzigen()); assert.equal(S.wrEdit, null);
});
await testAsync('Terug closes the editor and the day is shown again', async () => {
  await setup({ dayCoordinators: { Do: 'f2' } }); S.wrEdit = { day: 'Do', override: false };
  rooster(); wireEdit({ querySelectorAll: () => [] }); dom.doc.getElementById('wrEditBack').onclick();
  assert.equal(S.wrEdit, null); assert.match(dom.html('tab-schedule'), /data-wredit="Do"/);
});
await testAsync('when the editor draws again through Wijzigen (its handlers do) and Rooster is on screen, Rooster is drawn', async () => {
  await setup({ dayCoordinators: { Do: 'f2' } }); S.wrEdit = { day: 'Do', override: false };
  dom.el('tab-schedule').style.display = 'block'; dom.el('tab-deviation').innerHTML = 'untouched';
  withFakeNow(NOW, () => renderDeviationTab());
  assert.match(dom.html('tab-schedule'), /id="wrEdit"/); assert.equal(dom.html('tab-deviation'), 'untouched');
});

console.log('=== switch off ===');
await testAsync('uit: no link, no editor, and Wijzigen keeps its own day editor', async () => {
  await setup({ weekrooster: { mode: 'uit' } });
  assert.equal(scheduleDayFootHtml('Do'), ''); S.wrEdit = { day: 'Do', override: true }; assert.equal(scheduleEditHtml(), '');
  S.wrEdit = null; assert.doesNotMatch(rooster(), /wroverride|wredit|Toch zelf wijzigen/);
  withFakeNow(NOW, () => goToWijzigen('Do')); assert.equal(S.wrEdit, null); assert.equal(S.deviationDay, 'Do');
});

test('ui-weekrooster-edit.js imports nothing it does not use', () => assertNoUnusedImports('ui-weekrooster-edit.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
