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
import { installFakeDom, withFakeNowAsync, sampleCoordinatorState, sampleParentState, useFakeDb, sampleDbSeed, withFakeNow, NOW, expectSnapshot, resetState, oneP } from './test-support.js';
import { S } from '../state.js';
import { foldCards } from '../ui-common.js';
import {
  renderBeheer, renderAvailabilityTable, renderPrefsCard, renderPriorityCard, renderShiftPriorityRows, movePriority, renderCoordEditor,
  seedFromPdf, familyBackupCardHtml, prepareRestore, confirmRestore, cancelRestore, timeChangesCardHtml, updateTimeChangesBadge, notifyCoordinatorOfNewTimeChanges,
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
test('the family editor has a WhatsApp login-intro icon after the phone field, using the invite code', () => {
  useFakeDb(sampleDbSeed());
  sampleCoordinatorState({ coordEditId: 'f2', invitesByCode: { CODE1234: 'f2' }, inviteByFamily: { f2: 'CODE1234' } });
  withFakeNow(NOW, () => { renderBeheer(); renderCoordEditor(); });
  const html = dom.html('coordEditArea');
  assert.match(html, /class="waIntro" data-waintro="1"/); assert.doesNotMatch(html, /<button[^>]*waIntro/);
  assert.match(decodeURIComponent(html), /CODE1234/);
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

console.log('\n=== Perioden met andere tijden (Beheer) ===');
import { periodStatusHtml, periodsCardHtml, periodPhaseText, periodDeleteConfirmLabel, startPeriodEdit, rememberPeriodDraft, savePeriod, cancelPeriodEdit, deletePeriod } from '../ui-beheer.js';
const PERIOD = { name: 'Herfstvakantie', firstDay: '2026-10-26', lastDay: '2026-10-30', opensOn: '2026-10-14', deadlineDate: '2026-10-16', deadlineTime: '12:00' };
const NEXT = { name: 'Toetsweek', firstDay: '2026-11-09', lastDay: '2026-11-13', opensOn: '2026-10-27', deadlineDate: '2026-11-04', deadlineTime: '12:00' };
const at = iso => new Date(iso).getTime(), OPENNOW = '2026-10-15T12:00:00+02:00';
const two = () => ({ [PERIOD.firstDay]: PERIOD, [NEXT.firstDay]: NEXT });
const state = (patch = {}) => sampleCoordinatorState({ periods: two(), periodsColl: two(), periodEntries: {}, periodEntriesLoaded: true, periodCars: {}, ...patch });
const fillPeriodForm = v => {
  const ids = { name: 'periodName', firstDay: 'periodFirst', lastDay: 'periodLast', opensOn: 'periodOpens', deadlineDate: 'periodDlDate', deadlineTime: 'periodDlTime' };
  Object.entries(ids).forEach(([k, id]) => { dom.el(id).value = v[k]; });
};
// The buttons of the list, made from the html so the handlers the page wired up can be used.
function pageButtons(html) {
  const mk = attr => [...html.matchAll(new RegExp(`<button[^>]*data-${attr}(?:="([^"]*)")?`, 'g'))].map(m => ({ dataset: { [attr]: m[1] || '' }, onclick: null, textContent: '', innerHTML: '' }));
  const reg = { '[data-plistadd]': mk('plistadd'), '[data-plistedit]': mk('plistedit'), '[data-plistdelete]': mk('plistdelete') };
  dom.doc.querySelectorAll = sel => reg[sel] || [];
  return reg;
}
test('with no period the card explains, says so and offers "+ Periode toevoegen"; no form yet', () => {
  sampleCoordinatorState({ periods: {}, periodEntries: {}, periodEntriesLoaded: true });
  const html = periodsCardHtml(); const s = text(html);
  assert.match(s, /^Perioden met andere tijden Ouders geven voor een periode één keer hun tijden door\. Het vaste rooster blijft staan\. Je kunt meerdere perioden hebben.*Perioden mogen geen dag delen\./);
  assert.match(s, /Nog geen periode ingesteld\./); assert.match(s, /\+ Periode toevoegen$/);
  assert.doesNotMatch(html, /id="periodName"|periodDraftSave|data-plistedit|data-plistdelete/);
});
test('every period is a row: name, dates, where it stands, how many handed in, and edit and delete buttons', () => {
  state(); const s = text(withFakeNow(OPENNOW, () => periodsCardHtml())); const html = withFakeNow(OPENNOW, () => periodsCardHtml());
  assert.match(s, /Herfstvakantie 26 – 30 okt Invullen is open tot de deadline: vr 16 okt 12:00\. Doorgegeven 0 van 6 gezinnen/);
  assert.match(s, /Toetsweek 9 – 13 nov Invullen opent op di 27 okt\./);
  assert.ok(html.indexOf('Herfstvakantie') < html.indexOf('Toetsweek'), 'oldest first');
  assert.equal((html.match(/data-plistedit=/g) || []).length, 2); assert.equal((html.match(/data-plistdelete=/g) || []).length, 2);
  assert.match(html, /data-plistedit="2026-10-26"[^>]*aria-label="Wijzig Herfstvakantie"/); assert.match(html, /data-plistdelete="2026-11-09"[^>]*aria-label="Verwijder periode: Toetsweek"/);
  assert.match(html, /data-plistdelete="[^"]*"[^>]*>\s*<svg/, 'the trash icon');
});
test('the status line counts per period, only once filling in has opened, without Flex families', () => {
  const fams = sampleCoordinatorState().families; fams.f6 = { ...fams.f6, familyType: 'flex' };
  state({ families: fams, periodEntries: { '2026-10-26_f2': {}, '2026-10-26_f3': {}, '2026-10-26_f6': {}, '2026-11-09_f2': {} } });
  assert.equal(periodStatusHtml(PERIOD, at('2026-10-13T12:00:00+02:00')), '', 'before filling in opens');
  assert.match(text(periodStatusHtml(PERIOD, at(OPENNOW))), /^Doorgegeven 2 van 5 gezinnen$/); assert.match(text(periodStatusHtml(NEXT, at('2026-10-28T12:00:00+01:00'))), /^Doorgegeven 1 van 5 gezinnen$/);
  assert.match(text(periodStatusHtml(PERIOD, at('2026-11-05T12:00:00+01:00'))), /2 van 5/, 'still shown after the period, as a record');
  state({ periodEntriesLoaded: false }); assert.equal(periodStatusHtml(PERIOD, at(OPENNOW)), ''); assert.equal(periodStatusHtml(null, at(OPENNOW)), '');
});
test('a period with a temporary rooster says so in its row', () => {
  state({ periodCars: { '2026-10-26_2026-10-27_terug': { periodFirstDay: '2026-10-26', date: '2026-10-27', direction: 'terug', cars: [] } } });
  const s = text(withFakeNow(OPENNOW, () => periodsCardHtml())); assert.match(s, /Herfstvakantie 26 – 30 okt .*tijdelijk rooster gemaakt/); assert.doesNotMatch(s.slice(s.indexOf('Toetsweek')), /tijdelijk rooster gemaakt/);
});
test('the delete button asks "Zeker?" and says how many families lose their times', () => {
  state({ periodEntries: { '2026-10-26_f2': { periodFirstDay: '2026-10-26' }, '2026-10-26_f3': { periodFirstDay: '2026-10-26' } } });
  assert.equal(periodDeleteConfirmLabel(PERIOD), 'Zeker? 2 gezinnen verliezen hun tijden'); assert.equal(periodDeleteConfirmLabel(NEXT), 'Zeker? Nogmaals klikken');
});
test('"+ Periode toevoegen" opens an empty form: title, fields, limit and hints from the design, Opslaan and Annuleren', () => {
  state(); startPeriodEdit();
  assert.deepEqual([S.periodDraft.editing, S.periodDraft.value.name], ['', '']);
  const html = periodsCardHtml(); const s = text(html);
  assert.match(s, /Periode toevoegen Naam Eerste dag Laatste dag Periode is maximaal 10 werkdagen \(2 weken\)\. Invullen open vanaf Vanaf dan krijgt iedereen de melding op Wijzigen\. Deadline \(datum\) Deadline \(tijd\) Staat in de melding voor ouders\. Opslaan Annuleren/);
  assert.match(html, /id="periodName"[^>]*value=""/); assert.match(html, /type="date" id="periodFirst"/); assert.match(html, /type="time" id="periodDlTime"/);
  assert.match(html, /id="periodDraftSave"/); assert.match(html, /id="periodDraftCancel"/); assert.doesNotMatch(html, /data-plistadd/, 'no second form at the same time');
  assert.match(html, /data-plistedit/, 'the list stays visible');
});
test('editing fills the form with that period; its first day is locked as soon as something is stored for it', () => {
  state(); startPeriodEdit('2026-11-09'); let html = periodsCardHtml();
  assert.match(html, /Periode wijzigen/); assert.match(html, /id="periodName"[^>]*value="Toetsweek"/); assert.match(html, /id="periodFirst" class="periodInput" value="2026-11-09" >/); assert.doesNotMatch(html, /firstDayLocked|kan niet meer worden gewijzigd/);
  state({ periodEntries: { '2026-11-09_f2': { periodFirstDay: '2026-11-09' } } }); startPeriodEdit('2026-11-09'); html = periodsCardHtml();
  assert.match(html, /id="periodFirst"[^>]*disabled/); assert.match(text(html), /De eerste dag kan niet meer worden gewijzigd/);
  state(); startPeriodEdit('2099-01-01'); assert.equal(S.periodDraft.value.name, '', 'an unknown period opens an empty form');
});
test('unsaved edits (the draft) survive a redraw of the Beheer tab', () => {
  state(); startPeriodEdit(); fillPeriodForm({ ...NEXT, name: 'Half getypt' }); rememberPeriodDraft();
  assert.equal(S.periodDraft.value.name, 'Half getypt'); assert.match(withFakeNow(NOW, () => { renderBeheer(); return dom.html('tab-beheer'); }), /id="periodName"[^>]*value="Half getypt"/);
  S.periodDraft = null; rememberPeriodDraft(); assert.equal(S.periodDraft, null, 'nothing to remember without a form');
});
await testAsync('Opslaan stores a new period next to the others, closes the form and shows it in the list', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'periods/2026-10-26': PERIOD }); state({ periods: { [PERIOD.firstDay]: PERIOD }, periodsColl: { [PERIOD.firstDay]: PERIOD } });
  startPeriodEdit(); fillPeriodForm({ ...NEXT, name: '  Toetsweek ' });
  assert.equal(await savePeriod(), true);
  assert.deepEqual(fake.get('periods/2026-11-09'), { ...NEXT, deadlineAt: new Date('2026-11-04T12:00:00+01:00').getTime() });
  assert.equal(S.periodDraft, null); assert.deepEqual(Object.keys(S.periods), ['2026-10-26', '2026-11-09']); assert.equal(toast(), 'Periode opgeslagen');
  assert.match(text(withFakeNow(OPENNOW, () => periodsCardHtml())), /Toetsweek 9 – 13 nov/);
});
await testAsync('a period that shares a day with another is refused: the message names it and what was typed stays', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'periods/2026-10-26': PERIOD }); state({ periods: { [PERIOD.firstDay]: PERIOD }, periodsColl: { [PERIOD.firstDay]: PERIOD } });
  startPeriodEdit(); fillPeriodForm({ ...NEXT, firstDay: '2026-10-29', lastDay: '2026-11-03', opensOn: '2026-10-14', deadlineDate: '2026-10-16' });
  assert.equal(await savePeriod(), false); assert.equal(toast(), 'Deze periode overlapt met Herfstvakantie. Perioden mogen geen dag delen.');
  assert.equal(S.periodDraft.value.firstDay, '2026-10-29'); assert.equal(fake.get('periods/2026-10-29'), undefined);
});
await testAsync('an invalid period is not stored: the first problem is shown', async () => {
  const fake = useFakeDb({}); state({ periods: {}, periodsColl: {} }); startPeriodEdit();
  fillPeriodForm({ ...PERIOD, lastDay: '2026-11-09' }); assert.equal(await savePeriod(), false); assert.equal(toast(), 'Een periode is maximaal 10 werkdagen.');
  fillPeriodForm({ ...PERIOD, name: '' }); await savePeriod(); assert.equal(toast(), 'Vul een naam in.');
  fillPeriodForm({ ...PERIOD, deadlineDate: '2026-10-26' }); await savePeriod(); assert.equal(toast(), 'De deadline moet vóór de eerste dag van de periode liggen.');
  assert.equal(fake.writes.length, 0); assert.ok(S.periodDraft);
});
await testAsync('editing a period does not conflict with itself; other fields stay editable when the first day is locked', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'periods/2026-10-26': PERIOD }); state({ periods: { [PERIOD.firstDay]: PERIOD }, periodsColl: { [PERIOD.firstDay]: PERIOD }, periodEntries: { '2026-10-26_f2': { periodFirstDay: '2026-10-26' } } });
  startPeriodEdit('2026-10-26'); fillPeriodForm({ ...PERIOD, name: 'Herfst', lastDay: '2026-10-29' });
  assert.equal(await savePeriod(), true); assert.equal(fake.get('periods/2026-10-26').name, 'Herfst'); assert.equal(fake.get('periods/2026-10-26').lastDay, '2026-10-29');
  startPeriodEdit('2026-10-26'); fillPeriodForm({ ...PERIOD, firstDay: '2026-10-19', lastDay: '2026-10-23', opensOn: '2026-10-05', deadlineDate: '2026-10-09' });
  assert.equal(await savePeriod(), false); assert.match(toast(), /De eerste dag kan niet meer worden gewijzigd/); assert.ok(fake.get('periods/2026-10-26'));
});
await testAsync('a refused write is reported and the form stays open', async () => {
  const fake = useFakeDb({}); state({ periods: {}, periodsColl: {} }); fake.failWrites('periods/', 'permission-denied');
  startPeriodEdit(); fillPeriodForm(PERIOD); assert.equal(await savePeriod(), false); assert.match(toast(), /permission-denied/); assert.ok(S.periodDraft); assert.deepEqual(S.periods, {});
});
test('Annuleren throws away the unsaved edits', () => {
  useFakeDb(sampleDbSeed()); state(); startPeriodEdit('2026-11-09'); withFakeNow(NOW, () => cancelPeriodEdit());
  assert.equal(S.periodDraft, null); assert.doesNotMatch(dom.html('tab-beheer'), /periodDraftSave/); assert.match(dom.html('tab-beheer'), /data-plistadd/);
});
await testAsync('deleting removes that period and what was handed in for it; the other period stays', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'periods/2026-10-26': PERIOD, 'periods/2026-11-09': NEXT, 'periodEntries/2026-10-26_f2': { periodFirstDay: '2026-10-26' }, 'periodEntries/2026-11-09_f2': { periodFirstDay: '2026-11-09' } });
  state({ periodEntries: { '2026-10-26_f2': { periodFirstDay: '2026-10-26' }, '2026-11-09_f2': { periodFirstDay: '2026-11-09' } } });
  assert.equal(await withFakeNowAsync(NOW, () => deletePeriod('2026-10-26')), true);
  assert.equal(fake.get('periods/2026-10-26'), undefined); assert.equal(fake.get('periodEntries/2026-10-26_f2'), undefined); assert.ok(fake.get('periods/2026-11-09')); assert.ok(fake.get('periodEntries/2026-11-09_f2'));
  assert.doesNotMatch(dom.html('tab-beheer'), /Herfstvakantie/); assert.match(dom.html('tab-beheer'), /Toetsweek/);
});
await testAsync('a period with a temporary rooster cannot be deleted; deleting the period being edited closes its form', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'periods/2026-10-26': PERIOD }); state({ periods: { [PERIOD.firstDay]: PERIOD }, periodsColl: { [PERIOD.firstDay]: PERIOD }, periodCars: { '2026-10-26_2026-10-27_terug': { periodFirstDay: '2026-10-26', cars: [] } } });
  assert.equal(await withFakeNowAsync(NOW, () => deletePeriod('2026-10-26')), false); assert.match(toast(), /Verwijder eerst het tijdelijke rooster/); assert.ok(fake.get('periods/2026-10-26'));
  state({ periods: { [PERIOD.firstDay]: PERIOD }, periodsColl: { [PERIOD.firstDay]: PERIOD } }); startPeriodEdit('2026-10-26');
  assert.equal(await withFakeNowAsync(NOW, () => deletePeriod('2026-10-26')), true); assert.equal(S.periodDraft, null);
});
await testAsync('the buttons of the list are wired: add, edit and (two taps) delete', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'periods/2026-10-26': PERIOD, 'periods/2026-11-09': NEXT, 'periodEntries/2026-11-09_f2': { periodFirstDay: '2026-11-09' } });
  state({ periodEntries: { '2026-11-09_f2': { periodFirstDay: '2026-11-09' } } });
  const draw = () => withFakeNow(NOW, () => { renderBeheer(); return dom.html('tab-beheer'); });
  let reg = pageButtons(draw()); draw();   // the second drawing wires the buttons that were made from the first one
  reg['[data-plistedit]'][1].onclick(); assert.equal(S.periodDraft.editing, '2026-11-09'); assert.match(dom.html('tab-beheer'), /id="periodName"[^>]*value="Toetsweek"/);
  reg = pageButtons(draw()); draw(); assert.equal(reg['[data-plistadd]'].length, 0, 'the add button is gone while a form is open');
  dom.el('periodDraftCancel').onclick(); assert.equal(S.periodDraft, null);
  reg = pageButtons(draw()); draw(); reg['[data-plistadd]'][0].onclick(); assert.equal(S.periodDraft.editing, ''); cancelPeriodEdit();
  reg = pageButtons(draw()); draw();
  const del = reg['[data-plistdelete]'][1]; del.dataset.origLabel = ''; del.onclick();
  assert.equal(del.textContent, 'Zeker? 1 gezinnen verliezen hun tijden', 'the first tap asks and says what is lost'); assert.ok(fake.get('periods/2026-11-09'));
  await withFakeNowAsync(NOW, async () => { del.onclick(); for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); });
  assert.equal(fake.get('periods/2026-11-09'), undefined); assert.equal(fake.get('periodEntries/2026-11-09_f2'), undefined); assert.ok(fake.get('periods/2026-10-26'));
});
test('the periods card is part of the Beheer page for the coordinator, and a parent never gets it', () => {
  useFakeDb(sampleDbSeed()); state();
  assert.match(withFakeNow(NOW, () => { renderBeheer(); return dom.html('tab-beheer'); }), /id="periodCard"/);
  sampleParentState(); withFakeNow(NOW, () => renderBeheer()); assert.ok(!/periodCard/.test(dom.html('tab-beheer')));
});
test('periodPhaseText says what happens next (none, waiting, open, closed, over)', () => {
  assert.equal(periodPhaseText(null), 'Nog geen periode ingesteld.');
  assert.match(periodPhaseText(PERIOD, at('2026-10-01T10:00:00+02:00')), /^Invullen opent op wo 14 okt\.$/);
  assert.match(periodPhaseText(PERIOD, at('2026-10-15T10:00:00+02:00')), /^Invullen is open tot de deadline: vr 16 okt 12:00\.$/);
  assert.match(periodPhaseText(PERIOD, at('2026-10-20T10:00:00+02:00')), /^De deadline is voorbij \(vr 16 okt 12:00\)\. Alleen de coördinator kan nog tijden aanpassen\.$/);
  assert.match(periodPhaseText(PERIOD, at('2026-11-02T10:00:00+01:00')), /^Deze periode is voorbij\./);
});

test('the Beheer cards become collapsible sections (collapsed by default, own title as summary)', () => {
  const node = (extra = {}) => ({ dataset: {}, classList: { contains: () => false }, ...extra });
  const h2 = node({ textContent: ' Titel ', innerHTML: 'Titel', remove() { card.kids.shift(); } });
  const p = node();
  const card = node({ id: 'c1', kids: [h2, p], classList: { contains: c => c === 'card' },
    querySelector: () => h2, replaceWith(n) { card.replacedBy = n; } });
  const box = { children: [card, node()] };
  const realCreate = document.createElement;
  document.createElement = tag => { const e = node({ tag, kids: [], append(...c) { e.kids.push(...c); }, appendChild(c) { e.kids.push(c); card.kids.shift(); return c; } }); return e; };
  Object.defineProperty(card, 'firstChild', { get() { return card.kids[0] || null; }, configurable: true });
  S.folds = {};
  foldCards(box);
  document.createElement = realCreate;
  const det = card.replacedBy;
  assert.equal(det.tag, 'details'); assert.match(det.className, /fold card/); assert.equal(det.id, 'c1'); assert.ok(!det.open);
  assert.equal(det.dataset.fold, 'card|c1');
  assert.equal(det.kids[0].tag, 'summary'); assert.equal(det.kids[0].innerHTML, 'Titel');
  assert.equal(det.kids[1].className, 'foldBody'); assert.equal(det.kids[1].kids[0], p);
});


console.log('=== back-up gezinnen ===');
import { buildBackupCsv } from '../family-backup.js';
test('Beheer has a Back-up gezinnen card with Back-up maken and Terugzetten, and no pending check yet', () => {
  useFakeDb(sampleDbSeed()); sampleCoordinatorState();
  withFakeNow(NOW, () => renderBeheer());
  const html = dom.html('tab-beheer'); const s = text(html);
  assert.match(s, /Back-up gezinnen/); assert.match(s, /Back-up maken/); assert.match(s, /Terugzetten uit bestand/);
  assert.match(html, /id="backupFile"[^>]*type="file"|type="file"[^>]*id="backupFile"/);
  assert.ok(!/id="backupPending"/.test(html));
});
await testAsync('a good file shows what will happen; Overschrijven needs two taps and then writes the families', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ families: { ...sampleFamiliesForBackup() } });
  const edited = buildBackupCsv(S.families, 'f1').replace('Piet Pieters', 'Piet P.');
  prepareRestore('mijn-back-up.csv', edited);
  withFakeNow(NOW, () => renderBeheer());
  const s = text(dom.html('tab-beheer'));
  assert.match(s, /Controle van mijn-back-up\.csv/); assert.match(s, /6 gezinnen worden overschreven, 0 nieuw/);
  assert.ok(!/coördinator wordt/.test(s));
  const btn = dom.el('backupConfirm'); btn.onclick(); assert.equal(fake.get('families/f2').parentName, 'Piet Pieters', 'first tap only asks');
  btn.onclick(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(fake.get('families/f2').parentName, 'Piet P.');
  assert.ok(!/id="backupPending"/.test(dom.html('tab-beheer')), 'the check disappears after restoring');
});
test('a bad file lists the problems with their line and offers only Annuleren', () => {
  useFakeDb(sampleDbSeed()); sampleCoordinatorState();
  const csv = buildBackupCsv(S.families, 'f1').replace('0611111111', '0611111111').replace(';4;', ';veel;');
  prepareRestore('kapot.csv', csv);
  withFakeNow(NOW, () => renderBeheer());
  const html = dom.html('tab-beheer'), s = text(html);
  assert.match(s, /er is niets gewijzigd/); assert.match(s, /Regel \d+: Autocapaciteit &quot;veel&quot; klopt niet/);
  assert.ok(!/id="backupConfirm"/.test(html)); assert.match(html, /id="backupCancel"/);
  cancelRestore();
  assert.ok(!/id="backupPending"/.test(dom.html('tab-beheer')));
});
test('a file that would make another family coordinator warns about losing access', () => {
  useFakeDb(sampleDbSeed()); sampleCoordinatorState();
  prepareRestore('x.csv', buildBackupCsv(S.families, 'f3'));
  assert.match(text(familyBackupCardHtml()), /de coördinator wordt Kees de Vries/);
  cancelRestore();
});
test('a file with a thousand errors shows only the first few', () => {
  useFakeDb(sampleDbSeed()); sampleCoordinatorState();
  const head = buildBackupCsv({}, null).trim();
  prepareRestore('veel.csv', head + '\r\n' + Array.from({ length: 30 }, () => 'O;D;vast;n;kapot').join('\r\n'));
  assert.match(text(familyBackupCardHtml()), /… en nog \d+ andere meldingen/);
  cancelRestore();
});
function sampleFamiliesForBackup() { return structuredClone(S.families); }

test('Beheer shows the notice card, and the WhatsApp intro icon wiring is still there', () => {
  useFakeDb(sampleDbSeed()); sampleCoordinatorState();
  withFakeNow(NOW, () => renderBeheer());
  assert.match(text(dom.html('tab-beheer')), /Melding voor iedereen/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
