// Run with: node ui-day-change-notice.test.js
// The hint in "Wijzigingen voor <dag>" and the Beheer card "Melding dagwijzigingen": what is shown, what is saved, what is refused.
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
import { installFakeDom, useFakeDb, sampleDbSeed, sampleCoordinatorState, sampleParentState, withFakeNow, withFakeNowAsync, NOW, assertNoUnusedImports } from './test-support.js';
import { S } from '../state.js';
import { dayChangeNoticeHtml, dayChangeNoticeCardHtml, saveDayChangeNotice, rememberDayChangeNoticeDraft, readDayChangeNoticeForm } from '../ui-day-change-notice.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const toast = () => dom.doc.getElementById('toast').innerHTML;
const setForm = v => { dom.el('dayNoticeOn').checked = !!v.on; dom.el('dayNoticeUntil').value = v.until || ''; };
// NOW is Wednesday 30 Sep 2026 10:00 (week 2026-W40): Thursday is tomorrow, Friday is the day after.
const WEEK = { currentWeekKey: '2026-W40' };

console.log('=== the hint ===');
test('before 11:00 on the day before: the exact text, with the day before', () => {
  sampleParentState({ ...WEEK, dayChangeNotice: null });
  const html = withFakeNow(NOW, () => dayChangeNoticeHtml('Do'));
  assert.equal(text(html), 'Wijzigingen doorvoeren kan al, maar als er nog wijzigingen bijkomen, kunnen tijden en autosamenstellingen weer veranderen. Het advies is te wachten tot de namiddag van vandaag.');
  assert.match(html, /role="status"/); assert.doesNotMatch(html.replace(/<svg[\s\S]*?<\/svg>/g, ''), /style=/);
});
test('for a day further away it names the weekday before it', () => {
  sampleParentState({ ...WEEK, dayChangeNotice: null });
  assert.match(text(withFakeNow(NOW, () => dayChangeNoticeHtml('Vr'))), /tot de namiddag van donderdag\.$/);
  assert.match(text(withFakeNow('2026-09-25T09:00:00+02:00', () => dayChangeNoticeHtml('Ma'))), /tot de namiddag van zondag\.$/);   // Monday 28 Sep: the day before is Sunday
});
test('from 11:00 on the day before: no hint', () => {
  sampleParentState({ ...WEEK, dayChangeNotice: null });
  assert.equal(withFakeNow('2026-09-30T11:00:00+02:00', () => dayChangeNoticeHtml('Do')), '');
  assert.equal(withFakeNow('2026-09-30T15:00:00+02:00', () => dayChangeNoticeHtml('Do')), '');
});
test('switched off: no hint; another time moves the cut-off', () => {
  sampleParentState({ ...WEEK, dayChangeNotice: { on: false, until: '11:00' } });
  assert.equal(withFakeNow(NOW, () => dayChangeNoticeHtml('Do')), '');
  sampleParentState({ ...WEEK, dayChangeNotice: { on: true, until: '14:00' } });
  assert.ok(withFakeNow('2026-09-30T13:59:00+02:00', () => dayChangeNoticeHtml('Do')));
  assert.equal(withFakeNow('2026-09-30T14:00:00+02:00', () => dayChangeNoticeHtml('Do')), '');
});

console.log('=== the card in Beheer ===');
test('the card is called Melding dagwijzigingen, has a switch and a time field (default on, 11:00)', () => {
  sampleCoordinatorState({ dayChangeNotice: null });
  const html = dayChangeNoticeCardHtml();
  assert.match(text(html), /^Melding dagwijzigingen/); assert.match(text(html), /Melding tonen tot deze tijd de dag ervoor/);
  assert.match(html, /role="switch"[^>]*id="dayNoticeOn" checked/); assert.match(html, /id="dayNoticeUntil" value="11:00"/);
  assert.doesNotMatch(html, /style=/);
});
test('it shows what was stored, and what is filled in is kept while Beheer redraws', () => {
  sampleCoordinatorState({ dayChangeNotice: { on: false, until: '09:30' } });
  assert.match(dayChangeNoticeCardHtml(), /id="dayNoticeUntil" value="09:30"/); assert.doesNotMatch(dayChangeNoticeCardHtml(), /id="dayNoticeOn" checked/);
  dayChangeNoticeCardHtml(); setForm({ on: true, until: '12:00' }); rememberDayChangeNoticeDraft();
  assert.deepEqual(S.dayChangeNoticeDraft, { on: true, until: '12:00' }); assert.match(dayChangeNoticeCardHtml(), /id="dayNoticeUntil" value="12:00"/);
  S.dayChangeNoticeDraft = null;
});

console.log('=== saving ===');
await testAsync('save writes settings/dayChangeNotice and tells the coordinator', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ dayChangeNotice: null });
  dayChangeNoticeCardHtml(); setForm({ on: true, until: '10:00' });
  assert.deepEqual(readDayChangeNoticeForm(), { on: true, until: '10:00' });
  assert.equal(await withFakeNowAsync(NOW, () => saveDayChangeNotice()), true);
  const d = fake.get('settings/dayChangeNotice'); assert.equal(d.on, true); assert.equal(d.until, '10:00'); assert.equal(typeof d.updatedAt, 'number');
  assert.deepEqual(S.dayChangeNotice, { on: true, until: '10:00' }); assert.equal(S.dayChangeNoticeDraft, null);
  assert.match(toast(), /Melding dagwijzigingen staat aan/);
});
await testAsync('switching it off is saved too', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ dayChangeNotice: null });
  dayChangeNoticeCardHtml(); setForm({ on: false, until: '11:00' });
  assert.equal(await saveDayChangeNotice(), true);
  assert.equal(fake.get('settings/dayChangeNotice').on, false); assert.match(toast(), /Melding dagwijzigingen staat uit/);
});
await testAsync('an empty time is refused, nothing is written and what was typed stays', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ dayChangeNotice: null });
  dayChangeNoticeCardHtml(); setForm({ on: true, until: '' });
  assert.equal(await saveDayChangeNotice(), false);
  assert.equal(fake.get('settings/dayChangeNotice'), undefined); assert.match(toast(), /geldige tijd/); assert.deepEqual(S.dayChangeNoticeDraft, { on: true, until: '' });
  S.dayChangeNoticeDraft = null;
});

test('ui-day-change-notice.js imports nothing it does not use', () => assertNoUnusedImports('ui-day-change-notice.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
