// weekrooster-impact.js — "Wie merkt dit": what a request would change for the other families IF the day coordinator agrees.
// Pure: no DOM, no database. It plans the shift twice with the planning engine (planning.js): with everybody's fixed times, and with the
// requested times, and compares when each family's car leaves. It is an expectation only: the day coordinator decides.
import { planShift, computeDepartureTime, timeToMinutes } from './planning.js';

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
