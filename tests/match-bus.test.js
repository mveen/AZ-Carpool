// Run with: node match-bus.test.js
// Away matches by team bus: the default per team (with the "not against" words), the bus state of one match, the suggested car time, and storing the bus fields.
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
import { BUS_DRIVE_MIN, BUS_MARGIN_MIN, busDefaultFor, busNotList, busPatch, busState, carArrival, carMissesBus, pickupOf, setMatchBus, suggestedBusCarDeparture, validTime } from '../match-bus.js';

const away = { isHome: false, opponent: 'FC Volendam' };
const awayAjax = { isHome: false, opponent: 'Jong Ajax' };
const home = { isHome: true, opponent: 'FC Volendam' };
const jong = { calendarId: 'cal1', label: 'Jong AZ', bus: true, busNot: 'Ajax' };
const o17 = { calendarId: 'cal2', label: 'AZ O17' };

console.log('=== the default of a team ===');
test('"niet met de bus tegen" is split on comma, semicolon and new lines, lower case, without empty words', () => {
  assert.deepEqual(busNotList(' Ajax, Feyenoord ;PSV\n\n'), ['ajax', 'feyenoord', 'psv']);
  assert.deepEqual(busNotList(''), []); assert.deepEqual(busNotList(undefined), []);
});
test('a team goes by bus only when its switch is on; an opponent with one of the words in its name is left out (also Jong Ajax)', () => {
  assert.equal(busDefaultFor(jong, 'FC Volendam'), true);
  assert.equal(busDefaultFor(jong, 'Ajax O15'), false); assert.equal(busDefaultFor(jong, 'Jong Ajax'), false); assert.equal(busDefaultFor(jong, 'JONG AJAX'), false);
  assert.equal(busDefaultFor(o17, 'FC Volendam'), false); assert.equal(busDefaultFor(undefined, 'x'), false);
  assert.equal(busDefaultFor({ bus: false, busNot: '' }, 'x'), false);
});

console.log('\n=== the state of one match ===');
test('a home match never has the bus, whatever is stored', () => {
  assert.deepEqual(busState(home, jong, { bus: true, busDepart: '08:45' }), { applies: false, on: false, changed: false, depart: '', back: '' });
  assert.equal(busState(null, jong, null).applies, false); assert.equal(busState({ isHome: null, opponent: '' }, jong, null).applies, false);
});
test('without anything stored the team default decides', () => {
  assert.deepEqual(busState(away, jong, null), { applies: true, on: true, changed: false, depart: '', back: '' });
  assert.equal(busState(awayAjax, jong, null).on, false); assert.equal(busState(away, o17, null).on, false);
  assert.equal(busState(away, undefined, {}).on, false);   // a match of a calendar that is gone from Beheer: no bus
});
test('a stored true/false overrides the default and says "changed" only when it differs from it', () => {
  assert.deepEqual(busState(awayAjax, jong, { bus: true }), { applies: true, on: true, changed: true, depart: '', back: '' });
  assert.deepEqual(busState(away, jong, { bus: false }), { applies: true, on: false, changed: true, depart: '', back: '' });
  assert.equal(busState(away, jong, { bus: true }).changed, false); assert.equal(busState(away, o17, { bus: false }).changed, false);
  assert.deepEqual(busState(away, o17, { bus: true }), { applies: true, on: true, changed: true, depart: '', back: '' });
});
test('the bus times only count while the bus is on, and only when they are real times', () => {
  assert.deepEqual(busState(away, jong, { busDepart: '08:45', busBack: '15:15' }), { applies: true, on: true, changed: false, depart: '08:45', back: '15:15' });
  assert.deepEqual(busState(away, jong, { bus: false, busDepart: '08:45', busBack: '15:15' }), { applies: true, on: false, changed: true, depart: '', back: '' });
  assert.equal(busState(away, jong, { busDepart: '8:45', busBack: '25:00' }).depart, ''); assert.equal(busState(away, jong, { busBack: 'laat' }).back, '');
});

console.log('\n=== times of a car ===');
test('validTime accepts hh:mm only', () => {
  ['00:00', '08:45', '23:59'].forEach(v => assert.ok(validTime(v), v)); ['', '8:45', '24:00', '12:60', '12:5', null, undefined].forEach(v => assert.ok(!validTime(v), String(v)));
});
test('the suggested departure is the bus time minus the drive and the margin; nothing without a bus time', () => {
  assert.equal(BUS_DRIVE_MIN, 40); assert.equal(BUS_MARGIN_MIN, 20);
  assert.equal(suggestedBusCarDeparture('08:45'), '07:45'); assert.equal(suggestedBusCarDeparture('10:05'), '09:05');
  assert.equal(suggestedBusCarDeparture(''), ''); assert.equal(suggestedBusCarDeparture('00:30'), ''); assert.equal(suggestedBusCarDeparture('01:00'), '00:00');   // before midnight: no suggestion
});
test('a car arrives the drive time after it leaves', () => {
  assert.equal(carArrival('07:45'), '08:25'); assert.equal(carArrival('23:30'), ''); assert.equal(carArrival(''), ''); assert.equal(carArrival('--:--'), '');
});
test('a car misses the bus only when it arrives after the bus leaves (on time is fine, unknown times never warn)', () => {
  assert.equal(carMissesBus('08:10', '08:45'), true);    // arrives 08:50
  assert.equal(carMissesBus('08:05', '08:45'), false);   // arrives 08:45: just in time
  assert.equal(carMissesBus('07:45', '08:45'), false);
  assert.equal(carMissesBus('08:10', ''), false); assert.equal(carMissesBus('', '08:45'), false);
});
test('the pick-up time of a car is its own time, else the time of the bus, else nothing', () => {
  const st = { back: '15:15' };
  assert.equal(pickupOf({ pickupTime: '15:45' }, st), '15:45'); assert.equal(pickupOf({}, st), '15:15'); assert.equal(pickupOf({ pickupTime: 'x' }, st), '15:15');
  assert.equal(pickupOf({}, { back: '' }), ''); assert.equal(pickupOf(null, null), '');
});

console.log('\n=== storing ===');
test('busPatch stores the switch and both times without undefined values, empty times allowed, wrong times refused', () => {
  assert.deepEqual(busPatch({ on: true, depart: '08:45', back: '15:15' }), { ok: true, patch: { bus: true, busDepart: '08:45', busBack: '15:15' } });
  assert.deepEqual(busPatch({ on: false }), { ok: true, patch: { bus: false, busDepart: '', busBack: '' } });
  assert.deepEqual(busPatch({ on: true, depart: ' 08:45 ', back: '' }).patch, { bus: true, busDepart: '08:45', busBack: '' });
  assert.equal(busPatch({ on: true, depart: '8.45', back: '' }).ok, false); assert.equal(busPatch({ on: true, depart: '', back: '99:00' }).ok, false);
});
const SLUG = 'ev_cal1__e9';
const INFO = { matchSlug: SLUG, calendarId: 'cal1', eventId: 'e9', teamLabel: 'Jong AZ', summary: 'Volendam-AZ', location: 'Sportpark', startMs: 1_800_000_000_000 };
const CAR = { driverFamilyId: 'f1', girlIds: ['f2'], departureTime: '07:45' };
await testAsync('the bus fields go on the carpool document and the cars and the log that are there stay', async () => {
  const fake = useFakeDb({ ['matchCarpools/' + SLUG]: { ...INFO, cars: [CAR], log: [{ at: 1, act: 'add', car: CAR }] } });
  await setMatchBus({ info: INFO, slug: SLUG, fromId: SLUG, patch: { bus: true, busDepart: '08:45', busBack: '15:15' } });
  const d = fake.get('matchCarpools/' + SLUG);
  assert.deepEqual(d.cars, [CAR]); assert.equal(d.log.length, 1); assert.equal(d.bus, true); assert.equal(d.busDepart, '08:45'); assert.equal(d.busBack, '15:15'); assert.equal(d.summary, 'Volendam-AZ');
});
await testAsync('a match without a document gets one with no cars; a later change of the times keeps the switch', async () => {
  const fake = useFakeDb({});
  await setMatchBus({ info: INFO, slug: SLUG, fromId: SLUG, patch: { bus: false, busDepart: '', busBack: '' } });
  assert.deepEqual(fake.get('matchCarpools/' + SLUG).cars, []); assert.equal(fake.get('matchCarpools/' + SLUG).bus, false);
  await setMatchBus({ info: INFO, slug: SLUG, fromId: SLUG, patch: { bus: false, busDepart: '09:00', busBack: '' } });
  assert.equal(fake.get('matchCarpools/' + SLUG).busDepart, '09:00'); assert.equal(fake.get('matchCarpools/' + SLUG).bus, false);
});
await testAsync('a car that somebody added while the bus times were saved is not lost (transaction on the fresh document)', async () => {
  const fake = useFakeDb({ ['matchCarpools/' + SLUG]: { ...INFO, cars: [CAR] } });
  const other = { driverFamilyId: 'f3', girlIds: ['f5'], departureTime: '07:30' };
  fake.interfereNextTransaction('matchCarpools/' + SLUG, { ...INFO, cars: [CAR, other] });
  await setMatchBus({ info: INFO, slug: SLUG, fromId: SLUG, patch: { bus: true, busDepart: '08:45', busBack: '' } });
  assert.deepEqual(fake.get('matchCarpools/' + SLUG).cars, [CAR, other]); assert.equal(fake.get('matchCarpools/' + SLUG).busDepart, '08:45');
});
await testAsync('an old name-keyed document moves over to the id-keyed one, with the bus fields', async () => {
  const fake = useFakeDb({ ['matchCarpools/oldname_123']: { ...INFO, cars: [CAR] } });
  await setMatchBus({ info: INFO, slug: SLUG, fromId: 'oldname_123', patch: { bus: true, busDepart: '08:45', busBack: '15:15' } });
  assert.deepEqual(fake.get('matchCarpools/' + SLUG).cars, [CAR]); assert.equal(fake.get('matchCarpools/oldname_123'), undefined);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
