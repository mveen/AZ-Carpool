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
import { weekroosterActive, submitWeekForm, myWeekWeekroosterHtml, requestPillHtml, summaryOf, deciderLabel, upperFirst, lower, dayName } from '../ui-weekrooster-form.js';
import { syncWeekRequests } from '../weekrooster-data.js';

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
    Object.assign(dom.el('wrRide_' + day), { checked: d.rides !== false, disabled: past });
    Object.assign(dom.el('wrHeen_' + day), { value: d.heen || '', disabled: past });
    Object.assign(dom.el('wrTerug_' + day), { value: d.terug || '', disabled: past });
  });
};
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
await testAsync('Deze week: five days, past days locked, "Rijdt mee" and the two time columns, tokens only (no inline style)', async () => {
  await parentOn(); const html = wijzigen(), s = text(html);
  assert.match(s, /Tijden deze week/); assert.match(s, /Heen: aankomsttijd/); assert.match(s, /Terug: klaar om op te halen/);
  assert.equal([...html.matchAll(/data-wrday="(\w\w)"/g)].map(m => m[1]).join(','), 'Ma,Di,Wo,Do,Vr');
  assert.equal((html.match(/periodDay--past/g) || []).length, 2, 'Monday and Tuesday are over');
  assert.match(html, /id="wrRide_Do" checked/); assert.doesNotMatch(noStyle(html), /style="/);
  assert.match(html, /id="wrHeen_Do"[^>]*value="10:15"/); assert.match(html, /id="wrTerug_Do"[^>]*value="18:00"/);
  assert.match(html, /id="wrSubmit"/); assert.match(html, /id="wrCancel"/);
});
await testAsync('Volgende week: nothing is over, the title says next week', async () => {
  await parentOn(); S.wrWeek = 'next'; const html = wijzigen();
  assert.match(text(html), /Tijden volgende week/); assert.doesNotMatch(html, /periodDay--past/);
  assert.match(html, /data-wrweek="next" aria-pressed="true"/);
});
await testAsync('"Rijdt niet mee" hides the time fields of that day', async () => {
  await parentOn(); wijzigen(); S.wrForm.days.Do.rides = false; const html = wijzigen();
  assert.match(html, /id="wrRide_Do"><span>|id="wrRide_Do">/); assert.doesNotMatch(html, /id="wrHeen_Do"/);
});

console.log('=== handing in ===');
await testAsync('new times become a request: "Doorgegeven", waiting for the day coordinator, "Wie merkt dit", withdraw and edit', async () => {
  const fake = await parentOn(); wijzigen(); fillInputs();
  setField('wrHeen_Do', '11:00'); setField('wrTerug_Do', '18:00');
  const ok = await withFakeNowAsync(NOW, () => submitWeekForm());
  assert.equal(ok, true); assert.equal(fake.get('weekRequests/2026-W40_Do_f2').status, 'pending'); assert.equal(S.wrForm, null);
  await tick(); const html = wijzigen(), s = text(html);
  assert.match(s, /Doorgegeven · week 40/); assert.match(s, /Het vaste rooster geldt tot de dagcoördinator akkoord geeft/);
  assert.match(s, /DO 1 okt|Do 1 okt/i); assert.match(s, /Heen 11:00 · Terug 18:00/); assert.match(s, /Wacht op/);
  assert.match(html, /periodDone periodDone--wait/); assert.match(s, /Wie merkt dit/); assert.match(s, /Dit is een verwachting/);
  assert.match(html, /id="wrEdit"/); assert.match(html, /id="wrWithdraw"/); assert.doesNotMatch(noStyle(html), /style="/);
});
await testAsync('Mijn week: the button, an amber card with the request (decider capitalised) and the pill on the ride', async () => {
  await parentOn(); wijzigen(); fillInputs(); setField('wrHeen_Do', '11:00'); setField('wrTerug_Do', '18:00');
  await withFakeNowAsync(NOW, () => submitWeekForm()); await tick();
  const html = mijnWeek(), s = text(html);
  assert.match(html, /id="wrChange"/); assert.match(s, /Tijden wijzigen/);
  assert.match(html, /alertCard/); assert.match(s, /Aanvraag voor donderdag: heen 11:00 · terug 18:00\. [A-Z][^.]* beslist\./);
  assert.match(html, /tag tag--warn">Aanvraag</);
});
await testAsync('nothing changed: nothing is written and the parent is told', async () => {
  const fake = await parentOn(); wijzigen(); fillInputs();
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), false);
  assert.match(toast(), /Je hebt niets gewijzigd/); assert.equal([...fake.store.keys()].filter(k => k.startsWith('weekRequests/')).length, 0);
});
await testAsync('a changed day with both times empty is not handed in', async () => {
  const fake = await parentOn(); wijzigen(); fillInputs(); setField('wrHeen_Do', ''); setField('wrTerug_Do', '');
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), false);
  assert.match(toast(), /minstens één tijd/); assert.equal([...fake.store.keys()].filter(k => k.startsWith('weekRequests/')).length, 0);
});
await testAsync('"Rijdt niet mee" is applied at once and shown as "Direct"', async () => {
  const fake = await parentOn(); wijzigen(); S.wrForm.days.Vr.rides = false; fillInputs();
  assert.equal(await withFakeNowAsync(NOW, () => submitWeekForm()), true);
  assert.equal(fake.get('weekRequests/2026-W40_Vr_f2').status, 'direct'); await tick();
  const html = wijzigen();
  assert.match(text(html), /Direct/); assert.match(text(html), /Dit is direct doorgevoerd/); assert.doesNotMatch(html, /periodDone--wait|id="wrWho"|id="wrWithdraw"/);
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

console.log('=== the code ===');
test('ui-weekrooster-form.js imports nothing it does not use', () => assertNoUnusedImports('ui-weekrooster-form.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
