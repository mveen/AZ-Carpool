// Run with: node ui-matches.test.js
// The Wedstrijden tab: matches of the next 29 days, carpools for the first 8 days only, adding and removing cars.
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
import { installFakeDom, sampleParentState, resetState, useFakeDb, sampleDbSeed, withFakeNow, NOW } from './test-support.js';
import { S } from '../state.js';
import { matchCarRowHtml, matchesCardHtml, renderMatchesTab, updateMatchCarCapacityWarning, wireMatchCarpool } from '../ui-matches.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const toast = () => text(dom.doc.getElementById('toast').innerHTML);
const feeds = [{ calendarId: 'cal1', label: 'AZ O15-1' }];
// Now is Wed 30 Sep 2026 10:00. A carpool can be set up through Wed 7 Oct; matches are listed through Wed 28 Oct.
const at = iso => new Date(iso);
const home = { calendarId: 'cal1', eventId: 'e1', teamLabel: 'AZ O15-1', summary: 'AZ O15-1-Hoorn O15-2', location: 'Sportpark Hoorn', start: at('2026-10-03T10:30:00+02:00') };
const far = { calendarId: 'cal1', eventId: 'e2', teamLabel: 'AZ O15-1', summary: 'Ajax O15-1-AZ O15-1', location: 'De Toekomst', start: at('2026-10-20T12:00:00+02:00') };
const tooFar = { calendarId: 'cal1', eventId: 'e3', teamLabel: 'AZ O15-1', summary: 'AZ O15-1-Volendam O15-1', location: 'Sportpark', start: at('2026-11-07T12:00:00+01:00') };
const SLUG = 'ev_cal1__e1';
const state = (patch = {}) => sampleParentState({ matchFeeds: feeds, matches: [home], matchesSource: 'live', ...patch });

// The fake page has no real buttons: build them from the rendered html, so clicks reach the handlers the page wired up.
let picks = [];
function pageFrom(html) {
  const mk = attr => [...html.matchAll(new RegExp(`data-${attr}="([^"]+)"`, 'g'))].map(m => ({ dataset: { [attr]: m[1] }, onclick: null, textContent: '' }));
  const reg = { '[data-addmatchcar]': mk('addmatchcar'), '[data-cancelmatchcar]': mk('cancelmatchcar'), '[data-savematchcar]': mk('savematchcar'), '[data-delmatchcar]': mk('delmatchcar') };
  picks = [...html.matchAll(/class="matchCarGirlPick" value="([^"]+)"/g)].map(m => ({ value: m[1], checked: false, onchange: null }));
  reg['.matchCarGirlPick'] = picks;
  dom.doc.querySelectorAll = sel => (sel === '.matchCarGirlPick:checked' ? picks.filter(p => p.checked) : (reg[sel] || []));
  return reg;
}
const box = dom.el('tab-matches');
let boxHtml = '';
Object.defineProperty(box, 'innerHTML', { get: () => boxHtml, set: v => { boxHtml = v; pageFrom(v); }, configurable: true });
const render = () => { withFakeNow(NOW, () => renderMatchesTab()); return boxHtml; };
const reg = () => dom.doc.querySelectorAll;

console.log('=== which matches are listed ===');
test('without any match in the next 29 days the tab is empty (no message)', () => {
  state({ matches: [tooFar] });
  assert.equal(render(), '');
  state({ matches: [] }); assert.equal(render(), '');
});
test('without an account nothing is shown', () => {
  resetState({ me: null, matchFeeds: feeds, matches: [home], matchesSource: 'live' });
  assert.equal(render(), '');
});
test('matches of the next 29 days are listed in order; later ones are left out', () => {
  state({ matches: [far, home, tooFar] });
  const s = text(render());
  assert.match(s, /^Wedstrijden komende 4 weken\. /);
  assert.ok(s.indexOf('zaterdag 3 oktober') > -1 && s.indexOf('dinsdag 20 oktober') > s.indexOf('zaterdag 3 oktober'));
  assert.doesNotMatch(s, /7 november/);
});
test('a match within 8 days can get a carpool; the "set up a carpool" sentence shows only then', () => {
  state({ matches: [home] });
  const s = text(render());
  assert.match(s, /AZ O15-1 \(Thuis\) vs Hoorn O15-2 zaterdag 3 oktober · 10:30 · Sportpark Hoorn/);
  assert.match(s, /Zet een carpool op voor een wedstrijd/); assert.match(s, /Nog geen carpool ingesteld\. \+ Auto toevoegen/);
  state({ matches: [far] });
  assert.doesNotMatch(text(render()), /Zet een carpool op voor een wedstrijd/);
});
test('a later match gets a note with the first day a carpool can be set up, and no add button', () => {
  state({ matches: [far] });
  const html = render();
  assert.match(text(html), /Carpool nog niet te plannen\. Dit kan vanaf dinsdag 13 oktober\./);   // match day minus 7 days: from then on the match is inside the 8-day window
  assert.doesNotMatch(html, /data-addmatchcar/);
  assert.deepEqual(S.weekendMatchBySlug, {});                       // only plannable matches can be saved
});
test('only matches that can get a carpool are remembered for saving', () => {
  state({ matches: [home, far] }); render();
  assert.deepEqual(Object.keys(S.weekendMatchBySlug), [SLUG]);
});

console.log('\n=== cars ===');
const cars = [{ driverFamilyId: 'f1', girlIds: ['f2', 'f4'], departureTime: '09:15' }];
const carpool = { calendarId: 'cal1', eventId: 'e1', teamLabel: 'AZ O15-1', summary: home.summary, location: home.location, startMs: home.start.getTime(), cars };
test('matchCarRowHtml describes a car: departure, driver and riders; a missing driver or riders is said in words', () => {
  state();
  const s = text(matchCarRowHtml(cars[0], {}));
  assert.match(s, /09:15/); assert.match(s, /Jan Jansen/); assert.match(s, /Evi, Jahaimy/);
  assert.match(text(matchCarRowHtml({ girlIds: [] }, {})), /--:-- .*nog geen chauffeur · geen passagiers/);
});
test('more riders than seats is marked, the family that is in the car is highlighted, and the delete button only when editable', () => {
  state();
  const over = matchCarRowHtml({ driverFamilyId: 'f1', girlIds: ['f2', 'f3', 'f4', 'f5'] }, {});
  assert.match(text(over), /4\/3/);
  assert.doesNotMatch(matchCarRowHtml(cars[0], {}), /data-delmatchcar|class="matchCarRow mine"/);
  assert.match(matchCarRowHtml(cars[0], { highlightId: 'f2' }), /class="matchCarRow mine"/);
  assert.match(matchCarRowHtml(cars[0], { editable: true, slug: SLUG, idx: 0 }), /data-delmatchcar="ev_cal1__e1\|0"[^>]*title="Verwijder carpool"/);
});
test('stored cars are shown under their match, with a delete button (trash icon) for a plannable match', () => {
  state({ matchCarpools: { [SLUG]: carpool } });
  const html = render();
  assert.match(text(html), /09:15 .*Jan Jansen/); assert.match(html, /data-delmatchcar="ev_cal1__e1\|0"/);
  assert.doesNotMatch(text(html), /Nog geen carpool ingesteld/);
});
test('a stored car of a match that is still too far away is shown, but cannot be deleted', () => {
  const farDoc = { ...carpool, eventId: 'e2', startMs: far.start.getTime() };
  state({ matches: [far], matchCarpools: { ev_cal1__e2: farDoc } });
  const html = render();
  assert.match(text(html), /Jan Jansen/); assert.doesNotMatch(html, /data-delmatchcar/);
});

console.log('\n=== adding a car ===');
test('"+ Auto toevoegen" opens the form with driver, riders and a departure time 3,5 hours before kick-off', () => {
  state(); const html = render();
  reg()('[data-addmatchcar]')[0].onclick();
  assert.equal(S.openMatchCarpoolForm, SLUG);
  const form = boxHtml;
  assert.match(form, /id="matchCarDriver_ev_cal1__e1"/); assert.match(form, /id="matchCarTime_ev_cal1__e1" value="07:00"/);
  assert.equal((form.match(/class="matchCarGirlPick"/g) || []).length, Object.keys(S.families).length);
  assert.match(form, /Jan Jansen \(3 plekken\)/);
  assert.doesNotMatch(html, /matchCarDriver_/, 'the form was closed before');
});
test('Annuleren closes the form', () => {
  state(); render(); reg()('[data-addmatchcar]')[0].onclick();
  reg()('[data-cancelmatchcar]')[0].onclick();
  assert.equal(S.openMatchCarpoolForm, null); assert.doesNotMatch(boxHtml, /matchCarDriver_/);
});
test('the capacity warning counts the chosen riders and names the driver; it does not throw without a form', () => {
  state(); render(); reg()('[data-addmatchcar]')[0].onclick();
  dom.el('matchCarDriver_' + SLUG).value = 'f1';
  picks.slice(0, 4).forEach(p => { p.checked = true; });
  updateMatchCarCapacityWarning(SLUG);
  assert.equal(dom.el('matchCarCount_' + SLUG).textContent, '(4 gekozen / 3 plekken)');
  assert.match(text(dom.el('matchCarCapWarn_' + SLUG).innerHTML), /Jan Jansen/);
  picks.forEach(p => { p.checked = false; }); picks[0].checked = true;
  updateMatchCarCapacityWarning(SLUG);
  assert.equal(dom.el('matchCarCapWarn_' + SLUG).innerHTML, ''); assert.equal(dom.el('matchCarCount_' + SLUG).textContent, '(1 gekozen / 3 plekken)');
  updateMatchCarCapacityWarning('nothing');
});
const openForm = () => { render(); reg()('[data-addmatchcar]')[0].onclick(); return reg()('[data-savematchcar]')[0]; };
const setForm = (driver, time = '07:00', chosen = []) => { dom.el('matchCarDriver_' + SLUG).value = driver; dom.el('matchCarTime_' + SLUG).value = time; picks.forEach(p => { p.checked = chosen.includes(p.value); }); };
await testAsync('saving needs a driver and at least one daughter, and stores nothing otherwise', async () => {
  const fake = useFakeDb(sampleDbSeed()); state(); const save = openForm();
  setForm('', '07:00', ['f2']); await save.onclick(); assert.equal(toast(), 'Kies een chauffeur.');
  setForm('f1', '07:00', []); await save.onclick(); assert.equal(toast(), 'Kies minstens 1 dochter.');
  assert.equal(fake.get('matchCarpools/' + SLUG), undefined);
});
await testAsync('a valid car is stored on the match document, with the match details, and the form closes', async () => {
  const fake = useFakeDb(sampleDbSeed()); state(); const save = openForm();
  setForm('f1', '07:15', ['f2', 'f4']); await withFakeNow(NOW, () => save.onclick());
  const d = fake.get('matchCarpools/' + SLUG);
  assert.deepEqual(d.cars, [{ driverFamilyId: 'f1', girlIds: ['f4', 'f2'], departureTime: '07:15' }]); // riders are picked from an A-Z list
  assert.equal(d.matchSlug, SLUG); assert.equal(d.calendarId, 'cal1'); assert.equal(d.eventId, 'e1'); assert.equal(d.teamLabel, 'AZ O15-1');
  assert.equal(d.summary, home.summary); assert.equal(d.location, home.location); assert.equal(d.startMs, home.start.getTime());
  assert.equal(S.openMatchCarpoolForm, null); assert.equal(toast(), 'Carpool toegevoegd ✓');
});
await testAsync('a second car is added to the first', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), ['matchCarpools/' + SLUG]: carpool }); state({ matchCarpools: { [SLUG]: carpool } }); const save = openForm();
  setForm('f3', '07:30', ['f5']); await withFakeNow(NOW, () => save.onclick());
  assert.deepEqual(fake.get('matchCarpools/' + SLUG).cars.map(c => c.driverFamilyId), ['f1', 'f3']);
});
await testAsync('too many riders: the first tap asks for confirmation, the second saves', async () => {
  const fake = useFakeDb(sampleDbSeed()); state(); const save = openForm();
  setForm('f1', '07:00', ['f2', 'f3', 'f4', 'f5']);
  await withFakeNow(NOW, () => save.onclick());
  assert.equal(fake.get('matchCarpools/' + SLUG), undefined); assert.equal(save.textContent, 'Toch opslaan'); assert.match(toast(), /Te veel passagiers \(4\/3\)/);
  await withFakeNow(NOW, () => save.onclick());
  assert.equal(fake.get('matchCarpools/' + SLUG).cars[0].girlIds.length, 4);
});
await testAsync('a match that is not plannable (too far away, or unknown) is never stored', async () => {
  const fake = useFakeDb(sampleDbSeed()); state(); const save = openForm();
  setForm('f1', '07:00', ['f2']);
  S.weekendMatchBySlug = {};                                             // the match is not known as plannable
  await withFakeNow(NOW, () => save.onclick());
  assert.equal(fake.get('matchCarpools/' + SLUG), undefined); assert.equal(toast(), 'Kon deze wedstrijd niet vinden — herlaad de pagina.');
  dom.doc.getElementById('toast').innerHTML = '';
  S.weekendMatchBySlug = { [SLUG]: { ...home, start: far.start } };      // second safety net: known, but more than 8 days away
  await withFakeNow(NOW, () => save.onclick());
  assert.equal(fake.get('matchCarpools/' + SLUG), undefined); assert.match(toast(), /Kon deze wedstrijd niet vinden/);
});
await testAsync('a refused write is reported', async () => {
  const fake = useFakeDb(sampleDbSeed()); state(); const save = openForm(); fake.failWrites('matchCarpools/', 'permission-denied');
  setForm('f1', '07:00', ['f2']); await withFakeNow(NOW, () => save.onclick());
  assert.match(toast(), /permission-denied/);
});

console.log('\n=== removing a car ===');
await testAsync('the trash button removes that car; removing the last car deletes the match document', async () => {
  const two = { ...carpool, cars: [cars[0], { driverFamilyId: 'f3', girlIds: ['f5'], departureTime: '07:30' }] };
  const fake = useFakeDb({ ...sampleDbSeed(), ['matchCarpools/' + SLUG]: two }); state({ matchCarpools: { [SLUG]: two } });
  render(); await reg()('[data-delmatchcar]')[0].onclick();
  assert.deepEqual(fake.get('matchCarpools/' + SLUG).cars.map(c => c.driverFamilyId), ['f3']);
  S.matchCarpools = { [SLUG]: fake.get('matchCarpools/' + SLUG) };
  render(); await reg()('[data-delmatchcar]')[0].onclick();
  assert.equal(fake.get('matchCarpools/' + SLUG), undefined);
});

test('every match is its own card (matchCard) under an info line; no nested group cards any more', () => {
  const html = withFakeNow(NOW, () => { sampleParentState({ matchFeeds: [], matches: [] }); return matchesCardHtml(); });
  assert.doesNotMatch(html, /matchGroup|matchesCard/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
