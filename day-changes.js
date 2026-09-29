// day-changes.js — what changed on one day+direction compared with the standard rooster (US-03).
// PURE: cars come in as plain arrays, nothing reads the browser or the database.
// A car is { driverFamilyId, girlIds, departureTime }. The result is a list of small change items:
//   { type:'out',    girlId }                          girl no longer rides
//   { type:'moved',  girlId, driverId }                girl rides with another driver
//   { type:'extra',  girlId, driverId }                girl rides although she has no standard ride (e.g. Flex)
//   { type:'driver', driverId, fromDriverId }          another driver takes over a car
//   { type:'newcar', driverId, girlIds }               a car that is not in the standard rooster
//   { type:'time',   driverId, time }                  same car, other departure time
export function dayChanges(baseCars, effCars){
  const base = (baseCars||[]).filter(c=>(c.girlIds||[]).length);
  const eff = (effCars||[]).filter(c=>(c.girlIds||[]).length);
  const items = [];
  const baseOfGirl = new Map();
  base.forEach((c,i)=>c.girlIds.forEach(g=>baseOfGirl.set(g,i)));
  const effOfGirl = new Map();
  eff.forEach((c,i)=>c.girlIds.forEach(g=>effOfGirl.set(g,i)));

  // Match every effective car with the standard car that shares most girls (each standard car once).
  const taken = new Set();
  const matchOf = eff.map((c,ei)=>{
    let best = -1, bestOverlap = 0;
    base.forEach((b,bi)=>{
      if(taken.has(bi)) return;
      const overlap = c.girlIds.filter(g=>b.girlIds.includes(g)).length;
      if(overlap>bestOverlap){ best=bi; bestOverlap=overlap; }
    });
    if(best>=0) taken.add(best);
    return best;
  });

  eff.forEach((c,ei)=>{
    const bi = matchOf[ei];
    if(bi<0){ items.push({ type:'newcar', driverId:c.driverFamilyId||null, girlIds:[...c.girlIds] }); return; }
    const b = base[bi];
    if((c.driverFamilyId||null)!==(b.driverFamilyId||null)){
      items.push({ type:'driver', driverId:c.driverFamilyId||null, fromDriverId:b.driverFamilyId||null });
    } else if((c.departureTime||'')!==(b.departureTime||'') && c.departureTime){
      items.push({ type:'time', driverId:c.driverFamilyId||null, time:c.departureTime });
    }
    c.girlIds.forEach(g=>{
      if(!baseOfGirl.has(g)){ items.push({ type:'extra', girlId:g, driverId:c.driverFamilyId||null }); }
      else if(baseOfGirl.get(g)!==bi){ items.push({ type:'moved', girlId:g, driverId:c.driverFamilyId||null }); }
    });
  });
  base.forEach(b=>b.girlIds.forEach(g=>{ if(!effOfGirl.has(g)) items.push({ type:'out', girlId:g }); }));
  return items;
}
