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
import { weekroosterActive, submitWeekForm, toggleRide, myWeekWeekroosterHtml, requestPillHtml, summaryOf, deciderLabel, upperFirst, lower, dayName } from '../ui-weekrooster-form.js';
import { syncWeekRequests } from '../weekrooster-data.js';
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
  assert.equal(myWeekWeekroosterHtml(), ''); assert.equal(requestPillHtml('Do'), '');
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
await testAsync('Mijn week: the button, ONE amber card with a count title and a row per day (day, times, decider capitalised), and the pill on the ride', async () => {
  await parentOn(); wijzigen(); fillInputs(); setField('wrHeen_Do', '11:00'); setField('wrTerug_Do', '18:00');
  await withFakeNowAsync(NOW, () => submitWeekForm()); await tick();
  const html = mijnWeek(), s = text(html);
  assert.match(html, /id="wrChange"/); assert.match(s, /Tijden wijzigen/);
  assert.equal((html.match(/class="alertCard alertCard--stack"/g) || []).length, 1, 'one card');
  assert.match(s, /1 aanvraag wacht op antwoord/); assert.match(s, /Donderdag heen 11:00 · terug 18:00 [A-Z]/);
  assert.doesNotMatch(s, /Aanvraag voor|beslist\./, 'the old sentence is gone');
  assert.match(html, /tag tag--warn">Aanvraag</);
});
await testAsync('Mijn week: many requests stay ONE card; a single request of next week is a row that says so, two or more fold under one line', async () => {
  await parentOn(); wijzigen(); fillInputs(); setField('wrHeen_Do', '11:00'); setField('wrTerug_Do', '18:00'); setField('wrHeen_Vr', '10:00'); setField('wrTerug_Vr', '16:00');
  await withFakeNowAsync(NOW, () => submitWeekForm()); await tick();
  let html = mijnWeek(); assert.match(text(html), /2 aanvragen wachten op antwoord/);
  const nextWeek = async (days) => { S.wrWeek = 'next'; S.wrForm = null; wijzigen(); fillInputs([]); days.forEach(([d, h, tr]) => { setField('wrHeen_' + d, h); setField('wrTerug_' + d, tr); }); await withFakeNowAsync(NOW, () => submitWeekForm()); await tick(); };
  await nextWeek([['Ma', '08:15', '17:00']]);
  html = mijnWeek(); assert.match(text(html), /3 aanvragen wachten op antwoord/); assert.match(text(html), /Maandag volgende week heen 08:15 · terug 17:00/);
  assert.doesNotMatch(html, /reqGroup/, 'one request of next week: no fold');
  await parentOn();   // a fresh start: two days of next week handed in at once
  await nextWeek([['Ma', '08:15', '17:00'], ['Di', '08:15', '17:30']]);
  html = mijnWeek();
  assert.equal((html.match(/class="alertCard alertCard--stack"/g) || []).length, 1, 'still one card');
  assert.match(text(html), /2 aanvragen wachten op antwoord/); assert.match(text(html), /Volgende week · 2 dagen/);
  assert.match(html, /id="wrReqGroup" aria-expanded="false"/); assert.equal((html.match(/data-reqnext hidden/g) || []).length, 2, 'next week folded: both rows hidden');
  S.myWeekReqOpen = true; html = mijnWeek();
  assert.match(html, /id="wrReqGroup" aria-expanded="true"/); assert.doesNotMatch(html, /data-reqnext hidden/, 'unfolded stays unfolded after a redraw'); S.myWeekReqOpen = false;
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
  assert.match(html, /^<div class="wrStack"><button type="button" class="btn" id="wrChange"><svg/); assert.doesNotMatch(html, /<b>/);
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
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
