// flex.js — Flex families (US-05): they ride only on days they sign up for, never in the auto-planned rooster.
// PURE: cars go in, a new list of cars comes out. Nothing reads the browser or the database.
// A car is { driverFamilyId, girlIds, departureTime, reserveFamilyIds }. Signing up writes a deviation (Wijzigen).
import { timeToMinutes, minutesToTime } from './planning.js';

// Departure time of a car after a Flex rider with `time` joins.
// heen: `time` is the arrival time in Alkmaar, so leave `lead` minutes earlier; the earliest need counts.
// terug: `time` is when she is ready; the car leaves at the latest ready time.
export function flexDeparture(direction, existingDep, time, lead){
  const m = timeToMinutes(time);
  if(m==null) return existingDep||'';
  const cand = direction==='heen' ? m-(lead||60) : m;
  const ex = timeToMinutes(existingDep);
  if(ex==null) return minutesToTime(cand);
  return minutesToTime(direction==='heen' ? Math.min(ex,cand) : Math.max(ex,cand));
}

// The family is in one of the cars, as passenger or as driver.
export function flexIsSignedUp(cars, familyId){
  return (cars||[]).some(c=>(c.girlIds||[]).includes(familyId) || c.driverFamilyId===familyId);
}

// Cars a Flex passenger can join: they have a driver and a free passenger seat.
// seatsOf(familyId) = passenger seats of that family's car (total capacity minus the driver).
export function carsWithFreeSeat(cars, seatsOf){
  return (cars||[]).map((c,i)=>({c,i})).filter(({c})=>c.driverFamilyId && (c.girlIds||[]).length < seatsOf(c.driverFamilyId)).map(({i})=>i);
}

// Passenger: add the family to car `carIdx`.
export function flexJoinCar(cars, carIdx, familyId, time, direction, lead){
  return cars.map((c,i)=> i!==carIdx ? {...c} : {
    ...c,
    girlIds: (c.girlIds||[]).includes(familyId)? [...c.girlIds] : [...(c.girlIds||[]), familyId],
    departureTime: flexDeparture(direction, c.departureTime, time, lead),
  });
}

// Driver: a new car with the Flex player driving (and riding in) it herself.
export function flexDriveOwn(cars, familyId, time, direction, lead){
  return [...cars.map(c=>({...c})), { driverFamilyId:familyId, girlIds:[familyId], reserveFamilyIds:[], departureTime: flexDeparture(direction, '', time, lead) }];
}

// Sign off: out of every car. Her own car disappears when nobody else rides in it,
// otherwise it stays without a driver so the day coordinator can see the gap.
export function flexSignOff(cars, familyId){
  const out = [];
  cars.forEach(c=>{
    const girlIds = (c.girlIds||[]).filter(g=>g!==familyId);
    if(c.driverFamilyId===familyId){
      if(!girlIds.length) return;
      out.push({ ...c, girlIds, driverFamilyId:null });
    } else out.push({ ...c, girlIds });
  });
  return out;
}
