// ============================================================
// AZ Carpool — planning engine
// ============================================================
// Pure functions only: no DOM, no Firebase, no globals. Every input is passed
// in explicitly and every output is plain data. This file is unit-tested in
// planning.test.js — run `node planning.test.js` after ANY change here, before
// it's ever wired back into index.html. That test file is the contract this
// module must satisfy; if a change breaks a test, the change is wrong, not the test.

export function timeToMinutes(t) {
  if (!t) return null;
  const p = t.split(':');
  return (+p[0]) * 60 + (+p[1]);
}

export function minutesToTime(min) {
  min = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(min / 60), m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Heen: leave early enough for the EARLIEST arrival requirement in the car.
// Terug: can't leave until the LAST passenger is actually ready.
export function computeDepartureTime(direction, minutesList, travelLeadMinutes) {
  const times = minutesList.filter(v => v != null);
  if (!times.length) return '';
  return direction === 'heen'
    ? minutesToTime(Math.min(...times) - (travelLeadMinutes || 60))
    : minutesToTime(Math.max(...times));
}

// ============================================================
// The planning engine for ONE shift (one weekday + heen or terug)
// ============================================================
// Rules, in this order of importance (written out in full in the README, "Planningslogica"):
//   HARD   every rider in exactly one car; one driver per car, a driver in one car only; riders <= seats of the car;
//          time spread inside a car <= gapLimitMinutes; only available drivers.
//   1  Back-up drivers only when the standard drivers cannot do it (too few seats, or the time spread would be too big), as few as possible.
//   2  Fewest cars.
//   3  The drivers highest in the Selectievolgorde (lowest sum of rank numbers) that make a valid planning possible.
//   4  Least total waiting time. (Heen: a girl arrives earlier than she needs to. Terug: a girl waits for the last one.)
//   5  Wishes, in this order: "samen reizen" rules, then a girl riding with her own parent, then "voorkeur" rules.
//      A wish may cost waiting time, but only inside its window (see eligible() below).
//   6  Ties: the driver highest in the Selectievolgorde takes the car that leaves first.
// There is NO rule about big cars for big groups: seats only decide whether it fits.

const DEFAULT_RANK = 999;
const PERMS = {};
function permsOf(k) {
  if (PERMS[k]) return PERMS[k];
  const out = [], used = new Array(k).fill(false), cur = [];
  (function rec() {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = 0; i < k; i++) if (!used[i]) { used[i] = true; cur.push(i); rec(); cur.pop(); used[i] = false; }
  })();
  return (PERMS[k] = out);
}

// How many "samen reizen" rules (a) and "voorkeur" rules (c) a division satisfies. groupIds: arrays of rider ids, one per car.
function countWishes(groupIds, togetherRules, preferRules) {
  const carOf = new Map();
  groupIds.forEach((g, gi) => g.forEach(id => carOf.set(id, gi)));
  let a = 0, c = 0;
  for (const r of togetherRules) {
    const present = (r.ids || []).filter(id => carOf.has(id));
    if (present.length < 2) continue;
    if (new Set(present.map(id => carOf.get(id))).size === 1) a++;
  }
  for (const r of preferRules) {
    if (!carOf.has(r.girlId)) continue;
    const gi = carOf.get(r.girlId);
    if ((r.withAny || []).some(id => id !== r.girlId && carOf.get(id) === gi)) c++;
  }
  return { a, c };
}

// Is candidate x better than y? More "samen reizen", then more own-parent cars, then more "voorkeur", then less waiting,
// then the Selectievolgorde order matches the departure order best, then a fixed order (so the result never flips at random).
function better(x, y) {
  if (x.a !== y.a) return x.a > y.a;
  if (x.b !== y.b) return x.b > y.b;
  if (x.c !== y.c) return x.c > y.c;
  if (x.total !== y.total) return x.total < y.total;
  if (x.mismatch !== y.mismatch) return x.mismatch < y.mismatch;
  return x.key < y.key;
}

// Search ONE chosen set of drivers (already sorted by rank): every division of the riders over exactly set.length cars,
// not only divisions that follow the time order, so riders with the same time can swap cars.
function solveSet(sorted, set, o) {
  const n = sorted.length, K = set.length;
  const T = sorted.map(r => r.min), ids = sorted.map(r => r.id);
  const seats = set.map(d => d.seats), maxSeat = Math.max(...seats);
  const heen = o.direction !== 'terug';
  const perms = permsOf(K);
  const permsFor = sizes => perms.filter(p => p.every((di, g) => sizes[g] <= seats[di]));
  const groups = [];
  let nodes = 0, aborted = false;

  // groups are opened in time order, so group g is the g-th car to leave. capOf (optional): the longest wait each rider may get.
  function run(onLeaf, pruneTotal, capOf) {
    groups.length = 0; nodes = 0; aborted = false;
    (function dfs(i, total) {
      if (aborted) return;
      if (++nodes > o.maxNodes) { aborted = true; return; }
      if (pruneTotal(total)) return;
      if (groups.length + (n - i) < K) return;
      if (i === n) { if (groups.length === K) onLeaf(total); return; }
      const t = T[i];
      for (let g = 0; g <= groups.length && g < K; g++) {
        if (g < groups.length) {
          const members = groups[g].members;
          if (members.length >= maxSeat) continue;
          if (t - T[members[0]] > o.gap) continue;
          if (capOf) {
            if (heen) { if (t - T[members[0]] > capOf[i]) continue; }
            else { let ok = true; for (const j of members) if (t - T[j] > capOf[j]) { ok = false; break; } if (!ok) continue; }
          }
          const add = heen ? t - T[members[0]] : members.length * (t - T[members[members.length - 1]]);
          members.push(i);
          dfs(i + 1, total + add);
          members.pop();
        } else {
          groups.push({ members: [i] });
          dfs(i + 1, total);
          groups.pop();
        }
      }
    })(0, 0);
  }

  function evaluate(part) {
    const gids = part.map(m => m.map(i => ids[i]));
    const { a, c } = countWishes(gids, o.together, o.prefer);
    const waits = new Array(n).fill(0);
    let total = 0;
    part.forEach(m => {
      const first = T[m[0]], last = T[m[m.length - 1]];
      m.forEach(i => { const w = heen ? T[i] - first : last - T[i]; waits[i] = w; total += w; });
    });
    const out = [];
    for (const p of permsFor(part.map(m => m.length))) {
      let b = 0, mismatch = 0;
      p.forEach((di, g) => { if (gids[g].includes(set[di].id)) b++; mismatch += Math.abs(di - g); });
      out.push({ part, gids, perm: p, a, b, c, total, waits, mismatch, key: p.join('') + '|' + part.map(m => m.join(',')).join(';') });
    }
    return out;
  }

  // Pass 1: the least total waiting time, and every division that reaches it.
  let bestTotal = Infinity;
  const e0 = [];
  run(total => {
    if (!permsFor(groups.map(g => g.members.length)).length) return;
    if (total < bestTotal) { bestTotal = total; e0.length = 0; }
    if (total === bestTotal && e0.length < 3000) e0.push(groups.map(g => g.members.slice()));
  }, total => total > bestTotal, null);
  if (bestTotal === Infinity) return null;

  // The time-optimal division that satisfies the most wishes is the starting point; what everybody waits there is the reference R.
  let base = null;
  for (const part of e0) for (const cand of evaluate(part)) if (!base || better(cand, base)) base = cand;
  const R = base.waits;
  let best = base;

  // Pass 2: other divisions may cost waiting time, but only to win a wish, and only inside that wish's window:
  // nobody may wait longer than max(her wait in the starting point, the window of the wish that is won).
  const prefW = o.prefW, parentW = o.parentW;
  const cap = R.map(r => Math.max(r, prefW, parentW));
  const eligible = cand => {
    if (cand.total <= bestTotal) return true;
    let need = 0;
    for (let i = 0; i < n; i++) if (cand.waits[i] > R[i] && cand.waits[i] > need) need = cand.waits[i];
    return (cand.a > base.a && need <= prefW) || (cand.b > base.b && need <= parentW) || (cand.c > base.c && need <= prefW);
  };
  run(() => {
    for (const cand of evaluate(groups.map(g => g.members.slice()))) if (eligible(cand) && better(cand, best)) best = cand;
  }, () => false, cap);

  return {
    cars: best.part.map((m, g) => ({ driverId: set[best.perm[g]].id, girlIds: m.map(i => ids[i]) })),
    totalWait: best.total,
  };
}

// Best effort when no valid planning exists at all: standard drivers first, then back-ups, in Selectievolgorde order; riders in time
// order go to the car where the time spread grows least; whoever fits nowhere is handed back as unplaced.
function planPartial(sorted, pool, o) {
  const order = [...pool].sort((a, b) => (b.standard ? 1 : 0) - (a.standard ? 1 : 0) || a.rank - b.rank || String(a.id).localeCompare(String(b.id)));
  const cars = [], unplaced = [];
  for (const r of sorted) {
    let pick = null;
    for (const c of cars) {
      if (c.girls.length >= c.driver.seats || r.min - c.girls[0].min > o.gap) continue;
      const grow = r.min - c.girls[c.girls.length - 1].min;
      if (!pick || grow < pick.grow) pick = { c, grow };
    }
    if (pick) { pick.c.girls.push(r); continue; }
    const next = order.find(d => !cars.some(c => c.driver.id === d.id));
    if (next) cars.push({ driver: next, girls: [r] }); else unplaced.push(r.id);
  }
  return { cars: cars.map(c => ({ driverId: c.driver.id, girlIds: c.girls.map(g => g.id) })), unplaced };
}

/**
 * Plans one shift.
 * @param {{id:string,min:number}[]} riders   who needs a ride, with the time in minutes (heen: arrival needed; terug: ready to be picked up)
 * @param {{id:string,seats:number,standard?:boolean,rank?:number}[]} drivers   every available driver (standard or back-up), Flex drivers included
 * @param {'heen'|'terug'} direction
 * @returns {{cars:{driverId:string,girlIds:string[]}[], unplaced:string[], backupsUsed:number, partial:boolean}}
 *   cars are in departure order; girlIds are in time order. partial = no complete planning exists, so some riders are unplaced.
 */
export function planShift(input) {
  const o = {
    direction: input.direction === 'terug' ? 'terug' : 'heen',
    gap: input.gapLimitMinutes != null ? input.gapLimitMinutes : 180,
    together: input.togetherRules || [], prefer: input.preferRules || [],
    prefW: input.prefWindowMinutes != null ? input.prefWindowMinutes : 30,
    parentW: input.parentPrefWindowMinutes != null ? input.parentPrefWindowMinutes : 60,
    maxNodes: input.maxNodes || 3000000,
  };
  const sorted = [...(input.riders || [])].sort((a, b) => a.min - b.min || String(a.id).localeCompare(String(b.id)));
  const n = sorted.length;
  if (!n) return { cars: [], unplaced: [], backupsUsed: 0, partial: false };
  const seen = new Set();
  let pool = (input.drivers || []).filter(d => d.seats > 0 && !seen.has(d.id) && seen.add(d.id))
    .map(d => ({ id: d.id, seats: d.seats, standard: d.standard !== false, rank: d.rank != null ? d.rank : DEFAULT_RANK }))
    .sort((a, b) => a.rank - b.rank || String(a.id).localeCompare(String(b.id)));
  if (pool.length > 12) pool = [...pool].sort((a, b) => (b.standard ? 1 : 0) - (a.standard ? 1 : 0) || a.rank - b.rank).slice(0, 12).sort((a, b) => a.rank - b.rank || String(a.id).localeCompare(String(b.id)));
  const D = pool.length;

  // Every set of drivers, best first: fewest back-ups, then fewest cars, then lowest sum of rank numbers.
  const sets = [];
  for (let mask = 1; mask < (1 << D); mask++) {
    const set = []; let seatSum = 0, backups = 0, rankSum = 0;
    for (let i = 0; i < D; i++) if (mask & (1 << i)) { set.push(pool[i]); seatSum += pool[i].seats; if (!pool[i].standard) backups++; rankSum += pool[i].rank; }
    if (set.length > n || seatSum < n) continue;
    sets.push({ set, backups, k: set.length, rankSum, key: set.map(d => d.id).join('|') });
  }
  sets.sort((x, y) => x.backups - y.backups || x.k - y.k || x.rankSum - y.rankSum || (x.key < y.key ? -1 : 1));
  for (const s of sets) {
    const r = solveSet(sorted, s.set, o);
    if (r) return { cars: r.cars, unplaced: [], backupsUsed: s.backups, partial: false };
  }
  const p = planPartial(sorted, pool, o);
  const byId = new Map(pool.map(d => [d.id, d]));
  return { cars: p.cars, unplaced: p.unplaced, backupsUsed: p.cars.filter(c => !byId.get(c.driverId).standard).length, partial: true };
}

// Can ANY valid planning be made with these drivers? Written separately from planShift on purpose (plain search over drivers),
// so checkPlan does not just repeat the planner's own reasoning. Returns true / false, or null when the search was too big.
function feasible(sorted, drivers, gap) {
  const n = sorted.length;
  const used = drivers.map(() => ({ count: 0, first: 0 }));
  let nodes = 0;
  function go(i) {
    if (++nodes > 2000000) return null;
    if (i === n) return true;
    const triedEmpty = new Set();
    for (let d = 0; d < drivers.length; d++) {
      const u = used[d];
      if (u.count >= drivers[d].seats) continue;
      if (u.count === 0) { if (triedEmpty.has(drivers[d].seats)) continue; triedEmpty.add(drivers[d].seats); } // two empty cars with equal seats are the same
      if (u.count > 0 && sorted[i].min - u.first > gap) continue;
      const before = { count: u.count, first: u.first };
      if (u.count === 0) u.first = sorted[i].min;
      u.count++;
      const r = go(i + 1);
      u.count = before.count; u.first = before.first;
      if (r !== false) return r;
    }
    return false;
  }
  return go(0);
}

/**
 * The safety net: checks a finished planning against the hard rules and returns a list of problems (empty = fine).
 * Run after every proposal. A proposal with problems is never shown as "Aanbevolen".
 */
export function checkPlan(input, plan) {
  const problems = [];
  const gap = input.gapLimitMinutes != null ? input.gapLimitMinutes : 180;
  const minOf = new Map((input.riders || []).map(r => [r.id, r.min]));
  const driverOf = new Map((input.drivers || []).map(d => [d.id, d]));
  const placed = new Map();
  const driving = new Set();
  for (const car of plan.cars || []) {
    const d = driverOf.get(car.driverId);
    if (!d) { problems.push('Chauffeur ' + car.driverId + ' is niet beschikbaar voor deze shift.'); continue; }
    if (driving.has(car.driverId)) problems.push('Chauffeur ' + car.driverId + ' rijdt twee auto\'s.');
    driving.add(car.driverId);
    if (!car.girlIds.length) problems.push('Auto van ' + car.driverId + ' is leeg.');
    if (car.girlIds.length > d.seats) problems.push('Auto van ' + car.driverId + ' heeft te weinig plaatsen (' + car.girlIds.length + ' > ' + d.seats + ').');
    const times = car.girlIds.map(id => minOf.get(id)).filter(v => v != null);
    if (times.length && Math.max(...times) - Math.min(...times) > gap) problems.push('Auto van ' + car.driverId + ' overschrijdt het maximale tijdsverschil.');
    car.girlIds.forEach(id => placed.set(id, (placed.get(id) || 0) + 1));
  }
  for (const r of input.riders || []) {
    const count = placed.get(r.id) || 0;
    const isUnplaced = (plan.unplaced || []).includes(r.id);
    if (count > 1) problems.push(r.id + ' zit in meer dan één auto.');
    if (count === 0 && !isUnplaced) problems.push(r.id + ' zit in geen enkele auto en staat niet als niet ingedeeld.');
    if (count === 1 && isUnplaced) problems.push(r.id + ' zit in een auto én staat als niet ingedeeld.');
  }
  for (const id of placed.keys()) if (!minOf.has(id)) problems.push(id + ' is geen passagier van deze shift.');
  // A back-up driver is only allowed when the standard drivers alone cannot cover this shift.
  const usesBackup = (plan.cars || []).some(c => driverOf.get(c.driverId) && driverOf.get(c.driverId).standard === false);
  if (usesBackup && !plan.partial) {
    const sorted = [...(input.riders || [])].sort((a, b) => a.min - b.min);
    const standard = (input.drivers || []).filter(d => d.standard !== false && d.seats > 0);
    if (feasible(sorted, standard, gap) === true) problems.push('Er rijdt een back-up-chauffeur terwijl de standaard-chauffeurs de shift aankunnen.');
  }
  return problems;
}

/**
 * All alternative full driver-pair assignments for a 2-cluster shift (every
 * distinct pair of available drivers that can cover both clusters, in either
 * orientation). Only meaningful for exactly 2 clusters — 1-cluster shifts just
 * list every eligible driver individually; 3+ cluster shifts skip this
 * (combinatorial alternatives aren't offered there, only the primary proposal).
 *
 * @param {string[][]} clusters
 * @param {{id:string,seats:number}[]} availableDrivers - any order
 * @returns {{driverId:string,girlIds:string[]}[][]}
 */
export function planAlternativeAssignments(clusters, availableDrivers) {
  if (clusters.length === 1) {
    const c = clusters[0];
    return availableDrivers
      .filter(d => d.seats >= c.length)
      .map(d => [{ driverId: d.id, girlIds: c }]);
  }
  if (clusters.length !== 2) return [];
  const [c1, c2] = clusters;
  const seen = new Set();
  const results = [];
  for (let i = 0; i < availableDrivers.length; i++) {
    for (let j = 0; j < availableDrivers.length; j++) {
      if (i === j) continue;
      const dA = availableDrivers[i], dB = availableDrivers[j];
      if (dA.seats >= c1.length && dB.seats >= c2.length) {
        const key = [dA.id, dB.id].sort().join('+');
        if (!seen.has(key)) { seen.add(key); results.push([{ driverId: dA.id, girlIds: c1 }, { driverId: dB.id, girlIds: c2 }]); }
      }
    }
  }
  return results;
}
