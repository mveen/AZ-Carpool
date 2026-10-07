// Run with: node planning.test.js
// The planning engine for one shift (planShift), the safety check (checkPlan) and the helpers around them.
// The rules these tests pin down are written out in README.md ("Planningslogica"). Real roster cases: planning-scenarios.test.js.
import assert from 'node:assert/strict';
import {
  timeToMinutes, minutesToTime, computeDepartureTime,
  planShift, checkPlan, planAlternativeAssignments
} from '../planning.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const riders = pairs => pairs.map(([id, t]) => ({ id, min: timeToMinutes(t) }));
const std = (id, seats, rank) => ({ id, seats, standard: true, rank });
const bak = (id, seats, rank) => ({ id, seats, standard: false, rank });
const sorted = a => [...a].sort();
const byDriver = plan => Object.fromEntries(plan.cars.map(c => [c.driverId, sorted(c.girlIds)]));
const drivers = plan => plan.cars.map(c => c.driverId);

console.log('=== timeToMinutes / minutesToTime / computeDepartureTime ===');
test('timeToMinutes basic', () => { assert.equal(timeToMinutes('08:30'), 510); });
test('minutesToTime basic', () => { assert.equal(minutesToTime(510), '08:30'); });
test('minutesToTime wraps negative', () => { assert.equal(minutesToTime(-30), '23:30'); });
test('computeDepartureTime heen uses earliest minus lead', () => {
  assert.equal(computeDepartureTime('heen', [timeToMinutes('08:30'), timeToMinutes('10:15')], 60), '07:30');
});
test('computeDepartureTime terug uses latest, no lead', () => {
  assert.equal(computeDepartureTime('terug', [timeToMinutes('17:00'), timeToMinutes('18:00')], 60), '18:00');
});

console.log('\n=== Cars: fewest cars, split by time, hard limits ===');
test('Monday morning: 2 standard drivers (4 and 6 seats): 2 cars, a 2/5 split by time', () => {
  const plan = planShift({
    direction: 'heen', gapLimitMinutes: 180,
    riders: riders([['eline', '08:30'], ['jahaimy', '08:30'], ['anouk', '10:15'], ['evi', '10:15'], ['lois', '10:15'], ['jet', '11:00'], ['saar', '11:00']]),
    drivers: [std('eline', 4, 1), std('jet', 6, 2)],
  });
  assert.deepEqual(byDriver(plan), { eline: ['eline', 'jahaimy'], jet: ['anouk', 'evi', 'jet', 'lois', 'saar'] });
  assert.deepEqual(checkPlan({ riders: riders([['eline', '08:30'], ['jahaimy', '08:30'], ['anouk', '10:15'], ['evi', '10:15'], ['lois', '10:15'], ['jet', '11:00'], ['saar', '11:00']]), drivers: [std('eline', 4, 1), std('jet', 6, 2)] }, plan), []);
});
test('Monday morning with extra drivers that are only back-up: the split and the drivers stay the same', () => {
  const plan = planShift({
    direction: 'heen',
    riders: riders([['eline', '08:30'], ['jahaimy', '08:30'], ['anouk', '10:15'], ['evi', '10:15'], ['lois', '10:15'], ['jet', '11:00'], ['saar', '11:00']]),
    drivers: [std('eline', 4, 1), std('jet', 6, 2), bak('x1', 3, 3), bak('x2', 2, 4), bak('x3', 5, 5)],
  });
  assert.deepEqual(sorted(drivers(plan)), ['eline', 'jet']); assert.equal(plan.backupsUsed, 0);
});
test('Monday afternoon: 8 girls in two time groups of 4 are two cars of 4, driven by the first two of the Selectievolgorde', () => {
  const plan = planShift({
    direction: 'terug',
    riders: riders([['lois', '17:00'], ['jahaimy', '17:00'], ['jet', '17:00'], ['robbin', '17:00'], ['eline', '18:00'], ['saar', '18:00'], ['evi', '18:00'], ['anouk', '18:00']]),
    drivers: [std('lois', 4, 1), std('eline', 4, 2), std('anouk', 4, 3), std('jet', 4, 4), std('evi', 4, 5)],
  });
  assert.deepEqual(byDriver(plan), { lois: ['jahaimy', 'jet', 'lois', 'robbin'], eline: ['anouk', 'eline', 'evi', 'saar'] });
});
test('three separate time groups and only 2-seat cars: 3 cars (never capped at 2)', () => {
  const plan = planShift({
    direction: 'heen', riders: riders([['a1', '08:00'], ['a2', '08:00'], ['b1', '10:00'], ['b2', '10:00'], ['c1', '12:00'], ['c2', '12:00']]),
    drivers: [1, 2, 3, 4, 5, 6].map(i => std('d' + i, 2, i)),
  });
  assert.equal(plan.cars.length, 3);
  assert.deepEqual(plan.cars.map(c => sorted(c.girlIds)), [['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2']]);
});
test('capacity forces a split even when the times are close', () => {
  const plan = planShift({
    direction: 'heen',
    riders: riders([['evi', '08:30'], ['jahaimy', '09:15'], ['anouk', '08:15'], ['eline', '08:15'], ['jet', '08:15'], ['saar', '08:15'], ['lois', '08:15'], ['robbin', '08:15']]),
    drivers: [std('robbin', 4, 1), std('jet', 6, 2)], parentPrefWindowMinutes: 0, // the pure time-best split; the own-parent wish has its own test
  });
  assert.deepEqual(plan.cars.map(c => c.girlIds.length).sort(), [2, 6]);
});
test('everyone fits in one car within the time limit: one car', () => {
  const plan = planShift({ direction: 'heen', riders: riders([['a', '08:00'], ['b', '08:30'], ['c', '09:00']]), drivers: [std('d1', 4, 1), std('d2', 4, 2)] });
  assert.equal(plan.cars.length, 1);
});
test('HARD: the time spread inside a car never exceeds the limit, even when the seats would allow it', () => {
  const plan = planShift({ direction: 'heen', gapLimitMinutes: 180, riders: riders([['a', '08:00'], ['b', '11:01']]), drivers: [std('d1', 4, 1), std('d2', 4, 2)] });
  assert.equal(plan.cars.length, 2);
  const exactly = planShift({ direction: 'heen', gapLimitMinutes: 180, riders: riders([['a', '08:00'], ['b', '11:00']]), drivers: [std('d1', 4, 1), std('d2', 4, 2)] });
  assert.equal(exactly.cars.length, 1, 'exactly 3 hours is still allowed');
});
test('big cars are not tied to big groups: seats only decide whether it fits, the own parent decides who drives which car', () => {
  // groups: [x1, x2] and [y1, y2, y3]. d_x has 6 seats and is x1's parent; d_y has 3 seats and is y1's parent.
  const plan = planShift({
    direction: 'heen', riders: riders([['x1', '08:00'], ['x2', '08:00'], ['y1', '12:00'], ['y2', '12:00'], ['y3', '12:00']]),
    drivers: [std('x1', 6, 1), std('y1', 3, 2)],
  });
  assert.deepEqual(byDriver(plan), { x1: ['x1', 'x2'], y1: ['y1', 'y2', 'y3'] });
});

console.log('\n=== Back-up drivers: only when the standard drivers cannot do it ===');
test('a big back-up car is NOT used while the standard drivers can seat everybody (Ma-middag, Wo-middag)', () => {
  const plan = planShift({
    direction: 'terug', riders: riders([['a', '17:00'], ['b', '17:00'], ['c', '17:00'], ['d', '17:00'], ['e', '18:00'], ['f', '18:00']]),
    drivers: [std('s1', 4, 2), std('s2', 4, 3), bak('big', 6, 1)],
  });
  assert.equal(plan.backupsUsed, 0); assert.ok(!drivers(plan).includes('big'));
});
test('too few standard seats: the fewest possible back-ups are added, best rank first', () => {
  const plan = planShift({
    direction: 'heen', riders: riders([['a', '08:00'], ['b', '08:00'], ['c', '08:00'], ['d', '08:00'], ['e', '08:00'], ['f', '08:00'], ['g', '08:00']]),
    drivers: [std('s1', 4, 1), bak('b1', 4, 2), bak('b2', 4, 3), bak('b3', 6, 4)],
  });
  assert.equal(plan.backupsUsed, 1); assert.deepEqual(sorted(drivers(plan)), ['b1', 's1']);
});
test('the time limit counts as "does not fit": a back-up is used when the standard drivers would break it', () => {
  const plan = planShift({
    direction: 'heen', gapLimitMinutes: 180, riders: riders([['a', '08:00'], ['b', '08:00'], ['c', '13:00']]),
    drivers: [std('s1', 4, 1), bak('b1', 4, 2)],
  });
  assert.equal(plan.backupsUsed, 1); assert.equal(plan.cars.length, 2);
});
test('when a back-up is needed anyway, fewest cars still wins: a big back-up car may drive alone, and among equal choices the best rank', () => {
  const plan = planShift({
    direction: 'heen', riders: riders([['a', '08:00'], ['b', '08:00'], ['c', '08:00'], ['d', '08:00'], ['e', '08:00']]),
    drivers: [std('s1', 3, 1), bak('b1', 6, 2), bak('b2', 3, 3)],
  });
  assert.equal(plan.backupsUsed, 1); assert.deepEqual(drivers(plan), ['b1']);
  const two = planShift({
    direction: 'heen', riders: riders([['a', '08:00'], ['b', '08:00'], ['c', '08:00'], ['d', '08:00'], ['e', '08:00']]),
    drivers: [std('s1', 3, 1), bak('b1', 3, 2), bak('b2', 3, 3)],
  });
  assert.equal(two.backupsUsed, 1); assert.deepEqual(sorted(drivers(two)), ['b1', 's1']);
});

console.log('\n=== Who drives: fewest cars, then the best Selectievolgorde ===');
test('the top-ranked standard drivers drive; lower-ranked drivers who would also fit are not used', () => {
  const plan = planShift({
    direction: 'terug', riders: riders([['a', '17:00'], ['b', '17:00'], ['c', '17:00'], ['d', '17:00'], ['e', '17:00'], ['f', '17:00']]),
    drivers: [std('r3', 4, 3), std('r1', 4, 1), std('r2', 4, 2), std('r4', 4, 4)],
  });
  assert.deepEqual(sorted(drivers(plan)), ['r1', 'r2']);
});
test('a higher-ranked driver without enough seats is skipped when the seats are really needed (Jet with 6 seats)', () => {
  const plan = planShift({
    direction: 'heen', riders: riders([['a', '08:15'], ['b', '08:15'], ['c', '08:15'], ['d', '08:15'], ['e', '08:15'], ['f', '08:15'], ['g', '08:30'], ['h', '09:15']]),
    drivers: [std('r1', 4, 1), std('big', 6, 2), std('r3', 4, 3)],
  });
  assert.deepEqual(sorted(drivers(plan)), ['big', 'r1']);
});
test('equal rank sums: the Selectievolgorde order matches the departure order (rank 1 takes the car that leaves first)', () => {
  const plan = planShift({
    direction: 'terug', riders: riders([['a', '13:00'], ['b', '13:00'], ['c', '13:00'], ['d', '13:00'], ['e', '16:00'], ['f', '16:00'], ['g', '16:00'], ['h', '16:00']]),
    drivers: [std('r1', 4, 1), std('r2', 4, 2)],
  });
  assert.equal(plan.cars[0].driverId, 'r1'); assert.equal(plan.cars[1].driverId, 'r2');
});
test('a Flex driver is just a driver: available, ranked and used like any other', () => {
  const plan = planShift({ direction: 'terug', riders: riders([['a', '13:00'], ['b', '13:00']]), drivers: [std('flexy', 4, 1), std('other', 4, 2)] });
  assert.deepEqual(drivers(plan), ['flexy']);
});

console.log('\n=== Wishes: samen reizen, eigen ouder, voorkeur ===');
test('riders with the same time can swap cars, so the rules can be honoured for free (Vr-ochtend)', () => {
  // times as in the real roster; saar, anouk 08:30 are interchangeable between the two cars
  const plan = planShift({
    direction: 'heen',
    riders: riders([['evi', '08:00'], ['eline', '08:00'], ['anouk', '08:30'], ['saar', '08:30'], ['jet', '08:30'], ['jahaimy', '09:15'], ['lois', '08:30'], ['robbin', '08:30']]),
    drivers: [std('saar', 4, 1), std('anouk', 4, 2)],
    togetherRules: [{ ids: ['eline', 'saar'] }, { ids: ['anouk', 'jahaimy'] }], preferRules: [{ girlId: 'evi', withAny: ['eline', 'saar'] }],
  });
  const m = byDriver(plan);
  assert.ok(m.saar.includes('saar') && m.saar.includes('eline') && m.saar.includes('evi'), 'Saar, Eline and Evi together in Saar\'s car');
  assert.ok(m.anouk.includes('anouk') && m.anouk.includes('jahaimy'), 'Anouk and Jahaimy together in Anouk\'s car');
});
test('two drivers whose daughters sit in each other\'s cars simply swap cars (Do-ochtend, Vr-middag)', () => {
  const plan = planShift({
    direction: 'terug', riders: riders([['a', '17:00'], ['b', '17:00'], ['c', '18:00'], ['d', '18:00']]),
    drivers: [std('c', 2, 1), std('a', 2, 2)],
  });
  assert.deepEqual(byDriver(plan), { a: ['a', 'b'], c: ['c', 'd'] });
});
test('a "samen reizen" rule is NOT forced when it costs too much waiting (Monday morning)', () => {
  const plan = planShift({
    direction: 'heen', riders: riders([['eline', '08:30'], ['jahaimy', '08:30'], ['anouk', '10:15'], ['evi', '10:15'], ['lois', '10:15'], ['jet', '11:00'], ['saar', '11:00']]),
    drivers: [std('eline', 4, 1), std('jet', 6, 2)], togetherRules: [{ ids: ['anouk', 'jahaimy'] }], prefWindowMinutes: 30,
  });
  assert.deepEqual(byDriver(plan).eline, ['eline', 'jahaimy']);
});
test('all three real Reisvoorkeuren together still give the cheap split', () => {
  const plan = planShift({
    direction: 'heen', riders: riders([['eline', '08:30'], ['jahaimy', '08:30'], ['anouk', '10:15'], ['evi', '10:15'], ['lois', '10:15'], ['jet', '11:00'], ['saar', '11:00']]),
    drivers: [std('eline', 4, 1), std('jet', 6, 2)],
    togetherRules: [{ ids: ['saar', 'eline'] }, { ids: ['anouk', 'jahaimy'] }], preferRules: [{ girlId: 'evi', withAny: ['saar', 'eline'] }], prefWindowMinutes: 30,
  });
  assert.deepEqual(byDriver(plan).eline, ['eline', 'jahaimy']);
});
test('the window of a wish is a limit per girl: a "samen reizen" rule that makes one girl wait longer than the window is not honoured, inside it is', () => {
  // a 00:00 b 00:10 | c 00:50 d 01:00 e 01:10. b+c together puts c in the first car: c then arrives 50 minutes early.
  const input = { direction: 'heen', riders: riders([['a', '00:00'], ['b', '00:10'], ['c', '00:50'], ['d', '01:00'], ['e', '01:10']]), drivers: [std('d1', 3, 1), std('d2', 3, 2)], togetherRules: [{ ids: ['b', 'c'] }] };
  const together = p => p.cars.some(c => c.girlIds.includes('b') && c.girlIds.includes('c'));
  assert.equal(together(planShift({ ...input, prefWindowMinutes: 60 })), true);
  assert.equal(together(planShift({ ...input, prefWindowMinutes: 40 })), false);
});
test('own parent: a daughter rides with her own parent when nobody waits longer than the window because of it (Di-ochtend)', () => {
  // real Tuesday: robbin's parent (4 seats) and jet's parent (6 seats); 08:15 for six girls, evi 08:30, jahaimy 09:15
  const input = {
    direction: 'heen', riders: riders([['anouk', '08:15'], ['eline', '08:15'], ['jet', '08:15'], ['lois', '08:15'], ['robbin', '08:15'], ['saar', '08:15'], ['evi', '08:30'], ['jahaimy', '09:15']]),
    drivers: [std('robbin', 4, 1), std('jet', 6, 2)], parentPrefWindowMinutes: 60,
  };
  const m = byDriver(planShift(input));
  assert.ok(m.robbin.includes('robbin'), 'Robbin rides with her own parent'); assert.ok(m.jet.includes('jet'), 'Jet rides with her own parent');
  const never = byDriver(planShift({ ...input, parentPrefWindowMinutes: 0 }));
  assert.ok(!never.robbin.includes('robbin'), 'with the window at 0 the time-best split stands: the settings is really used');
});
test('own parent: NOT when it makes other girls wait longer than the window (Wo-middag: Jahaimy stays out of her own parent\'s car)', () => {
  const input = {
    direction: 'terug', riders: riders([['anouk', '13:00'], ['lois', '13:00'], ['jahaimy', '14:45'], ['eline', '15:30'], ['evi', '15:30'], ['jet', '15:30'], ['saar', '15:30']]),
    drivers: [std('lois', 4, 1), std('jahaimy', 4, 2), bak('eline', 4, 3), bak('jet', 6, 4)], parentPrefWindowMinutes: 60,
  };
  assert.deepEqual(byDriver(planShift(input)), { lois: ['anouk', 'jahaimy', 'lois'], jahaimy: ['eline', 'evi', 'jet', 'saar'] });
  const wide = byDriver(planShift({ ...input, parentPrefWindowMinutes: 300 }));
  assert.ok(wide.jahaimy.includes('jahaimy'), 'with a very wide window the swap is allowed: the setting decides');
});
test('the order of the wishes: samen reizen before eigen ouder before voorkeur', () => {
  // a's parent drives; together [b, c]. Both cars can hold 2. Own parent (a with a) and together (b, c) cannot both hold if a and b share a time...
  const plan = planShift({
    direction: 'terug', riders: riders([['a', '17:00'], ['b', '17:00'], ['c', '17:00'], ['d', '17:00']]),
    drivers: [std('a', 2, 1), std('x', 2, 2)], togetherRules: [{ ids: ['b', 'c'] }],
  });
  const m = byDriver(plan);
  assert.ok(Object.values(m).some(g => g.includes('b') && g.includes('c')), 'b and c together');
  assert.ok(m.a.includes('a'), 'and a still with her own parent');
});

console.log('\n=== Not everything can be planned ===');
test('no drivers at all: nobody is placed', () => {
  const plan = planShift({ direction: 'heen', riders: riders([['a', '08:00']]), drivers: [] });
  assert.deepEqual(plan.cars, []); assert.deepEqual(plan.unplaced, ['a']); assert.equal(plan.partial, true);
});
test('not enough seats in total: the cars that can be filled are filled, the rest is handed back', () => {
  const plan = planShift({ direction: 'heen', riders: riders([['a', '08:00'], ['b', '08:00'], ['c', '08:00']]), drivers: [std('d1', 2, 1)] });
  assert.equal(plan.partial, true); assert.equal(plan.cars[0].girlIds.length, 2); assert.equal(plan.unplaced.length, 1);
});
test('riders that are too far apart for one car and have no second driver: the later ones are handed back', () => {
  const plan = planShift({ direction: 'heen', gapLimitMinutes: 180, riders: riders([['a', '08:00'], ['b', '13:00']]), drivers: [std('d1', 4, 1)] });
  assert.deepEqual(plan.cars.map(c => c.girlIds), [['a']]); assert.deepEqual(plan.unplaced, ['b']);
});
test('nobody to plan: nothing', () => {
  assert.deepEqual(planShift({ direction: 'heen', riders: [], drivers: [std('d', 4, 1)] }), { cars: [], unplaced: [], backupsUsed: 0, partial: false });
});
test('a driver with 0 seats is never used', () => {
  const plan = planShift({ direction: 'heen', riders: riders([['a', '08:00']]), drivers: [std('d0', 0, 1), std('d1', 3, 2)] });
  assert.deepEqual(drivers(plan), ['d1']);
});

console.log('\n=== checkPlan: the safety net catches every broken plan ===');
const baseIn = { gapLimitMinutes: 180, riders: riders([['a', '08:00'], ['b', '08:30'], ['c', '08:30']]), drivers: [std('d1', 2, 1), std('d2', 2, 2), bak('d3', 6, 3)] };
test('a good plan has no problems', () => {
  assert.deepEqual(checkPlan(baseIn, { cars: [{ driverId: 'd1', girlIds: ['a', 'b'] }, { driverId: 'd2', girlIds: ['c'] }], unplaced: [] }), []);
});
test('too many riders in a car', () => {
  const p = checkPlan(baseIn, { cars: [{ driverId: 'd1', girlIds: ['a', 'b', 'c'] }], unplaced: [] });
  assert.ok(p.some(x => /te weinig plaatsen/.test(x)));
});
test('a rider that is in no car and not marked unplaced; a rider in two cars', () => {
  const p = checkPlan(baseIn, { cars: [{ driverId: 'd1', girlIds: ['a', 'b'] }, { driverId: 'd2', girlIds: ['b'] }], unplaced: [] });
  assert.ok(p.some(x => /meer dan één auto/.test(x))); assert.ok(p.some(x => /geen enkele auto/.test(x)));
});
test('a driver who is not available, or drives two cars', () => {
  const p = checkPlan(baseIn, { cars: [{ driverId: 'nobody', girlIds: ['a'] }, { driverId: 'd1', girlIds: ['b'] }, { driverId: 'd1', girlIds: ['c'] }], unplaced: [] });
  assert.ok(p.some(x => /niet beschikbaar/.test(x))); assert.ok(p.some(x => /twee auto/.test(x)));
});
test('a time spread above the limit', () => {
  const inp = { ...baseIn, riders: riders([['a', '08:00'], ['b', '12:00']]) };
  assert.ok(checkPlan(inp, { cars: [{ driverId: 'd1', girlIds: ['a', 'b'] }], unplaced: [] }).some(x => /tijdsverschil/.test(x)));
});
test('a back-up driver while the standard drivers could do it is a problem; when they could not, it is fine', () => {
  const bad = checkPlan(baseIn, { cars: [{ driverId: 'd3', girlIds: ['a', 'b', 'c'] }], unplaced: [] });
  assert.ok(bad.some(x => /back-up/.test(x)));
  const needsIt = { ...baseIn, riders: riders([['a', '08:00'], ['b', '08:00'], ['c', '08:00'], ['d', '08:00'], ['e', '08:00']]) };
  assert.deepEqual(checkPlan(needsIt, { cars: [{ driverId: 'd3', girlIds: ['a', 'b', 'c', 'd', 'e'] }], unplaced: [] }), []);
});

console.log('\n=== Alternatives (1 or 2 cars) ===');
test('planAlternativeAssignments lists every valid driver pair for 2 clusters', () => {
  const alts = planAlternativeAssignments([['a', 'b'], ['c']], [{ id: 'd1', seats: 2 }, { id: 'd2', seats: 1 }, { id: 'd3', seats: 1 }]);
  const keys = alts.map(x => x.map(y => y.driverId + ':' + y.girlIds.join('')).join('+')).sort();
  assert.deepEqual(keys, ['d1:ab+d2:c', 'd1:ab+d3:c']);
});
test('planAlternativeAssignments returns per-driver options for 1 cluster', () => {
  assert.equal(planAlternativeAssignments([['a', 'b']], [{ id: 'd1', seats: 2 }, { id: 'd2', seats: 1 }]).length, 1);
});
test('planAlternativeAssignments returns nothing for 3+ clusters', () => {
  assert.deepEqual(planAlternativeAssignments([['a'], ['b'], ['c']], [{ id: 'd1', seats: 1 }, { id: 'd2', seats: 1 }, { id: 'd3', seats: 1 }]), []);
});

console.log('\n=== Property test: the engine against a plain brute-force search (random small shifts) ===');
// Reference: try every way to give each rider a driver. The best (fewest back-ups, fewest cars, lowest rank sum) must equal the
// engine's choice, the plan must pass checkPlan, and without wishes the waiting time must be the least possible for those drivers.
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function reference(input) {
  const R = [...input.riders].sort((a, b) => a.min - b.min || (a.id < b.id ? -1 : 1)), D = input.drivers, n = R.length;
  const gap = input.gapLimitMinutes, heen = input.direction !== 'terug';
  let best = null; const assign = new Array(n);
  (function rec(i) {
    if (i === n) {
      const groups = D.map(() => []);
      assign.forEach((d, r) => groups[d].push(R[r]));
      const used = groups.map((g, d) => ({ g, d })).filter(x => x.g.length);
      let total = 0, backups = 0, rankSum = 0;
      for (const { g, d } of used) {
        const t = g.map(x => x.min), lo = Math.min(...t), hi = Math.max(...t);
        total += g.reduce((s, x) => s + (heen ? x.min - lo : hi - x.min), 0);
        if (!D[d].standard) backups++; rankSum += D[d].rank;
      }
      const key = [backups, used.length, rankSum];   // as the engine: fewest back-ups, then fewest cars, then the lowest rank sum
      const set = used.map(x => D[x.d].id).sort().join('|');
      if (!best || key < best.key || (key.join() === best.key.join() && false)) best = { key: key, sets: {} };
      if (key.join() === best.key.join()) { best.sets[set] = Math.min(best.sets[set] ?? Infinity, total); }
      return;
    }
    for (let d = 0; d < D.length; d++) {
      const g = []; for (let r = 0; r < i; r++) if (assign[r] === d) g.push(R[r]);
      if (g.length >= D[d].seats) continue;
      if (g.length && R[i].min - Math.min(...g.map(x => x.min)) > gap) continue;
      if (g.length && Math.max(...g.map(x => x.min), R[i].min) - Math.min(...g.map(x => x.min), R[i].min) > gap) continue;
      assign[i] = d; rec(i + 1);
    }
  })(0);
  return best;
}
test('300 random shifts: same back-ups / cars / rank sum as brute force, valid plan, least waiting without wishes', () => {
  const rnd = mulberry(20261007); let compared = 0;
  for (let k = 0; k < 300; k++) {
    const n = 1 + Math.floor(rnd() * 6), nd = 1 + Math.floor(rnd() * 4);
    const direction = rnd() < 0.5 ? 'heen' : 'terug';
    const rs = Array.from({ length: n }, (_, i) => ({ id: 'r' + i, min: 480 + 15 * Math.floor(rnd() * 24) }));
    const ranks = [1, 2, 3, 4].sort(() => rnd() - 0.5);
    const ds = Array.from({ length: nd }, (_, i) => ({ id: 'r' + i, seats: 1 + Math.floor(rnd() * 5), standard: rnd() < 0.6, rank: ranks[i] }));
    const input = { riders: rs, drivers: ds, direction, gapLimitMinutes: 180, parentPrefWindowMinutes: 0 };   // 0: no own-parent wish, so the waiting time must be the least possible
    const ref = reference(input), plan = planShift(input);
    if (!ref) { assert.equal(plan.partial, true, 'case ' + k + ': no valid plan exists, so the engine must say so'); continue; }
    assert.equal(plan.partial, false, 'case ' + k);
    assert.deepEqual(checkPlan(input, plan), [], 'case ' + k);
    const byId = Object.fromEntries(ds.map(d => [d.id, d]));
    const key = [plan.cars.filter(c => !byId[c.driverId].standard).length, plan.cars.length, plan.cars.reduce((s, c) => s + byId[c.driverId].rank, 0)];
    assert.deepEqual(key, ref.key, 'case ' + k + ': back-ups, cars, rank sum');
    const set = plan.cars.map(c => c.driverId).sort().join('|');
    assert.ok(set in ref.sets, 'case ' + k + ': the engine picked a driver set the brute force also finds best');
    const T = Object.fromEntries(rs.map(r => [r.id, r.min]));
    const total = plan.cars.reduce((s, c) => { const t = c.girlIds.map(i => T[i]), lo = Math.min(...t), hi = Math.max(...t); return s + t.reduce((q, x) => q + (direction === 'heen' ? x - lo : hi - x), 0); }, 0);
    assert.equal(total, ref.sets[set], 'case ' + k + ': least waiting for that driver set');
    compared++;
  }
  assert.ok(compared > 150, 'enough random cases were really compared, got ' + compared);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
