// Run with: node ui-weekrooster-rooster.test.js
// Afwijkend weekrooster, phase 3: Rooster "Deze week" and Mijn week for the day coordinator (action card, "Actie nodig", log, dot,
// number on the tab) and for a parent (read only; only the own request). With the switch off: nothing of it.
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
import { renderSchedule } from '../ui-schedule.js';
import { renderMyWeek } from '../ui-myweek.js';
import { updateTimeChangesBadge } from '../ui-beheer.js';
import { syncWeekRequests } from '../weekrooster-data.js';
import { weekroosterActionCount, weekroosterDayDot, scheduleDayExtrasHtml, myWeekActionCardsHtml, actionCardHtml, wireMyWeekActions } from '../ui-weekrooster-rooster.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const noStyle = h => h.replace(/<svg[\s\S]*?<\/svg>/g, '');
const WK = '2026-W40';
const doc = (day, fam, extra = {}) => ({ weekKey: WK, day, familyId: fam, rides: true, heen: '11:00', terug: '18:00', status: 'pending', createdAt: 1, updatedAt: new Date('2026-09-30T07:12:00+02:00').getTime(), ...extra });
const seed = () => ({
  ...sampleDbSeed(),
  'weekRequests/2026-W40_Do_f3': doc('Do', 'f3'),
  'weekRequests/2026-W40_Do_f4': doc('Do', 'f4', { status: 'direct', rides: false, heen: '', terug: '', updatedAt: new Date('2026-09-30T08:30:00+02:00').getTime() }),
});
const tick = () => new Promise(r => setImmediate(r));
const asDecider = async (patch = {}) => { useFakeDb(seed()); sampleParentState({ weekrooster: { mode: 'aan' }, dayCoordinators: { Do: 'f2' }, scheduleDay: 'Do', roosterMode: 'week', ...patch }); syncWeekRequests(); await tick(); };
const rooster = () => { withFakeNow(NOW, () => renderSchedule()); return dom.html('tab-schedule'); };
const mijnWeek = () => { withFakeNow(NOW, () => renderMyWeek()); return dom.html('tab-myweek'); };

console.log('=== the card, also without buttons ===');
await testAsync('actionCardHtml: the same card with or without its buttons and its advice line; nothing when nothing waits', async () => {
  await asDecider();
  withFakeNow(NOW, () => {
    const full = actionCardHtml('Do', { buttons: true }), plain = actionCardHtml('Do');
    assert.match(full, /data-wraction="Do"/); assert.match(full, /data-wrtake="Do"/); assert.match(full, /data-wrlook="Do"/);
    assert.doesNotMatch(plain, /data-wraction|data-wrtake|data-wrlook|<button/); assert.match(text(plain), /Actie nodig voor donderdag.*Advies: /);
    assert.doesNotMatch(actionCardHtml('Do', { advice: false }), /Advies: /);
    assert.equal(actionCardHtml('Vr', { buttons: true }), '');
    assert.equal(myWeekActionCardsHtml(), full);
  });
});

console.log('=== the day coordinator ===');
await testAsync('Rooster on his day: "Actie nodig", the day coordinator line, the log (newest first) with tags and times', async () => {
  await asDecider(); const html = rooster(), s = text(html);
  assert.match(s, /Actie nodig: 1 wijziging voor donderdag/); assert.match(s, /Het vaste rooster geldt tot jij akkoord geeft/);
  assert.match(s, /Dagcoördinator donderdag:/); assert.match(s, /Recente wijzigingen/);
  assert.ok(s.indexOf('Evi: Rijdt niet mee') < s.indexOf('Anouk: Heen 11:00 · Terug 18:00'), 'newest first');
  assert.match(s, /Direct wo 08:30/); assert.match(s, /Aanvraag wo 07:12/);
  assert.doesNotMatch(noStyle(html), /style="/);
});
await testAsync('a day he does not decide has no action block and no log; the dot sits on his day only', async () => {
  await asDecider({ scheduleDay: 'Wo' }); const html = rooster();
  assert.doesNotMatch(html, /id="wrAlert"|id="wrLog"/);
  assert.equal(weekroosterDayDot('Do'), true); assert.equal(weekroosterDayDot('Wo'), false);
  const pills = [...html.matchAll(/data-schedday="(\w\w)"[\s\S]*?<\/button>/g)].filter(m => m[0].includes('dayPill__dot')).map(m => m[1]);
  assert.ok(pills.includes('Do'));
});
await testAsync('two requests are counted together; with none waiting there is no block (only the log)', async () => {
  useFakeDb({ ...seed(), 'weekRequests/2026-W40_Do_f5': doc('Do', 'f5') });
  sampleParentState({ weekrooster: { mode: 'aan' }, dayCoordinators: { Do: 'f2' }, scheduleDay: 'Do', roosterMode: 'week' }); syncWeekRequests(); await tick();
  assert.match(text(rooster()), /Actie nodig: 2 wijzigingen voor donderdag/); assert.equal(weekroosterActionCount(), 2);
  await asDecider(); S.dayRequests = { '2026-W40_Do_f4': S.dayRequests['2026-W40_Do_f4'] };
  const html = rooster(); assert.doesNotMatch(html, /id="wrAlert"/); assert.match(html, /id="wrLog"/); assert.equal(weekroosterActionCount(), 0);
});
await testAsync('Mijn week: the card "Actie nodig voor donderdag" with the request (Aanvraag), the direct one (Direct) and "Bekijk"', async () => {
  await asDecider(); const html = mijnWeek(), s = text(html);
  assert.match(html, /alertCard alertCard--stack" data-wraction="Do"/); assert.match(s, /Actie nodig voor donderdag/);
  assert.match(s, /Anouk: Heen 11:00 · Terug 18:00 Aanvraag/); assert.match(s, /Evi: Rijdt niet mee Direct/);
  assert.match(html, /data-wrlook="Do"/); assert.doesNotMatch(noStyle(html), /style="/);
  assert.match(s, /Advies: (scheelt \d+ auto|zelfde aantal auto|\d+ auto.{0,3} erbij)/, 'one line of advice'); assert.match(html, /data-wrtake="Do"/); assert.match(s, /Overnemen/);
});
await testAsync('"Overnemen" on the card accepts the request and shows the toast; Bekijk and Overnemen sit side by side', async () => {
  await asDecider(); const btn = { dataset: { wrtake: 'Do' }, onclick: null, disabled: false };
  wireMyWeekActions({ querySelectorAll: sel => (sel === '[data-wrtake]' ? [btn] : []) });
  await withFakeNowAsync(NOW, () => btn.onclick());
  assert.equal(S.dayRequests['2026-W40_Do_f3'].status, 'accepted'); assert.doesNotMatch(text(mijnWeek()), /Actie nodig voor donderdag/);
});
await testAsync('"Bekijk" opens Rooster on that day, in "Deze week"', async () => {
  await asDecider({ scheduleDay: 'Ma', roosterMode: 'standard' });
  const btn = { dataset: { wrlook: 'Do' }, onclick: null };
  wireMyWeekActions({ querySelectorAll: sel => (sel === '[data-wrlook]' ? [btn] : []) });
  withFakeNow(NOW, () => btn.onclick()); assert.equal(S.scheduleDay, 'Do'); assert.equal(S.roosterMode, 'week');
  const html = dom.html('tab-schedule');
  assert.match(html, /id="wrAlert"/, 'Rooster was drawn again for the day of the request, not left on Monday'); assert.match(text(html), /Actie nodig: 1 wijziging voor donderdag/);
});
await testAsync('the number on the Rooster tab adds the waiting requests to the existing count', async () => {
  await asDecider(); S.canEdit = false; updateTimeChangesBadge();
  assert.equal(dom.el('navRoosterBadge').textContent, '1'); assert.notEqual(dom.el('navRoosterBadge').style.display, 'none');
  useFakeDb(sampleDbSeed()); sampleParentState({ weekrooster: { mode: 'uit' }, dayCoordinators: { Do: 'f2' } }); syncWeekRequests(); updateTimeChangesBadge();
  assert.equal(dom.el('navRoosterBadge').style.display, 'none');
});

await testAsync('on his own day, children who do not ride along are struck-through chips; on another day the plain line stays', async () => {
  await asDecider(); S.deviations = { ...S.deviations, Do_terug: { day: 'Do', direction: 'terug', weekKey: S.currentWeekKey, cars: [], ovGirlIds: ['f4'] }, Wo_terug: { day: 'Wo', direction: 'terug', weekKey: S.currentWeekKey, cars: [], ovGirlIds: ['f4'] } };
  const html = rooster(); assert.match(html, /chip chip--gone/); assert.match(text(html), /Rijdt niet mee:/);
  S.scheduleDay = 'Wo'; const other = rooster(); assert.doesNotMatch(other, /chip chip--gone/);
});

console.log('=== a parent ===');
await testAsync('read only: the own request is a note on that day, other families\' requests are not shown, no action block', async () => {
  useFakeDb({ ...seed(), 'weekRequests/2026-W40_Do_f2': doc('Do', 'f2', { heen: '12:15', terug: '17:00' }) });
  sampleParentState({ weekrooster: { mode: 'aan' }, dayCoordinators: { Do: 'f3' }, scheduleDay: 'Do', roosterMode: 'week' }); syncWeekRequests(); await tick();
  const s = text(rooster());
  assert.match(s, /Jouw aanvraag: heen 12:15 · terug 17:00\. Kees de Vries beslist\./); assert.match(s, /Dagcoördinator donderdag: Kees de Vries/);
  assert.doesNotMatch(s, /Actie nodig|Recente wijzigingen|Anouk: Heen|Evi: Rijdt/);
  assert.doesNotMatch(text(mijnWeek()), /Actie nodig voor/);
});

await testAsync('a parent sees the open request of another family on that day as a note; an accepted or direct one is not shown', async () => {
  useFakeDb({ ...seed(), 'weekRequests/2026-W40_Do_f5': doc('Do', 'f5', { heen: '12:15', terug: '17:00' }) });
  sampleParentState({ weekrooster: { mode: 'aan' }, dayCoordinators: { Do: 'f3' }, scheduleDay: 'Do', roosterMode: 'week' }); syncWeekRequests(); await tick();
  const s = text(rooster());
  assert.match(s, /: aanvraag heen 12:15 · terug 17:00\. Kees de Vries beslist\./);
  assert.doesNotMatch(s, /Evi: Rijdt/, 'a direct request is not a note'); assert.doesNotMatch(s, /Actie nodig|Recente wijzigingen/);
});

console.log('=== switch off ===');
await testAsync('uit (or test for a parent): none of it exists', async () => {
  for (const mode of ['uit', 'test']) {
    useFakeDb(seed()); sampleParentState({ weekrooster: { mode }, dayCoordinators: { Do: 'f2' }, scheduleDay: 'Do', roosterMode: 'week' }); syncWeekRequests(); await tick();
    assert.equal(scheduleDayExtrasHtml('Do'), ''); assert.equal(myWeekActionCardsHtml(), ''); assert.equal(weekroosterActionCount(), 0);
    assert.doesNotMatch(rooster() + mijnWeek(), /Actie nodig|Recente wijzigingen|Jouw aanvraag|wrAlert|wrLog|data-wraction/);
  }
});

await testAsync('the "Actie nodig" block has the button "Advies bekijken" for the day coordinator', async () => {
  await asDecider(); const html = rooster();
  assert.match(html, /data-wradvice="Do"/); assert.match(text(html), /Advies bekijken/);
});
await testAsync('a hand change by a parent ("Toch zelf wijzigen") shows in the log of the day coordinator with the neutral tag Zelf gewijzigd', async () => {
  await asDecider(); S.deviations = { ...S.deviations, Do_heen: { day: 'Do', direction: 'heen', weekKey: WK, expiresAt: 9e15, cars: [], selfBy: 'f4', selfAt: new Date('2026-09-30T09:00:00+02:00').getTime() } };
  const s = text(rooster()); assert.match(s, /Zelf gewijzigd/); assert.match(s, /heen zelf aangepast/);
});
test('ui-weekrooster-rooster.js imports nothing it does not use', () => assertNoUnusedImports('ui-weekrooster-rooster.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
