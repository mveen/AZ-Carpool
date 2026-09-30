// Run with: node ui-period.test.js
// Step 2 of "periode met andere tijden": task card, form and "doorgegeven" card in Wijzigen, and the badge on the Wijzigen tab.
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
import { installFakeDom, sampleParentState, sampleCoordinatorState, useFakeDb, sampleDbSeed, withFakeNow, withFakeNowAsync } from './test-support.js';
import { S } from '../state.js';
import { renderDeviationTab } from '../ui-deviation.js';
import { periodTask, periodTaskFor, periodBehalfRows, togglePeriodView, periodFormFrom, periodDaySummary, periodFormHtml, periodFormActive, periodCardsHtml, updatePeriodBadge, refreshPeriodTask, openPeriodForm, submitPeriodForm } from '../ui-period.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const toast = () => text(dom.doc.getElementById('toast').innerHTML);
const PERIOD = { name: 'Herfstvakantie', firstDay: '2026-10-26', lastDay: '2026-10-30', opensOn: '2026-10-14', deadlineDate: '2026-10-16', deadlineTime: '12:00' };
const DAYS5 = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];
const OPEN = '2026-10-15T09:00:00+02:00', WAITING = '2026-10-13T09:00:00+02:00', CLOSED = '2026-10-20T09:00:00+02:00', OVER = '2026-11-02T09:00:00+01:00';
const ID = '2026-10-26_f2';
// f2 (Jahaimy): Ma 08:30/17:30, Di 10:15/17:30, Wo no times, Do 10:15/18:00, Vr 11:00/17:00.
const parent = (patch = {}) => sampleParentState({ period: PERIOD, periodEntries: {}, periodEntriesLoaded: true, ...patch });
const coordinator = (patch = {}) => sampleCoordinatorState({ links: { coord: { familyId: 'f1' } }, period: PERIOD, periodEntries: {}, periodEntriesLoaded: true, ...patch });
const handedIn = { familyId: 'f2', periodFirstDay: '2026-10-26', submittedAt: 1, by: 'Piet Pieters', days: {
  '2026-10-26': { heen: '08:30', terug: '17:30' }, '2026-10-27': { heen: '10:30', terug: '12:30' }, '2026-10-28': { out: true }, '2026-10-29': { terug: '12:30' }, '2026-10-30': { out: true } } };

// The fake page has no real inputs: build them from the rendered html so the handlers the page wired up can be used.
const box = dom.el('tab-deviation');
let html = '';
Object.defineProperty(box, 'innerHTML', { get: () => html, set: v => { html = v; registry(v); }, configurable: true });
function registry(h) {
  const ids = re => [...h.matchAll(re)].map(m => dom.el(m[1]));
  const time = ids(/class="periodTime[^"]*" id="([^"]+)"/g), ride = ids(/class="periodRideInput" id="([^"]+)"/g);
  const btns = attr => [...h.matchAll(new RegExp(`data-${attr}="([^"]+)"`, 'g'))].map(m => ({ dataset: { [attr]: m[1] }, onclick: null }));
  const fill = btns('periodfill'), view = btns('periodview');
  dom.doc.querySelectorAll = sel => (sel === '.periodTime' ? time : sel === '.periodRideInput' ? ride : sel === '[data-periodfill]' ? fill : sel === '[data-periodview]' ? view : []);
}
const render = (now = OPEN) => { withFakeNow(now, () => renderDeviationTab()); return html; };
// Types a whole form the way a user would: riding days checked, times filled in.
function fill(values) {
  Object.entries(values).forEach(([iso, d]) => {
    dom.el('periodRide_' + iso).checked = !d.out;
    dom.el('periodHeen_' + iso).value = d.heen || ''; dom.el('periodTerug_' + iso).value = d.terug || '';
  });
}

console.log('=== who sees what ===');
test('nothing shows until the period AND the handed-in times are loaded (no flash of a task for a family that is done)', () => {
  assert.equal(periodTask().show, null);
  parent({ period: null }); assert.equal(periodTask().show, null);
  parent({ periodEntriesLoaded: false }); assert.equal(withFakeNow(OPEN, () => periodTask()).show, null);
});
test('a parent gets the task while filling in is open, the done card once handed in, and nothing before or after', () => {
  parent(); assert.equal(withFakeNow(OPEN, () => periodTask()).show, 'task'); assert.equal(withFakeNow(OPEN, () => periodTask()).badge, true);
  assert.equal(withFakeNow(WAITING, () => periodTask()).show, null); assert.equal(withFakeNow(OVER, () => periodTask()).show, null);
  parent({ periodEntries: { [ID]: handedIn } }); const tk = withFakeNow(OPEN, () => periodTask());
  assert.equal(tk.show, 'done'); assert.equal(tk.badge, false); assert.equal(tk.entry, handedIn); assert.equal(tk.familyId, 'f2');
});
test('an entry of another period or another family does not count as handed in', () => {
  parent({ periodEntries: { '2026-12-21_f2': handedIn, '2026-10-26_f1': { ...handedIn, familyId: 'f1' } } });
  assert.equal(withFakeNow(OPEN, () => periodTask()).show, 'task');
});
test('a Flex family has no task', () => {
  const fams = sampleParentState().families; fams.f2 = { ...fams.f2, familyType: 'flex' };
  parent({ families: fams }); assert.equal(withFakeNow(OPEN, () => periodTask()).show, null);
});
test('the coordinator fills in for the own family, also after the deadline (then without a badge)', () => {
  coordinator(); assert.deepEqual([withFakeNow(OPEN, () => periodTask()).show, withFakeNow(OPEN, () => periodTask()).familyId], ['task', 'f1']);
  const late = withFakeNow(CLOSED, () => periodTask()); assert.equal(late.show, 'task'); assert.equal(late.canEdit, true); assert.equal(late.badge, false);
  sampleCoordinatorState({ period: PERIOD, periodEntries: {}, periodEntriesLoaded: true });   // no family of the own: nothing
  assert.equal(withFakeNow(OPEN, () => periodTask()).show, null);
});

console.log('\n=== the task card (A1) ===');
test('the task card names the period, the dates, the daughter and the deadline, and offers the button', () => {
  parent(); const s = text(render());
  assert.match(s, /^Actie nodig: geef tijden door Herfstvakantie · 26 – 30 okt\. Geef door hoe laat Jahaimy heen en terug moet, of dat ze niet meerijdt\. Deadline: vrijdag 16 okt 12:00 Het vaste rooster blijft staan voor andere weken\. Tijden doorgeven /);
  assert.match(html, /id="periodOpen"/);
  assert.match(s, /Wijzigingen · Week 40/, 'the weekly changes stay below the task');
});
test('after the deadline the coordinator sees that only they can still fill in', () => {
  coordinator(); const s = text(render(CLOSED));
  assert.match(s, /De deadline is voorbij\. Alleen jij kunt als coördinator de tijden nog invullen\./); assert.doesNotMatch(s, /Deadline: vrijdag/);
});
test('without a period, before it opens, or when not handed in and past the deadline (parent): no card', () => {
  parent({ period: null }); assert.doesNotMatch(render(), /periodTask|periodDone/);
  parent(); assert.doesNotMatch(render(WAITING), /periodTask|periodDone/); assert.doesNotMatch(render(CLOSED), /periodTask|periodDone/);
});

console.log('\n=== the badge on the Wijzigen tab ===');
test('a red "1" while a task is open; gone when handed in, before opening, after the deadline and for Flex', () => {
  const badge = dom.el('navDeviationBadge');
  parent(); render(); assert.equal(badge.textContent, '1'); assert.equal(badge.style.display, ''); assert.equal(badge.getAttribute('aria-label'), 'Actie nodig: tijden doorgeven');
  parent({ periodEntries: { [ID]: handedIn } }); render(); assert.equal(badge.style.display, 'none'); assert.equal(badge.textContent, '');
  parent(); render(WAITING); assert.equal(badge.style.display, 'none');
  parent(); render(CLOSED); assert.equal(badge.style.display, 'none');
  coordinator(); render(CLOSED); assert.equal(badge.style.display, 'none', 'the coordinator after the deadline has no urgent task');
});
test('the badge follows updatePeriodBadge on its own too', () => {
  parent(); withFakeNow(OPEN, () => updatePeriodBadge()); assert.equal(dom.el('navDeviationBadge').textContent, '1');
  parent({ period: null }); withFakeNow(OPEN, () => updatePeriodBadge()); assert.equal(dom.el('navDeviationBadge').style.display, 'none');
});
test('the minute check redraws only when what is shown changed (filling in opens, deadline passes)', () => {
  parent(); withFakeNow(WAITING, () => { renderDeviationTab(); });
  assert.equal(withFakeNow(WAITING, () => refreshPeriodTask()), false);
  assert.equal(withFakeNow(OPEN, () => refreshPeriodTask()), true);        // opened: the task and the badge appear
  assert.match(html, /id="periodTask"/); assert.equal(dom.el('navDeviationBadge').textContent, '1');
  assert.equal(withFakeNow(OPEN, () => refreshPeriodTask()), false);
  assert.equal(withFakeNow(CLOSED, () => refreshPeriodTask()), true);      // deadline passed
  assert.doesNotMatch(html, /id="periodTask"/); assert.equal(dom.el('navDeviationBadge').style.display, 'none');
});

console.log('\n=== the form (A2) ===');
test('the form opens with the standard rooster; a day without standard times starts as "Rijdt niet mee"', () => {
  parent(); render();
  assert.equal(withFakeNow(OPEN, () => openPeriodForm()), true);
  assert.deepEqual(Object.keys(S.periodForm.days), DAYS5); assert.equal(S.periodForm.familyId, 'f2');
  const s = text(html);
  assert.match(s, /^Tijden Herfstvakantie Herfstvakantie · 26 – 30 okt · deadline vr 16 okt 12:00 Ingevuld is het vaste rooster\. Pas aan wat anders is\. Een tijd invullen = meerijden\. Heen: aankomst Alkmaar Terug: klaar om op te halen MA 26 okt Rijdt mee /);
  assert.match(s, /WO 28 okt Rijdt niet mee Jahaimy rijdt deze dag niet mee\./);
  assert.equal((html.match(/type="time"/g) || []).length, 8);   // four riding days, two times each
  assert.match(html, /id="periodHeen_2026-10-26" value="08:30"/); assert.match(html, /id="periodTerug_2026-10-30" value="17:00"/);
  assert.doesNotMatch(html, /periodTask|Wijzigingen · Week/, 'the rest of Wijzigen is hidden while the form is open');
  assert.doesNotMatch(html, /changed/, 'nothing is amber while it equals the standard rooster');
});
test('periodFormFrom: what was handed in before comes back; an "out" day keeps the standard times for when it is switched on again', () => {
  const fam = sampleParentState().families.f2;
  const days = periodFormFrom(PERIOD, fam, handedIn);
  assert.deepEqual(days['2026-10-27'], { out: false, heen: '10:30', terug: '12:30' });
  assert.deepEqual(days['2026-10-29'], { out: false, heen: '', terug: '12:30' });
  assert.deepEqual(days['2026-10-30'], { out: true, heen: '11:00', terug: '17:00' });
  assert.deepEqual(periodFormFrom(PERIOD, fam, null), periodFormFrom(PERIOD, fam, { days: {} }));
});
test('changed days and times are amber', () => {
  parent(); render();
  S.periodForm = { familyId: 'f2', days: periodFormFrom(PERIOD, S.families.f2, handedIn) };
  const h = withFakeNow(OPEN, () => periodFormHtml());
  assert.match(h, /class="periodDay" data-periodday="2026-10-26"/);                          // standard: not amber
  assert.match(h, /class="periodDay changed" data-periodday="2026-10-27"/);                 // times differ
  assert.match(h, /class="periodTime changed" id="periodHeen_2026-10-27"/); assert.match(h, /class="periodTime changed" id="periodTerug_2026-10-27"/);
  assert.match(h, /class="periodDay changed" data-periodday="2026-10-30"/);                 // not riding while the standard rides
  assert.match(h, /class="periodDay" data-periodday="2026-10-28"/);                         // not riding = standard on a day without times
});
test('typing a time marks it amber at once, without redrawing the form', () => {
  parent(); render(); withFakeNow(OPEN, () => openPeriodForm());
  fill(Object.fromEntries(DAYS5.map(iso => [iso, S.periodForm.days[iso]])));
  dom.el('periodHeen_2026-10-26').value = '09:15';
  const before = html; dom.el('periodHeen_2026-10-26').oninput();
  assert.equal(S.periodForm.days['2026-10-26'].heen, '09:15'); assert.equal(dom.el('periodHeen_2026-10-26').classList.contains('changed'), true);
  dom.el('periodHeen_2026-10-26').value = '08:30'; dom.el('periodHeen_2026-10-26').oninput();
  assert.equal(dom.el('periodHeen_2026-10-26').classList.contains('changed'), false); assert.equal(html, before);
});
test('the switch Rijdt mee / Rijdt niet mee redraws the day and keeps what was typed elsewhere', () => {
  parent(); render(); withFakeNow(OPEN, () => openPeriodForm());
  fill(Object.fromEntries(DAYS5.map(iso => [iso, S.periodForm.days[iso]])));
  dom.el('periodHeen_2026-10-27').value = '09:00';
  dom.el('periodRide_2026-10-26').checked = false;
  withFakeNow(OPEN, () => dom.el('periodRide_2026-10-26').onchange());
  assert.equal(S.periodForm.days['2026-10-26'].out, true); assert.equal(S.periodForm.days['2026-10-27'].heen, '09:00');
  assert.match(text(html), /MA 26 okt Rijdt niet mee Jahaimy rijdt deze dag niet mee\./);
  assert.match(html, /id="periodHeen_2026-10-27" value="09:00"/);
});
test('Annuleren closes the form and shows the task again', () => {
  parent(); render(); withFakeNow(OPEN, () => openPeriodForm());
  withFakeNow(OPEN, () => dom.el('periodCancel').onclick());
  assert.equal(S.periodForm, null); assert.match(html, /id="periodTask"/);
});
test('the form cannot be opened, and is closed, when the deadline has passed for a parent or another family is shown', () => {
  parent(); assert.equal(withFakeNow(CLOSED, () => openPeriodForm()), false); assert.equal(S.periodForm, null);
  parent(); render(); withFakeNow(OPEN, () => openPeriodForm());
  assert.equal(withFakeNow(CLOSED, () => periodFormActive()), false); assert.equal(S.periodForm, null);
  parent(); render(); withFakeNow(OPEN, () => openPeriodForm()); S.impersonateFamilyId = 'f3';
  assert.equal(withFakeNow(OPEN, () => periodFormActive()), false);
  assert.equal(withFakeNow(OPEN, () => periodFormHtml()), '');
});

console.log('\n=== handing in ===');
await testAsync('Doorgeven stores the times for the family, closes the form and shows the green card', async () => {
  const fake = useFakeDb(sampleDbSeed()); parent(); render(); withFakeNow(OPEN, () => openPeriodForm());
  const d = S.periodForm.days;
  fill({ ...d, '2026-10-27': { heen: '10:30', terug: '12:30' }, '2026-10-29': { heen: '', terug: '12:30' }, '2026-10-30': { out: true } });
  assert.equal(await withFakeNowAsync(OPEN, () => dom.el('periodSubmit').onclick()), true);
  assert.deepEqual(Object.keys(fake.get('periodEntries/' + ID)).sort(), ['by', 'days', 'familyId', 'periodFirstDay', 'submittedAt']);
  assert.deepEqual(fake.get('periodEntries/' + ID).days, { '2026-10-26': { heen: '08:30', terug: '17:30' }, '2026-10-27': { heen: '10:30', terug: '12:30' }, '2026-10-28': { out: true }, '2026-10-29': { terug: '12:30' }, '2026-10-30': { out: true } });
  assert.equal(fake.get('periodEntries/' + ID).familyId, 'f2'); assert.equal(fake.get('periodEntries/' + ID).periodFirstDay, '2026-10-26');
  assert.equal(S.periodForm, null); assert.equal(toast(), 'Tijden doorgegeven ✓');
  render(); assert.match(html, /id="periodDone"/); assert.doesNotMatch(html, /id="periodTask"/); assert.equal(dom.el('navDeviationBadge').style.display, 'none');
});
await testAsync('a time problem stores nothing, names the day, and keeps the form and what was typed', async () => {
  const fake = useFakeDb(sampleDbSeed()); parent(); render(); withFakeNow(OPEN, () => openPeriodForm());
  fill({ ...S.periodForm.days, '2026-10-27': { heen: '14:00', terug: '12:30' } });
  assert.equal(await withFakeNowAsync(OPEN, () => submitPeriodForm()), false);
  assert.equal(fake.get('periodEntries/' + ID), undefined); assert.equal(toast(), 'dinsdag 27 okt: Terug moet later zijn dan Heen.');
  assert.ok(S.periodForm); assert.equal(S.periodForm.days['2026-10-27'].heen, '14:00');
  fill({ ...S.periodForm.days, '2026-10-27': { heen: '', terug: '' } });
  await withFakeNowAsync(OPEN, () => submitPeriodForm()); assert.equal(toast(), 'dinsdag 27 okt: vul een tijd in, of kies Rijdt niet mee.');
});
await testAsync('a refused write is reported and the form stays open', async () => {
  const fake = useFakeDb(sampleDbSeed()); parent(); render(); withFakeNow(OPEN, () => openPeriodForm());
  fake.failWrites('periodEntries/', 'permission-denied');
  fill(S.periodForm.days);
  assert.equal(await withFakeNowAsync(OPEN, () => submitPeriodForm()), false);
  assert.match(toast(), /permission-denied/); assert.ok(S.periodForm); assert.deepEqual(S.periodEntries, {});
});
await testAsync('a parent cannot hand in after the deadline, not even with an old form; the coordinator can, for the own family', async () => {
  const fake = useFakeDb(sampleDbSeed()); parent(); render(); withFakeNow(OPEN, () => openPeriodForm());
  fill(S.periodForm.days);
  assert.equal(await withFakeNowAsync(CLOSED, () => submitPeriodForm()), false);
  assert.equal(toast(), 'De deadline is voorbij. Alleen de coördinator kan de tijden nog aanpassen.'); assert.equal(fake.get('periodEntries/' + ID), undefined);
  const f2 = useFakeDb(sampleDbSeed()); coordinator(); render(CLOSED); withFakeNow(CLOSED, () => openPeriodForm());
  fill(S.periodForm.days);
  assert.equal(await withFakeNowAsync(CLOSED, () => submitPeriodForm()), true);
  assert.equal(f2.get('periodEntries/2026-10-26_f1').familyId, 'f1');
});

console.log('\n=== the "doorgegeven" card (A3) ===');
test('it lists every day: the standard rooster, "rijdt niet mee", or only the times that differ', () => {
  parent({ periodEntries: { [ID]: handedIn } }); const s = text(render());
  assert.match(s, /^Tijden doorgegeven Herfstvakantie · Jahaimy\. Wijzigen kan tot vrijdag 16 okt 12:00\. Jouw tijden · Herfstvakantie Ma 26 okt vast rooster Di 27 okt heen 10:30 · terug 12:30 Wo 28 okt vast rooster Do 29 okt niet heen · terug 12:30 Vr 30 okt rijdt niet mee Tijden aanpassen /);
});
test('"Tijden aanpassen" opens the form with what was handed in', () => {
  parent({ periodEntries: { [ID]: handedIn } }); render(); assert.match(html, /id="periodEdit"/);
  withFakeNow(OPEN, () => dom.el('periodEdit').onclick());
  assert.equal(S.periodForm.days['2026-10-27'].heen, '10:30'); assert.match(html, /id="periodHeen_2026-10-27" value="10:30"/);
});
test('after the deadline a parent still sees what was handed in, but cannot change it', () => {
  parent({ periodEntries: { [ID]: handedIn } }); const s = text(render(CLOSED));
  assert.match(s, /De deadline is voorbij\. Tijden aanpassen kan alleen nog via de coördinator\./); assert.doesNotMatch(html, /id="periodEdit"/);
});
test('periodDaySummary: cleared directions are named', () => {
  const fam = sampleParentState().families.f2;
  assert.equal(periodDaySummary(fam, '2026-10-26', { heen: '08:30' }), 'niet terug');
  assert.equal(periodDaySummary(fam, '2026-10-26', { terug: '17:30' }), 'niet heen');
  assert.equal(periodDaySummary(fam, '2026-10-28', { out: true }), 'vast rooster');
});
test('periodCardsHtml is empty when there is nothing for this user', () => {
  parent({ period: null }); assert.equal(periodCardsHtml(), '');
});

console.log('\n=== the coordinator fills in on behalf of a parent (A4) ===');
// Families of the sample: f1 Eline (the coordinator's own), f2 Jahaimy, f3 Anouk, f4 Evi, f5 Lois, f6 Saar.
const entryFor = (id, first = '2026-10-26') => ({ ...handedIn, familyId: id });
const others = () => [...html.matchAll(/data-periodfamily="([^"]+)"/g)].map(m => m[1]);
test('the coordinator sees the overview from the day filling in opens until the period is over; a parent, or before opening, never', () => {
  coordinator(); assert.match(render(OPEN), /id="periodBehalfCard"/); assert.match(render(CLOSED), /id="periodBehalfCard"/);
  assert.doesNotMatch(render(WAITING), /periodBehalfCard/); assert.doesNotMatch(render(OVER), /periodBehalfCard/);
  parent(); assert.doesNotMatch(render(OPEN), /periodBehalfCard/);
  coordinator({ period: null }); assert.doesNotMatch(render(OPEN), /periodBehalfCard/);
});
test('not in the "test as parent" view, where the coordinator has parent rights only', () => {
  coordinator({ impersonateFamilyId: 'f2', canEdit: false }); assert.doesNotMatch(render(OPEN), /periodBehalfCard/);
});
test('the list: families that still have to hand in first, then the others, each in name order; own family and Flex families are left out', () => {
  const fams = sampleCoordinatorState().families; fams.f6 = { ...fams.f6, familyType: 'flex' };
  coordinator({ families: fams, periodEntries: { '2026-10-26_f3': entryFor('f3'), '2026-10-26_f1': entryFor('f1') } }); render(OPEN);
  assert.deepEqual(others(), ['f4', 'f2', 'f5', 'f3']);   // Evi, Jahaimy, Lois (not yet) then Anouk (done); f1 is the own family, f6 is Flex
  const s = text(html);
  assert.match(s, /Namens een ouder invullen 2 van 5 doorgegeven\. Nog 3 te gaan\. Evi Mo Bakker Nog niet Invullen Jahaimy Piet Pieters Nog niet Invullen Lois Sanne Smit Nog niet Invullen Anouk Kees de Vries Doorgegeven Bekijk/);
});
test('within each group the families are in name order, not in the order of the database', () => {
  coordinator({ periodEntries: { '2026-10-26_f2': entryFor('f2'), '2026-10-26_f4': entryFor('f4') } }); render(OPEN);
  assert.deepEqual(others(), ['f3', 'f5', 'f6', 'f4', 'f2']);   // Anouk, Lois, Saar (not yet) then Evi, Jahaimy (done): f2 comes before f4 in the database
});
test('when everybody has handed in the overview says so', () => {
  const fams = sampleCoordinatorState().families; delete fams.f6; delete fams.f5;
  coordinator({ families: fams, periodEntries: Object.fromEntries(['f1', 'f2', 'f3', 'f4'].map(id => ['2026-10-26_' + id, entryFor(id)])) });
  assert.match(text(render(OPEN)), /Alle 4 gezinnen hebben doorgegeven\./);
});
test('the coordinator\'s own task says they can also fill in for a parent; a parent\'s task does not', () => {
  coordinator(); assert.match(text(render(OPEN)), /Geef je eigen tijden door\. Als coördinator kun je ook invullen namens een ouder\./);
  parent(); assert.doesNotMatch(text(render(OPEN)), /namens een ouder/);
});
test('a coordinator without a family of their own gets the overview with its own introduction and the deadline', () => {
  sampleCoordinatorState({ period: PERIOD, periodEntries: {}, periodEntriesLoaded: true });
  const s = text(render(OPEN));
  assert.doesNotMatch(html, /id="periodTask"/); assert.match(s, /Namens een ouder invullen Herfstvakantie · 26 – 30 okt\. Als coördinator kun je invullen namens een ouder\. Deadline: vrijdag 16 okt 12:00 0 van 6 doorgegeven\. Nog 6 te gaan\./);
  assert.equal(others().length, 6);
  assert.match(text(render(CLOSED)), /De deadline is voorbij\. Alleen jij kunt als coördinator de tijden nog invullen\./);
});
test('"Invullen" opens the form for that family: their standard rooster, and a note that this is on behalf of the parent', () => {
  coordinator(); render(OPEN);
  assert.equal(withFakeNow(OPEN, () => openPeriodForm('f5')), true);
  assert.equal(S.periodForm.familyId, 'f5');
  const s = text(html);
  assert.match(s, /Je vult in namens Sanne Smit \(Lois\)\./);
  assert.match(html, /id="periodHeen_2026-10-26" value="08:30"/, 'the times of family f5, not of the coordinator');
  assert.doesNotMatch(s, /namens Eline|Actie nodig/);
  const own = withFakeNow(OPEN, () => openPeriodForm()); assert.equal(own, true); assert.doesNotMatch(html, /periodOnBehalf/, 'no note for the own family');
});
test('the row buttons call openPeriodForm with the family of that row', () => {
  coordinator(); render(OPEN);
  const fam = others()[0];
  withFakeNow(OPEN, () => dom.doc.querySelectorAll('[data-periodfill]')[0].onclick());
  assert.equal(S.periodForm.familyId, fam);
});
await testAsync('the coordinator hands in for another family: stored under THAT family, the row moves to "Doorgegeven", also after the deadline', async () => {
  const fake = useFakeDb(sampleDbSeed()); coordinator(); render(OPEN); withFakeNow(OPEN, () => openPeriodForm('f5'));
  fill({ ...S.periodForm.days, '2026-10-27': { heen: '09:00', terug: '12:00' } });
  assert.equal(await withFakeNowAsync(OPEN, () => submitPeriodForm()), true);
  const d = fake.get('periodEntries/2026-10-26_f5');
  assert.equal(d.familyId, 'f5'); assert.deepEqual(d.days['2026-10-27'], { heen: '09:00', terug: '12:00' }); assert.equal(d.by, 'Jan Jansen');
  assert.equal(fake.get('periodEntries/2026-10-26_f1'), undefined, 'not for the coordinator\'s own family');
  assert.equal(S.periodForm, null); assert.match(text(render(OPEN)), /1 van 6 doorgegeven\. Nog 5 te gaan\./);
  const rows = others(); assert.equal(rows[rows.length - 1], 'f5');
  withFakeNow(CLOSED, () => openPeriodForm('f3')); fill(S.periodForm.days);
  assert.equal(await withFakeNowAsync(CLOSED, () => submitPeriodForm()), true); assert.equal(fake.get('periodEntries/2026-10-26_f3').familyId, 'f3');
});
// Anouk (f3) rides Ma, Wo and Do normally, not Di and Vr: the lines compare with HER rooster, not with the coordinator's.
test('"Bekijk" unfolds what that family handed in, with a button to change it; a second tap folds it again', () => {
  coordinator({ periodEntries: { '2026-10-26_f3': entryFor('f3') } }); render(OPEN);
  assert.doesNotMatch(html, /periodBehalfDetail/);
  withFakeNow(OPEN, () => dom.doc.querySelectorAll('[data-periodview]')[0].onclick());
  assert.equal(S.periodView, 'f3'); const s = text(html);
  assert.match(s, /Anouk Kees de Vries Doorgegeven Sluiten Ma 26 okt heen 08:30 · terug 17:30 Di 27 okt heen 10:30 · terug 12:30 Wo 28 okt rijdt niet mee Do 29 okt niet heen · terug 12:30 Vr 30 okt vast rooster Tijden aanpassen/);
  assert.match(html, /data-periodfill="f3"/);
  withFakeNow(OPEN, () => togglePeriodView('f3')); assert.equal(S.periodView, null); assert.doesNotMatch(html, /periodBehalfDetail/);
});
test('"Tijden aanpassen" in that view opens the form with what the family handed in', () => {
  coordinator({ periodEntries: { '2026-10-26_f3': entryFor('f3') }, periodView: 'f3' }); render(OPEN);
  withFakeNow(OPEN, () => openPeriodForm('f3'));
  assert.equal(S.periodView, null); assert.match(html, /id="periodHeen_2026-10-27" value="10:30"/); assert.match(text(html), /Je vult in namens Kees de Vries \(Anouk\)\./);
});
test('only the coordinator can open the form for another family', () => {
  parent(); render(OPEN); assert.equal(withFakeNow(OPEN, () => openPeriodForm('f3')), false); assert.equal(S.periodForm, null);
  assert.equal(withFakeNow(OPEN, () => periodTaskFor('f3').canEdit), true, 'the state alone does not decide: openPeriodForm checks the coordinator rights');
});
test('a form for another family closes when the coordinator rights go away (test view), a form for the own family does not', () => {
  coordinator(); render(OPEN); withFakeNow(OPEN, () => openPeriodForm('f5'));
  assert.equal(withFakeNow(OPEN, () => periodFormActive()), true);
  S.canEdit = false; assert.equal(withFakeNow(OPEN, () => periodFormActive()), false); assert.equal(S.periodForm, null);
});
test('the minute check redraws the coordinator overview when it appears or disappears', () => {
  coordinator(); withFakeNow(WAITING, () => renderDeviationTab());
  assert.equal(withFakeNow(OPEN, () => refreshPeriodTask()), true); assert.match(html, /periodBehalfCard/);
  assert.equal(withFakeNow(OVER, () => refreshPeriodTask()), true); assert.doesNotMatch(html, /periodBehalfCard/);
});
test('periodBehalfRows: the counts include the own family, the list does not', () => {
  coordinator({ periodEntries: { '2026-10-26_f1': entryFor('f1') } });
  const r = withFakeNow(OPEN, () => periodBehalfRows());
  assert.equal(r.total, 6); assert.equal(r.done, 1); assert.equal(r.rows.length, 5); assert.ok(!r.rows.some(x => x.id === 'f1'));
});
test('the badge stays for the coordinator\'s own task only, not for families still to go', () => {
  coordinator(); render(OPEN); assert.equal(dom.el('navDeviationBadge').textContent, '1');
  coordinator({ periodEntries: { '2026-10-26_f1': entryFor('f1') } }); render(OPEN); assert.equal(dom.el('navDeviationBadge').style.display, 'none');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
