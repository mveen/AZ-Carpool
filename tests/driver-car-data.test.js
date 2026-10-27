// Run with: node driver-car-data.test.js
// Saving what a driver chose for the own car, and what happens to that choice later. The database here is ALWAYS the in-memory fake.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, useFakeDb, withFakeNowAsync, NOW, sampleDbSeed, sampleParentState, sampleDeviations, assertNoUnusedImports } from './test-support.js';
import { S } from '../state.js';
import { effectiveCars } from '../rides.js';
import { syncWeekRequests } from '../weekrooster-data.js';
import { myCarOf, saveDriverCar } from '../driver-car-data.js';

installFakeDom();
const tick = () => new Promise(r => setImmediate(r));
const DEV = (day, direction, cars, extra = {}) => ({ day, direction, weekKey: '2026-W40', expiresAt: 1791500000000, cars, ...extra });
// f2 (me) drives Thursday terug with f1 and f2 in the car; the sample times of Thursday terug are 17:00 (f1) and 18:00 (f2).
const THU = { Do_terug: DEV('Do', 'terug', [{ driverFamilyId: 'f2', girlIds: ['f1', 'f2'], reserveFamilyIds: [], departureTime: '18:00' }]) };
const setup = async (devs = THU, patch = {}, extra = {}) => {
  const fake = useFakeDb({ ...sampleDbSeed(), ...Object.fromEntries(Object.entries(devs).map(([k, v]) => ['deviations/' + k, v])), ...extra });
  sampleParentState({ dayCoordinators: { Do: 'f3' }, deviations: { ...sampleDeviations(), ...devs }, ...patch });
  syncWeekRequests(); await tick(); return fake;
};
const run = fn => withFakeNowAsync(NOW, fn);

console.log('=== saving ===');
await testAsync('my car: the car I drive on that shift, and nothing for a shift I do not drive', async () => {
  await setup();
  await run(async () => {
    const m = myCarOf('Do', 'terug'); assert.equal(m.idx, 0); assert.equal(m.me, 'f2');
    assert.equal(myCarOf('Do', 'heen'), null);
  });
});
await testAsync('time and place are stored on my car only, with a mark for the log of the day coordinator', async () => {
  const fake = await setup({ Do_terug: DEV('Do', 'terug', [{ driverFamilyId: 'f2', girlIds: ['f1'], reserveFamilyIds: [], departureTime: '17:00' }, { driverFamilyId: 'f3', girlIds: ['f4'], reserveFamilyIds: [], departureTime: '17:00' }]) });
  const r = await run(() => saveDriverCar('Do', 'terug', { time: '18:30', locationId: 'de-parel' }));
  assert.equal(r.ok, true);
  const d = fake.get('deviations/Do_terug');
  assert.deepEqual([d.cars[0].departureTime, d.cars[0].locationId], ['18:30', 'de-parel']);
  assert.deepEqual([d.cars[1].departureTime, d.cars[1].locationId], ['17:00', undefined], 'the other car is not touched');
  assert.deepEqual([d.selfBy, typeof d.selfAt], ['f2', 'number']);
  assert.equal(d.weekKey, '2026-W40'); assert.ok(d.expiresAt);
});
await testAsync('no deviation yet: saving makes the one-off change of that shift from the cars as they run', async () => {
  const fake = await setup({}, { groups: { Do_terug_1: { day: 'Do', direction: 'terug', girlIds: ['f1', 'f2'], driverFamilyId: 'f2', reserveFamilyIds: [], departureTime: '18:00' } } }, { 'groups/Do_terug_1': { day: 'Do', direction: 'terug', girlIds: ['f1', 'f2'], driverFamilyId: 'f2', reserveFamilyIds: [], departureTime: '18:00' } });
  const r = await run(() => saveDriverCar('Do', 'terug', { time: '18:45', locationText: 'Hoofdweg 12' }));
  assert.equal(r.ok, true);
  const c = fake.get('deviations/Do_terug').cars[0];
  assert.deepEqual([c.driverFamilyId, c.girlIds, c.departureTime, c.locationText], ['f2', ['f1', 'f2'], '18:45', 'Hoofdweg 12']);
  assert.equal('baseGroupId' in c, false);
});
await testAsync('someone who does not drive on that shift cannot save anything, and nothing is written', async () => {
  const fake = await setup(THU, { links: { p1: { familyId: 'f4' } } });
  const before = JSON.stringify(fake.get('deviations/Do_terug'));
  const r = await run(() => saveDriverCar('Do', 'terug', { time: '18:30' }));
  assert.equal(r.ok, false); assert.equal(JSON.stringify(fake.get('deviations/Do_terug')), before);
});
await testAsync('an invalid time is refused and nothing is written', async () => {
  const fake = await setup(); const before = JSON.stringify(fake.get('deviations/Do_terug'));
  for (const time of ['', '25:00', '7:5', 'abc']) assert.equal((await run(() => saveDriverCar('Do', 'terug', { time }))).ok, false, time);
  assert.equal(JSON.stringify(fake.get('deviations/Do_terug')), before);
});
await testAsync('the one-off times and "rijdt niet mee" marks of that shift are kept', async () => {
  const fake = await setup({ Do_terug: DEV('Do', 'terug', [{ driverFamilyId: 'f2', girlIds: ['f2'], reserveFamilyIds: [], departureTime: '18:00' }], { times: { f2: '18:00' }, ovGirlIds: ['f1'], ovFrom: { f1: 'f2' } }) });
  await run(() => saveDriverCar('Do', 'terug', { time: '18:10' }));
  const d = fake.get('deviations/Do_terug'); assert.deepEqual(d.times, { f2: '18:00' }); assert.deepEqual(d.ovGirlIds, ['f1']);
});
await testAsync('the soft warning: terug earlier than calculated gives one, later gives none; it never blocks', async () => {
  const fake = await setup();
  let r = await run(() => saveDriverCar('Do', 'terug', { time: '17:00' })); assert.equal(r.ok, true); assert.equal(r.warning, 'vroeg'); assert.equal(r.computed, '18:00');
  r = await run(() => saveDriverCar('Do', 'terug', { time: '18:30' })); assert.equal(r.warning, null);
  assert.equal(fake.get('deviations/Do_terug').cars[0].departureTime, '18:30');
});
await testAsync('Ongedaan puts the shift back exactly as it was', async () => {
  const fake = await setup(); const before = JSON.stringify(fake.get('deviations/Do_terug'));
  const r = await run(() => saveDriverCar('Do', 'terug', { time: '18:30' }));
  assert.notEqual(JSON.stringify(fake.get('deviations/Do_terug')), before);
  assert.equal(await r.undo(), true); assert.equal(JSON.stringify(fake.get('deviations/Do_terug')), before);
});
await testAsync('back to automatic: calculated time, standard place', async () => {
  const fake = await setup({ Do_terug: DEV('Do', 'terug', [{ driverFamilyId: 'f2', girlIds: ['f1', 'f2'], reserveFamilyIds: [], departureTime: '19:00', locationId: 'de-parel' }]) });
  const r = await run(() => saveDriverCar('Do', 'terug', { reset: true })); assert.equal(r.ok, true);
  const c = fake.get('deviations/Do_terug').cars[0];
  assert.deepEqual([c.departureTime, c.locationId], ['18:00', undefined]);
});

const pinned = (extra = {}) => ({ driverFamilyId: 'f2', girlIds: ['f1', 'f2'], reserveFamilyIds: [], departureTime: '18:30', ...extra });
await testAsync('the driver\'s choice is in the effective cars, so Mijn week, Rooster and the agenda read it', async () => {
  await setup({ Do_terug: DEV('Do', 'terug', [pinned()]) });
  await run(async () => { assert.equal(effectiveCars('Do', 'terug')[0].departureTime, '18:30'); });
});
await testAsync('driver-car-data.js imports nothing it does not use', async () => assertNoUnusedImports('driver-car-data.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
