// Run with: node ui-beheer.test.js
// The Beheer tab (coordinator only): families, shift priority, travel preferences, availability overview,
// planning settings, match calendars, and the "Gewijzigde tijden" notifications.
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
import { installFakeDom, sampleCoordinatorState, sampleParentState, useFakeDb, sampleDbSeed, withFakeNow, NOW, expectSnapshot, resetState } from './test-support.js';
import { S } from './state.js';
import {
  renderBeheer, renderAvailabilityTable, renderPrefsCard, renderPriorityCard, renderShiftPriorityRows, movePriority, renderCoordEditor,
  seedFromPdf, timeChangesCardHtml, updateTimeChangesBadge, notifyCoordinatorOfNewTimeChanges,
} from './ui-beheer.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const toast = () => dom.doc.getElementById('toast').innerHTML;

console.log('=== families list ===');
test('every family is listed with parent, coordinator badge, invite code state and a Wijzig button', () => {
  const fake = useFakeDb(sampleDbSeed());
  sampleCoordinatorState({ links: { p1: { familyId: 'f2' } }, invitesByCode: { CODE1234: 'f3' }, inviteByFamily: { f3: 'CODE1234' } });
  withFakeNow(NOW, () => renderBeheer());
  const html = dom.html('tab-beheer'); const s = text(html);
  assert.match(s, /^Gezinnen beheren /);
  assert.match(s, /Eline Jan Jansen COÖRDINATOR Geen code Wijzig/);
  assert.match(s, /Jahaimy Piet Pieters gekoppeld Geen code Wijzig/);
  assert.match(s, /Anouk Kees de Vries Wijzig/);
  assert.match(s, /\+ Nieuw gezin toevoegen/);
  expectSnapshot('ui-beheer', 'coordinator overview', html);
});
test('without coordinator rights nothing sensitive is rendered', () => {
  useFakeDb(sampleDbSeed()); sampleParentState();
  withFakeNow(NOW, () => renderBeheer());
  assert.ok(!/Gezinnen beheren/.test(dom.html('tab-beheer')));
});
test('the family editor opens for the chosen family, with an invite code field', () => {
  useFakeDb(sampleDbSeed());
  sampleCoordinatorState({ coordEditId: 'f2', invitesByCode: { CODE1234: 'f2' }, inviteByFamily: { f2: 'CODE1234' } });
  withFakeNow(NOW, () => { renderBeheer(); renderCoordEditor(); });
  const html = dom.html('coordEditArea');
  assert.match(html, /id="coord_parentName"/); assert.match(html, /value="Piet Pieters"/); assert.match(html, /id="coord_inviteCode"[^>]*value="CODE1234"/);
});
test('the editor for a new family starts empty', () => {
  sampleCoordinatorState({ coordEditId: null });
  withFakeNow(NOW, () => renderCoordEditor());
  assert.match(text(dom.html('coordEditArea')), /Nieuw gezin toevoegen/);
});

console.log('\n=== overview cards ===');
test('availability table: seats per driver for every day and direction (grey = back-up)', () => {
  sampleCoordinatorState();
  const s = text(renderAvailabilityTable());
  assert.match(s, /Jan Jansen 3 3 – – – – 3 3 – –/); assert.match(s, /Kees de Vries 5 5 – – 5 5 – – – –/); assert.match(s, /Sanne Smit – – – – – – – – – –/);
});
test('preferences card: empty message, and rules rendered in plain words', () => {
  sampleCoordinatorState();
  assert.match(text(renderPrefsCard()), /Nog geen voorkeuren\./);
  S.prefs = { rules: [{ type: 'together', ids: ['f1', 'f2'] }, { type: 'prefer', girlId: 'f3', withAny: ['f1', 'f4'] }] };
  const s = text(renderPrefsCard());
  assert.match(s, /Samen reizen: Eline & Jahaimy/); assert.match(s, /Voorkeur: Anouk met Eline .*Evi/);
});
test('priority card lists all ten shifts; rows show the drivers of the selected shift in order', () => {
  sampleCoordinatorState({ shiftPriority: { Ma_heen: { f2: 1, f1: 2 } }, selectedShiftKey: 'Ma_heen' });
  withFakeNow(NOW, () => renderBeheer());
  const s = text(dom.html('tab-beheer'));
  assert.match(s, /Maandag – Heen Maandag – Terug Dinsdag – Heen/); assert.match(s, /Vrijdag – Terug/);
  withFakeNow(NOW, () => renderShiftPriorityRows('Ma_heen'));
  const rows = text(dom.html('shiftPriorityRows'));
  assert.ok(rows.indexOf('Piet Pieters') < rows.indexOf('Jan Jansen'), 'rank 1 (Piet) is listed before rank 2 (Jan)');
});
await testAsync('movePriority moves a driver up or down one place and saves the order', async () => {
  const fake = useFakeDb({});
  sampleCoordinatorState({ shiftPriority: { Ma_heen: { f1: 1, f2: 2, f3: 3 } } });
  await movePriority('Ma_heen', ['f1', 'f2', 'f3'], 'f3', -1);
  assert.deepEqual(fake.get('settings/priority').Ma_heen, { f1: 1, f3: 2, f2: 3 });
  assert.equal(toast(), 'Volgorde opgeslagen ✓');
});

console.log('\n=== Gewijzigde tijden (time changes) ===');
const change = { day: 'Ma', direction: 'heen', from: '08:30', to: '09:00' };
function withChange(patch = {}) {
  const fams = sampleCoordinatorState().families;
  fams.f2.timeChanges = [{ ...change, at: new Date('2026-09-28T14:53:00+02:00').getTime(), by: 'Piet' }];
  return sampleCoordinatorState({ families: fams, ...patch });
}
test('the card shows who changed which time, and is empty for a parent or without changes', () => {
  withChange();
  const s = text(timeChangesCardHtml());
  assert.match(s, /Gewijzigde tijden \(1\)/); assert.match(s, /Jahaimy door Piet · 28-09, 14:53 Gezien/); assert.match(s, /MA Heen \(aankomst Alkmaar\): 08:30 → 09:00/);
  sampleParentState(); assert.equal(timeChangesCardHtml(), '');
  sampleCoordinatorState(); assert.equal(timeChangesCardHtml(), '');
});
test('the Rooster tab badge counts pending changes (9+ when many), hidden for none and for parents', () => {
  withChange(); updateTimeChangesBadge();
  assert.equal(dom.html('navRoosterBadge') || dom.el('navRoosterBadge').textContent, '1'); assert.equal(dom.el('navRoosterBadge').style.display, '');
  sampleCoordinatorState(); updateTimeChangesBadge(); assert.equal(dom.el('navRoosterBadge').style.display, 'none');
});
test('the Rooster badge shows 9+ when more than nine changes are pending', () => {
  const fams = sampleCoordinatorState().families;
  fams.f2.timeChanges = Array.from({ length: 10 }, (_, i) => ({ ...change, day: 'Ma', at: 1000 + i, by: 'Piet' }));
  sampleCoordinatorState({ families: fams }); updateTimeChangesBadge();
  assert.equal(dom.html('navRoosterBadge') || dom.el('navRoosterBadge').textContent, '9+');
});
test('a NEW change while the coordinator has the app open shows a toast; the first snapshot never does', () => {
  sampleCoordinatorState({ lastPendingChangeCount: null }); notifyCoordinatorOfNewTimeChanges();
  assert.equal(S.lastPendingChangeCount, 0);
  const before = toast();
  withChange({ lastPendingChangeCount: 0 }); notifyCoordinatorOfNewTimeChanges();
  assert.equal(S.lastPendingChangeCount, 1); assert.equal(toast(), 'Nieuwe tijdswijziging van Jahaimy — zie Rooster');
  assert.notEqual(toast(), before);
});
test('no toast for parents or when the count did not grow', () => {
  dom.doc.getElementById('toast').innerHTML = '';
  withChange({ lastPendingChangeCount: 1 }); notifyCoordinatorOfNewTimeChanges();
  assert.equal(toast(), '');
  const fams = sampleParentState().families; fams.f2.timeChanges = [change];
  sampleParentState({ families: fams, lastPendingChangeCount: 0 }); notifyCoordinatorOfNewTimeChanges();
  assert.equal(toast(), '');
});

console.log('\n=== seed from PDF ===');
await testAsync('seedFromPdf replaces families, invites and groups by the 8 PDF families and validates them', async () => {
  const fake = useFakeDb({ 'families/old': {}, 'invites/X': {}, 'groups/g': {} });
  sampleCoordinatorState();
  await seedFromPdf();
  assert.equal(fake.collection('families').length, 8); assert.equal(fake.collection('invites').length, 0); assert.equal(fake.collection('groups').length, 0);
  assert.match(text(dom.html('seedMsg') || dom.el('seedMsg').textContent), /gezinnen aangemaakt/);
});

import { dayCoordinatorsCardHtml, saveDayCoordinator } from './ui-beheer.js';

console.log('\n=== Dagcoördinatoren (US-02) ===');
test('Beheer has a card with one family choice per weekday, names taken from the families', () => {
  sampleCoordinatorState({ dayCoordinators: { Di: 'f2' } });
  const html = dayCoordinatorsCardHtml();
  assert.equal((html.match(/class="dayCoordSel"/g) || []).length, 5);
  assert.match(text(html), /Dagcoördinatoren Kies per weekdag/);
  assert.match(html, /<select id="dayCoord_Di"[^>]*>[\s\S]*<option value="f2" selected>Piet Pieters \(Jahaimy\)<\/option>/);
  assert.match(html, /<option value="f1" >Jan Jansen \(Eline\)<\/option>/);
  assert.match(html, /-- niemand --/);
});
test('the card is part of the Beheer tab', () => {
  withFakeNow(NOW, () => { sampleCoordinatorState(); renderBeheer(); });
  assert.match(dom.html('tab-beheer'), /id="dayCoordCard"/);
});
await testAsync('choosing a family saves it to settings/dayCoordinators; choosing "niemand" removes the day', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ dayCoordinators: {} });
  assert.equal(await saveDayCoordinator('Ma', 'f1'), true);
  assert.deepEqual(fake.get('settings/dayCoordinators'), { Ma: 'f1' });
  await saveDayCoordinator('Di', 'f2');
  assert.deepEqual(fake.get('settings/dayCoordinators'), { Ma: 'f1', Di: 'f2' });
  assert.match(toast(), /Dagcoördinator opgeslagen/);
  await saveDayCoordinator('Ma', '');
  assert.deepEqual(fake.get('settings/dayCoordinators'), { Di: 'f2' });
});
await testAsync('a refused save is reported and the state is not changed', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ dayCoordinators: { Ma: 'f1' } }); fake.failWrites('settings/', 'denied');
  assert.equal(await saveDayCoordinator('Ma', 'f2'), false);
  assert.deepEqual(S.dayCoordinators, { Ma: 'f1' });
});
test('a Flex family is marked in the family list', () => {
  const fams = sampleCoordinatorState().families; fams.f5 = { ...fams.f5, familyType: 'flex' };
  withFakeNow(NOW, () => { sampleCoordinatorState({ families: fams }); renderBeheer(); });
  const html = dom.html('tab-beheer');
  assert.equal((html.match(/badge flexBadge">Flex</g) || []).length, 1);
  assert.match(text(html), /Sanne Smit Flex/);
});

console.log('\n=== places, fixed distances and impact preview (US-15, US-21, US-07) ===');
import { locationsCardHtml, saveLocations } from './ui-beheer.js';
test('Beheer has a card with the three places, exact addresses, the destination, defaults and fixed distances', () => {
  sampleCoordinatorState({ locationsDoc: { places: [{ id: 'de-parel', address: 'Parelstraat 1, Aalsmeer' }], fixedKm: { AFC: 36 } } });
  const html = locationsCardHtml();
  ['busstation', 'a4-de-hoek', 'de-parel'].forEach(id => assert.match(html, new RegExp(`id="locName_${id}"`)));
  assert.match(html, /id="locAddr_de-parel" value="Parelstraat 1, Aalsmeer"/);
  assert.match(html, /id="locDestName" value="AFC &#39;34"/); assert.match(html, /id="locFixAFC"[^>]*value="36"/); assert.match(html, /id="locFixATC"[^>]*value=""/);
  assert.match(html, /id="locDefHeen">.*<option value="busstation" selected>/);
});
test('the card and the impact-preview switch are part of the Beheer page', () => {
  useFakeDb(sampleDbSeed()); sampleCoordinatorState({ impactPreview: false });
  withFakeNow(NOW, () => renderBeheer());
  assert.match(dom.html('tab-beheer'), /id="locationsCard"/); assert.match(dom.html('tab-beheer'), /id="impactToggle" >/);
});
await testAsync('saveLocations stores one settings/locations document, normalised', async () => {
  const fake = useFakeDb({}); sampleCoordinatorState();
  const set = { locName_busstation: ' Bus ', locAddr_busstation: 'Stationsweg 1', locDestName: '', locDestAddr: 'Alkmaar', locDefHeen: 'de-parel', locDefTerug: 'nope', locFixAFC: '36,5', locFixATC: '' };
  Object.entries(set).forEach(([id, v]) => { dom.el(id).value = v; });
  assert.equal(await saveLocations(), true);
  const d = fake.get('settings/locations');
  assert.equal(d.places.find(p => p.id === 'busstation').name, 'Bus'); assert.equal(d.places.find(p => p.id === 'busstation').address, 'Stationsweg 1');
  assert.equal(d.destination.name, "AFC '34"); assert.equal(d.destination.address, 'Alkmaar');
  assert.deepEqual(d.defaults, { heen: 'de-parel', terug: 'busstation' }); assert.deepEqual(d.fixedKm, { AFC: 36.5, ATC: null });
  assert.equal(S.locationsDoc.fixedKm.AFC, 36.5); assert.equal(dom.doc.getElementById('toast').innerHTML, 'Plekken opgeslagen');
});
await testAsync('a refused save shows the error and returns false', async () => {
  const fake = useFakeDb({}); sampleCoordinatorState(); fake.failWrites('settings/locations', 'permission-denied');
  assert.equal(await saveLocations(), false); assert.match(dom.doc.getElementById('toast').innerHTML, /permission-denied/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
