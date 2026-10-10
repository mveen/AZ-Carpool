// Run with: node ui-period-rooster.test.js
// Step 4 of "periode met andere tijden": the Rooster tab. The overview for the coordinator, the third view with the temporary
// rooster (day by day), and the coordinator's edits (plan, driver, move a girl).
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
import { installFakeDom, sampleParentState, sampleCoordinatorState, useFakeDb, sampleDbSeed, withFakeNow, withFakeNowAsync, oneP } from './test-support.js';
import { S } from '../state.js';
import { renderSchedule } from '../ui-schedule.js';
import { periodModeAvailable, periodModeLabel, periodModeInfoHtml, periodViewDay, periodDayChanges, periodOverviewHtml, periodTimesHtml, periodDirectionHtml, periodViewHtml, movePeriodGirl, setPeriodDriver, setPeriodCarPlace, setPeriodDeparture, availablePeriods, selectedPeriod } from '../ui-period-rooster.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const toast = () => text(dom.doc.getElementById('toast').innerHTML);
const PERIOD = { name: 'Herfstvakantie', firstDay: '2026-10-26', lastDay: '2026-10-30', opensOn: '2026-10-14', deadlineDate: '2026-10-16', deadlineTime: '12:00' };
const OPEN = '2026-10-15T09:00:00+02:00', CLOSED = '2026-10-20T09:00:00+02:00', WAITING = '2026-10-13T09:00:00+02:00', OVER = '2026-11-02T09:00:00+01:00';
const entryOf = (id, days) => ({ familyId: id, periodFirstDay: '2026-10-26', days, submittedAt: 1, by: 'x' });
const shiftDoc = (iso, direction, cars) => ({ periodFirstDay: '2026-10-26', date: iso, direction, cars, madeAt: 1, by: 'x' });
// f2 (Jahaimy): Di 12:30 terug, out on Thursday. f6 (Saar) and f5 (Lois): Di terug 12:30 / 13:00.
const entries = () => ({
  '2026-10-26_f2': entryOf('f2', { '2026-10-27': { heen: '10:15', terug: '12:30' }, '2026-10-29': { out: true } }),
  '2026-10-26_f6': entryOf('f6', { '2026-10-27': { heen: '10:15', terug: '12:30' } }),
  '2026-10-26_f5': entryOf('f5', { '2026-10-27': { heen: '10:15', terug: '13:00' } }),
});
const XCARS = [{ driverFamilyId: 'f2', girlIds: ['f2', 'f6', 'f5'], departureTime: '13:00' }, { driverFamilyId: 'f4', girlIds: ['f1', 'f4'], departureTime: '17:30' }];
const base = { currentWeekKey: '2026-W44', periods: oneP(PERIOD), periodEntries: entries(), periodEntriesLoaded: true, deviations: {}, scheduleDay: 'Ma' };
const coord = (patch = {}) => sampleCoordinatorState({ links: { coord: { familyId: 'f1' } }, ...base, periodCars: {}, ...patch });
const parent = (patch = {}) => sampleParentState({ ...base, periodCars: {}, ...patch });
const madeCars = { '2026-10-26_2026-10-27_terug': shiftDoc('2026-10-27', 'terug', XCARS) };

// The fake page has no real controls: build them from the html so the handlers the page wired up can be used.
const box = dom.el('tab-schedule');
let html = '';
Object.defineProperty(box, 'innerHTML', { get: () => html, set: v => { html = v; registry(v); }, configurable: true });
let picks = {};
function registry(h) {
  const attr = (name) => [...h.matchAll(new RegExp(`<[^>]*data-${name}="([^"]+)"[^>]*>`, 'g'))].map(m => {
    const el = { dataset: {}, onclick: null, onchange: null, value: '' };
    [...m[0].matchAll(/data-([a-z]+)="([^"]*)"/g)].forEach(d => { el.dataset[d[1]] = d[2]; });
    return el;
  });
  picks = { perday: attr('perday'), preplan: attr('preplan'), pdrv: attr('pdrv'), pmove: attr('pmove'), make: attr('periodmake'), remake: attr('periodremake'), remove: attr('periodremove'), pick: attr('periodpick') };
  dom.doc.querySelectorAll = sel => (sel === '[data-perday]' ? picks.perday : sel === '[data-preplan]' ? picks.preplan : sel === '[data-pdrv]' ? picks.pdrv : sel === '.periodMove' ? picks.pmove
    : sel === '[data-periodmake]' ? picks.make : sel === '[data-periodremake]' ? picks.remake : sel === '[data-periodremove]' ? picks.remove : sel === '[data-periodpick]' ? picks.pick : []);
}
const render = (now = OPEN) => { withFakeNow(now, () => renderSchedule()); return html; };
const findMove = girl => picks.pmove.find(e => e.dataset.pmove === girl);

console.log('=== is the third view there? ===');
test('the coordinator has it while filling in is open or the deadline passed; not before or after', () => {
  coord(); assert.equal(withFakeNow(OPEN, () => periodModeAvailable()), true); assert.equal(withFakeNow(CLOSED, () => periodModeAvailable()), true);
  assert.equal(withFakeNow(WAITING, () => periodModeAvailable()), false); assert.equal(withFakeNow(OVER, () => periodModeAvailable()), false);
  coord({ periods: {} }); assert.equal(withFakeNow(OPEN, () => periodModeAvailable()), false);
});
test('a parent has it only once the temporary rooster was made', () => {
  parent(); assert.equal(withFakeNow(OPEN, () => periodModeAvailable()), false);
  parent({ periodCars: madeCars }); assert.equal(withFakeNow(OPEN, () => periodModeAvailable()), true); assert.equal(withFakeNow(OVER, () => periodModeAvailable()), false);
  parent({ periodCars: { '2026-12-21_x': { periodFirstDay: '2026-12-21', cars: [] } } }); assert.equal(withFakeNow(OPEN, () => periodModeAvailable()), false, 'a rooster of another period does not count');
});
test('the button label is the period name, shortened when it is long', () => {
  const label = () => withFakeNow(OPEN, () => periodModeLabel());
  coord(); assert.equal(label(), 'Herfstvak.');
  coord({ periods: oneP({ ...PERIOD, name: 'Proefwerkweek 2' }) }); assert.equal(label(), 'Proefwerk.');
  coord({ periods: oneP({ ...PERIOD, name: 'Kerst' }) }); assert.equal(label(), 'Kerst'); coord({ periods: oneP({ ...PERIOD, name: '0123456789' }) }); assert.equal(label(), '0123456789');
  coord({ periods: {} }); assert.equal(label(), '', 'no period: no label');
});
test('the switch shows the third button and the explanation; a stale "period" mode falls back to "Deze week"', () => {
  coord({ roosterMode: 'period' }); const h = render();
  assert.match(h, /data-rmode="period" class="active" aria-pressed="true">Herfstvak.</); assert.match(text(h), /Tijdelijk rooster Herfstvakantie \(26 – 30 okt\)\. Iedereen kan in Wijzigen blijven wijzigen\. Dat gaat altijd voor het tijdelijke rooster\./);
  parent({ roosterMode: 'period' }); const p = render();
  assert.doesNotMatch(p, /data-rmode="period"/); assert.equal(S.roosterMode, 'week'); assert.match(p, /data-rmode="week" class="active"/);
  coord({ roosterMode: 'week' }); assert.match(render(OVER), /data-rmode="standard"/); assert.doesNotMatch(html, /data-rmode="period"/);
});
test('parents get their own explanation', () => {
  parent({ periodCars: madeCars, roosterMode: 'period' });
  assert.match(text(render()), /Tijdelijk rooster Herfstvakantie \(26 – 30 okt\)\. Wijzigingen in Wijzigen gaan altijd voor het tijdelijke rooster\./);
  assert.match(withFakeNow(OPEN, () => periodModeInfoHtml()), /Wijzigingen in Wijzigen gaan altijd/);
});

console.log('\n=== the overview for the coordinator (A5) ===');
test('title, how many handed in, the deadline with the names that are still missing, a change count per day and the button', () => {
  coord(); const h = render(); const s = text(h);
  assert.match(s, /Herfstvakantie · 26 – 30 okt Doorgegeven 3 van 6 Deadline vr 16 okt 12:00 · nog niet: Eline, Anouk, Evi MA 26 geen wijz\. DI 27 3 wijz\. WO 28 geen wijz\. DO 29 1 wijz\. VR 30 geen wijz\. Tijdelijk rooster maken Het tijdelijke rooster vervangt het vaste rooster alleen in deze periode\. Daarna geldt weer het vaste rooster\./);
  assert.match(h, /id="periodMake_2026-10-26"/); assert.doesNotMatch(h, /periodRemake|periodRemove/);
});
test('the overview comes above the switch, and only for the coordinator', () => {
  coord(); const h = render(); assert.ok(h.indexOf('id="periodOverview_2026-10-26"') > -1 && h.indexOf('id="periodOverview_2026-10-26"') < h.indexOf('class="segmented"'));
  parent(); assert.doesNotMatch(render(), /periodOverview_2026-10-26/);
  coord({ impersonateFamilyId: 'f2', canEdit: false }); assert.doesNotMatch(render(), /periodOverview_2026-10-26/, 'not in the test view as a parent');
});
test('not before filling in opens and not after the period; not before the handed-in times are loaded', () => {
  coord(); assert.doesNotMatch(render(WAITING), /periodOverview_2026-10-26/); assert.doesNotMatch(render(OVER), /periodOverview_2026-10-26/);
  coord({ periodEntriesLoaded: false }); assert.doesNotMatch(render(), /periodOverview_2026-10-26/); coord({ periods: {} }); assert.doesNotMatch(render(), /periodOverview_2026-10-26/);
});
test('more than five families missing: five names and "+n"; everybody in: says so; after the deadline the wording changes', () => {
  const fams = sampleCoordinatorState().families; for (let i = 7; i <= 12; i++) fams['f' + i] = { ...fams.f1, girlName: 'Meisje' + i, parentName: 'Ouder' + i };
  coord({ families: fams }); assert.match(text(render()), /nog niet: Eline, Anouk, Evi, Meisje7, Meisje8 \+4/);
  const all = Object.fromEntries(Object.keys(sampleCoordinatorState().families).map(id => ['2026-10-26_' + id, entryOf(id, {})]));
  coord({ periodEntries: all }); assert.match(text(render()), /Doorgegeven 6 van 6 Deadline vr 16 okt 12:00 · iedereen heeft doorgegeven/);
  coord(); assert.match(text(render(CLOSED)), /Deadline voorbij · nog niet: Eline, Anouk, Evi/);
  coord({ periodEntries: all }); assert.match(text(render(CLOSED)), /Deadline voorbij · iedereen heeft doorgegeven/);
});
test('periodDayChanges counts changes and "rijdt niet mee" per date, Flex families not', () => {
  coord(); assert.deepEqual(periodDayChanges('2026-10-27'), { changes: 3, out: 0 }); assert.deepEqual(periodDayChanges('2026-10-29'), { changes: 1, out: 1 }); assert.deepEqual(periodDayChanges('2026-10-28'), { changes: 0, out: 0 });
  const fams = sampleCoordinatorState().families; fams.f2 = { ...fams.f2, familyType: 'flex' };
  coord({ families: fams }); assert.deepEqual(periodDayChanges('2026-10-29'), { changes: 0, out: 0 });
});
test('once the rooster is made the button becomes "Alles opnieuw indelen" and a trash button appears', () => {
  coord({ periodCars: madeCars }); const h = render();
  assert.match(h, /id="periodRemake_2026-10-26"[^>]*>Alles opnieuw indelen</); assert.match(h, /id="periodRemove_2026-10-26"[^>]*aria-label="Verwijder tijdelijk rooster"/); assert.doesNotMatch(h, /id="periodMake_2026-10-26"/);
});

console.log('\n=== the temporary rooster, day by day (A6) ===');
test('the pills show the dates of the period with the number of cars and an alert for riders without a car', () => {
  coord({ periodCars: madeCars, roosterMode: 'period', periodDay: '2026-10-27' }); const h = render();
  assert.equal((h.match(/data-perday=/g) || []).length, 5);
  assert.match(text(h), /ma 26 di 27 wo 28 do 29 vr 30/);
  assert.match(h, /data-perday="2026-10-27" aria-pressed="true" aria-label="dinsdag 27 okt, 2 ritten"/);
  assert.match(h, /class="dayPill on" data-perday="2026-10-27"/);
  coord({ periodCars: { '2026-10-26_2026-10-27_terug': shiftDoc('2026-10-27', 'terug', [XCARS[1]]) }, roosterMode: 'period', periodDay: '2026-10-27' });
  assert.match(render(), /class="dayPill__dot" aria-hidden="true"><\/span>/);
});
test('a day: the handed-in times next to the standard ones (struck through where they differ), then the cars', () => {
  coord({ periodCars: madeCars, roosterMode: 'period', periodDay: '2026-10-27' }); const h = render(); const s = text(h);
  assert.match(s, /dinsdag 27 okt/);
  assert.match(h, /<s class="muted">17:30<\/s> <strong class="periodChanged">12:30<\/strong>/); assert.match(h, /<s class="muted">17:30<\/s> <strong class="periodChanged">13:00<\/strong>/);
  assert.match(s, /13:00 .*Jahaimy.*Lois.*Saar/); assert.match(s, /17:30 .*Eline.*Evi/);
  assert.equal(picks.pdrv.length, 2, 'the coordinator edits the drivers with selects');
});
test('a girl who does not ride that day shows "rijdt niet mee" with her standard time struck through', () => {
  coord({ periodCars: {}, roosterMode: 'period', periodDay: '2026-10-29' });
  assert.match(text(render()), /Jahaimy Piet Pieters 10:15 rijdt niet mee/); assert.match(html, /<s class="muted">10:15<\/s> <span class="periodChanged">rijdt niet mee<\/span>/);
});
test('a shift that is not made says the standard rooster applies', () => {
  coord({ periodCars: {}, roosterMode: 'period', periodDay: '2026-10-28' });
  assert.match(text(render()), /Voor deze dag is nog geen tijdelijk rooster: het vaste rooster geldt\./);
});
test('a parent sees the same, read only: no selects, no buttons; their own car has no amber border', () => {
  parent({ periodCars: madeCars, roosterMode: 'period', periodDay: '2026-10-27' }); const h = render();
  assert.doesNotMatch(h, /data-pdrv|data-pmove|data-preplan|periodOverview_2026-10-26/); assert.match(text(h), /13:00/);
  assert.match(text(h), /Jij rijdt/); assert.match(text(h), /Mo Bakker/); assert.match(h, /class="carCard__driver carCard__driver--me"/);
  assert.match(h, /class="chip chip--mine">Jahaimy</); assert.doesNotMatch(h, /carCard--mine/);   /* design v2: the car you drive has no amber border (amber = a changed car) */
});
test('the coordinator sees a driver select per car, a move select per rider and "Opnieuw indelen" per direction', () => {
  coord({ periodCars: madeCars, roosterMode: 'period', periodDay: '2026-10-27' }); const h = render();
  assert.equal(picks.pdrv.length, 2); assert.equal(picks.pmove.length, 5); assert.equal(picks.preplan.length, 2);
  assert.match(h, /<select id="periodDrv_0"[^>]*data-pdrv="0" data-iso="2026-10-27" data-dir="terug"/);
  assert.match(h, /<option value="f2" selected>Piet Pieters \(4\)<\/option>/);
  assert.match(h, /<option value="car:1">Auto 2 · Mo Bakker<\/option>/); assert.match(h, /<option value="none">Niet ingedeeld<\/option>/);
});
test('the driver select offers only drivers that are free that day, and keeps a driver that is no longer eligible', () => {
  coord({ periodCars: { '2026-10-26_2026-10-27_terug': shiftDoc('2026-10-27', 'terug', [{ driverFamilyId: 'f3', girlIds: ['f1'], departureTime: '17:30' }]) }, roosterMode: 'period', periodDay: '2026-10-27' });
  const h = render(); const sel = h.slice(h.indexOf('id="periodDrv_0"'), h.indexOf('</select>', h.indexOf('id="periodDrv_0"')));
  assert.match(sel, /<option value="f3" selected>Kees de Vries ⚠<\/option>/); assert.match(sel, /value="f2"/); assert.match(sel, /value="f4"/);
  assert.match(text(h), /Kees de Vries staat op deze dag niet als chauffeur of back-up ingepland/);
  const avail = sel.slice(0, sel.indexOf('<optgroup') < 0 ? sel.length : sel.indexOf('<optgroup')); assert.doesNotMatch(avail, /value="f1"|value="f5"/);
});
test('riders without a car are listed with a way to place them', () => {
  coord({ periodCars: { '2026-10-26_2026-10-27_terug': shiftDoc('2026-10-27', 'terug', [XCARS[1]]) }, roosterMode: 'period', periodDay: '2026-10-27' });
  const h = render(); assert.match(text(h), /3 niet ingedeeld/);
  const un = picks.pmove.filter(e => ['f2', 'f5', 'f6'].includes(e.dataset.pmove)); assert.equal(un.length, 3);
  assert.match(h, /<option value="car:0">Auto 1 · Mo Bakker<\/option>/); assert.match(h, /<option value="new:f2">Nieuwe auto: Piet Pieters<\/option>/);
  assert.doesNotMatch(h, /<option value="new:f4">/, 'f4 already drives');
});
test('the open date defaults to the first date that is not past, else the first date; a chosen date stays', () => {
  coord(); assert.equal(withFakeNow('2026-10-15T09:00:00+02:00', () => periodViewDay()), '2026-10-26');
  assert.equal(withFakeNow('2026-10-28T09:00:00+01:00', () => periodViewDay()), '2026-10-28'); assert.equal(withFakeNow('2026-11-05T09:00:00+01:00', () => periodViewDay()), null, 'the period is over: no view');
  coord({ periodDay: '2026-10-29' }); assert.equal(withFakeNow(OPEN, () => periodViewDay()), '2026-10-29'); coord({ periodDay: '2027-01-01' }); assert.equal(withFakeNow(OPEN, () => periodViewDay()), '2026-10-26', 'a date outside the period is ignored');
});
test('pill taps change the open date', () => {
  coord({ periodCars: madeCars, roosterMode: 'period', periodDay: '2026-10-27' }); render();
  withFakeNow(OPEN, () => picks.perday.find(e => e.dataset.perday === '2026-10-28').onclick());
  assert.equal(S.periodDay, '2026-10-28'); assert.match(text(html), /woensdag 28 okt/);
});
test('periodTimesHtml and periodDirectionHtml are usable on their own', () => {
  coord({ periodCars: madeCars });
  assert.match(periodTimesHtml('2026-10-27', 'terug'), /12:30/); assert.match(periodDirectionHtml('2026-10-27', 'terug'), /data-perdir="2026-10-27\|terug"/);
  assert.equal(withFakeNow(OPEN, () => periodViewHtml()).includes('data-perday'), true); coord({ periods: {} }); assert.equal(withFakeNow(OPEN, () => periodViewHtml()), '');
  assert.match(periodTimesHtml('2026-10-31', 'heen'), /Niemand rijdt mee\./);
});

console.log('\n=== the coordinator changes the temporary rooster ===');
const prep = async (cars = madeCars) => { const fake = useFakeDb({ ...sampleDbSeed(), ...Object.fromEntries(Object.entries(cars).map(([k, v]) => ['periodCars/' + k, v])) }); coord({ periodCars: cars, roosterMode: 'period', periodDay: '2026-10-27' }); render(); return fake; };
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
const inOpen = fn => withFakeNowAsync(OPEN, fn);   // the redraws after an edit happen later: they need the same "now"
await testAsync('"Tijdelijk rooster maken" plans every shift, stores them and shows the view', async () => { await inOpen(async () => {
  const fake = useFakeDb(sampleDbSeed()); coord({ roosterMode: 'week' }); render();
  await picks.make[0].onclick();
  assert.equal(Object.keys(S.periodCars).length, 10); assert.ok(fake.get('periodCars/2026-10-26_2026-10-27_terug')); assert.match(html, /id="periodRemake_2026-10-26"/);
}); });
await testAsync('"Alles opnieuw indelen" and the trash button need a second tap; then they plan again / go back to the standard rooster', async () => { await inOpen(async () => {
  const fake = await prep(); const before = fake.writes.length;
  const remake = picks.remake[0]; remake.onclick(); await settle(); assert.equal(fake.writes.length, before, 'the first tap only asks');
  remake.onclick(); await settle(); assert.equal(Object.keys(S.periodCars).length, 10);
  const remove = picks.remove[0]; remove.onclick(); await settle(); assert.equal(Object.keys(S.periodCars).length, 10, 'the first tap only asks');
  remove.onclick(); await settle(); assert.deepEqual(S.periodCars, {}); assert.match(html, /id="periodMake_2026-10-26"/);
}); });
await testAsync('"Opnieuw indelen" plans that one direction again', async () => {
  const fake = await prep({ '2026-10-26_2026-10-27_terug': shiftDoc('2026-10-27', 'terug', [{ driverFamilyId: 'f3', girlIds: ['f1'], departureTime: '17:30' }]) });
  await withFakeNowAsync(OPEN, () => picks.preplan.find(e => e.dataset.preplan === '2026-10-27|terug').onclick());
  const cars = fake.get('periodCars/2026-10-26_2026-10-27_terug').cars;
  assert.equal(cars.flatMap(c => c.girlIds).length, 5); assert.ok(!cars.some(c => c.driverFamilyId === 'f3'));
});
await testAsync('moving a girl to another car stores both cars with new departure times and redraws', async () => {
  const fake = await prep();
  assert.equal(await withFakeNowAsync(OPEN, () => movePeriodGirl('2026-10-27', 'terug', 'f5', 'car:1')), true);
  const cars = fake.get('periodCars/2026-10-26_2026-10-27_terug').cars;
  assert.deepEqual(cars.map(c => c.girlIds), [['f2', 'f6'], ['f1', 'f4', 'f5']]); assert.deepEqual(cars.map(c => c.departureTime), ['12:30', '17:30']);
  assert.equal(toast(), 'Opgeslagen ✓'); assert.match(text(html), /12:30/);
});
await testAsync('the move select and the driver select trigger the edits', async () => { await inOpen(async () => {
  const fake = await prep(); const sel = findMove('f6'); sel.value = 'none';
  sel.onchange(); await settle();
  assert.deepEqual(fake.get('periodCars/2026-10-26_2026-10-27_terug').cars.flatMap(c => c.girlIds).sort(), ['f1', 'f2', 'f4', 'f5']);
  assert.match(text(html), /1 niet ingedeeld/);
  const drv = picks.pdrv[1]; drv.value = ''; drv.onchange(); await settle();
  assert.equal(fake.get('periodCars/2026-10-26_2026-10-27_terug').cars[1].driverFamilyId, '');
}); });
await testAsync('a full car is refused: nothing is stored, the reason is shown, the page shows what is really saved', async () => {
  const fake = await prep({ '2026-10-26_2026-10-27_terug': shiftDoc('2026-10-27', 'terug', [{ driverFamilyId: 'f4', girlIds: ['f4', 'f1', 'f6'], departureTime: '17:30' }, { driverFamilyId: 'f2', girlIds: ['f2', 'f5'], departureTime: '13:00' }]) });
  const writes = fake.writes.length;
  assert.equal(await withFakeNowAsync(OPEN, () => movePeriodGirl('2026-10-27', 'terug', 'f5', 'car:0')), false);
  assert.equal(toast(), 'Auto vol: 3 van 3 plekken.'); assert.equal(fake.writes.length, writes);
});
await testAsync('a girl without a car is placed in a car, or in a new car with a free driver', async () => {
  const fake = await prep({ '2026-10-26_2026-10-27_terug': shiftDoc('2026-10-27', 'terug', [XCARS[1]]) });
  await withFakeNowAsync(OPEN, () => movePeriodGirl('2026-10-27', 'terug', 'f5', 'car:0'));
  await withFakeNowAsync(OPEN, () => movePeriodGirl('2026-10-27', 'terug', 'f2', 'new:f2'));
  const cars = fake.get('periodCars/2026-10-26_2026-10-27_terug').cars;
  assert.deepEqual(cars.map(c => [c.driverFamilyId, c.girlIds]), [['f4', ['f1', 'f4', 'f5']], ['f2', ['f2']]]); assert.equal(cars[1].departureTime, '12:30');
});
await testAsync('another departure and arrival place for one car of a date: stored on that car, shown in its route, cleared with an empty value', async () => {
  const fake = await prep({ '2026-10-26_2026-10-27_terug': shiftDoc('2026-10-27', 'terug', [{ driverFamilyId: 'f4', girlIds: ['f1', 'f4'], departureTime: '17:30' }]) });
  assert.match(html, /data-pcarplace="2026-10-27\|terug\|0"/);
  assert.equal(await withFakeNowAsync(OPEN, () => setPeriodCarPlace('2026-10-27', 'terug', 0, { stdLocationId: 'a4-de-hoek', stdDestination: 'ATC' })), true);
  const car = fake.get('periodCars/2026-10-26_2026-10-27_terug').cars[0];
  assert.equal(car.stdLocationId, 'a4-de-hoek'); assert.equal(car.stdDestination, 'ATC'); assert.match(text(html), /ATC → A4-De Hoek/);
  assert.equal(await withFakeNowAsync(OPEN, () => setPeriodCarPlace('2026-10-27', 'terug', 0, { stdLocationId: '', stdDestination: '' })), true);
  const back = fake.get('periodCars/2026-10-26_2026-10-27_terug').cars[0];
  assert.equal('stdLocationId' in back, false); assert.equal('stdDestination' in back, false);
});
await testAsync('the coordinator can overrule the departure time of a car', async () => {
  const fake = await prep({ '2026-10-26_2026-10-27_terug': shiftDoc('2026-10-27', 'terug', [{ driverFamilyId: 'f4', girlIds: ['f1', 'f4'], departureTime: '17:30' }]) });
  assert.match(html, /<input type="time" class="timeBig" data-pdep="0"[^>]*value="17:30"/);
  assert.equal(await withFakeNowAsync(OPEN, () => setPeriodDeparture('2026-10-27', 'terug', 0, '17:45')), true);
  assert.equal(fake.get('periodCars/2026-10-26_2026-10-27_terug').cars[0].departureTime, '17:45');
});
await testAsync('a driver who is not available that day can be picked, listed apart and flagged', async () => {
  const fake = await prep({ '2026-10-26_2026-10-27_terug': shiftDoc('2026-10-27', 'terug', [{ driverFamilyId: 'f4', girlIds: ['f1'], departureTime: '17:30' }]) });
  const h = html; assert.match(h, /<optgroup label="Niet beschikbaar/);
  const off = [...h.matchAll(/<optgroup[^>]*>(.*?)<\/optgroup>/gs)][0][1]; const id = /value="([^"]+)"/.exec(off)[1];
  assert.equal(await withFakeNowAsync(OPEN, () => setPeriodDriver('2026-10-27', 'terug', 0, id)), true);
  assert.equal(fake.get('periodCars/2026-10-26_2026-10-27_terug').cars[0].driverFamilyId, id);
  assert.match(text(html), /niet beschikbaar/);
});
await testAsync('changing the driver of a car', async () => {
  const fake = await prep({ '2026-10-26_2026-10-27_terug': shiftDoc('2026-10-27', 'terug', [{ driverFamilyId: 'f4', girlIds: ['f1', 'f4'], departureTime: '17:30' }]) });
  assert.equal(await withFakeNowAsync(OPEN, () => setPeriodDriver('2026-10-27', 'terug', 0, 'f2')), true);
  assert.equal(fake.get('periodCars/2026-10-26_2026-10-27_terug').cars[0].driverFamilyId, 'f2');
  assert.equal(await withFakeNowAsync(OPEN, () => setPeriodDriver('2026-10-27', 'terug', 0, '')), true); assert.match(text(html), /Geen chauffeur|geen chauffeur/i);
});
await testAsync('a driver that already drives another car of that shift is refused', async () => {
  const fake = await prep(); const writes = fake.writes.length;
  assert.equal(await withFakeNowAsync(OPEN, () => setPeriodDriver('2026-10-27', 'terug', 1, 'f2')), false);
  assert.equal(toast(), 'Deze chauffeur rijdt al in een andere auto.'); assert.equal(fake.writes.length, writes);
});
await testAsync('a parent cannot change anything, even by calling the functions', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'periodCars/2026-10-26_2026-10-27_terug': madeCars['2026-10-26_2026-10-27_terug'] });
  parent({ periodCars: madeCars, roosterMode: 'period', periodDay: '2026-10-27' }); render();
  assert.equal(await withFakeNowAsync(OPEN, () => movePeriodGirl('2026-10-27', 'terug', 'f5', 'none')), false);
  assert.equal(toast(), 'Alleen de coördinator kan het tijdelijke rooster aanpassen.'); assert.deepEqual(fake.get('periodCars/2026-10-26_2026-10-27_terug').cars, XCARS);
});

console.log('\n=== two periods at the same time: Herfstvakantie is running, the Toetsweek is being collected ===');
const NEXT = { name: 'Toetsweek', firstDay: '2026-11-09', lastDay: '2026-11-13', opensOn: '2026-10-27', deadlineDate: '2026-11-04', deadlineTime: '12:00' };
const TWO = { '2026-10-26': PERIOD, '2026-11-09': NEXT };
const NOW2 = '2026-10-28T09:00:00+01:00';   // Herfstvakantie: deadline passed, running. Toetsweek: filling in is open.
const twoC = (patch = {}) => coord({ periods: TWO, ...patch });
const twoP = (patch = {}) => parent({ periods: TWO, ...patch });
const nextCars = { '2026-11-09_2026-11-10_heen': { periodFirstDay: '2026-11-09', date: '2026-11-10', direction: 'heen', madeAt: 1, by: 'x', cars: [] } };
test('availablePeriods: the coordinator has both from the day filling in opens; the periods are listed oldest first', () => {
  twoC(); assert.deepEqual(withFakeNow(NOW2, () => availablePeriods()).map(p => p.name), ['Herfstvakantie', 'Toetsweek']);
  assert.deepEqual(withFakeNow('2026-10-13T09:00:00+02:00', () => availablePeriods()).map(p => p.name), [], 'nothing has opened yet');
  assert.deepEqual(withFakeNow('2026-10-20T09:00:00+02:00', () => availablePeriods()).map(p => p.name), ['Herfstvakantie'], 'the Toetsweek opens on 27 Oct');
  assert.deepEqual(withFakeNow('2026-11-03T09:00:00+01:00', () => availablePeriods()).map(p => p.name), ['Toetsweek'], 'the Herfstvakantie is over');
});
test('a parent only has the periods whose temporary rooster was made', () => {
  twoP(); assert.equal(withFakeNow(NOW2, () => periodModeAvailable()), false);
  twoP({ periodCars: madeCars }); assert.deepEqual(withFakeNow(NOW2, () => availablePeriods()).map(p => p.name), ['Herfstvakantie']);
  twoP({ periodCars: { ...madeCars, ...nextCars } }); assert.equal(withFakeNow(NOW2, () => availablePeriods()).length, 2);
});
test('selectedPeriod: the chosen one; else the one running today; else the next one to come', () => {
  twoC(); assert.equal(withFakeNow(NOW2, () => selectedPeriod()).name, 'Herfstvakantie');
  assert.equal(withFakeNow('2026-11-03T09:00:00+01:00', () => selectedPeriod()).name, 'Toetsweek');
  twoC({ periodSel: '2026-11-09' }); assert.equal(withFakeNow(NOW2, () => selectedPeriod()).name, 'Toetsweek');
  twoC({ periodSel: '2026-01-01' }); assert.equal(withFakeNow(NOW2, () => selectedPeriod()).name, 'Herfstvakantie', 'a choice that is gone is ignored');
  const between = twoC({ periods: { '2026-10-26': { ...PERIOD, lastDay: '2026-10-28' }, '2026-11-09': NEXT } });
  assert.equal(withFakeNow('2026-10-30T09:00:00+01:00', () => selectedPeriod()).name, 'Toetsweek', 'between the two: the next one');
});
test('the coordinator gets an overview card per period, each with its own button', () => {
  twoC(); const h = render(NOW2);
  assert.match(h, /id="periodOverview_2026-10-26"/); assert.match(h, /id="periodOverview_2026-11-09"/);
  assert.match(h, /id="periodMake_2026-10-26"/); assert.match(h, /id="periodMake_2026-11-09"/);
  assert.match(text(h), /Herfstvakantie · 26 – 30 okt .* Toetsweek · 9 – 13 nov/);
  assert.match(text(h), /Deadline voorbij · nog niet: Eline, Anouk, Evi.*Deadline wo 4 nov 12:00 · nog niet: Eline, Jahaimy, Anouk, Evi, Lois \+1/);
});
test('with two periods the view has a field to choose the period; with one it has not', () => {
  twoC({ roosterMode: 'period' }); const h = render(NOW2);
  assert.match(h, /<select id="periodPick"[^>]*data-periodpick="1">/); assert.match(h, /<option value="2026-10-26" selected>Herfstvakantie · 26 – 30 okt<\/option>/); assert.match(h, /<option value="2026-11-09">Toetsweek · 9 – 13 nov<\/option>/);
  assert.match(h, /data-rmode="period" class="active" aria-pressed="true">Herfstvak\.</);
  coord({ roosterMode: 'period' }); assert.doesNotMatch(render(), /periodPick/);
});
test('choosing the other period shows its dates, its explanation and the label of its button', () => {
  twoC({ roosterMode: 'period' }); render(NOW2);
  picks.pick[0].value = '2026-11-09'; withFakeNow(NOW2, () => picks.pick[0].onchange());
  assert.equal(S.periodSel, '2026-11-09'); const h = html;
  assert.match(text(h), /Tijdelijk rooster Toetsweek \(9 – 13 nov\)/); assert.match(h, /data-rmode="period" class="active" aria-pressed="true">Toetsweek</);
  assert.match(text(h), /MA 9 .* DI 10 .* WO 11 .* DO 12 .* VR 13/); assert.match(h, /data-perday="2026-11-10"/); assert.doesNotMatch(h, /data-perday="2026-10-27"/);
  assert.match(text(h), /dinsdag 10 nov|maandag 9 nov/); assert.match(h, /<option value="2026-11-09" selected>/);
});
test('choosing a period starts on its first date again', () => {
  twoC({ roosterMode: 'period', periodDay: '2026-10-29' }); render(NOW2);
  picks.pick[0].value = '2026-11-09'; withFakeNow(NOW2, () => picks.pick[0].onchange());
  assert.equal(S.periodDay, null); assert.equal(withFakeNow(NOW2, () => periodViewDay()), '2026-11-09');
});
test('a parent chooses between the two too, once both have a temporary rooster', () => {
  twoP({ periodCars: { ...madeCars, ...nextCars }, roosterMode: 'period' }); const h = render(NOW2);
  assert.match(h, /id="periodPick"/); assert.doesNotMatch(h, /data-pdrv|periodOverview/);
  twoP({ periodCars: madeCars, roosterMode: 'period' }); assert.doesNotMatch(render(NOW2), /periodPick/);
});
test('the dates of the second period come from their own handed-in times', () => {
  const e2 = { familyId: 'f2', periodFirstDay: '2026-11-09', submittedAt: 1, by: 'x', days: { '2026-11-10': { heen: '10:00', terug: '14:00' } } };
  twoC({ periodEntries: { ...entries(), '2026-11-09_f2': e2 } });
  assert.deepEqual(periodDayChanges('2026-11-10'), { changes: 1, out: 0 }); assert.deepEqual(periodDayChanges('2026-10-27'), { changes: 3, out: 0 }); assert.deepEqual(periodDayChanges('2026-11-02'), { changes: 0, out: 0 });
});
await testAsync('the button of one period makes only that period\'s rooster', async () => { await withFakeNowAsync(NOW2, async () => {
  const fake = useFakeDb(sampleDbSeed()); twoC({ roosterMode: 'week' }); render(NOW2);
  const next = picks.make.find(b => b.dataset.periodmake === '2026-11-09'); await next.onclick();
  assert.equal(Object.keys(S.periodCars).length, 10); assert.ok(Object.keys(S.periodCars).every(k => k.startsWith('2026-11-09_'))); assert.ok(fake.get('periodCars/2026-11-09_2026-11-10_heen'));
  assert.match(html, /id="periodRemake_2026-11-09"/); assert.match(html, /id="periodMake_2026-10-26"/);
}); });
await testAsync('removing the rooster of one period leaves the other one', async () => { await withFakeNowAsync(NOW2, async () => {
  const both = { ...madeCars, ...nextCars }; useFakeDb({ ...sampleDbSeed(), ...Object.fromEntries(Object.entries(both).map(([k, v]) => ['periodCars/' + k, v])) });
  twoC({ periodCars: both, roosterMode: 'week' }); render(NOW2);
  const rm = picks.remove.find(b => b.dataset.periodremove === '2026-11-09'); rm.onclick(); await settle(); rm.onclick(); await settle();
  assert.deepEqual(Object.keys(S.periodCars), ['2026-10-26_2026-10-27_terug']);
}); });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
