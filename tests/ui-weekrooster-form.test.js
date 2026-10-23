// Run with: node ui-weekrooster-form.test.js
// Afwijkend weekrooster, phase 2: what a parent sees. Wijzigen (the week form, the "Doorgegeven" card, "Wie merkt dit", the day
// coordinator) and Mijn week (button, amber card, pill). With the switch off, or on for someone else, none of it exists.
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
import { installFakeDom, useFakeDb, withFakeNow, withFakeNowAsync, NOW, sampleDbSeed, sampleParentState, sampleCoordinatorState, sampleFamilies, assertNoUnusedImports } from './test-support.js';
import { S } from '../state.js';
import { renderDeviationTab } from '../ui-deviation.js';
import { renderMyWeek } from '../ui-myweek.js';
import { weekroosterActive, submitWeekForm, toggleRide, myWeekWeekroosterHtml, requestBlockHtml, openAskedTime, openAskedTimeOf, myWeekNextWeekHtml, wireMyWeekWeekrooster, summaryOf, deciderLabel, upperFirst, lower, dayName } from '../ui-weekrooster-form.js';
import { myFamilyId } from '../coordinator.js';
import { syncWeekRequests, withdrawWeekRequests } from '../weekrooster-data.js';
import { setReturnByPublicTransport } from '../data.js';

const dom = installFakeDom();
const noStyle = h => h.replace(/<svg[\s\S]*?<\/svg>/g, '');   // the Phosphor icons carry their own sizing
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const toast = () => text(dom.html('toast'));
const wijzigen = () => { withFakeNow(NOW, () => renderDeviationTab()); return dom.html('tab-deviation'); };
const mijnWeek = () => { withFakeNow(NOW, () => renderMyWeek()); return dom.html('tab-myweek'); };
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
const parentOn = async (mode = 'aan') => { const fake = useFakeDb(sampleDbSeed()); sampleParentState({ weekrooster: { mode } }); syncWeekRequests(); await tick(); return fake; };

console.log('=== who sees it ===');
test('only with the switch on for this person, with a daughter of their own, and not Flex', () => {
  sampleParentState({ weekrooster: { mode: 'aan' } }); assert.equal(weekroosterActive(), true);
  [null, { mode: 'uit' }, { mode: 'test' }, { mode: 'kapot' }].forEach(w => { sampleParentState({ weekrooster: w }); assert.equal(weekroosterActive(), false); });
  sampleCoordinatorState({ weekrooster: { mode: 'test' }, impersonateFamilyId: 'f2' }); assert.equal(weekroosterActive(), true);
  const fams = sampleFamilies(); fams.f2.familyType = 'flex';
  sampleParentState({ weekrooster: { mode: 'aan' }, families: fams });
  assert.equal(weekroosterActive(), false);
  sampleParentState({ weekrooster: { mode: 'aan' }, links: {} }); assert.equal(weekroosterActive(), false);
});
test('uit: Wijzigen and Mijn week show nothing of the new flow and no pill', async () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ weekrooster: { mode: 'uit' } });
  assert.doesNotMatch(wijzigen(), /wrForm|data-wrweek|Tijden deze week/); assert.doesNotMatch(mijnWeek(), /wrChange|Tijden wijzigen|Aanvraag/);
  assert.equal(myWeekWeekroosterHtml(), ''); assert.equal(requestBlockHtml('Do'), ''); assert.equal(myWeekNextWeekHtml(), '');
});

console.log('=== the week form ===');
await testAsync('Deze week: five days, past days locked, a switch per ride and the two time columns, tokens only (no inline style)', async () => {
  await parentOn(); const html = wijzigen(), s = text(html);
  assert.match(s, /Tijden deze week/); assert.match(s, /Heen: aankomsttijd/); assert.match(s, /Terug: klaar om op te halen/);
  assert.equal([...html.matchAll(/data-wrday="(\w\w)"/g)].map(m => m[1]).join(','), 'Ma,Di,Wo,Do,Vr');
  assert.equal((html.match(/periodDay--past/g) || []).length, 2, 'Monday and Tuesday are over');
  assert.match(html, /class="switch switch--sm on" role="switch" aria-checked="true" aria-label="Rijdt mee Heen Donderdag" data-wrtoggle="Do" data-wrdir="heen"/);
  assert.match(html, /aria-label="Rijdt mee Terug Donderdag" data-wrtoggle="Do" data-wrdir="terug"/); assert.doesNotMatch(html, /wrRide_/);
  assert.doesNotMatch(noStyle(html), /style="/);
  assert.match(html, /id="wrHeen_Do"[^>]*value="10:15"/); assert.match(html, /id="wrTerug_Do"[^>]*value="18:00"/);
  assert.match(html, /id="wrSubmit"/); assert.match(html, /id="wrCancel"/);
});
await testAsync('Volgende week: nothing is over, the title says next week', async () => {
  await parentOn(); S.wrWeek = 'next'; const html = wijzigen();
  assert.match(text(html), /Tijden volgende week/); assert.doesNotMatch(html, /periodDay--past/);
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
  toggleRide('Do', 'terug'); let d = S.wrForm.days.Do, html = dom.html('tab-deviation');
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
  assert.equal(switchOn(dom.html('tab-deviation'), 'Wo', 'heen'), false); assert.doesNotMatch(dom.html('tab-deviation'), /id="wrHeen_Wo"/);
  toggleRide('Wo', 'heen'); const html = dom.html('tab-deviation');
  assert.match(html, /id="wrHeen_Wo"[^>]*value=""/); assert.equal(switchOn(html, 'Wo', 'heen'), true); assert.equal(S.wrForm.days.Wo.rides, true);
});
await testAsync('the switches hand in the same thing as an emptied time: Thursday terug off = a mark at once, no request', async () => {
  const fake = await parentOn(); wijzigen(); fillInputs(); toggleRide('Do', 'terug'); fillInputs();
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), true);
  assert.deepEqual(fake.get('deviations/Do_terug').ovGirlIds, ['f2']); assert.ok(!fake.get('weekRequests/2026-W40_Do_f2') || fake.get('weekRequests/2026-W40_Do_f2').status !== 'pending');
});

console.log('=== handing in ===');
await testAsync('new times become a request: "Doorgegeven", waiting for the day coordinator, "Wie merkt dit", withdraw and edit', async () => {
  const fake = await parentOn(); wijzigen(); fillInputs();
  setField('wrHeen_Do', '11:00'); setField('wrTerug_Do', '18:00');
  const ok = await withFakeNowAsync(NOW, () => submitWeekForm());
  assert.equal(ok, true); assert.equal(fake.get('weekRequests/2026-W40_Do_f2').status, 'pending'); assert.equal(S.wrForm, null);
  await tick(); const html = wijzigen(), s = text(html);
  assert.match(s, /Doorgegeven · week 40/); assert.match(s, /Het vaste rooster geldt tot de dagcoördinator akkoord geeft/);
  assert.match(s, /Donderdag 1 okt/); assert.match(s, /Heen 11:00 · Terug 18:00/); assert.match(s, /Wacht op/);
  assert.match(html, /periodDone periodDone--stack periodDone--wait/); assert.doesNotMatch(s, /Wie merkt dit/); assert.match(s, /Voor andere gezinnen verandert er niets/); assert.match(html, /reqRow/);
  assert.equal((html.match(/class="card"/g) || []).length, 0, 'one card, not two');
  assert.match(html, /id="wrEdit"/); assert.match(html, /id="wrWithdraw"/); assert.doesNotMatch(noStyle(html), /style="/);
});
const submitThis = async days => { wijzigen(); fillInputs(); days.forEach(([d, h, tr]) => { setField('wrHeen_' + d, h); setField('wrTerug_' + d, tr); }); await withFakeNowAsync(NOW, () => submitWeekForm()); await tick(); };
const submitNext = async days => { S.wrWeek = 'next'; S.wrForm = null; wijzigen(); fillInputs([]); days.forEach(([d, h, tr]) => { setField('wrHeen_' + d, h); setField('wrTerug_' + d, tr); }); await withFakeNowAsync(NOW, () => submitWeekForm()); await tick(); };
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
  const [block, blockVr] = blocksOf(mijnWeek());
  assert.match(block, /aanwezig <s>10:15<\/s> <b>11:00<\/b>/, 'old struck through, new normal');
  assert.doesNotMatch(block, /<s>18:00/, 'an unchanged time is not struck through');
  assert.doesNotMatch(text(block), /→|heen 11:00|terug 18:00/, 'no arrow, and "aanwezig" / "klaar" instead of "heen" / "terug"');
  assert.equal((block.match(/class="reqBlock__line"/g) || []).length, 2, 'aanwezig and klaar are two lines');
  assert.match(block, /class="reqBlock__line">klaar <b>18:00<\/b>/);
  assert.match(text(blockVr), /aanwezig 11:00 Rijdt niet mee klaar 17:00 16:00/, 'an emptied time is "rijdt niet mee" on that ride');
});
await testAsync('design B, Mijn week: Intrekken withdraws that day only', async () => {
  await parentOn(); await submitThis([['Do', '11:00', '18:00'], ['Vr', '10:00', '16:00']]);
  assert.equal((mijnWeek().match(/class="reqBlock"/g) || []).length, 2);
  assert.equal(await withFakeNowAsync(NOW, () => withdrawWeekRequests('this', 'Do')), true);
  const html = mijnWeek();
  assert.equal((html.match(/class="reqBlock"/g) || []).length, 1); assert.match(html, /data-wrwithdraw="Vr"/); assert.doesNotMatch(html, /data-wrwithdraw="Do"/);
  assert.equal(await withFakeNowAsync(NOW, () => withdrawWeekRequests('this', 'Do')), false, 'nothing left of that day to withdraw');
  assert.equal(await withFakeNowAsync(NOW, () => withdrawWeekRequests('this')), true); assert.doesNotMatch(mijnWeek(), /reqBlock/);
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
await testAsync('design B, Mijn week: the link "Wijzigen" at next week opens Wijzigen on the tab "Volgende week"', async () => {
  await parentOn(); await submitNext([['Ma', '08:15', '17:00']]);
  S.wrWeek = 'this'; const btn = {}; const box = { querySelector: sel => (sel === '#wrChangeNext' ? btn : null), querySelectorAll: () => [] };
  withFakeNow(NOW, () => wireMyWeekWeekrooster(box));
  assert.equal(typeof btn.onclick, 'function'); withFakeNow(NOW, () => btn.onclick());
  assert.equal(S.wrWeek, 'next'); assert.match(text(dom.html('tab-deviation')), /Doorgegeven · week 41/);
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
await testAsync('"Rijdt niet mee" is applied at once and shown as "Direct"', async () => {
  const fake = await parentOn(); wijzigen(); S.wrForm.days.Vr.rides = false; fillInputs();
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), true);
  assert.equal(fake.get('weekRequests/2026-W40_Vr_f2').status, 'direct'); await tick();
  const html = wijzigen();
  assert.match(text(html), /Direct/); assert.match(text(html), /Dit is direct doorgevoerd/); assert.doesNotMatch(html, /periodDone--wait|id="wrWho"|id="wrWithdraw"/); assert.match(html, /id="wrEdit"/);
});
await testAsync('"Wie merkt dit" says when another car is needed (next week, Monday)', async () => {
  await parentOn(); S.wrWeek = 'next'; wijzigen(); fillInputs([]);
  setField('wrHeen_Ma', '12:00'); setField('wrTerug_Ma', '17:30');
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), true); await tick();
  const s = text(wijzigen());
  assert.match(s, /Doorgegeven · week 41/); assert.match(s, /MA Heen[^.]*auto extra nodig/);
});
test('the helpers the day coordinator\'s screens share: one-line summary, day names, the decider (never lower case at the start of a sentence)', () => {
  sampleParentState({ weekrooster: { mode: 'aan' }, dayCoordinators: { Do: 'f3' } });
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
await testAsync('what was just handed in shows at once ("Doorgegeven"), even when the live listener is not running', async () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ weekrooster: { mode: 'aan' } });   // no syncWeekRequests: the listeners are dead
  assert.equal(S.weekRequestsUnsubs.length, 0);
  wijzigen(); fillInputs(); setField('wrTerug_Do', '12:45');
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), true);
  const s = text(wijzigen()); assert.match(s, /Doorgegeven · week 40/); assert.match(s, /Terug 12:45/);
  const { withdrawWeekRequests } = await import('../weekrooster-data.js');
  assert.equal(await withFakeNowAsync(NOW, () => withdrawWeekRequests('this')), true);
  assert.doesNotMatch(text(wijzigen()), /Doorgegeven · week/, 'withdrawn: the form is back');
});

console.log('=== the code ===');
test('ui-weekrooster-form.js imports nothing it does not use', () => assertNoUnusedImports('ui-weekrooster-form.js'));

await testAsync('Mijn week: the button spans the width with an icon, in one stack with the request note (a clock, no bold text)', async () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ weekrooster: { mode: 'aan' } });
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
  const html = mijnWeek(), card = html.slice(html.indexOf('Donderdag')), s = text(card);
  assert.match(s, /aanwezig om 12:30/, 'her asked arrival time, not the standard 10:15'); assert.match(s, /klaar om 19:00/);
  assert.doesNotMatch(card.slice(0, card.indexOf('reqBlock')), /aanwezig om 10:15/, 'the standard time is no longer shown as hers');
  const other = html.slice(html.indexOf('Vrijdag')); assert.doesNotMatch(text(other), /aanwezig om 12:30/, 'another day is not touched');
  assert.equal(openAskedTime('Do', 'heen'), '12:30'); assert.equal(openAskedTime('Vr', 'heen'), '');
  assert.equal(openAskedTimeOf(myFamilyId(), 'Do', 'terug'), '19:00'); assert.equal(openAskedTimeOf('', 'Do', 'terug'), '', 'no family, no time');
});
await testAsync('Mijn week: her own time follows the request the moment it is withdrawn (back to the standard time)', async () => {
  await parentOn(); await submitThis([['Do', '12:30', '19:00']]);
  assert.equal(await withFakeNowAsync(NOW, () => withdrawWeekRequests('this', 'Do')), true); await tick();
  const s = text(mijnWeek()); assert.doesNotMatch(s, /aanwezig om 12:30|klaar om 19:00/); assert.match(s, /aanwezig om 10:15/);
});
await testAsync('a time field with the focus (picker open on a phone): live data does not redraw the form; after the field is left it does', async () => {
  await parentOn(); wijzigen(); fillInputs(); setField('wrHeen_Do', '11:15');
  const field = { classList: { contains: c => c === 'wrTime' } };
  dom.el('tab-deviation').innerHTML = 'MARK';
  document.activeElement = field;
  wijzigen(); assert.equal(dom.html('tab-deviation'), 'MARK', 'no redraw while the picker is open');
  document.activeElement = null;
  assert.match(wijzigen(), /id="wrForm"/, 'the field is left: it draws again');
});
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
