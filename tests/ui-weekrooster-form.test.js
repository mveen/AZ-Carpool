// Run with: node ui-weekrooster-form.test.js
// Afwijkend weekrooster, phase 2: what a parent sees. Tijden wijzigen (its own screen over Mijn week: the week form, Doorgeven with a toast,
// closing with unsaved changes) and Mijn week (button, request block, next week). For a Flex family, or somebody without a family of their own, none of it exists.
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
import { installFakeDom, useFakeDb, withFakeNow, withFakeNowAsync, NOW, sampleDbSeed, sampleParentState, sampleFlexParentState, sampleCoordinatorState, sampleFamilies, assertNoUnusedImports } from './test-support.js';
import { S } from '../state.js';
import { renderMyWeek } from '../ui-myweek.js';
import { renderDeviationTab } from '../ui-deviation.js';
import { dateForWeekday } from '../dates.js';
import { redrawAfterTyping, holdFormRedraw, openWrFlow, closeWrFlow, requestCloseWrFlow, wrFlowHtml, weekroosterActive, submitWeekForm, toggleRide, myWeekWeekroosterHtml, requestBlockHtml, openAskedTime, openAskedTimeOf, myWeekNextWeekHtml, wireMyWeekWeekrooster, summaryOf, deciderLabel, upperFirst, lower, dayName } from '../ui-weekrooster-form.js';
import { myFamilyId } from '../coordinator.js';
import { shownTime } from '../rides.js';
import { syncWeekRequests, withdrawWeekRequests } from '../weekrooster-data.js';
import { setReturnByPublicTransport } from '../data.js';

const dom = installFakeDom();
const noStyle = h => h.replace(/<svg[\s\S]*?<\/svg>/g, '');   // the Phosphor icons carry their own sizing
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const toast = () => text(dom.html('toast'));
// The flow is a layer of its own; the fake page cannot hand it back, so its html is read from wrFlowHtml() (what the layer is filled with).
const flowHtml = () => { let h = ''; withFakeNow(NOW, () => { h = wrFlowHtml(); }); return h; };
const wijzigen = () => { withFakeNow(NOW, () => { if (!S.wrFlow) openWrFlow(S.wrWeek); }); return flowHtml(); };
// Mijn week shows one day at a time (the day pills): `day` picks it, none = the default (today).
const mijnWeek = day => { withFakeNow(NOW, () => { S.myWeekDay = day ? dateForWeekday(day).toDateString() : ''; renderMyWeek(); }); return dom.html('tab-myweek'); };
const mijnWeekDays = (...days) => days.map(d => mijnWeek(d)).join('');
const setField = (id, v) => { dom.el(id).value = v; };
// The fake page has no real inputs: put the form's own values in them (as a browser would show them), the way a person sees them.
const fillInputs = (pastDays = ['Ma', 'Di']) => {
  ['Ma', 'Di', 'Wo', 'Do', 'Vr'].forEach(day => {
    const d = S.wrForm.days[day], past = pastDays.includes(day);
    Object.assign(dom.el('wrHeen_' + day), { value: d.heen || '', disabled: past });
    Object.assign(dom.el('wrTerug_' + day), { value: d.terug || '', disabled: past });
  });
};
const switchOn = (html, day, dir) => new RegExp('class="switch switch--sm on" role="switch" aria-checked="true" aria-label="[^"]*" data-wrtoggle="' + day + '" data-wrdir="' + dir + '"').test(html);
const blocksOf = html => html.split('class="reqBlock"').slice(1).map(b => b.slice(0, b.indexOf('</button>')));   // the request blocks of the days, in order
const tick = () => new Promise(r => setImmediate(r));
const parentOn = async () => { const fake = useFakeDb(sampleDbSeed()); sampleParentState({}); syncWeekRequests(); await tick(); return fake; };

console.log('=== who sees it ===');
test('only with a daughter of their own (also when looking as a family), and not Flex', () => {
  sampleParentState({}); assert.equal(weekroosterActive(), true);
  sampleCoordinatorState({ impersonateFamilyId: 'f2' }); assert.equal(weekroosterActive(), true);
  const fams = sampleFamilies(); fams.f2.familyType = 'flex';
  sampleParentState({ families: fams });
  assert.equal(weekroosterActive(), false);
  sampleParentState({ links: {} }); assert.equal(weekroosterActive(), false);
});
test('a Flex family: Tijden wijzigen and Mijn week show nothing of the week form and no pill', async () => {
  useFakeDb(sampleDbSeed()); sampleFlexParentState({});
  S.wrFlow = true; withFakeNow(NOW, () => renderDeviationTab()); assert.equal(dom.html('wrFlowScreen'), '', 'no screen for a Flex family'); S.wrFlow = false; assert.doesNotMatch(mijnWeek(), /wrChange|Tijden wijzigen|Aanvraag/);
  assert.equal(myWeekWeekroosterHtml(), ''); assert.equal(requestBlockHtml('Do'), ''); assert.equal(myWeekNextWeekHtml(), '');
});

console.log('=== the week form ===');
await testAsync('Deze week: five days, past days locked, a switch per ride and the two time columns, tokens only (no inline style)', async () => {
  await parentOn(); const html = wijzigen(), s = text(html);
  assert.match(s, /Week 40 · mijn gezin Tijden wijzigen/); assert.match(s, /Heen · aankomst/); assert.match(s, /Terug · klaar om/); assert.match(s, /Zet een rit uit als Jahaimy niet meerijdt/);
  assert.equal([...html.matchAll(/data-wrday="(\w\w)"/g)].map(m => m[1]).join(','), 'Ma,Di,Wo,Do,Vr');
  assert.equal((html.match(/wrDay--past/g) || []).length, 2, 'Monday and Tuesday are over');
  assert.match(html, /class="switch switch--sm on" role="switch" aria-checked="true" aria-label="Rijdt mee Heen Donderdag" data-wrtoggle="Do" data-wrdir="heen"/);
  assert.match(html, /aria-label="Rijdt mee Terug Donderdag" data-wrtoggle="Do" data-wrdir="terug"/); assert.doesNotMatch(html, /wrRide_/);
  assert.doesNotMatch(noStyle(html), /style="/);
  assert.match(html, /id="wrHeen_Do"[^>]*value="10:15"/); assert.match(html, /id="wrTerug_Do"[^>]*value="18:00"/);
  assert.match(html, /id="wrSubmit"/); assert.match(html, /id="wrFlowClose"/); assert.doesNotMatch(html, /wrCancel/);
});
await testAsync('Volgende week: nothing is over, the context line says week 41', async () => {
  await parentOn(); S.wrWeek = 'next'; const html = wijzigen();
  assert.match(text(html), /Week 41 · mijn gezin/); assert.doesNotMatch(html, /wrDay--past/);
  assert.match(html, /data-wrweek="next" aria-pressed="true"/);
});
await testAsync('a day that does not ride: both switches off, no time fields, "Rijdt niet mee" in both cells', async () => {
  await parentOn(); wijzigen(); S.wrForm.days.Do.rides = false; const html = wijzigen();
  assert.doesNotMatch(html, /id="wrHeen_Do"/); assert.doesNotMatch(html, /id="wrTerug_Do"/);
  assert.match(html, /class="switch switch--sm" role="switch" aria-checked="false" aria-label="Rijdt mee Heen Donderdag"/);
  assert.equal((html.match(/aria-checked="false" aria-label="Rijdt mee (Heen|Terug) Donderdag"/g) || []).length, 2);
});
await testAsync('a switch off turns that ride off and keeps the other; both off = the day off; on again brings the time back', async () => {
  await parentOn(); wijzigen(); fillInputs();
  toggleRide('Do', 'terug'); let d = S.wrForm.days.Do, html = flowHtml();
  assert.deepEqual([d.rides, d.heen, d.terug], [true, '10:15', '']); assert.doesNotMatch(html, /id="wrTerug_Do"/); assert.match(html, /id="wrHeen_Do"/);
  fillInputs(); toggleRide('Do', 'heen'); d = S.wrForm.days.Do;
  assert.deepEqual([d.rides, d.heen, d.terug], [false, '', '']);
  fillInputs(); toggleRide('Do', 'terug'); d = S.wrForm.days.Do;
  assert.deepEqual([d.rides, d.heen, d.terug], [true, '', '18:00'], 'only the ride that was switched on comes back, with its own time');
  fillInputs(); toggleRide('Do', 'heen'); d = S.wrForm.days.Do;
  assert.deepEqual([d.rides, d.heen, d.terug], [true, '10:15', '18:00']); assert.equal(S.wrForm.touched, true);
});
await testAsync('a ride the fixed rooster does not have (Wednesday): the switch opens an empty time to fill in', async () => {
  await parentOn(); wijzigen(); fillInputs();
  assert.equal(switchOn(flowHtml(), 'Wo', 'heen'), false); assert.doesNotMatch(flowHtml(), /id="wrHeen_Wo"/);
  toggleRide('Wo', 'heen'); const html = flowHtml();
  assert.match(html, /id="wrHeen_Wo"[^>]*value=""/); assert.equal(switchOn(html, 'Wo', 'heen'), true); assert.equal(S.wrForm.days.Wo.rides, true);
});
await testAsync('the switches hand in the same thing as an emptied time: Thursday terug off = a mark at once, no request', async () => {
  const fake = await parentOn(); wijzigen(); fillInputs(); toggleRide('Do', 'terug'); fillInputs();
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), true);
  assert.deepEqual(fake.get('deviations/Do_terug').ovGirlIds, ['f2']); assert.ok(!fake.get('weekRequests/2026-W40_Do_f2') || fake.get('weekRequests/2026-W40_Do_f2').status !== 'pending');
});

console.log('=== handing in ===');
await testAsync('new times become a request: the screen closes, a toast says "Doorgegeven" with "Ongedaan", Mijn week shows the block; Ongedaan withdraws it', async () => {
  const fake = await parentOn(); wijzigen(); fillInputs();
  setField('wrHeen_Do', '11:00'); setField('wrTerug_Do', '18:00');
  const ok = await withFakeNowAsync(NOW, () => submitWeekForm());
  assert.equal(ok, true); assert.equal(fake.get('weekRequests/2026-W40_Do_f2').status, 'pending'); assert.equal(S.wrForm, null); assert.equal(S.wrFlow, false, 'back on Mijn week');
  assert.match(toast(), /Doorgegeven/); assert.match(toast(), /Ongedaan/); assert.match(dom.html('toast'), /id="toastAction"/);
  await tick(); assert.match(mijnWeek('Do'), /data-wrwithdraw="Do"/, 'the request block is in the card of the day');
  await withFakeNowAsync(NOW, () => dom.el('toast').onclick({ target: { id: 'toastAction' } })); await tick();
  assert.equal(fake.get('weekRequests/2026-W40_Do_f2').status, 'withdrawn'); assert.doesNotMatch(mijnWeek('Do'), /data-wrwithdraw="Do"/); assert.match(toast(), /ingetrokken/i);
});
await testAsync('Tijden wijzigen: a changed day gets a border, the tag Gewijzigd and "was …"; the note under Doorgeven counts the days; nothing typed = no tag', async () => {
  await parentOn(); let html = wijzigen();
  assert.doesNotMatch(html, /wrDay--changed/); assert.match(text(html), /Nog niets anders dan je vaste rooster/); assert.match(html, /data-wrtag="Do" hidden/);
  Object.assign(S.wrForm.days.Do, { heen: '11:00', terug: '18:00' }); S.wrForm.touched = true; html = flowHtml();
  assert.match(html, /wrDay--changed" data-wrday="Do"/); assert.doesNotMatch(html, /data-wrtag="Do" hidden/); assert.match(html, /data-wrwas="Do\|heen">was 10:15</); assert.match(html, /data-wrwas="Do\|terug"><\/div>/);
  assert.match(text(html), /1 dag anders dan je vaste rooster/); assert.match(html, /periodTime wrTime changed" id="wrHeen_Do"/);
  S.wrForm.days.Vr.rides = false; assert.match(text(flowHtml()), /2 dagen anders dan je vaste rooster/);
  assert.match(flowHtml(), /data-wrwas="Vr\|heen">was 10:15|data-wrwas="Vr\|heen">was [0-9:]+</, 'a day that does not ride says what it was');
});
await testAsync('Tijden wijzigen: closing a form nobody typed in closes at once; a typed-in form asks first, "Verder invullen" keeps it, "Weggooien" drops it', async () => {
  await parentOn(); wijzigen(); withFakeNow(NOW, () => requestCloseWrFlow()); assert.equal(S.wrFlow, false); assert.equal(S.wrForm, null);
  wijzigen(); S.wrForm.touched = true; withFakeNow(NOW, () => requestCloseWrFlow()); assert.equal(S.wrFlow, 'confirm'); assert.ok(S.wrForm, 'nothing is thrown away yet');
  const html = flowHtml(); assert.match(html, /id="wrKeep"/); assert.match(html, /id="wrDiscard"/); assert.match(text(html), /Je wijzigingen zijn nog niet doorgegeven/); assert.doesNotMatch(html, /id="wrSubmit"/);
  S.wrFlow = true; assert.match(flowHtml(), /id="wrSubmit"/, 'keep: the form is back as it was');
  withFakeNow(NOW, () => closeWrFlow()); assert.equal(S.wrFlow, false); assert.equal(S.wrForm, null);
});
const submitThis = async days => { wijzigen(); fillInputs(); days.forEach(([d, h, tr]) => { setField('wrHeen_' + d, h); setField('wrTerug_' + d, tr); }); await withFakeNowAsync(NOW, () => submitWeekForm()); await tick(); };
const submitNext = async days => { S.wrFlow = false; S.wrWeek = 'next'; S.wrForm = null; wijzigen(); fillInputs([]); days.forEach(([d, h, tr]) => { setField('wrHeen_' + d, h); setField('wrTerug_' + d, tr); }); await withFakeNowAsync(NOW, () => submitWeekForm()); await tick(); };
await testAsync('design B, Mijn week: the button is secondary and there is no amber card per request; the request sits as a block in the card of its day', async () => {
  await parentOn(); await submitThis([['Do', '11:00', '18:00']]);
  const html = mijnWeek(), s = text(html);
  assert.match(html, /class="btn secondary" id="wrChange"/); assert.match(s, /Tijden wijzigen/);
  assert.doesNotMatch(html, /alertCard alertCard--stack/); assert.doesNotMatch(s, /Aanvraag voor|beslist\./);
  const card = html.slice(html.indexOf('Donderdag'));
  assert.match(card, /class="reqBlock"/); assert.match(card, /data-wrwithdraw="Do"/);
  assert.match(text(card), /Aanvraag in behandeling aanwezig 10:15 11:00 klaar 18:00 Wacht op .+ Intrekken/);
  assert.doesNotMatch(html, /tag tag--warn">Aanvraag</, 'the tag "Aanvraag" is gone from the ride');
  assert.equal((html.match(/class="reqBlock"/g) || []).length, 1, 'only the day with the request');
});
await testAsync('design B, Mijn week: in the request block the time that holds now is struck through, the asked time is normal (no arrow), and "klaar" is always on its own line', async () => {
  await parentOn(); await submitThis([['Do', '11:00', '18:00'], ['Vr', '', '16:00']]);
  const [block, blockVr] = blocksOf(mijnWeekDays('Do', 'Vr'));
  assert.match(block, /aanwezig <s>10:15<\/s> <b>11:00<\/b>/, 'old struck through, new normal');
  assert.doesNotMatch(block, /<s>18:00/, 'an unchanged time is not struck through');
  assert.doesNotMatch(text(block), /→|heen 11:00|terug 18:00/, 'no arrow, and "aanwezig" / "klaar" instead of "heen" / "terug"');
  assert.equal((block.match(/class="reqBlock__line"/g) || []).length, 2, 'aanwezig and klaar are two lines');
  assert.match(block, /class="reqBlock__line">klaar <b>18:00<\/b>/);
  assert.match(text(blockVr), /aanwezig 11:00 Rijdt niet mee klaar 17:00 16:00/, 'an emptied time is "rijdt niet mee" on that ride');
});
await testAsync('design B, Mijn week: Intrekken withdraws that day only', async () => {
  await parentOn(); await submitThis([['Do', '11:00', '18:00'], ['Vr', '10:00', '16:00']]);
  assert.equal((mijnWeekDays('Do', 'Vr').match(/class="reqBlock"/g) || []).length, 2);
  assert.equal(await withFakeNowAsync(NOW, () => withdrawWeekRequests('this', 'Do')), true);
  const html = mijnWeekDays('Do', 'Vr');
  assert.equal((html.match(/class="reqBlock"/g) || []).length, 1); assert.match(html, /data-wrwithdraw="Vr"/); assert.doesNotMatch(html, /data-wrwithdraw="Do"/);
  assert.equal(await withFakeNowAsync(NOW, () => withdrawWeekRequests('this', 'Do')), false, 'nothing left of that day to withdraw');
  assert.equal(await withFakeNowAsync(NOW, () => withdrawWeekRequests('this')), true); assert.doesNotMatch(mijnWeekDays('Do', 'Vr'), /reqBlock/);
});
await testAsync('design B, Mijn week: the requests for next week are ONE compact card under the days (day, times, who decides)', async () => {
  await parentOn(); await submitNext([['Ma', '08:15', '17:00']]); S.myWeekNextOpen = true;
  let html = mijnWeek(), s = text(html);
  assert.match(s, /Volgende week 5 – 9 okt Wijzigen 1 aanvraag wacht op antwoord Aanwezig Klaar Wacht op Ma 08:15 17:00 [^ ]+/); assert.equal((html.match(/class="nwRow"/g) || []).length, 1);
  assert.match(html, /class="reqBlock reqBlock--week"/); assert.match(html, /id="wrChangeNext"/); assert.match(html, /data-wrwithdraw-next="Ma"/); assert.doesNotMatch(html.slice(html.indexOf('reqBlock--week')), /→/, 'no arrows in the next-week block');
  assert.doesNotMatch(html, /alertCard alertCard--stack/);
  await parentOn(); await submitNext([['Ma', '08:15', '17:00'], ['Di', '08:15', '17:30']]); S.myWeekNextOpen = true;
  html = mijnWeek(); s = text(html);
  assert.match(s, /2 aanvragen wachten op antwoord/); assert.equal((html.match(/class="nwRow"/g) || []).length, 2); assert.match(s, /Di 08:15 17:30/);
  assert.equal((html.match(/class="reqBlock reqBlock--week"/g) || []).length, 1, 'one block for all');
});
await testAsync('design B, Mijn week: next week shows "niet mee" where a ride (or the day) is off, and has an Intrekken per day', async () => {
  await parentOn(); await submitNext([['Do', '', '18:00'], ['Vr', '10:00', '16:00']]); S.myWeekNextOpen = true;
  let s = text(mijnWeek());
  assert.match(s, /Do niet mee 18:00/); assert.match(s, /Vr 10:00 16:00/); assert.doesNotMatch(s, /Do – /, 'no dash for "niet mee"');
  assert.equal((mijnWeek().match(/data-wrwithdraw-next="/g) || []).length, 2);
  assert.equal(await withFakeNowAsync(NOW, () => withdrawWeekRequests('next', 'Do')), true);
  const html = mijnWeek();
  assert.doesNotMatch(html, /data-wrwithdraw-next="Do"/); assert.match(html, /data-wrwithdraw-next="Vr"/, 'only that day is withdrawn');
});
await testAsync('design B, Mijn week: Volgende week is closed by default; the line with the number of requests unfolds it, Intrekken keeps it open, and it closes itself when nothing is left', async () => {
  await parentOn(); await submitNext([['Ma', '08:15', '17:00'], ['Di', '08:15', '17:30']]);
  let html = mijnWeek(), s = text(html);
  assert.match(html, /reqBlock--closed/); assert.match(html, /id="wrNextToggle" aria-expanded="false"/); assert.match(s, /2 aanvragen wachten op antwoord/);
  assert.equal((html.match(/class="nwRow"/g) || []).length, 0, 'no rows while closed'); assert.doesNotMatch(html, /data-wrwithdraw-next/);
  assert.match(html, /id="wrChangeNext"/, 'the link Wijzigen is there while closed');
  const tg = {}; let drawn = 0; const box = { querySelector: sel => (sel === '#wrNextToggle' ? tg : null), querySelectorAll: () => [] };
  withFakeNow(NOW, () => wireMyWeekWeekrooster(box, () => { drawn++; }));
  withFakeNow(NOW, () => tg.onclick()); assert.equal(S.myWeekNextOpen, true); assert.equal(drawn, 1);
  html = mijnWeek(); assert.match(html, /aria-expanded="true"/); assert.doesNotMatch(html, /reqBlock--closed/); assert.equal((html.match(/class="nwRow"/g) || []).length, 2);
  assert.equal(await withFakeNowAsync(NOW, () => withdrawWeekRequests('next', 'Ma')), true);
  html = mijnWeek(); assert.equal((html.match(/class="nwRow"/g) || []).length, 1, 'still open after a withdraw');
  assert.equal(await withFakeNowAsync(NOW, () => withdrawWeekRequests('next', 'Di')), true);
  assert.equal(mijnWeek().includes('reqBlock--week'), false); assert.equal(S.myWeekNextOpen, false, 'nothing left: the block is gone and the next one starts closed');
});
await testAsync('design B, Mijn week: the link "Wijzigen" at next week opens Tijden wijzigen on "Volgende week"', async () => {
  await parentOn(); await submitNext([['Ma', '08:15', '17:00']]);
  S.wrWeek = 'this'; const btn = {}; const box = { querySelector: sel => (sel === '#wrChangeNext' ? btn : null), querySelectorAll: () => [] };
  withFakeNow(NOW, () => wireMyWeekWeekrooster(box));
  assert.equal(typeof btn.onclick, 'function'); withFakeNow(NOW, () => btn.onclick());
  assert.equal(S.wrWeek, 'next'); assert.equal(S.wrFlow, true, 'its own screen opens'); assert.match(flowHtml(), /data-wrweek="next" aria-pressed="true"/); assert.match(text(flowHtml()), /Week 41 · mijn gezin/);
});
await testAsync('nothing changed: nothing is written and the parent is told', async () => {
  const fake = await parentOn(); wijzigen(); fillInputs();
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), false);
  assert.match(toast(), /Je hebt niets gewijzigd/); assert.equal([...fake.store.keys()].filter(k => k.startsWith('weekRequests/')).length, 0);
});
await testAsync('a day equal to what is already handed in is not written again and the parent is told', async () => {
  const fake = await parentOn(); wijzigen(); fillInputs(); setField('wrHeen_Do', '11:00'); setField('wrTerug_Do', '18:00');
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), true); await tick();
  const { weekFormFrom } = await import('../weekrooster.js'), { standardTimes } = await import('../weekrooster-data.js');
  S.wrForm = { which: 'this', days: weekFormFrom({ weekKey: '2026-W40', familyId: 'f2', standard: standardTimes('f2', 'this'), requests: S.weekRequests }) }; wijzigen(); fillInputs();
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), false);
  assert.match(toast(), /Je hebt niets gewijzigd/); assert.equal(fake.get('weekRequests/2026-W40_Do_f2').status, 'pending');
});
await testAsync('next week: a changed day with both times empty is not handed in (this week it means "rijdt niet mee")', async () => {
  const fake = await parentOn(); S.wrWeek = 'next'; wijzigen(); fillInputs([]); setField('wrHeen_Do', ''); setField('wrTerug_Do', '');
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), false);
  assert.match(toast(), /minstens één tijd/); assert.equal([...fake.store.keys()].filter(k => k.startsWith('weekRequests/')).length, 0);
});
await testAsync('"Rijdt niet mee" is applied at once: the toast says so and has no "Ongedaan" (nothing waits for a coordinator)', async () => {
  const fake = await parentOn(); wijzigen(); S.wrForm.days.Vr.rides = false; fillInputs();
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), true);
  assert.equal(fake.get('weekRequests/2026-W40_Vr_f2').status, 'direct'); await tick();
  assert.match(toast(), /Doorgegeven en meteen verwerkt/); assert.doesNotMatch(dom.html('toast'), /toastAction/);
});
test('the helpers the day coordinator\'s screens share: one-line summary, day names, the decider (never lower case at the start of a sentence)', () => {
  sampleParentState({ dayCoordinators: { Do: 'f3' } });
  assert.equal(summaryOf({ rides: true, heen: '11:00', terug: '18:00' }), 'Heen 11:00 · Terug 18:00');
  assert.equal(summaryOf({ rides: true, heen: '', terug: '18:00' }), 'Terug 18:00'); assert.equal(summaryOf({ rides: false, heen: '', terug: '' }), 'Rijdt niet mee');
  assert.equal(dayName('Do'), 'Donderdag'); assert.equal(lower('Donderdag'), 'donderdag'); assert.equal(upperFirst('de coördinator'), 'De coördinator');
  assert.equal(deciderLabel('Do'), 'Kees de Vries'); assert.equal(deciderLabel('Ma'), 'de coördinator');
});
await testAsync('a refused save shows the error and NOT "Je hebt niets gewijzigd"; the form stays as typed', async () => {
  const fake = await parentOn(); wijzigen(); fillInputs(); setField('wrTerug_Do', '19:00');
  fake.failWrites('weekRequests/', 'permission-denied');
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), false);
  assert.match(toast(), /permission-denied/); assert.doesNotMatch(toast(), /niets gewijzigd/);
  assert.equal(S.wrForm.days.Do.terug, '19:00', 'what was typed is kept'); assert.equal(S.wrBusy, false);
});
await testAsync('what was just handed in shows at once on Mijn week, even when the live listener is not running', async () => {
  useFakeDb(sampleDbSeed()); sampleParentState({});   // no syncWeekRequests: the listeners are dead
  assert.equal(S.weekRequestsUnsubs.length, 0);
  wijzigen(); fillInputs(); setField('wrTerug_Do', '12:45');
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), true);
  const s = text(mijnWeek('Do')); assert.match(s, /Aanvraag in behandeling/); assert.match(s, /klaar 18:00 12:45/);
  assert.equal(await withFakeNowAsync(NOW, () => withdrawWeekRequests('this')), true);
  assert.doesNotMatch(text(mijnWeek('Do')), /Aanvraag in behandeling/, 'withdrawn: the block is gone');
});

console.log('=== the code ===');
test('ui-weekrooster-form.js imports nothing it does not use', () => assertNoUnusedImports('ui-weekrooster-form.js'));

await testAsync('Mijn week: the button spans the width with an icon, in one stack with the request note (a clock, no bold text)', async () => {
  useFakeDb(sampleDbSeed()); sampleParentState({});
  const html = myWeekWeekroosterHtml();
  assert.match(html, /^<div class="wrStack"><button type="button" class="btn secondary" id="wrChange"><svg/); assert.doesNotMatch(html, /<b>/);
});
console.log('=== this week: the toggles of Mijn week and the form are two views of the same marks ===');
const marksIn = fake => { S.deviations = Object.fromEntries([...fake.store.keys()].filter(k => k.startsWith('deviations/')).map(k => [k.slice(11), fake.get(k)])); };   // what the live listener does
const toggle = async (fake, day, dir, off) => { await withFakeNowAsync(NOW, () => setReturnByPublicTransport(day, 'f2', off, dir)); marksIn(fake); };
const rideTicked = day => { const h = wijzigen(); return switchOn(h, day, 'heen') || switchOn(h, day, 'terug'); };
await testAsync('a toggle of one ride off in Mijn week: the form shows that time empty, the other time and "Rijdt mee" stay', async () => {
  const fake = await parentOn(); await toggle(fake, 'Do', 'heen', true); S.wrForm = null;
  const html = wijzigen();
  assert.doesNotMatch(html, /id="wrHeen_Do"/); assert.equal(switchOn(html, 'Do', 'heen'), false); assert.match(html, /id="wrTerug_Do"[^>]*value="18:00"/); assert.equal(switchOn(html, 'Do', 'terug'), true);
  S.wrForm = null; await toggle(fake, 'Do', 'heen', false); await toggle(fake, 'Do', 'terug', true); S.wrForm = null;
  const h2 = wijzigen(); assert.match(h2, /id="wrHeen_Do"[^>]*value="10:15"/); assert.doesNotMatch(h2, /id="wrTerug_Do"/); assert.equal(switchOn(h2, 'Do', 'terug'), false);
});
await testAsync('both rides off in Mijn week: "Rijdt mee" is unticked in the form for that day, the other days are not touched', async () => {
  const fake = await parentOn(); await toggle(fake, 'Do', 'heen', true); await toggle(fake, 'Do', 'terug', true); S.wrForm = null;
  assert.equal(rideTicked('Do'), false); assert.equal(rideTicked('Vr'), true);
  await toggle(fake, 'Do', 'heen', false); S.wrForm = null; assert.equal(rideTicked('Do'), true, 'one back on: the day rides again');
});
await testAsync('the form: emptying one time is "rijdt niet mee" on that shift at once (a mark, no request); typing the time again puts her back', async () => {
  const fake = await parentOn(); wijzigen(); fillInputs(); setField('wrHeen_Do', '');
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), true);
  assert.deepEqual(fake.get('deviations/Do_heen').ovGirlIds, ['f2']); assert.ok(!(fake.get('deviations/Do_terug') || {}).ovGirlIds, 'the other shift is untouched');
  assert.equal([...fake.store.keys()].filter(k => k.startsWith('weekRequests/')).length, 0, 'the database only takes a direct request for a whole day: this stays a mark');
  assert.match(mijnWeek(), /Jahaimy rijdt niet mee/);
  wijzigen(); assert.equal(S.wrForm.days.Do.heen, ''); fillInputs(); setField('wrHeen_Do', '10:15');
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), true);
  assert.ok(!(fake.get('deviations/Do_heen').ovGirlIds || []).length, 'the mark is gone again'); assert.doesNotMatch(mijnWeek(), /Jahaimy rijdt niet mee/);
});
await testAsync('the form: both times empty (or the day unticked) = the whole day off: a direct request and both marks; the toggles of Mijn week are off', async () => {
  const fake = await parentOn(); wijzigen(); fillInputs(); setField('wrHeen_Do', ''); setField('wrTerug_Do', '');
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), true);
  const r = fake.get('weekRequests/2026-W40_Do_f2'); assert.deepEqual([r.rides, r.status], [false, 'direct']);
  assert.deepEqual(fake.get('deviations/Do_heen').ovGirlIds, ['f2']); assert.deepEqual(fake.get('deviations/Do_terug').ovGirlIds, ['f2']);
  const h = mijnWeek(); assert.equal((h.match(/rideRow--off/g) || []).length, 2); assert.doesNotMatch(h, /data-gowijzig="Do"/);
});
await testAsync('the form: one time emptied and the other really changed = marks at once, the changed time waits as a request', async () => {
  const fake = await parentOn(); wijzigen(); fillInputs(); setField('wrHeen_Do', ''); setField('wrTerug_Do', '17:30');
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), true);
  const r = fake.get('weekRequests/2026-W40_Do_f2'); assert.deepEqual([r.rides, r.heen, r.terug, r.status], [true, '', '17:30', 'pending']);
  assert.deepEqual(fake.get('deviations/Do_heen').ovGirlIds, ['f2']);
});
await testAsync('the form opens fresh after a toggle in Mijn week (no old copy of the form is kept)', async () => {
  const fake = await parentOn(); wijzigen(); assert.equal(S.wrForm.days.Do.heen, '10:15');
  await toggle(fake, 'Do', 'heen', true); S.wrForm = null; wijzigen(); assert.equal(S.wrForm.days.Do.heen, '');
});
await testAsync('Mijn week: an open request already counts for HER own time ("aanwezig om" / "klaar om"); only the car waits for the coordinator, and the other days keep the standard time', async () => {
  await parentOn(); await submitThis([['Do', '12:30', '19:00']]);
  const html = mijnWeek('Do'), card = html.slice(html.indexOf('Donderdag')), s = text(card);
  assert.match(s, /aanwezig om 12:30/, 'her asked arrival time, not the standard 10:15'); assert.match(s, /klaar om 19:00/);
  assert.doesNotMatch(card.slice(0, card.indexOf('reqBlock')), /aanwezig om 10:15/, 'the standard time is no longer shown as hers');
  const other = mijnWeek('Vr'); assert.doesNotMatch(text(other), /aanwezig om 12:30/, 'another day is not touched');
  assert.equal(openAskedTime('Do', 'heen'), '12:30'); assert.equal(openAskedTime('Vr', 'heen'), '');
  assert.equal(openAskedTimeOf(myFamilyId(), 'Do', 'terug'), '19:00'); assert.equal(openAskedTimeOf('', 'Do', 'terug'), '', 'no family, no time');
  assert.equal(shownTime(myFamilyId(), 'Do', 'terug'), '19:00', 'the screens that only know rides.js see the asked time too (registered by this module)');
});
await testAsync('Mijn week: her own time follows the request the moment it is withdrawn (back to the standard time)', async () => {
  await parentOn(); await submitThis([['Do', '12:30', '19:00']]);
  assert.equal(await withFakeNowAsync(NOW, () => withdrawWeekRequests('this', 'Do')), true); await tick();
  const s = text(mijnWeek('Do')); assert.doesNotMatch(s, /aanwezig om 12:30|klaar om 19:00/); assert.match(s, /aanwezig om 10:15/);
});
await testAsync('a time field with the focus (picker open on a phone): live data does not redraw the form; after the field is left it does', async () => {
  await parentOn(); wijzigen(); fillInputs(); setField('wrHeen_Do', '11:15');
  document.activeElement = { classList: { contains: c => c === 'wrTime' } };
  assert.equal(holdFormRedraw(), true, 'no redraw while the picker is open');
  document.activeElement = null;
  assert.equal(redrawAfterTyping(), true, 'the field is left: it draws again'); assert.equal(redrawAfterTyping(), false, 'only once');
});
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
