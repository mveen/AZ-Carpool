// Run with: node match-cars.test.js
// The cars of a match carpool: one change at a time on the fresh document (add / edit / remove), refused when the car is no longer as it was shown,
// and a log entry for every change.
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
import { useFakeDb } from './test-support.js';
import { LOG_MAX, appendLog, applyCarChange, carBrief, changeMatchCar, logEntries, sameCar } from '../match-cars.js';

const A = { driverFamilyId: 'f1', girlIds: ['f2', 'f4'], departureTime: '09:15', from: 'busstation' };
const B = { driverFamilyId: 'f3', girlIds: ['f5'], departureTime: '07:30' };
const NOW = 1_800_000_000_000;

console.log('=== recognising a car ===');
test('sameCar: driver, time, riders (in any order) and family count; not the pick-up place', () => {
  assert.ok(sameCar(A, { ...A, girlIds: ['f4', 'f2'], from: 'elsewhere' }));
  assert.ok(sameCar({ ...A, familyCount: 0 }, A));   // 0 family members = the field is absent
  assert.ok(!sameCar(A, { ...A, departureTime: '09:30' })); assert.ok(!sameCar(A, { ...A, driverFamilyId: 'f2' }));
  assert.ok(!sameCar(A, { ...A, girlIds: ['f2'] })); assert.ok(!sameCar(A, { ...A, familyCount: 2 })); assert.ok(!sameCar(A, null));
});
test('carBrief keeps who drives, when and who rides, with no undefined values', () => {
  assert.deepEqual(carBrief(A), { driverFamilyId: 'f1', departureTime: '09:15', girlIds: ['f2', 'f4'] });
  assert.deepEqual(carBrief({}), { driverFamilyId: '', departureTime: '', girlIds: [] });
  assert.ok(!JSON.stringify(carBrief(A)).includes('from'));
});

console.log('\n=== one change on a list of cars ===');
test('add appends the car and makes a log entry; adding the same car again is nothing to do', () => {
  const r = applyCarChange([A], { act: 'add', car: B }, { by: 'f3', now: NOW });
  assert.deepEqual(r.cars, [A, B]); assert.deepEqual([r.entry.act, r.entry.by, r.entry.at, r.entry.car], ['add', 'f3', NOW, carBrief(B)]);
  const again = applyCarChange(r.cars, { act: 'add', car: { ...B } });
  assert.ok(again.ok && again.noop); assert.equal(again.entry, undefined);
  assert.equal(applyCarChange(null, { act: 'add', car: A }).cars.length, 1);   // no list yet
});
test('add with undo: true is logged as undo', () => { assert.equal(applyCarChange([], { act: 'add', car: A, undo: true }, { now: NOW }).entry.act, 'undo'); });
test('edit changes the car that matches what was shown, wherever it is in the list, and logs before and after', () => {
  const r = applyCarChange([B, A], { act: 'edit', before: A, car: { driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '10:00' } }, { by: 'f1', now: NOW });
  assert.deepEqual(r.cars.map(c => c.departureTime), ['07:30', '10:00']); assert.equal(r.cars[1].from, 'busstation');   // fields not in the change stay
  assert.deepEqual([r.entry.act, r.entry.car.departureTime, r.entry.to.departureTime], ['edit', '09:15', '10:00']);
});
test('edit is refused when the car is no longer as it was shown; an edit that changes nothing is nothing to do', () => {
  assert.deepEqual(applyCarChange([B], { act: 'edit', before: A, car: A }), { ok: false, reason: 'gone' });
  const r = applyCarChange([A], { act: 'edit', before: A, car: { ...A } }); assert.ok(r.ok && r.noop);
});
test('del removes exactly that car and logs it; an already removed car is nothing to do', () => {
  const r = applyCarChange([A, B], { act: 'del', before: { ...B } }, { by: 'f1', now: NOW });
  assert.deepEqual(r.cars, [A]); assert.deepEqual([r.entry.act, r.entry.car.driverFamilyId], ['del', 'f3']);
  const gone = applyCarChange([A], { act: 'del', before: B }); assert.ok(gone.ok && gone.noop && gone.cars.length === 1);
});
test('an unknown change is refused', () => { assert.equal(applyCarChange([A], { act: 'zap' }).ok, false); });

console.log('\n=== the log ===');
test('appendLog keeps the newest LOG_MAX entries; logEntries returns the well-formed ones newest first', () => {
  let log = []; for (let i = 0; i < LOG_MAX + 5; i++) log = appendLog(log, { at: i, car: carBrief(A) });
  assert.equal(log.length, LOG_MAX); assert.equal(log[0].at, 5); assert.equal(log[LOG_MAX - 1].at, LOG_MAX + 4);
  assert.deepEqual(logEntries({ log }, 3).map(e => e.at), [LOG_MAX + 4, LOG_MAX + 3, LOG_MAX + 2]);
  assert.deepEqual(logEntries({ log: [null, { at: 'x' }, { at: 1 }, { at: 2, car: {} }] }).map(e => e.at), [2]);
  assert.deepEqual(logEntries(null), []); assert.deepEqual(logEntries({ log: 'nope' }), []);
});

console.log('\n=== in the database (transaction) ===');
const SLUG = 'ev_c__e1', INFO = { matchSlug: SLUG, calendarId: 'c', eventId: 'e1', teamLabel: 'AZ O15-1', summary: 'x', location: 'y', startMs: 5 };
await testAsync('the first car creates the document with the match info, the cars and the log', async () => {
  const fake = useFakeDb({});
  const r = await changeMatchCar({ info: INFO, slug: SLUG, fromId: SLUG, change: { act: 'add', car: A }, by: 'f1', now: NOW });
  assert.ok(r.ok); const d = fake.get('matchCarpools/' + SLUG);
  assert.deepEqual([d.matchSlug, d.startMs, d.cars.length, d.log.length], [SLUG, 5, 1, 1]);
});
await testAsync('a change that is nothing to do writes nothing; a refused one writes nothing and says why', async () => {
  const fake = useFakeDb({ ['matchCarpools/' + SLUG]: { ...INFO, cars: [A] } });
  const before = fake.writes.length;
  assert.ok((await changeMatchCar({ info: INFO, slug: SLUG, fromId: SLUG, change: { act: 'add', car: A }, by: 'f1' })).noop);
  assert.ok((await changeMatchCar({ slug: SLUG, fromId: SLUG, change: { act: 'del', before: B } })).noop);
  assert.deepEqual(await changeMatchCar({ info: INFO, slug: SLUG, fromId: SLUG, change: { act: 'edit', before: B, car: B } }), { ok: false, reason: 'gone' });
  assert.equal(fake.writes.length, before);
  const none = useFakeDb({});   // removing from a document that does not exist is nothing to do, and creates nothing
  assert.ok((await changeMatchCar({ slug: SLUG, fromId: SLUG, change: { act: 'del', before: A } })).noop); assert.equal(none.get('matchCarpools/' + SLUG), undefined);
});
await testAsync('somebody else wrote in between: the change is applied on top of THEIR state, nothing is lost', async () => {
  const fake = useFakeDb({ ['matchCarpools/' + SLUG]: { ...INFO, cars: [A] } });
  fake.interfereNextTransaction('matchCarpools/' + SLUG, { ...INFO, cars: [A, B], log: [{ at: 1, by: 'f3', act: 'add', car: carBrief(B) }] });
  await changeMatchCar({ info: INFO, slug: SLUG, fromId: SLUG, change: { act: 'add', car: { driverFamilyId: 'f4', girlIds: ['f4'], departureTime: '10:00' } }, by: 'f4', now: NOW });
  const d = fake.get('matchCarpools/' + SLUG);
  assert.deepEqual(d.cars.map(c => c.driverFamilyId), ['f1', 'f3', 'f4']); assert.deepEqual(d.log.map(e => e.by), ['f3', 'f4']);
});
await testAsync('removing the last car keeps the document (cars [], match info, log)', async () => {
  const fake = useFakeDb({ ['matchCarpools/' + SLUG]: { ...INFO, cars: [A] } });
  await changeMatchCar({ slug: SLUG, fromId: SLUG, change: { act: 'del', before: A }, by: 'f1', now: NOW });
  const d = fake.get('matchCarpools/' + SLUG); assert.deepEqual(d.cars, []); assert.equal(d.log[0].act, 'del'); assert.equal(d.startMs, 5);
});
await testAsync('an old name-keyed document is moved over to the id-keyed one with its cars and log', async () => {
  const fake = useFakeDb({ 'matchCarpools/azo151_5': { startMs: 5, cars: [A], log: [{ at: 1, car: carBrief(A), act: 'add' }] } });
  await changeMatchCar({ info: INFO, slug: SLUG, fromId: 'azo151_5', change: { act: 'add', car: B }, by: 'f3', now: NOW });
  assert.equal(fake.get('matchCarpools/azo151_5'), undefined);
  const d = fake.get('matchCarpools/' + SLUG); assert.deepEqual(d.cars.map(c => c.driverFamilyId), ['f1', 'f3']); assert.equal(d.log.length, 2); assert.equal(d.matchSlug, SLUG);
});
await testAsync('fields this module does not know stay on the document', async () => {
  const fake = useFakeDb({ ['matchCarpools/' + SLUG]: { ...INFO, cars: [A], extra: 'keep' } });
  await changeMatchCar({ info: INFO, slug: SLUG, fromId: SLUG, change: { act: 'add', car: B } });
  assert.equal(fake.get('matchCarpools/' + SLUG).extra, 'keep');
});
await testAsync('a refused write (rules) throws, so the screen can say that saving failed', async () => {
  const fake = useFakeDb({}); fake.failWrites('matchCarpools/', 'permission-denied');
  await assert.rejects(() => changeMatchCar({ info: INFO, slug: SLUG, fromId: SLUG, change: { act: 'add', car: A } }), /permission-denied/);
});


console.log('\n=== the leg of a car ===');
test('the leg is part of the identity of a car (a heen car is not the terug car of the same driver, riders and time), and a missing leg equals ""', () => {
  const base = { driverFamilyId: 'f1', departureTime: '09:15', girlIds: ['f2'] };
  assert.equal(sameCar(base, { ...base, leg: 'terug' }), false); assert.equal(sameCar({ ...base, leg: 'heen' }, { ...base, leg: 'terug' }), false);
  assert.equal(sameCar(base, { ...base, leg: '' }), true); assert.equal(sameCar({ ...base, leg: 'terug' }, { ...base, leg: 'terug' }), true);
});
test('the log keeps the leg of a heen or terug car, and nothing extra for a car that drives both', () => {
  assert.deepEqual(carBrief({ driverFamilyId: 'f1', departureTime: '15:45', girlIds: ['f2'], leg: 'terug' }), { driverFamilyId: 'f1', departureTime: '15:45', girlIds: ['f2'], leg: 'terug' });
  assert.deepEqual(carBrief({ driverFamilyId: 'f1', departureTime: '09:15', girlIds: ['f2'], leg: '' }), { driverFamilyId: 'f1', departureTime: '09:15', girlIds: ['f2'] });
});
test('editing a terug car back to both ways takes the leg off (the new car carries leg "")', () => {
  const before = { driverFamilyId: 'f1', departureTime: '15:45', girlIds: ['f2'], leg: 'terug' };
  const r = applyCarChange([before], { act: 'edit', before, car: { driverFamilyId: 'f1', departureTime: '09:15', girlIds: ['f2'], leg: '' } }, { by: 'f1', now: 1 });
  assert.equal(r.ok, true); assert.equal(r.cars[0].leg, ''); assert.equal(r.cars[0].departureTime, '09:15');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
