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
import { S } from './state.js';
import {
  createFirestoreDb, initDb, db, recordLastUpdate, purgeStaleDeviations, purgeStaleMatchCarpools, saveDeviationCars, saveInviteCode,
  markTimeChangesSeen, createGroupWithDriver, useOption, createGroupCustom, doToggleCoord, saveCoordFamily,
  migrateLegacyFamilySecrets, syncListeners, startDataListeners, stopDataListeners,
} from './data.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
