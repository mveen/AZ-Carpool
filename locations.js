// locations.js — pickup / drop-off places per shift (US-15), fixed distances (US-21) and generic map links
// (US-15, US-22). PURE: settings come in as plain data, nothing reads the browser or the database.
//
// The coordinator stores one document, settings/locations:
//   { places:[{id,name,address}], destination:{name,address}, defaults:{heen,terug}, fixedKm:{AFC,ATC} }
// A ride (car) may carry `locationId` = a one-off choice from Wijzigen. Without it the default of the direction applies.

export const DEFAULT_PLACES = [
  { id: 'busstation', name: 'Busstation', address: '' },
  { id: 'a4-de-hoek', name: 'A4-De Hoek', address: '' },
  { id: 'de-parel', name: 'De Parel', address: '' },
];
export const DEFAULT_DESTINATION = { name: "AFC '34", address: '' };

const str = v => (typeof v === 'string' ? v.trim() : '');

// Turns whatever is stored (or nothing) into a complete, safe settings object.
export function normalizeLocations(doc) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const stored = Array.isArray(d.places) ? d.places.filter(p => p && str(p.id)) : [];
  const places = DEFAULT_PLACES.map(def => {
    const s = stored.find(p => p.id === def.id) || {};
    return { id: def.id, name: str(s.name) || def.name, address: str(s.address) };
  });
  const dest = d.destination || {};
  const destination = { name: str(dest.name) || DEFAULT_DESTINATION.name, address: str(dest.address) };
  const ids = places.map(p => p.id);
  const defaults = {};
  ['heen', 'terug'].forEach(dir => { const v = d.defaults && d.defaults[dir]; defaults[dir] = ids.includes(v) ? v : ids[0]; });
  const km = v => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };
  const fixedKm = { AFC: km(d.fixedKm && d.fixedKm.AFC), ATC: km(d.fixedKm && d.fixedKm.ATC) };
  return { places, destination, defaults, fixedKm };
}

// The place that applies to one ride: the one-off choice when it is valid, otherwise the direction default.
export function placeFor(car, direction, cfg) {
  const id = car && cfg.places.some(p => p.id === car.locationId) ? car.locationId : cfg.defaults[direction];
  return cfg.places.find(p => p.id === id) || cfg.places[0];
}
export function isOverride(car, direction, cfg) {
  return !!(car && cfg.places.some(p => p.id === car.locationId) && car.locationId !== cfg.defaults[direction]);
}

// "07:05 Busstation → AFC '34" (heen) / "17:30 AFC '34 → Busstation" (terug).
export function shiftLabel(car, direction, cfg) {
  const place = placeFor(car, direction, cfg).name, dest = cfg.destination.name;
  const route = direction === 'heen' ? `${place} → ${dest}` : `${dest} → ${place}`;
  return car && car.departureTime ? `${car.departureTime} ${route}` : route;
}

// Map links. Android: a generic geo: URI (opens the phone's own maps app, route starts at the current position).
// Everything else (iPhone, laptop browser): a Google Maps search link, because geo: does not open there.
// '' when there is nothing to look for.
export function geoLink(query) {
  const q = str(query);
  return q ? 'geo:0,0?q=' + encodeURIComponent(q) : '';
}
export function googleMapsLink(query) {
  const q = str(query);
  return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : '';
}
export function mapLink(query, isAndroid) { return isAndroid ? geoLink(query) : googleMapsLink(query); }

// US-21: matches at AFC or ATC use a fixed distance from settings, not a calculated one.
export function fixedVenue(location) {
  const l = str(location);
  if (/\bATC\b/i.test(l)) return 'ATC';
  if (/\bAFC\b/i.test(l)) return 'AFC';
  return null;
}
