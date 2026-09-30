// Run with: node rides.test.js
// Ride assignment logic. Every function takes the app state as its last argument, so these tests pass plain
// objects — no browser, no database. (The planning algorithm itself is tested in planning.test.js.)
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
import { sampleFamilies, sampleGroups, sampleDeviations, WEEK_KEY, resetState, oneP } from './test-support.js';
import { S } from '../state.js';
import {
  fam, seats, girlName, plainGirlName, plainDriverName, famTime, isAvailable, activeDeviation, effectiveCars,
  girlsFor, groupsFor, alreadyGrouped, eligibleDrivers, availableDrivers, sortByShiftPriority, computeDepartureTime,
  planOptions, unplacedFor, carsCountFor, tripReserveIds, timeToMinutes,
  baseCars, periodShift, periodTimeFor, rideTime, girlsForRide, computeRideDeparture, shiftFamilies,
  periodRidersFor, periodCarsFor, periodUnplacedFor, periodDeparture, periodEligibleDrivers, planPeriodShift, planPeriodRooster,
} from '../rides.js';

function state(patch = {}) {
  return {
    families: sampleFamilies(), groups: sampleGroups(), deviations: sampleDeviations(), currentWeekKey: WEEK_KEY,
    shiftPriority: {}, settings: { gapThresholdHours: 3, travelLeadMinutes: 60, prefWindowMinutes: 30 }, prefs: { rules: [] },
    ...patch,
  };
}
const ids = list => list.map(e => e[0]);

console.log('=== families and names ===');
test('fam() returns a harmless placeholder for an unknown family (e.g. a deleted one still listed in a car)', () => {
  const f = fam('gone', state());
  assert.equal(f.parentName, '?'); assert.equal(f.capacity, 4); assert.deepEqual(f.schedule, {});
});
test('seats(): capacity includes the driver, so passengers = capacity - 1, never negative', () => {
  assert.equal(seats({ capacity: 4 }), 3); assert.equal(seats({ capacity: 1 }), 0); assert.equal(seats({}), 0);
});
test('famTime reads the family time for a day and direction, empty when missing', () => {
  const st = state();
  assert.equal(famTime('f1', 'Ma', 'heen', st), '08:30');
  assert.equal(famTime('f1', 'Wo', 'heen', st), '');
  assert.equal(famTime('gone', 'Ma', 'heen', st), '');
});
test('girlName is HTML-escaped, plainGirlName is not', () => {
  const st = state(); st.families.f1.girlName = 'A<b>&';
  assert.equal(girlName('f1', st), 'A&lt;b&gt;&amp;');
  assert.equal(plainGirlName('f1', st), 'A<b>&');
});
test('girl name falls back to the parent name, then to the id', () => {
  const st = state(); st.families.f1.girlName = ''; assert.equal(plainGirlName('f1', st), 'Jan Jansen');
  st.families.f1.parentName = ''; assert.equal(plainGirlName('f1', st), 'f1');
});
test('plainDriverName: the parent, or "nog geen chauffeur" for an empty car', () => {
  const st = state();
  assert.equal(plainDriverName('f2', st), 'Piet Pieters');
  assert.equal(plainDriverName(null, st), 'nog geen chauffeur');
});

console.log('\n=== availability and drivers ===');
test('isAvailable is true for standard OR back-up availability, per direction', () => {
  const f = { availability: { Ma: { heen: false, terug: false, backupHeen: true, backupTerug: false } } };
  assert.equal(isAvailable(f, 'Ma', 'heen'), true);
  assert.equal(isAvailable(f, 'Ma', 'terug'), false);
  assert.equal(isAvailable(f, 'Di', 'heen'), false);
  assert.equal(isAvailable({}, 'Ma', 'heen'), false);
});
test('availableDrivers lists everyone available for that day and direction', () => {
  assert.deepEqual(ids(availableDrivers('Ma', 'heen', state())), ['f1', 'f2', 'f3', 'f6']);
  assert.deepEqual(ids(availableDrivers('Di', 'heen', state())), ['f2', 'f4']);
});
test('eligibleDrivers only keeps drivers with enough passenger seats', () => {
  const st = state();
  assert.deepEqual(ids(eligibleDrivers('Ma', 'heen', 3, st)), ['f1', 'f2', 'f3', 'f6']);
  assert.deepEqual(ids(eligibleDrivers('Ma', 'heen', 4, st)), ['f2', 'f3']);
  assert.deepEqual(ids(eligibleDrivers('Ma', 'heen', 6, st)), []);
});
test('eligibleDrivers follow the Selectievolgorde (shift priority) when one is set', () => {
  const st = state({ shiftPriority: { Ma_heen: { f3: 1, f2: 2 } } });
  assert.deepEqual(ids(eligibleDrivers('Ma', 'heen', 3, st)), ['f3', 'f2', 'f1', 'f6']);
});
test('sortByShiftPriority does not change the original array', () => {
  const st = state({ shiftPriority: { Ma_heen: { f6: 1 } } });
  const entries = [['f1', {}], ['f6', {}]];
  assert.deepEqual(ids(sortByShiftPriority('Ma', 'heen', entries, st)), ['f6', 'f1']);
  assert.deepEqual(ids(entries), ['f1', 'f6']);
});

console.log('\n=== girls, groups, unplaced ===');
test('girlsFor: everyone with a time for that day and direction', () => {
  assert.deepEqual(ids(girlsFor('Ma', 'heen', state())), ['f1', 'f2', 'f3', 'f4', 'f5', 'f6']);
  assert.deepEqual(ids(girlsFor('Wo', 'heen', state())), ['f3']);
  assert.deepEqual(ids(girlsFor('Wo', 'terug', state())), ['f1', 'f3', 'f5']);
});
test('groupsFor / alreadyGrouped read the standard rooster groups', () => {
  const st = state();
  assert.deepEqual(ids(groupsFor('Ma', 'heen', st)), ['Ma_heen_1']);
  assert.deepEqual([...alreadyGrouped('Ma', 'terug', st)].sort(), ['f1', 'f2', 'f6']);
  assert.deepEqual(groupsFor('Di', 'heen', st), []);
});
test('unplacedFor (standard): girls with a time who are in no group', () => {
  assert.deepEqual(ids(unplacedFor('Ma', 'heen', 'standard', state())), ['f3', 'f4', 'f5', 'f6']);
});
test('unplacedFor (week): cars from this week\'s deviation count as placed', () => {
  const st = state();
  assert.deepEqual(ids(unplacedFor('Di', 'heen', 'standard', st)), ['f1', 'f2', 'f4', 'f5', 'f6']);
  assert.deepEqual(ids(unplacedFor('Di', 'heen', 'week', st)), ['f2', 'f5', 'f6']);
});
test('carsCountFor counts real cars per day, standard vs week', () => {
  const st = state();
  assert.equal(carsCountFor('Ma', 'standard', st), 2);
  assert.equal(carsCountFor('Di', 'standard', st), 0);
  assert.equal(carsCountFor('Di', 'week', st), 1);
});

console.log('\n=== deviations (Wijzigen) ===');
test('activeDeviation only applies to the week it was made for', () => {
  assert.ok(activeDeviation('Di', 'heen', state()));
  assert.equal(activeDeviation('Di', 'heen', state({ currentWeekKey: '2026-W41' })), null);
});
test('a deviation without cars counts as no deviation', () => {
  const st = state(); st.deviations.Di_heen.cars = [];
  assert.equal(activeDeviation('Di', 'heen', st), null);
});
test('effectiveCars: this week\'s deviation replaces the standard groups (returns copies)', () => {
  const st = state();
  const cars = effectiveCars('Di', 'heen', st);
  assert.equal(cars.length, 1); assert.equal(cars[0].driverFamilyId, 'f3');
  cars[0].driverFamilyId = 'changed';
  assert.equal(st.deviations.Di_heen.cars[0].driverFamilyId, 'f3', 'the stored deviation must not be modified');
});
test('effectiveCars: without a deviation it shows the standard groups, tagged with baseGroupId', () => {
  const cars = effectiveCars('Ma', 'heen', state());
  assert.equal(cars.length, 1); assert.equal(cars[0].baseGroupId, 'Ma_heen_1'); assert.equal(cars[0].driverFamilyId, 'f1');
});
test('an expired deviation (other week) falls back to the standard groups', () => {
  const st = state({ currentWeekKey: '2026-W41' });
  assert.deepEqual(effectiveCars('Di', 'heen', st), []);
});

console.log('\n=== reserves ===');
test('tripReserveIds: everyone who could take at least the smallest car, minus those already driving', () => {
  const cars = [{ driverFamilyId: 'f1', girlIds: ['f1', 'f2'] }];
  assert.deepEqual(tripReserveIds('Ma', 'heen', cars, state()), ['f2', 'f3', 'f6']);
});
test('tripReserveIds: a big car does not hide reserves who fit the smaller one', () => {
  const cars = [{ driverFamilyId: 'f3', girlIds: ['a', 'b', 'c', 'd', 'e'] }, { driverFamilyId: 'f1', girlIds: ['f', 'g'] }];
  assert.deepEqual(tripReserveIds('Ma', 'heen', cars, state()), ['f2', 'f6']);
});
test('tripReserveIds: no cars, no reserves', () => { assert.deepEqual(tripReserveIds('Ma', 'heen', [], state()), []); });

console.log('\n=== times ===');
test('timeToMinutes delegates to the planning engine', () => { assert.equal(timeToMinutes('08:30'), 510); });
test('computeDepartureTime: heen leaves one travel lead before the earliest arrival', () => {
  assert.equal(computeDepartureTime('Ma', 'heen', ['f1', 'f2'], state()), '07:30');
});
test('computeDepartureTime honours the travel lead setting', () => {
  const st = state(); st.settings.travelLeadMinutes = 45;
  assert.equal(computeDepartureTime('Ma', 'heen', ['f1', 'f2'], st), '07:45');
});
test('computeDepartureTime: terug leaves when the latest girl is done', () => {
  assert.equal(computeDepartureTime('Ma', 'terug', ['f1', 'f2', 'f6'], state()), '17:30');
});

console.log('\n=== planOptions ===');
test('every option puts every girl in exactly one car, and the first option is the primary one', () => {
  const st = state();
  const list = girlsFor('Ma', 'heen', st);
  const opts = planOptions('Ma', 'heen', list, st);
  assert.ok(opts.length >= 1);
  opts.forEach(o => {
    const all = o.assignment.flatMap(a => a.girlIds).sort();
    assert.deepEqual(all, list.map(e => e[0]).sort(), 'option "' + o.label + '"');
  });
});
test('a driver is never used twice within one option', () => {
  const st = state();
  planOptions('Ma', 'heen', girlsFor('Ma', 'heen', st), st).forEach(o => {
    const drivers = o.assignment.map(a => a.driverId);
    assert.equal(new Set(drivers).size, drivers.length);
  });
});
test('option labels name the drivers and are HTML-safe', () => {
  const st = state(); st.families.f2.parentName = 'Piet <P>';
  const labels = planOptions('Ma', 'heen', girlsFor('Ma', 'heen', st), st).map(o => o.label).join('|');
  assert.ok(!labels.includes('<P>'));
});

console.log('\n=== default: reads the shared app state ===');
test('called without a state argument, functions read S', () => {
  resetState({ families: sampleFamilies(), groups: sampleGroups(), deviations: sampleDeviations() });
  assert.deepEqual(ids(groupsFor('Ma', 'heen')), ['Ma_heen_1']);
  assert.equal(plainDriverName('f1'), 'Jan Jansen');
  assert.equal(S.families.f1.parentName, 'Jan Jansen');
});

import { isFlex, driverNameHtml } from '../rides.js';

console.log('\n=== Flex families (US-05) ===');
const flexFam = { parentName: 'Lotte Flex', girlName: 'Lotte', familyType: 'flex', capacity: 3, parentPhone1: '0677777777',
  schedule: { Ma: { heen: '09:00', terug: '16:00' } }, availability: { Ma: { heen: true, terug: true, backupHeen: false, backupTerug: false } } };
function flexState() { const s = state(); s.families = { ...s.families, f9: flexFam }; return s; }
test('isFlex: only familyType "flex" counts (vast, missing and unknown do not)', () => {
  assert.equal(isFlex(flexFam), true);
  assert.equal(isFlex({ familyType: 'vast' }), false);
  assert.equal(isFlex({}), false);
  assert.equal(isFlex(undefined), false);
});
test('a Flex girl is never in the list of girls to plan, even with times in her schedule', () => {
  assert.equal(ids(girlsFor('Ma', 'heen', flexState())).includes('f9'), false);
  assert.equal(ids(girlsFor('Ma', 'heen', state())).length, ids(girlsFor('Ma', 'heen', flexState())).length);
});
test('a Flex girl is never reported as "not placed"', () => {
  assert.equal(ids(unplacedFor('Ma', 'heen', 'standard', flexState())).includes('f9'), false);
  assert.equal(ids(unplacedFor('Ma', 'heen', 'week', flexState())).includes('f9'), false);
});
test('a Flex family is never an automatic driver or reserve, even when marked available', () => {
  assert.equal(ids(availableDrivers('Ma', 'heen', flexState())).includes('f9'), false);
  assert.equal(ids(eligibleDrivers('Ma', 'heen', 1, flexState())).includes('f9'), false);
});
test('a Flex driver is marked "speelster-chauffeur"; a fixed driver is not', () => {
  const st = flexState();
  assert.equal(plainDriverName('f9', st), 'Lotte Flex (speelster-chauffeur)');
  assert.equal(plainDriverName('f1', st), 'Jan Jansen');
  assert.match(driverNameHtml('f9', st), /Lotte Flex <span class="badge flexBadge">speelster-chauffeur<\/span>/);
  assert.equal(driverNameHtml('f1', st), 'Jan Jansen');
  assert.equal(driverNameHtml(null, st), 'nog geen chauffeur');
});
test('a Flex girl who is put in a car through Wijzigen is part of that car', () => {
  const st = flexState();
  st.deviations = { Ma_heen: { day: 'Ma', direction: 'heen', weekKey: WEEK_KEY, expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f1', girlIds: ['f1', 'f9'], departureTime: '07:30' }] } };
  assert.deepEqual(effectiveCars('Ma', 'heen', st)[0].girlIds, ['f1', 'f9']);
  assert.equal(ids(unplacedFor('Ma', 'heen', 'week', st)).includes('f9'), false);
});

import { ovGirlsFor } from '../rides.js';
console.log('\n=== Terug met OV (US-06) ===');
const ovDev = { Ma_terug: { day: 'Ma', direction: 'terug', weekKey: WEEK_KEY, expiresAt: 1791500000000, cars: [], ovGirlIds: ['f3'] }, Di_terug: { day: 'Di', direction: 'terug', weekKey: '2026-W39', expiresAt: 1, cars: [], ovGirlIds: ['f4'] } };
test('ovGirlsFor lists the girls marked "terug met OV" this week, and nothing for another week or day', () => {
  const st = state({ deviations: ovDev });
  assert.deepEqual(ovGirlsFor('Ma', st), ['f3']); assert.deepEqual(ovGirlsFor('Di', st), []); assert.deepEqual(ovGirlsFor('Wo', st), []);
});
test('a girl who goes home by public transport is no longer "not planned" on that terug ride', () => {
  assert.deepEqual(ids(unplacedFor('Ma', 'terug', 'week', state())), ['f3', 'f4', 'f5']);
  assert.deepEqual(ids(unplacedFor('Ma', 'terug', 'week', state({ deviations: ovDev }))), ['f4', 'f5']);
});
test('the mark only concerns the terug ride of that day in this week: heen and the standard rooster are unchanged', () => {
  const st = state({ deviations: ovDev });
  assert.deepEqual(ids(unplacedFor('Ma', 'heen', 'week', st)), ids(unplacedFor('Ma', 'heen', 'week', state())));
  assert.deepEqual(ids(unplacedFor('Ma', 'terug', 'standard', st)), ['f3', 'f4', 'f5']);
});

console.log('\n=== the temporary rooster of a period ===');
const P = { name: 'Herfstvakantie', firstDay: '2026-10-26', lastDay: '2026-10-30', opensOn: '2026-10-14', deadlineDate: '2026-10-16', deadlineTime: '12:00' };
const W44 = '2026-W44';   // Mon 26 Oct - Fri 30 Oct 2026, the week of the period
const entryOf = (id, days) => ({ familyId: id, periodFirstDay: '2026-10-26', days, submittedAt: 1, by: 'x' });
const shiftDoc = (iso, direction, cars) => ({ periodFirstDay: '2026-10-26', date: iso, direction, cars, madeAt: 1, by: 'x' });
// f2 hands in Tuesday terug 12:30 and is out on Thursday; f6 hands in Tuesday terug 12:30; f5 Tuesday terug 13:00.
const entries = () => ({
  '2026-10-26_f2': entryOf('f2', { '2026-10-27': { terug: '12:30', heen: '10:15' }, '2026-10-29': { out: true } }),
  '2026-10-26_f6': entryOf('f6', { '2026-10-27': { terug: '12:30', heen: '10:15' } }),
  '2026-10-26_f5': entryOf('f5', { '2026-10-27': { terug: '13:00', heen: '10:15' } }),
});
const XCARS = [{ driverFamilyId: 'f4', girlIds: ['f4'], departureTime: '17:30' }];
const pst = (patch = {}) => state({ currentWeekKey: W44, deviations: {}, periods: oneP(P), periodEntries: entries(), periodCars: { '2026-10-26_2026-10-27_terug': shiftDoc('2026-10-27', 'terug', XCARS) }, ...patch });

test('periodShift: only where the temporary rooster was made, inside the period, in the week of that date', () => {
  const ps = periodShift('Di', 'terug', pst());
  assert.deepEqual([ps.id, ps.iso], ['2026-10-26_2026-10-27_terug', '2026-10-27']); assert.equal(ps.doc.cars, XCARS);
  assert.equal(periodShift('Di', 'heen', pst()), null, 'no document for that shift: the standard rooster');
  assert.equal(periodShift('Wo', 'terug', pst()), null);
  assert.equal(periodShift('Di', 'terug', pst({ currentWeekKey: WEEK_KEY })), null, 'another week');
  assert.equal(periodShift('Di', 'terug', pst({ currentWeekKey: '2026-W45' })), null, 'the week after the period');
  assert.equal(periodShift('Di', 'terug', pst({ periods: {} })), null);
  assert.equal(periodShift('Di', 'terug', pst({ periodCars: undefined })), null);
  assert.equal(periodShift('Di', 'terug', pst({ periodCars: { '2026-10-26_2026-10-27_terug': { ...shiftDoc('2026-10-27', 'terug', XCARS), periodFirstDay: '2026-12-21' } } })), null, 'a document of another period');
  assert.equal(periodShift('Di', 'terug', pst({ periodCars: { '2026-10-26_2026-10-27_terug': { periodFirstDay: '2026-10-26' } } })), null, 'a broken document');
});
test('periodShift: a stored shift outside the period (the period was shortened or moved afterwards) never applies', () => {
  const stale = { '2026-10-26_2026-10-29_terug': shiftDoc('2026-10-29', 'terug', XCARS), '2026-10-26_2026-10-26_heen': shiftDoc('2026-10-26', 'heen', XCARS) };
  assert.equal(periodShift('Do', 'terug', pst({ periods: oneP({ ...P, lastDay: '2026-10-28' }), periodCars: stale })), null, 'after the last day');
  assert.equal(periodShift('Do', 'terug', pst({ periodCars: stale })).iso, '2026-10-29', 'inside the period it does apply');
  assert.equal(periodShift('Ma', 'heen', pst({ periods: oneP({ ...P, firstDay: '2026-10-27' }), periodCars: stale })), null, 'before the first day');
});
test('effectiveCars: a one-off change goes before the temporary rooster, which goes before the standard rooster', () => {
  assert.deepEqual(effectiveCars('Di', 'terug', pst()), XCARS);
  const standard = effectiveCars('Ma', 'heen', pst());
  assert.deepEqual(standard.map(c => c.driverFamilyId), ['f1'], 'no shift made for Ma heen: the standard rooster');
  assert.equal(standard[0].baseGroupId, 'Ma_heen_1');
  const dev = { Di_terug: { day: 'Di', direction: 'terug', weekKey: W44, expiresAt: 1, cars: [{ driverFamilyId: 'f3', girlIds: ['f5'], departureTime: '13:00' }] } };
  assert.deepEqual(effectiveCars('Di', 'terug', pst({ deviations: dev })).map(c => c.driverFamilyId), ['f3']);
});
test('effectiveCars returns copies: changing them never changes the stored temporary rooster', () => {
  const st = pst(); const cars = effectiveCars('Di', 'terug', st);
  cars[0].girlIds.push('zzz'); cars[0].departureTime = 'x';
  assert.deepEqual(st.periodCars['2026-10-26_2026-10-27_terug'].cars, XCARS);
});
test('outside the period nothing changes: the standard rooster and the standard times, also with a period and entries in the state', () => {
  const st = pst({ currentWeekKey: WEEK_KEY, deviations: sampleDeviations() });
  assert.deepEqual(effectiveCars('Ma', 'heen', st), effectiveCars('Ma', 'heen', state()));
  assert.equal(rideTime('f2', 'Di', 'terug', st), '17:30');
});
test('baseCars: what a one-off change is compared with', () => {
  assert.equal(baseCars('Di', 'terug', pst()), XCARS);
  assert.deepEqual(baseCars('Ma', 'heen', pst()).map(c => c.driverFamilyId), ['f1']);
  assert.deepEqual(baseCars('Ma', 'heen', state()), groupsFor('Ma', 'heen', state()).map(([, g]) => g));
});
test('periodTimeFor: the handed-in time, "" when not riding, the standard time when nothing was handed in', () => {
  const st = pst();
  assert.equal(periodTimeFor('f2', '2026-10-27', 'terug', st), '12:30'); assert.equal(periodTimeFor('f5', '2026-10-27', 'terug', st), '13:00');
  assert.equal(periodTimeFor('f2', '2026-10-29', 'heen', st), '', 'out that day');
  assert.equal(periodTimeFor('f2', '2026-10-26', 'heen', st), '08:30', 'handed in, but nothing for this date: standard');
  assert.equal(periodTimeFor('f1', '2026-10-27', 'terug', st), '17:30', 'no entry at all: standard');
  assert.equal(periodTimeFor('f1', '2026-10-28', 'heen', st), '', 'no standard time either');
  assert.equal(periodTimeFor('f2', '2026-10-27', 'terug', pst({ periods: {} })), '17:30');
});
test('a handed-in direction that is left out means she does not ride that way', () => {
  const st = pst({ periodEntries: { '2026-10-26_f2': entryOf('f2', { '2026-10-27': { heen: '10:15' } }) } });
  assert.equal(periodTimeFor('f2', '2026-10-27', 'heen', st), '10:15'); assert.equal(periodTimeFor('f2', '2026-10-27', 'terug', st), '');
});
test('rideTime: handed-in times count only on a shift with a temporary rooster', () => {
  const st = pst();
  assert.equal(rideTime('f2', 'Di', 'terug', st), '12:30');
  assert.equal(rideTime('f2', 'Di', 'heen', st), '10:15', 'nothing made for Di heen: the standard time (same here by coincidence)');
  assert.equal(rideTime('f5', 'Ma', 'heen', st), famTime('f5', 'Ma', 'heen', st));
  assert.equal(rideTime('f2', 'Do', 'heen', st), '10:15', 'she is out on Thursday, but no shift is made: the standard time still counts');
  const made = pst({ periodCars: { ...pst().periodCars, '2026-10-26_2026-10-29_heen': shiftDoc('2026-10-29', 'heen', []) } });
  assert.equal(rideTime('f2', 'Do', 'heen', made), '', 'with the shift made she does not ride');
});
test('girlsForRide: who needs a ride; the same as girlsFor when no temporary rooster applies; Flex never', () => {
  assert.deepEqual(ids(girlsForRide('Ma', 'heen', pst())), ids(girlsFor('Ma', 'heen', pst())));
  assert.deepEqual(ids(girlsForRide('Ma', 'heen', state())), ids(girlsFor('Ma', 'heen', state())));
  const made = pst({ periodCars: { '2026-10-26_2026-10-29_terug': shiftDoc('2026-10-29', 'terug', []) } });
  assert.equal(ids(girlsForRide('Do', 'terug', made)).includes('f2'), false); assert.equal(ids(girlsFor('Do', 'terug', made)).includes('f2'), true);
  const flex = sampleFamilies(); flex.f1 = { ...flex.f1, familyType: 'flex' };
  assert.equal(ids(girlsForRide('Ma', 'heen', pst({ families: flex }))).includes('f1'), false);
});
test('computeRideDeparture: heen leaves early for the earliest, terug waits for the last, with the handed-in times', () => {
  const st = pst();
  assert.equal(computeRideDeparture('Di', 'terug', ['f2', 'f6', 'f5'], st), '13:00');
  assert.equal(computeRideDeparture('Di', 'terug', ['f2', 'f1'], st), '17:30');
  assert.equal(computeDepartureTime('Di', 'terug', ['f2', 'f6', 'f5'], st), '17:30', 'the standard function still uses the standard times');
  assert.equal(computeRideDeparture('Ma', 'heen', ['f1', 'f2'], pst()), computeDepartureTime('Ma', 'heen', ['f1', 'f2'], pst()));
});
test('unplacedFor "week": uses the riders of the temporary rooster; "standard" is untouched', () => {
  const st = pst({ periodCars: { ...pst().periodCars, '2026-10-26_2026-10-29_terug': shiftDoc('2026-10-29', 'terug', []) } });
  assert.deepEqual(ids(unplacedFor('Do', 'terug', 'week', st)).includes('f2'), false);       // out that day
  assert.deepEqual(ids(unplacedFor('Do', 'terug', 'standard', st)).includes('f2'), true);
  assert.deepEqual(ids(unplacedFor('Di', 'terug', 'week', st)), ['f1', 'f2', 'f5', 'f6']);   // XCARS has only f4
});
test('shiftFamilies: the planning sees the handed-in time for that shift only; nothing else changes and the input is not touched', () => {
  const st = pst(), before = JSON.stringify(st.families);
  const fs = shiftFamilies('Di', 'terug', st);
  assert.equal(fs.f2.schedule.Di.terug, '12:30'); assert.equal(fs.f2.schedule.Di.heen, '10:15'); assert.equal(fs.f2.schedule.Ma.terug, '17:30');
  assert.equal(fs.f1.schedule.Di.terug, '17:30'); assert.equal(JSON.stringify(st.families), before);
  assert.equal(shiftFamilies('Ma', 'heen', st), st.families, 'no temporary rooster for this shift: the families themselves');
});
test('the temporary rooster by date: riders, cars, unplaced, departure', () => {
  const st = pst();
  assert.deepEqual(ids(periodRidersFor('2026-10-27', 'terug', st)), ['f1', 'f2', 'f4', 'f5', 'f6']);
  assert.equal(ids(periodRidersFor('2026-10-29', 'heen', st)).includes('f2'), false, 'out that day');
  assert.equal(periodCarsFor('2026-10-27', 'terug', st), XCARS); assert.equal(periodCarsFor('2026-10-27', 'heen', st), null);
  assert.deepEqual(ids(periodUnplacedFor('2026-10-27', 'terug', st)), ['f1', 'f2', 'f5', 'f6']);
  assert.deepEqual(periodUnplacedFor('2026-10-27', 'heen', st), [], 'a shift that is not made has nobody unplaced');
  assert.equal(periodDeparture('2026-10-27', 'terug', ['f2', 'f5'], st), '13:00'); assert.equal(periodDeparture('2026-10-27', 'heen', ['f1', 'f2'], st), '09:15');
});
test('periodEligibleDrivers: the standard availability of that weekday', () => {
  assert.deepEqual(ids(periodEligibleDrivers('2026-10-27', 'terug', 1, pst())).sort(), ['f2', 'f4']);
  assert.deepEqual(periodEligibleDrivers('2026-10-31', 'terug', 1, pst()), []);
});
test('planPeriodShift: auto planning with the handed-in times (clusters by time, drivers by priority)', () => {
  const r = planPeriodShift('2026-10-27', 'terug', pst());
  assert.deepEqual(r.cars, [{ driverFamilyId: 'f2', girlIds: ['f2', 'f6', 'f5'], departureTime: '13:00' }, { driverFamilyId: 'f4', girlIds: ['f1', 'f4'], departureTime: '17:30' }]);
  assert.deepEqual(r.unplaced, []);
});
test('planPeriodShift: a rider nobody can drive is handed back as unplaced, the rest is planned', () => {
  const fams = sampleFamilies(); fams.f4 = { ...fams.f4, availability: { ...fams.f4.availability, Di: { heen: false, terug: false } } };
  const r = planPeriodShift('2026-10-27', 'terug', pst({ families: fams }));
  assert.equal(r.cars.length, 1); assert.equal(r.cars[0].driverFamilyId, 'f2');
  assert.equal(r.cars[0].girlIds.length, 4, 'f2 has 4 passenger seats: the car is filled up');
  assert.equal(r.unplaced.length, 1);
  assert.equal(r.cars[0].departureTime, periodDeparture('2026-10-27', 'terug', r.cars[0].girlIds, pst({ families: fams })));
  assert.deepEqual([...r.cars.flatMap(c => c.girlIds), ...r.unplaced].sort(), ['f1', 'f2', 'f4', 'f5', 'f6']);
});
test('planPeriodShift: a weekend date, or no families: nothing to plan', () => {
  assert.deepEqual(planPeriodShift('2026-10-31', 'heen', pst()), { cars: [], unplaced: [] });
  assert.deepEqual(planPeriodShift('2026-10-27', 'heen', pst({ families: {} })), { cars: [], unplaced: [] });
});
test('planPeriodShift never plans Flex families and never seats a rider twice', () => {
  const fams = sampleFamilies(); fams.f5 = { ...fams.f5, familyType: 'flex' };
  const r = planPeriodShift('2026-10-27', 'terug', pst({ families: fams }));
  const all = [...r.cars.flatMap(c => c.girlIds), ...r.unplaced];
  assert.equal(all.includes('f5'), false); assert.equal(new Set(all).size, all.length);
});
test('planPeriodRooster: every shift of the period, heen and terug, ten in a two-week period', () => {
  const plan = planPeriodRooster(pst(), P);
  assert.equal(plan.length, 10); assert.deepEqual(plan.slice(0, 3).map(s => [s.iso, s.direction]), [['2026-10-26', 'heen'], ['2026-10-26', 'terug'], ['2026-10-27', 'heen']]);
  assert.equal(planPeriodRooster(pst(), { ...P, lastDay: '2026-11-06' }).length, 20);
  assert.deepEqual(planPeriodRooster(pst(), null), []);
});
test('a Thursday when nobody rides plans no cars and nobody unplaced, and an out girl is not planned', () => {
  const all = Object.fromEntries(Object.keys(sampleFamilies()).map(id => ['2026-10-26_' + id, entryOf(id, { '2026-10-29': { out: true } })]));
  const r = planPeriodShift('2026-10-29', 'terug', pst({ periodEntries: all }));
  assert.deepEqual(r, { cars: [], unplaced: [] });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
