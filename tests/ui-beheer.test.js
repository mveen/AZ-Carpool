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
import { S } from '../state.js';
import {
  renderBeheer, renderAvailabilityTable, renderPrefsCard, renderPriorityCard, renderShiftPriorityRows, movePriority, renderCoordEditor,
  seedFromPdf, timeChangesCardHtml, updateTimeChangesBadge, notifyCoordinatorOfNewTimeChanges,
} from '../ui-beheer.js';

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

import { dayCoordinatorsCardHtml, saveDayCoordinator } from '../ui-beheer.js';

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
import { locationsCardHtml, saveLocations } from '../ui-beheer.js';
test('Beheer has a card with the three places, exact addresses, the destination, defaults and fixed distances', () => {
  sampleCoordinatorState({ locationsDoc: { places: [{ id: 'busstation' }, { id: 'a4-de-hoek' }, { id: 'de-parel', address: 'Parelstraat 1, Aalsmeer' }], fixedKm: { AFC: 36 } } });
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

console.log('\n=== Periode met andere tijden (Beheer) ===');
import { periodStatusHtml, periodCardHtml, periodPhaseText, rememberPeriodDraft, savePeriod, cancelPeriodEdit, deletePeriod } from '../ui-beheer.js';
const PERIOD = { name: 'Herfstvakantie', firstDay: '2026-10-26', lastDay: '2026-10-30', opensOn: '2026-10-14', deadlineDate: '2026-10-16', deadlineTime: '12:00' };
const fillPeriodForm = v => {
  const ids = { name: 'periodName', firstDay: 'periodFirst', lastDay: 'periodLast', opensOn: 'periodOpens', deadlineDate: 'periodDlDate', deadlineTime: 'periodDlTime' };
  Object.entries(ids).forEach(([k, id]) => { dom.el(id).value = v[k]; });
};
test('with no period the card shows an empty form, the limit and the hints from the design', () => {
  sampleCoordinatorState();
  const html = periodCardHtml(); const s = text(html);
  assert.match(s, /^Periode met andere tijden Ouders geven voor deze periode één keer hun tijden door\. Het vaste rooster blijft staan\./);
  assert.match(s, /Nog geen periode ingesteld\./); assert.match(s, /Periode is maximaal 10 werkdagen \(2 weken\)\./);
  assert.match(s, /Vanaf dan krijgt iedereen de melding op Wijzigen\./); assert.match(s, /Staat in de melding voor ouders\./);
  assert.match(html, /id="periodName"[^>]*value=""/); assert.match(html, /id="periodFirst"[^>]*type="date"|type="date"[^>]*id="periodFirst"/);
  assert.match(html, /id="periodSave"/); assert.match(html, /id="periodCancel"/);
  assert.ok(!/id="periodDelete"/.test(html), 'nothing to delete yet');
});
test('a saved period fills the form and shows where it stands; only then a trash button appears', () => {
  sampleCoordinatorState({ period: PERIOD });
  const html = withFakeNow(NOW, () => periodCardHtml());
  assert.match(html, /id="periodName"[^>]*value="Herfstvakantie"/);
  assert.match(html, /type="date" id="periodFirst" class="periodInput" value="2026-10-26"/); assert.match(html, /id="periodLast"[^>]*value="2026-10-30"/);
  assert.match(html, /id="periodOpens"[^>]*value="2026-10-14"/); assert.match(html, /id="periodDlDate"[^>]*value="2026-10-16"/); assert.match(html, /id="periodDlTime"[^>]*value="12:00"/);
  assert.match(text(html), /Invullen opent op/); assert.match(html, /id="periodDelete"[^>]*aria-label="Verwijder periode"/);
});
test('unsaved edits (the draft) win over the saved period, so a live update cannot wipe what is typed', () => {
  sampleCoordinatorState({ period: PERIOD, periodDraft: { ...PERIOD, name: 'Proefwerkweek' } });
  const html = periodCardHtml();
  assert.match(html, /id="periodName"[^>]*value="Proefwerkweek"/); assert.ok(!/id="periodPhase"/.test(html), 'no status line for an unsaved form');
});
test('the phase text says what happens next (waiting, open, closed, over)', () => {
  const at = iso => new Date(iso).getTime();
  assert.equal(periodPhaseText(null), 'Nog geen periode ingesteld.');
  assert.match(periodPhaseText(PERIOD, at('2026-10-01T10:00:00+02:00')), /^Invullen opent op wo 14 okt\.$/);
  assert.match(periodPhaseText(PERIOD, at('2026-10-15T10:00:00+02:00')), /^Invullen is open tot de deadline: vr 16 okt 12:00\.$/);
  assert.match(periodPhaseText(PERIOD, at('2026-10-20T10:00:00+02:00')), /^De deadline is voorbij \(vr 16 okt 12:00\)\. Alleen de coördinator kan nog tijden aanpassen\.$/);
  assert.match(periodPhaseText(PERIOD, at('2026-11-02T10:00:00+01:00')), /^Deze periode is voorbij\./);
});
test('the card is part of the Beheer page for the coordinator, and a parent never gets it', () => {
  useFakeDb(sampleDbSeed()); sampleCoordinatorState();
  withFakeNow(NOW, () => renderBeheer());
  assert.match(dom.html('tab-beheer'), /id="periodCard"/);
  sampleParentState(); withFakeNow(NOW, () => renderBeheer());
  assert.ok(!/periodCard/.test(dom.html('tab-beheer')));
});
test('rememberPeriodDraft keeps what is typed in the form', () => {
  sampleCoordinatorState(); fillPeriodForm({ ...PERIOD, name: ' Half getypt ' });
  rememberPeriodDraft();
  assert.equal(S.periodDraft.name, 'Half getypt'); assert.equal(S.periodDraft.deadlineTime, '12:00');
});
await testAsync('Opslaan stores one settings/period document and clears the draft', async () => {
  const fake = useFakeDb({}); sampleCoordinatorState({ periodDraft: { name: 'x' } });
  fillPeriodForm({ ...PERIOD, name: '  Herfstvakantie ' });
  assert.equal(await savePeriod(), true);
  assert.deepEqual(fake.get('settings/period'), { ...PERIOD, deadlineAt: new Date('2026-10-16T12:00:00+02:00').getTime() });   // deadlineAt: what firestore.rules check
  assert.deepEqual(S.period, PERIOD); assert.equal(S.periodDraft, null); assert.equal(toast(), 'Periode opgeslagen');
});
await testAsync('an invalid period is not stored: the first problem is shown and the typed values are kept', async () => {
  const fake = useFakeDb({}); sampleCoordinatorState();
  fillPeriodForm({ ...PERIOD, lastDay: '2026-11-09' });
  assert.equal(await savePeriod(), false);
  assert.equal(fake.get('settings/period'), undefined); assert.equal(S.period, null);
  assert.equal(toast(), 'Een periode is maximaal 10 werkdagen.');
  assert.equal(S.periodDraft.lastDay, '2026-11-09');
  fillPeriodForm({ ...PERIOD, name: '' });
  await savePeriod(); assert.equal(toast(), 'Vul een naam in.');
  fillPeriodForm({ ...PERIOD, deadlineDate: '2026-10-26' });
  await savePeriod(); assert.equal(toast(), 'De deadline moet vóór de eerste dag van de periode liggen.');
});
await testAsync('a refused save is reported and the saved period is not changed', async () => {
  const fake = useFakeDb({ 'settings/period': PERIOD }); sampleCoordinatorState({ period: PERIOD }); fake.failWrites('settings/period', 'permission-denied');
  fillPeriodForm({ ...PERIOD, name: 'Anders' });
  assert.equal(await savePeriod(), false);
  assert.match(toast(), /permission-denied/); assert.equal(S.period.name, 'Herfstvakantie'); assert.equal(fake.get('settings/period').name, 'Herfstvakantie');
});
test('Annuleren throws away the unsaved edits and shows the saved period again', () => {
  useFakeDb(sampleDbSeed()); sampleCoordinatorState({ period: PERIOD, periodDraft: { ...PERIOD, name: 'Anders' } });
  withFakeNow(NOW, () => cancelPeriodEdit());
  assert.equal(S.periodDraft, null); assert.match(dom.html('tab-beheer'), /id="periodName"[^>]*value="Herfstvakantie"/);
});
await testAsync('the trash button removes the period from the database and the state', async () => {
  const fake = useFakeDb({ 'settings/period': PERIOD }); sampleCoordinatorState({ period: PERIOD });
  assert.equal(await deletePeriod(), true);
  assert.equal(fake.get('settings/period'), undefined); assert.equal(S.period, null); assert.equal(toast(), 'Periode verwijderd');
});

test('Beheer shows how many families handed in ("9 van 14 gezinnen"): only from the day filling in opens, Flex families not counted', () => {
  const fams = sampleCoordinatorState().families; fams.f6 = { ...fams.f6, familyType: 'flex' };
  const entries = { '2026-10-26_f2': {}, '2026-10-26_f3': {}, '2026-10-26_f6': {} };
  sampleCoordinatorState({ period: PERIOD, families: fams, periodEntries: entries, periodEntriesLoaded: true });
  const at = iso => new Date(iso).getTime();
  assert.equal(periodStatusHtml(at('2026-10-13T12:00:00+02:00')), '', 'before filling in opens');
  assert.match(text(periodStatusHtml(at('2026-10-15T12:00:00+02:00'))), /^Doorgegeven 2 van 5 gezinnen$/);
  assert.match(text(periodStatusHtml(at('2026-10-20T12:00:00+02:00'))), /^Doorgegeven 2 van 5 gezinnen$/);
  assert.equal(periodStatusHtml(at('2026-11-05T12:00:00+01:00')).includes('2 van 5'), true, 'still shown after the period, as a record');
  sampleCoordinatorState({ period: PERIOD, periodEntries: entries, periodEntriesLoaded: false }); assert.equal(periodStatusHtml(at('2026-10-15T12:00:00+02:00')), '', 'not before the entries are loaded');
  sampleCoordinatorState({ periodEntries: {}, periodEntriesLoaded: true }); assert.equal(periodStatusHtml(at('2026-10-15T12:00:00+02:00')), '', 'no period');
});
test('the status is part of the card, but not while the form has unsaved edits', () => {
  sampleCoordinatorState({ period: PERIOD, periodEntries: { '2026-10-26_f2': {} }, periodEntriesLoaded: true });
  assert.match(text(withFakeNow('2026-10-15T12:00:00+02:00', () => periodCardHtml())), /Staat in de melding voor ouders\. Doorgegeven 1 van 6 gezinnen/);
  sampleCoordinatorState({ period: PERIOD, periodDraft: { ...PERIOD, name: 'x' }, periodEntries: {}, periodEntriesLoaded: true });
  assert.doesNotMatch(withFakeNow('2026-10-15T12:00:00+02:00', () => periodCardHtml()), /periodStatus/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
