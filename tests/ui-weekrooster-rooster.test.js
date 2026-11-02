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
import { installFakeDom, useFakeDb, withFakeNow, withFakeNowAsync, NOW, sampleDbSeed, sampleParentState, sampleGroups, sampleFlexParentState, assertNoUnusedImports } from './test-support.js';
import { S } from '../state.js';
import { renderSchedule } from '../ui-schedule.js';
import { renderMyWeek } from '../ui-myweek.js';
import { updateTimeChangesBadge } from '../ui-beheer.js';
import { syncWeekRequests } from '../weekrooster-data.js';
import { weekroosterActionCount, weekroosterDayDot, scheduleDayExtrasHtml, isWithin24h, myWeekActionCardsHtml, actionCardHtml, adviceLineOf, wireMyWeekActions } from '../ui-weekrooster-rooster.js';
import { dateForWeekday } from '../dates.js';

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
const car = (dir, n, driver, girls, dep) => ({ ['Do_' + dir + '_' + n]: { day: 'Do', direction: dir, girlIds: girls, driverFamilyId: driver, reserveFamilyIds: [], departureTime: dep } });
const CARS = { ...sampleGroups(), ...car('heen', 1, 'f1', ['f1', 'f3'], '07:30'), ...car('heen', 2, 'f2', ['f2', 'f4'], '09:15'), ...car('terug', 1, 'f1', ['f1', 'f3'], '17:00'), ...car('terug', 2, 'f2', ['f2', 'f4'], '18:00') };
const asDecider = async (patch = {}) => { useFakeDb(seed()); sampleParentState({ dayCoordinators: { Do: 'f2' }, scheduleDay: 'Do', roosterMode: 'week', ...patch }); syncWeekRequests(); await tick(); };
const rooster = () => { withFakeNow(NOW, () => renderSchedule()); return dom.html('tab-schedule'); };
const mijnWeek = () => { withFakeNow(NOW, () => renderMyWeek()); return dom.html('tab-myweek'); };

console.log('=== the card, also without buttons ===');
await testAsync('actionCardHtml: the same card with or without its buttons and its advice line; nothing when nothing waits', async () => {
  await asDecider({ groups: CARS });
  withFakeNow(NOW, () => {
    const plain = actionCardHtml('Do');
    assert.doesNotMatch(plain, /data-wraction|data-wrtake|data-wrlook|<button/); assert.match(text(plain), /1 aanvraag voor donderdag Heen Anouk aanwezig om 11:00 .* Terug Anouk klaar om 18:00/);
    assert.doesNotMatch(plain, /Advies|Actie nodig|alertCard|entryCard__icon|style=/);
    assert.equal(actionCardHtml('Vr'), '');
    assert.match(myWeekActionCardsHtml(), /class="entryCard( entryCard--stack)?" data-wraction="Do"/);   // Mijn week has the entry card of Rooster, not this list
  });
});
await testAsync('the advice line: the cars as they are; when it does not fit there is no line and nothing to take over in one tap', async () => {
  await asDecider({ groups: CARS });
  withFakeNow(NOW, () => { assert.match(adviceLineOf('Do'), /^Advies: 2 speelsters in een andere auto, 420 min extra wachten\.$/); assert.equal(adviceLineOf('Vr'), null); });
  await asDecider();   // no cars on Thursday
  withFakeNow(NOW, () => {
    assert.equal(adviceLineOf('Do'), null);
    const full = myWeekActionCardsHtml(); assert.match(full, /data-wrlook="Do"/); assert.doesNotMatch(full, /data-wrtake/); assert.doesNotMatch(text(full), /Advies: /);
  });
});

console.log('=== the day coordinator ===');
await testAsync('Rooster on his day: the entry card, the day coordinator line, the log (newest first) with tags and times', async () => {
  await asDecider(); const html = rooster(), s = text(html);
  assert.match(s, /1 aanvraag voor donderdag/); assert.match(s, /Verzoeken verwerken/); assert.doesNotMatch(s, /Advies|Het vaste rooster geldt/);   // Rooster only lists the requests
  assert.doesNotMatch(s, /Dagcoördinator donderdag:|Jij bent dagcoördinator/);   // no line about the day coordinator above the day any more
  assert.match(html, /<details class="fold fold--quiet"[^>]*id="wrLog"/); assert.ok(html.indexOf('id="wrLog"') > html.lastIndexOf('rideRow scene--terug'), '"Recente wijzigingen" sits at the bottom, under the cars of terug'); assert.ok(html.indexOf('id="wrLog"') > html.indexOf('rideRow scene--heen')); assert.match(s, /Recente wijzigingen 1/);   // folded history: only what is settled
  assert.match(s, /Evi: Rijdt niet mee Direct wo 08:30/);
  assert.match(html, /class="entryCard entryCard--stack entryCard--plain" id="wrAlert"/); assert.doesNotMatch(html.slice(html.indexOf('id="wrAlert"')).split('data-wradvice')[0], /entryCard__icon/);   // the normal white card, no warning icon assert.doesNotMatch(html, /alertCard__row|devAlert/);   // the requests themselves are listed in step 1 of the flow, not in the Rooster
  assert.doesNotMatch(html, /logItem__dot"[^>]*><\/span>\s*<span class="logItem__main">Anouk/, 'and is not listed a second time below');
  assert.match(html, /essRows essRows--req/); assert.match(s, /Heen Anouk aanwezig om 11:00/); assert.doesNotMatch(s, /al verwerkt/);
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
  sampleParentState({ dayCoordinators: { Do: 'f2' }, scheduleDay: 'Do', roosterMode: 'week' }); syncWeekRequests(); await tick();
  assert.match(text(rooster()), /2 aanvragen voor donderdag/); assert.equal(weekroosterActionCount(), 2);
  await asDecider(); S.dayRequests = { '2026-W40_Do_f4': S.dayRequests['2026-W40_Do_f4'] };
  const html = rooster(); assert.doesNotMatch(html, /id="wrAlert"/); assert.match(html, /id="wrLog"/); assert.equal(weekroosterActionCount(), 0);
  assert.doesNotMatch(html, /coordLine/); assert.match(html, /data-wroverride="Do"/, 'the link Carpooldag aanpassen is at the bottom of the day for every role');
});
await testAsync('there is no line about the day coordinator above the day, and the cars show the direction as a mark (no Heen/Terug titles)', async () => {
  useFakeDb({ ...seed(), 'weekRequests/2026-W40_Do_f2': doc('Do', 'f2', { heen: '07:30', terug: '16:00' }) });
  sampleParentState({ dayCoordinators: { Do: 'f2' }, scheduleDay: 'Do', roosterMode: 'week' }); syncWeekRequests(); await tick();
  const html = rooster(), s = text(html);
  assert.doesNotMatch(s, /Jij bent dagcoördinator|Dagcoördinator donderdag:/);
  assert.doesNotMatch(html, /sectionHead__note/); assert.doesNotMatch(html, /dirMark/);   // the direction is the tint only; her own time sits on her chip
});
await testAsync('Mijn week: the same entry card as Rooster (icon, "2 aanvragen voor donderdag", the advice line, "Verzoeken verwerken")', async () => {
  await asDecider({ groups: CARS }); const html = mijnWeek(), s = text(html), room = rooster();
  assert.match(html, /<div class="entryCard( entryCard--stack)?" data-wraction="Do">/); assert.match(s, /1 aanvraag voor donderdag/); assert.match(s, /Verzoeken verwerken/); assert.match(html, /data-wrlook="Do"/);
  assert.doesNotMatch(s, /Advies/, 'the requests as they are asked, no advice'); assert.match(html, /entryCard__icon/, 'Mijn week keeps the amber card with its icon');
  assert.doesNotMatch(html, /alertCard|fold--alert|data-wrtake/); assert.doesNotMatch(s, /Actie nodig|Overnemen/); assert.doesNotMatch(noStyle(html), /style="/);
  const inner = h => text(h.slice(h.indexOf('essRows essRows--req'))).split('Verzoeken verwerken')[0];
  assert.equal(inner(html).replace(/\s+/g, ' '), inner(room).replace(/\s+/g, ' '));   // the same words as in Rooster
});
await testAsync('"Advies bekijken en aanpassen" on Mijn week opens the same flow as "Verzoeken verwerken": step 1, on that day, over the tab you are on', async () => {
  await asDecider({ scheduleDay: 'Ma', roosterMode: 'standard' });
  const btn = { dataset: { wrlook: 'Do' }, onclick: null };
  wireMyWeekActions({ querySelectorAll: sel => (sel === '[data-wrlook]' ? [btn] : []) });
  withFakeNow(NOW, () => btn.onclick()); assert.equal(S.scheduleDay, 'Do'); assert.equal(S.roosterMode, 'week');
  assert.deepEqual(S.wrAdvice, { day: 'Do', step: 'requests', variant: 'best', edits: {}, editDir: null }); assert.equal(S.wrDone, null);
  const html = dom.html('tab-schedule');
  assert.match(html, /id="wrAlert"/, 'Rooster was drawn again for the day of the request, not left on Monday'); assert.match(text(html), /1 aanvraag voor donderdag/);
});
await testAsync('the number on the Rooster tab adds the waiting requests to the existing count', async () => {
  await asDecider(); S.canEdit = false; updateTimeChangesBadge();
  assert.equal(dom.el('navRoosterBadge').textContent, '1'); assert.notEqual(dom.el('navRoosterBadge').style.display, 'none');
  useFakeDb(sampleDbSeed()); sampleParentState({ links: {}, dayCoordinators: { Do: 'f2' } }); syncWeekRequests(); updateTimeChangesBadge();
  assert.equal(dom.el('navRoosterBadge').style.display, 'none');
});

await testAsync('children who do not ride along sit in the quiet fold (muted names, no strike-through), on his own day and on another day', async () => {
  await asDecider(); S.deviations = { ...S.deviations, Do_terug: { day: 'Do', direction: 'terug', weekKey: S.currentWeekKey, cars: [], ovGirlIds: ['f4'] }, Wo_terug: { day: 'Wo', direction: 'terug', weekKey: S.currentWeekKey, cars: [], ovGirlIds: ['f4'] } };
  const html = rooster(); assert.match(html, /chip chip--muted/); assert.doesNotMatch(html, /chip--gone/); assert.match(text(html), /Rijdt niet mee 1/);
  S.scheduleDay = 'Wo'; const other = rooster(); assert.match(other, /chip chip--muted/); assert.doesNotMatch(other, /chip--gone/);
});

console.log('=== a parent ===');
await testAsync('a parent: the own request is in the card of that day, with the name of the day coordinator, Bel and Verwerken; no action block', async () => {
  useFakeDb({ ...seed(), 'weekRequests/2026-W40_Do_f2': doc('Do', 'f2', { heen: '12:15', terug: '17:00' }) });
  sampleParentState({ dayCoordinators: { Do: 'f3' }, scheduleDay: 'Do', roosterMode: 'week' }); syncWeekRequests(); await tick();
  const s = text(rooster());
  assert.match(s, /2 aanvragen voor donderdag Dagcoördinator: Kees de Vries Heen .*Jahaimy aanwezig om 12:15 .*Terug .*Jahaimy klaar om 17:00 .*Contact met Kees de Vries Verwerken/);
  assert.doesNotMatch(s, /Actie nodig|Recente wijzigingen \d|Jouw aanvraag|Verzoeken verwerken/);
});

await testAsync('a parent sees the open request of another family in the card (Rooster) and in a folded line in Mijn week; a direct one is not shown', async () => {
  useFakeDb({ ...seed(), 'weekRequests/2026-W40_Do_f5': doc('Do', 'f5', { heen: '12:15', terug: '17:00' }) });
  sampleParentState({ dayCoordinators: { Do: 'f3' }, scheduleDay: 'Do', roosterMode: 'week' }); syncWeekRequests(); await tick();
  const s = text(rooster());
  assert.match(s, /2 aanvragen voor donderdag Dagcoördinator: Kees de Vries Heen .*Lois aanwezig om 12:15/);
  assert.doesNotMatch(s, /Evi rijdt niet mee/, 'a direct request is not listed'); assert.doesNotMatch(s, /Actie nodig|Recente wijzigingen \d/);
  const mw = mijnWeek();   // Mijn week = parent + daughter: the days of other day coordinators are not shown there
  assert.doesNotMatch(mw, /data-wrtake|wrroost|Dagcoördinator: Kees/); assert.doesNotMatch(noStyle(mw), /style="/);
  const room = rooster(); assert.match(room, /<details class="fold fold--alert"[^>]*data-fold="wrroost\|Do"/); assert.doesNotMatch(room, /data-fold="wrroost\|Do"[^>]* open/, 'a day of somebody else is always folded');
});

await testAsync('Rooster: the requests of the day coordinator are folded, and open when the day is less than 24 hours away', async () => {
  await asDecider(); const room = rooster();
  assert.match(room, /<details class="fold fold--alert"[^>]*data-fold="wrroost\|Do"/);
  assert.equal(isWithin24h('Do', new Date(NOW)), true, 'Wednesday morning, the day starts in 14 hours: open'); assert.match(room, /data-fold="wrroost\|Do"[^>]* open/);
  assert.equal(isWithin24h('Vr', new Date(NOW)), false, 'two days ahead: folded');
  const eve = new Date(dateForWeekday('Do')); eve.setDate(eve.getDate() - 1); eve.setHours(20, 0, 0, 0);
  assert.equal(isWithin24h('Do', eve), true, 'the evening before: open');
  assert.equal(isWithin24h('Do', new Date(eve.getTime() - 21 * 3600 * 1000)), false, 'more than 24 hours before the start of the day: folded');
  S.folds = { 'wrroost|Do': false }; withFakeNow(NOW, () => assert.doesNotMatch(scheduleDayExtrasHtml('Do'), /data-fold="wrroost\|Do"[^>]* open/, 'closed by the person: stays closed'));
  S.folds = {};
});

console.log('=== not applicable ===');
await testAsync('nobody linked, or a Flex family: none of it exists', async () => {
  for (const make of [p => sampleParentState({ links: {}, ...p }), sampleFlexParentState]) {
    useFakeDb(seed()); make({ dayCoordinators: { Do: 'f2' }, scheduleDay: 'Do', roosterMode: 'week' }); syncWeekRequests(); await tick();
    assert.equal(scheduleDayExtrasHtml('Do'), ''); assert.equal(myWeekActionCardsHtml(), ''); assert.equal(weekroosterActionCount(), 0);
    assert.doesNotMatch(rooster() + mijnWeek(), /Actie nodig|Recente wijzigingen|Jouw aanvraag|wrAlert|wrLog|data-wraction/);
  }
});

await testAsync('the entry card has the button "Verzoeken verwerken" for the day coordinator', async () => {
  await asDecider(); const html = rooster();
  assert.match(html, /class="entryCard [^"]*"[^>]*id="wrAlert"/); assert.match(html, /data-wradvice="Do"/); assert.match(text(html), /Verzoeken verwerken/);
  assert.doesNotMatch(html, /devAlert/);
  assert.doesNotMatch(html, /coordLine/); assert.match(html, /data-wroverride="Do"/);   // the day can always be arranged by hand: the link at the bottom stays next to the flow
});
await testAsync('a hand change by a parent ("Toch zelf wijzigen") shows in the log of the day coordinator with the neutral tag Zelf gewijzigd', async () => {
  await asDecider(); S.deviations = { ...S.deviations, Do_heen: { day: 'Do', direction: 'heen', weekKey: WK, expiresAt: 9e15, cars: [], selfBy: 'f4', selfAt: new Date('2026-09-30T09:00:00+02:00').getTime() } };
  const s = text(rooster()); assert.match(s, /Zelf gewijzigd/); assert.match(s, /heen zelf aangepast/);
});
await testAsync('the requests are listed per direction, per girl in alphabetical order, with the asked time and the time it was', async () => {
  useFakeDb({ ...seed(), 'weekRequests/2026-W40_Do_f5': doc('Do', 'f5', { heen: '10:00', terug: '16:00' }) });
  sampleParentState({ dayCoordinators: { Do: 'f2' }, scheduleDay: 'Do', roosterMode: 'week', groups: CARS }); syncWeekRequests(); await tick();
  withFakeNow(NOW, () => {
    const s = text(actionCardHtml('Do'));
    assert.match(s, /2 aanvragen voor donderdag Heen Anouk aanwezig om 11:00 .*Lois aanwezig om 10:00 .* Terug Anouk klaar om 18:00 .*Lois klaar om 16:00/);
    assert.ok(s.indexOf('Anouk') < s.indexOf('Lois'), 'alphabetical');
  });
});
await testAsync('Mijn week: the entry card is open only on the day before the carpool day, otherwise one folded line with the number', async () => {
  await asDecider({ groups: CARS });
  const at = iso => { let h; withFakeNow(iso, () => { renderMyWeek(); h = dom.html('tab-myweek'); }); return h; };
  const open = at('2026-09-30T10:00:00+02:00');   // Wednesday: Thursday is tomorrow
  assert.match(open, /<div class="entryCard( entryCard--stack)?" data-wraction="Do">/); assert.doesNotMatch(open, /fold--alert/); assert.match(text(open), /1 aanvraag voor donderdag/);
  for (const iso of ['2026-09-28T10:00:00+02:00', '2026-09-29T10:00:00+02:00', '2026-10-01T10:00:00+02:00']) {   // Mon, Tue, and the carpool day itself
    const h = at(iso);
    assert.match(h, /<details class="fold fold--alert"[^>]*data-fold="wraction\|Do"/, iso); assert.doesNotMatch(h, /<details[^>]*data-fold="wraction\|Do"[^>]* open/, iso);
    assert.match(text(h), /1 aanvraag voor donderdag/, iso); assert.match(h, /data-wrlook="Do"/, 'the button stays inside the fold');
    assert.equal((text(h).match(/1 aanvraag voor donderdag/g) || []).length, 1, 'the fold has the title, the card inside does not repeat it');
  }
  S.folds = { 'wraction|Do': true }; assert.match(at('2026-09-28T10:00:00+02:00'), /data-fold="wraction\|Do" open/); S.folds = {};
});
test('ui-weekrooster-rooster.js imports nothing it does not use', () => assertNoUnusedImports('ui-weekrooster-rooster.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
