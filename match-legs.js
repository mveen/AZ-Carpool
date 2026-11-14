// match-legs.js — which leg of a match a car drives: heen (to the match, or to the bus), terug (the pick-up afterwards) or both.
//
// A car of a match carpool (matchCarpools/<slug>.cars[i]) has the optional field `leg`: 'heen', 'terug' or '' / missing.
//   - By bus a car is ONE leg: heen (brings the players to AFC '34) or terug (picks them up there). A car without `leg` counts as heen.
//   - Without the bus a car without `leg` drives both ways (how it always worked); 'heen' and 'terug' are the new, rarer choices
//     (the parents watch the match and take their daughter back, so the return is usually not needed).
// `departureTime` stays THE time of the car, whatever its leg: the departure for heen (and both), the pick-up time for terug.
// Nothing new is needed for old documents: no `leg` means what it meant before.
export const LEGS = ['heen', 'terug'];

// What the car drives right now: 'heen' | 'terug' | 'beide' (`busOn` = the bus is on for this match).
export function legOf(car, busOn) {
  const l = car && car.leg;
  if (l === 'terug' || l === 'heen') return l;
  return busOn ? 'heen' : 'beide';
}

// Does this car drive the given leg ('heen' | 'terug')? A car that drives both counts for each.
export function coversLeg(car, leg, busOn) {
  const l = legOf(car, busOn);
  return l === 'beide' || l === leg;
}

// What is stored for a choice of the form ('beide' is stored as '' so that such a car stays exactly as before).
export function legField(choice) {
  return choice === 'heen' || choice === 'terug' ? choice : '';
}

// The choices the form offers, first = the default.
export function legChoices(busOn) {
  return busOn ? ['heen', 'terug'] : ['beide', 'heen', 'terug'];
}
