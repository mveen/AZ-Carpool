// Run with: node planning-scenarios.test.js
// The real roster of 7 October 2026 (families export from Beheer, trimmed to what the planning needs: no names, no phone numbers),
// planned shift by shift. Each case is a planning that was wrong in the app before and is now pinned down by the rules the
// coordinator gave. The shifts are planned through planOptions() (rides.js), so the wiring is tested too, not only planning.js.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import './test-support.js';
import { availableDrivers, eligibleDrivers, planOptions, sortByShiftPriority, girlsFor, girlsForRide, tripReserveIds } from '../rides.js';
import { checkPlan, timeToMinutes } from '../planning.js';

// id;type;total car capacity;  then for Ma..Vr: heen;terug;rijden heen;rijden terug
const CSV = `
manual-gezin-esme;flex;5;;;;;;;;;;;;;;;;;;;;beschikbaar
eline;vast;5;08:30;17:00;beschikbaar;beschikbaar;08:15;14:45;back-up;;08:30;15:30;beschikbaar;back-up;10:15;18:00;back-up;back-up;08:30;15:30;back-up;back-up
anouk;vast;5;10:15;17:00;back-up;back-up;08:15;13:45;;;08:30;13:00;beschikbaar;;08:30;18:00;;;08:30;16:45;beschikbaar;back-up
evi;vast;5;10:15;18:00;back-up;back-up;08:30;17:00;back-up;;08:30;15:30;;;10:15;17:30;back-up;beschikbaar;08:00;15:30;back-up;beschikbaar
jahaimy;vast;5;08:30;16:45;back-up;back-up;09:15;17:30;;back-up;08:30;14:45;back-up;beschikbaar;08:30;17:30;beschikbaar;back-up;09:15;16:45;back-up;back-up
jet;vast;7;11:00;17:00;beschikbaar;back-up;08:15;14:45;beschikbaar;beschikbaar;13:00;15:30;back-up;back-up;11:00;18:00;back-up;;08:30;13:00;;back-up
lois;vast;5;10:15;17:00;back-up;beschikbaar;08:15;14:45;;;10:15;13:00;back-up;beschikbaar;08:30;18:00;;beschikbaar;08:30;13:00;back-up;back-up
robbin;vast;5;;17:00;;;08:15;;beschikbaar;;;;;;;18:00;;;08:30;;;
saar;vast;5;11:00;17:00;;;08:15;14:45;back-up;beschikbaar;13:00;15:30;;;11:00;18:00;;back-up;08:30;13:00;beschikbaar;beschikbaar
`.trim().split('\n').map(l => l.split(';'));
const DAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr'];
function buildFamilies() {
  const out = {};
  for (const r of CSV) {
    const [id, type, cap, ...c] = r;
    const schedule = {}, availability = {};
    DAYS.forEach((d, i) => {
      const [heen, terug, rh, rt] = c.slice(i * 4, i * 4 + 4);
      schedule[d] = { heen: heen || '', terug: terug || '' };
      availability[d] = { heen: rh === 'beschikbaar', terug: rt === 'beschikbaar', backupHeen: rh === 'back-up', backupTerug: rt === 'back-up' };
    });
    out[id] = { parentName: 'Ouder van ' + id, girlName: id, capacity: +cap, familyType: type, schedule, availability };
  }
  return out;
}
// The Selectievolgorde per shift as it stood in Beheer (families that are not listed come last).
const ORDER = {
  Ma_terug: ['lois', 'eline', 'anouk', 'evi', 'jahaimy', 'jet'],
  Di_heen: ['robbin', 'jet', 'saar', 'eline', 'evi'],
  Wo_heen: ['eline', 'anouk', 'jet', 'jahaimy', 'lois'],
  Wo_terug: ['lois', 'jahaimy', 'eline', 'jet'],
  Do_heen: ['jahaimy', 'evi', 'jet', 'eline'],
  Do_terug: ['evi', 'lois', 'jahaimy', 'saar', 'eline'],
  Vr_heen: ['saar', 'anouk', 'evi', 'lois', 'jahaimy', 'eline'],
  Vr_terug: ['saar', 'evi', 'anouk', 'lois', 'jahaimy', 'jet', 'eline'],
};
const RULES = [
  { type: 'together', ids: ['eline', 'saar'] }, { type: 'together', ids: ['anouk', 'jahaimy'] },
  { type: 'prefer', girlId: 'evi', withAny: ['eline', 'saar'] },
];
function state(patch = {}) {
  const shiftPriority = Object.fromEntries(Object.entries(ORDER).map(([k, ids]) => [k, Object.fromEntries(ids.map((id, i) => [id, i + 1]))]));
  return { families: buildFamilies(), groups: {}, deviations: {}, currentWeekKey: '2026-W40', shiftPriority, settings: { gapThresholdHours: 3, travelLeadMinutes: 60, prefWindowMinutes: 30, parentPrefWindowMinutes: 60 }, prefs: { rules: RULES }, ...patch };
}
// The recommended proposal of a shift, planned for everybody who rides: { driverId: [girls A-Z] }.
function plan(day, direction, st = state()) {
  const opts = planOptions(day, direction, girlsFor(day, direction, st), st);
  assert.ok(opts.length && opts[0].primary, day + ' ' + direction + ': there is a recommended option');
  return { opt: opts[0], cars: Object.fromEntries(opts[0].assignment.map(a => [a.driverId, [...a.girlIds].sort()])) };
}
const standardDrivers = (day, direction, st) => availableDrivers(day, direction, st).filter(([, f]) => f.availability[day][direction]).map(([id]) => id);
const checkInput = (day, direction, st) => ({
  riders: girlsFor(day, direction, st).map(([id, f]) => ({ id, min: timeToMinutes(f.schedule[day][direction]) })),
  drivers: availableDrivers(day, direction, st).map(([id, f]) => ({ id, seats: f.capacity - 1, standard: !!f.availability[day][direction] })),
});
const together = (cars, a, b) => Object.values(cars).some(g => g.includes(a) && g.includes(b));

console.log('=== Ma-middag: Jet\'s parent is back-up and must not drive ===');
test('Monday afternoon: Loïs and Merel/Michiel (standard) drive; Eline, Saar, Evi and the other rules are honoured', () => {
  const { cars } = plan('Ma', 'terug');
  assert.deepEqual(Object.keys(cars).sort(), ['eline', 'lois']);
  assert.deepEqual(cars.lois, ['anouk', 'jahaimy', 'jet', 'lois']); assert.deepEqual(cars.eline, ['eline', 'evi', 'robbin', 'saar']);
  assert.ok(together(cars, 'eline', 'saar') && together(cars, 'anouk', 'jahaimy') && together(cars, 'evi', 'eline'));
});

console.log('\n=== Di-ochtend: Robbin rides with her own parent (inside the 60 minutes) ===');
test('Tuesday morning: both drivers have their own daughter in the car and nobody waits more than 60 minutes', () => {
  const st = state(), { cars } = plan('Di', 'heen', st);
  assert.deepEqual(cars.robbin, ['anouk', 'jahaimy', 'lois', 'robbin']); assert.deepEqual(cars.jet, ['eline', 'evi', 'jet', 'saar']);
  Object.values(cars).forEach(g => { const t = g.map(id => timeToMinutes(st.families[id].schedule.Di.heen)); assert.ok(Math.max(...t) - Math.min(...t) <= 60); });
});

console.log('\n=== Wo-ochtend and Wo-middag ===');
test('Wednesday morning: the two standard drivers drive (not Jet\'s 6 seats); the time limit of 3 hours holds', () => {
  const st = state(), { cars } = plan('Wo', 'heen', st);
  assert.deepEqual(Object.keys(cars).sort(), ['anouk', 'eline']);
  assert.deepEqual(cars.eline, ['anouk', 'eline', 'evi', 'jahaimy']); assert.deepEqual(cars.anouk, ['jet', 'lois', 'saar']);
  Object.values(cars).forEach(g => { const t = g.map(id => timeToMinutes(st.families[id].schedule.Wo.heen)); assert.ok(Math.max(...t) - Math.min(...t) <= 180); });
});
test('Wednesday afternoon: Loïs with her own parent; Jahaimy is NOT moved to hers because that would make Anouk and Loïs wait 45 minutes longer', () => {
  const { cars } = plan('Wo', 'terug');
  assert.deepEqual(cars.lois, ['anouk', 'jahaimy', 'lois']); assert.deepEqual(cars.jahaimy, ['eline', 'evi', 'jet', 'saar']);
});

console.log('\n=== Do-ochtend and Do-middag ===');
test('Thursday morning: Jahaimy and Evi drive their own daughters (a back-up is needed: one standard driver only)', () => {
  const st = state(), { cars, opt } = plan('Do', 'heen', st);
  assert.deepEqual(cars.jahaimy, ['anouk', 'jahaimy', 'lois']); assert.deepEqual(cars.evi, ['eline', 'evi', 'jet', 'saar']);
  assert.deepEqual(standardDrivers('Do', 'heen', st), ['jahaimy'], 'only Jahaimy\'s parent is standard that morning');
  assert.equal(opt.assignment.length, 2);
});
test('Thursday afternoon: Eline, Saar and Evi ride together; Anouk and Jahaimy together; every driver has her own daughter', () => {
  const { cars } = plan('Do', 'terug');
  assert.deepEqual(cars.evi, ['eline', 'evi', 'jet', 'saar']); assert.deepEqual(cars.lois, ['anouk', 'jahaimy', 'lois', 'robbin']);
});

console.log('\n=== Vr-ochtend and Vr-middag ===');
test('Friday morning: Saar with Evi, Eline, Jet; Anouk with Robbin, Jahaimy, Loïs (every rule and every own parent)', () => {
  const { cars } = plan('Vr', 'heen');
  assert.deepEqual(cars.saar, ['eline', 'evi', 'jet', 'saar']); assert.deepEqual(cars.anouk, ['anouk', 'jahaimy', 'lois', 'robbin']);
});
test('Friday afternoon: the two drivers each drive their own daughter (default for a shift)', () => {
  const { cars } = plan('Vr', 'terug');
  assert.deepEqual(cars.saar, ['jet', 'lois', 'saar']); assert.deepEqual(cars.evi, ['anouk', 'eline', 'evi', 'jahaimy']);
});
test('Friday afternoon: Esmé (Flex, available) is in the list of drivers and in the Selectievolgorde of that shift; she is never a passenger', () => {
  const st = state();
  const list = sortByShiftPriority('Vr', 'terug', availableDrivers('Vr', 'terug', st), st).map(([id]) => id);
  assert.ok(list.includes('manual-gezin-esme'), 'Esmé is in the list');
  assert.equal(list[list.length - 1], 'manual-gezin-esme', 'unranked drivers come last');
  assert.ok(!girlsFor('Vr', 'terug', st).map(([id]) => id).includes('manual-gezin-esme'));
  assert.ok(!girlsForRide('Vr', 'terug', st).map(([id]) => id).includes('manual-gezin-esme'));
  assert.ok(eligibleDrivers('Vr', 'terug', 3, st).map(([id]) => id).includes('manual-gezin-esme'));
});
test('a Flex driver can be used: ranked first, Esmé drives on Friday afternoon', () => {
  const st = state(); st.shiftPriority.Vr_terug = { 'manual-gezin-esme': 1, saar: 2, evi: 3 };
  const { cars } = plan('Vr', 'terug', st);
  assert.ok('manual-gezin-esme' in cars, 'Esmé drives'); assert.ok(!Object.values(cars).flat().includes('manual-gezin-esme'));
});
test('Esmé is only a reserve where she is available: not on Monday', () => {
  const st = state();
  assert.ok(!availableDrivers('Ma', 'terug', st).map(([id]) => id).includes('manual-gezin-esme'));
});

console.log('\n=== Every shift of the roster: safety net and rules ===');
for (const key of Object.keys(ORDER)) {
  const [day, direction] = key.split('_');
  test(key + ': a complete planning that passes checkPlan, with only standard drivers unless they cannot cover the shift', () => {
    const st = state(), { opt } = plan(day, direction, st);
    const input = checkInput(day, direction, st);
    const planOut = { cars: opt.assignment.map(a => ({ driverId: a.driverId, girlIds: a.girlIds })), unplaced: [] };
    assert.deepEqual(checkPlan({ ...input, gapLimitMinutes: 180 }, planOut), []);
    const std = new Set(standardDrivers(day, direction, st));
    const backups = opt.assignment.filter(a => !std.has(a.driverId)).length;
    if (key !== 'Do_heen') assert.equal(backups, 0, 'no back-up driver needed on ' + key); else assert.equal(backups, 1);
  });
}
test('the reserves of a shift never include a driver who drives it', () => {
  const st = state(), { opt } = plan('Ma', 'terug', st);
  const cars = opt.assignment.map(a => ({ driverFamilyId: a.driverId, girlIds: a.girlIds }));
  const reserves = tripReserveIds('Ma', 'terug', cars, st);
  assert.ok(reserves.every(id => !cars.some(c => c.driverFamilyId === id)));
});
test('Beheer settings really are used: with the own-parent window at 0 Tuesday morning is the time-best split (Robbin not with her own parent)', () => {
  const st = state(); st.settings.parentPrefWindowMinutes = 0;
  const { cars } = plan('Di', 'heen', st);
  assert.ok(!cars.robbin.includes('robbin'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
