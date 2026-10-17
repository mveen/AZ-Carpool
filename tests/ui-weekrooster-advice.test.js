// Run with: node ui-weekrooster-advice.test.js
// Afwijkend weekrooster, phase 4: the Advies view of the day coordinator: variants, what changes, the reason, Overnemen with Ongedaan,
// and the Dagbericht afterwards. With the switch off or without a request: nothing of it.
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
import { t } from '../i18n.js';
import { syncWeekRequests } from '../weekrooster-data.js';
import { scheduleAdviceHtml, wireAdvice } from '../ui-weekrooster-advice.js';
import { renderSchedule } from '../ui-schedule.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const WK = '2026-W40';
const doc = (day, fam, e = {}) => ({ weekKey: WK, day, familyId: fam, rides: true, heen: '07:00', terug: '15:00', status: 'pending', createdAt: 1, updatedAt: 1, ...e });
const tick = () => new Promise(r => setImmediate(r));
const setup = async (extra = {}, patch = {}) => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'weekRequests/2026-W40_Do_f3': doc('Do', 'f3'), ...extra });
  sampleParentState({ weekrooster: { mode: 'aan' }, dayCoordinators: { Do: 'f2' }, scheduleDay: 'Do', roosterMode: 'week', ...patch });
  syncWeekRequests(); await tick(); return fake;
};
const view = () => withFakeNow(NOW, () => scheduleAdviceHtml());
const click = id => { wireAdvice({ querySelectorAll: () => [] }); return dom.doc.getElementById(id).onclick(); };

console.log('=== the view ===');
await testAsync('nothing open: nothing shown; open: header, variants, tags, both card lists, the reason and Overnemen', async () => {
  await setup(); assert.equal(view(), '');
  S.wrAdvice = { day: 'Do', direction: 'heen', variant: 'zuinig' };
  const html = view(), s = text(html);
  assert.match(s, /Advies · donderdag 1 okt · heen/); assert.doesNotMatch(html, /class="card" id="wrAdvice"/); assert.match(s, /Zuinigst/); assert.match(s, /Minste gedoe/);
  assert.match(s, /Nu · vaste rooster/); assert.match(s, /Reden:/); assert.match(s, /Overnemen/);
  assert.match(s, /1 auto \(\+1\)/); assert.match(html, /id="wrAccept"/); assert.match(html, /chip/);
  assert.doesNotMatch(html.replace(/<svg[\s\S]*?<\/svg>/g, ''), /style=/);
});
await testAsync('the second variant is shown on choice and the reason follows the planning', async () => {
  await setup(); S.wrAdvice = { day: 'Do', direction: 'heen', variant: 'gedoe' };
  assert.match(text(view()), /Reden:.*zoveel mogelijk/);
  S.wrAdvice = { day: 'Do', direction: 'heen', variant: 'nonsense' }; assert.match(view(), /id="wrAccept"/);
});
await testAsync('nothing to advise (no open request): the view closes itself', async () => {
  await setup({ 'weekRequests/2026-W40_Do_f3': doc('Do', 'f3', { status: 'accepted' }) });
  S.wrAdvice = { day: 'Do', direction: 'heen', variant: 'zuinig' }; assert.equal(view(), ''); assert.equal(S.wrAdvice, null);
});
await testAsync('uit: nothing, even when the state says open', async () => {
  await setup({}, { weekrooster: { mode: 'uit' } }); S.wrAdvice = { day: 'Do', direction: 'heen', variant: 'zuinig' };
  assert.equal(view(), '');
});

console.log('=== Overnemen and Ongedaan ===');
await testAsync('Overnemen saves, shows the Dagbericht and the toast; Ongedaan brings back the old state', async () => {
  const fake = await setup(); S.wrAdvice = { day: 'Do', direction: 'heen', variant: 'zuinig' };
  await withFakeNowAsync(NOW, async () => {
    view(); await click('wrAccept');
    assert.equal(S.wrAdvice, null); assert.deepEqual(S.wrDone, { day: 'Do' });
    assert.equal(fake.get('weekRequests/2026-W40_Do_f3').status, 'accepted');
    assert.deepEqual(fake.get('deviations/Do_heen').times, { f3: '07:00' });
    const toast = dom.doc.getElementById('toast');
    assert.match(text(toast.innerHTML), /wijziging.* doorgevoerd/); assert.match(toast.innerHTML, /Ongedaan/);
    assert.match(text(view()), /Doorgevoerd voor donderdag/); assert.match(view(), /conclusieBtn/);
    toast.onclick({ target: { id: 'toastAction' } }); await tick(); await tick();
    assert.equal(fake.get('weekRequests/2026-W40_Do_f3').status, 'pending');
    assert.equal(fake.get('deviations/Do_heen').times, undefined);
    assert.equal(S.wrDone, null); assert.equal(S.wrAdvice.day, 'Do');
  });
});
await testAsync('a failing save changes nothing and keeps the view open', async () => {
  const fake = await setup(); fake.failWrites('deviations', 'denied'); S.wrAdvice = { day: 'Do', direction: 'heen', variant: 'zuinig' };
  await withFakeNowAsync(NOW, async () => { view(); await click('wrAccept'); });
  assert.deepEqual(S.wrAdvice, { day: 'Do', direction: 'heen', variant: 'zuinig' }); assert.equal(S.wrDone, null);
  assert.equal(fake.get('weekRequests/2026-W40_Do_f3').status, 'pending');
});
await testAsync('the Rooster shows the view in place of the day when it is open', async () => {
  await setup(); S.wrAdvice = { day: 'Do', direction: 'heen', variant: 'zuinig' };
  withFakeNow(NOW, () => renderSchedule()); assert.match(dom.html('tab-schedule'), /id="wrAdvice"/);
  S.wrAdvice = null; withFakeNow(NOW, () => renderSchedule()); assert.match(dom.html('tab-schedule'), /data-wradvice="Do"/);
});

await testAsync('the Advies view offers Zelf indelen next to Overnemen', async () => {
  await setup(); S.wrAdvice = { day: 'Do', direction: 'heen', variant: 'zuinig' };
  const html = view(); assert.match(html, /id="wrSelf"/); assert.match(text(html), /Zelf indelen.*Overnemen/); S.wrAdvice = null;
});
test('the text under a changed car says what changed: the children, or only the departure time', () => {
  assert.equal(t('weekrooster.advice.before', { p1: 'Eline & Saar' }), 'Eerder: Eline & Saar'); assert.equal(t('weekrooster.advice.beforeTime', { p1: '14:45' }), 'Eerder vertrek: 14:45');
});
test('ui-weekrooster-advice.js imports nothing it does not use', () => assertNoUnusedImports('ui-weekrooster-advice.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
