// Run with: node ritbeurs.test.js
// Ritbeurs (ritbeurs.js): the feature switch, the deadline, quiet hours, offers, taking a ride over, back-up moments and notifications.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import './test-support.js';
import {
  RITBEURS_MESSAGE_MAX, DEFAULT_QUIET, CONFLICT_MINUTES, NOTIFICATION_DAYS,
  normalizeRitbeurs, ritbeursDoc, isTime, isIsoDate, toMin, cleanMessage, rideStartMs, deadlineMs, urgency,
  normalizeQuiet, inQuiet, deliverAtMs, offerId, buildOffer, openOffers, hasOpenOffer, findCarIndex, applyTakeOver, takeWarnings,
  buildMoment, momentId, momentCovers, activeMoments, backupRecipients, ridersToWarn,
  notificationId, notificationDoc, unreadCount, sortedNotifications, stalePaths,
} from '../ritbeurs.js';

const at = (iso) => new Date(iso).getTime();   // all times below are Amsterdam time (the tests run with TZ=Europe/Amsterdam)

console.log('=== the feature switch ===');
test('a missing or broken document means: off', () => {
  [null, undefined, 'x', 5, {}, { on: 'yes' }, { on: 1 }, { on: 'true' }].forEach(r => assert.deepEqual(normalizeRitbeurs(r), { on: false }));
});
test('only a real true switches it on', () => {
  assert.deepEqual(normalizeRitbeurs({ on: true, extra: 1 }), { on: true });
});
test('the stored document has the switch and a time', () => {
  assert.deepEqual(ritbeursDoc(true, 5), { on: true, updatedAt: 5 });
  assert.deepEqual(ritbeursDoc('yes', 5), { on: false, updatedAt: 5 });
});

console.log('=== helpers ===');
test('times and dates are checked strictly', () => {
  assert.equal(isTime('08:05'), true); ['8:05', '24:00', '12:60', '', null, 12].forEach(v => assert.equal(isTime(v), false));
  assert.equal(isIsoDate('2026-10-15'), true); ['2026-02-30', '2026-13-01', '15-10-2026', '', null].forEach(v => assert.equal(isIsoDate(v), false));
  assert.equal(toMin('08:05'), 485); assert.equal(toMin('x'), null);
});
test('the message is one plain line, cut at the maximum', () => {
  assert.equal(RITBEURS_MESSAGE_MAX, 60);
  assert.equal(cleanMessage('  Werk\n loopt   uit '), 'Werk loopt uit');
  assert.equal(cleanMessage('x'.repeat(100)).length, 60);
  assert.equal(cleanMessage(null), '');
  assert.equal(cleanMessage('<b>hoi</b>'), '<b>hoi</b>', 'kept as text; the UI escapes it');
});
test('a ride without a valid time stays visible until the end of its day', () => {
  assert.equal(rideStartMs('2026-10-15', '16:15'), at('2026-10-15T16:15:00+02:00'));
  assert.equal(rideStartMs('2026-10-15', ''), at('2026-10-15T23:59:00+02:00'));
  assert.equal(rideStartMs('nope', '16:15'), 0);
});

console.log('=== the deadline: 18:00 the day before ===');
test('the deadline is 18:00 on the day before the ride', () => {
  assert.equal(deadlineMs('2026-10-15'), at('2026-10-14T18:00:00+02:00'));
  assert.equal(deadlineMs('2026-10-19'), at('2026-10-18T18:00:00+02:00'), 'Monday: the Sunday before');
  assert.equal(deadlineMs('2026-10-26'), at('2026-10-25T18:00:00+01:00'), 'the night the clocks change: still 18:00 local time');
  assert.equal(deadlineMs('x'), null);
});
test('urgency: ok, soon (within 24 hours of the deadline) and late (deadline passed)', () => {
  assert.equal(urgency('2026-10-15', at('2026-10-12T10:00:00+02:00')), 'ok');
  assert.equal(urgency('2026-10-15', at('2026-10-13T17:59:00+02:00')), 'ok', 'more than 24 hours before the deadline');
  assert.equal(urgency('2026-10-15', at('2026-10-13T18:00:00+02:00')), 'soon', 'exactly 24 hours before the deadline');
  assert.equal(urgency('2026-10-15', at('2026-10-14T17:59:00+02:00')), 'soon');
  assert.equal(urgency('2026-10-15', at('2026-10-14T18:00:00+02:00')), 'late');
  assert.equal(urgency('2026-10-15', at('2026-10-15T07:00:00+02:00')), 'late');
  assert.equal(urgency('bad', 0), 'ok');
});

console.log('=== quiet hours ===');
test('the default is 22:00 to 06:00', () => {
  assert.deepEqual(DEFAULT_QUIET, { from: '22:00', to: '06:00' });
  [null, {}, { from: 'x', to: 5 }].forEach(r => assert.deepEqual(normalizeQuiet(r), DEFAULT_QUIET));
  assert.deepEqual(normalizeQuiet({ from: '23:30', to: '07:15' }), { from: '23:30', to: '07:15' });
});
test('quiet hours across midnight', () => {
  const q = { from: '22:00', to: '06:00' };
  assert.equal(inQuiet(toMin('21:59'), q), false);
  assert.equal(inQuiet(toMin('22:00'), q), true);
  assert.equal(inQuiet(toMin('03:00'), q), true);
  assert.equal(inQuiet(toMin('05:59'), q), true);
  assert.equal(inQuiet(toMin('06:00'), q), false);
});
test('quiet hours inside one day, and none when start equals end', () => {
  assert.equal(inQuiet(toMin('13:30'), { from: '13:00', to: '14:00' }), true);
  assert.equal(inQuiet(toMin('14:00'), { from: '13:00', to: '14:00' }), false);
  assert.equal(inQuiet(toMin('03:00'), { from: '08:00', to: '08:00' }), false);
});
test('delivery waits until the quiet hours end, otherwise it is immediate', () => {
  const noon = at('2026-10-14T12:00:00+02:00');
  assert.equal(deliverAtMs(noon, null), noon);
  assert.equal(deliverAtMs(at('2026-10-14T23:10:00+02:00'), null), at('2026-10-15T06:00:00+02:00'));
  assert.equal(deliverAtMs(at('2026-10-15T02:00:00+02:00'), null), at('2026-10-15T06:00:00+02:00'));
  assert.equal(deliverAtMs(at('2026-10-14T23:10:00+02:00'), { from: '23:00', to: '07:30' }), at('2026-10-15T07:30:00+02:00'));
});

console.log('=== offers ===');
const offerArgs = { weekKey: '2026-W42', day: 'Do', direction: 'heen', date: '2026-10-15', time: '16:15', familyId: 'fJoost', message: ' Werk  loopt uit ', nowMs: 1000 };
test('an offer starts open, with a clean message and the time of the ride', () => {
  assert.deepEqual(buildOffer(offerArgs), { weekKey: '2026-W42', day: 'Do', direction: 'heen', date: '2026-10-15', time: '16:15', offeredBy: 'fJoost', message: 'Werk loopt uit', status: 'open', createdAt: 1000 });
  assert.equal(buildOffer({ ...offerArgs, time: 'x' }).time, '');
});
test('the offer id holds week, day, direction, family and time', () => {
  assert.equal(offerId(offerArgs), '2026-W42_Do_heen_fJoost_1000');
});
test('open offers: this week only, not started, soonest first', () => {
  const o = {
    a: { ...buildOffer(offerArgs), time: '17:30' },
    b: { ...buildOffer(offerArgs), time: '08:00', date: '2026-10-14' },
    c: { ...buildOffer(offerArgs), status: 'taken' },
    d: { ...buildOffer(offerArgs), status: 'withdrawn' },
    e: { ...buildOffer(offerArgs), weekKey: '2026-W41' },
    f: { ...buildOffer(offerArgs), date: '2026-10-12', time: '08:00' },
  };
  const now = at('2026-10-13T10:00:00+02:00');
  assert.deepEqual(openOffers(o, '2026-W42', now).map(x => x.id), ['b', 'a']);
  assert.deepEqual(openOffers(null, '2026-W42', now), []);
});
test('a ride that is already on offer cannot be offered twice, a taken one can be offered again', () => {
  const o = { a: buildOffer(offerArgs) };
  assert.equal(hasOpenOffer(o, '2026-W42', 'Do', 'heen', 'fJoost'), true);
  assert.equal(hasOpenOffer(o, '2026-W42', 'Do', 'terug', 'fJoost'), false);
  assert.equal(hasOpenOffer(o, '2026-W42', 'Do', 'heen', 'fAnna'), false);
  assert.equal(hasOpenOffer({ a: { ...o.a, status: 'taken' } }, '2026-W42', 'Do', 'heen', 'fJoost'), false);
});

console.log('=== taking a ride over ===');
const cars = [
  { driverFamilyId: 'fJoost', girlIds: ['g1', 'g2', 'g3'], departureTime: '16:15', locationText: 'Station' },
  { driverFamilyId: 'fRuud', girlIds: ['g4'], departureTime: '16:30' },
];
const offer = buildOffer(offerArgs);
test('the car of the offerer is found, by time when the offerer has several cars', () => {
  assert.equal(findCarIndex(cars, offer), 0);
  assert.equal(findCarIndex(cars, { ...offer, offeredBy: 'fNobody' }), -1);
  const two = [{ driverFamilyId: 'fJoost', girlIds: ['a'], departureTime: '08:00' }, { driverFamilyId: 'fJoost', girlIds: ['b'], departureTime: '16:15' }];
  assert.equal(findCarIndex(two, offer), 1);
  assert.equal(findCarIndex(two, { ...offer, time: '' }), 0);
});
test('taking over changes only the driver, and does not touch the input', () => {
  const copy = JSON.parse(JSON.stringify(cars));
  const out = applyTakeOver(cars, offer, 'fAnna');
  assert.deepEqual(out[0], { driverFamilyId: 'fAnna', girlIds: ['g1', 'g2', 'g3'], departureTime: '16:15', locationText: 'Station' });
  assert.deepEqual(out[1], cars[1]);
  assert.deepEqual(cars, copy);
});
test('nothing to take over: no car, no taker, or the offerer themselves', () => {
  assert.equal(applyTakeOver(cars, { ...offer, offeredBy: 'fNobody' }, 'fAnna'), null);
  assert.equal(applyTakeOver(cars, offer, ''), null);
  assert.equal(applyTakeOver(cars, offer, 'fJoost'), null);
  assert.equal(applyTakeOver(null, offer, 'fAnna'), null);
});
test('warnings: seats and a ride at about the same time (a warning, never a block)', () => {
  const w = takeWarnings({ offer, cars, takerSeats: 4, takerRides: [] });
  assert.deepEqual(w, { seats: { need: 3, have: 4, ok: true }, conflict: null });
  const few = takeWarnings({ offer, cars, takerSeats: 2, takerRides: [] });
  assert.deepEqual(few.seats, { need: 3, have: 2, ok: false });
  const near = takeWarnings({ offer, cars, takerSeats: 4, takerRides: [{ day: 'Do', direction: 'terug', date: '2026-10-15', time: '17:15' }] });
  assert.deepEqual(near.conflict, { day: 'Do', direction: 'terug', time: '17:15' });
  assert.equal(CONFLICT_MINUTES, 90);
});
test('no conflict for a ride on another day or far enough away', () => {
  const far = takeWarnings({ offer, cars, takerSeats: 4, takerRides: [{ day: 'Do', direction: 'terug', date: '2026-10-15', time: '18:00' }, { day: 'Vr', direction: 'heen', date: '2026-10-16', time: '16:15' }] });
  assert.equal(far.conflict, null);
});

console.log('=== "Ik kan inspringen" ===');
const mArgs = { familyId: 'fSanne', date: '2026-10-15', from: '15:00', to: '18:30', nowMs: 2000 };
test('a moment needs a family, a real date and an earlier start than end', () => {
  assert.deepEqual(buildMoment(mArgs), { familyId: 'fSanne', date: '2026-10-15', from: '15:00', to: '18:30', onlyIfFree: true, createdAt: 2000 });
  assert.equal(buildMoment({ ...mArgs, familyId: '' }), null);
  assert.equal(buildMoment({ ...mArgs, date: '2026-02-30' }), null);
  assert.equal(buildMoment({ ...mArgs, from: '18:30', to: '15:00' }), null);
  assert.equal(buildMoment({ ...mArgs, from: '15:00', to: '15:00' }), null);
  assert.equal(buildMoment({ ...mArgs, from: '9:00' }), null);
});
test('a moment has no place; only an explicit false turns "only if free" off', () => {
  assert.equal('place' in buildMoment({ ...mArgs, place: 'mars' }), false);
  assert.equal(buildMoment({ ...mArgs, onlyIfFree: false }).onlyIfFree, false);
  assert.equal(buildMoment({ ...mArgs, onlyIfFree: undefined }).onlyIfFree, true);
});
test('the moment id holds date, start and family', () => {
  assert.equal(momentId({ ...mArgs }), '2026-10-15_1500_fSanne_2000');
});
test('a moment covers a ride when the time lies between start and end, both included', () => {
  const m = buildMoment(mArgs);
  assert.equal(momentCovers(m, '2026-10-15', '15:00'), true);
  assert.equal(momentCovers(m, '2026-10-15', '18:30'), true);
  assert.equal(momentCovers(m, '2026-10-15', '18:31'), false);
  assert.equal(momentCovers(m, '2026-10-16', '16:00'), false);
  assert.equal(momentCovers(m, '2026-10-15', ''), false);
  assert.equal(momentCovers(null, '2026-10-15', '16:00'), false);
});
test('active moments: not ended, soonest first', () => {
  const ms = { a: buildMoment(mArgs), b: buildMoment({ ...mArgs, date: '2026-10-14' }), c: buildMoment({ ...mArgs, date: '2026-10-12' }) };
  assert.deepEqual(activeMoments(ms, at('2026-10-13T10:00:00+02:00')).map(m => m.id), ['b', 'a']);
});
test('an offer goes to the back-ups whose moment covers it, never to the offerer, each family once', () => {
  const ms = {
    m1: buildMoment(mArgs),
    m2: buildMoment({ ...mArgs, familyId: 'fSanne', from: '16:00', to: '17:00' }),
    m3: buildMoment({ ...mArgs, familyId: 'fJoost' }),
    m4: buildMoment({ ...mArgs, familyId: 'fRuud', date: '2026-10-16' }),
    m5: buildMoment({ ...mArgs, familyId: 'fLisa', to: '16:15' }),
    m6: buildMoment({ ...mArgs, familyId: 'fMark', to: '16:14' }),
  };
  assert.deepEqual(backupRecipients({ offer, moments: ms, busy: () => false }).sort(), ['fLisa', 'fSanne']);
});
test('"only if free": a back-up who already drives around that time is skipped, unless they turned it off', () => {
  const ms = { m1: buildMoment(mArgs), m2: buildMoment({ ...mArgs, familyId: 'fLisa', onlyIfFree: false }) };
  const busy = id => true;
  assert.deepEqual(backupRecipients({ offer, moments: ms, busy }), ['fLisa']);
});
test('a new moment warns the drivers with a ride inside it, not the back-up themselves', () => {
  const m = buildMoment(mArgs);
  const rides = [
    { familyId: 'fJoost', date: '2026-10-15', time: '16:15' },
    { familyId: 'fJoost', date: '2026-10-15', time: '17:30' },
    { familyId: 'fSanne', date: '2026-10-15', time: '16:00' },
    { familyId: 'fRuud', date: '2026-10-15', time: '19:00' },
    { familyId: 'fLisa', date: '2026-10-16', time: '16:00' },
  ];
  assert.deepEqual(ridersToWarn({ moment: m, rides }), ['fJoost']);
});

console.log('=== notifications ===');
test('the notification id is the same for the same event, so it can never be written twice', () => {
  assert.equal(notificationId('taken', 'o1', 'fJoost'), 'taken_o1_fJoost');
});
test('a notification holds who, what, when, when to deliver and when it expires', () => {
  const now = at('2026-10-14T23:10:00+02:00');
  const n = notificationDoc({ kind: 'offerBackup', to: 'fSanne', offer, sourceId: 'o1', fromFamilyId: 'fJoost', nowMs: now });
  assert.equal(n.kind, 'offerBackup'); assert.equal(n.toFamilyId, 'fSanne'); assert.equal(n.fromFamilyId, 'fJoost');
  assert.equal(n.date, '2026-10-15'); assert.equal(n.time, '16:15'); assert.equal(n.day, 'Do'); assert.equal(n.direction, 'heen');
  assert.equal(n.read, false);
  assert.equal(n.deliverAt, at('2026-10-15T06:00:00+02:00'), 'the default quiet hours (22:00-06:00) apply');
  assert.equal(n.expiresAt, now + NOTIFICATION_DAYS * 24 * 3600 * 1000);
});
test('the receiver\'s own quiet hours decide the delivery time', () => {
  const now = at('2026-10-14T23:10:00+02:00');
  const n = notificationDoc({ kind: 'taken', to: 'fJoost', offer, sourceId: 'o1', nowMs: now, quiet: { from: '23:30', to: '07:00' } });
  assert.equal(n.deliverAt, now);
});
test('a notification about a back-up moment carries the moment times', () => {
  const m = buildMoment(mArgs);
  const n = notificationDoc({ kind: 'backupForRide', to: 'fJoost', moment: m, sourceId: 'm1', fromFamilyId: 'fSanne', nowMs: 5 });
  assert.equal(n.momentFrom, '15:00'); assert.equal(n.momentTo, '18:30'); assert.equal(n.date, '2026-10-15');
});
test('unread count and order (newest first)', () => {
  const ns = { a: { createdAt: 1, read: false }, b: { createdAt: 3, read: true }, c: { createdAt: 2 } };
  assert.equal(unreadCount(ns), 2);
  assert.deepEqual(sortedNotifications(ns).map(n => n.id), ['b', 'c', 'a']);
  assert.equal(unreadCount(null), 0);
});

console.log('=== housekeeping ===');
test('stale paths: other weeks, ended moments and expired notifications', () => {
  const now = at('2026-10-20T10:00:00+02:00');
  const paths = stalePaths({
    offers: { a: { weekKey: '2026-W42' }, b: { weekKey: '2026-W43' } },
    moments: { m1: buildMoment({ ...mArgs, date: '2026-10-15' }), m2: buildMoment({ ...mArgs, date: '2026-10-20' }) },
    notificationsByFamily: { f1: { n1: { expiresAt: now - 1 }, n2: { expiresAt: now + 1 } } },
    weekKey: '2026-W43', nowMs: now,
  });
  assert.deepEqual(paths.sort(), ['backupMoments/m1', 'families/f1/notifications/n1', 'offers/a']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
