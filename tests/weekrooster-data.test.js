// Run with: node weekrooster-data.test.js
// Afwijkend weekrooster, the database side: requests, advice, agreement and tidying up. The feature is always on (no switch).
// The database here is ALWAYS the in-memory fake.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, useFakeDb, withFakeNowAsync, NOW, sampleDbSeed, sampleParentState, sampleCoordinatorState } from './test-support.js';
import { S } from '../state.js';
import { rideTime, ovGirlsFor } from '../rides.js';
import { weekKeyFor, isDayPast, dayEndMs, standardTimes, deciderFamilyOf, syncWeekRequests, stopWeekRequests, submitWeekRequests, withdrawWeekRequests, myDeciderDays, requestsForDeciding, adviceForDay, acceptDay, closeDayRequests, purgeStaleWeekRequests, directPlan, releaseNotRidingRequest, currentMarks } from '../weekrooster-data.js';

const dom = installFakeDom();
const toast = () => dom.doc.getElementById('toast').innerHTML.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

console.log('=== phase 2: the weeks, reading and writing requests ===');
const keys = fake => [...fake.store.keys()].filter(k => k.startsWith('weekRequests/')).sort();
await testAsync('this week and next week; days that are over are not changeable, today still is', async () => {
  sampleParentState({});
  assert.equal(weekKeyFor('this'), '2026-W40'); assert.equal(weekKeyFor('next'), '2026-W41');
  await withFakeNowAsync(NOW, async () => {   // Wednesday 30 September
    assert.equal(isDayPast('2026-W40', 'Di'), true); assert.equal(isDayPast('2026-W40', 'Wo'), false); assert.equal(isDayPast('2026-W41', 'Ma'), false);
  });
  assert.equal(new Date(dayEndMs('2026-W40', 'Do')).getHours(), 0);
  assert.ok(dayEndMs('2026-W40', 'Vr') > dayEndMs('2026-W40', 'Do')); assert.equal(dayEndMs('kapot', 'Do'), undefined);
});
await testAsync('the fixed times: this week, next week; the decider is the day coordinator or else the coordinator\'s family', async () => {
  sampleParentState({ coordinatorConfig: { uid: 'coord', familyId: 'f1' } });
  assert.deepEqual(standardTimes('f2', 'this').Do, { heen: '10:15', terug: '18:00' });
  assert.deepEqual(standardTimes('f2', 'next').Do, { heen: '10:15', terug: '18:00' });
  assert.equal(deciderFamilyOf('Do'), 'f1');
  sampleParentState({}); assert.equal(deciderFamilyOf('Do'), null);
});
await testAsync('with nobody linked no listener is opened and nothing is read', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'weekRequests/2026-W40_Do_f2': { weekKey: '2026-W40', day: 'Do', familyId: 'f2', rides: true, heen: '11:00', terug: '18:00', status: 'pending', createdAt: 1, updatedAt: 1 } });
  [sampleParentState, sampleCoordinatorState].forEach(make => { make({ links: {} }); syncWeekRequests(); assert.equal(S.weekRequestsUnsubs.length, 0); assert.deepEqual(S.weekRequests, {}); assert.equal(S.weekRequestsKey, ''); });
  assert.equal(fake.writes.length, 0);
});
await testAsync('the own requests (10 days: this and next week) are read, live, and only the own ones', async () => {
  const doc = { weekKey: '2026-W40', day: 'Do', familyId: 'f2', rides: true, heen: '11:00', terug: '18:00', status: 'pending', createdAt: 1, updatedAt: 1 };
  const fake = useFakeDb({ ...sampleDbSeed(), 'weekRequests/2026-W40_Do_f2': doc, 'weekRequests/2026-W40_Do_f3': { ...doc, familyId: 'f3' } });
  sampleParentState({}); syncWeekRequests();
  assert.equal(S.weekRequestsUnsubs.length, 10); assert.equal(S.weekRequestsKey, 'f2|2026-W40');
  await new Promise(r => setImmediate(r));
  assert.deepEqual(Object.keys(S.weekRequests), ['2026-W40_Do_f2']);
  syncWeekRequests(); assert.equal(S.weekRequestsUnsubs.length, 10, 'same person and week: listeners are kept');
  await fake.sdk.setDoc(fake.sdk.doc(fake.firestoreDb, 'weekRequests/2026-W41_Ma_f2'), { ...doc, weekKey: '2026-W41', day: 'Ma' });
  assert.ok(S.weekRequests['2026-W41_Ma_f2'], 'a new request shows up at once');
  stopWeekRequests(); assert.equal(S.weekRequestsUnsubs.length, 0); assert.deepEqual(S.weekRequests, {}); assert.equal(S.weekRequestsKey, '');
});
await testAsync('a parent hands in new times: one pending request with only times; the fixed rooster is not touched', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({});
  const before = JSON.stringify([...fake.store.entries()].filter(([k]) => !k.startsWith('weekRequests/')));
  const r = await withFakeNowAsync(NOW, () => submitWeekRequests('this', { Do: { rides: true, heen: '11:00', terug: '18:00' }, Vr: { rides: true, heen: '11:00', terug: '17:00' } }));
  assert.equal(r.ok, true); assert.deepEqual(keys(fake), ['weekRequests/2026-W40_Do_f2']);
  const d = fake.get('weekRequests/2026-W40_Do_f2');
  assert.equal(d.status, 'pending'); assert.equal(d.heen, '11:00'); assert.equal(d.terug, '18:00'); assert.equal(d.test, undefined);
  assert.deepEqual(r.skipped, [{ day: 'Vr', why: 'same' }]);
  assert.equal(JSON.stringify([...fake.store.entries()].filter(([k]) => !k.startsWith('weekRequests/'))), before);
});
await testAsync('next week is stored for next week (the coordinator looking as a family), without any test flag', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ impersonateFamilyId: 'f2' });
  const r = await withFakeNowAsync(NOW, () => submitWeekRequests('next', { Ma: { rides: true, heen: '09:00', terug: '17:30' } }));
  assert.equal(r.ok, true); const d = fake.get('weekRequests/2026-W41_Ma_f2');
  assert.equal(d.test, undefined); assert.equal(d.status, 'pending');
  assert.equal(fake.get('deviations/Ma_heen') === undefined, true, 'next week touches no cars');
});
await testAsync('"rijdt niet mee" on this week is direct and counts at once; putting it back withdraws it and undoes it', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({}); syncWeekRequests();
  await withFakeNowAsync(NOW, async () => {
    const r = await submitWeekRequests('this', { Do: { rides: false } });
    assert.equal(r.ok, true); const d = fake.get('weekRequests/2026-W40_Do_f2');
    assert.equal(d.status, 'direct'); assert.equal(d.rides, false); assert.equal(d.heen, '');
    assert.ok(fake.get('deviations/Do_heen') && fake.get('deviations/Do_terug'), 'both directions of Thursday were changed through the existing deviation logic');
    await new Promise(x => setImmediate(x));
    const back = await submitWeekRequests('this', { Do: { rides: true, heen: '10:15', terug: '18:00' } });
    assert.equal(back.ok, true); assert.equal(fake.get('weekRequests/2026-W40_Do_f2').status, 'withdrawn');
  });
});
await testAsync('nothing changed, a day that is over or nobody linked: nothing is written', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({});
  await withFakeNowAsync(NOW, async () => {
    assert.equal((await submitWeekRequests('this', { Do: { rides: true, heen: '10:15', terug: '18:00' } })).ok, false);
    assert.equal((await submitWeekRequests('this', { Ma: { rides: true, heen: '09:00', terug: '17:00' } })).ok, false);
    sampleParentState({ links: {} });
    assert.equal((await submitWeekRequests('this', { Do: { rides: true, heen: '11:00', terug: '18:00' } })).ok, false);
  });
  assert.deepEqual(keys(fake), []);
});
await testAsync('a double tap makes one request; a refused save says why and frees the button', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({});
  const days = { Do: { rides: true, heen: '11:00', terug: '18:00' } };
  await withFakeNowAsync(NOW, async () => {
    const [a, b] = await Promise.all([submitWeekRequests('this', days), submitWeekRequests('this', days)]);
    assert.deepEqual([a.ok, b.ok].sort(), [false, true]); assert.equal(keys(fake).length, 1); assert.equal(S.wrBusy, false);
    fake.failWrites('weekRequests/', 'permission-denied');
    const c = await submitWeekRequests('this', { Do: { rides: true, heen: '12:00', terug: '18:00' } });
    assert.equal(c.ok, false); assert.match(toast(), /permission-denied/); assert.equal(S.wrBusy, false);
  });
});
await testAsync('withdrawing takes back the open requests of one week only', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({}); syncWeekRequests();
  await withFakeNowAsync(NOW, async () => {
    await submitWeekRequests('this', { Do: { rides: true, heen: '11:00', terug: '18:00' } });
    await submitWeekRequests('next', { Ma: { rides: true, heen: '09:00', terug: '17:30' } });
    await new Promise(x => setImmediate(x));
    assert.equal(await withdrawWeekRequests('this'), true);
    assert.equal(fake.get('weekRequests/2026-W40_Do_f2').status, 'withdrawn'); assert.equal(fake.get('weekRequests/2026-W41_Ma_f2').status, 'pending');
    await new Promise(x => setImmediate(x));
    assert.equal(await withdrawWeekRequests('this'), false, 'nothing open any more');
  });
});
await testAsync('withdrawing one day takes back only the request of that day (design B: Intrekken in the card of a day)', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({}); syncWeekRequests();
  await withFakeNowAsync(NOW, async () => {
    await submitWeekRequests('this', { Do: { rides: true, heen: '11:00', terug: '18:00' }, Vr: { rides: true, heen: '10:00', terug: '16:00' } });
    await new Promise(x => setImmediate(x));
    assert.equal(await withdrawWeekRequests('this', 'Do'), true);
    assert.equal(fake.get('weekRequests/2026-W40_Do_f2').status, 'withdrawn'); assert.equal(fake.get('weekRequests/2026-W40_Vr_f2').status, 'pending');
    await new Promise(x => setImmediate(x));
    assert.equal(await withdrawWeekRequests('this', 'Do'), false, 'that day has nothing open any more');
  });
});

console.log('=== phase 3: the day coordinator reads the requests of his days ===');
const WK = '2026-W40';
const reqDoc = (day, fam, extra = {}) => ({ weekKey: WK, day, familyId: fam, rides: true, heen: '11:00', terug: '18:00', status: 'pending', createdAt: 1, updatedAt: 1, ...extra });
await testAsync('the days a person decides: the day coordinator\'s own days; the coordinator\'s family when no day coordinator is set; nobody without a linked family', async () => {
  sampleParentState({ dayCoordinators: { Do: 'f2', Vr: 'f3' } });
  assert.deepEqual(myDeciderDays(), ['Do']);
  sampleParentState({ dayCoordinators: { Do: 'f2' }, coordinatorConfig: { uid: 'coord', familyId: 'f2' } });
  assert.deepEqual(myDeciderDays(), ['Ma', 'Di', 'Wo', 'Do', 'Vr'], 'days without a day coordinator belong to the coordinator\'s family');
  sampleParentState({ dayCoordinators: { Do: 'f2' }, links: {} }); assert.deepEqual(myDeciderDays(), []);
});
await testAsync('every linked family reads the other families\' requests of all days (this week), live; the own ones stay separate', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'weekRequests/2026-W40_Do_f3': reqDoc('Do', 'f3'), 'weekRequests/2026-W40_Do_f4': reqDoc('Do', 'f4', { status: 'direct', rides: false, heen: '', terug: '' }), 'weekRequests/2026-W40_Vr_f3': reqDoc('Vr', 'f3'), 'weekRequests/2026-W41_Do_f3': reqDoc('Do', 'f3', { weekKey: '2026-W41' }) });
  sampleParentState({ dayCoordinators: { Do: 'f2' } }); syncWeekRequests(); await new Promise(r => setImmediate(r));
  assert.deepEqual(Object.keys(S.dayRequests).sort(), ['2026-W40_Do_f3', '2026-W40_Do_f4', '2026-W40_Vr_f3'], 'all days, only this week, only the others');
  assert.equal(S.dayRequestsUnsubs.length, 1, 'ONE listener on the collection, not one per family per day');
  await fake.sdk.setDoc(fake.sdk.doc(fake.firestoreDb, 'weekRequests/2026-W40_Do_f5'), reqDoc('Do', 'f5'));
  assert.ok(S.dayRequests['2026-W40_Do_f5'], 'a new request shows up at once');
  assert.ok(requestsForDeciding()['2026-W40_Do_f3'] && !requestsForDeciding()['2026-W41_Do_f3']);
  await fake.sdk.setDoc(fake.sdk.doc(fake.firestoreDb, 'weekRequests/2026-W41_Do_f5'), reqDoc('Do', 'f5', { weekKey: '2026-W41' }));
  assert.ok(!S.dayRequests['2026-W41_Do_f5'], 'another week is filtered by the server query');
  syncWeekRequests(); assert.equal(S.dayRequestsUnsubs.length, 1, 'unchanged: the listener is kept');
});
await testAsync('a parent who decides no day also reads the others (for the note); nobody linked: nothing at all; stopping closes everything', async () => {
  useFakeDb({ ...sampleDbSeed(), 'weekRequests/2026-W40_Do_f3': reqDoc('Do', 'f3') });
  sampleParentState({ dayCoordinators: { Do: 'f3' } }); syncWeekRequests();
  assert.equal(S.dayRequestsUnsubs.length, 1); assert.ok(S.dayRequestsKey);
  sampleParentState({ links: {}, dayCoordinators: { Do: 'f2' } }); syncWeekRequests();
  assert.equal(S.dayRequestsUnsubs.length + S.weekRequestsUnsubs.length, 0);
  sampleParentState({ dayCoordinators: { Do: 'f2' } }); syncWeekRequests();
  assert.equal(S.dayRequestsUnsubs.length, 1); stopWeekRequests();
  assert.equal(S.dayRequestsUnsubs.length, 0); assert.deepEqual(S.dayRequests, {}); assert.equal(S.dayRequestsKey, '');
});

import { assertNoUnusedImports } from './test-support.js';
await testAsync('weekrooster-data.js imports nothing it does not use', async () => assertNoUnusedImports('weekrooster-data.js'));

console.log('=== advice and agreement ===');
const advDoc = (day, fam, e = {}) => ({ weekKey: '2026-W40', day, familyId: fam, rides: true, heen: '07:00', terug: '15:00', status: 'pending', createdAt: 1, updatedAt: 1, ...e });
const asDay = async (extra = {}, patch = {}) => {
  const fake = useFakeDb({ ...sampleDbSeed(), ...extra }); sampleParentState({ dayCoordinators: { Do: 'f2' }, ...patch });
  syncWeekRequests(); await new Promise(r => setImmediate(r)); return fake;
};
await testAsync('two requests for the same day of two families give one advice and one agreement', async () => {
  const fake = await asDay({ 'weekRequests/2026-W40_Do_f3': advDoc('Do', 'f3'), 'weekRequests/2026-W40_Do_f4': advDoc('Do', 'f4', { heen: '07:10', terug: '' }) });
  await withFakeNowAsync(NOW, async () => {
    const a = adviceForDay('Do'); assert.equal(a.requests.length, 2); assert.deepEqual(Object.keys(a.directions).sort(), ['heen', 'terug']);
    const r = await acceptDay('Do', 'zuinig'); assert.equal(r.ok, true); assert.equal(r.n, 2);
  });
  assert.equal(fake.get('weekRequests/2026-W40_Do_f3').status, 'accepted'); assert.equal(fake.get('weekRequests/2026-W40_Do_f4').status, 'accepted');
  assert.equal(fake.get('weekRequests/2026-W40_Do_f3').decidedBy, 'f2'); assert.ok(fake.get('deviations/Do_heen').cars.length);
  assert.equal(adviceForDay('Do').requests.length, 0, 'nothing left to decide');
});
await testAsync('after Overnemen the accepted time shows in the ride; Ongedaan puts the requests and the deviations back', async () => {
  const fake = await asDay({ 'weekRequests/2026-W40_Do_f3': advDoc('Do', 'f3') });
  await withFakeNowAsync(NOW, async () => {
    const r = await acceptDay('Do', 'gedoe'); assert.equal(rideTime('f3', 'Do', 'heen'), '07:00');
    assert.equal(await r.undo(), true);
    assert.equal(fake.get('weekRequests/2026-W40_Do_f3').status, 'pending'); assert.equal(S.dayRequests['2026-W40_Do_f3'] ? S.dayRequests['2026-W40_Do_f3'].status : S.weekRequests['2026-W40_Do_f3'].status, 'pending');
    assert.equal(fake.get('deviations/Do_heen').times, undefined);
  });
});
await testAsync('closeDayRequests settles the pending requests of the day without touching the cars; Ongedaan puts them back', async () => {
  const fake = await asDay({ 'weekRequests/2026-W40_Do_f3': advDoc('Do', 'f3'), 'weekRequests/2026-W40_Vr_f3': advDoc('Vr', 'f3') });
  await withFakeNowAsync(NOW, async () => {
    const r = await closeDayRequests('Do'); assert.equal(r.ok, true); assert.equal(r.n, 1);
    assert.equal(fake.get('weekRequests/2026-W40_Do_f3').status, 'accepted'); assert.equal(fake.get('weekRequests/2026-W40_Do_f3').decidedBy, 'f2');
    assert.equal(fake.get('weekRequests/2026-W40_Vr_f3').status, 'pending', 'another day is not touched');
    assert.equal(adviceForDay('Do').requests.length, 0);
    assert.equal((await closeDayRequests('Do')).n, 0, 'nothing left: no write, no toast');
    assert.equal(await r.undo(), true); assert.equal(fake.get('weekRequests/2026-W40_Do_f3').status, 'pending');
  });
});
await testAsync('closeDayRequests keeps the accepted times: the girl no longer has her standard time (Klaar after Zelf indelen)', async () => {
  const car = (dep) => ({ driverFamilyId: 'f2', girlIds: ['f3'], reserveFamilyIds: [], departureTime: dep });
  const fake = await asDay({
    'weekRequests/2026-W40_Do_f3': advDoc('Do', 'f3', { heen: '07:00', terug: '12:00' }),
    'deviations/Do_heen': { day: 'Do', direction: 'heen', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [car('06:00')] },
    'deviations/Do_terug': { day: 'Do', direction: 'terug', weekKey: '2026-W40', expiresAt: 1791500000000, cars: [car('12:00')] },
  });
  S.deviations = { ...S.deviations, Do_heen: fake.get('deviations/Do_heen'), Do_terug: fake.get('deviations/Do_terug') };
  await withFakeNowAsync(NOW, async () => {
    const stdHeen = rideTime('f3', 'Do', 'heen'), stdTerug = rideTime('f3', 'Do', 'terug');
    assert.notEqual(stdTerug, '12:00', 'the test needs a time that differs from the standard one');
    const r = await closeDayRequests('Do'); assert.equal(r.ok, true); assert.equal(r.n, 1);
    assert.equal(rideTime('f3', 'Do', 'heen'), '07:00'); assert.equal(rideTime('f3', 'Do', 'terug'), '12:00');
    assert.equal(fake.get('deviations/Do_terug').times.f3, '12:00');
    assert.equal(fake.get('deviations/Do_terug').cars[0].departureTime, '12:00', 'the cars stay as the coordinator planned them');
    assert.equal(await r.undo(), true);
    assert.equal(rideTime('f3', 'Do', 'heen'), stdHeen); assert.equal(rideTime('f3', 'Do', 'terug'), stdTerug);
  });
});
await testAsync('closeDayRequests: a failed write changes nothing, and it does nothing for somebody without a linked family', async () => {
  const fake = await asDay({ 'weekRequests/2026-W40_Do_f3': advDoc('Do', 'f3') });
  fake.failWrites('weekRequests', 'denied');
  await withFakeNowAsync(NOW, async () => { assert.equal((await closeDayRequests('Do')).ok, false); assert.equal(S.wrBusy, false); });
  assert.equal(fake.get('weekRequests/2026-W40_Do_f3').status, 'pending');
  const off = await asDay({ 'weekRequests/2026-W40_Do_f3': advDoc('Do', 'f3') }, { links: {} });
  await withFakeNowAsync(NOW, async () => { assert.equal((await closeDayRequests('Do')).ok, false); });
  assert.equal(off.get('weekRequests/2026-W40_Do_f3').status, 'pending');
});
await testAsync('a failed batch writes nothing and a second tap while busy does nothing', async () => {
  const fake = await asDay({ 'weekRequests/2026-W40_Do_f3': advDoc('Do', 'f3') });
  fake.failWrites('deviations', 'denied');
  await withFakeNowAsync(NOW, async () => {
    assert.equal((await acceptDay('Do', 'zuinig')).ok, false); assert.equal(S.wrBusy, false);
    assert.equal(fake.get('weekRequests/2026-W40_Do_f3').status, 'pending');
  });
  S.wrBusy = true; assert.equal((await acceptDay('Do', 'zuinig')).ok, false); S.wrBusy = false;
});
await testAsync('without a linked family no advice is made into an agreement and nothing is written', async () => {
  const fake = await asDay({ 'weekRequests/2026-W40_Do_f3': advDoc('Do', 'f3') }, { links: {} });
  const before = [...fake.store.keys()].sort().join();
  await withFakeNowAsync(NOW, async () => { assert.equal((await acceptDay('Do', 'zuinig')).ok, false); });
  assert.equal([...fake.store.keys()].sort().join(), before);
});

console.log('=== edge cases and tidying up ===');
await testAsync('after an agreement a later change by the parent is a NEW request (pending again), the agreement stays in the log of the week', async () => {
  const fake = await asDay({ 'weekRequests/2026-W40_Do_f3': { ...advDoc('Do', 'f3'), status: 'accepted', decidedAt: 5, decidedBy: 'f2' } }, { dayCoordinators: { Do: 'f2' }, links: { p1: { familyId: 'f3' } } });
  const r = await withFakeNowAsync(NOW, () => submitWeekRequests('this', { Do: { rides: true, heen: '07:20', terug: '15:00' } }));
  assert.equal(r.ok, true); const d = fake.get('weekRequests/2026-W40_Do_f3');
  assert.equal(d.status, 'pending'); assert.equal(d.heen, '07:20'); assert.ok(!('decidedBy' in d));
});
await testAsync('a request whose day is over is no longer open (it expires by itself, nothing is deleted or applied)', async () => {
  const fake = await asDay({ 'weekRequests/2026-W40_Di_f3': advDoc('Di', 'f3') }, { dayCoordinators: { Di: 'f2' } });
  await withFakeNowAsync('2026-10-02T08:00:00+02:00', async () => { assert.equal(adviceForDay('Di').requests.length, 0); });
  assert.equal(fake.get('weekRequests/2026-W40_Di_f3').status, 'pending');
});
await testAsync('purgeStaleWeekRequests: only the real coordinator, only OLDER weeks (leftover test requests included)', async () => {
  const seedDocs = { 'weekRequests/2026-W39_Do_f3': advDoc('Do', 'f3', { weekKey: '2026-W39', test: true }), 'weekRequests/2026-W40_Do_f3': advDoc('Do', 'f3'), 'weekRequests/2026-W41_Ma_f3': advDoc('Ma', 'f3', { weekKey: '2026-W41' }) };
  let fake = useFakeDb({ ...sampleDbSeed(), ...seedDocs }); sampleParentState({});
  assert.equal(await purgeStaleWeekRequests(), 0, 'a parent never tidies up');
  fake = useFakeDb({ ...sampleDbSeed(), ...seedDocs }); sampleCoordinatorState({});
  assert.equal(await purgeStaleWeekRequests(), 1);
  assert.equal(fake.get('weekRequests/2026-W39_Do_f3'), undefined); assert.ok(fake.get('weekRequests/2026-W40_Do_f3')); assert.ok(fake.get('weekRequests/2026-W41_Ma_f3'));
});
console.log('=== one batch, and back to the fixed rooster ===');
await testAsync('"rijdt niet mee" and its cars are saved in one batch: a refused deviation saves no request either', async () => {
  const fake = await asDay({}, {});
  fake.failWrites('deviations', 'denied');
  const r = await withFakeNowAsync(NOW, () => submitWeekRequests('this', { Do: { rides: false, heen: '', terug: '' } }));
  assert.equal(r.ok, false); assert.equal(S.wrBusy, false); assert.match(toast(), /denied/, 'the refusal is shown (one batch: a real database saves nothing)');
});
await testAsync('"rijdt niet mee" saved: request direct and the girl is out of the cars', async () => {
  const fake = await asDay({}, {});
  await withFakeNowAsync(NOW, async () => { assert.equal((await submitWeekRequests('this', { Do: { rides: false, heen: '', terug: '' } })).ok, true); });
  assert.equal(fake.get('weekRequests/2026-W40_Do_f2').status, 'direct');
  assert.ok(fake.get('deviations/Do_heen') && fake.get('deviations/Do_terug'), 'both directions are written with the request');
  assert.ok(!fake.get('deviations/Do_heen').cars.some(c => (c.girlIds || []).includes('f2')));
});
await testAsync('"rijdt niet mee" marks her as not riding on both directions, and putting the day back removes the marks again', async () => {
  const fake = await asDay({}, {});
  await withFakeNowAsync(NOW, async () => {
    assert.equal((await submitWeekRequests('this', { Do: { rides: false, heen: '', terug: '' } })).ok, true);
    for (const dir of ['heen', 'terug']) {
      assert.deepEqual(fake.get('deviations/Do_' + dir).ovGirlIds, ['f2'], dir + ': stored as "rijdt niet mee"');
      assert.deepEqual(ovGirlsFor('Do', undefined, dir), ['f2'], dir + ': the app reads her as not riding');
    }
    const std = standardTimes('f2', 'this').Do;
    assert.equal((await submitWeekRequests('this', { Do: { rides: true, heen: std.heen, terug: std.terug } })).ok, true);
    for (const dir of ['heen', 'terug']) assert.deepEqual(ovGirlsFor('Do', undefined, dir), [], dir + ': marks gone after putting it back');
  });
});
await testAsync('releaseNotRidingRequest: withdraws a whole-day "rijdt niet mee" request, also while the other shift is still marked; other requests are left alone', async () => {
  const fake = await asDay({}, {});
  await withFakeNowAsync(NOW, async () => {
    assert.equal(await releaseNotRidingRequest('Do'), false, 'no request: nothing to withdraw');
    await submitWeekRequests('this', { Do: { rides: false, heen: '', terug: '' } });
    assert.equal(fake.get('weekRequests/2026-W40_Do_f2').status, 'direct');
    assert.equal(await releaseNotRidingRequest('Do'), true, 'she is no longer off the whole day');
    assert.equal(fake.get('weekRequests/2026-W40_Do_f2').status, 'withdrawn');
    assert.equal(await releaseNotRidingRequest('Do'), false, 'already withdrawn');
  });
  const other = await asDay({ 'weekRequests/2026-W40_Do_f2': advDoc('Do', 'f2', { status: 'pending' }) }, {});
  await withFakeNowAsync(NOW, async () => { assert.equal(await releaseNotRidingRequest('Do'), false, 'a request with times is not touched'); });
  assert.equal(other.get('weekRequests/2026-W40_Do_f2').status, 'pending');
});
await testAsync('submitWeekRequests this week: marks follow the form per shift, in the same save as the request; currentMarks reads them back', async () => {
  const fake = await asDay({}, {});
  await withFakeNowAsync(NOW, async () => {
    assert.equal((await submitWeekRequests('this', { Do: { rides: true, heen: '', terug: '18:00' } })).ok, true);
    assert.deepEqual(currentMarks('f2').Do, { heen: true, terug: false });
    assert.equal(fake.get('weekRequests/2026-W40_Do_f2'), undefined, 'one shift off is only a mark');
    assert.equal((await submitWeekRequests('this', { Do: { rides: true, heen: '10:15', terug: '18:00' } })).ok, true);
    assert.deepEqual(currentMarks('f2').Do, { heen: false, terug: false });
    assert.equal((await submitWeekRequests('this', { Do: { rides: true, heen: '10:15', terug: '18:00' } })).ok, false, 'nothing changed: nothing written');
    assert.equal((await submitWeekRequests('next', { Do: { rides: false } })).ok, true);
    assert.deepEqual(currentMarks('f2').Do, { heen: false, terug: false }, 'next week has no marks');
  });
});
await testAsync('an accepted request put back to the fixed rooster is withdrawn (no decision kept) and her one-off time leaves the cars', async () => {
  const fake = await asDay({ 'weekRequests/2026-W40_Do_f3': advDoc('Do', 'f3') }, { dayCoordinators: { Do: 'f2' } });
  await withFakeNowAsync(NOW, async () => { assert.equal((await acceptDay('Do', 'gedoe')).ok, true); });
  sampleParentState({ dayCoordinators: { Do: 'f2' }, links: { p1: { familyId: 'f3' } }, deviations: { ...S.deviations } });
  syncWeekRequests(); await new Promise(r => setImmediate(r));
  await withFakeNowAsync(NOW, async () => {
    assert.equal(rideTime('f3', 'Do', 'heen'), '07:00');
    const std = standardTimes('f3', 'this').Do;
    assert.equal((await submitWeekRequests('this', { Do: { rides: true, heen: '07:00', terug: advDoc('Do', 'f3').terug } })).ok, false, 'the accepted form submitted unchanged writes nothing');
    assert.equal(fake.get('weekRequests/2026-W40_Do_f3').status, 'accepted');
    const r = await submitWeekRequests('this', { Do: { rides: true, heen: std.heen, terug: std.terug } });
    assert.equal(r.ok, true);
    assert.equal(rideTime('f3', 'Do', 'heen'), std.heen, 'her fixed time counts again');
  });
  const d = fake.get('weekRequests/2026-W40_Do_f3');
  assert.equal(d.status, 'withdrawn'); assert.ok(!('decidedBy' in d) && !('decidedAt' in d));
  assert.ok(!fake.get('deviations/Do_heen').times || !('f3' in fake.get('deviations/Do_heen').times));
});
await testAsync('a day coordinator who puts his own direct change back: request withdrawn, time off the cars', async () => {
  const fake = await asDay({}, { dayCoordinators: { Do: 'f3' }, links: { p1: { familyId: 'f3' } } });
  await withFakeNowAsync(NOW, async () => {
    await submitWeekRequests('this', { Do: { rides: true, heen: '07:10', terug: '15:00' } });
    assert.equal(rideTime('f3', 'Do', 'heen'), '07:10');
    const std = standardTimes('f3', 'this').Do;
    assert.notEqual(std.heen, '07:10', 'the fixed rooster ignores the one-off time');
    assert.equal((await submitWeekRequests('this', { Do: { rides: true, heen: '07:10', terug: '15:00' } })).ok, false, 'the same again: nothing is written');
    assert.equal((await submitWeekRequests('this', { Do: { rides: true, heen: std.heen, terug: std.terug } })).ok, true);
    assert.equal(rideTime('f3', 'Do', 'heen'), std.heen);
  });
  assert.equal(fake.get('weekRequests/2026-W40_Do_f3').status, 'withdrawn');
  assert.ok(!fake.get('deviations/Do_heen').times || !('f3' in fake.get('deviations/Do_heen').times));
});
console.log('=== the own day of a day coordinator is direct ===');
await testAsync('a day coordinator changing his own daughter on his own day: direct, the cars change at once; on another day: a request', async () => {
  const fake = await asDay({}, { dayCoordinators: { Do: 'f3', Vr: 'f4' }, links: { p1: { familyId: 'f3' } } });
  const r = await withFakeNowAsync(NOW, () => submitWeekRequests('this', { Do: { rides: true, heen: '07:10', terug: '15:00' }, Vr: { rides: true, heen: '07:10', terug: '15:00' } }));
  assert.equal(r.ok, true);
  const own = fake.get('weekRequests/2026-W40_Do_f3'), other = fake.get('weekRequests/2026-W40_Vr_f3');
  assert.equal(own.status, 'direct'); assert.equal(own.decidedBy, 'f3'); assert.equal(other.status, 'pending'); assert.ok(!('decidedBy' in other));
  const dev = fake.get('deviations/Do_heen'); assert.ok(dev && dev.cars.some(c => (c.girlIds || []).includes('f3'))); assert.equal(dev.times.f3, '07:10');
  assert.equal(fake.get('deviations/Vr_heen'), undefined, 'the other day waits for its coordinator');
  await withFakeNowAsync(NOW, async () => { assert.equal(rideTime('f3', 'Do', 'heen'), '07:10'); });
});
await testAsync('next week the own day of a day coordinator stays a request (its cars do not exist yet)', async () => {
  const fake = await asDay({}, { dayCoordinators: { Do: 'f3' }, links: { p1: { familyId: 'f3' } } });
  await withFakeNowAsync(NOW, () => submitWeekRequests('next', { Do: { rides: true, heen: '07:10', terug: '15:00' } }));
  assert.equal(fake.get('weekRequests/2026-W41_Do_f3').status, 'pending'); assert.equal(fake.get('deviations/Do_heen'), undefined);
});
await testAsync('directPlan: nothing to plan gives null, so the request stays a request', async () => {
  await asDay({}, { dayCoordinators: { Do: 'f3' }, links: { p1: { familyId: 'f3' } } });
  await withFakeNowAsync(NOW, async () => { assert.equal(directPlan('Do', { id: 'x', weekKey: '2026-W40', day: 'Do', familyId: 'f3', rides: true, heen: rideTime('f3', 'Do', 'heen'), terug: rideTime('f3', 'Do', 'terug'), status: 'pending' }), null); });
});
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
