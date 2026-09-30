// Run with: node ui-profile.test.js
// Gate (phone + invite code), first-run coordinator claim, "Mijn gezin" profile tab, saving the profile,
// and the coordinator's test view as another parent.
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
import { installFakeDom, sampleCoordinatorState, sampleParentState, resetState, useFakeDb, sampleDbSeed, withFakeNow, NOW, expectSnapshot } from './test-support.js';
import { S } from '../state.js';
import {
  renderImpersonateBanner, startImpersonate, stopImpersonate, familyFormHtml, readFamilyForm, renderClaimCoordinator,
  renderGateOrApp, renderGate, submitGate, renderProfile, saveProfile, weekschemaWarningHtml, isWeekschemaField,
} from '../ui-profile.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const toast = () => dom.doc.getElementById('toast').innerHTML;

console.log('=== gate and first run ===');
test('while loading, only a loading message is shown, never the claim screen', () => {
  useFakeDb({}); resetState({ me: 'u1', appReady: false, linksLoaded: false });
  renderGateOrApp();
  assert.match(text(dom.html('tab-gate')), /Laden/);
  assert.doesNotMatch(dom.html('tab-gate'), /claimCoordBtn/);
  assert.equal(dom.el('tab-gate').style.display, 'block');
});
test('with no coordinator yet, the claim screen is shown', () => {
  useFakeDb({}); resetState({ me: 'u1', appReady: true, linksLoaded: true, coordinatorExists: false, canEdit: false });
  renderGateOrApp();
  assert.match(text(dom.html('tab-gate')), /Welkom bij AZ Carpool/);
  assert.match(text(dom.html('tab-gate')), /Ik ben de coördinator/);
});
await testAsync('claiming writes config/coordinator with the own uid and gives coordinator rights', async () => {
  const fake = useFakeDb({}); resetState({ me: 'u1', appReady: true, linksLoaded: true, coordinatorExists: false, canEdit: false });
  renderClaimCoordinator();
  await dom.el('claimCoordBtn').onclick();
  assert.equal(fake.get('config/coordinator').uid, 'u1');
  assert.equal(S.coordinatorExists, true); assert.equal(S.canEdit, true);
  assert.match(toast(), /coördinator/);
});
test('an unlinked parent sees the gate form when a coordinator exists', () => {
  useFakeDb({}); resetState({ me: 'u1', appReady: true, linksLoaded: true, coordinatorExists: true, canEdit: false, links: {} });
  renderGateOrApp();
  const s = text(dom.html('tab-gate'));
  assert.match(s, /Toegang tot AZ Carpool/); assert.match(s, /Toegang aanvragen/);
  assert.match(dom.html('tab-gate'), /id="gatePhone"/); assert.match(dom.html('tab-gate'), /id="gateCode"/);
});
test('a linked parent gets the tabs, not the gate', () => {
  useFakeDb({}); sampleParentState({ linksLoaded: true, coordinatorExists: true });
  renderGateOrApp();
  assert.equal(dom.el('tab-gate').style.display, 'none');
});

console.log('\n=== submitting the gate ===');
function fillGate(phone, code) { renderGate(); dom.el('gatePhone').value = phone; dom.el('gateCode').value = code; }
await testAsync('empty fields are refused with a message', async () => {
  const fake = useFakeDb({}); resetState({ me: 'u1' }); fillGate('', '');
  await submitGate();
  assert.match(dom.el('gateMsg').textContent, /Vul alle velden in/);
  assert.equal(fake.get('links/u1'), undefined);
});
await testAsync('a code with invalid characters is refused before contacting the database', async () => {
  const fake = useFakeDb({}); resetState({ me: 'u1' }); fillGate('0611111111', 'a b!');
  await submitGate();
  assert.match(dom.el('gateMsg').textContent, /Code klopt niet/);
  assert.equal(fake.get('links/u1'), undefined);
});
await testAsync('an unknown code is refused', async () => {
  const fake = useFakeDb({}); resetState({ me: 'u1' }); fillGate('0611111111', 'NOPE1234');
  await submitGate();
  assert.match(dom.el('gateMsg').textContent, /Code klopt niet/);
  assert.equal(fake.get('links/u1'), undefined);
});
await testAsync('a known code writes links/{uid} with the normalised phone number and grants access', async () => {
  const fake = useFakeDb({ 'invites/CODE1234': { familyId: 'f2' } });
  resetState({ me: 'u1', appReady: true, coordinatorExists: true, families: sampleParentState().families });
  fillGate('06-11 11 11 11', 'CODE1234');
  await submitGate();
  const link = fake.get('links/u1');
  assert.equal(link.familyId, 'f2'); assert.equal(link.code, 'CODE1234'); assert.equal(link.phoneKey, '0611111111');
  assert.equal(S.links.u1.familyId, 'f2');
  assert.match(toast(), /Toegang verleend/);
});
await testAsync('without a session (no uid) nothing is written and the user is told', async () => {
  const fake = useFakeDb({ 'invites/CODE1234': { familyId: 'f2' } }); resetState({ me: null }); fillGate('0611111111', 'CODE1234');
  await submitGate();
  assert.match(toast(), /Geen verbinding/);
  assert.equal(fake.writes.length, 0);
});

console.log('\n=== Mijn gezin ===');
test('a parent sees own family form, linked name and an unlink button', () => {
  useFakeDb(sampleDbSeed()); sampleParentState();
  withFakeNow(NOW, () => renderProfile());
  const s = text(dom.html('tab-profile'));
  assert.match(s, /Mijn gezin/); assert.match(s, /Gekoppeld aan: Jahaimy/);
  assert.match(dom.html('tab-profile'), /id="unlinkBtn"/);
  assert.match(dom.html('tab-profile'), /value="Piet Pieters"/);
  expectSnapshot('ui-profile', 'parent profile', dom.html('tab-profile'));
});
test('without an account, the profile says the account was not recognised', () => {
  useFakeDb({}); resetState({ me: null });
  renderProfile();
  assert.match(text(dom.html('tab-profile')), /account niet herkennen/);
});
test('the form html holds the parent, daughter and capacity fields for the chosen prefix', () => {
  resetState({});
  const html = familyFormHtml('zz', { parentName: 'A', girlName: 'B', capacity: 5, schedule: {}, availability: {} });
  assert.match(html, /id="zz_parentName"/); assert.match(html, /id="zz_girlName"/); assert.match(html, /id="zz_capacity"/);
});

console.log('\n=== Weekschema warning ===');
test('the warning is in the page but empty and hidden until the Weekschema is edited', () => {
  useFakeDb(sampleDbSeed()); sampleParentState();
  withFakeNow(NOW, () => renderProfile());
  const html = dom.html('tab-profile');
  assert.match(html, /<div class="devAlert" id="weekschemaWarn"[^>]* hidden><\/div>/);
  assert.doesNotMatch(html, /id="weekschemaConfirm"/);
});
test('with an unconfirmed edit it shows the list of changes, Bevestigen and Eenmalig wijzigen', () => {
  const fams = sampleParentState().families; const edited = JSON.parse(JSON.stringify(fams.f2)); edited.schedule.Ma.heen = '09:00';
  sampleParentState({ weekschemaBase: { schedule: fams.f2.schedule, availability: fams.f2.availability }, weekschemaEdit: { schedule: edited.schedule, availability: edited.availability } });
  const html = weekschemaWarningHtml();
  assert.doesNotMatch(html, / hidden>/);
  const s = text(html);
  assert.match(s, /Je past je vaste weekschema aan/); assert.match(s, /Maandag Heen: tijd 08:30 → 09:00/);
  assert.match(s, /Deze aanpassing is nog niet opgeslagen\. Ze werkt door in de standaardplanning van elke week, niet alleen deze week\./);
  assert.match(html, /id="weekschemaConfirm"/); assert.match(html, /id="weekschemaToWijzigen"/);
  assert.match(s, /Bevestigen: voor elke week/); assert.match(s, /Eenmalig wijzigen maakt deze aanpassing ongedaan en opent Wijzigen voor alleen deze week\./);
});
test('only Weekschema fields (times, availability, back-up) trigger it — not name, phone or seats', () => {
  ['me_sch_Ma_heen', 'me_sch_Vr_terug', 'me_av_Di_heen', 'me_av_Wo_terug', 'me_bkH_Do', 'me_bkT_Vr'].forEach(id => assert.equal(isWeekschemaField(id), true, id));
  ['me_parentName', 'me_girlName', 'me_parentPhone1', 'me_capacity', 'coord_sch_Ma_heen', '', undefined].forEach(id => assert.equal(isWeekschemaField(id), false, String(id)));
});
// Renders Mijn gezin and returns the change listener the page put on the card.
function openProfileAndGetListener() {
  let listener = null;
  const box = dom.el('tab-profile'); const origQS = box.querySelector;
  box.querySelector = sel => (sel === '.card' ? { addEventListener: (type, fn) => { if (type === 'change') listener = fn; } } : origQS(sel));
  withFakeNow(NOW, () => renderProfile());
  box.querySelector = origQS;
  assert.equal(typeof listener, 'function');
  return listener;
}
const editedF2 = fn => { const e = JSON.parse(JSON.stringify(S.families.f2)); fn(e); fillForm(e); return e; };
test('editing a time waits for confirmation and shows the warning without a re-render', () => {
  useFakeDb(sampleDbSeed()); sampleParentState();
  const listener = openProfileAndGetListener();
  editedF2(() => {});                                          // the form still holds the saved values
  listener({ target: { id: 'me_sch_Ma_heen' } });
  assert.equal(S.weekschemaBase, null); assert.equal(S.weekschemaEdit, null);   // nothing really changed: no warning
  editedF2(e => { e.schedule.Ma.heen = '09:00'; });
  listener({ target: { id: 'me_sch_Ma_heen' } });
  assert.equal(S.weekschemaBase.schedule.Ma.heen, '08:30'); assert.equal(S.weekschemaEdit.schedule.Ma.heen, '09:00');
  assert.equal(dom.el('weekschemaWarn').hidden, false);
  assert.match(text(dom.html('weekschemaWarn')), /Maandag Heen: tijd 08:30 → 09:00/);
});
test('editing the time back to the saved value takes the warning away again', () => {
  useFakeDb(sampleDbSeed()); sampleParentState();
  const listener = openProfileAndGetListener();
  editedF2(e => { e.schedule.Ma.heen = '09:00'; }); listener({ target: { id: 'me_sch_Ma_heen' } });
  assert.ok(S.weekschemaBase);
  editedF2(() => {}); listener({ target: { id: 'me_sch_Ma_heen' } });
  assert.equal(S.weekschemaBase, null); assert.equal(dom.el('weekschemaWarn').hidden, true);
});
test('a name change is not a Weekschema change: no edit is held back and no warning appears', () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState();
  const listener = openProfileAndGetListener();
  editedF2(e => { e.parentName = 'Piet P.'; });
  listener({ target: { id: 'me_parentName' } });
  assert.equal(S.weekschemaBase, null);
});
test('Eenmalig wijzigen undoes the edit, remembers what was wanted and opens Wijzigen', () => {
  useFakeDb(sampleDbSeed()); sampleParentState();
  const listener = openProfileAndGetListener();
  editedF2(e => { e.schedule.Ma.heen = '09:00'; }); listener({ target: { id: 'me_sch_Ma_heen' } });
  withFakeNow(NOW, () => dom.el('weekschemaToWijzigen').onclick());
  assert.equal(S.families.f2.schedule.Ma.heen, '08:30');                        // back to the saved time
  assert.equal(S.weekschemaBase, null); assert.equal(S.weekschemaEdit, null);
  assert.deepEqual(S.deviationIntent.map(c => [c.day, c.direction, c.from, c.to]), [['Ma', 'heen', '08:30', '09:00']]);
  assert.match(text(dom.html('tab-deviation')), /Wijzigingen/);
});
await testAsync('Bevestigen saves the edit for every week and clears the warning', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState(); S.serverSchedules = { f2: JSON.parse(JSON.stringify(S.families.f2.schedule)) };
  const listener = openProfileAndGetListener();
  editedF2(e => { e.schedule.Ma.heen = '09:00'; }); listener({ target: { id: 'me_sch_Ma_heen' } });
  await withFakeNow(NOW, () => dom.el('weekschemaConfirm').onclick());
  assert.equal(fake.get('families/f2').schedule.Ma.heen, '09:00');
  assert.equal(S.weekschemaBase, null); assert.equal(S.weekschemaEdit, null);
  assert.equal(S.families.f2.schedule.Ma.heen, '09:00'); assert.match(toast(), /Weekschema opgeslagen voor elke week/);
});

console.log('\n=== saving the profile ===');
await testAsync('a parent who changes a time saves it and leaves a pending change for the coordinator', async () => {
  const fake = useFakeDb(sampleDbSeed());
  sampleParentState(); S.serverSchedules = { f2: JSON.parse(JSON.stringify(S.families.f2.schedule)) };
  const edited = JSON.parse(JSON.stringify(S.families.f2)); edited.schedule.Ma.heen = '09:00';
  fillForm(edited);
  await saveProfile();
  const saved = fake.get('families/f2');
  assert.equal(saved.schedule.Ma.heen, '09:00');
  assert.equal(saved.timeChanges.length, 1);
  assert.equal(saved.timeChanges[0].to, '09:00'); assert.equal(saved.timeChanges[0].from, '08:30');
  assert.match(toast(), /coördinator/);
});
await testAsync('the coordinator saving does not create pending changes', async () => {
  const fake = useFakeDb(sampleDbSeed());
  sampleCoordinatorState({ links: { coord: { familyId: 'f1' } }, serverSchedules: {} });
  const edited = JSON.parse(JSON.stringify(S.families.f1)); edited.schedule.Ma.heen = '09:00';
  fillForm(edited);
  await saveProfile();
  assert.equal(fake.get('families/f1').schedule.Ma.heen, '09:00');
  assert.equal(fake.get('families/f1').timeChanges, undefined);
  assert.match(toast(), /Opgeslagen/);
});
await testAsync('without an account nothing is written', async () => {
  resetState({ me: null });
  const fake = useFakeDb({});
  await saveProfile();
  assert.match(toast(), /account/);
  assert.equal(fake.writes.length, 0);
});

// Fills the fake form fields the way a user would have typed them.
function fillForm(f, pre = 'me') {
  const set = (id, v) => { dom.el(`${pre}_${id}`).value = v; };
  set('parentName', f.parentName); set('girlName', f.girlName); set('parentPhone1', f.parentPhone1); set('parentPhone2', f.parentPhone2 || '');
  set('capacity', String(f.capacity));
  ['Ma', 'Di', 'Wo', 'Do', 'Vr'].forEach(d => {
    set(`sch_${d}_heen`, f.schedule[d].heen); set(`sch_${d}_terug`, f.schedule[d].terug);
    const a = f.availability[d];
    dom.el(`${pre}_av_${d}_heen`).checked = a.heen; dom.el(`${pre}_av_${d}_terug`).checked = a.terug;
    dom.el(`${pre}_bkH_${d}`).checked = a.backupHeen; dom.el(`${pre}_bkT_${d}`).checked = a.backupTerug;
  });
}
test('readFamilyForm reads back exactly what was typed, with normalised phone keys', () => {
  resetState({});
  const f = sampleParentState().families.f2; fillForm({ ...f, parentPhone1: '06-22 22 22 22' });
  const r = readFamilyForm('me');
  assert.equal(r.parentName, 'Piet Pieters'); assert.deepEqual(r.phoneKeys, ['0622222222']); assert.equal(r.capacity, 5);
  assert.deepEqual(r.schedule, f.schedule); assert.deepEqual(r.availability, f.availability);
});

console.log('\n=== test view as a parent ===');
test('banner shows who the coordinator is viewing as, and hides when off', () => {
  useFakeDb({}); sampleCoordinatorState({ impersonateFamilyId: 'f2' });
  renderImpersonateBanner();
  assert.match(text(dom.html('impersonateBanner')), /Testweergave als: Jahaimy Stop testen/);
  S.impersonateFamilyId = null; renderImpersonateBanner();
  assert.equal(dom.html('impersonateBanner'), ''); assert.equal(dom.el('impersonateBanner').style.display, 'none');
});
test('starting the test view drops coordinator rights; stopping restores them', () => {
  useFakeDb(sampleDbSeed()); sampleCoordinatorState({ links: { coord: { familyId: 'f1' } } });
  withFakeNow(NOW, () => startImpersonate('f2'));
  assert.equal(S.impersonateFamilyId, 'f2'); assert.equal(S.canEdit, false); assert.equal(S.roosterMode, 'week');
  assert.equal(dom.el('navBeheer').style.display, 'none');
  withFakeNow(NOW, () => stopImpersonate());
  assert.equal(S.impersonateFamilyId, null); assert.equal(S.canEdit, true); assert.equal(S.roosterMode, 'standard');
  assert.equal(dom.el('navBeheer').style.display, '');
});
test('starting without a family id does nothing', () => {
  sampleCoordinatorState();
  startImpersonate('');
  assert.equal(S.impersonateFamilyId, undefined === S.impersonateFamilyId ? undefined : S.impersonateFamilyId);
  assert.ok(!S.impersonateFamilyId);
});



console.log('\n=== gezinstype Vast/Flex (US-05) ===');
test('the coordinator form has a Vast/Flex choice, default Vast; the parent form does not', () => {
  sampleCoordinatorState();
  const coordHtml = familyFormHtml('coord', { ...sampleParentState().families.f2 });
  assert.match(coordHtml, /id="coord_familyType"/); assert.match(coordHtml, /<option value="vast" selected>/);
  const flexHtml = familyFormHtml('coord', { ...sampleParentState().families.f2, familyType: 'flex' });
  assert.match(flexHtml, /<option value="flex" selected>/); assert.doesNotMatch(flexHtml, /<option value="vast" selected>/);
  assert.doesNotMatch(familyFormHtml('me', sampleParentState().families.f2), /familyType/);
});
test('readFamilyForm returns the chosen type for the coordinator form only', () => {
  resetState({});
  const f = sampleParentState().families.f2; fillForm(f, 'coord'); fillForm(f, 'me');
  dom.el('coord_familyType').value = 'flex'; dom.el('me_familyType').value = 'flex';
  assert.equal(readFamilyForm('coord').familyType, 'flex');
  assert.equal('familyType' in readFamilyForm('me'), false, 'a parent saving their own family never changes the type');
  dom.el('coord_familyType').value = 'vast'; assert.equal(readFamilyForm('coord').familyType, 'vast');
  dom.el('coord_familyType').value = 'rubbish'; assert.equal('familyType' in readFamilyForm('coord'), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
