// Run with: node data.test.js
// Everything that reads or writes the database. The database here is ALWAYS the in-memory fake from
// fake-db.js — these tests never touch the real Firestore.
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
import { installFakeDom, resetState, useFakeDb, withFakeNowAsync, NOW, WEEK_KEY, sampleDbSeed, sampleCoordinatorState, sampleParentState } from './test-support.js';
import { createFakeFirestore } from './fake-db.js';
import { S } from '../state.js';
import {
  createFirestoreDb, initDb, db, recordLastUpdate, purgeStaleDeviations, purgeStaleMatchCarpools, saveDeviationCars, saveInviteCode,
  markTimeChangesSeen, createGroupWithDriver, useOption, createGroupCustom, doToggleCoord, saveCoordFamily,
  migrateLegacyFamilySecrets, syncListeners, startDataListeners, stopDataListeners, savePeriodEntry,
  savePeriodShift, makePeriodRooster, replanPeriodShift, deletePeriodRooster,
} from '../data.js';

const dom = installFakeDom();
const toast = () => dom.doc.getElementById('toast').innerHTML.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tick = () => new Promise(r => setImmediate(r));

console.log('=== createFirestoreDb: the adapter between the app and the SDK ===');
await testAsync('doc(): set, get, update, delete', async () => {
  const fake = useFakeDb({});
  await db.doc('settings/planning').set({ gapThresholdHours: 3 });
  let s = await db.doc('settings/planning').get();
  assert.equal(s.exists, true); assert.deepEqual(s.data(), { gapThresholdHours: 3 }); assert.equal(s.id, 'planning'); assert.equal(s.pending, false);
  await db.doc('settings/planning').update({ 'nested.a': 1, gapThresholdHours: 4 });
  assert.deepEqual(fake.get('settings/planning'), { gapThresholdHours: 4, nested: { a: 1 } });
  await db.doc('settings/planning').delete();
  s = await db.doc('settings/planning').get(); assert.equal(s.exists, false); assert.equal(s.data(), undefined);
});
await testAsync('set with merge keeps other fields', async () => {
  const fake = useFakeDb({ 'families/f1': { a: 1, b: 2 } });
  await db.doc('families/f1').set({ b: 3 }, { merge: true });
  assert.deepEqual(fake.get('families/f1'), { a: 1, b: 3 });
});
await testAsync('collection(): get lists documents; doc() reaches into it', async () => {
  useFakeDb({ 'groups/a': { n: 1 }, 'groups/b': { n: 2 }, 'families/x': {} });
  const snap = await db.collection('groups').get();
  assert.deepEqual(snap.docs.map(d => d.id), ['a', 'b']);
  assert.deepEqual((await db.collection('groups').doc('b').get()).data(), { n: 2 });
});
await testAsync('onSnapshot: fires now, again after every change, and stops after unsubscribe', async () => {
  useFakeDb({ 'groups/a': { n: 1 } });
  const seen = [];
  const unsub = db.collection('groups').onSnapshot(s => seen.push(s.docs.map(d => d.id).join(',')));
  await tick(); await db.doc('groups/b').set({ n: 2 }); await tick();
  unsub(); await db.doc('groups/c').set({}); await tick();
  assert.deepEqual(seen, ['a', 'a,b']);
});
await testAsync('setListenerSink collects the unsubscribe functions of listeners created meanwhile', async () => {
  const fake = useFakeDb({});
  const sink = []; db.setListenerSink(sink);
  db.doc('a/b').onSnapshot(() => {}); db.collection('c').onSnapshot(() => {});
  db.setListenerSink(null); db.doc('a/other').onSnapshot(() => {});
  assert.equal(sink.length, 2); assert.equal(fake.listenerCount(), 3);
  sink.forEach(u => u()); assert.equal(fake.listenerCount(), 1);
});
await testAsync('batch(): several writes commit together, with deleteField', async () => {
  const fake = useFakeDb({ 'families/f1': { inviteCode: '123456', x: 1 }, 'invites/old': { familyId: 'f1' } });
  const b = db.batch();
  b.set('invites/new1', { familyId: 'f1' }); b.update('families/f1', { inviteCode: db.deleteField(), y: 2 }); b.delete('invites/old');
  await b.commit();
  assert.deepEqual(fake.get('families/f1'), { x: 1, y: 2 }); assert.equal(fake.get('invites/new1').familyId, 'f1'); assert.equal(fake.get('invites/old'), undefined);
});
await testAsync('signIn returns the anonymous user; calendarApiKey is passed through', async () => {
  const fake = createFakeFirestore({}, { uid: 'abc' });
  initDb(createFirestoreDb({ sdk: fake.sdk, firestoreDb: {}, auth: {}, calendarApiKey: 'KEY' }));
  assert.equal((await db.signIn()).user.uid, 'abc'); assert.equal(db.calendarApiKey, 'KEY');
});

console.log('\n=== recordLastUpdate ===');
await testAsync('stores who changed what, when (name only, no phone number)', async () => {
  const fake = useFakeDb({}); sampleParentState();
  await withFakeNowAsync(NOW, () => recordLastUpdate('Rooster'));
  assert.deepEqual(fake.get('settings/lastUpdateRooster'), { by: 'Piet Pieters', at: new Date(NOW).getTime() });
});
await testAsync('never throws when the write fails (best effort)', async () => {
  const fake = useFakeDb({}); sampleParentState(); fake.failWrites('settings/', 'denied');
  await recordLastUpdate('Deviation');
  assert.equal(fake.get('settings/lastUpdateDeviation'), undefined);
});

console.log('\n=== saveDeviationCars (Wijzigen) ===');
await testAsync('writes the deviation with week key and expiry, and strips internal fields', async () => {
  const fake = useFakeDb({}); sampleCoordinatorState({ currentWeekKey: 'stale' });
  const ok = await withFakeNowAsync(NOW, () => saveDeviationCars('Ma', 'heen', [{ baseGroupId: 'g1', driverFamilyId: 'f1', girlIds: ['f1'], note: undefined, departureTime: '07:30' }]));
  assert.equal(ok, true);
  const d = fake.get('deviations/Ma_heen');
  assert.deepEqual(d, { day: 'Ma', direction: 'heen', weekKey: WEEK_KEY, expiresAt: new Date('2026-10-02T22:00:00Z').getTime(), cars: [{ driverFamilyId: 'f1', girlIds: ['f1'], departureTime: '07:30' }] });
  assert.equal(S.lastDeviationEditDay, 'Ma');
});
await testAsync('a failed write shows a message and returns false', async () => {
  const fake = useFakeDb({}); sampleCoordinatorState(); fake.failWrites('deviations/', 'permission-denied');
  const ok = await saveDeviationCars('Ma', 'heen', []);
  assert.equal(ok, false); assert.equal(toast(), 'Opslaan mislukt: permission-denied');
});

console.log('\n=== purging old data ===');
await testAsync('purgeStaleDeviations removes only OLDER weeks whose expiry has passed', async () => {
  const fake = useFakeDb({});
  sampleCoordinatorState({ deviations: {
    old_expired: { weekKey: '2026-W38', expiresAt: 1000 },
    old_no_expiry: { weekKey: '2026-W38' },
    old_not_expired: { weekKey: '2026-W39', expiresAt: new Date('2026-10-30').getTime() },
    current: { weekKey: WEEK_KEY, expiresAt: 1000 },
    newer: { weekKey: '2026-W41', expiresAt: 1000 },
  } });
  ['old_expired', 'old_no_expiry', 'old_not_expired', 'current', 'newer'].forEach(k => fake.store.set('deviations/' + k, {}));
  await withFakeNowAsync(NOW, () => purgeStaleDeviations());
  assert.deepEqual(fake.collection('deviations').map(e => e[0]).sort(), ['current', 'newer', 'old_not_expired']);
});
await testAsync('purgeStaleMatchCarpools removes matches more than a day in the past', async () => {
  const fake = useFakeDb({ 'matchCarpools/old': {}, 'matchCarpools/recent': {}, 'matchCarpools/future': {} });
  resetState({ matchCarpools: { old: { startMs: new Date('2026-09-25').getTime() }, recent: { startMs: new Date('2026-09-29T20:00:00+02:00').getTime() }, future: { startMs: new Date('2026-10-03').getTime() } } });
  await withFakeNowAsync(NOW, () => purgeStaleMatchCarpools());
  assert.deepEqual(fake.collection('matchCarpools').map(e => e[0]).sort(), ['future', 'recent']);
});

console.log('\n=== coordinator role ===');
await testAsync('claiming the role stores this browser\'s id; the app then shows the coordinator view', async () => {
  const fake = useFakeDb({}); resetState({ me: 'me1', coordinatorConfig: null });
  await withFakeNowAsync(NOW, () => doToggleCoord('f1', true));
  assert.equal(fake.get('config/coordinator').uid, 'me1'); assert.equal(S.canEdit, true); assert.equal(S.coordinatorExists, true);
  assert.equal(toast(), 'Coördinator-rol nu alleen via dit apparaat');
});
await testAsync('designating a family stores familyId (role survives clearing browser data)', async () => {
  const fake = useFakeDb({}); resetState({ me: 'me1', coordinatorConfig: { uid: 'me1' }, links: {} });
  await doToggleCoord('f3', false);
  assert.deepEqual(fake.get('config/coordinator'), { familyId: 'f3' }); assert.equal(toast(), 'Coördinator ingesteld ✓');
});
await testAsync('a failed write is reported and the state stays as it was', async () => {
  const fake = useFakeDb({}); resetState({ me: 'me1', coordinatorConfig: null }); fake.failWrites('config/', 'nope');
  await doToggleCoord('f3', false);
  assert.equal(S.coordinatorConfig, null); assert.equal(toast(), 'Mislukt: nope');
});

console.log('\n=== groups (Rooster) ===');
await testAsync('createGroupWithDriver saves a group with departure time and the reserve drivers', async () => {
  const fake = useFakeDb({}); sampleCoordinatorState();
  await withFakeNowAsync(NOW, () => createGroupWithDriver('Ma', 'heen', ['f4', 'f5'], 'f3'));
  const [[id, g]] = fake.collection('groups');
  assert.match(id, /^Ma_heen_\d+_[a-z0-9]+$/);
  assert.deepEqual({ ...g, reserveFamilyIds: undefined }, { day: 'Ma', direction: 'heen', girlIds: ['f4', 'f5'], driverFamilyId: 'f3', reserveFamilyIds: undefined, departureTime: '07:30' });
  assert.ok(!g.reserveFamilyIds.includes('f3'), 'the driver is not their own reserve');
  assert.ok(!g.reserveFamilyIds.includes('f1'), 'a driver of another car on this trip is not a reserve');
});
await testAsync('useOption creates one group per car and never lists another car\'s driver as reserve', async () => {
  const fake = useFakeDb({}); sampleCoordinatorState({ groups: {} });
  await withFakeNowAsync(NOW, () => useOption('Ma', 'heen', [{ driverId: 'f2', girlIds: ['f1', 'f2'] }, { driverId: 'f3', girlIds: ['f4'] }]));
  const groups = fake.collection('groups').map(e => e[1]);
  assert.equal(groups.length, 2);
  groups.forEach(g => assert.ok(!g.reserveFamilyIds.includes('f2') && !g.reserveFamilyIds.includes('f3')));
});
await testAsync('createGroupCustom picks the first eligible driver; with no girls it only shows a message', async () => {
  const fake = useFakeDb({}); sampleCoordinatorState({ groups: {} });
  await createGroupCustom('Ma', 'heen', []);
  assert.equal(toast(), 'Selecteer minstens 1 dochter.'); assert.equal(fake.collection('groups').length, 0);
  await withFakeNowAsync(NOW, () => createGroupCustom('Ma', 'heen', ['f4', 'f5']));
  assert.equal(fake.collection('groups')[0][1].driverFamilyId, 'f1');
});
await testAsync('a refused write shows the reason', async () => {
  const fake = useFakeDb({}); sampleCoordinatorState({ groups: {} }); fake.failWrites('groups/', 'read-only');
  await withFakeNowAsync(NOW, () => createGroupWithDriver('Ma', 'heen', ['f4'], 'f3'));
  assert.equal(toast(), 'Kon groep niet opslaan (alleen coördinator kan bewerken): read-only');
});

console.log('\n=== invite codes and family editing ===');
await testAsync('saveInviteCode stores the new code and removes the family\'s old one', async () => {
  const fake = useFakeDb({ 'invites/OLDCODE1': { familyId: 'f1' }, 'invites/other1': { familyId: 'f2' } });
  resetState({ invitesByCode: { OLDCODE1: 'f1', other1: 'f2' }, inviteByFamily: { f1: 'OLDCODE1', f2: 'other1' } });
  assert.equal(await saveInviteCode('f1', 'NEWCODE1'), true);
  assert.deepEqual(fake.collection('invites').map(e => e[0]), ['NEWCODE1', 'other1']);
});
await testAsync('saveInviteCode refuses a code that belongs to another family, or is malformed', async () => {
  const fake = useFakeDb({ 'invites/TAKEN123': { familyId: 'f2' } }); resetState({ invitesByCode: {}, inviteByFamily: {} });
  assert.equal(await saveInviteCode('f1', 'TAKEN123'), false); assert.equal(toast(), 'Deze code is al in gebruik bij een ander gezin — kies een andere.');
  assert.equal(await saveInviteCode('f1', 'a b'), false); assert.match(toast(), /^Code: alleen letters/);
  assert.equal(fake.get('invites/TAKEN123').familyId, 'f2');
});
await testAsync('saveInviteCode with an unchanged code does nothing', async () => {
  const fake = useFakeDb({}); resetState({ invitesByCode: { AAAA1111: 'f1' }, inviteByFamily: { f1: 'AAAA1111' } });
  assert.equal(await saveInviteCode('f1', 'AAAA1111'), true); assert.deepEqual(fake.writes, []);
});
await testAsync('migrateLegacyFamilySecrets moves old invite codes to /invites and adds normalised phone keys', async () => {
  const fake = useFakeDb({ 'families/f1': { parentPhone1: '06 11 11 11 11', inviteCode: 'ABCD1234' }, 'families/f2': { parentPhone1: '0622222222', phoneKeys: ['0622222222'] } });
  resetState({ families: { f1: { parentPhone1: '06 11 11 11 11', inviteCode: 'ABCD1234' }, f2: { parentPhone1: '0622222222', phoneKeys: ['0622222222'] } } });
  await migrateLegacyFamilySecrets();
  assert.deepEqual(fake.get('families/f1'), { parentPhone1: '06 11 11 11 11', phoneKeys: ['0611111111'] });
  assert.deepEqual(fake.get('invites/ABCD1234'), { familyId: 'f1' });
  assert.equal(toast(), 'Uitnodigingscodes beveiligd ✓');
});
await testAsync('markTimeChangesSeen clears the change list of each family', async () => {
  const fake = useFakeDb({ 'families/f1': { timeChanges: [{}] }, 'families/f2': { timeChanges: [{}] } });
  await markTimeChangesSeen(['f1', 'f2']);
  assert.deepEqual(fake.get('families/f1').timeChanges, []); assert.equal(toast(), 'Gemarkeerd als gezien ✓');
});

console.log('\n=== live listeners ===');
await testAsync('startDataListeners loads families, groups, deviations and settings into the app state', async () => {
  const seed = { ...sampleDbSeed(), 'settings/planning': { travelLeadMinutes: 45 }, 'settings/prefs': { rules: [{ type: 'together', ids: ['f1', 'f2'] }] }, 'settings/priority': { Ma_heen: { f2: 1 } } };
  const fake = useFakeDb(seed); sampleCoordinatorState({ families: {}, groups: {}, deviations: {} });
  startDataListeners(); await tick(); await tick();
  assert.deepEqual(Object.keys(S.families).sort(), ['f1', 'f2', 'f3', 'f4', 'f5', 'f6']);
  assert.deepEqual(Object.keys(S.groups).sort(), ['Ma_heen_1', 'Ma_terug_1']);
  assert.equal(S.settings.travelLeadMinutes, 45); assert.equal(S.settings.gapThresholdHours, 3, 'defaults are kept');
  assert.equal(S.prefs.rules.length, 1); assert.equal(S.shiftPriority.Ma_heen.f2, 1);
  assert.ok(S.dataUnsubs.length >= 9);
  stopDataListeners(); assert.equal(S.dataUnsubs.length, 0);
  const before = fake.listenerCount(); await db.doc('groups/x').set({ day: 'Ma', direction: 'heen', girlIds: [] }); await tick();
  assert.ok(!('x' in S.groups), 'no updates after listeners were stopped'); assert.equal(fake.listenerCount(), before);
});
await testAsync('the schedule the server holds is remembered separately (to detect changed times)', async () => {
  useFakeDb(sampleDbSeed()); sampleCoordinatorState({ families: {}, serverSchedules: {} });
  startDataListeners(); await tick(); await tick();
  assert.deepEqual(S.serverSchedules.f1, S.families.f1.schedule); assert.notEqual(S.serverSchedules.f1, S.families.f1.schedule);
  stopDataListeners();
});
await testAsync('syncListeners: a member starts listeners, someone who lost access stops them', async () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ families: {}, groups: {} });
  syncListeners(); await tick(); await tick();
  assert.ok(S.dataUnsubs.length > 0); assert.ok('f2' in S.families);
  S.links = {}; syncListeners(); assert.equal(S.dataUnsubs.length, 0);
});
await testAsync('syncListeners: only the coordinator listens to all links and invite codes', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'links/p1': { familyId: 'f2' }, 'invites/CODE1234': { familyId: 'f3' } });
  sampleCoordinatorState({ links: {}, families: {} });
  syncListeners(); await tick(); await tick();
  assert.deepEqual(S.invitesByCode, { CODE1234: 'f3' }); assert.deepEqual(S.inviteByFamily, { f3: 'CODE1234' }); assert.ok('p1' in S.links);
  stopDataListeners();
});
await testAsync('saveCoordFamily creates a new family document and warns about duplicate girl names', async () => {
  const fake = useFakeDb({}); sampleCoordinatorState({ coordEditId: undefined, invitesByCode: {}, inviteByFamily: {} });
  const set = (id, v) => { dom.doc.getElementById(id).value = v; };
  const day = ['Ma', 'Di', 'Wo', 'Do', 'Vr'];
  set('coord_parentName', 'Nieuwe Ouder'); set('coord_girlName', 'Eline'); set('coord_parentPhone1', '06 99 99 99 99'); set('coord_parentPhone2', ''); set('coord_capacity', '5'); set('coord_inviteCode', '');
  day.forEach(d => { set('coord_sch_' + d + '_heen', ''); set('coord_sch_' + d + '_terug', ''); ['heen', 'terug'].forEach(x => { dom.doc.getElementById('coord_av_' + d + '_' + x).checked = false; }); dom.doc.getElementById('coord_bkH_' + d).checked = false; dom.doc.getElementById('coord_bkT_' + d).checked = false; });
  await saveCoordFamily();
  const [[id, f]] = fake.collection('families');
  assert.match(id, /^manual-eline-/); assert.equal(f.parentName, 'Nieuwe Ouder'); assert.equal(f.capacity, 5); assert.deepEqual(f.phoneKeys, ['0699999999']);
});

await testAsync('saveCoordFamily on an existing family keeps fields the form does not hold (merge, not overwrite)', async () => {
  const fake = useFakeDb({ 'families/f2': { parentName: 'Oud', girlName: 'Jahaimy', capacity: 4, timeChanges: [{ day: 'Ma' }], extraField: 'blijft' } });
  sampleCoordinatorState({ coordEditId: 'f2', invitesByCode: {}, inviteByFamily: {} });
  const set = (id, v) => { dom.doc.getElementById(id).value = v; };
  set('coord_parentName', 'Piet Pieters'); set('coord_girlName', 'Jahaimy'); set('coord_parentPhone1', '0622222222'); set('coord_parentPhone2', ''); set('coord_capacity', '5'); set('coord_inviteCode', '');
  ['Ma', 'Di', 'Wo', 'Do', 'Vr'].forEach(d => { set('coord_sch_' + d + '_heen', ''); set('coord_sch_' + d + '_terug', ''); ['heen', 'terug'].forEach(x => { dom.doc.getElementById('coord_av_' + d + '_' + x).checked = false; }); dom.doc.getElementById('coord_bkH_' + d).checked = false; dom.doc.getElementById('coord_bkT_' + d).checked = false; });
  await saveCoordFamily();
  const f = fake.get('families/f2');
  assert.equal(f.parentName, 'Piet Pieters'); assert.equal(f.capacity, 5);
  assert.equal(f.extraField, 'blijft'); assert.equal(f.timeChanges.length, 1);
});



await testAsync('the day coordinators from Beheer are loaded live, and cleared when listeners stop', async () => {
  useFakeDb({ ...sampleDbSeed(), 'settings/dayCoordinators': { Ma: 'f1', Di: 'f2' } }); sampleParentState({ families: {}, groups: {}, dayCoordinators: {} });
  startDataListeners(); await tick(); await tick();
  assert.deepEqual(S.dayCoordinators, { Ma: 'f1', Di: 'f2' });
  await db.doc('settings/dayCoordinators').set({ Ma: 'f3' }); await tick();
  assert.deepEqual(S.dayCoordinators, { Ma: 'f3' });
  stopDataListeners(); assert.deepEqual(S.dayCoordinators, {});
});
await testAsync('without a settings document there are simply no day coordinators', async () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ families: {}, groups: {}, dayCoordinators: { Ma: 'stale' } });
  startDataListeners(); await tick(); await tick();
  assert.deepEqual(S.dayCoordinators, {});
  stopDataListeners();
});

const PERIOD_DOC = { name: 'Herfstvakantie', firstDay: '2026-10-26', lastDay: '2026-10-30', opensOn: '2026-10-14', deadlineDate: '2026-10-16', deadlineTime: '12:00' };
await testAsync('the period from Beheer is loaded live, and cleared when listeners stop', async () => {
  useFakeDb({ ...sampleDbSeed(), 'settings/period': PERIOD_DOC }); sampleParentState({ families: {}, groups: {}, period: null });
  startDataListeners(); await tick(); await tick();
  assert.deepEqual(S.period, PERIOD_DOC);
  await db.doc('settings/period').set({ ...PERIOD_DOC, name: 'Proefwerkweek' }); await tick();
  assert.equal(S.period.name, 'Proefwerkweek');
  await db.doc('settings/period').delete(); await tick();
  assert.equal(S.period, null);
  stopDataListeners(); assert.equal(S.period, null); assert.equal(S.periodDraft, null);
});
await testAsync('without a settings/period document there is no period; a broken document counts as none', async () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ families: {}, groups: {}, period: { stale: true } });
  startDataListeners(); await tick(); await tick();
  assert.equal(S.period, null);
  await db.doc('settings/period').set({ ...PERIOD_DOC, lastDay: '' }); await tick();
  assert.equal(S.period, null);
  stopDataListeners();
});

await testAsync('the handed-in period times are loaded live, marked as loaded, and cleared when listeners stop', async () => {
  const entry = { familyId: 'f2', periodFirstDay: '2026-10-26', days: { '2026-10-26': { out: true } }, submittedAt: 1, by: 'Piet' };
  useFakeDb({ ...sampleDbSeed(), 'periodEntries/2026-10-26_f2': entry }); sampleParentState({ families: {}, groups: {}, periodEntries: {}, periodEntriesLoaded: false });
  startDataListeners(); await tick(); await tick();
  assert.deepEqual(S.periodEntries, { '2026-10-26_f2': entry }); assert.equal(S.periodEntriesLoaded, true);
  await db.doc('periodEntries/2026-10-26_f1').set({ ...entry, familyId: 'f1' }); await tick();
  assert.deepEqual(Object.keys(S.periodEntries).sort(), ['2026-10-26_f1', '2026-10-26_f2']);
  S.periodView = 'f2'; S.periodForm = { familyId: 'f2', days: {} };
  stopDataListeners(); assert.deepEqual(S.periodEntries, {}); assert.equal(S.periodEntriesLoaded, false); assert.equal(S.periodForm, null); assert.equal(S.periodView, null);
});

console.log('\n=== savePeriodEntry (times handed in for a period) ===');
const P = { name: 'Herfstvakantie', firstDay: '2026-10-26', lastDay: '2026-10-30', opensOn: '2026-10-14', deadlineDate: '2026-10-16', deadlineTime: '12:00' };
const daysOk = { '2026-10-26': { out: false, heen: '08:30', terug: '17:30' }, '2026-10-27': { out: true }, '2026-10-28': { out: true }, '2026-10-29': { out: false, heen: '10:15', terug: '' }, '2026-10-30': { out: true } };
const IN_OPEN = '2026-10-15T09:00:00+02:00', IN_CLOSED = '2026-10-20T09:00:00+02:00';
await testAsync('stores one document per family and period, with the shape the rules expect, and updates the state', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({ period: P, periodEntries: {}, periodEntriesLoaded: true });
  assert.equal(await withFakeNowAsync(IN_OPEN, () => savePeriodEntry('f2', daysOk)), true);
  const d = fake.get('periodEntries/2026-10-26_f2');
  assert.deepEqual(Object.keys(d).sort(), ['by', 'days', 'familyId', 'periodFirstDay', 'submittedAt']);
  assert.equal(d.familyId, 'f2'); assert.equal(d.periodFirstDay, '2026-10-26'); assert.equal(d.by, 'Piet Pieters'); assert.equal(d.submittedAt, new Date(IN_OPEN).getTime());
  assert.deepEqual(d.days, { '2026-10-26': { heen: '08:30', terug: '17:30' }, '2026-10-27': { out: true }, '2026-10-28': { out: true }, '2026-10-29': { heen: '10:15' }, '2026-10-30': { out: true } });
  assert.deepEqual(S.periodEntries['2026-10-26_f2'], d); assert.equal(toast(), 'Tijden doorgegeven ✓');
});
await testAsync('handing in again replaces the first entry (once per period, changeable until the deadline)', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({ period: P, periodEntries: {}, periodEntriesLoaded: true });
  await withFakeNowAsync(IN_OPEN, () => savePeriodEntry('f2', daysOk));
  await withFakeNowAsync(IN_OPEN, () => savePeriodEntry('f2', { ...daysOk, '2026-10-27': { out: false, heen: '09:00', terug: '12:00' } }));
  assert.equal(fake.writes.filter(w => String(w[1]).startsWith('periodEntries/')).length, 2);   // two writes, one document
  assert.deepEqual(Object.keys(S.periodEntries), ['2026-10-26_f2']);
  assert.deepEqual(fake.get('periodEntries/2026-10-26_f2').days['2026-10-27'], { heen: '09:00', terug: '12:00' });
});
await testAsync('after the deadline a parent is refused, the coordinator is not', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({ period: P, periodEntries: {}, periodEntriesLoaded: true });
  assert.equal(await withFakeNowAsync(IN_CLOSED, () => savePeriodEntry('f2', daysOk)), false);
  assert.equal(toast(), 'De deadline is voorbij. Alleen de coördinator kan de tijden nog aanpassen.'); assert.equal(fake.get('periodEntries/2026-10-26_f2'), undefined);
  sampleCoordinatorState({ period: P, periodEntries: {}, periodEntriesLoaded: true });
  assert.equal(await withFakeNowAsync(IN_CLOSED, () => savePeriodEntry('f2', daysOk)), true);
  assert.equal(fake.get('periodEntries/2026-10-26_f2').familyId, 'f2');
});
await testAsync('before filling in opens nothing can be handed in', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({ period: P, periodEntries: {}, periodEntriesLoaded: true });
  assert.equal(await withFakeNowAsync('2026-10-13T09:00:00+02:00', () => savePeriodEntry('f2', daysOk)), false);
  assert.equal(fake.get('periodEntries/2026-10-26_f2'), undefined);
});
await testAsync('no period, an unknown family or invalid times: nothing is written and the reason is shown', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({ period: null, periodEntries: {}, periodEntriesLoaded: true });
  assert.equal(await savePeriodEntry('f2', daysOk), false); assert.equal(toast(), 'Er is geen periode ingesteld.');
  sampleParentState({ period: P, periodEntries: {}, periodEntriesLoaded: true });
  assert.equal(await withFakeNowAsync(IN_OPEN, () => savePeriodEntry('nope', daysOk)), false);
  assert.equal(await withFakeNowAsync(IN_OPEN, () => savePeriodEntry('f2', { ...daysOk, '2026-10-26': { out: false, heen: '17:00', terug: '08:00' } })), false);
  assert.equal(toast(), 'maandag 26 okt: Terug moet later zijn dan Heen.');
  assert.equal(fake.get('periodEntries/2026-10-26_f2'), undefined);
});
await testAsync('a Flex family cannot hand in (it signs up per day in Wijzigen)', async () => {
  const fake = useFakeDb(sampleDbSeed()); const fams = sampleParentState().families; fams.f2 = { ...fams.f2, familyType: 'flex' };
  sampleParentState({ families: fams, period: P, periodEntries: {}, periodEntriesLoaded: true });
  assert.equal(await withFakeNowAsync(IN_OPEN, () => savePeriodEntry('f2', daysOk)), false); assert.equal(fake.get('periodEntries/2026-10-26_f2'), undefined);
});
await testAsync('a refused write is reported and nothing changes in the state', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({ period: P, periodEntries: {}, periodEntriesLoaded: true }); fake.failWrites('periodEntries/', 'permission-denied');
  assert.equal(await withFakeNowAsync(IN_OPEN, () => savePeriodEntry('f2', daysOk)), false);
  assert.match(toast(), /permission-denied/); assert.deepEqual(S.periodEntries, {});
});

console.log('\n=== the temporary rooster (periodCars) ===');
const shiftOf = (iso, direction, cars) => ({ periodFirstDay: '2026-10-26', date: iso, direction, cars, madeAt: 1, by: 'x' });
await testAsync('the temporary rooster is loaded live, and cleared when listeners stop', async () => {
  const doc = shiftOf('2026-10-27', 'terug', [{ driverFamilyId: 'f2', girlIds: ['f2'], departureTime: '12:30' }]);
  useFakeDb({ ...sampleDbSeed(), 'periodCars/2026-10-26_2026-10-27_terug': doc }); sampleParentState({ families: {}, groups: {}, periodCars: {} });
  startDataListeners(); await tick(); await tick();
  assert.deepEqual(S.periodCars, { '2026-10-26_2026-10-27_terug': doc });
  await db.doc('periodCars/2026-10-26_2026-10-27_heen').set(shiftOf('2026-10-27', 'heen', [])); await tick();
  assert.equal(Object.keys(S.periodCars).length, 2);
  S.periodDay = '2026-10-27'; stopDataListeners(); assert.deepEqual(S.periodCars, {}); assert.equal(S.periodDay, null);
});
const PER = { name: 'Herfstvakantie', firstDay: '2026-10-26', lastDay: '2026-10-30', opensOn: '2026-10-14', deadlineDate: '2026-10-16', deadlineTime: '12:00' };
const coordP = (patch = {}) => sampleCoordinatorState({ period: PER, periodEntries: {}, periodEntriesLoaded: true, periodCars: {}, ...patch });
const carsX = [{ driverFamilyId: 'f2', girlIds: ['f2', 'f6', 'f6', '', 'f5'], departureTime: '13:00' }, { driverFamilyId: 'f4', girlIds: [], departureTime: '' }];
await testAsync('savePeriodShift stores one shift with clean cars (no empty cars, no doubles) and the details the rules expect', async () => {
  const fake = useFakeDb(sampleDbSeed()); coordP();
  assert.equal(await withFakeNowAsync(NOW, () => savePeriodShift('2026-10-27', 'terug', carsX)), true);
  const d = fake.get('periodCars/2026-10-26_2026-10-27_terug');
  assert.deepEqual(Object.keys(d).sort(), ['by', 'cars', 'date', 'direction', 'madeAt', 'periodFirstDay']);
  assert.deepEqual(d.cars, [{ driverFamilyId: 'f2', girlIds: ['f2', 'f6', 'f5'], departureTime: '13:00' }]);
  assert.equal(d.periodFirstDay, '2026-10-26'); assert.equal(d.date, '2026-10-27'); assert.equal(d.direction, 'terug'); assert.equal(d.by, 'Coördinator'); assert.equal(d.madeAt, new Date(NOW).getTime());
  assert.deepEqual(S.periodCars['2026-10-26_2026-10-27_terug'], d);
});
await testAsync('a shift with nobody in a car is still stored ("made, nobody rides"): the standard rooster no longer applies there', async () => {
  const fake = useFakeDb(sampleDbSeed()); coordP();
  assert.equal(await savePeriodShift('2026-10-28', 'heen', []), true); assert.deepEqual(fake.get('periodCars/2026-10-26_2026-10-28_heen').cars, []);
});
await testAsync('savePeriodShift refuses: a parent, no period, a date outside the period or a weekend, a wrong direction', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({ period: PER, periodCars: {} });
  assert.equal(await savePeriodShift('2026-10-27', 'terug', carsX), false); assert.equal(toast(), 'Alleen de coördinator kan het tijdelijke rooster aanpassen.');
  coordP({ period: null }); assert.equal(await savePeriodShift('2026-10-27', 'terug', carsX), false); assert.equal(toast(), 'Er is geen periode ingesteld.');
  coordP();
  for (const [iso, dir] of [['2026-11-02', 'heen'], ['2026-10-25', 'heen'], ['2026-10-31', 'heen'], ['nonsense', 'heen'], ['2026-10-27', 'sideways']]) {
    assert.equal(await savePeriodShift(iso, dir, carsX), false, iso + dir); assert.equal(toast(), 'Deze dag hoort niet bij de periode.');
  }
  assert.equal(fake.writes.filter(w => String(w[1]).startsWith('periodCars/')).length, 0);
});
await testAsync('a refused write is reported and the state does not change', async () => {
  const fake = useFakeDb(sampleDbSeed()); coordP(); fake.failWrites('periodCars/', 'permission-denied');
  assert.equal(await savePeriodShift('2026-10-27', 'terug', carsX), false); assert.match(toast(), /permission-denied/); assert.deepEqual(S.periodCars, {});
});
await testAsync('makePeriodRooster plans and stores every shift of the period in one go', async () => {
  const fake = useFakeDb(sampleDbSeed()); coordP();
  assert.equal(await withFakeNowAsync(NOW, () => makePeriodRooster()), true);
  const keys = Object.keys(S.periodCars).sort();
  assert.equal(keys.length, 10); assert.equal(keys[0], '2026-10-26_2026-10-26_heen'); assert.equal(keys[9], '2026-10-26_2026-10-30_terug');
  keys.forEach(k => assert.deepEqual(fake.get('periodCars/' + k), S.periodCars[k]));
  assert.equal(toast(), 'Tijdelijk rooster gemaakt ✓');
  const monday = S.periodCars['2026-10-26_2026-10-26_heen'];
  assert.ok(monday.cars.length >= 1); monday.cars.forEach(c => { assert.ok(c.driverFamilyId); assert.match(c.departureTime, /^\d\d:\d\d$/); });
});
await testAsync('makePeriodRooster uses the handed-in times', async () => {
  const fake = useFakeDb(sampleDbSeed());
  coordP({ periodEntries: { '2026-10-26_f2': { familyId: 'f2', periodFirstDay: '2026-10-26', days: { '2026-10-27': { heen: '10:15', terug: '12:30' } }, submittedAt: 1, by: 'x' } } });
  await makePeriodRooster();
  const terug = fake.get('periodCars/2026-10-26_2026-10-27_terug').cars;
  const car = terug.find(c => c.girlIds.includes('f2'));
  assert.deepEqual(car.girlIds, ['f2'], 'she comes home three hours before the others, so she gets her own car');
  assert.equal(car.departureTime, '12:30'); assert.equal(terug.flatMap(c => c.girlIds).length, 5);
});
await testAsync('makePeriodRooster refuses for a parent, and reports a refused write', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({ period: PER, periodCars: {} });
  assert.equal(await makePeriodRooster(), false); assert.equal(fake.writes.length, 0);
  coordP(); fake.failWrites('periodCars/', 'permission-denied');
  assert.equal(await makePeriodRooster(), false); assert.match(toast(), /permission-denied/); assert.deepEqual(S.periodCars, {});
});
await testAsync('replanPeriodShift replaces the cars of one shift with a fresh proposal and leaves the others alone', async () => {
  const fake = useFakeDb(sampleDbSeed()); coordP();
  await makePeriodRooster();
  const other = JSON.stringify(fake.get('periodCars/2026-10-26_2026-10-28_terug'));
  await savePeriodShift('2026-10-27', 'terug', [{ driverFamilyId: 'f3', girlIds: ['f1'], departureTime: '09:00' }]);
  assert.equal(await replanPeriodShift('2026-10-27', 'terug'), true);
  assert.notDeepEqual(fake.get('periodCars/2026-10-26_2026-10-27_terug').cars.map(c => c.driverFamilyId), ['f3']);
  assert.equal(JSON.stringify(fake.get('periodCars/2026-10-26_2026-10-28_terug')), other); assert.equal(toast(), 'Opnieuw ingedeeld ✓');
});
await testAsync('deletePeriodRooster removes every shift of this period, and only those', async () => {
  const stray = shiftOf('2026-12-22', 'heen', []); stray.periodFirstDay = '2026-12-21';
  const fake = useFakeDb({ ...sampleDbSeed(), 'periodCars/2026-12-21_2026-12-22_heen': stray }); coordP({ periodCars: { '2026-12-21_2026-12-22_heen': stray } });
  await makePeriodRooster();
  assert.equal(await deletePeriodRooster(), true);
  assert.deepEqual(Object.keys(S.periodCars), ['2026-12-21_2026-12-22_heen']); assert.ok(fake.get('periodCars/2026-12-21_2026-12-22_heen'));
  assert.equal(fake.get('periodCars/2026-10-26_2026-10-27_terug'), undefined); assert.equal(toast(), 'Tijdelijk rooster verwijderd');
});

console.log('\n=== Terug met OV (US-06) ===');
import { setReturnByPublicTransport } from '../data.js';
await testAsync('marking takes the girl out of her terug car and stores the mark with the car she left', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState();
  const ok = await withFakeNowAsync(NOW, () => setReturnByPublicTransport('Ma', 'f6', true));
  assert.equal(ok, true);
  const d = fake.get('deviations/Ma_terug');
  assert.deepEqual(d.cars[0].girlIds, ['f1', 'f2']); assert.equal(d.cars[0].driverFamilyId, 'f2');
  assert.deepEqual(d.ovGirlIds, ['f6']); assert.deepEqual(d.ovFrom, { f6: 'f2' });
  assert.equal(d.weekKey, WEEK_KEY); assert.equal(d.cars[0].baseGroupId, undefined);
});
await testAsync('unmarking puts her back in the same car and removes every trace of the mark', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState();
  await withFakeNowAsync(NOW, () => setReturnByPublicTransport('Ma', 'f6', true));
  S.deviations = Object.fromEntries(fake.collection('deviations'));
  await withFakeNowAsync(NOW, () => setReturnByPublicTransport('Ma', 'f6', false));
  const d = fake.get('deviations/Ma_terug');
  assert.deepEqual(d.cars[0].girlIds, ['f1', 'f2', 'f6']); assert.ok(!('ovGirlIds' in d)); assert.ok(!('ovFrom' in d));
});
await testAsync('another edit of the terug cars keeps the mark; putting her in a car by hand clears it', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState();
  await withFakeNowAsync(NOW, () => setReturnByPublicTransport('Ma', 'f6', true));
  S.deviations = Object.fromEntries(fake.collection('deviations'));
  const cars = fake.get('deviations/Ma_terug').cars.map(c => ({ ...c, departureTime: '17:45' }));
  await withFakeNowAsync(NOW, () => saveDeviationCars('Ma', 'terug', cars));
  assert.deepEqual(fake.get('deviations/Ma_terug').ovGirlIds, ['f6']);
  S.deviations = Object.fromEntries(fake.collection('deviations'));
  await withFakeNowAsync(NOW, () => saveDeviationCars('Ma', 'terug', [{ ...cars[0], girlIds: ['f1', 'f2', 'f6'] }]));
  assert.ok(!('ovGirlIds' in fake.get('deviations/Ma_terug')));
});
await testAsync('a mark from last week is not carried over into this week', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({ deviations: { Ma_terug: { day: 'Ma', direction: 'terug', weekKey: '2026-W39', expiresAt: 1, cars: [], ovGirlIds: ['f3'], ovFrom: { f3: null } } } });
  await withFakeNowAsync(NOW, () => saveDeviationCars('Ma', 'terug', [{ driverFamilyId: 'f2', girlIds: ['f2'], departureTime: '17:30' }]));
  assert.ok(!('ovGirlIds' in fake.get('deviations/Ma_terug')));
});
await testAsync('a girl who is in no car can be marked; the mark is stored even though no car changes', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState();
  await withFakeNowAsync(NOW, () => setReturnByPublicTransport('Ma', 'f3', true));
  assert.deepEqual(fake.get('deviations/Ma_terug').ovGirlIds, ['f3']);
});
await testAsync('a failed write shows a message and returns false', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState(); fake.failWrites('deviations/', 'permission-denied');
  assert.equal(await withFakeNowAsync(NOW, () => setReturnByPublicTransport('Ma', 'f6', true)), false);
  assert.equal(toast(), 'Opslaan mislukt: permission-denied');
});
await testAsync('the new listeners fill S.locationsDoc and S.matchDistances, and stopping clears them', async () => {
  useFakeDb({ ...sampleDbSeed(), 'settings/locations': { defaults: { heen: 'de-parel' } }, 'settings/matchDistances': { m1: { loc: 'x', km: 5 } } });
  sampleCoordinatorState(); startDataListeners(); await tick(); await tick();
  assert.deepEqual(S.locationsDoc, { defaults: { heen: 'de-parel' } }); assert.equal(S.matchDistances.m1.km, 5); assert.equal(S.matchDistancesLoaded, true);
  stopDataListeners();
  assert.equal(S.locationsDoc, null); assert.deepEqual(S.matchDistances, {}); assert.equal(S.matchDistancesLoaded, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
