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
