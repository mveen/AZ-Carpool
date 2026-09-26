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

// All k-length combinations of the given array's ELEMENTS (not indices — caller
// passes whatever it wants combined, e.g. an array of gap-positions).
function combinations(arr, k) {
  const result = [];
  function helper(start, combo) {
    if (combo.length === k) { result.push(combo.slice()); return; }
    for (let i = start; i <= arr.length - (k - combo.length); i++) {
      combo.push(arr[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return result;
}

// Can every cluster (by SIZE) be matched to a distinct driver seat count?
// Sort both descending and compare pairwise — this is the standard, provably
// correct feasibility test for "assign N differently-sized items to N bins of
// varying capacity, one item per bin, each item's size <= its bin's capacity".
function seatsFeasible(clusterSizes, driverSeats) {
  const sizesDesc = [...clusterSizes].sort((a, b) => b - a);
  const seatsDesc = [...driverSeats].sort((a, b) => b - a);
  if (sizesDesc.length > seatsDesc.length) return false;
  for (let i = 0; i < sizesDesc.length; i++) {
    if (seatsDesc[i] < sizesDesc[i]) return false;
  }
  return true;
}

function gapsFeasible(clusters, gapLimitMinutes) {
  return clusters.every(c => c[c.length - 1].min - c[0].min <= gapLimitMinutes);
}

// How well a candidate clustering respects "samen reizen" (hard-ish: heavily
// penalised if broken) and "voorkeur" (soft: small bonus if satisfied) rules.
function scorePrefsForClusters(clusters, togetherRules, preferRules) {
  let broken = 0, satisfied = 0;
  (togetherRules || []).forEach(r => {
    const ids = (r.ids || []).filter(gid => clusters.some(c => c.some(x => x.id === gid)));
    if (ids.length < 2) return;
    const clusterIdxs = new Set(ids.map(gid => clusters.findIndex(c => c.some(x => x.id === gid))));
    if (clusterIdxs.size > 1) broken++;
  });
  (preferRules || []).forEach(r => {
    const girlIdx = clusters.findIndex(c => c.some(x => x.id === r.girlId));
    if (girlIdx < 0) return;
    const anySame = (r.withAny || []).some(id => clusters[girlIdx].some(x => x.id === id));
    if (anySame) satisfied++;
  });
  return { broken, satisfied };
}

/**
 * Splits a shift's girls into the FEWEST cars whose sizes can actually be
 * matched to the available drivers' seats, searching every possible way to
 * make that many cuts (not just the single largest time gaps) so a feasible
 * split is never missed just because it wasn't the most "obvious" one.
 *
 * @param {{id:string,min:number}[]} girls
 * @param {number[]} driverSeats - passenger-seat counts of every AVAILABLE driver this shift
 * @param {number} gapLimitMinutes
 * @param {{ids:string[]}[]} togetherRules
 * @param {{girlId:string,withAny:string[]}[]} preferRules
 * @returns {string[][]} clusters of girl ids, in ascending start-time order
 */
export function planClusters({ girls, driverSeats, gapLimitMinutes, togetherRules = [], preferRules = [] }) {
  if (!girls.length) return [];
  const sorted = [...girls].sort((a, b) => a.min - b.min);
  const n = sorted.length;
  const gapPositions = [];
  for (let i = 1; i < n; i++) gapPositions.push(i);

  function splitAt(boundaryIdxs) {
    const sortedB = [...boundaryIdxs].sort((a, b) => a - b);
    const clusters = []; let start = 0;
    sortedB.forEach(idx => { clusters.push(sorted.slice(start, idx)); start = idx; });
    clusters.push(sorted.slice(start));
    return clusters;
  }
  function boundaryGapSum(boundaryIdxs) {
    return boundaryIdxs.reduce((sum, idx) => sum + (sorted[idx].min - sorted[idx - 1].min), 0);
  }

  for (let K = 1; K <= n; K++) {
    const need = K - 1;
    if (need > gapPositions.length) break;
    const combos = need === 0 ? [[]] : combinations(gapPositions, need);
    let best = null, bestScore = -Infinity;
    for (const combo of combos) {
      const clusters = splitAt(combo);
      const sizes = clusters.map(c => c.length);
      if (!seatsFeasible(sizes, driverSeats)) continue;
      if (!gapsFeasible(clusters, gapLimitMinutes)) continue;
      const { broken, satisfied } = scorePrefsForClusters(clusters, togetherRules, preferRules);
      const score = -broken * 100000 + satisfied * 500 + boundaryGapSum(combo) * 0.01;
      if (score > bestScore) { bestScore = score; best = clusters; }
    }
    if (best) return best.map(c => c.map(x => x.id));
  }
  // Nothing feasible at any K (not enough total seats however split) — best-effort
  // fallback so the coordinator still sees SOME clustering to adjust manually:
  // one car per available driver, split at the largest gaps.
  const fallbackK = Math.min(n, Math.max(1, driverSeats.length));
  const need = fallbackK - 1;
  let boundaries = [];
  if (need > 0) {
    const gapsSorted = gapPositions
      .map(idx => ({ idx, size: sorted[idx].min - sorted[idx - 1].min }))
      .sort((a, b) => b.size - a.size);
    boundaries = gapsSorted.slice(0, need).map(g => g.idx);
  }
  return splitAt(boundaries).map(c => c.map(x => x.id));
}

/**
 * Assigns each cluster to a driver: largest clusters first (so a driver with
 * barely-enough seats isn't "used up" on a smaller car first), preferring
 * whichever ELIGIBLE driver's own daughter is actually in that cluster, then
 * falling back to shift-priority order (drivers[] must already be sorted by
 * priority ascending — best first).
 *
 * @param {string[][]} clusters
 * @param {{id:string,seats:number}[]} priorityDrivers - sorted best-first
 * @returns {{driverId:string,girlIds:string[]}[] | null}
 */
export function planPrimaryAssignment(clusters, priorityDrivers) {
  if (!clusters.length) return null;
  if (!priorityDrivers.length) return null;
  const used = new Set();
  const order = clusters.map((c, i) => i).sort((a, b) => clusters[b].length - clusters[a].length);
  const byIndex = {};
  for (const i of order) {
    const cluster = clusters[i];
    const eligible = priorityDrivers.filter(d => !used.has(d.id) && d.seats >= cluster.length);
    if (!eligible.length) return null;
    const ownParent = eligible.find(d => cluster.includes(d.id));
    const driver = ownParent || eligible[0];
    used.add(driver.id);
    byIndex[i] = { driverId: driver.id, girlIds: cluster };
  }
  return clusters.map((c, i) => byIndex[i]);
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
