// driver-car-data.js — saving the time and place a driver chose for the own car (Afwijkend weekrooster).
// It is the same one-off change as in the car editor (a deviation of this week and shift), so it expires with the week and nothing else is
// stored, except the two marks that "Toch zelf wijzigen" already uses: selfBy/selfAt (who/when, for the log of the day coordinator).
import { t } from './i18n.js';
import { S } from './state.js';
import { showToast } from './ui-common.js';
import { cleanCars, currentDeviationDoc, db, recordLastUpdate, writeDeviation } from './data.js';
import { computeRideDeparture, effectiveCars } from './rides.js';
import { keepOv } from './ov.js';
import { deviationExpiryMs, deviationKey, refreshWeekKey } from './dates.js';
import { myLinkedFamilyId } from './coordinator.js';
import { applyDriverChange, driverCarIndex, resetDriverChange, timeWarning } from './driver-car.js';
import { isTime } from './ritbeurs.js';

const copy = cars => cars.map(c => ({ ...c, girlIds: [...(c.girlIds || [])] }));

// The car this person drives on one shift: { cars, idx, car } or null.
export function myCarOf(day, direction) {
  const me = myLinkedFamilyId();
  const cars = copy(effectiveCars(day, direction));
  const idx = driverCarIndex(cars, me);
  return idx < 0 ? null : { cars, idx, car: cars[idx], me };
}

// change: { time:'HH:MM', locationId?, locationText? } or { reset:true }.
// Result: { ok, warning ('laat'|'vroeg'|null), undo() }.
export async function saveDriverCar(day, direction, change) {
  if (!db) { showToast(t('data.geen_verbinding_met_opslag')); return { ok: false }; }
  const mine = myCarOf(day, direction);
  if (!mine) { showToast(t('driverCar.err.geenAuto')); return { ok: false }; }
  if (!change.reset && !isTime(change.time)) { showToast(t('driverCar.err.tijd')); return { ok: false }; }
  refreshWeekKey();
  const { cars, idx, me } = mine;
  const computed = computeRideDeparture(day, direction, cars[idx].girlIds);
  const prev = currentDeviationDoc(day, direction);
  const prevDoc = prev ? JSON.parse(JSON.stringify(prev)) : { day, direction, weekKey: S.currentWeekKey, expiresAt: deviationExpiryMs(), cars: cleanCars(copy(effectiveCars(day, direction))) };
  cars[idx] = change.reset ? resetDriverChange(cars[idx], computed) : applyDriverChange(cars[idx], me, change);
  try {
    await writeDeviation(day, direction, cars, { ...keepOv(prev, cars), selfBy: me, selfAt: Date.now() });
  } catch (e) { showToast(t('data.opslaan_mislukt') + (e && e.message || e)); return { ok: false }; }
  const undo = async () => {
    try { await db.doc('deviations/' + deviationKey(day, direction)).set(prevDoc); S.lastDeviationEditDay = day; recordLastUpdate('Deviation'); return true; }
    catch (e) { showToast(t('data.mislukt') + (e && e.message || e)); return false; }
  };
  return { ok: true, warning: change.reset ? null : timeWarning(direction, change.time, computed), computed, undo };
}
