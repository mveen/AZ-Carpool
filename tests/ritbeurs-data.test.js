// Run with: node ritbeurs-data.test.js
// Ritbeurs, the database side: the feature switch, offering, withdrawing, taking over (first yes wins, in one batch), back-up moments,
// notifications and the background checks. The database here is ALWAYS the in-memory fake.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, useFakeDb, withFakeNowAsync, NOW, WEEK_KEY, sampleDbSeed, sampleParentState, sampleCoordinatorState, sampleGroups } from './test-support.js';
import { S } from '../state.js';
import {
  ritbeursOn, setRitbeurs, ridesOf, allRides, warningsFor, quietOf, createOffer, withdrawOffer, takeOffer, addMoment, removeMoment,
  markNotificationsRead, saveQuiet, checkRitbeurs,
} from '../ritbeurs-data.js';

const dom = installFakeDom();
const toast = () => dom.doc.getElementById('toast').innerHTML.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
// Thursday 1 Oct 2026 is in the planning week of NOW (Wed 30 Sep, week 40). f2 drives Thursday's outward ride with f1 and f4 on board.
const groups = () => ({ ...sampleGroups(), Do_heen_1: { day: 'Do', direction: 'heen', girlIds: ['f1', 'f4'], driverFamilyId: 'f2', reserveFamilyIds: [], departureTime: '16:15' } });
const seed = (extra = {}, on = true) => ({ ...sampleDbSeed(), 'groups/Do_heen_1': groups().Do_heen_1, ...(on === null ? {} : { 'settings/ritbeurs': { on, updatedAt: 1 } }), ...extra });
const parent = (patch = {}, on = true) => sampleParentState({ groups: groups(), ritbeurs: on === null ? null : { on }, ...patch });
const run = fn => withFakeNowAsync(NOW, fn);
const keys = (fake, prefix) => [...fake.store.keys()].filter(k => k.startsWith(prefix)).sort();

console.log('=== feature switch ===');
await testAsync('the switch is off when nothing is stored, and on only for a real true', async () => {
  parent({}, null); assert.equal(ritbeursOn(), false);
  S.ritbeurs = { on: 'yes' }; assert.equal(ritbeursOn(), false);
  S.ritbeurs = { on: true }; assert.equal(ritbeursOn(), true);
});
await testAsync('only the real coordinator can switch it, and it is stored with a time', async () => {
  const fake = useFakeDb(seed({}, null));
  parent({}, null);
  assert.equal(await setRitbeurs(true), false);
  assert.match(toast(), /Alleen de coördinator/);
  assert.equal(fake.get('settings/ritbeurs'), undefined);
  sampleCoordinatorState();
  assert.equal(await setRitbeurs(true), true);
  assert.equal(fake.get('settings/ritbeurs').on, true);
  assert.equal(S.ritbeurs.on, true);
  assert.equal(await setRitbeurs(false), true);
  assert.equal(fake.get('settings/ritbeurs').on, false);
  assert.match(toast(), /Alle meldingen zijn gestopt/);
});

console.log('=== rides and warnings ===');
await testAsync('ridesOf lists the rides of one family; allRides every family', async () => {
  useFakeDb(seed()); parent();
  const r = await run(async () => ridesOf('f2').find(x => x.day === 'Do' && x.direction === 'heen'));
  assert.ok(r); assert.equal(r.time, '16:15'); assert.equal(r.date, '2026-10-01'); assert.deepEqual(r.girlIds, ['f1', 'f4']);
  assert.ok((await run(async () => allRides())).some(x => x.familyId === 'f2' && x.day === 'Do'));
});
await testAsync('warnings: not enough seats and a ride at nearly the same time', async () => {
  useFakeDb(seed()); parent();
  const offer = { day: 'Do', direction: 'heen', date: '2026-10-01', time: '16:15', offeredBy: 'f2' };
  const w = await run(async () => warningsFor(offer, 'f3'));
  assert.equal(w.seats.need, 2); assert.equal(w.seats.ok, true);
});

console.log('=== offering ===');
await testAsync('an offer is stored, and only back-ups whose moment covers the ride (and who are not busy) are notified', async () => {
  const fake = useFakeDb(seed({
    'backupMoments/m3': { familyId: 'f3', date: '2026-10-01', from: '15:00', to: '18:00', place: 'alkmaar', onlyIfFree: true, createdAt: 1 },
    'backupMoments/m4': { familyId: 'f4', date: '2026-10-01', from: '08:00', to: '10:00', place: 'alkmaar', onlyIfFree: true, createdAt: 1 },
    'backupMoments/m2': { familyId: 'f2', date: '2026-10-01', from: '15:00', to: '18:00', place: 'alkmaar', onlyIfFree: true, createdAt: 1 },
  }));
  parent({ moments: { m3: { familyId: 'f3', date: '2026-10-01', from: '15:00', to: '18:00', onlyIfFree: true }, m4: { familyId: 'f4', date: '2026-10-01', from: '08:00', to: '10:00', onlyIfFree: true }, m2: { familyId: 'f2', date: '2026-10-01', from: '15:00', to: '18:00', onlyIfFree: true } } });
  const ok = await run(() => createOffer('Do', 'heen', '  Ik moet naar de tandarts  '));
  assert.equal(ok, true);
  const offers = keys(fake, 'offers/');
  assert.equal(offers.length, 1);
  const o = fake.get(offers[0]);
  assert.equal(o.offeredBy, 'f2'); assert.equal(o.status, 'open'); assert.equal(o.time, '16:15'); assert.equal(o.message, 'Ik moet naar de tandarts');
  assert.equal(keys(fake, 'families/f3/notifications/').length, 1);       // moment covers 16:15
  assert.equal(keys(fake, 'families/f4/notifications/').length, 0);       // moment is in the morning
  assert.equal(keys(fake, 'families/f2/notifications/').length, 0);       // the offerer never notifies themselves
  assert.match(toast(), /1 back-up/);
});
await testAsync('the same ride cannot be offered twice, a ride that is over cannot be offered, nor one that is not mine', async () => {
  const fake = useFakeDb(seed()); parent();
  assert.equal(await run(() => createOffer('Do', 'heen', '')), true);
  S.offers = Object.fromEntries(keys(fake, 'offers/').map(k => [k.slice(7), fake.get(k)]));
  assert.equal(await run(() => createOffer('Do', 'heen', '')), false);
  assert.match(toast(), /staat al open/);
  assert.equal(await run(() => createOffer('Vr', 'terug', '')), false);
  assert.match(toast(), /niet meer in het rooster/);
  assert.equal(await withFakeNowAsync('2026-10-01T17:00:00+02:00', () => createOffer('Do', 'heen', '')), false);
});
await testAsync('with the switch off nothing is offered and nothing is written', async () => {
  const fake = useFakeDb(seed({}, false)); parent({}, false);
  assert.equal(await run(() => createOffer('Do', 'heen', '')), false);
  assert.equal(keys(fake, 'offers/').length, 0);
});

console.log('=== withdrawing ===');
await testAsync('the offerer withdraws while open; someone else cannot; a taken ride cannot', async () => {
  const fake = useFakeDb(seed({ 'offers/o1': { weekKey: WEEK_KEY, day: 'Do', direction: 'heen', date: '2026-10-01', time: '16:15', offeredBy: 'f2', message: '', status: 'open', createdAt: 1 } }));
  parent({ offers: { o1: fake.get('offers/o1') } });
  assert.equal(await run(() => withdrawOffer('o1')), true);
  assert.equal(fake.get('offers/o1').status, 'withdrawn');
  S.offers.o1 = fake.get('offers/o1');
  assert.equal(await run(() => withdrawOffer('o1')), false);
  parent({ me: 'p3', links: { p3: { familyId: 'f3' } }, offers: { o2: { ...fake.get('offers/o1'), status: 'open' } } });
  assert.equal(await run(() => withdrawOffer('o2')), false);
});

console.log('=== taking over ===');
const openOffer = { weekKey: WEEK_KEY, day: 'Do', direction: 'heen', date: '2026-10-01', time: '16:15', offeredBy: 'f2', message: '', status: 'open', createdAt: 1 };
await testAsync('taking over changes only the driver and writes offer, rooster and notifications in one go', async () => {
  const fake = useFakeDb(seed({ 'offers/o1': openOffer, 'settings/dayCoordinators': { Do: 'f5' } }));
  parent({ me: 'p3', links: { p3: { familyId: 'f3' } }, offers: { o1: openOffer }, dayCoordinators: { Do: 'f5' } });
  assert.equal(await run(() => takeOffer('o1')), true);
  assert.deepEqual({ s: fake.get('offers/o1').status, by: fake.get('offers/o1').takenBy }, { s: 'taken', by: 'f3' });
  const dev = fake.get('deviations/Do_heen');
  assert.equal(dev.weekKey, WEEK_KEY);
  assert.equal(dev.cars[0].driverFamilyId, 'f3'); assert.deepEqual(dev.cars[0].girlIds, ['f1', 'f4']); assert.equal(dev.cars[0].departureTime, '16:15');
  assert.equal(keys(fake, 'families/f2/notifications/').length, 1);       // the offerer
  assert.equal(keys(fake, 'families/f5/notifications/').length, 1);       // the day coordinator
  assert.equal(keys(fake, 'families/f3/notifications/').length, 0);       // the taker needs no message
  assert.match(toast(), /Je rijdt deze rit/);
});
await testAsync('the day coordinator who is the offerer gets one notification, not two', async () => {
  const fake = useFakeDb(seed({ 'offers/o1': openOffer }));
  parent({ me: 'p3', links: { p3: { familyId: 'f3' } }, offers: { o1: openOffer }, dayCoordinators: { Do: 'f2' } });
  await run(() => takeOffer('o1'));
  assert.equal(keys(fake, 'families/f2/notifications/').length, 1);
});
await testAsync('first yes wins: when the offer is already taken in the database the second taker changes nothing', async () => {
  const fake = useFakeDb(seed({ 'offers/o1': { ...openOffer, status: 'taken', takenBy: 'f3' } }));
  parent({ me: 'p4', links: { p4: { familyId: 'f4' } }, offers: { o1: openOffer } });  // this phone still shows it as open
  fake.failWrites('offers/o1', 'permission-denied');                                     // what the rules answer to the second batch
  assert.equal(await run(() => takeOffer('o1')), false);
  assert.match(toast(), /Te laat/);
  assert.equal(fake.get('deviations/Do_heen'), undefined);
  assert.equal(keys(fake, 'families/').filter(k => k.includes('/notifications/')).length, 0);
  assert.equal(S.rbConfirm, null);
});
await testAsync('one cannot take the own ride, or a ride that is no longer open', async () => {
  const fake = useFakeDb(seed({ 'offers/o1': openOffer })); parent({ offers: { o1: openOffer } });
  assert.equal(await run(() => takeOffer('o1')), false); assert.match(toast(), /je eigen rit/);
  parent({ me: 'p3', links: { p3: { familyId: 'f3' } }, offers: { o1: { ...openOffer, status: 'taken' } } });
  assert.equal(await run(() => takeOffer('o1')), false); assert.match(toast(), /al overgenomen/);
  assert.equal(fake.get('deviations/Do_heen'), undefined);
});
await testAsync('with the switch off a ride cannot be taken over', async () => {
  const fake = useFakeDb(seed({ 'offers/o1': openOffer }, false));
  parent({ me: 'p3', links: { p3: { familyId: 'f3' } }, offers: { o1: openOffer } }, false);
  assert.equal(await run(() => takeOffer('o1')), false);
  assert.equal(fake.get('offers/o1').status, 'open');
});

console.log('=== back-up moments ===');
await testAsync('a moment warns the drivers with a ride inside it (not the back-up themselves)', async () => {
  const fake = useFakeDb(seed()); parent({ me: 'p3', links: { p3: { familyId: 'f3' } } });
  assert.equal(await run(() => addMoment({ date: '2026-10-01', from: '15:00', to: '18:30', place: 'alkmaar', onlyIfFree: true })), true);
  assert.equal(keys(fake, 'backupMoments/').length, 1);
  assert.equal(keys(fake, 'families/f2/notifications/').length, 1);
  assert.equal(keys(fake, 'families/f3/notifications/').length, 0);
  assert.match(toast(), /1 chauffeur/);
});
await testAsync('an invalid moment or one that is over is refused; removing own moment works, a stranger cannot', async () => {
  const fake = useFakeDb(seed()); parent({ me: 'p3', links: { p3: { familyId: 'f3' } } });
  assert.equal(await run(() => addMoment({ date: '2026-10-01', from: '18:00', to: '15:00' })), false);
  assert.match(toast(), /klopt niet/);
  assert.equal(await run(() => addMoment({ date: '2026-09-30', from: '08:00', to: '09:00' })), false);
  assert.match(toast(), /al geweest/);
  await run(() => addMoment({ date: '2026-10-02', from: '08:00', to: '09:00' }));
  const id = keys(fake, 'backupMoments/')[0].slice(14);
  S.moments[id] = fake.get('backupMoments/' + id);
  parent({ moments: S.moments });
  assert.equal(await removeMoment(id), false);
  parent({ me: 'p3', links: { p3: { familyId: 'f3' } }, moments: { [id]: fake.get('backupMoments/' + id) } });
  assert.equal(await removeMoment(id), true);
  assert.equal(keys(fake, 'backupMoments/').length, 0);
});
await testAsync('with the switch off a moment is refused and no one is notified', async () => {
  const fake = useFakeDb(seed({}, false)); parent({ me: 'p3', links: { p3: { familyId: 'f3' } } }, false);
  assert.equal(await run(() => addMoment({ date: '2026-10-01', from: '15:00', to: '18:30' })), false);
  assert.equal(keys(fake, 'backupMoments/').length + keys(fake, 'families/f2/notifications/').length, 0);
});

console.log('=== notifications and quiet hours ===');
await testAsync('notifications are held back in the quiet hours of the receiver', async () => {
  const fake = useFakeDb(seed({ 'offers/o1': openOffer }));
  parent({ me: 'p3', links: { p3: { familyId: 'f3' } }, offers: { o1: openOffer } });
  S.families.f2.ritbeursQuiet = { from: '00:00', to: '23:00' };
  await run(() => takeOffer('o1'));
  const n = fake.get(keys(fake, 'families/f2/notifications/')[0]);
  assert.ok(n.deliverAt > n.createdAt);
  assert.equal(n.kind, 'taken'); assert.equal(n.read, false); assert.ok(n.expiresAt > n.createdAt);
});
await testAsync('quiet hours default to 22:00-06:00, are saved on the own family, and everything can be marked read', async () => {
  const fake = useFakeDb(seed({ 'families/f2/notifications/a': { kind: 'taken', read: false }, 'families/f2/notifications/b': { kind: 'taken', read: false } }));
  parent({ notifications: { a: { kind: 'taken', read: false }, b: { kind: 'taken', read: false } } });
  assert.deepEqual(quietOf('f2'), { from: '22:00', to: '06:00' });
  assert.equal(await saveQuiet('21:00', '07:00'), true);
  assert.deepEqual(fake.get('families/f2').ritbeursQuiet, { from: '21:00', to: '07:00' });
  assert.equal(await markNotificationsRead(), true);
  assert.equal(fake.get('families/f2/notifications/a').read, true); assert.equal(fake.get('families/f2/notifications/b').read, true);
});

console.log('=== background checks ===');
await testAsync('a late open offer is announced once to the offerer and the day coordinator', async () => {
  const late = { ...openOffer, date: '2026-10-01' };
  const fake = useFakeDb(seed({ 'offers/o1': late }));
  parent({ me: 'p3', links: { p3: { familyId: 'f3' } }, offers: { o1: late }, dayCoordinators: { Do: 'f5' } });
  await withFakeNowAsync('2026-09-30T18:30:00+02:00', () => checkRitbeurs());
  assert.ok(fake.get('offers/o1').uncoveredAt);
  assert.equal(keys(fake, 'families/f2/notifications/').length, 1);
  assert.equal(keys(fake, 'families/f5/notifications/').length, 1);
  await withFakeNowAsync('2026-09-30T18:31:00+02:00', () => checkRitbeurs());
  assert.equal(keys(fake, 'families/f2/notifications/').length, 1);
});
await testAsync('before the deadline nothing is announced; with the switch off the check does nothing at all', async () => {
  const fake = useFakeDb(seed({ 'offers/o1': openOffer }));
  parent({ offers: { o1: openOffer } });
  await run(() => checkRitbeurs());
  assert.equal(fake.get('offers/o1').uncoveredAt, undefined);
  parent({ offers: { o1: openOffer } }, false);
  await withFakeNowAsync('2026-09-30T18:30:00+02:00', () => checkRitbeurs());
  assert.equal(fake.get('offers/o1').uncoveredAt, undefined);
  assert.equal(keys(fake, 'families/f2/notifications/').length, 0);
});
await testAsync('housekeeping: the coordinator removes offers of other weeks and old moments, everybody their own expired notifications', async () => {
  const fake = useFakeDb(seed({
    'offers/old': { ...openOffer, weekKey: '2026-W38' }, 'offers/cur': openOffer,
    'backupMoments/past': { familyId: 'f3', date: '2026-09-20', from: '08:00', to: '09:00' },
    'families/f1/notifications/x': { kind: 'taken', expiresAt: 1 }, 'families/f1/notifications/y': { kind: 'taken', expiresAt: 9e12 },
  }));
  sampleCoordinatorState({ links: { coord: { familyId: 'f1' } }, groups: groups(), ritbeurs: { on: true }, offers: { old: { ...openOffer, weekKey: '2026-W38' }, cur: openOffer }, moments: { past: { familyId: 'f3', date: '2026-09-20', from: '08:00', to: '09:00' } }, notifications: { x: { expiresAt: 1 }, y: { expiresAt: 9e12 } } });
  await run(() => checkRitbeurs());
  assert.equal(fake.get('offers/old'), undefined); assert.ok(fake.get('offers/cur'));
  assert.equal(fake.get('backupMoments/past'), undefined);
  assert.equal(fake.get('families/f1/notifications/x'), undefined); assert.ok(fake.get('families/f1/notifications/y'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
