// ov.js — "Terug met OV" (US-06): a parent marks that the daughter goes home by public transport on one day.
// PURE. The mark lives on that day's terug deviation as ovGirlIds (+ ovFrom: which driver's car she left),
// so it expires with the week like every other change. A girl marked OV is taken out of her terug car.

export function ovIds(dev){ return dev && Array.isArray(dev.ovGirlIds) ? dev.ovGirlIds : []; }
export function isOv(dev, girlId){ return ovIds(dev).includes(girlId); }

// state: { cars, ovGirlIds, ovFrom }. departureFor(girlIds) -> the departure time of a car with those girls.
// on=true : take her out of her car (remembering whose car) and mark her.
// on=false: unmark her and put her back in the car of the same driver, when that car still exists.
export function applyOv(state, girlId, on, departureFor){
  const ovFrom = { ...(state.ovFrom||{}) };
  let ovGirlIds = [...(state.ovGirlIds||[])];
  let cars = (state.cars||[]).map(c=>({ ...c, girlIds:[...(c.girlIds||[])] }));
  if(on){
    const from = cars.find(c=>c.girlIds.includes(girlId));
    ovFrom[girlId] = from ? (from.driverFamilyId||null) : null;
    if(from){ from.girlIds = from.girlIds.filter(id=>id!==girlId); from.departureTime = departureFor(from.girlIds); }
    if(!ovGirlIds.includes(girlId)) ovGirlIds.push(girlId);
  } else {
    const driver = ovFrom[girlId];
    delete ovFrom[girlId];
    ovGirlIds = ovGirlIds.filter(id=>id!==girlId);
    const back = driver ? cars.find(c=>c.driverFamilyId===driver && !c.girlIds.includes(girlId)) : null;
    if(back){ back.girlIds.push(girlId); back.departureTime = departureFor(back.girlIds); }
  }
  return { cars, ovGirlIds, ovFrom };
}

// After any other edit of the terug cars: a girl who is in a car again is no longer "OV".
// Returns only the fields that must be stored (nothing at all when nobody is marked).
export function keepOv(dev, cars){
  const inCar = new Set((cars||[]).flatMap(c=>c.girlIds||[]));
  const ovGirlIds = ovIds(dev).filter(id=>!inCar.has(id));
  if(!ovGirlIds.length) return {};
  const ovFrom = {}; ovGirlIds.forEach(id=>{ ovFrom[id] = (dev.ovFrom && dev.ovFrom[id]) || null; });
  return { ovGirlIds, ovFrom };
}
