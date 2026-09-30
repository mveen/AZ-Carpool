// ui-overview.js — Weekoverzicht: the whole week on one page, in the layout of the PDF the coordinator used to send.
// Opens from Rooster. "Afdrukken / PDF" prints it (A4 landscape); the print dialog can also save it as a PDF.
import { locale, t } from './i18n.js';
import { S } from './state.js';
import { DAYS, KM_COST_EUR } from './constants.js';
import { activeDeviation, effectiveCars, fam, plainGirlName, rideTime, seats, sortGirlIds, tripReserveIds } from './rides.js';
import { weekRangeLabel } from './dates.js';
import { dayCoordinatorFor } from './coordinator.js';
import { esc, locationsCfg, phIcon } from './ui-common.js';

const DIRS = ['heen', 'terug'];

// "€11,-" for whole euros, "€11,20" otherwise.
function euro(km){
  const v = Math.round(km * KM_COST_EUR * 100) / 100;
  return '€' + (Number.isInteger(v)? v + ',-' : v.toFixed(2).replace('.', ','));
}
const kmText = km => String(km).replace('.', ',');

// Everything the page shows, as plain data (no HTML): one entry per weekday, the rides in the order heen then terug, by time.
export function overviewData(st = S){
  const days = DAYS.map(([day]) => {
    const coord = dayCoordinatorFor(st, day);
    const shifts = DIRS.map(direction => {
      const cars = effectiveCars(day, direction, st).filter(c => (c.girlIds || []).length);
      const reserve = tripReserveIds(day, direction, cars, st).map(id => fam(id, st).parentName || '?');
      const changed = !!activeDeviation(day, direction, st);
      const rows = cars.map(c => ({
        time: c.departureTime || '',
        driver: c.driverFamilyId ? (fam(c.driverFamilyId, st).parentName || '?') : '',
        driverId: c.driverFamilyId || null,
        passengers: sortGirlIds(c.girlIds, st).map(id => plainGirlName(id, st)),
        used: c.girlIds.length,
        seats: c.driverFamilyId ? seats(fam(c.driverFamilyId, st)) : null,
      })).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')).map((r, i) => ({ ...r, car: i + 1 }));
      return { direction, rows, reserve, changed };
    });
    return { day, coordinator: coord ? coord.name : '', shifts };
  });
  // Rijfrequentie: how many rides each driver has this week.
  const count = new Map();
  days.forEach(d => d.shifts.forEach(s => s.rows.forEach(r => { if (r.driverId) count.set(r.driverId, (count.get(r.driverId) || 0) + 1); })));
  const frequency = [...count.entries()].map(([id, n]) => ({ name: fam(id, st).parentName || '?', n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, locale()));
  // Speelsters: the time each girl has to be in Alkmaar (heen) and to be picked up (terug), per day.
  const girls = Object.keys(st.families).map(id => ({
    id, name: plainGirlName(id, st),
    times: DAYS.map(([day]) => ({ heen: rideTime(id, day, 'heen', st) || '', terug: rideTime(id, day, 'terug', st) || '' })),
  })).filter(g => g.times.some(x => x.heen || x.terug))
    .sort((a, b) => a.name.localeCompare(b.name, locale()));
  return { days, frequency, girls };
}

function versionText(){
  const latest = [S.lastUpdateRooster, S.lastUpdateDeviation].filter(x => x && x.at).sort((a, b) => b.at - a.at)[0];
  const d = latest ? new Date(latest.at) : new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function overviewHtml(){
  const data = overviewData();
  const cfg = locationsCfg();
  const heenPlace = (cfg.places.find(p => p.id === cfg.defaults.heen) || cfg.places[0] || {}).name || '';
  const terugPlace = (cfg.destination && cfg.destination.name) || '';
  const km = cfg.fixedKm && cfg.fixedKm.AFC;
  const costLine = km ? `<p>${esc(t('overview.standaardrit', { km: kmText(km), eur: euro(km), km2: kmText(km * 2), eur2: euro(km * 2), ct: Math.round(KM_COST_EUR * 100) }))}</p>` : '';
  let anyChanged = false;
  const body = data.days.map(d => {
    const label = DAYS.find(([k]) => k === d.day)[1];
    const head = `<tr class="ovDay"><td colspan="8">${esc(label.toUpperCase())}${d.coordinator ? ` <span class="ovCoord">${esc(t('overview.coordinator'))} ${esc(d.coordinator)}</span>` : ''}</td></tr>`;
    const rows = d.shifts.flatMap(s => s.rows.map(r => {
      if (s.changed) anyChanged = true;
      const reserve = esc(s.reserve.join(', '));
      return `<tr><td>${esc(d.day)}</td><td>${esc(s.direction === 'heen' ? t('dir.heenShort') : t('dir.terugShort'))}</td>`
        + `<td>${esc(r.time || '--:--')}${s.changed ? '*' : ''}</td><td>${r.car}</td>`
        + `<td>${r.driver ? esc(r.driver) : `<span class="ovNo">${esc(t('overview.geenChauffeur'))}</span>`}</td>`
        + `<td class="ovWrap">${esc(r.passengers.join(', '))}</td>`
        + `<td>${r.seats == null ? '–' : `${r.used}/${r.seats}`}</td><td class="ovWrap">${reserve}</td></tr>`;
    }));
    const empty = rows.length ? '' : `<tr><td colspan="8" class="ovNo">${esc(t('overview.geenRitten'))}</td></tr>`;
    return head + rows.join('') + empty;
  }).join('');
  const freq = data.frequency.length ? `<table class="ovTable ovFreq"><thead><tr><th>${esc(t('overview.auto'))}</th><th>${esc(t('overview.rijfrequentie'))}</th></tr></thead><tbody>`
    + data.frequency.map(f => `<tr><td>${esc(f.name)}</td><td>${f.n}</td></tr>`).join('') + '</tbody></table>' : '';
  const dayHead = DAYS.map(([k]) => `<th colspan="2">${esc(k)}</th>`).join('');
  const subHead = DAYS.map(() => `<th>${esc(t('overview.aankomstShort'))}</th><th>${esc(t('overview.klaarShort'))}</th>`).join('');
  const girlRows = data.girls.map(g => `<tr><td>${esc(g.name)}</td>`
    + g.times.map(x => `<td class="ovHeen">${esc(x.heen || '–')}</td><td class="ovTerug">${esc(x.terug || '–')}</td>`).join('') + '</tr>').join('');
  return `<div class="ovDoc" id="ovDoc">
    <div class="ovHead">
      <div><h1>${esc(t('overview.title'))}</h1>
      <p>${esc(weekRangeLabel())}</p>
      <p>${esc(t('overview.vertrektijden', { heen: heenPlace, terug: terugPlace }))}</p>${costLine}</div>
      <div class="ovVersion">${esc(t('overview.versie'))} ${esc(versionText())}</div>
    </div>
    <div class="ovTop">
      <div class="ovScroll ovMain"><table class="ovTable"><thead><tr>
        <th>${esc(t('overview.dag'))}</th><th>${esc(t('overview.rit'))}</th><th>${esc(t('overview.tijdstip'))}</th><th>${esc(t('overview.auto'))}</th>
        <th>${esc(t('overview.chauffeur'))}</th><th>${esc(t('overview.passagiers'))}</th><th>${esc(t('overview.bezetting'))}</th><th>${esc(t('overview.reserve'))}</th>
      </tr></thead><tbody>${body}</tbody></table>${anyChanged ? `<p class="ovNote">* ${esc(t('overview.gewijzigd'))}</p>` : ''}</div>
      <div class="ovSide">${freq}</div>
    </div>
    <div class="ovScroll ovGirls"><table class="ovTable"><thead><tr><th rowspan="2">${esc(t('overview.speelster'))}</th>${dayHead}</tr><tr>${subHead}</tr></thead><tbody>${girlRows}</tbody></table></div>
  </div>`;
}

export function closeOverview(){ const ov = document.getElementById('ovOverlay'); if (ov && ov.remove) ov.remove(); }

export function printOverview(){ try { window.print(); } catch (e) { /* printing not available: nothing to do */ } }

export function openOverview(){
  closeOverview();
  const ov = document.createElement('div');
  ov.className = 'ovOverlay'; ov.id = 'ovOverlay';
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', t('overview.title'));
  ov.innerHTML = `<div class="ovBar noPrint">
      <button type="button" class="btn small" id="ovPrint">${phIcon('calendar')} ${esc(t('overview.print'))}</button>
      <button type="button" class="btn small secondary" id="ovClose">${esc(t('overview.sluiten'))}</button>
    </div>${overviewHtml()}`;
  document.body.appendChild(ov);
  const p = ov.querySelector('#ovPrint'), c = ov.querySelector('#ovClose');
  if (p) p.onclick = printOverview;
  if (c) { c.onclick = closeOverview; if (c.focus) c.focus(); }
}
