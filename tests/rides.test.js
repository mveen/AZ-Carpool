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
import { sampleFamilies, sampleGroups, sampleDeviations, WEEK_KEY, resetState } from './test-support.js';
import { S } from '../state.js';
import {
  fam, seats, girlName, plainGirlName, plainDriverName, famTime, isAvailable, activeDeviation, effectiveCars,
  girlsFor, groupsFor, alreadyGrouped, eligibleDrivers, availableDrivers, sortByShiftPriority, computeDepartureTime,
  planOptions, unplacedFor, carsCountFor, tripReserveIds, timeToMinutes,
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
