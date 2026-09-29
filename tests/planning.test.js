// Run with: node planning.test.js
// Every test must pass before planning.js is copied back into index.html.
import assert from 'node:assert/strict';
import {
  timeToMinutes, minutesToTime, computeDepartureTime,
  planClusters, planPrimaryAssignment, planAlternativeAssignments
} from '../planning.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  \u2713', name); }
  catch (e) { failed++; console.log('  \u2717', name, '\n     ', e.message); }
}
function girls(pairs) { return pairs.map(([id, t]) => ({ id, min: timeToMinutes(t) })); }
function assignmentMap(assignment) {
  const m = {};
  assignment.forEach(a => { m[a.driverId] = [...a.girlIds].sort(); });
  return m;
}

console.log('=== timeToMinutes / minutesToTime / computeDepartureTime ===');
test('timeToMinutes basic', () => { assert.equal(timeToMinutes('08:30'), 510); });
test('minutesToTime basic', () => { assert.equal(minutesToTime(510), '08:30'); });
test('minutesToTime wraps negative', () => { assert.equal(minutesToTime(-30), '23:30'); });
test('computeDepartureTime heen uses earliest minus lead', () => {
  assert.equal(computeDepartureTime('heen', [510, 615], 60), '07:30');
});
test('computeDepartureTime terug uses latest, no lead', () => {
  assert.equal(computeDepartureTime('terug', [1020, 1080], 60), '18:00');
});

console.log('\n=== REGRESSION: Monday morning (Eline/Jahaimy 08:30, rest split correctly) ===');
test('Monday morning: 2 drivers, correct 2/5 split by own-parent + capacity', () => {
  const g = girls([
    ['eline', '08:30'], ['jahaimy', '08:30'],
    ['anouk', '10:15'], ['evi', '10:15'], ['lois', '10:15'],
    ['jet', '11:00'], ['saar', '11:00'],
  ]);
  const driverSeats = [4, 6]; // eline-parent=4, jet-parent=6
  const clusters = planClusters({ girls: g, driverSeats, gapLimitMinutes: 180 });
  assert.equal(clusters.length, 2, 'expected exactly 2 cars');
  const sizes = clusters.map(c => c.length).sort();
  assert.deepEqual(sizes, [2, 5], 'expected a 2-and-5 split, not something else');
  const small = clusters.find(c => c.length === 2);
  const big = clusters.find(c => c.length === 5);
  assert.deepEqual([...small].sort(), ['eline', 'jahaimy']);
  assert.deepEqual([...big].sort(), ['anouk', 'evi', 'jet', 'lois', 'saar']);

  const priorityDrivers = [{ id: 'eline', seats: 4 }, { id: 'jet', seats: 6 }];
  const assignment = planPrimaryAssignment(clusters, priorityDrivers);
  const map = assignmentMap(assignment);
  assert.deepEqual(map['eline'], ['eline', 'jahaimy'].sort());
  assert.deepEqual(map['jet'], ['anouk', 'evi', 'jet', 'lois', 'saar'].sort());
});

test('Monday morning: still correct with EXTRA available drivers in the mix (realistic roster)', () => {
  // Same girls, but now 5 drivers are available this shift, not just 2 — this is the
  // shape of a real roster and is exactly where the old "only try the single largest
  // gap" logic could silently miss the correct split.
  const g = girls([
    ['eline', '08:30'], ['jahaimy', '08:30'],
    ['anouk', '10:15'], ['evi', '10:15'], ['lois', '10:15'],
    ['jet', '11:00'], ['saar', '11:00'],
  ]);
  const driverSeats = [4, 6, 3, 2, 5]; // eline, jet, + 3 unrelated small-capacity drivers
  const clusters = planClusters({ girls: g, driverSeats, gapLimitMinutes: 180 });
  const sizes = clusters.map(c => c.length).sort((a, b) => a - b);
  assert.deepEqual(sizes, [2, 5], 'extra unrelated drivers must not change the correct split');
});

console.log('\n=== REGRESSION: Monday afternoon (4/4 split, priority order must be respected) ===');
test('Monday afternoon: 8 girls in two clean time groups, priority drivers must be used', () => {
  const g = girls([
    ['lois', '17:00'], ['jahaimy', '17:00'], ['jet', '17:00'], ['robbin', '17:00'],
    ['eline', '18:00'], ['saar', '18:00'], ['evi', '18:00'], ['anouk', '18:00'],
  ]);
  // Every girl's own parent is also an available driver here, all with 4 seats,
  // PLUS a couple of extra available drivers (anouk, jet, evi) with smaller/larger
  // capacity that a buggy search might wrongly prefer.
  const driverSeatsAll = [
    { id: 'lois', seats: 4 }, { id: 'eline', seats: 4 },
    { id: 'anouk', seats: 4 }, { id: 'jet', seats: 4 }, { id: 'evi', seats: 4 },
  ];
  const driverSeats = driverSeatsAll.map(d => d.seats);
  const clusters = planClusters({ girls: g, driverSeats, gapLimitMinutes: 180 });
  assert.equal(clusters.length, 2, 'must be exactly 2 cars, not 3');
  const sizes = clusters.map(c => c.length).sort();
  assert.deepEqual(sizes, [4, 4]);
  const c17 = clusters.find(c => c.includes('lois'));
  const c18 = clusters.find(c => c.includes('eline'));
  assert.deepEqual([...c17].sort(), ['jahaimy', 'jet', 'lois', 'robbin'].sort());
  assert.deepEqual([...c18].sort(), ['anouk', 'eline', 'evi', 'saar'].sort());

  // Priority order: Loïs's parent is #1, Eline's parent is #2 — they must be the
  // ones actually driving, not anouk/jet/evi's parents, even though those are
  // also available and also fit.
  const priorityDrivers = [
    { id: 'lois', seats: 4 }, { id: 'eline', seats: 4 },
    { id: 'anouk', seats: 4 }, { id: 'jet', seats: 4 }, { id: 'evi', seats: 4 },
  ];
  const assignment = planPrimaryAssignment(clusters, priorityDrivers);
  const map = assignmentMap(assignment);
  assert.deepEqual(map['lois'], ['jahaimy', 'jet', 'lois', 'robbin'].sort(), 'Loïs\'s parent must drive the 17:00 car');
  assert.deepEqual(map['eline'], ['anouk', 'eline', 'evi', 'saar'].sort(), 'Eline\'s parent must drive the 18:00 car');
  assert.ok(!('anouk' in map) && !('jet' in map) && !('evi' in map), 'lower-priority available drivers must NOT be used when higher-priority ones fit');
});

console.log('\n=== REGRESSION: 3-car scenario (never capped at 2) ===');
test('3 distinct time clusters, only 2-seat drivers available -> 3 cars', () => {
  const g = girls([
    ['a1', '08:00'], ['a2', '08:00'],
    ['b1', '10:00'], ['b2', '10:00'],
    ['c1', '12:00'], ['c2', '12:00'],
  ]);
  const driverSeats = [2, 2, 2, 2, 2, 2];
  const clusters = planClusters({ girls: g, driverSeats, gapLimitMinutes: 180 });
  assert.equal(clusters.length, 3);
  assert.deepEqual(clusters.map(c => [...c].sort()), [['a1', 'a2'], ['b1', 'b2'], ['c1', 'c2']]);
});

console.log('\n=== Capacity-forced split even when time gap is small ===');
test('Tuesday morning: 8 girls within 1 hour, but no single car big enough', () => {
  const g = girls([
    ['evi', '08:30'], ['jahaimy', '09:15'], ['anouk', '08:15'], ['eline', '08:15'],
    ['jet', '08:15'], ['saar', '08:15'], ['lois', '08:15'], ['robbin', '08:15'],
  ]);
  const driverSeats = [4, 6]; // robbin-parent=4, jet-parent=6 — neither fits all 8
  const clusters = planClusters({ girls: g, driverSeats, gapLimitMinutes: 180 });
  assert.equal(clusters.length, 2);
  const sizes = clusters.map(c => c.length).sort((a, b) => a - b);
  assert.deepEqual(sizes, [2, 6], 'must split 2/6 to fit the 4-seat and 6-seat cars');
});

console.log('\n=== Single car when everyone fits and gap is within threshold ===');
test('All 3 girls fit in one 4-seat car within gap threshold', () => {
  const g = girls([['a', '08:00'], ['b', '08:15'], ['c', '08:30']]);
  const clusters = planClusters({ girls: g, driverSeats: [4], gapLimitMinutes: 180 });
  assert.equal(clusters.length, 1);
  assert.deepEqual([...clusters[0]].sort(), ['a', 'b', 'c']);
});

console.log('\n=== "Samen reizen" (together) is a SOFT preference — cheap to satisfy: honored ===');
test('Together rule wins when satisfying it costs little extra waiting', () => {
  // Two feasible splits exist: [a,b]/[c,d,e] (total wait 30) and [a,b,c]/[d,e]
  // (total wait 60) — a 30-minute difference. With the default 30-minute
  // preference budget, satisfying "b and c together" (only true in the second
  // split) is worth exactly that trade, so it should win.
  const g = girls([['a', '00:00'], ['b', '00:10'], ['c', '00:50'], ['d', '01:00'], ['e', '01:10']]);
  const driverSeats = [3, 3];
  const clusters = planClusters({
    girls: g, driverSeats, gapLimitMinutes: 180,
    togetherRules: [{ ids: ['b', 'c'] }],
    prefWindowMinutes: 40,
  });
  const together = clusters.find(c => c.includes('b'));
  assert.ok(together.includes('c'), 'b and c should end up together when the extra cost is within the preference budget');
});

console.log('\n=== "Samen reizen" is NEVER a hard constraint — expensive to satisfy: NOT honored ===');
test('Monday morning: an old "Anouk+Jahaimy together" rule must NOT force a much worse split', () => {
  // This is the exact real-world case that was previously mishandled: satisfying
  // the rule would cost 105 minutes of total waiting instead of 45 — far more
  // than the rule is "worth" — so the time-efficient split must still win.
  const g = girls([
    ['eline', '08:30'], ['jahaimy', '08:30'],
    ['anouk', '10:15'], ['evi', '10:15'], ['lois', '10:15'],
    ['jet', '11:00'], ['saar', '11:00'],
  ]);
  const driverSeats = [4, 6];
  const clusters = planClusters({
    girls: g, driverSeats, gapLimitMinutes: 180,
    togetherRules: [{ ids: ['anouk', 'jahaimy'] }],
    prefWindowMinutes: 30,
  });
  const small = clusters.find(c => c.length === 2);
  assert.deepEqual([...small].sort(), ['eline', 'jahaimy'], 'must still split Eline+Jahaimy off, not force Anouk+Jahaimy together at this cost');
});
test('Monday morning: all 3 original Reisvoorkeuren rules together still yield the efficient split', () => {
  const g = girls([
    ['eline', '08:30'], ['jahaimy', '08:30'],
    ['anouk', '10:15'], ['evi', '10:15'], ['lois', '10:15'],
    ['jet', '11:00'], ['saar', '11:00'],
  ]);
  const driverSeats = [4, 6];
  const clusters = planClusters({
    girls: g, driverSeats, gapLimitMinutes: 180,
    togetherRules: [{ ids: ['saar', 'eline'] }, { ids: ['anouk', 'jahaimy'] }],
    preferRules: [{ girlId: 'evi', withAny: ['saar', 'eline'] }],
    prefWindowMinutes: 30,
  });
  const small = clusters.find(c => c.length === 2);
  assert.deepEqual([...small].sort(), ['eline', 'jahaimy'], 'real preferences must not override a much cheaper split either');
});
test('A rule satisfied "for free" (no extra waiting) still wins the tie over one that is not', () => {
  const g = girls([['a', '08:00'], ['b', '08:05'], ['c', '08:10'], ['d', '08:15']]);
  const driverSeats = [2, 2];
  // Both [a,b]/[c,d] and [a,c]-style splits aren't possible (contiguous only), but
  // [a,b]/[c,d] vs [a]/[b,c,d] vs [a,b,c]/[d] all have different spans; with a
  // rule that's satisfied by the lowest-span option already, it should simply win.
  const clusters = planClusters({
    girls: g, driverSeats: [3, 3], gapLimitMinutes: 180,
    togetherRules: [{ ids: ['a', 'b'] }],
  });
  const together = clusters.find(c => c.includes('a'));
  assert.ok(together.includes('b'));
});

console.log('\n=== Alternatives (2-cluster only) ===');
test('planAlternativeAssignments lists every valid driver pair for 2 clusters', () => {
  const clusters = [['a', 'b'], ['c', 'd', 'e']];
  const drivers = [{ id: 'x', seats: 2 }, { id: 'y', seats: 3 }, { id: 'z', seats: 5 }];
  const alts = planAlternativeAssignments(clusters, drivers);
  // x(2) can only cover [a,b]; y(3) or z(5) can cover [c,d,e]; z(5) could also cover [a,b].
  const pairKeys = alts.map(a => a.map(x => x.driverId).sort().join('+')).sort();
  assert.ok(pairKeys.includes('x+y'));
  assert.ok(pairKeys.includes('x+z'));
});
test('planAlternativeAssignments returns per-driver options for 1 cluster', () => {
  const clusters = [['a', 'b']];
  const drivers = [{ id: 'x', seats: 1 }, { id: 'y', seats: 2 }, { id: 'z', seats: 4 }];
  const alts = planAlternativeAssignments(clusters, drivers);
  assert.equal(alts.length, 2); // x doesn't fit, y and z do
});
test('planAlternativeAssignments returns nothing for 3+ clusters', () => {
  const clusters = [['a'], ['b'], ['c']];
  const drivers = [{ id: 'x', seats: 4 }];
  assert.deepEqual(planAlternativeAssignments(clusters, drivers), []);
});

console.log('\n=== REGRESSION: an own-parent match must NEVER jump the priority queue ===');
test('Tuesday morning (real reported bug): priority #1 (Robbin) must be used, not skipped for #5 (Evi)', () => {
  // Real data from the app: clusters already correctly computed as [6-cluster, 2-cluster].
  // Priority order: 1 Robbin, 2 Jet, 3 Saar, 4 Eline, 5 Evi. Jet is the ONLY one with enough
  // seats (6) for the 6-cluster; every one of the other four has exactly 4 seats — enough for
  // the leftover 2-cluster. The bug: Evi (priority #5) happened to be her own daughter's
  // driver for that 2-cluster, and an unjustified "own parent" override let her jump ahead of
  // Robbin (priority #1), who was equally eligible and strictly higher priority.
  const clusters = [
    ['anouk', 'eline', 'jet', 'lois', 'robbin', 'saar'],
    ['evi', 'jahaimy'],
  ];
  const priorityDrivers = [
    { id: 'robbin', seats: 4 }, { id: 'jet', seats: 6 }, { id: 'saar', seats: 4 },
    { id: 'eline', seats: 4 }, { id: 'evi', seats: 4 },
  ];
  const assignment = planPrimaryAssignment(clusters, priorityDrivers);
  const map = assignmentMap(assignment);
  assert.deepEqual(map['jet'], ['anouk', 'eline', 'jet', 'lois', 'robbin', 'saar'].sort(), 'Jet must drive the 6-cluster (only one with enough seats)');
  assert.deepEqual(map['robbin'], ['evi', 'jahaimy'].sort(), 'Robbin (priority #1) must drive the 2-cluster, not Evi (#5)');
  assert.ok(!('evi' in map), 'Evi must NOT be used as a driver here at all — she is lower priority than Robbin and Robbin is equally eligible');
});
test('Tuesday afternoon (real reported bug): priority #2 (Saar) must be used, not skipped for #3 (Jahaimy)', () => {
  const clusters = [
    ['anouk', 'eline', 'jet', 'lois', 'saar'],
    ['evi', 'jahaimy'],
  ];
  const priorityDrivers = [
    { id: 'jet', seats: 6 }, { id: 'saar', seats: 4 }, { id: 'jahaimy', seats: 4 },
  ];
  const assignment = planPrimaryAssignment(clusters, priorityDrivers);
  const map = assignmentMap(assignment);
  assert.deepEqual(map['jet'], ['anouk', 'eline', 'jet', 'lois', 'saar'].sort());
  assert.deepEqual(map['saar'], ['evi', 'jahaimy'].sort(), 'Saar (priority #2) must drive the 2-cluster, not Jahaimy (#3)');
  assert.ok(!('jahaimy' in map), 'Jahaimy must NOT be used as a driver — lower priority than Saar, who is equally eligible');
});

console.log('\n=== Edge cases ===');
test('empty girl list returns no clusters', () => {
  assert.deepEqual(planClusters({ girls: [], driverSeats: [4], gapLimitMinutes: 180 }), []);
});
test('planPrimaryAssignment returns null when nobody has enough seats', () => {
  const clusters = [['a', 'b', 'c']];
  assert.equal(planPrimaryAssignment(clusters, [{ id: 'x', seats: 1 }]), null);
});
test('planPrimaryAssignment returns null with no drivers at all', () => {
  assert.equal(planPrimaryAssignment([['a']], []), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
