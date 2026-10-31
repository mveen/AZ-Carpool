// weekrooster-impact.js — "Wie merkt dit": what a request would change for the other families IF the day coordinator agrees.
// Pure: no DOM, no database. It plans the shift twice with the planning engine (planning.js): with everybody's fixed times, and with the
// requested times, and compares when each family's car leaves. It is an expectation only: the day coordinator decides.
import { planShift, computeDepartureTime, timeToMinutes, ownCarIds } from './planning.js';

const seatsOf = f => Math.max(0, ((f && f.capacity) || 0) - 1);
const availOf = (f, day) => (f && f.availability && f.availability[day]) || {};
const stdTime = (f, day, direction) => (f && f.schedule && f.schedule[day] && f.schedule[day][direction]) || '';

// ctx: { day, direction, cars: [{ girlIds, driverFamilyId }]  (the cars of that shift as they run now),
//        requests: [{ familyId, rides, time }]  (time = the requested time for THIS direction, '' = none),
//        families: { id: family }, settings, prefs, priority: { id: rank } }
// Result: { carsBefore, carsAfter, changes: [{ familyId, from, to }], noSolution }
//   changes: a family (other than the one asking) whose car leaves at another time; from/to are 'HH:MM'.
//   noSolution: the planning engine finds no complete planning with the requested times.
export function expectedImpact(ctx) {
  const { day, direction, families } = ctx;
  const lead = (ctx.settings && ctx.settings.travelLeadMinutes) || 60;
  const asking = new Map((ctx.requests || []).map(r => [r.familyId, r]));
  const girls = [];
  (ctx.cars || []).forEach(c => (c.girlIds || []).forEach(id => { if (!girls.includes(id)) girls.push(id); }));
  asking.forEach((r, id) => { if (r.rides && r.time && !girls.includes(id)) girls.push(id); });

  const fixedMin = id => timeToMinutes(stdTime(families[id], day, direction));
  const riders = girls.map(id => ({ id, min: asking.has(id) ? (asking.get(id).rides && asking.get(id).time ? timeToMinutes(asking.get(id).time) : null) : fixedMin(id) }))
    .filter(r => r.min != null);
  const ridersBefore = girls.map(id => ({ id, min: fixedMin(id) })).filter(r => r.min != null);

  const rankOf = id => (ctx.priority && ctx.priority[id] != null ? ctx.priority[id] : 999);
  const drivers = new Map();
  Object.entries(families || {}).forEach(([id, f]) => {
    const a = availOf(f, day), std = !!a[direction], bak = !!a[direction === 'heen' ? 'backupHeen' : 'backupTerug'];
    if (std || bak) drivers.set(id, { id, seats: seatsOf(f), standard: std, rank: rankOf(id) });
  });
  (ctx.cars || []).forEach(c => { const id = c.driverFamilyId; if (id && families[id]) drivers.set(id, { id, seats: seatsOf(families[id]), standard: true, rank: rankOf(id) }); });

  const rules = (ctx.prefs && ctx.prefs.rules) || [];
  const plan = list => planShift({
    riders: list, drivers: [...drivers.values()], direction,
    gapLimitMinutes: ((ctx.settings && ctx.settings.gapThresholdHours) || 3) * 60,
    togetherRules: rules.filter(r => r.type === 'together'), preferRules: rules.filter(r => r.type === 'prefer'), ownCarRules: rules.filter(r => r.type === 'ownCar'),
    prefWindowMinutes: ctx.settings && ctx.settings.prefWindowMinutes != null ? ctx.settings.prefWindowMinutes : 30,
    parentPrefWindowMinutes: ctx.settings && ctx.settings.parentPrefWindowMinutes != null ? ctx.settings.parentPrefWindowMinutes : 60,
  });
  const before = plan(ridersBefore), after = plan(riders);
  const minOf = list => new Map(list.map(r => [r.id, r.min]));
  // When does the car of each girl leave? (heen: early enough for the earliest arrival; terug: when the last one is ready.)
  const departures = (p, list) => {
    const mins = minOf(list), out = new Map();
    p.cars.forEach(c => { const dep = computeDepartureTime(direction, c.girlIds.map(id => mins.get(id)), lead); c.girlIds.forEach(id => out.set(id, dep)); });
    return out;
  };
  const depBefore = departures(before, ridersBefore), depAfter = departures(after, riders);
  const changes = [];
  girls.forEach(id => {
    if (asking.has(id) || !depBefore.has(id) || !depAfter.has(id)) return;
    if (depBefore.get(id) !== depAfter.get(id)) changes.push({ familyId: id, from: depBefore.get(id), to: depAfter.get(id) });
  });
  return { carsBefore: before.cars.length, carsAfter: after.cars.length, changes, noSolution: after.partial || after.unplaced.length > 0 };
}

// ---------- the advice (phase 4) ----------
// Two variants for one shift, from the same facts:
//   'zuinig'  (Zuinigst)      the planning engine with the new times: as few cars as possible.
//   'gedoe'   (Minste gedoe)  the cars as they are now; only who has to move, moves (a new car only when nothing else fits).
// ctx: { day, direction, cars: [{ driverFamilyId, girlIds, ... }]  (as they run now), requests: [{ familyId, rides, time }]  ('' = not this way),
//        timeOf(familyId) -> the time of that girl on this shift now, families, settings, prefs, priority }
// Result: { carsBefore, variants: { zuinig: Variant, gedoe: Variant } }
//   Variant: { cars: [{ driverFamilyId, girlIds, departureTime, ...car it grew from }], times: { familyId: 'HH:MM' | '' } (the requested ones),
//              carsAfter, familiesChanged: [familyId] (other than the askers), noSolution, reasons: [{ key, params }] }
// The reasons are keys with values, never text: the screen turns them into sentences (nothing is typed by anybody).
const sigOf = (c, dep) => (c.driverFamilyId || '') + '|' + [...(c.girlIds || [])].sort().join(',') + '|' + (dep || '');

function driversOf(ctx) {
  const { day, direction, families } = ctx;
  const rankOf = id => (ctx.priority && ctx.priority[id] != null ? ctx.priority[id] : 999);
  const drivers = new Map();
  Object.entries(families || {}).forEach(([id, f]) => {
    const a = availOf(f, day), std = !!a[direction], bak = !!a[direction === 'heen' ? 'backupHeen' : 'backupTerug'];
    if (std || bak) drivers.set(id, { id, seats: seatsOf(f), standard: std, rank: rankOf(id) });
  });
  (ctx.cars || []).forEach(c => { const id = c.driverFamilyId; if (id && families[id]) drivers.set(id, { id, seats: seatsOf(families[id]), standard: true, rank: rankOf(id) }); });
  return drivers;
}

export function buildAdvice(ctx) {
  const { direction, families } = ctx;
  const lead = (ctx.settings && ctx.settings.travelLeadMinutes) || 60;
  const gap = ((ctx.settings && ctx.settings.gapThresholdHours) || 3) * 60;
  const asking = new Map((ctx.requests || []).map(r => [r.familyId, r]));
  const current = (ctx.cars || []).map(c => ({ ...c, girlIds: [...(c.girlIds || [])] }));
  const timeNow = id => timeToMinutes(ctx.timeOf ? ctx.timeOf(id) : stdTime(families[id], ctx.day, direction));
  // the time each girl has AFTER the change (null = she does not ride this way)
  const after = new Map();
  const girls = [];
  current.forEach(c => c.girlIds.forEach(id => { if (!girls.includes(id)) girls.push(id); }));
  asking.forEach((r, id) => { if (!girls.includes(id)) girls.push(id); });
  girls.forEach(id => {
    const r = asking.get(id);
    after.set(id, r ? (r.rides && r.time ? timeToMinutes(r.time) : null) : timeNow(id));
  });
  const riders = girls.filter(id => after.get(id) != null).map(id => ({ id, min: after.get(id) }));
  const times = {};
  asking.forEach((r, id) => { times[id] = r.rides && r.time ? r.time : ''; });
  const depOf = ids => computeDepartureTime(direction, ids.map(id => after.get(id)), lead);
  const drivers = driversOf(ctx);
  const rules = (ctx.prefs && ctx.prefs.rules) || [];
  const base = c => current.find(x => x.driverFamilyId === c.driverId || x.driverFamilyId === c.driverFamilyId);

  const finish = (cars, noSolution, kind) => {
    const out = cars.filter(c => (c.girlIds || []).length).map(c => ({ ...(base(c) || {}), driverFamilyId: c.driverFamilyId, girlIds: c.girlIds, reserveFamilyIds: (base(c) && base(c).reserveFamilyIds) || [], departureTime: depOf(c.girlIds) }));
    // who notices: another driver or other passengers or another departure time (the askers themselves are not counted)
    const before = new Map(); current.forEach(c => { const s = sigOf(c, c.departureTime); [c.driverFamilyId, ...c.girlIds].forEach(id => before.set(id, (before.get(id) || []).concat(s))); });
    const afterSig = new Map(); out.forEach(c => { const s = sigOf(c, c.departureTime); [c.driverFamilyId, ...c.girlIds].forEach(id => afterSig.set(id, (afterSig.get(id) || []).concat(s))); });
    const changed = [];
    new Set([...before.keys(), ...afterSig.keys()]).forEach(id => {
      if (asking.has(id)) return;
      if (JSON.stringify((before.get(id) || []).sort()) !== JSON.stringify((afterSig.get(id) || []).sort())) changed.push(id);
    });
    const reasons = [];
    const outNames = [...asking].filter(([, r]) => !(r.rides && r.time)).map(([id]) => id);
    if (outNames.length) reasons.push({ key: 'out', params: { ids: outNames } });
    if (out.length < current.length) reasons.push({ key: 'saves', params: { n: current.length - out.length } });
    else if (out.length > current.length) reasons.push({ key: 'extra', params: {} });
    else reasons.push({ key: 'same', params: {} });
    const free = out.map(c => ({ id: c.driverFamilyId, free: seatsOf(families[c.driverFamilyId]) - c.girlIds.length })).filter(x => x.free > 0).sort((a, b) => b.free - a.free)[0];
    if (free && !noSolution && out.length < current.length) reasons.push({ key: 'free', params: { id: free.id, n: free.free } });
    if (kind === 'gedoe') reasons.push({ key: 'keep', params: {} });
    if (noSolution) reasons.push({ key: 'noSolution', params: {} });
    return { cars: out, times, carsAfter: out.length, familiesChanged: changed, noSolution, reasons };
  };

  // Zuinigst: the planning engine
  const plan = planShift({
    riders, drivers: [...drivers.values()], direction, gapLimitMinutes: gap,
    togetherRules: rules.filter(r => r.type === 'together'), preferRules: rules.filter(r => r.type === 'prefer'), ownCarRules: rules.filter(r => r.type === 'ownCar'),
    prefWindowMinutes: ctx.settings && ctx.settings.prefWindowMinutes != null ? ctx.settings.prefWindowMinutes : 30,
    parentPrefWindowMinutes: ctx.settings && ctx.settings.parentPrefWindowMinutes != null ? ctx.settings.parentPrefWindowMinutes : 60,
  });
  const zuinig = finish(plan.cars.map(c => ({ driverFamilyId: c.driverId, girlIds: c.girlIds })), plan.partial || plan.unplaced.length > 0, 'zuinig');

  // Minste gedoe: keep the cars, move only who has to
  const cars = current.map(c => ({ driverFamilyId: c.driverFamilyId, girlIds: c.girlIds.filter(id => after.get(id) != null) }));
  const fits = (c, id) => {
    const f = families[c.driverFamilyId]; if (!f || c.girlIds.length >= seatsOf(f)) return false;
    const mins = c.girlIds.map(g => after.get(g)).concat(after.get(id));
    return Math.max(...mins) - Math.min(...mins) <= gap;
  };
  const pool = [];
  cars.forEach(c => {   // a girl whose new time no longer fits her car leaves it
    const keep = [];
    c.girlIds.forEach(id => { const mins = keep.map(g => after.get(g)).concat(after.get(id)); (Math.max(...mins) - Math.min(...mins) <= gap ? keep : pool).push(id); });
    c.girlIds = keep;
  });
  riders.forEach(r => { if (!cars.some(c => c.girlIds.includes(r.id)) && !pool.includes(r.id)) pool.push(r.id); });
  let stuck = false;
  pool.sort((a, b) => after.get(a) - after.get(b)).forEach(id => {
    const pick = cars.filter(c => fits(c, id)).sort((a, b) => Math.abs(after.get(a.girlIds[0] || id) - after.get(id)) - Math.abs(after.get(b.girlIds[0] || id) - after.get(id)))[0];
    if (pick) { pick.girlIds.push(id); return; }
    const used = new Set(cars.filter(c => c.girlIds.length).map(c => c.driverFamilyId));
    const next = [...drivers.values()].filter(d => !used.has(d.id) && d.seats > 0).sort((a, b) => (b.standard ? 1 : 0) - (a.standard ? 1 : 0) || a.rank - b.rank || String(a.id).localeCompare(String(b.id)))[0];
    if (next) { const empty = cars.find(c => c.driverFamilyId === next.id); if (empty) empty.girlIds.push(id); else cars.push({ driverFamilyId: next.id, girlIds: [id] }); } else stuck = true;
  });
  const gedoe = finish(cars, stuck, 'gedoe');
  return { carsBefore: current.filter(c => c.girlIds.length).length, variants: { zuinig, gedoe } };
}

// ---------- the advice with the cars as they are (the flow of the day coordinator) ----------
// PRINCIPLE (owner, 2026-10-31): parents drive out of necessity, not for fun. The daughters want to play football; their parents sacrifice
// their time so the daughters get there. Longer waiting for a daughter is acceptable, as long as she is on time; without carpooling the
// daughters would need public transport: far more travel time and money. So fewer cars come FIRST, even when girls wait longer.
// Nobody becomes a driver; the existing drivers are used, and a car may end up empty (that driver does not drive). From all valid divisions
// of the girls over those cars it picks
//   1  the fewest cars (parents who have to drive), within seats and the time spread of a car,
//   2  then the least total waiting (heen: a girl arrives earlier than she needs to; terug: a girl waits for the last one),
//   3  then the fewest drivers who did not ask and still notice it (their car gets other girls, another departure time, or stops),
//   4  then the fewest broken "samen reizen" rules,
//   5  then the fewest girls who change car.
// "best" is that division; "alt" is the best of the divisions with a WORSE (cars, waiting) than best (the second best, not a copy of
// best with two girls swapped). Hard rules: seats, the time spread of a car (gapThresholdHours), "eigen ouder rijdt mee" (terug).
// When no division of the existing cars is valid, `fallback` is the normal advice
// (buildAdvice 'zuinig'), which may need a new car or another driver: the screen then says it does not fit and the day coordinator decides.
// Same ctx as buildAdvice. Result: { carsBefore, best, alt, fallback, waitNow }
//   Option: { cars: [{ ...car, driverFamilyId, girlIds, departureTime }], times, waitMinutes, extraWait (waiting that the requests add to
//             what the cars have now), waitOf: { familyId: minutes }, moved: [familyId], familiesChanged: [familyId] (drivers, not the askers, whose car or departure time changes), carsAfter }
const MAX_NODES = 400000;

export function buildKeepAdvice(ctx) {
  const { direction, families } = ctx;
  const heen = direction !== 'terug';
  const lead = (ctx.settings && ctx.settings.travelLeadMinutes) || 60;
  const gap = ((ctx.settings && ctx.settings.gapThresholdHours) || 3) * 60;
  const asking = new Map((ctx.requests || []).map(r => [r.familyId, r]));
  const rules = (ctx.prefs && ctx.prefs.rules) || [];
  const together = rules.filter(r => r.type === 'together');
  const own = ownCarIds(rules, direction);
  const current = (ctx.cars || []).map(c => ({ ...c, girlIds: [...(c.girlIds || [])] }));
  const timeNow = id => timeToMinutes(ctx.timeOf ? ctx.timeOf(id) : stdTime(families[id], ctx.day, direction));
  const girls = [];
  current.forEach(c => c.girlIds.forEach(id => { if (!girls.includes(id)) girls.push(id); }));
  asking.forEach((r, id) => { if (!girls.includes(id)) girls.push(id); });
  const after = new Map();
  girls.forEach(id => { const r = asking.get(id); after.set(id, r ? (r.rides && r.time ? timeToMinutes(r.time) : null) : timeNow(id)); });
  const riders = girls.filter(id => after.get(id) != null).sort((a, b) => (heen ? after.get(a) - after.get(b) : after.get(b) - after.get(a)) || String(a).localeCompare(String(b)));
  const times = {};
  asking.forEach((r, id) => { times[id] = r.rides && r.time ? r.time : ''; });
  const fallbackOf = () => buildAdvice(ctx).variants.zuinig;
  const carsBefore = current.filter(c => c.girlIds.length).length;

  // the existing cars: drivers that drove with at least one girl
  const cand = current.filter(c => c.driverFamilyId && families[c.driverFamilyId] && c.girlIds.length);
  const seats = cand.map(c => seatsOf(families[c.driverFamilyId]));
  const wasIn = new Map(); cand.forEach((c, i) => c.girlIds.forEach(id => wasIn.set(id, i)));
  const waitOfPlan = groups => {   // groups: array (per car) of rider ids
    let total = 0; const waitOf = {};
    groups.forEach(g => {
      if (!g.length) return;
      const ts = g.map(id => after.get(id)), anchor = heen ? Math.min(...ts) : Math.max(...ts);
      g.forEach(id => { const w = Math.abs(after.get(id) - anchor); waitOf[id] = w; total += w; });
    });
    return { total, waitOf };
  };
  const brokenTogether = groups => {
    const carOf = new Map(); groups.forEach((g, i) => g.forEach(id => carOf.set(id, i)));
    let n = 0;
    together.forEach(r => { const present = (r.ids || []).filter(id => carOf.has(id)); if (present.length >= 2 && new Set(present.map(id => carOf.get(id))).size !== 1) n++; });
    return n;
  };
  // waiting of the cars as they run now (everybody on the time they have now, nobody added or removed): what the requests add is measured from it
  const depOld = cand.map(c => computeDepartureTime(direction, c.girlIds.map(timeNow), lead));
  const noticed = groups => cand.reduce((n, c, k) => {   // drivers that did not ask and whose car changes: other girls, or another departure time
    if (asking.has(c.driverFamilyId)) return n;
    const g = groups[k], same = JSON.stringify([...g].sort()) === JSON.stringify([...c.girlIds].sort());
    const dep = g.length ? computeDepartureTime(direction, g.map(id => after.get(id)), lead) : '';
    return n + (same && dep === depOld[k] ? 0 : 1);
  }, 0);
  const waitNow = (() => {
    const g = cand.map(c => c.girlIds.filter(id => timeNow(id) != null));
    let total = 0;
    g.forEach(ids => { if (!ids.length) return; const ts = ids.map(timeNow), anchor = heen ? Math.min(...ts) : Math.max(...ts); ids.forEach(id => { total += Math.abs(timeNow(id) - anchor); }); });
    return total;
  })();

  if (riders.length && !cand.length) return { carsBefore, best: null, alt: null, fallback: fallbackOf(), waitNow };

  // search: riders in the order of the first leaver, so the first girl of a car is its anchor and the waiting grows exactly as girls are added
  const groups = cand.map(() => []), anchors = cand.map(() => null);
  let best = null, alt = null, nodes = 0, capped = false;
  const keyOf = () => groups.map(g => g.join(',')).join('|');
  const BIG = 100000;   // more than any total waiting: the number of cars weighs first, then the waiting
  const lower = (x, y) => x.score !== y.score ? x.score < y.score : x.notice !== y.notice ? x.notice < y.notice : x.broken !== y.broken ? x.broken < y.broken : x.moved !== y.moved ? x.moved < y.moved : x.key < y.key;
  const dfs = (i, total, moved, used) => {
    if (capped) return;
    if (++nodes > MAX_NODES) { capped = true; return; }
    if (alt && used * BIG + total > alt.score) return;
    if (i === riders.length) {
      const entry = { score: used * BIG + total, cars: used, wait: total, notice: noticed(groups), broken: brokenTogether(groups), moved, key: keyOf(), groups: groups.map(g => [...g]) };
      if (!best) { best = entry; return; }
      if (entry.score === best.score) { if (lower(entry, best)) best = entry; return; }
      if (entry.score < best.score) { const old = best; best = entry; if (!alt || lower(old, alt)) alt = old; return; }
      if (!alt || lower(entry, alt)) alt = entry;
      return;
    }
    const id = riders[i], tm = after.get(id);
    const forced = own.has(id) ? cand.findIndex(c => c.driverFamilyId === id) : -1;
    for (let k = 0; k < cand.length; k++) {
      if (forced >= 0 && k !== forced) continue;
      if (groups[k].length >= seats[k]) continue;
      const first = !groups[k].length, anchor = first ? tm : anchors[k];
      if (!first && Math.abs(tm - anchor) > gap) continue;
      const cost = first ? 0 : Math.abs(tm - anchor);
      const mv = wasIn.has(id) && wasIn.get(id) !== k ? 1 : 0;
      groups[k].push(id); if (first) anchors[k] = tm;
      dfs(i + 1, total + cost, moved + mv, used + (first ? 1 : 0));
      groups[k].pop(); if (first) anchors[k] = null;
    }
  };
  if (riders.length) dfs(0, 0, 0, 0);
  else best = { score: 0, cars: 0, wait: 0, notice: 0, broken: 0, moved: 0, key: '', groups: cand.map(() => []) };
  if (!best) return { carsBefore, best: null, alt: null, fallback: fallbackOf(), waitNow };

  const option = e => {
    const out = [];
    e.groups.forEach((ids, k) => {
      if (!ids.length) return;
      const c = cand[k];
      out.push({ ...c, driverFamilyId: c.driverFamilyId, girlIds: ids, reserveFamilyIds: c.reserveFamilyIds || [], departureTime: computeDepartureTime(direction, ids.map(id => after.get(id)), lead) });
    });
    const sig = (c, dep) => (c.driverFamilyId || '') + '|' + [...(c.girlIds || [])].sort().join(',') + '|' + (dep || '');
    const before = new Map(), afterSig = new Map();
    current.forEach(c => { if (c.driverFamilyId && c.girlIds.length) before.set(c.driverFamilyId, [sig(c, c.departureTime)]); });
    out.forEach(c => { if (c.driverFamilyId) afterSig.set(c.driverFamilyId, [sig(c, c.departureTime)]); });
    const changed = [];
    new Set([...before.keys(), ...afterSig.keys()]).forEach(id => {
      if (asking.has(id)) return;
      if (JSON.stringify((before.get(id) || []).sort()) !== JSON.stringify((afterSig.get(id) || []).sort())) changed.push(id);
    });
    const { total, waitOf } = waitOfPlan(e.groups);
    const moved = riders.filter(id => wasIn.has(id) && cand[wasIn.get(id)].driverFamilyId !== (out.find(c => c.girlIds.includes(id)) || {}).driverFamilyId);
    return { cars: out, times, waitMinutes: total, extraWait: Math.max(0, total - waitNow), waitOf, moved, familiesChanged: changed, carsAfter: out.length, broken: e.broken };
  };
  return { carsBefore, best: option(best), alt: alt ? option(alt) : null, fallback: null, waitNow, capped };
}

// What a set of cars (the proposal, possibly changed by hand) means for one shift: the numbers of the screen.
// ctx as buildKeepAdvice; cars: [{ driverFamilyId, girlIds, departureTime }] as they would run. Nothing is saved or planned.
// Result: { waitMinutes, baseWait (what the cars as they are now wait: the part that is not extra), baseOf: { id: minutes }, extraWait, waitOf: { id: minutes }, late: [id], moved: [id], familiesChanged: [id], carsAfter, problems: [{ key, ids|id }] }
//   waiting is measured from the departure time that is set on the car (a time chosen by hand counts): heen she arrives at departure + lead and
//   waits for what is left to her time; terug she waits from her time until the car leaves. A negative number is "late": she is not on time.
export function evaluateCars(ctx, cars) {
  const { direction, families } = ctx;
  const heen = direction !== 'terug';
  const lead = (ctx.settings && ctx.settings.travelLeadMinutes) || 60;
  const gap = ((ctx.settings && ctx.settings.gapThresholdHours) || 3) * 60;
  const asking = new Map((ctx.requests || []).map(r => [r.familyId, r]));
  const current = (ctx.cars || []).map(c => ({ ...c, girlIds: [...(c.girlIds || [])] }));
  const timeNow = id => timeToMinutes(ctx.timeOf ? ctx.timeOf(id) : stdTime(families[id], ctx.day, direction));
  const after = id => { const r = asking.get(id); return r ? (r.rides && r.time ? timeToMinutes(r.time) : null) : timeNow(id); };
  const keepCars = (cars || []).filter(c => (c.girlIds || []).length);
  let total = 0; const waitOf = {}, late = [], problems = [];
  keepCars.forEach(c => {
    const dep = timeToMinutes(c.departureTime) != null ? timeToMinutes(c.departureTime) : timeToMinutes(computeDepartureTime(direction, c.girlIds.map(after), lead));
    const f = families[c.driverFamilyId];
    if (f && c.girlIds.length > seatsOf(f)) problems.push({ key: 'seats', id: c.driverFamilyId });
    const ts = c.girlIds.map(after).filter(v => v != null);
    if (ts.length && Math.max(...ts) - Math.min(...ts) > gap) problems.push({ key: 'gap', id: c.driverFamilyId });
    c.girlIds.forEach(id => {
      const tm = after(id); if (tm == null) return;
      const w = heen ? tm - (dep + lead) : dep - tm;
      waitOf[id] = w; if (w < 0) late.push(id); else total += w;
    });
  });
  const riding = new Set(); keepCars.forEach(c => c.girlIds.forEach(id => riding.add(id)));
  const shouldRide = []; current.forEach(c => c.girlIds.forEach(id => { if (after(id) != null && !shouldRide.includes(id)) shouldRide.push(id); }));
  asking.forEach((r, id) => { if (r.rides && r.time && !shouldRide.includes(id)) shouldRide.push(id); });
  const unplaced = shouldRide.filter(id => !riding.has(id));
  if (unplaced.length) problems.push({ key: 'unplaced', ids: unplaced });
  if (late.length) problems.push({ key: 'late', ids: late });
  const wasIn = new Map(); current.forEach(c => c.girlIds.forEach(id => wasIn.set(id, c.driverFamilyId)));
  const moved = [...riding].filter(id => wasIn.has(id) && wasIn.get(id) !== (keepCars.find(c => c.girlIds.includes(id)) || {}).driverFamilyId);
  const sig = (c, dep) => (c.driverFamilyId || '') + '|' + [...(c.girlIds || [])].sort().join(',') + '|' + (dep || '');
  const before = new Map(), afterSig = new Map();
  current.forEach(c => { if (c.driverFamilyId && c.girlIds.length) before.set(c.driverFamilyId, [sig(c, c.departureTime)]); });
  keepCars.forEach(c => { if (c.driverFamilyId) afterSig.set(c.driverFamilyId, [sig(c, c.departureTime)]); });
  const changed = [];
  new Set([...before.keys(), ...afterSig.keys()]).forEach(id => {
    if (asking.has(id)) return;
    if (JSON.stringify((before.get(id) || []).sort()) !== JSON.stringify((afterSig.get(id) || []).sort())) changed.push(id);
  });
  let base = 0; const baseOf = {};
  current.filter(c => c.girlIds.length).forEach(c => {
    const ids = c.girlIds.filter(id => timeNow(id) != null); if (!ids.length) return;
    const ts = ids.map(timeNow), anchor = heen ? Math.min(...ts) : Math.max(...ts);
    ids.forEach(id => { const w = Math.abs(timeNow(id) - anchor); baseOf[id] = w; base += w; });
  });
  return { waitMinutes: total, baseWait: base, baseOf, extraWait: Math.max(0, total - base), waitOf, late, moved, familiesChanged: changed, carsAfter: keepCars.length, problems };
}
