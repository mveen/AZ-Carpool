// driver-car.js — the driver changes the time and the place of the OWN car (Afwijkend weekrooster).
// PURE: cars go in, new cars come out. Nothing reads the browser or the database.
// A car is { driverFamilyId, girlIds, departureTime, locationId?, locationText?, ... }. Nothing new is stored: the choice is the same one-off
// change (departureTime, locationId / locationText) that the car editor makes.
import { timeToMinutes } from './planning.js';

// The car this family drives (with passengers) on one shift; -1 when none.
export function driverCarIndex(cars, familyId) {
  if (!familyId) return -1;
  return (cars || []).findIndex(c => c && c.driverFamilyId === familyId && (c.girlIds || []).length > 0);
}
export const mayAdjustCar = (car, familyId) => !!(car && familyId && car.driverFamilyId === familyId);

// The car after the driver chose a time and a place. place: { locationId?, locationText? } (both empty = the standard place).
export function applyDriverChange(car, familyId, { time, locationId, locationText }) {
  if (!mayAdjustCar(car, familyId)) return null;
  const next = { ...car, girlIds: [...(car.girlIds || [])], departureTime: time };
  if (locationText) { next.locationText = locationText; delete next.locationId; }
  else if (locationId) { next.locationId = locationId; delete next.locationText; }
  else { delete next.locationId; delete next.locationText; }
  return next;
}
// Back to automatic: the calculated time again and the standard place again.
export function resetDriverChange(car, computedTime) {
  const next = { ...car, girlIds: [...(car.girlIds || [])], departureTime: computedTime || car.departureTime || '' };
  delete next.locationId; delete next.locationText;
  return next;
}
// Does this car differ from what the app calculates (another time, or a place of its own)? Then "Weer automatisch berekenen" makes sense.
export const differsFromAuto = (car, computedTime) => !!(car && ((computedTime && car.departureTime && car.departureTime !== computedTime) || car.locationId || car.locationText));

// A soft warning (never blocks): heen: leaving later than calculated can make a girl late; terug: leaving earlier than calculated leaves a girl behind.
// Returns 'laat' | 'vroeg' | null.
export function timeWarning(direction, chosen, computed) {
  const a = timeToMinutes(chosen), b = timeToMinutes(computed);
  if (a == null || b == null || a === b) return null;
  if (direction === 'heen') return a > b ? 'laat' : null;
  return a < b ? 'vroeg' : null;
}

// Mijn week: did the departure time of this car change compared with the standard rooster? { from, to } or null.
// The standard car is the one of the same driver, otherwise the one that shares most girls with this car.
export function timeChangeOf(baseCars, car) {
  if (!car || !car.departureTime) return null;
  const girls = car.girlIds || [];
  const overlap = b => (b.girlIds || []).filter(g => girls.includes(g)).length;
  const base = (baseCars || []).filter(b => (b.girlIds || []).length)
    .map(b => ({ b, score: (b.driverFamilyId && b.driverFamilyId === car.driverFamilyId ? 1000 : 0) + overlap(b) }))
    .filter(x => x.score > 0).sort((x, y) => y.score - x.score)[0];
  if (!base || !base.b.departureTime || base.b.departureTime === car.departureTime) return null;
  return { from: base.b.departureTime, to: car.departureTime };
}
