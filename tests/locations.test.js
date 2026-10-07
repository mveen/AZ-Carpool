// Run with: node locations.test.js
// Pickup / drop-off places per shift, one-off overrides, map links and fixed venues (US-15, US-21, US-22).
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { carStdId, destinationFor, routeLabel, DEFAULT_PLACES, normalizeLocations, placeFor, isOverride, shiftLabel, geoLink, googleMapsLink, mapLink, fixedVenue } from '../locations.js';

console.log('=== defaults ===');
test('without stored settings there are the 3 places and AFC \'34 as destination', () => {
  const c = normalizeLocations(null);
  assert.deepEqual(c.places.map(p => p.id), ['busstation', 'a4-de-hoek', 'de-parel']);
  assert.equal(c.destination.name, "AFC '34");
  assert.deepEqual(c.defaults, { heen: 'busstation', terug: 'busstation' });
  assert.deepEqual(c.fixedKm, { AFC: null, ATC: null });
});
test('stored names and addresses are used; unknown places are ignored; there are always exactly 3', () => {
  const c = normalizeLocations({ places: [{ id: 'de-parel', name: ' Parel ', address: ' Parelstraat 1, Aalsmeer ' }, { id: 'weird', name: 'X' }] });
  assert.equal(c.places.length, 3);
  assert.deepEqual(c.places.find(p => p.id === 'de-parel'), { id: 'de-parel', name: 'Parel', address: 'Parelstraat 1, Aalsmeer' });
  assert.equal(c.places.find(p => p.id === 'busstation').name, DEFAULT_PLACES[0].name);
});
test('a stored default that is not a place falls back to the first place', () => {
  assert.deepEqual(normalizeLocations({ defaults: { heen: 'nope', terug: 'de-parel' } }).defaults, { heen: 'busstation', terug: 'de-parel' });
});
test('fixed distances accept numbers and Dutch decimals; junk becomes null', () => {
  assert.deepEqual(normalizeLocations({ fixedKm: { AFC: '36,5', ATC: 'x' } }).fixedKm, { AFC: 36.5, ATC: null });
  assert.deepEqual(normalizeLocations({ fixedKm: { AFC: 0, ATC: -3 } }).fixedKm, { AFC: null, ATC: null });
});

console.log('\n=== default and override per ride ===');
const cfg = normalizeLocations({ defaults: { heen: 'busstation', terug: 'de-parel' } });
test('a ride without a choice uses the default of its direction', () => {
  assert.equal(placeFor({}, 'heen', cfg).id, 'busstation');
  assert.equal(placeFor({}, 'terug', cfg).id, 'de-parel');
  assert.equal(placeFor(null, 'terug', cfg).id, 'de-parel');
});
test('a one-off choice on the ride wins over the default', () => {
  assert.equal(placeFor({ locationId: 'a4-de-hoek' }, 'heen', cfg).id, 'a4-de-hoek');
  assert.equal(placeFor({ locationId: 'a4-de-hoek' }, 'terug', cfg).id, 'a4-de-hoek');
});
test('an unknown one-off choice is ignored (default applies)', () => {
  assert.equal(placeFor({ locationId: 'gone' }, 'terug', cfg).id, 'de-parel');
});
test('isOverride is true only for a valid choice that differs from the default', () => {
  assert.equal(isOverride({ locationId: 'a4-de-hoek' }, 'heen', cfg), true);
  assert.equal(isOverride({ locationId: 'busstation' }, 'heen', cfg), false);
  assert.equal(isOverride({}, 'heen', cfg), false);
  assert.equal(isOverride({ locationId: 'gone' }, 'heen', cfg), false);
});
test('the override of one ride does not change another ride', () => {
  const a = { locationId: 'a4-de-hoek' }, b = {};
  assert.equal(placeFor(a, 'heen', cfg).id, 'a4-de-hoek');
  assert.equal(placeFor(b, 'heen', cfg).id, 'busstation');
});

console.log('\n=== standard place and arrival per car ===');
test('a car with its own standard place uses it; another car of the same shift does not', () => {
  const a = { stdLocationId: 'a4-de-hoek' }, b = {};
  assert.equal(placeFor(a, 'heen', cfg, 'Ma').id, 'a4-de-hoek');
  assert.equal(placeFor(b, 'heen', cfg, 'Ma').id, 'busstation');
});
test('an unknown standard place of a car falls back to the shift / default', () => {
  assert.equal(carStdId({ stdLocationId: 'gone' }, cfg, 'Ma', 'heen'), 'busstation');
  assert.equal(carStdId({ stdLocationId: '' }, cfg, 'Ma', 'terug'), 'de-parel');
});
test('a one-off choice wins over the car\'s own standard; it is only "changed" when it differs from that standard', () => {
  const car = { stdLocationId: 'a4-de-hoek', locationId: 'busstation' };
  assert.equal(placeFor(car, 'heen', cfg, 'Ma').id, 'busstation');
  assert.equal(isOverride(car, 'heen', cfg, 'Ma'), true);
  assert.equal(isOverride({ stdLocationId: 'a4-de-hoek', locationId: 'a4-de-hoek' }, 'heen', cfg, 'Ma'), false);
  assert.equal(isOverride({ stdLocationId: 'a4-de-hoek' }, 'heen', cfg, 'Ma'), false);
});
test('arrival: the car\'s own standard (ATC) applies; a one-off choice wins; empty means AFC', () => {
  assert.equal(destinationFor({ stdDestination: 'ATC' }, cfg).key, 'ATC');
  assert.equal(destinationFor({ stdDestination: '' }, cfg).key, 'AFC');
  assert.equal(destinationFor({ stdDestination: 'ATC', destination: 'AFC' }, cfg).key, 'AFC');
  assert.equal(destinationFor({ destination: 'ATC' }, cfg).key, 'ATC');
  assert.equal(destinationFor({}, cfg).key, 'AFC');
});

console.log('\n=== shift label ===');
test('heen: departure, pickup place → destination', () => {
  assert.equal(shiftLabel({ departureTime: '07:05' }, 'heen', cfg), "07:05 Busstation → AFC '34");
});
test('terug: departure, destination → drop-off place', () => {
  assert.equal(shiftLabel({ departureTime: '17:30' }, 'terug', cfg), "17:30 AFC '34 → De Parel");
});
test('without a departure time the route is shown alone', () => {
  assert.equal(shiftLabel({}, 'heen', cfg), "Busstation → AFC '34");
});
test('the label follows a one-off choice', () => {
  assert.equal(shiftLabel({ departureTime: '07:05', locationId: 'a4-de-hoek' }, 'heen', cfg), "07:05 A4-De Hoek → AFC '34");
});

console.log('\n=== map links ===');
test('geoLink is a generic geo: link, not a Google Maps link', () => {
  const l = geoLink('Sportpark Hoorn, Hoorn');
  assert.equal(l, 'geo:0,0?q=Sportpark%20Hoorn%2C%20Hoorn');
  assert.ok(!/google/i.test(l));
});
test('geoLink of nothing is empty', () => { assert.equal(geoLink('  '), ''); assert.equal(geoLink(undefined), ''); });
test('googleMapsLink is a Google Maps search link, empty for nothing', () => {
  assert.equal(googleMapsLink('Sportpark Hoorn, Hoorn'), 'https://www.google.com/maps/search/?api=1&query=Sportpark%20Hoorn%2C%20Hoorn');
  assert.equal(googleMapsLink(' '), '');
});
test('mapLink: geo: on Android, Google Maps everywhere else (iPhone, laptop)', () => {
  assert.match(mapLink('De Parel', true), /^geo:0,0\?q=De%20Parel$/);
  assert.match(mapLink('De Parel', false), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=De%20Parel$/);
  assert.equal(mapLink('', true), ''); assert.equal(mapLink('', false), '');
});

console.log('\n=== fixed venues ===');
test('AFC and ATC are recognised in a location text, other places are not', () => {
  assert.equal(fixedVenue("AFC'34, Alkmaar"), 'AFC');
  assert.equal(fixedVenue("Sportpark AFC '34"), 'AFC');
  assert.equal(fixedVenue('ATC Alkmaar'), 'ATC');
  assert.equal(fixedVenue('Sportpark Hoorn'), null);
  assert.equal(fixedVenue('Trainingscomplex'), null);
  assert.equal(fixedVenue(''), null);
});


console.log('\n=== arrival place of one ride (Wijzigen, Aankomst) ===');
test('AFC \'34 (the destination from Beheer) is the default; ATC only when the car says so', () => {
  const cfg = normalizeLocations(null);
  assert.deepEqual(destinationFor({}, cfg), { key: 'AFC', name: "AFC '34", city: 'Alkmaar' });
  assert.deepEqual(destinationFor({ destination: 'ATC' }, cfg), { key: 'ATC', name: 'ATC', city: 'Wijdewormer' });
  assert.equal(destinationFor({ destination: 'rubbish' }, cfg).key, 'AFC');
  assert.equal(destinationFor({}, normalizeLocations({ destination: { name: 'Stadion' } })).name, 'Stadion');
});
test('the route and the shift label follow the arrival place, heen and terug', () => {
  const cfg = normalizeLocations(null);
  assert.equal(routeLabel({ destination: 'ATC' }, 'heen', cfg), 'Busstation → ATC');
  assert.equal(routeLabel({ destination: 'ATC' }, 'terug', cfg), 'ATC → Busstation');
  assert.equal(shiftLabel({ departureTime: '07:05', destination: 'ATC' }, 'heen', cfg), '07:05 Busstation → ATC');
});
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
