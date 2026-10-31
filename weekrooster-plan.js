// weekrooster-plan.js — the day coordinator's changes to the proposal, as pure functions on a list of cars (nothing is saved here).
// The Advies flow (ui-weekrooster-advice.js) keeps the changed cars in S.wrAdvice.edits and gives them to acceptDay when the day coordinator
// presses "Doorvoeren". A car is { driverFamilyId, girlIds, departureTime, depManual?, locationId?, locationText?, destination?, ... }.
import { computeDepartureTime, timeToMinutes } from './planning.js';

// The time a girl has on this shift AFTER the requests: the asked time, '' when she stays home, else the time she has now.
export function timeAfter(ctx, id) {
  const r = (ctx.requests || []).find(x => x.familyId === id);
  if (r) return r.rides && r.time ? r.time : '';
  return (ctx.timeOf && ctx.timeOf(id)) || '';
}

const leadOf = ctx => (ctx.settings && ctx.settings.travelLeadMinutes) || 60;
// The departure time of a car from the times of its girls (heen: earliest arrival minus the travel time; terug: the latest ready time).
export function departureFor(ctx, girlIds) {
  return computeDepartureTime(ctx.direction, girlIds.map(id => timeToMinutes(timeAfter(ctx, id))), leadOf(ctx));
}
const refresh = (ctx, c) => (c.depManual ? c : { ...c, departureTime: departureFor(ctx, c.girlIds) });

// Put a girl in the car of this driver (out of the car she is in now). A car that is left without girls disappears: its driver does not drive.
// The departure time of the two cars is calculated again, unless it was chosen by hand. The driver must have a car in the list.
export function withGirlIn(ctx, cars, girlId, driverFamilyId) {
  if (!cars.some(c => c.driverFamilyId === driverFamilyId)) return cars;
  return cars
    .map(c => {
      const has = c.girlIds.includes(girlId), into = c.driverFamilyId === driverFamilyId;
      if (has === into) return c;
      return refresh(ctx, { ...c, girlIds: into ? [...c.girlIds, girlId] : c.girlIds.filter(x => x !== girlId) });
    })
    .filter(c => c.girlIds.length);
}

// "Vertrek berekend / zelf kiezen": a time chosen by hand stays; '' puts it back to calculated.
export function withDeparture(ctx, cars, driverFamilyId, time) {
  return cars.map(c => {
    if (c.driverFamilyId !== driverFamilyId) return c;
    if (time) return { ...c, departureTime: time, depManual: true };
    const { depManual, ...rest } = c;
    return refresh(ctx, rest);
  });
}

// Another driver for the car (the girls stay). Not the driver of another car of this shift.
export function withDriver(cars, driverFamilyId, newDriverId) {
  if (!newDriverId || cars.some(c => c.driverFamilyId === newDriverId)) return cars;
  return cars.map(c => (c.driverFamilyId === driverFamilyId ? { ...c, driverFamilyId: newDriverId } : c));
}

// The pickup / drop-off place: { locationId } (a place from Beheer), { locationText } (free text) or {} (the standard place).
export function withPlace(cars, driverFamilyId, place) {
  return cars.map(c => {
    if (c.driverFamilyId !== driverFamilyId) return c;
    const { locationId, locationText, ...rest } = c;
    return { ...rest, ...(place && place.locationId ? { locationId: place.locationId } : {}), ...(place && place.locationText ? { locationText: place.locationText } : {}) };
  });
}

// The arrival place (AFC '34 or ATC); the standard one is stored as nothing.
export function withDestination(cars, driverFamilyId, dest) {
  return cars.map(c => {
    if (c.driverFamilyId !== driverFamilyId) return c;
    const { destination, ...rest } = c;
    return dest && dest !== (c.stdDestination === 'ATC' ? 'ATC' : 'AFC') ? { ...rest, destination: dest } : rest;
  });
}

// A car for a driver who does not drive on this shift yet (the day coordinator decides, nobody is added automatically).
export function withNewCar(cars, driverFamilyId) {
  if (!driverFamilyId || cars.some(c => c.driverFamilyId === driverFamilyId)) return cars;
  return [...cars, { driverFamilyId, girlIds: [], departureTime: '', reserveFamilyIds: [] }];
}

// Girls of this shift that ride (after the requests) and sit in no car of the list.
export function unplacedIn(ctx, cars) {
  const placed = new Set(); cars.forEach(c => c.girlIds.forEach(id => placed.add(id)));
  const all = []; (ctx.cars || []).forEach(c => (c.girlIds || []).forEach(id => { if (!all.includes(id)) all.push(id); }));
  (ctx.requests || []).forEach(r => { if (!all.includes(r.familyId)) all.push(r.familyId); });
  return all.filter(id => timeAfter(ctx, id) && !placed.has(id));
}

// A girl out of her car (she does not ride this shift): the car's departure is calculated again; a car left without girls disappears.
export function withoutGirl(ctx, cars, girlId) {
  return cars
    .map(c => (c.girlIds.includes(girlId) ? refresh(ctx, { ...c, girlIds: c.girlIds.filter(x => x !== girlId) }) : c))
    .filter(c => c.girlIds.length);
}

// A car list without the cars that have nobody in them (they are not stored).
export const withoutEmptyCars = cars => cars.filter(c => c.girlIds.length);
