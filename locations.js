// locations.js — pickup / drop-off places per shift (US-15), fixed distances (US-21) and generic map links
// (US-15, US-22). PURE: settings come in as plain data, nothing reads the browser or the database.
//
// The coordinator stores one document, settings/locations:
//   { places:[{id,name,address}] (1 to 6), destination:{name,address}, defaults:{heen,terug}, shifts:{'Ma_heen':placeId}, fixedKm:{AFC,ATC} }
// An address is free text: a logical address, GPS in decimal degrees, or GPS in degrees-minutes-seconds.
// Which place applies to a ride, first match wins:
//   1. car.locationText  one-off free input from Wijzigen (an address or a point of interest; never becomes a place)
//   2. car.locationId    one-off choice from Wijzigen
//   3. shifts[day_dir]   the standard place of that shift, set by clicking the place in the standaardrooster
//   4. defaults[dir]     the standard place for heen / terug from Beheer
export const MAX_PLACES = 6;
export const FREE_TEXT_MAX = 120;

export const BUSSTATION_ID = 'busstation';
export const DEFAULT_PLACES = [
  { id: 'busstation', name: 'Busstation', address: '' },
  { id: 'a4-de-hoek', name: 'A4-De Hoek', address: '' },
  { id: 'de-parel', name: 'De Parel', address: '' },
];
export const DEFAULT_DESTINATION = { name: "AFC '34", address: '' };

const str = v => (typeof v === 'string' ? v.trim() : '');

// Turns whatever is stored (or nothing) into a complete, safe settings object.
// Nothing stored: the three standard places. Stored places are kept (at most 6, unique ids, names filled in);
// Busstation always exists because it is the start of the distance calculation.
export function normalizeLocations(doc) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const stored = Array.isArray(d.places) ? d.places.filter(p => p && str(p.id)) : [];
  const seen = new Set();
  let places = [];
  if (stored.length) {
    stored.forEach(p => {
      const id = str(p.id);
      if (seen.has(id) || places.length >= MAX_PLACES) return;
      seen.add(id);
      const def = DEFAULT_PLACES.find(x => x.id === id);
      places.push({ id, name: str(p.name) || (def ? def.name : 'Plek ' + (places.length + 1)), address: str(p.address) });
    });
    if (!seen.has(BUSSTATION_ID)) places = [{ ...DEFAULT_PLACES[0] }, ...places].slice(0, MAX_PLACES);
  } else {
    places = DEFAULT_PLACES.map(def => ({ ...def }));
  }
  const dest = d.destination || {};
  const destination = { name: str(dest.name) || DEFAULT_DESTINATION.name, address: str(dest.address) };
  const ids = places.map(p => p.id);
  const defaults = {};
  ['heen', 'terug'].forEach(dir => { const v = d.defaults && d.defaults[dir]; defaults[dir] = ids.includes(v) ? v : ids[0]; });
  const shifts = {};
  if (d.shifts && typeof d.shifts === 'object') {
    Object.entries(d.shifts).forEach(([k, v]) => { if (/^(Ma|Di|Wo|Do|Vr)_(heen|terug)$/.test(k) && ids.includes(v)) shifts[k] = v; });
  }
  const km = v => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };
  const fixedKm = { AFC: km(d.fixedKm && d.fixedKm.AFC), ATC: km(d.fixedKm && d.fixedKm.ATC) };
  return { places, destination, defaults, shifts, fixedKm };
}

// A new place with a fresh id (used by Beheer's "Plek toevoegen"). Names come from the caller so texts stay in texts-nl.js.
export function newPlace(existing, name) {
  let id;
  do { id = 'p-' + Math.random().toString(36).slice(2, 8); } while (existing.some(p => p.id === id));
  return { id, name: str(name), address: '' };
}

// The standard place id of one shift: its own choice from the standaardrooster, otherwise the default of the direction.
export function shiftDefaultId(cfg, day, direction) {
  const v = day && cfg.shifts && cfg.shifts[day + '_' + direction];
  return cfg.places.some(p => p.id === v) ? v : cfg.defaults[direction];
}

// One-off free input of a ride ('' when there is none).
export function freeText(car) { return car ? str(car.locationText).slice(0, FREE_TEXT_MAX) : ''; }

// The place that applies to one ride: the one-off choice when it is valid, otherwise the standard of its shift.
// (A free input has no place: use placeName() for the text to show.)
export function placeFor(car, direction, cfg, day) {
  const id = car && cfg.places.some(p => p.id === car.locationId) ? car.locationId : shiftDefaultId(cfg, day, direction);
  return cfg.places.find(p => p.id === id) || cfg.places[0];
}
// The text to show for the place of one ride: the free input when there is one, otherwise the name of the place.
export function placeName(car, direction, cfg, day) { return freeText(car) || placeFor(car, direction, cfg, day).name; }
// True when the ride differs from the standard of its shift (a free input always does).
export function isOverride(car, direction, cfg, day) {
  if (freeText(car)) return true;
  return !!(car && cfg.places.some(p => p.id === car.locationId) && car.locationId !== shiftDefaultId(cfg, day, direction));
}

// "07:05 Busstation → AFC '34" (heen) / "17:30 AFC '34 → Busstation" (terug).
export function shiftLabel(car, direction, cfg, day) {
  const place = placeName(car, direction, cfg, day), dest = cfg.destination.name;
  const route = direction === 'heen' ? `${place} → ${dest}` : `${dest} → ${place}`;
  return car && car.departureTime ? `${car.departureTime} ${route}` : route;
}

// ---------- GPS ----------
// Reads GPS out of an address field. Accepts decimal degrees ("52.2589, 4.7673", "52.2589 N 4.7673 E", Dutch comma
// decimals when separated by ; or a space) and degrees-minutes-seconds (52°15'32.3"N 4°46'02.3"E, also N 52° 15' 32.3").
// Returns { lat, lon } (6 decimals) or null when the text is not GPS (an ordinary address, or out of range).
const DMS_PART = String.raw`(?:([NSEWnsew])\s*)?(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:["″”]|''|′′)?\s*([NSEWnsew])?`;
const DMS_RE = new RegExp('^' + DMS_PART + '[\\s,;]*' + DMS_PART + '$');
const DEC_PART = String.raw`(?:([NSEWnsew])\s*)?(-?\d{1,3}[.,]\d+)\s*°?\s*([NSEWnsew])?`;
const DEC_RE = new RegExp('^' + DEC_PART + '\\s*[,;\\s]\\s*' + DEC_PART + '$');
const num = v => parseFloat(String(v).replace(',', '.'));
function signed(value, hemi) { return /[SsWw]/.test(hemi || '') ? -Math.abs(value) : value; }
function place2(v1, h1, v2, h2) {
  // Which one is the latitude? A hemisphere letter says so; without letters the order is lat, lon.
  const isLat = h => /[NnSs]/.test(h || ''), isLon = h => /[EeWw]/.test(h || '');
  let lat = v1, lon = v2, la = h1, lo = h2;
  if (isLon(h1) || isLat(h2)) { lat = v2; lon = v1; la = h2; lo = h1; }
  if (isLon(la) || isLat(lo)) return null;
  lat = signed(lat, la); lon = signed(lon, lo);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  const r = x => Math.round(x * 1e6) / 1e6;
  return { lat: r(lat), lon: r(lon) };
}
export function parseCoordinates(text) {
  const s = str(text).replace(/\s+/g, ' ');
  if (!s) return null;
  let m = s.match(DMS_RE);
  if (m) {
    const dms = (deg, min, sec) => (+deg) + (+min) / 60 + num(sec) / 3600;
    if ([m[3], m[8]].some(x => +x >= 60) || [m[4], m[9]].some(x => num(x) >= 60)) return null;
    const h1 = m[1] || m[5], h2 = m[6] || m[10];
    return place2(dms(m[2], m[3], m[4]), h1, dms(m[7], m[8], m[9]), h2);
  }
  m = s.match(DEC_RE);
  if (m) {
    // Both numbers need decimals, so "Hoofdweg 12 5" or a postcode never counts as GPS.
    return place2(num(m[2]), m[1] || m[3], num(m[5]), m[4] || m[6]);
  }
  return null;
}
// What to hand to a map or a geocoder: "lat,lon" for GPS, otherwise the text as typed.
export function mapQuery(address) {
  const c = parseCoordinates(address);
  return c ? c.lat + ',' + c.lon : str(address);
}

// Map links. Android: a generic geo: URI (opens the phone's own maps app, route starts at the current position).
// Everything else (iPhone, laptop browser): a Google Maps search link, because geo: does not open there.
// '' when there is nothing to look for. GPS is passed on as "lat,lon".
export function geoLink(query) {
  const q = mapQuery(query);
  return q ? 'geo:0,0?q=' + encodeURIComponent(q) : '';
}
export function googleMapsLink(query) {
  const q = mapQuery(query);
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
