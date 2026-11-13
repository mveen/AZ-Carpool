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
import { installFakeDom, sampleFamilies, sampleParentState, resetState, useFakeDb, sampleDbSeed, withFakeNow, withFakeNowAsync, NOW } from './test-support.js';
import { S } from '../state.js';
import { busCarSub, busSheetHtml, deletePractice, matchCarRowHtml, matchesCardHtml, openBusSheet, practiceSheetHtml, renderMatchesTab, savePractice, updateMatchCarCapacityWarning, wireMatchCarpool } from '../ui-matches.js';

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
  const reg = { '[data-addmatchcar]': mk('addmatchcar'), '[data-matchleg]': [...html.matchAll(/data-matchleg="([^"]+)" data-slug="([^"]+)"/g)].map(m => ({ dataset: { matchleg: m[1], slug: m[2] }, onclick: null, classList: { toggle() {} }, setAttribute() {} })), '[data-cancelmatchcar]': mk('cancelmatchcar'), '[data-savematchcar]': mk('savematchcar'), '[data-delmatchcar]': mk('delmatchcar'), '[data-iride]': mk('iride'), '[data-editmatchcar]': mk('editmatchcar'), '[data-addpractice]': mk('addpractice'), '[data-editpractice]': mk('editpractice'), '[data-delpractice]': mk('delpractice'), '[data-famdown]': mk('famdown'), '[data-famup]': mk('famup'), '[data-busswitch]': mk('busswitch'), '[data-busedit]': mk('busedit') };
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
test('without any match in the next 29 days only the info line (with the practice match button) is shown', () => {
  state({ matches: [tooFar] });
  assert.match(text(render()), /^Geen wedstrijden de komende 4 weken\./); assert.doesNotMatch(render(), /matchCard/);
  state({ matches: [] }); assert.match(text(render()), /^Geen wedstrijden de komende 4 weken\./);
});
test('without an account nothing is shown', () => {
  resetState({ me: null, matchFeeds: feeds, matches: [home], matchesSource: 'live' });
  assert.equal(render(), '');
});
test('matches of the next 29 days are listed in order; later ones are left out', () => {
  state({ matches: [far, home, tooFar] });
  const s = text(render());
  assert.match(s, /^Wedstrijden van de komende 4 weken\. /);
  assert.ok(s.indexOf('za 3 okt') > -1 && s.indexOf('di 20 okt') > s.indexOf('za 3 okt'));
  assert.doesNotMatch(s, /7 november/);
});
test('a match within 8 days can get a carpool; the "set up a carpool" sentence shows only then', () => {
  state({ matches: [home] });
  const s = text(render());
  assert.match(s, /za 3 okt.*aftrap 10:30.*AZ O15-1 \(Thuis\) vs Hoorn O15-2.*Sportpark Hoorn/);
  assert.match(s, /Een carpool kun je in de komende 8 dagen regelen/); assert.match(s, /Nog geen carpool ingesteld\. Ik rijd Auto toevoegen/);
  state({ matches: [far] });
  assert.doesNotMatch(text(render()), /in de komende 8 dagen regelen/);
  assert.doesNotMatch(render(), /data-iride/);
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
test('Opslaan (primary) and Annuleren sit together in one .formActions row', () => {
  state(); render(); reg()('[data-addmatchcar]')[0].onclick();
  assert.match(boxHtml, /<div class="formActions">\s*<button[^>]*class="btn small" data-savematchcar[^>]*>Opslaan<\/button>\s*<button[^>]*class="btn small secondary" data-cancelmatchcar/);
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
  assert.deepEqual(d.cars, [{ driverFamilyId: 'f1', girlIds: ['f4', 'f2'], departureTime: '07:15', fromId: 'busstation', fromText: '' }]); // riders are picked from an A-Z list
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
await testAsync('the trash button removes that car; removing the last car keeps the match document (cars [], so its log stays)', async () => {
  const two = { ...carpool, cars: [cars[0], { driverFamilyId: 'f3', girlIds: ['f5'], departureTime: '07:30' }] };
  const fake = useFakeDb({ ...sampleDbSeed(), ['matchCarpools/' + SLUG]: two }); state({ matchCarpools: { [SLUG]: two } });
  render(); await reg()('[data-delmatchcar]')[0].onclick();
  assert.deepEqual(fake.get('matchCarpools/' + SLUG).cars.map(c => c.driverFamilyId), ['f3']);
  S.matchCarpools = { [SLUG]: fake.get('matchCarpools/' + SLUG) };
  render(); await reg()('[data-delmatchcar]')[0].onclick();
  const d = fake.get('matchCarpools/' + SLUG);
  assert.deepEqual(d.cars, []); assert.deepEqual(d.log.map(e => [e.act, e.car.driverFamilyId]), [['del', 'f1'], ['del', 'f3']]);
  assert.equal(d.startMs, home.start.getTime());   // the match info is still there
});

test('every match is its own card (matchCard) under an info line; no nested group cards any more', () => {
  const html = withFakeNow(NOW, () => { sampleParentState({ matchFeeds: [], matches: [] }); return matchesCardHtml(); });
  assert.doesNotMatch(html, /matchGroup|matchesCard/);
});

await testAsync('Ik rijd adds the own car with the own daughter; Mijn auto weghalen removes it again', async () => {
  const fake = useFakeDb(sampleDbSeed());
  state({ me: 'u1', links: { u1: { familyId: 'f2' } } });
  render();
  assert.match(render(), /data-iride="/); assert.doesNotMatch(render(), /data-iremove/);
  await withFakeNow(NOW, () => reg()('[data-iride]')[0].onclick());
  const d = fake.get('matchCarpools/' + SLUG);
  assert.deepEqual(d.cars.map(c => [c.driverFamilyId, c.girlIds]), [['f2', ['f2']]]);
  state({ me: 'u1', links: { u1: { familyId: 'f2' } }, matchCarpools: { [SLUG]: d } });
  const html = render();
  assert.doesNotMatch(html, /data-iride/); assert.doesNotMatch(text(html), /Mijn auto weghalen/);   // the trash button is the way to remove it
  await reg()('[data-delmatchcar]')[0].onclick();
  assert.deepEqual(fake.get('matchCarpools/' + SLUG).cars, []); assert.equal(toast(), 'Auto weggehaald Ongedaan');
});

console.log('\n=== editing a car ===');
const twoCars = { ...carpool, cars: [{ driverFamilyId: 'f1', girlIds: ['f1'], departureTime: '09:15' }, { driverFamilyId: 'f3', girlIds: ['f5'], departureTime: '07:30' }] };
test('every car of a plannable match has a pencil button, for everyone; a too-far match has none', () => {
  state({ matchCarpools: { [SLUG]: twoCars } });
  const html = render();
  assert.match(html, /data-editmatchcar="ev_cal1__e1\|0"/); assert.match(html, /data-editmatchcar="ev_cal1__e1\|1"/);
  assert.match(html, /aria-label="Carpool van Kees de Vries wijzigen"/);
  state({ matches: [far], matchCarpools: { ev_cal1__e2: { ...twoCars, eventId: 'e2', startMs: far.start.getTime() } } });
  assert.doesNotMatch(render(), /data-editmatchcar/);
});
test('the pencil opens the form filled in with that car (driver, riders, time)', () => {
  state({ matchCarpools: { [SLUG]: twoCars } }); render();
  reg()('[data-editmatchcar]')[1].onclick();
  assert.equal(S.editMatchCarIdx, 1);
  assert.match(boxHtml, /<option value="f3" selected>/); assert.match(boxHtml, /id="matchCarTime_ev_cal1__e1" value="07:30"/);
  assert.deepEqual(picks.map(p => p.value).filter(v => new RegExp(`value="${v}" checked`).test(boxHtml)), ['f5']);
});
await testAsync('saving an edit replaces only that car (also for someone who is not the driver) and says so', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), ['matchCarpools/' + SLUG]: twoCars }); state({ matchCarpools: { [SLUG]: twoCars } }); render();
  reg()('[data-editmatchcar]')[1].onclick();
  setForm('f3', '07:45', ['f5', 'f4']); await withFakeNow(NOW, () => reg()('[data-savematchcar]')[0].onclick());
  const d = fake.get('matchCarpools/' + SLUG);
  assert.equal(d.cars.length, 2); assert.deepEqual(d.cars[0], twoCars.cars[0]);
  assert.deepEqual(d.cars[1], { driverFamilyId: 'f3', girlIds: ['f4', 'f5'], departureTime: '07:45', fromId: 'busstation', fromText: '' });
  assert.equal(S.openMatchCarpoolForm, null); assert.equal(S.editMatchCarIdx, null); assert.equal(toast(), 'Carpool bijgewerkt ✓');
});
await testAsync('saving an edit closes the form, and tapping Opslaan twice never makes a second car', async () => {
  const one = { ...carpool, cars: [cars[0]] };
  const fake = useFakeDb({ ...sampleDbSeed(), ['matchCarpools/' + SLUG]: one }); state({ matchCarpools: { [SLUG]: one } }); render();
  reg()('[data-editmatchcar]')[0].onclick();
  setForm('f1', '07:00', ['f2', 'f4']);
  const save = reg()('[data-savematchcar]')[0];
  const first = withFakeNow(NOW, () => save.onclick()); const second = withFakeNow(NOW, () => save.onclick());   // two quick taps
  await Promise.all([first, second]);
  assert.equal(fake.get('matchCarpools/' + SLUG).cars.length, 1);
  assert.doesNotMatch(boxHtml, /matchCarDriver_/);                                                                // form is gone
  assert.equal(S.openMatchCarpoolForm, null);
});
await testAsync('a quick double tap on "Ik rijd" adds the car once', async () => {
  const fake = useFakeDb(sampleDbSeed()); state(); render();
  const btn = reg()('[data-iride]')[0];
  await Promise.all([withFakeNow(NOW, () => btn.onclick()), withFakeNow(NOW, () => btn.onclick())]);
  assert.equal(fake.get('matchCarpools/' + SLUG).cars.length, 1);
});
await testAsync('editing a car that has been removed meanwhile stores nothing', async () => {
  const fake = useFakeDb(sampleDbSeed()); state(); render();
  reg()('[data-addmatchcar]')[0].onclick(); S.editMatchCarIdx = 3;
  setForm('f1', '07:00', ['f2']); await withFakeNow(NOW, () => reg()('[data-savematchcar]')[0].onclick());
  assert.equal(fake.get('matchCarpools/' + SLUG), undefined); assert.match(toast(), /Kon deze wedstrijd niet vinden/);
});
test('Auto toevoegen after an edit starts with an empty form again', () => {
  state({ matchCarpools: { [SLUG]: twoCars } }); render();
  reg()('[data-editmatchcar]')[0].onclick(); reg()('[data-cancelmatchcar]')[0].onclick();
  assert.equal(S.editMatchCarIdx, null);
  reg()('[data-addmatchcar]')[0].onclick();
  assert.doesNotMatch(boxHtml, / checked/);
});
test('riders are listed regular players A-Z first, then Flex players A-Z', () => {
  const fams = sampleFamilies();
  fams.f1.familyType = 'flex'; fams.f4.familyType = 'flex';   // Eline and Evi
  state({ families: fams }); render(); reg()('[data-addmatchcar]')[0].onclick();
  assert.deepEqual(picks.map(p => fams[p.value].girlName), ['Anouk', 'Jahaimy', 'Lois', 'Saar', 'Eline', 'Evi']);
});

console.log('\n=== one row of buttons, "vertrek vanaf" ===');
test('"Ik rijd" and "Auto toevoegen" sit together in one .matchActions row; Ik rijd only while the own car is not in', () => {
  state(); const html = render();
  assert.match(html, /<div class="matchActions"><button[^>]*data-iride="[^"]+"[^>]*>[\s\S]*?<\/button><button[^>]*data-addmatchcar="[^"]+"[^>]*>[\s\S]*?<\/button><\/div>/);
  assert.match(text(html), /Ik rijd Auto toevoegen/);
  state({ matchCarpools: { [SLUG]: { ...carpool, cars: [{ driverFamilyId: 'f2', girlIds: ['f2'], departureTime: '09:15' }] } } });
  const h2 = render(); assert.doesNotMatch(h2, /data-iride/); assert.match(h2, /<div class="matchActions"><button[^>]*data-addmatchcar/);
});
test('while the form is open the button row is hidden', () => {
  state(); render(); reg()('[data-addmatchcar]')[0].onclick();
  assert.doesNotMatch(boxHtml, /matchActions/); assert.match(boxHtml, /matchCarDriver_/);
});
test('every car shows where it leaves from: Busstation by default, a chosen place, or a free input (escaped)', () => {
  state();
  assert.match(text(matchCarRowHtml(cars[0], {})), /Vertrek vanaf Busstation/);
  assert.match(text(matchCarRowHtml({ ...cars[0], fromId: 'ATC' }, {})), /Vertrek vanaf ATC/);
  const free = matchCarRowHtml({ ...cars[0], fromId: '', fromText: 'Zwaag <b>12</b>' }, {});
  assert.match(free, /Zwaag &lt;b&gt;12&lt;\/b&gt;/); assert.doesNotMatch(free, /<b>/);
});
test('the form has "Vertrek vanaf" with all known places and "Andere locatie…"; the text field stays hidden until that is chosen', () => {
  state(); render(); reg()('[data-addmatchcar]')[0].onclick();
  const sel = boxHtml.match(/<select id="matchCarFrom_ev_cal1__e1">([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...sel.matchAll(/>([^<]+)<\/option>/g)].map(x => x[1].replace(/&#39;/g, "'")), ['Busstation', 'A4-De Hoek', 'De Parel', "AFC '34", 'ATC', 'Andere locatie…']);
  assert.match(sel, /<option value="busstation" selected>/);
  assert.match(boxHtml, /id="matchCarFromTxt_ev_cal1__e1"[^>]* hidden>/);
});
const setFrom = (id, txt = '') => { dom.el('matchCarFrom_' + SLUG).value = id; dom.el('matchCarFromTxt_' + SLUG).value = txt; };
await testAsync('a car leaves from Busstation unless another place is chosen; the choice is stored on the car', async () => {
  const fake = useFakeDb(sampleDbSeed()); state(); let save = openForm();
  setForm('f1', '07:15', ['f2']); setFrom('busstation'); await withFakeNow(NOW, () => save.onclick());
  assert.deepEqual(fake.get('matchCarpools/' + SLUG).cars[0], { driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '07:15', fromId: 'busstation', fromText: '' });
  S.matchCarpools = { [SLUG]: fake.get('matchCarpools/' + SLUG) };   // the app would have read it back from the database
  save = openForm(); setForm('f3', '07:30', ['f5']); setFrom('ATC'); await withFakeNow(NOW, () => save.onclick());
  assert.deepEqual(fake.get('matchCarpools/' + SLUG).cars[1], { driverFamilyId: 'f3', girlIds: ['f5'], departureTime: '07:30', fromId: 'ATC', fromText: '' });
});
await testAsync('"Andere locatie" stores the free text (and no place id); without text nothing is stored', async () => {
  const fake = useFakeDb(sampleDbSeed()); state(); const save = openForm();
  setForm('f1', '07:15', ['f2']); setFrom('__other', '   '); await withFakeNow(NOW, () => save.onclick());
  assert.equal(fake.get('matchCarpools/' + SLUG), undefined); assert.equal(toast(), 'Vul de plek in waar de auto vertrekt.');
  setFrom('__other', ' Zwaag, Dorpsstraat 12 '); await withFakeNow(NOW, () => save.onclick());
  assert.deepEqual(fake.get('matchCarpools/' + SLUG).cars[0], { driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '07:15', fromId: '', fromText: 'Zwaag, Dorpsstraat 12' });
});
test('editing a car starts with its place; a free input opens the text field', () => {
  const doc = { ...carpool, cars: [{ ...cars[0], fromId: '', fromText: 'Zwaag' }, { ...cars[0], fromId: 'ATC' }] };
  state({ matchCarpools: { [SLUG]: doc } }); render(); reg()('[data-editmatchcar]')[0].onclick();
  assert.match(boxHtml, /<option value="__other" selected>/); assert.match(boxHtml, /id="matchCarFromTxt_ev_cal1__e1"[^>]*value="Zwaag"(?![^>]* hidden)/);
  reg()('[data-editmatchcar]')[1].onclick(); assert.match(boxHtml, /<option value="ATC" selected>/);
});
await testAsync('Ik rijd leaves from Busstation', async () => {
  const fake = useFakeDb(sampleDbSeed()); state(); render();
  await withFakeNow(NOW, () => reg()('[data-iride]')[0].onclick());
  const c = fake.get('matchCarpools/' + SLUG).cars[0]; assert.equal(c.fromId, 'busstation'); assert.equal(c.fromText, ''); assert.equal(c.driverFamilyId, 'f2');
});

console.log('\n=== practice matches ===');
const CAL = 'cal1';
const pdoc = (over = {}) => ({ calendarId: CAL, teamLabel: 'AZ O15-1', opponent: 'FC Volendam O15', isHome: true, location: "AFC '34, Alkmaar", startMs: at('2026-10-02T19:00:00+02:00').getTime(), createdAt: 1, ...over });
const PSLUG = 'ev_cal1__practice_p1';
test('the info line has the "Oefenwedstrijd" button, also when there is no match at all', () => {
  state({ matches: [home] }); assert.match(render(), /<button[^>]*data-addpractice="1"[^>]*>[\s\S]*?Oefenwedstrijd<\/button>/);
  state({ matches: [] }); const s = render();
  assert.match(text(s), /Geen wedstrijden de komende 4 weken\. Oefenwedstrijd/); assert.match(s, /data-addpractice/);
});
test('a practice match is listed with the Oefen tag, a pencil and a trash button; calendar matches have neither', () => {
  state({ practiceMatches: { p1: pdoc() } }); const html = render();
  assert.match(text(html), /vr 2 okt Oefen aftrap 19:00 AZ O15-1 \(Thuis\) vs FC Volendam O15 AFC '34, Alkmaar/);
  assert.match(html, /data-editpractice="p1"/); assert.match(html, /data-delpractice="p1"/);
  assert.equal((html.match(/data-delpractice/g) || []).length, 1); assert.equal((html.match(/data-addmatchcar="[^"]*\|heen"/g) || []).length, 2);   // one Heen button per match
  assert.match(html, /<div class="matchCard__top">[\s\S]*?class="matchTools"/);
});
test('practice and calendar matches are listed together in order of date', () => {
  state({ practiceMatches: { p1: pdoc({ startMs: at('2026-10-02T19:00:00+02:00').getTime() }) } });
  const s = text(render()); assert.ok(s.indexOf('vr 2 okt') > -1 && s.indexOf('vr 2 okt') < s.indexOf('za 3 okt'));
});
test('a practice match gets a carpool like any match (its own carpool id), and an away one is called Uit', () => {
  state({ practiceMatches: { p1: pdoc({ isHome: false, opponent: 'SV Hoogland', location: 'Sportpark De Hoef, Hoogland' }) } }); render();
  assert.ok(S.weekendMatchBySlug[PSLUG]); assert.match(text(boxHtml), /AZ O15-1 \(Uit\) vs SV Hoogland Sportpark De Hoef, Hoogland/);
  reg()('[data-addmatchcar]')[0].onclick(); assert.equal(S.openMatchCarpoolForm, PSLUG);
});
await testAsync('a car for a practice match is stored under the practice carpool, with the match details and where it leaves from', async () => {
  const fake = useFakeDb(sampleDbSeed()); state({ practiceMatches: { p1: pdoc() } }); render();
  reg()('[data-addmatchcar]')[0].onclick();
  dom.el('matchCarDriver_' + PSLUG).value = 'f1'; dom.el('matchCarTime_' + PSLUG).value = '17:30'; dom.el('matchCarFrom_' + PSLUG).value = 'busstation'; picks.forEach(p => { p.checked = p.value === 'f2'; });
  await withFakeNow(NOW, () => reg()('[data-savematchcar]')[0].onclick());
  const d = fake.get('matchCarpools/' + PSLUG);
  assert.equal(d.eventId, 'practice_p1'); assert.equal(d.teamLabel, 'AZ O15-1'); assert.equal(d.location, "AFC '34, Alkmaar"); assert.equal(d.startMs, pdoc().startMs);
  assert.equal(d.cars[0].fromId, 'busstation'); assert.match(d.summary, /^AZ O15-1-.FC Volendam O15$/);
});

console.log('\n=== practice match sheet ===');
test('the sheet has team (from Beheer), opponent, thuis/uit, location, date and kick-off; Thuis offers the fixed locations', () => {
  state(); const h = practiceSheetHtml(null);
  assert.match(text(h), /Oefenwedstrijd toevoegen/); assert.match(h, /<option value="cal1" selected>AZ O15-1<\/option>/);
  assert.match(h, /id="practiceOpp"/); assert.match(h, /data-practicehome="1" class="active"/); assert.match(h, /type="date" id="practiceDate" value=""/); assert.match(h, /type="time" id="practiceTime" value=""/);
  const sel = h.match(/<select id="practiceLocSel"[^>]*>([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...sel.matchAll(/>([^<]+)<\/option>/g)].map(x => x[1].replace(/&#39;/g, "'")), ["AFC '34, Alkmaar", 'AZ Trainingscomplex, Wijdewormer', 'Andere locatie…']);
  assert.match(h, /id="practiceLocTxt"[^>]* hidden>/); assert.doesNotMatch(h, /id="practiceLocSel" hidden/);
  assert.doesNotMatch(h, /[^-]style="/, 'no inline styles');
});
test('the sheet never hard-codes team names: one option per calendar of Beheer', () => {
  state({ matchFeeds: [{ calendarId: 'a', label: 'Team <A>' }, { calendarId: 'b', label: 'Team B' }] });
  const opts = [...practiceSheetHtml(null).matchAll(/<option value="([ab])"[^>]*>([^<]+)</g)].map(x => x[1] + x[2]);
  assert.deepEqual(opts, ['aTeam &lt;A&gt;', 'bTeam B']);
});
test('without any team the sheet explains where teams are added and has no form', () => {
  state({ matchFeeds: [] }); const h = practiceSheetHtml(null);
  assert.match(text(h), /Er zijn nog geen teams\. De coördinator voegt ze toe in Beheer/); assert.doesNotMatch(h, /practiceSave/);
});
test('changing starts with the stored values: an away match shows its free location text, a home match at ATC selects ATC', () => {
  state({ practiceMatches: { away: pdoc({ isHome: false, opponent: 'SV Hoogland', location: 'Sportpark De Hoef' }), atc: pdoc({ location: 'AZ Trainingscomplex, Wijdewormer' }), own: pdoc({ location: 'Sportpark Oost' }) } });
  const a = practiceSheetHtml('away'); assert.match(text(a), /Oefenwedstrijd wijzigen/); assert.match(a, /value="SV Hoogland"/); assert.match(a, /data-practicehome="0" class="active"/);
  assert.match(a, /id="practiceLocTxt"[^>]*value="Sportpark De Hoef"(?![^>]* hidden)/); assert.match(a, /id="practiceLocSel" hidden/);
  assert.match(a, /value="2026-10-02"/); assert.match(a, /value="19:00"/);
  assert.match(practiceSheetHtml('atc'), /<option value="ATC" selected>/);
  const o = practiceSheetHtml('own'); assert.match(o, /<option value="__other" selected>/); assert.match(o, /id="practiceLocTxt"[^>]*value="Sportpark Oost"(?![^>]* hidden)/);
});
test('HTML in the stored opponent is escaped', () => {
  state({ practiceMatches: { p1: pdoc({ opponent: '"><img onerror=x>' }) } });
  assert.doesNotMatch(practiceSheetHtml('p1'), /<img onerror/); assert.doesNotMatch(render(), /<img onerror/);
});

console.log('\n=== saving and removing a practice match ===');
const pinput = (over = {}) => ({ calendarId: CAL, opponent: 'FC Volendam O15', isHome: true, location: "AFC '34, Alkmaar", date: '2026-10-02', time: '19:00', ...over });
await testAsync('a valid practice match is stored (new id each time), a wrong one is refused with the fields that are wrong', async () => {
  const fake = useFakeDb(sampleDbSeed()); state();
  const bad = await withFakeNowAsync(NOW, () => savePractice(pinput({ opponent: '', date: '2026-09-01' }), null));
  assert.deepEqual(bad, { ok: false, errors: { opponent: true, date: true } }); assert.deepEqual(fake.collection('practiceMatches'), []);
  const r = await withFakeNowAsync(NOW, () => savePractice(pinput(), null));
  assert.equal(r.ok, true); assert.equal(r.old, null); assert.equal(r.beyond, false); assert.match(r.id, /^pm/);
  const d = fake.get('practiceMatches/' + r.id);
  assert.deepEqual({ ...d, createdAt: 0 }, { calendarId: CAL, teamLabel: 'AZ O15-1', opponent: 'FC Volendam O15', isHome: true, location: "AFC '34, Alkmaar", startMs: pdoc().startMs, createdAt: 0 });
  assert.equal(r.slug, 'ev_cal1__practice_' + r.id);
  const r2 = await withFakeNowAsync(NOW, () => savePractice(pinput(), null)); assert.notEqual(r2.id, r.id);
});
await testAsync('a practice match that is more than 4 weeks away is stored and says it is not in the list yet', async () => {
  useFakeDb(sampleDbSeed()); state();
  const r = await withFakeNowAsync(NOW, () => savePractice(pinput({ date: '2026-12-05' }), null)); assert.equal(r.ok, true); assert.equal(r.beyond, true);
});
await testAsync('changing a practice match keeps its id and creation time, and the carpool follows (date, place, name)', async () => {
  const cp = { matchSlug: PSLUG, calendarId: CAL, eventId: 'practice_p1', teamLabel: 'AZ O15-1', summary: 'x', location: 'oud', startMs: 1, cars: [{ driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '17:30', fromId: 'ATC', fromText: '' }] };
  const fake = useFakeDb({ ...sampleDbSeed(), 'practiceMatches/p1': pdoc(), ['matchCarpools/' + PSLUG]: cp }); state({ practiceMatches: { p1: pdoc() }, matchCarpools: { [PSLUG]: cp } });
  const r = await withFakeNowAsync(NOW, () => savePractice(pinput({ opponent: 'Ajax O15', isHome: false, location: 'De Toekomst', time: '20:00' }), 'p1'));
  assert.equal(r.ok, true); assert.equal(r.id, 'p1'); assert.deepEqual(r.old, pdoc()); assert.deepEqual(r.oldCarpool, cp);
  const d = fake.get('practiceMatches/p1'); assert.equal(d.opponent, 'Ajax O15'); assert.equal(d.isHome, false); assert.equal(d.createdAt, 1); assert.equal(d.startMs, at('2026-10-02T20:00:00+02:00').getTime());
  assert.equal(fake.collection('practiceMatches').length, 1);
  const c = fake.get('matchCarpools/' + PSLUG); assert.equal(c.location, 'De Toekomst'); assert.equal(c.startMs, d.startMs); assert.match(c.summary, /Ajax O15-.AZ O15-1$/); assert.deepEqual(c.cars, cp.cars);
});
await testAsync('removing a practice match removes its carpool too, and hands back what is needed to put both back', async () => {
  const cp = { cars: [{ driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '17:30' }], startMs: pdoc().startMs };
  const fake = useFakeDb({ ...sampleDbSeed(), 'practiceMatches/p1': pdoc(), ['matchCarpools/' + PSLUG]: cp, 'practiceMatches/p2': pdoc() });
  state({ practiceMatches: { p1: pdoc(), p2: pdoc() }, matchCarpools: { [PSLUG]: cp } });
  const r = await deletePractice('p1');
  assert.deepEqual(fake.collection('practiceMatches').map(e => e[0]), ['p2']); assert.equal(fake.get('matchCarpools/' + PSLUG), undefined);
  assert.deepEqual(r, { id: 'p1', old: pdoc(), slug: PSLUG, cp });
  assert.equal(await deletePractice('weg'), null);
});
await testAsync('the trash button removes it and says so (with Ongedaan)', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'practiceMatches/p1': pdoc() }); state({ practiceMatches: { p1: pdoc() } }); render();
  await reg()('[data-delpractice]')[0].onclick();
  assert.deepEqual(fake.collection('practiceMatches'), []); assert.match(toast(), /Oefenwedstrijd verwijderd/);
});

console.log('\n=== gezinsleden rijden mee ===');
const famPage = () => {
  // The fake page has no real buttons: hand the stepper buttons to the wiring through querySelector.
  const r = reg();
  dom.doc.querySelector = sel => { const m = sel.match(/^\[data-(famdown|famup)=/); return m ? (r('[data-' + m[1] + ']') || [])[0] || null : null; };
  return r;
};
const famBtn = (r, which) => r(`[data-${which}]`)[0];
test('the form has a stepper "Rijden er gezinsleden mee?" at 0, plus a line with the free seats once a driver is known', () => {
  state(); render(); reg()('[data-addmatchcar]')[0].onclick();
  assert.match(boxHtml, /class="panel panel--row stepperCard"/); assert.match(text(boxHtml), /Rijden er al anderen mee\? Gezinsleden en andere toeschouwers die ook plek innemen in de auto/);
  assert.match(boxHtml, /id="matchCarFamily_ev_cal1__e1" value="0"/); assert.match(boxHtml, /data-famdown="ev_cal1__e1"[^>]*aria-label="Eén meerijder minder"/); assert.match(boxHtml, /data-famup="ev_cal1__e1"[^>]*aria-label="Eén meerijder meer"/);
  const stepper = boxHtml.slice(boxHtml.indexOf('stepperCard'), boxHtml.indexOf('matchCarFree_')).replace(/<svg[\s\S]*?<\/svg>/g, '');
  assert.ok(stepper.length > 200); assert.doesNotMatch(stepper, /style="/, 'no inline styles in the new stepper (the icon svg is the shared phIcon)');
});
test('+ and - change the number of family members; the free seats and the limit follow; never below 0, and one seat stays for a player', () => {
  state(); render(); reg()('[data-addmatchcar]')[0].onclick();
  const r = famPage(); wireMatchCarpool();
  dom.el('matchCarDriver_' + SLUG).value = 'f1';   // 3 passenger seats
  famBtn(r, 'famdown').onclick(); assert.equal(dom.el('matchCarFamily_' + SLUG).value, '0');
  famBtn(r, 'famup').onclick(); famBtn(r, 'famup').onclick();
  assert.equal(dom.el('matchCarFamily_' + SLUG).value, '2'); assert.equal(dom.el('matchCarFamilyValue_' + SLUG).textContent, '2');
  assert.equal(dom.el('matchCarFree_' + SLUG).textContent, '1 plek vrij voor speelsters');
  famBtn(r, 'famup').onclick(); famBtn(r, 'famup').onclick();
  assert.equal(dom.el('matchCarFamily_' + SLUG).value, '2', 'a 3-seat car keeps at least one seat for a player');
  famBtn(r, 'famdown').onclick(); assert.equal(dom.el('matchCarFree_' + SLUG).textContent, '2 plekken vrij voor speelsters');
});
test('the capacity warning uses the seats left for players', () => {
  state(); render(); reg()('[data-addmatchcar]')[0].onclick();
  dom.el('matchCarDriver_' + SLUG).value = 'f1'; dom.el('matchCarFamily_' + SLUG).value = '2';
  picks.slice(0, 2).forEach(p => { p.checked = true; });
  updateMatchCarCapacityWarning(SLUG);
  assert.equal(dom.el('matchCarCount_' + SLUG).textContent, '(2 gekozen / 1 plek)');
  assert.match(text(dom.el('matchCarCapWarn_' + SLUG).innerHTML), /Jan Jansen heeft 1 passagiersplek, maar je hebt 2/);
});
test('a stored car shows "+2 gezin" and counts only the seats left for players; a car without family looks as before', () => {
  state();
  const withFam = { ...cars[0], familyCount: 2 };
  const s = text(matchCarRowHtml(withFam, {}));
  assert.match(s, /\+2 gezin/); assert.match(s, /2\/1/, 'two riders in a car with one player seat is flagged');
  const one = text(matchCarRowHtml({ ...cars[0], girlIds: ['f2'], familyCount: 2 }, {}));
  assert.match(one, /1\/1.*\+2 gezin/);
  assert.doesNotMatch(text(matchCarRowHtml(cars[0], {})), /gezin/); assert.match(text(matchCarRowHtml(cars[0], {})), /2\/3/);
});
await testAsync('saving stores familyCount on the car only when family rides along; cars without family stay exactly as before', async () => {
  const fake = useFakeDb(sampleDbSeed()); state(); const save = openForm();
  setForm('f1', '07:15', ['f2']); dom.el('matchCarFamily_' + SLUG).value = '2'; dom.el('matchCarFrom_' + SLUG).value = 'busstation'; dom.el('matchCarFromTxt_' + SLUG).value = '';
  await withFakeNow(NOW, () => save.onclick());
  assert.deepEqual(fake.get('matchCarpools/' + SLUG).cars, [{ driverFamilyId: 'f1', girlIds: ['f2'], familyCount: 2, departureTime: '07:15', fromId: 'busstation', fromText: '' }]);
});
await testAsync('too many riders for the seats left (family counted) asks for confirmation first', async () => {
  const fake = useFakeDb(sampleDbSeed()); state(); const save = openForm();
  setForm('f1', '07:00', ['f2', 'f4']); dom.el('matchCarFamily_' + SLUG).value = '2';
  await withFakeNow(NOW, () => save.onclick());
  assert.equal(fake.get('matchCarpools/' + SLUG), undefined); assert.match(toast(), /Te veel passagiers \(2\/1\)/);
});
await testAsync('editing a car with family fills the stepper, and setting it back to 0 resets the field', async () => {
  const withFam = { ...carpool, cars: [{ ...cars[0], girlIds: ['f2'], familyCount: 2 }] };
  const fake = useFakeDb({ ...sampleDbSeed(), ['matchCarpools/' + SLUG]: withFam }); state({ matchCarpools: { [SLUG]: withFam } }); render();
  reg()('[data-editmatchcar]')[0].onclick();
  assert.match(boxHtml, /id="matchCarFamily_ev_cal1__e1" value="2"/); assert.match(boxHtml, /id="matchCarFamilyValue_ev_cal1__e1">2</);
  setForm('f1', '09:15', ['f2']); dom.el('matchCarFamily_' + SLUG).value = '0';
  await withFakeNow(NOW, () => reg()('[data-savematchcar]')[0].onclick());
  assert.equal(fake.get('matchCarpools/' + SLUG).cars[0].familyCount, 0);
});
await testAsync('editing an old car without the field does not add it', async () => {
  const one = { ...carpool, cars: [cars[0]] };
  const fake = useFakeDb({ ...sampleDbSeed(), ['matchCarpools/' + SLUG]: one }); state({ matchCarpools: { [SLUG]: one } }); render();
  reg()('[data-editmatchcar]')[0].onclick();
  setForm('f1', '09:30', ['f2']); await withFakeNow(NOW, () => reg()('[data-savematchcar]')[0].onclick());
  assert.equal('familyCount' in fake.get('matchCarpools/' + SLUG).cars[0], false);
});

console.log('\n=== safe storing and the change log (match-cars.js) ===');
const coordState = (patch = {}) => state({ me: 'coord', coordinatorConfig: { uid: 'coord' }, links: { coord: { familyId: 'f1' } }, ...patch });
await testAsync('two parents saving at the same time: both cars end up in the document (the second save runs again on the fresh state)', async () => {
  const fake = useFakeDb(sampleDbSeed()); state(); const save = openForm();
  setForm('f1', '07:00', ['f2']);
  // while this save is under way somebody else stores a car of their own
  const other = { ...carpool, matchSlug: SLUG, cars: [{ driverFamilyId: 'f3', girlIds: ['f5'], departureTime: '08:00' }] };
  fake.interfereNextTransaction('matchCarpools/' + SLUG, other);
  await withFakeNow(NOW, () => save.onclick());
  assert.deepEqual(fake.get('matchCarpools/' + SLUG).cars.map(c => c.driverFamilyId).sort(), ['f1', 'f3']);
});
await testAsync('an edit is matched on the car as it was shown: when somebody removed it meanwhile, nothing is stored and the person is told', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), ['matchCarpools/' + SLUG]: twoCars }); state({ matchCarpools: { [SLUG]: twoCars } }); render();
  reg()('[data-editmatchcar]')[1].onclick();   // the car of f3
  const gone = { ...twoCars, cars: [twoCars.cars[0]] };
  fake.interfereNextTransaction('matchCarpools/' + SLUG, gone);   // somebody removes it while we save
  setForm('f3', '06:45', ['f5']); await withFakeNow(NOW, () => reg()('[data-savematchcar]')[0].onclick());
  assert.deepEqual(fake.get('matchCarpools/' + SLUG).cars.map(c => c.driverFamilyId), ['f1']);
  assert.match(toast(), /intussen door iemand anders gewijzigd of weggehaald/);
  assert.equal(S.editMatchCarBefore, null);
});
await testAsync('the form edits the car that was tapped, even when the list changes position while it is open', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), ['matchCarpools/' + SLUG]: twoCars }); state({ matchCarpools: { [SLUG]: twoCars } }); render();
  reg()('[data-editmatchcar]')[1].onclick();   // f3, second in the list
  S.matchCarpools = { [SLUG]: { ...twoCars, cars: [twoCars.cars[1], twoCars.cars[0]] } };   // somebody else's change reorders the list
  fake.store.set('matchCarpools/' + SLUG, JSON.parse(JSON.stringify(S.matchCarpools[SLUG])));
  const html = render(); assert.match(html, /value="f3" selected/);   // still the car of f3 in the form
  setForm('f3', '06:15', ['f5']); await withFakeNow(NOW, () => reg()('[data-savematchcar]')[0].onclick());
  const d = fake.get('matchCarpools/' + SLUG);
  assert.deepEqual(d.cars.map(c => [c.driverFamilyId, c.departureTime]).sort(), [['f1', '09:15'], ['f3', '06:15']]);
});
await testAsync('add, edit and remove each leave a log entry with the family that did it', async () => {
  const fake = useFakeDb(sampleDbSeed()); state({ me: 'u1', links: { u1: { familyId: 'f2' } } });
  render(); await withFakeNow(NOW, () => reg()('[data-iride]')[0].onclick());
  S.matchCarpools = { [SLUG]: fake.get('matchCarpools/' + SLUG) }; render();
  reg()('[data-editmatchcar]')[0].onclick(); setForm('f2', '08:15', ['f2']);
  await withFakeNow(NOW, () => reg()('[data-savematchcar]')[0].onclick());
  S.matchCarpools = { [SLUG]: fake.get('matchCarpools/' + SLUG) }; render();
  await reg()('[data-delmatchcar]')[0].onclick();
  const log = fake.get('matchCarpools/' + SLUG).log;
  assert.deepEqual(log.map(e => [e.act, e.by]), [['add', 'f2'], ['edit', 'f2'], ['del', 'f2']]);
  assert.equal(log[1].to.departureTime, '08:15'); assert.equal(typeof log[0].at, 'number');
});
await testAsync('Ongedaan puts the removed car back (as one more change) and logs it', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), ['matchCarpools/' + SLUG]: twoCars }); state({ matchCarpools: { [SLUG]: twoCars } }); render();
  await reg()('[data-delmatchcar]')[1].onclick();
  assert.deepEqual(fake.get('matchCarpools/' + SLUG).cars.map(c => c.driverFamilyId), ['f1']);
  // meanwhile somebody adds another car: undoing must not wipe it
  const mid = fake.get('matchCarpools/' + SLUG); mid.cars.push({ driverFamilyId: 'f4', girlIds: ['f4'], departureTime: '10:00' }); fake.store.set('matchCarpools/' + SLUG, mid);
  assert.equal(toast(), 'Auto weggehaald Ongedaan');
  // what the Ongedaan button does: one more change on the fresh document (the car of f4 added meanwhile stays)
  const { changeMatchCar } = await import('../match-cars.js');
  await changeMatchCar({ info: { startMs: 1 }, slug: SLUG, fromId: SLUG, change: { act: 'add', car: twoCars.cars[1], undo: true }, by: 'f1' });
  const d = fake.get('matchCarpools/' + SLUG);
  assert.deepEqual(d.cars.map(c => c.driverFamilyId).sort(), ['f1', 'f3', 'f4']); assert.deepEqual(d.log.map(e => e.act), ['del', 'undo']);
});
test('only the coordinator sees the log, newest first, with names and times', () => {
  const log = [{ at: new Date('2026-10-01T19:41:00+02:00').getTime(), by: 'f3', act: 'add', car: { driverFamilyId: 'f3', departureTime: '22:00', girlIds: ['f5'] } },
    { at: new Date('2026-10-01T20:05:00+02:00').getTime(), by: 'f1', act: 'del', car: { driverFamilyId: 'f3', departureTime: '22:00', girlIds: ['f5'] } }];
  const doc = { ...carpool, cars, log };
  state({ matchCarpools: { [SLUG]: doc } }); assert.doesNotMatch(render(), /matchLog/);   // a parent
  coordState({ viewAsParent: true, matchCarpools: { [SLUG]: doc } }); assert.doesNotMatch(render(), /matchLog/);   // the coordinator looking as a parent (Bekijk als ouder)
  coordState({ matchCarpools: { [SLUG]: doc } });
  const s = text(render());
  assert.match(s, /Wijzigingen aan deze carpool/);
  assert.match(s, /Jan Jansen haalde een auto weg: Kees de Vries 22:00 \(Lois\)/);
  assert.ok(s.indexOf('haalde een auto weg') < s.indexOf('voegde een auto toe'));   // newest first
  coordState({ matchCarpools: { [SLUG]: { ...carpool, log: [null, { at: 'x' }, { at: 1 }] } } }); assert.doesNotMatch(render(), /matchLog/);   // malformed entries are ignored
});
await testAsync('changing a practice match leaves the cars alone (the match info follows on the fresh document)', async () => {
  const slugP = 'x';
  const fake = useFakeDb(sampleDbSeed());
  state({ matches: [] });
  const input = { calendarId: 'cal1', opponent: 'Test FC', isHome: true, location: 'afc34', date: '2026-10-04', time: '11:00' };
  const r = await withFakeNowAsync(NOW, () => savePractice(input, null));
  assert.ok(r.ok, JSON.stringify(r));
  const k = 'matchCarpools/' + r.slug;
  fake.store.set(k, { matchSlug: r.slug, startMs: 1, cars: [{ driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '09:00' }] });
  S.practiceMatches = { [r.id]: fake.get('practiceMatches/' + r.id) }; S.matchCarpools = { [r.slug]: fake.get(k) };
  fake.interfereNextTransaction(k, { matchSlug: r.slug, startMs: 1, cars: [{ driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '09:00' }, { driverFamilyId: 'f3', girlIds: ['f5'], departureTime: '09:30' }] });
  await withFakeNowAsync(NOW, () => savePractice({ ...input, time: '12:00' }, r.id));
  assert.equal(fake.get(k).cars.length, 2); assert.notEqual(fake.get(k).startMs, 1);
});


console.log('\n=== away matches by bus ===');
// An away match of team cal1 (summary: "Volendam O15-1-AZ O15-1" = AZ plays away). Its team goes by bus unless the opponent has "Ajax" in its name.
const busFeeds = [{ calendarId: 'cal1', label: 'AZ O15-1', bus: true, busNot: 'Ajax' }];
const bm = { calendarId: 'cal1', eventId: 'e4', teamLabel: 'AZ O15-1', summary: 'Volendam O15-1-AZ O15-1', location: 'Sportpark Volendam', start: at('2026-10-03T11:30:00+02:00') };
const bmAjax = { ...bm, eventId: 'e5', summary: 'Jong Ajax-AZ O15-1', location: 'De Toekomst' };
const BSLUG = 'ev_cal1__e4';
const bdoc = (patch = {}) => ({ matchSlug: BSLUG, calendarId: 'cal1', eventId: 'e4', teamLabel: 'AZ O15-1', summary: bm.summary, location: bm.location, startMs: bm.start.getTime(), cars: [], ...patch });
const busState_ = (patch = {}) => state({ matchFeeds: busFeeds, matches: [bm], locationsDoc: { fixedKm: { AFC: 36, ATC: 30 } }, ...patch });
test('an away match of a team that goes by bus has the switch on, the carpool distance to AFC \'34 and one line for the missing bus times', () => {
  busState_();
  const html = render(), s = text(html);
  assert.match(html, /role="switch" aria-checked="true"[^>]*data-busswitch="ev_cal1__e4"/); assert.match(s, /met de bus/);
  assert.match(s, /Carpool naar AFC '34, Alkmaar · 36 km enkele reis · € 7,20 carpoolkosten/); assert.doesNotMatch(s, /±/);   // not the route to Volendam
  assert.match(s, /Bustijden nog niet bekend/); assert.match(html, /data-busedit="ev_cal1__e4"/); assert.doesNotMatch(s, /Aangepast/);
});
test('a home match has no bus switch and no bus text, and a match without the bus looks as before', () => {
  state({ matchFeeds: busFeeds, matches: [home] });
  assert.doesNotMatch(render(), /data-busswitch|busTimes|Carpool naar/);
  state({ matches: [bm] });   // the team has no bus default
  const html = render();
  assert.match(html, /aria-checked="false"[^>]*data-busswitch/); assert.match(text(html), /zonder bus/); assert.doesNotMatch(html, /busTimes|Aangepast/);
});
test('an opponent in the "niet met de bus tegen" list means no bus by default; switching it on there is no "Aangepast" tag', () => {
  busState_({ matches: [bmAjax] });
  assert.match(render(), /aria-checked="false"[^>]*data-busswitch/);
  const slug = 'ev_cal1__e5';
  busState_({ matches: [bmAjax], matchCarpools: { [slug]: { ...bdoc({ eventId: 'e5', matchSlug: slug, summary: bmAjax.summary }), bus: true } } });
  const html = render(); assert.match(html, /aria-checked="true"[^>]*data-busswitch/); assert.doesNotMatch(text(html), /Aangepast/); assert.doesNotMatch(html, /tag tag--warn/);
});
test('by bus the card has a Heen and a Terug part: the bus times in each, every car in its own leg (a car without leg counts as heen)', () => {
  const c1 = { driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '07:45', leg: 'heen' }, c3 = { driverFamilyId: 'f3', girlIds: ['f5'], departureTime: '07:50' };
  busState_({ matchCarpools: { [BSLUG]: bdoc({ busDepart: '08:45', busBack: '15:15', cars: [c1, c3, { driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '15:45', leg: 'terug' }] }) } });
  const html = render(), s = text(html), terug = html.indexOf('scene--terug'), heenS = text(html.slice(0, terug)), terugS = text(html.slice(terug));
  assert.match(heenS, /Heen 08:45 bus vertrekt bij AFC '34, Alkmaar/); assert.match(terugS, /Terug ± 15:15 bus weer terug bij AFC '34, Alkmaar/); assert.doesNotMatch(s, /Bustijden nog niet bekend/);
  assert.match(heenS, /07:45 Jan Jansen/); assert.match(heenS, /Aankomst 08:25/); assert.match(heenS, /07:50 Kees de Vries/); assert.match(heenS, /Aankomst 08:30/);
  assert.match(terugS, /15:45 Jan Jansen/); assert.match(terugS, /Ophalen bij AFC '34, Alkmaar/); assert.doesNotMatch(terugS, /Aankomst|Vertrek vanaf/); assert.doesNotMatch(heenS, /15:45/);
  assert.match(html, /aria-label="Bustijden invullen of wijzigen"/);   // the pencil in the head of each leg opens the bus sheet
});
test('by bus a leg without a car says so (Terug: a warning), and each leg has its own buttons: Ik rij heen / Ik rij terug', () => {
  busState_({ matchCarpools: { [BSLUG]: bdoc({ busDepart: '08:45', busBack: '15:15', cars: [{ driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '07:45', leg: 'heen' }] }) }, me: 'f9', links: { f9: { familyId: 'f3' } } });
  const html = render(), terug = html.indexOf('scene--terug'), s = text(html.slice(terug));
  assert.match(s, /Nog geen auto om op te halen/); assert.match(text(html.slice(0, terug)), /Ik rij heen/); assert.match(s, /Ik rij terug/);
  assert.match(html, /data-addmatchcar="ev_cal1__e4\|heen"/); assert.match(html, /data-addmatchcar="ev_cal1__e4\|terug"/); assert.match(html, /data-iride="ev_cal1__e4\|terug"/);
});
test('without the bus only Heen is a full part; Terug is one quiet line with a button, and a car that drives both is just "rijdt ook terug"', () => {
  state({ matchCarpools: { [SLUG]: { ...carpool, cars } } });
  const html = render(), s = text(html);
  assert.doesNotMatch(html, /scene--terug/); assert.match(s, /Heen aftrap 10:30 naar Hoorn O15-2/); assert.match(s, /Terug: ouders nemen de speelster mee Terugrit regelen/); assert.match(s, /rijdt ook terug/);
  assert.match(html, /data-addmatchcar="ev_cal1__e1\|terug"/); assert.doesNotMatch(s, /Nog geen auto om op te halen/);
});
test('without the bus a car that drives only Terug gets its own Terug part, and a car that drives both shows there as "zelfde auto als heen" (no buttons)', () => {
  state({ matchCarpools: { [SLUG]: { ...carpool, cars: [...cars, { driverFamilyId: 'f3', girlIds: ['f5'], departureTime: '14:45', leg: 'terug' }] } } });
  const html = render(), terug = html.indexOf('scene--terug'), s = text(html.slice(terug));
  assert.ok(terug > -1); assert.doesNotMatch(html, /matchLegQuiet/); assert.match(s, /Terug na afloop bij Hoorn O15-2/); assert.match(s, /zelfde auto als heen/); assert.match(s, /± 14:45 Kees de Vries/); assert.match(s, /Ophalen bij Hoorn O15-2/); assert.doesNotMatch(s, /Sportpark Hoorn/);
  const terugHtml = html.slice(terug); assert.equal((terugHtml.match(/data-editmatchcar/g) || []).length, 1); assert.equal((terugHtml.match(/data-delmatchcar/g) || []).length, 1);   // only the terug car has buttons here
});
test('a car that arrives after the bus has left gets a warning in words (and is still shown, not blocked)', () => {
  busState_({ matchCarpools: { [BSLUG]: bdoc({ busDepart: '08:45', busBack: '15:15', cars: [{ driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '08:10' }] }) } });
  const html = render(); assert.match(text(html), /Aankomst 08:50, na vertrek van de bus \(08:45\)/); assert.match(html, /matchCarSub matchCarSub--bad/);
});
test('busCarSub: null without any time, the warning flag only when the car is late; the bus times are not drawn for a match without the bus', () => {
  assert.equal(busCarSub({ departureTime: '--:--' }, { depart: '', back: '' }), null);
  assert.deepEqual(busCarSub({ departureTime: '07:45' }, { depart: '08:45', back: '' }), { bad: false, text: 'Aankomst 08:25' });
  assert.equal(busCarSub({ departureTime: '08:30' }, { depart: '08:45', back: '' }).bad, true);
  state({ matches: [home], matchCarpools: { [SLUG]: carpool } });
  assert.doesNotMatch(render(), /Aankomst|terug ophalen/);
});
test('a later match shows only a neutral "met de bus" tag, and no switch or times (the carpool itself is not possible yet)', () => {
  const later = { ...bm, eventId: 'e6', start: at('2026-10-20T12:00:00+02:00') };
  busState_({ matches: [later] });
  const html = render(); assert.match(text(html), /met de bus/); assert.doesNotMatch(html, /data-busswitch|busTimes|data-busedit/);
});
await testAsync('the switch stores the other state on the carpool document (keeping the times), says so, and Ongedaan puts it back', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), ['matchCarpools/' + BSLUG]: bdoc({ busDepart: '08:45', busBack: '15:15' }) });
  busState_({ matchCarpools: { [BSLUG]: bdoc({ busDepart: '08:45', busBack: '15:15' }) } }); render();
  await withFakeNow(NOW, () => reg()('[data-busswitch]')[0].onclick());
  const d = fake.get('matchCarpools/' + BSLUG);
  assert.equal(d.bus, false); assert.equal(d.busDepart, '08:45'); assert.equal(d.busBack, '15:15'); assert.equal(toast(), 'De bus staat uit voor deze wedstrijd Ongedaan');
  await dom.el('toast').onclick({ target: { id: 'toastAction' } });   // Ongedaan
  assert.equal(fake.get('matchCarpools/' + BSLUG).bus, true); assert.equal(fake.get('matchCarpools/' + BSLUG).busDepart, '08:45');
});
await testAsync('a match without a carpool document gets one (no cars) when its bus is switched', async () => {
  const fake = useFakeDb(sampleDbSeed()); busState_(); render();
  await withFakeNow(NOW, () => reg()('[data-busswitch]')[0].onclick());
  const d = fake.get('matchCarpools/' + BSLUG);
  assert.deepEqual(d.cars, []); assert.equal(d.bus, false); assert.equal(d.matchSlug, BSLUG); assert.equal(d.calendarId, 'cal1'); assert.equal(d.startMs, bm.start.getTime());
});
test('the sheet for the bus times has two time fields filled with what is known, and says it is not in the agenda', () => {
  busState_({ matchCarpools: { [BSLUG]: bdoc({ busDepart: '08:45', busBack: '15:15' }) } }); render();
  const h = busSheetHtml(BSLUG);
  assert.match(h, /id="busDepartInp" value="08:45"/); assert.match(h, /id="busBackInp" value="15:15"/); assert.match(text(h), /Staat niet in de agenda\. Iedere ouder kan dit invullen en wijzigen\./);
  assert.equal(busSheetHtml('onbekend'), '');
});
await testAsync('saving the sheet stores both times; an empty field means "not known"; a wrong time stores nothing', async () => {
  const fake = useFakeDb(sampleDbSeed()); busState_(); render();
  openBusSheet(BSLUG);
  dom.el('busDepartInp').value = '8.45'; dom.el('busBackInp').value = ''; await dom.el('busSave').onclick();
  assert.equal(fake.get('matchCarpools/' + BSLUG), undefined); assert.equal(dom.el('busErr').hidden, false);
  dom.el('busDepartInp').value = '08:45'; dom.el('busBackInp').value = '15:15'; await withFakeNow(NOW, () => dom.el('busSave').onclick());
  const d = fake.get('matchCarpools/' + BSLUG);
  assert.equal(d.bus, true); assert.equal(d.busDepart, '08:45'); assert.equal(d.busBack, '15:15'); assert.equal(toast(), 'Bustijden opgeslagen ✓ Ongedaan');
  await dom.el('toast').onclick({ target: { id: 'toastAction' } });   // Ongedaan: back to "not known"
  assert.equal(fake.get('matchCarpools/' + BSLUG).busDepart, ''); assert.equal(fake.get('matchCarpools/' + BSLUG).busBack, '');
});
test('the bus sheet has a "Waar vertrekt de bus?" select with AFC \'34 as default, ATC and Andere locatie (text field hidden until chosen)', () => {
  busState_({ matchCarpools: { [BSLUG]: bdoc({}) } }); render();
  const h = busSheetHtml(BSLUG);
  assert.match(text(h), /Waar vertrekt de bus\?/); assert.match(h, /<option value="AFC" selected>/); assert.match(h, /<option value="ATC">/); assert.match(h, /<option value="OTHER">/); assert.match(h, /id="busPlaceTxt"[^>]*hidden/);
  busState_({ matchCarpools: { [BSLUG]: bdoc({ busAt: 'ATC' }) } }); render(); assert.match(busSheetHtml(BSLUG), /<option value="ATC" selected>/);
  busState_({ matchCarpools: { [BSLUG]: bdoc({ busAtText: 'Sporthal Zuid' }) } }); render();
  const o = busSheetHtml(BSLUG); assert.match(o, /<option value="OTHER" selected>/); assert.match(o, /id="busPlaceTxt"[^>]*value="Sporthal Zuid"/); assert.doesNotMatch(o, /id="busPlaceTxt"[^>]*hidden/);
});
await testAsync('saving the sheet stores the place (ATC or a free place; a free place needs a name) and undo brings the old one back', async () => {
  const fake = useFakeDb(sampleDbSeed()); busState_(); render();
  openBusSheet(BSLUG);
  dom.el('busPlaceSel').value = 'OTHER'; dom.el('busPlaceTxt').value = '  '; await dom.el('busSave').onclick();
  assert.equal(fake.get('matchCarpools/' + BSLUG), undefined); assert.equal(dom.el('busErr').hidden, false);
  dom.el('busPlaceSel').value = 'ATC'; await withFakeNow(NOW, () => dom.el('busSave').onclick());
  assert.equal(fake.get('matchCarpools/' + BSLUG).busAt, 'ATC'); assert.equal(fake.get('matchCarpools/' + BSLUG).busAtText, '');
  await dom.el('toast').onclick({ target: { id: 'toastAction' } });
  assert.equal(fake.get('matchCarpools/' + BSLUG).busAt, '');
});
test('the card and the car form name the place of the bus: AFC \'34 by default, ATC with its fixed distance, a free place without km', () => {
  busState_({ matchCarpools: { [BSLUG]: bdoc({ busDepart: '08:45', busBack: '15:15' }) }, openMatchCarpoolForm: BSLUG }); let s = text(render());
  assert.match(s, /Carpool naar AFC '34, Alkmaar · 36 km/); assert.match(s, /Terug ophalen bij AFC '34, Alkmaar/);
  busState_({ matchCarpools: { [BSLUG]: bdoc({ busAt: 'ATC', busDepart: '08:45', busBack: '15:15' }) }, openMatchCarpoolForm: BSLUG }); s = text(render());
  assert.match(s, /Carpool naar AZ Trainingscomplex, Wijdewormer · 30 km/); assert.match(s, /Terug ophalen bij AZ Trainingscomplex, Wijdewormer/);
  busState_({ matchCarpools: { [BSLUG]: bdoc({ busAtText: 'Sporthal Zuid', busDepart: '08:45', busBack: '15:15' }) } }); s = text(render());
  assert.match(s, /Carpool naar Sporthal Zuid(?! ·)/); assert.doesNotMatch(s, /Sporthal Zuid · \d+ km/);
});
test('the car form of a bus match asks heen or terug, shows ONE time per choice and suggests it from the bus', () => {
  busState_({ matchCarpools: { [BSLUG]: bdoc({ busDepart: '08:45', busBack: '15:15' }) }, openMatchCarpoolForm: BSLUG });
  let html = render(), t_ = text(html);
  assert.match(t_, /Deze auto rijdt Heen, naar de bus Terug, ophalen/); assert.doesNotMatch(t_, /Alleen heen|Heen en terug/);
  assert.match(html, /id="matchCarLeg_ev_cal1__e4" value="heen"/); assert.match(html, /id="matchCarTime_ev_cal1__e4" value="07:45"/); assert.match(html, /id="matchCarPickup_ev_cal1__e4" value="15:15"/);
  assert.match(html, /id="matchTerugWrap_ev_cal1__e4" hidden/); assert.doesNotMatch(html, /id="matchHeenWrap_ev_cal1__e4" hidden/); assert.doesNotMatch(html, /id="matchFromWrap_ev_cal1__e4" hidden/);
  assert.match(t_, /Voorgesteld: de bus vertrekt om 08:45\. Reken op ± 40 minuten rijden en 20 minuten marge/); assert.match(t_, /Terug ophalen bij AFC '34, Alkmaar/); assert.match(t_, /De bus is er ± 15:15/);
  S.openMatchCarpoolLeg = 'terug'; html = render();   // opened from the Terug button
  assert.match(html, /id="matchCarLeg_ev_cal1__e4" value="terug"/); assert.match(html, /id="matchHeenWrap_ev_cal1__e4" hidden/); assert.match(html, /id="matchFromWrap_ev_cal1__e4" hidden/); assert.doesNotMatch(html, /id="matchTerugWrap_ev_cal1__e4" hidden/);
});
test('the car form without the bus offers heen en terug (default), alleen heen and alleen terug; the pick-up time is suggested 1,5 hours after kick-off', () => {
  state({ openMatchCarpoolForm: SLUG }); const html = render(), t_ = text(html);
  assert.match(t_, /Deze auto rijdt Heen en terug Alleen heen Alleen terug/); assert.match(html, /id="matchCarLeg_ev_cal1__e1" value="beide"/);
  assert.match(html, /id="matchCarPickup_ev_cal1__e1" value="12:00"/); assert.doesNotMatch(t_, /Ophaaltijd/); assert.match(html, /<input type="hidden" id="matchCarPickup_ev_cal1__e1"/); assert.match(t_, /± 12:00 \(na afloop\)/);   // kick-off 10:30
  assert.match(html, /id="matchTerugWrap_ev_cal1__e1" hidden/);
});
test('the segmented choice in the form switches the time fields and "Vertrek vanaf"; the choice goes into the hidden field', () => {
  state({ openMatchCarpoolForm: SLUG }); render();
  const seg = reg()('[data-matchleg]'); assert.equal(seg.length, 3);
  seg[2].onclick();   // alleen terug
  assert.equal(dom.el('matchCarLeg_' + SLUG).value, 'terug'); assert.equal(dom.el('matchTerugWrap_' + SLUG).hidden, false); assert.equal(dom.el('matchHeenWrap_' + SLUG).hidden, true); assert.equal(dom.el('matchFromWrap_' + SLUG).hidden, true);
  seg[0].onclick();
  assert.equal(dom.el('matchCarLeg_' + SLUG).value, 'beide'); assert.equal(dom.el('matchTerugWrap_' + SLUG).hidden, true); assert.equal(dom.el('matchFromWrap_' + SLUG).hidden, false);
});
await testAsync('saving a car: "heen en terug" stays exactly as before (no leg field); alleen terug stores the pick-up time as its time, with no place; by bus a car is heen or terug', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), ['matchCarpools/' + BSLUG]: bdoc({ busDepart: '08:45', busBack: '15:15' }) });
  busState_({ matchCarpools: { [BSLUG]: bdoc({ busDepart: '08:45', busBack: '15:15' }) } }); render();
  reg()('[data-addmatchcar]')[0].onclick(); let save = reg()('[data-savematchcar]')[0];
  dom.el('matchCarLeg_' + BSLUG).value = 'heen'; dom.el('matchCarDriver_' + BSLUG).value = 'f1'; dom.el('matchCarTime_' + BSLUG).value = '07:45'; picks.forEach(p => { p.checked = p.value === 'f2'; });
  await withFakeNow(NOW, () => save.onclick());
  let d = fake.get('matchCarpools/' + BSLUG); assert.equal(d.cars.length, 1); assert.equal(d.cars[0].leg, 'heen'); assert.equal(d.cars[0].departureTime, '07:45'); assert.equal(d.cars[0].pickupTime, undefined); assert.equal(d.busDepart, '08:45'); assert.equal(d.bus, undefined);
  S.openMatchCarpoolForm = null; busState_({ matchCarpools: { [BSLUG]: d } }); render();
  reg()('[data-addmatchcar]')[0].onclick(); save = reg()('[data-savematchcar]')[0];
  dom.el('matchCarLeg_' + BSLUG).value = 'terug'; dom.el('matchCarDriver_' + BSLUG).value = 'f3'; dom.el('matchCarPickup_' + BSLUG).value = '15:45'; dom.el('matchCarTime_' + BSLUG).value = '07:00'; picks.forEach(p => { p.checked = p.value === 'f5'; });
  await withFakeNow(NOW, () => save.onclick());
  d = fake.get('matchCarpools/' + BSLUG); assert.equal(d.cars[1].leg, 'terug'); assert.equal(d.cars[1].departureTime, '15:45'); assert.equal(d.cars[1].fromId, undefined); assert.equal(d.cars[1].fromText, undefined);
  S.openMatchCarpoolForm = null; busState_({ matchCarpools: { [BSLUG]: d } }); render();
  reg()('[data-addmatchcar]')[0].onclick(); save = reg()('[data-savematchcar]')[0];
  dom.el('matchCarLeg_' + BSLUG).value = 'terug'; dom.el('matchCarDriver_' + BSLUG).value = 'f1'; dom.el('matchCarPickup_' + BSLUG).value = ''; picks.forEach(p => { p.checked = p.value === 'f4'; });
  await withFakeNow(NOW, () => save.onclick());
  assert.equal(fake.get('matchCarpools/' + BSLUG).cars.length, 2); assert.match(toast(), /Vul een geldige tijd in/);   // a pick-up car needs a time
});
await testAsync('without the bus: both ways keeps the car as it was; alleen terug is its own car; editing a terug car back to both ways resets the leg', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), ['matchCarpools/' + SLUG]: { ...carpool, cars: [] } }); state({ matchCarpools: { [SLUG]: { ...carpool, cars: [] } } }); render();
  reg()('[data-addmatchcar]')[0].onclick(); let save = reg()('[data-savematchcar]')[0];
  setForm('f1', '07:00', ['f2']); await withFakeNow(NOW, () => save.onclick());
  assert.equal('leg' in fake.get('matchCarpools/' + SLUG).cars[0], false);
  S.openMatchCarpoolForm = null; state({ matchCarpools: { [SLUG]: fake.get('matchCarpools/' + SLUG) } }); render();
  reg()('[data-addmatchcar]')[0].onclick(); save = reg()('[data-savematchcar]')[0];
  setForm('f3', '07:00', ['f5']); dom.el('matchCarLeg_' + SLUG).value = 'terug'; dom.el('matchCarPickup_' + SLUG).value = '14:45'; await withFakeNow(NOW, () => save.onclick());
  const car = fake.get('matchCarpools/' + SLUG).cars[1]; assert.equal(car.leg, 'terug'); assert.equal(car.departureTime, '14:45');
  S.openMatchCarpoolForm = null; state({ matchCarpools: { [SLUG]: fake.get('matchCarpools/' + SLUG) } }); render();
  reg()('[data-editmatchcar]')[1].onclick(); assert.match(boxHtml, /id="matchCarLeg_ev_cal1__e1" value="terug"/); assert.match(boxHtml, /id="matchCarPickup_ev_cal1__e1" value="14:45"/);
  save = reg()('[data-savematchcar]')[0]; dom.el('matchCarDriver_' + SLUG).value = 'f3'; picks.forEach(p => { p.checked = p.value === 'f5'; }); dom.el('matchCarLeg_' + SLUG).value = 'beide'; dom.el('matchCarTime_' + SLUG).value = '07:30'; await withFakeNow(NOW, () => save.onclick());
  const back = fake.get('matchCarpools/' + SLUG).cars[1]; assert.equal(back.leg, ''); assert.equal(back.departureTime, '07:30');
});
await testAsync('"Ik rij ook" at a bus match leaves in time for the bus', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), ['matchCarpools/' + BSLUG]: bdoc({ busDepart: '08:45', busBack: '15:15' }) });
  busState_({ matchCarpools: { [BSLUG]: bdoc({ busDepart: '08:45', busBack: '15:15' }) } }); render();
  await withFakeNow(NOW, () => reg()('[data-iride]')[0].onclick());
  assert.equal(fake.get('matchCarpools/' + BSLUG).cars[0].departureTime, '07:45'); assert.equal(fake.get('matchCarpools/' + BSLUG).cars[0].leg, 'heen');
});
await testAsync('"Ik rij terug" by bus: own car, leg terug, the time of the bus; without the bus: "Ik rij" is both ways (no leg), "Ik rij terug" 1,5 hours after kick-off', async () => {
  let fake = useFakeDb({ ...sampleDbSeed(), ['matchCarpools/' + BSLUG]: bdoc({ busDepart: '08:45', busBack: '15:15' }) });
  busState_({ matchCarpools: { [BSLUG]: bdoc({ busDepart: '08:45', busBack: '15:15' }) } }); render();
  const terug = reg()('[data-iride]').find(b => b.dataset.iride.endsWith('|terug')); assert.ok(terug);
  await withFakeNow(NOW, () => terug.onclick());
  const c = fake.get('matchCarpools/' + BSLUG).cars[0]; assert.equal(c.leg, 'terug'); assert.equal(c.departureTime, '15:15'); assert.deepEqual(c.girlIds, ['f2']); assert.equal(c.fromId, undefined);
  fake = useFakeDb({ ...sampleDbSeed(), ['matchCarpools/' + SLUG]: { ...carpool, cars: [] } }); state({ matchCarpools: { [SLUG]: { ...carpool, cars: [] } } }); render();
  await withFakeNow(NOW, () => reg()('[data-iride]')[0].onclick());
  assert.equal('leg' in fake.get('matchCarpools/' + SLUG).cars[0], false); assert.equal(fake.get('matchCarpools/' + SLUG).cars[0].departureTime, '07:00');
});
test('the change log names the leg of a heen or terug car', () => {
  const log = [{ at: new Date('2026-10-01T19:41:00+02:00').getTime(), by: 'f3', act: 'add', car: { driverFamilyId: 'f3', departureTime: '15:45', girlIds: ['f5'], leg: 'terug' } }];
  coordState({ matchCarpools: { [SLUG]: { ...carpool, cars, log } } }); assert.match(text(render()), /voegde een auto toe: Kees de Vries terug 15:45 \(Lois\)/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
