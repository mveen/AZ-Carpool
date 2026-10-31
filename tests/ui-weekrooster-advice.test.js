// Run with: node ui-weekrooster-advice.test.js
// Afwijkend weekrooster: the flow of the day coordinator as its own full screen (Aanvragen → Indeling → Controleren → Doorvoeren → Alles terugdraaien), with the changes by hand.
// The scenario: Thursday has two cars (Jan: Eline + Anouk, Piet: Jahaimy + Evi); Lois asks for 09:00 heen. Without cars on the day: the fallback.
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
import { t } from '../i18n.js';
import { adviceForDay, syncWeekRequests } from '../weekrooster-data.js';
import { sampleGroups } from './test-support.js';
import { scheduleAdviceHtml, wireAdvice, wireAdviceEntry, renderFlowScreen } from '../ui-weekrooster-advice.js';
import { renderSchedule } from '../ui-schedule.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const WK = '2026-W40';
const doc = (day, fam, e = {}) => ({ weekKey: WK, day, familyId: fam, rides: true, heen: '07:00', terug: '15:00', status: 'pending', createdAt: 1, updatedAt: 1, ...e });
const tick = () => new Promise(r => setImmediate(r));
const car = (dir, n, driver, girls, dep) => ({ ['Do_' + dir + '_' + n]: { day: 'Do', direction: dir, girlIds: girls, driverFamilyId: driver, reserveFamilyIds: [], departureTime: dep } });
const CARS = { ...sampleGroups(), ...car('heen', 1, 'f1', ['f1', 'f3'], '07:30'), ...car('heen', 2, 'f2', ['f2', 'f4'], '09:15'), ...car('terug', 1, 'f1', ['f1', 'f3'], '17:00'), ...car('terug', 2, 'f2', ['f2', 'f4'], '18:00') };
const setup = async (extra = {}, patch = {}) => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'weekRequests/2026-W40_Do_f5': doc('Do', 'f5', { heen: '09:00', terug: '17:00' }), ...extra });
  sampleParentState({ dayCoordinators: { Do: 'f2' }, scheduleDay: 'Do', roosterMode: 'week', groups: CARS, ...patch });
  syncWeekRequests(); await tick(); return fake;
};
// The fake DOM does not read HTML: the elements with a data- attribute (or an id) are made from the HTML here, so a tap can be tested.
const fakeEls = (html, sel) => {
  const name = sel.replace(/^\[|\]$/g, ''), out = [];
  for (const m of html.matchAll(/<(button|select|input)\b([^>]*)>/g)) {
    if (!new RegExp('\\b' + name + '(=|\\s|$)').test(m[2])) continue;
    const dataset = {}; for (const a of m[2].matchAll(/data-([\w-]+)="([^"]*)"/g)) dataset[a[1].replace(/-(\w)/g, (_, c) => c.toUpperCase())] = a[2].replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    out.push({ dataset, value: dataset.value || '', onclick: null, onchange: null });
  }
  return out;
};
const boxOf = html => ({ querySelectorAll: sel => fakeEls(html, sel) });
let lastSheet = null, lastFlow = null;   // the sheet on top of the flow, and the flow screen itself (the screen is redrawn while a sheet is open)
dom.doc.createElement = () => {
  const cache = {}, prev = lastSheet; let id = '';
  const el = { get id() { return id; }, set id(v) { id = v; if (v === 'flowScreen') { lastFlow = el; lastSheet = prev; } }, className: '', innerHTML: '', addEventListener() {}, remove() {}, querySelectorAll(sel) { return (cache[sel] = cache[sel] || fakeEls(el.innerHTML, sel)); } };
  lastSheet = el; return el;
};


const view = () => withFakeNow(NOW, () => scheduleAdviceHtml());
// Wire a box made from the HTML (so a test can call the handlers of its buttons); single buttons by id are the fake DOM's own.
const wired = html => { const cache = {}; const box = { querySelectorAll: sel => (cache[sel] = cache[sel] || fakeEls(html, sel)) }; wireAdvice(box); return box; };
const press = id => { wired(view()); return dom.doc.getElementById(id).onclick(); };
const girlBtn = (box, id) => box.querySelectorAll('[data-wrgirl]').find(b => b.dataset.wrgirl.endsWith('|' + id));
const pickItem = idx => lastSheet.querySelectorAll('[data-sheetidx]')[idx].onclick();
const adj = (kind, key) => lastSheet.querySelectorAll('[data-adj]').find(e => e.dataset.adj === kind && (!key || e.dataset.key === key));

console.log('=== the view: Indeling ===');
await testAsync('closed: nothing; step 1 Aanvragen: the request, the advice in short, one primary button and Zelf indelen', async () => {
  await setup(); assert.equal(view(), '');
  S.wrAdvice = { day: 'Do' };
  const html = view(), s = text(html);
  assert.equal(S.wrAdvice.step, 'requests');
  assert.equal((html.match(/flowSteps__step flowSteps__step--/g) || []).length, 3);
  assert.match(html, /flowSteps__step--current" aria-current="step">.*?Aanvragen/); assert.match(html, /flowSteps__step--todo[^>]*>.*?Indeling/); assert.match(html, /flowSteps__step--todo[^>]*>.*?Controleren/);
  assert.match(s, /Morgen · donderdag 1 okt/); assert.match(s, /Wijzigingen voor morgen/);
  assert.match(s, /1 aanvraag van een ouder/); assert.match(s, /Lois Heen: aanwezig om 09:00 08:30/); assert.doesNotMatch(s, /Aangevraagd door/);
  assert.match(s, /Advies beschikbaar/); assert.match(s, /30 min extra wachten/); assert.match(s, /0 speelsters in andere auto/);
  assert.match(s, /Er verandert niets voordat je op de laatste stap bevestigt/);
  assert.match(html, /id="wrNav"[^>]*aria-label="Sluiten"/); assert.match(html, /id="wrToPlan"/); assert.match(s, /Advies bekijken en aanpassen/);
  assert.doesNotMatch(html, /id="wrSelf"/); assert.doesNotMatch(s, /Zelf indelen/);   // step 1 has one way forward
  assert.doesNotMatch(html, /id="wrToCheck"|id="wrAccept"|data-wrgirl|data-wrvariant/);
  assert.doesNotMatch(html.replace(/<svg[\s\S]*?<\/svg>/g, ''), /style=/);
});
await testAsync('step 2 Indeling: advice/alternative with what each costs, the numbers, the scene with was → wordt and the cars', async () => {
  await setup(); S.wrAdvice = { day: 'Do', step: 'plan' };
  const html = view(), s = text(html);
  assert.match(html, /flowSteps__step--done[^>]*>.*?Aanvragen/); assert.match(html, /flowSteps__step--current" aria-current="step">.*?Indeling/); assert.match(html, /flowSteps__step--todo[^>]*>.*?Controleren/);
  assert.match(s, /Voorstel voor morgen/); assert.match(html, /id="wrNav"[^>]*aria-label="Terug"/);
  assert.match(html, /data-wrvariant="best"[^>]*aria-pressed="true"/); assert.match(html, /data-wrvariant="alt"[^>]*aria-pressed="false"/);
  assert.match(s, /Advies 30 min extra wachten Alternatief 135 min extra wachten/);   // what each choice costs, worked out per variant
  assert.match(s, /0 speelsters in andere auto 1 chauffeur met impact 30 min extra wachten/);   // the wait tile is the last of the three
  assert.match(s, /Lois moet er om 09:00 zijn/); assert.match(s, /Komt door \(minuten\): Lois \+30/);
  assert.match(s, /Auto’s heen · aankomst bij AFC '34/); assert.match(s, /07:30 auto vertrekt Jan Jansen/); assert.match(s, /3\/3/);
  assert.match(s, /Lois vroeg 09:00\. Lois wacht 30 min haar tijd 09:00 · was niet ingedeeld Anouk, Eline · ongewijzigd/);   // the car's why, the rider with her time and wait, the ones who do not change
  assert.match(s, /09:15 auto vertrekt Piet Pieters Evi, Jahaimy/); assert.match(s, /Impact voor: Jan Jansen/);
  assert.doesNotMatch(s, /\bWas\b.*\bWordt\b|eerder dan gevraagd|later dan gevraagd/);   // no Was/Wordt table and no "gevraagd" without the sum behind it
  assert.match(html, /id="wrAdjust"/); assert.match(s, /Auto’s aanpassen: tijd, chauffeur, plek/); assert.match(html, /id="wrToCheck"/); assert.match(s, /Nog niets doorgevoerd/);
  assert.doesNotMatch(html, /id="wrToPlan"|id="wrSelf"|id="wrAccept"/);
  assert.doesNotMatch(html.replace(/<svg[\s\S]*?<\/svg>/g, ''), /style=/);
});
await testAsync('step 2: heen and terug each get their own tinted scene with a sun/moon badge and an explicit status', async () => {
  await setup(); S.wrAdvice = { day: 'Do', step: 'plan' };
  const html = view(), s = text(html);
  assert.match(html, /class="scene scene--heen" data-wrdir="heen"/); assert.match(html, /class="scene__badge"/);
  assert.match(s, /Heen Lois moet er om 09:00 zijn/);
  assert.match(html, /chip chip--warn">1 auto wijzigt|chip chip--warn">\d+ auto’s wijzigen/);   // a changing scene says how many cars change
});
await testAsync('step 3 Controleren: the summary groups use the same heen/terug tint and badge as step 2', async () => {
  await setup(); S.wrAdvice = { day: 'Do', step: 'check' };
  const html = view();
  assert.match(html, /class="planSum__group scene--heen"/); assert.match(html, /planSum__dir"><span class="scene__badge">/);
});
await testAsync('the wait tile is a button that opens the sum (now against the proposal); any tap closes it', async () => {
  await setup(); S.wrAdvice = { day: 'Do', step: 'plan' };
  const html = view(); assert.match(html, /<button type="button" class="statTile statTile--btn[^"]*" data-wrwait="1"/);
  const box = wired(html); box.querySelectorAll('[data-wrwait]')[0].onclick();
  const s = text(lastSheet.innerHTML);
  assert.match(s, /Zo is het berekend/); assert.match(s, /Nu Voorstel/); assert.match(s, /Lois – 30 min/);   // she asked, so she has no "now"
  assert.match(s, /Samen \d+ min \d+ min/); assert.match(s, /Extra = \d+ − \d+, nooit onder 0: \d+ min/); assert.match(s, /Extra wachten: 30 min/); assert.match(s, /Tik ergens om te sluiten/);
  assert.match(lastSheet.innerHTML, /class="adjDir scene--heen"/);
});
await testAsync('step 1: "Advies bekijken" goes to step 2, "Zelf indelen" closes the flow and opens the day editor, X closes the flow', async () => {
  await setup(); S.wrAdvice = { day: 'Do' };
  press('wrToPlan'); assert.equal(S.wrAdvice.step, 'plan');
  S.wrAdvice = { day: 'Do' }; press('wrNav'); assert.equal(S.wrAdvice, null);
  S.wrAdvice = { day: 'Do', step: 'plan' }; press('wrNav'); assert.equal(S.wrAdvice.step, 'requests');
  S.wrAdvice = { day: 'Do', step: 'check' }; press('wrNav'); assert.equal(S.wrAdvice.step, 'plan');
});
await testAsync('a request that fits as it is: the scene says nothing changes and still shows her in her car with her time', async () => {
  await setup({ 'weekRequests/2026-W40_Do_f5': doc('Do', 'f5', { status: 'accepted' }), 'weekRequests/2026-W40_Do_f3': doc('Do', 'f3', { heen: '08:45', terug: '17:00' }) });
  S.wrAdvice = { day: 'Do', step: 'plan' };
  const s = text(view());
  assert.match(s, /Anouk moet er om 08:45 zijn/); assert.match(s, /Past in de bestaande auto’s: hier verandert niets\./);
  assert.match(s, /Anouk .* haar tijd 08:45 · aanvraag/);   // she is shown: the reader sees why this shift is here
  assert.doesNotMatch(s, /Komt door/);   // nothing waits longer, so no sum to explain
});
await testAsync('the girl rows: only girls who asked or who change car; old values in the state do not matter', async () => {
  await setup(); S.wrAdvice = { day: 'Do', direction: 'nonsense', variant: 'nonsense', step: 'nonsense', edits: null };
  view(); assert.equal(S.wrAdvice.variant, 'best'); assert.equal(S.wrAdvice.step, 'requests');
  S.wrAdvice.step = 'plan';
  const html = view(); assert.match(html, /data-wrgirl="heen\|f5"/);
  assert.doesNotMatch(html, /data-wrgirl="[a-z]+\|f3"/);
});
await testAsync('a day without cars does not fit: the note, the normal advice and no switch between advice and alternative', async () => {
  await setup({}, { groups: sampleGroups() }); S.wrAdvice = { day: 'Do', step: 'plan' };
  const html = view(), s = text(html);
  assert.match(s, /Dit past niet in de bestaande auto’s/); assert.doesNotMatch(html, /data-wrvariant/); assert.match(html, /id="wrToCheck"/);
  assert.match(s, /Jan Jansen Nieuw/);
});
await testAsync('nothing to advise (no open request): the view closes itself; nobody linked: nothing', async () => {
  await setup({ 'weekRequests/2026-W40_Do_f5': doc('Do', 'f5', { status: 'accepted' }) });
  S.wrAdvice = { day: 'Do' }; assert.equal(view(), ''); assert.equal(S.wrAdvice, null);
  await setup({}, { links: {} }); S.wrAdvice = { day: 'Do' }; assert.equal(view(), '');
});
await testAsync('the Rooster: one entry card opens the flow as its own screen on top; closing removes it again', async () => {
  await setup(); S.wrAdvice = null;
  withFakeNow(NOW, () => renderSchedule()); const h = dom.html('tab-schedule');
  assert.match(h, /id="wrAlert"/); assert.match(h, /data-wradvice="Do"/); assert.doesNotMatch(h, /data-wredit="Do"/); assert.doesNotMatch(h, /id="wrAdvice"/); assert.match(text(h), /Regel dit/);
  const btn = { dataset: { wradvice: 'Do' }, onclick: null };
  wireAdviceEntry({ querySelectorAll: sel => (sel === '[data-wradvice]' ? [btn] : []) });
  withFakeNow(NOW, () => btn.onclick());
  assert.equal(S.wrAdvice.day, 'Do'); assert.equal(S.wrAdvice.step, 'requests');
  assert.match(lastFlow.innerHTML, /id="wrAdvice"/); assert.equal(lastFlow.id, 'flowScreen'); assert.equal(lastFlow.className, 'flowScreen');
  assert.doesNotMatch(dom.html('tab-schedule'), /id="wrAdvice"/);   // not in the Rooster itself
  S.wrAdvice = null; let removed = false; const el = dom.doc.getElementById('flowScreen'); el.remove = () => { removed = true; };
  withFakeNow(NOW, () => renderFlowScreen()); assert.ok(removed);
});

console.log('=== the changes by hand ===');
await testAsync('Alternatief: the second best division, and the changes by hand start over', async () => {
  await setup(); S.wrAdvice = { day: 'Do', step: 'plan', edits: { heen: [] } };
  wired(view()).querySelectorAll('[data-wrvariant]').find(b => b.dataset.wrvariant === 'alt').onclick();
  assert.equal(S.wrAdvice.variant, 'alt'); assert.deepEqual(S.wrAdvice.edits, {});
  const html = view(); assert.match(html, /data-wrvariant="alt"[^>]*aria-pressed="true"/);
  const adv = withFakeNow(NOW, () => adviceForDay('Do')), k = adv.directions.heen.keep;
  assert.ok(k.alt.waitMinutes > k.best.waitMinutes);
});
await testAsync('a girl to another car: the sheet lists the cars (seats, waiting), the choice moves her and the numbers follow', async () => {
  await setup(); S.wrAdvice = { day: 'Do', step: 'plan' };
  girlBtn(wired(view()), 'f5').onclick();
  const sheet = text(lastSheet.innerHTML); assert.match(sheet, /Welke auto voor Lois/); assert.match(sheet, /Haar tijd: 09:00/); assert.match(sheet, /Jan Jansen · vertrek 07:30 zit hier nu/);
  assert.match(sheet, /Piet Pieters · vertrek 09:15 2 plekken vrij/); assert.match(sheet, /Vertrek wordt 08:00 als Lois hier rijdt/); assert.match(sheet, /Evi en Jahaimy wachten dan langer/);   // the sheet says what choosing does: the new departure and who waits longer
  pickItem(1);
  const heen = S.wrAdvice.edits.heen;
  assert.deepEqual(heen.find(c => c.driverFamilyId === 'f2').girlIds.slice().sort(), ['f2', 'f4', 'f5']);
  assert.equal(heen.find(c => c.driverFamilyId === 'f2').departureTime, '08:00'); assert.deepEqual(heen.find(c => c.driverFamilyId === 'f1').girlIds, ['f1', 'f3']);
  const s = text(view()); assert.match(s, /08:00 auto vertrekt was 09:15 Piet Pieters/); assert.match(s, /Lois vroeg 09:00\. Lois 0 min haar tijd 09:00 · was niet ingedeeld/);
});
await testAsync('a full car stays closed: choosing it changes nothing', async () => {
  await setup(); S.wrAdvice = { day: 'Do', step: 'plan' };   // Jan's car is full after the advice: Eline, Anouk and Lois
  girlBtn(wired(view()), 'f5').onclick();
  assert.match(text(lastSheet.innerHTML), /zit hier nu/);
  pickItem(0); assert.deepEqual(S.wrAdvice.edits, {});
  S.wrAdvice.edits = { heen: [{ driverFamilyId: 'f1', girlIds: ['f1', 'f3', 'f5'], departureTime: '07:30' }, { driverFamilyId: 'f2', girlIds: ['f2', 'f4'], departureTime: '09:15' }] };
  girlBtn(wired(view()), 'f5').onclick(); pickItem(1);   // Piet's car has room
  assert.deepEqual(S.wrAdvice.edits.heen.find(c => c.driverFamilyId === 'f2').girlIds.slice().sort(), ['f2', 'f4', 'f5']);
  S.wrAdvice.edits = { heen: [{ driverFamilyId: 'f1', girlIds: ['f1', 'f3', 'f6'], departureTime: '07:30' }, { driverFamilyId: 'f2', girlIds: ['f2', 'f4', 'f5'], departureTime: '08:00' }] };
  girlBtn(wired(view()), 'f5').onclick(); const before = JSON.stringify(S.wrAdvice.edits);
  assert.match(text(lastSheet.innerHTML), /vol/); pickItem(0); assert.equal(JSON.stringify(S.wrAdvice.edits), before);
});
await testAsync('Alternatief shows the cars with the riders who move: where they come from, their time, how long they wait, who leaves, and the sum behind "extra wachten"', async () => {
  await setup(); S.wrAdvice = { day: 'Do', step: 'plan', variant: 'alt' };
  const s = text(view());
  assert.match(s, /135 min extra wachten/); assert.match(s, /Komt door \(minuten\): Evi \+105 · Lois \+30/);   // 105 + 30 = 135
  assert.match(s, /Jahaimy 0 min haar tijd 10:15 · was bij Piet Pieters/); assert.match(s, /Uit deze auto: Anouk, Eline \(de auto vertrekt nu 09:15\)/);
  assert.match(s, /09:15 auto vertrekt was 07:30 Jan Jansen/);
  assert.match(s, /Waarom 07:30: Lois vroeg 09:00\./);
});
await testAsync('Auto\'s aanpassen: time by hand (it stays) and back to calculated, another driver, place, arrival', async () => {
  await setup(); S.wrAdvice = { day: 'Do', step: 'plan' };
  press('wrAdjust');
  assert.match(text(lastSheet.innerHTML), /Auto’s aanpassen/); assert.match(lastSheet.innerHTML, /data-adj="deptime" data-key="heen\|f1" value="07:30"/); assert.match(text(lastSheet.innerHTML), /Automatisch berekend/);   // one time field, filled with the calculated time: no extra tap
  assert.doesNotMatch(lastSheet.innerHTML, /data-adj="depmode"/);
  assert.match(lastSheet.innerHTML, /class="adjDir scene--heen"/); assert.match(lastSheet.innerHTML, /adjDir__head"><span class="scene__badge">/);   // the same tint and badge as the steps
  assert.match(lastSheet.innerHTML, /class="adjCar__fields"><div class="adjCar__time">/); assert.doesNotMatch(lastSheet.innerHTML, /devFormTop/);   // roomy fields, not the 110px column
  let e = adj('deptime', 'heen|f1'); e.value = '07:10'; e.onchange();
  assert.equal(S.wrAdvice.edits.heen.find(c => c.driverFamilyId === 'f1').departureTime, '07:10'); assert.equal(S.wrAdvice.edits.heen.find(c => c.driverFamilyId === 'f1').depManual, true);
  assert.match(text(lastSheet.innerHTML), /Terug naar berekend \(07:30\)/);
  e = adj('depreset', 'heen|f1'); e.onclick();
  assert.equal(S.wrAdvice.edits.heen.find(c => c.driverFamilyId === 'f1').departureTime, '07:30'); assert.equal(S.wrAdvice.edits.heen.find(c => c.driverFamilyId === 'f1').depManual, undefined);
  e = adj('driver', 'heen|f1'); e.value = 'f6'; e.onchange();
  assert.deepEqual(S.wrAdvice.edits.heen.map(c => c.driverFamilyId), ['f6', 'f2']);
  e = adj('place', 'heen|f2'); e.value = 'busstation'; e.onchange();
  assert.equal(S.wrAdvice.edits.heen.find(c => c.driverFamilyId === 'f2').locationId, 'busstation');
  e = adj('dest', 'heen|f2'); e.onclick();
  e = lastSheet.querySelectorAll('[data-adj]').find(x => x.dataset.adj === 'dest' && x.dataset.key === 'heen|f2' && x.dataset.dest === 'ATC'); e.onclick();
  assert.equal(S.wrAdvice.edits.heen.find(c => c.driverFamilyId === 'f2').destination, 'ATC');
  assert.match(text(view()), /Lois/);
});
await testAsync('a car for another driver can be added and then used', async () => {
  await setup(); S.wrAdvice = { day: 'Do', step: 'plan' };
  press('wrAdjust'); const e = adj('addcar'); assert.ok(e); e.dataset.dir = 'heen'; e.value = 'f6'; e.onchange();
  assert.deepEqual(S.wrAdvice.edits.heen.map(c => c.driverFamilyId), ['f1', 'f2', 'f6']);
  girlBtn(wired(view()), 'f5').onclick(); assert.match(text(lastSheet.innerHTML), /Tom Visser/);
});

console.log('=== Controleren and Doorvoeren ===');
await testAsync('Controleren: the chips, who notices it, the summary and ONE button with its subtitle; back to the plan', async () => {
  await setup(); S.wrAdvice = { day: 'Do', step: 'plan' };
  press('wrToCheck'); assert.equal(S.wrAdvice.step, 'check');
  const html = view(), s = text(html);
  assert.match(html, /flowSteps__step--done[^>]*>.*?Indeling/); assert.match(html, /flowSteps__step--current" aria-current="step">.*?Controleren/);
  assert.match(s, /Klaar om door te voeren\?/); assert.match(s, /1 van 1 aanvragen/); assert.match(s, /Geen chauffeur gewisseld/); assert.match(s, /Geen auto te vol/);
  assert.match(s, /Impact voor: Jan Jansen/); assert.match(s, /Zo rijden ze donderdag/);
  assert.match(s, /Heen 07:30 Jan Jansen Anouk, Eline, Lois/);
  assert.equal((html.match(/id="wrAccept"/g) || []).length, 1); assert.match(s, /Doorvoeren voor donderdag/); assert.match(s, /Direct daarna kun je alles ongedaan maken/);
  assert.doesNotMatch(html, /id="wrToCheck"|id="wrAdjust"/); assert.match(html, /id="wrBackToPlan"/); assert.match(s, /Terug naar indeling/);
  press('wrBackToPlan'); assert.equal(S.wrAdvice.step, 'plan');
});
await testAsync('Controleren warns about a car that is too full, someone who comes too late, and a girl without a car', async () => {
  await setup(); S.wrAdvice = { day: 'Do', step: 'check', edits: { heen: [{ driverFamilyId: 'f1', girlIds: ['f1', 'f3', 'f6'], departureTime: '07:30' }, { driverFamilyId: 'f2', girlIds: ['f2', 'f4'], departureTime: '09:15' }] } };
  const s = text(view()); assert.match(s, /Iemand heeft geen auto/); assert.match(s, /0 van 1 aanvragen/);
  S.wrAdvice.edits = { heen: [{ driverFamilyId: 'f1', girlIds: ['f1', 'f3', 'f5', 'f6'], departureTime: '07:30' }, { driverFamilyId: 'f2', girlIds: ['f2', 'f4'], departureTime: '09:15' }] };
  assert.match(text(view()), /Een auto is te vol/);
  S.wrAdvice.edits = { heen: [{ driverFamilyId: 'f1', girlIds: ['f1', 'f3'], departureTime: '07:30' }, { driverFamilyId: 'f2', girlIds: ['f2', 'f4', 'f5'], departureTime: '09:15' }] };
  assert.match(text(view()), /Iemand komt te laat/);
});
await testAsync('Doorvoeren saves what was changed by hand, shows "Alles terugdraaien" and the Dagbericht; the toast has no second undo', async () => {
  const fake = await setup(); S.wrAdvice = { day: 'Do', step: 'plan' };
  girlBtn(wired(view()), 'f5').onclick(); pickItem(1);   // Lois into Piet's car
  S.wrAdvice.step = 'check';
  await withFakeNowAsync(NOW, async () => {
    wired(view()); await dom.doc.getElementById('wrAccept').onclick();
    assert.equal(S.wrAdvice, null); assert.equal(S.wrDone.day, 'Do'); assert.equal(S.wrDone.n, 1);
    assert.equal(fake.get('weekRequests/2026-W40_Do_f5').status, 'accepted');
    const heen = fake.get('deviations/Do_heen'); assert.deepEqual(heen.times, { f5: '09:00' });
    assert.deepEqual(heen.cars.find(c => c.driverFamilyId === 'f2').girlIds.slice().sort(), ['f2', 'f4', 'f5']);
    assert.equal(heen.cars.find(c => c.driverFamilyId === 'f2').departureTime, '08:00');
    assert.match(text(dom.doc.getElementById('toast').innerHTML), /wijziging.* doorgevoerd/);
    const done = view(), s = text(done);
    assert.match(s, /Donderdag is geregeld/); assert.match(s, /1 wijziging doorgevoerd voor 1 aanvraag\./); assert.match(s, /Lois Rijdt heen mee met Piet Pieters, aan om 09:00/);
    assert.match(done, /id="wrUndoAll"/); assert.match(s, /Alles terugdraaien Het rooster van donderdag gaat terug naar de oorspronkelijke situatie\. De aanvraag staat dan weer open\./);
    assert.match(s, /Deel in de WhatsApp-groep.*Sluiten.*Alles terugdraaien/); assert.match(done, /id="conclusieBtn"/); assert.match(done, /id="wrDoneClose"/); assert.doesNotMatch(s, /Dagbericht|Gewijzigde chauffeur/);
    assert.match(s, /1 Aanvragen 2 Indeling 3 Controleren/); assert.match(done, /flowDone__badge/);
    assert.match(done, /flowSteps__step--done/); assert.doesNotMatch(done, /flowSteps__step--(current|todo)/);
  });
});
await testAsync('Alles terugdraaien asks first; "Nee" changes nothing, "Ja" puts everything back and opens the flow again', async () => {
  const fake = await setup(); S.wrAdvice = { day: 'Do', step: 'check' };
  await withFakeNowAsync(NOW, async () => {
    wired(view()); await dom.doc.getElementById('wrAccept').onclick();
    wired(view()); dom.doc.getElementById('wrUndoAll').onclick();
    assert.match(text(lastSheet.innerHTML), /Alles terugdraaien\?/);
    dom.doc.getElementById('wrUndoNo').onclick();
    assert.equal(fake.get('weekRequests/2026-W40_Do_f5').status, 'accepted'); assert.ok(S.wrDone);
    dom.doc.getElementById('wrUndoAll').onclick(); await dom.doc.getElementById('wrUndoYes').onclick(); await tick(); await tick();
    assert.equal(fake.get('weekRequests/2026-W40_Do_f5').status, 'pending'); assert.equal(fake.get('deviations/Do_heen').times, undefined);
    assert.equal(S.wrDone, null); assert.equal(S.wrAdvice.day, 'Do'); assert.equal(S.wrAdvice.step, 'requests');
  });
});
await testAsync('a failing save changes nothing and keeps the flow open', async () => {
  const fake = await setup(); fake.failWrites('deviations', 'denied'); S.wrAdvice = { day: 'Do', step: 'check' };
  await withFakeNowAsync(NOW, async () => { wired(view()); await dom.doc.getElementById('wrAccept').onclick(); });
  assert.equal(S.wrAdvice.day, 'Do'); assert.equal(S.wrAdvice.step, 'check'); assert.equal(S.wrDone, null);
  assert.equal(fake.get('weekRequests/2026-W40_Do_f5').status, 'pending');
});
await testAsync('the advice on a day without cars is taken over too: the new car is stored', async () => {
  const fake = await setup({}, { groups: sampleGroups() }); S.wrAdvice = { day: 'Do', step: 'check' };
  await withFakeNowAsync(NOW, async () => { wired(view()); await dom.doc.getElementById('wrAccept').onclick(); });
  assert.equal(fake.get('weekRequests/2026-W40_Do_f5').status, 'accepted'); assert.ok(fake.get('deviations/Do_heen').cars.length >= 1);
});
test('the texts of the flow say what the design says', () => {
  assert.equal(t('weekrooster.flow.doneTitle', { p1: 'Woensdag' }), 'Woensdag is geregeld'); assert.equal(t('weekrooster.flow.doneSummary', { p1: '5 wijzigingen', p2: '3 aanvragen' }), '5 wijzigingen doorgevoerd voor 3 aanvragen.');
  assert.equal(t('weekrooster.flow.doneRideTerug', { p1: 'Ouder van Julia', p2: '19:00' }), 'Rijdt terug mee met Ouder van Julia, weg om 19:00');
  assert.equal(t('weekrooster.flow.apply', { p1: 'woensdag' }), 'Doorvoeren voor woensdag'); assert.equal(t('weekrooster.flow.applySub'), 'Direct daarna kun je alles ongedaan maken');
  assert.equal(t('weekrooster.flow.undoTextMany', { p1: 'woensdag', p2: 3 }), 'Het rooster van woensdag gaat terug naar de oorspronkelijke situatie. De 3 aanvragen staan dan weer open.');
  assert.equal(t('weekrooster.flow.carsHeen', { p1: "AFC '34" }), "Auto’s heen · aankomst bij AFC '34"); assert.equal(t('weekrooster.flow.carsTerug', { p1: "AFC '34" }), "Auto’s terug · vertrek bij AFC '34");
  assert.equal(t('weekrooster.flow.noticeN', { p1: 2 }), '2 chauffeurs met impact');
  assert.equal(t('weekrooster.entry.titleOne', { p2: 'donderdag' }), '1 aanvraag voor donderdag'); assert.equal(t('weekrooster.entry.titleMany', { p1: 2, p2: 'donderdag' }), '2 aanvragen voor donderdag');
});
test('ui-weekrooster-advice.js imports nothing it does not use', () => assertNoUnusedImports('ui-weekrooster-advice.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
