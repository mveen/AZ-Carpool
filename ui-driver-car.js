// ui-driver-car.js — the driver changes the time and the place of the OWN car (Afwijkend weekrooster).
// A small button "Tijd en plek" under the own car in Mijn week and in Rooster "Deze week" opens ONE sheet: Vertrek and Ophalen of that car, nothing else.
// No warning "Dagcoördinator beslist" (it is the driver's own car); the day coordinator sees it in "Recente wijzigingen" and Mijn week shows
// "Vertrektijd gewijzigd" at the ride. A new plan of the day (a child added or removed, Overnemen) calculates the time again. See driver-car.js.
import { t } from './i18n.js';
import { S } from './state.js';
import { DAYS } from './constants.js';
import { esc, hapticTap, locationsCfg, phIcon, showToast, closeSheet, twoStepConfirm } from './ui-common.js';
import { FREE_TEXT_MAX, carStdId, freeText, routeLabel } from './locations.js';
import { computeRideDeparture, girlName } from './rides.js';
import { weekroosterActive } from './ui-weekrooster-form.js';
import { isDayPast } from './weekrooster-data.js';
import { differsFromAuto } from './driver-car.js';
import { myCarOf, saveDriverCar } from './driver-car-data.js';
import { RITBEURS_MESSAGE_MAX, deadlineMs, hasOpenOffer, openOfferOf } from './ritbeurs.js';
import { createOffer, ritbeursOn, withdrawOffer } from './ritbeurs-data.js';
import { myLinkedFamilyId } from './coordinator.js';

const dayLabel = day => (DAYS.find(([k]) => k === day) || [day, day])[1];

// The button on the own car. Empty when the new flow is off for this person, when this person does not drive on that shift, or when the day is over.
// Icon only (a round button, top right of the ride card). In Mijn week, with Vervanger on, it is the menu "Deze rit" (three dots: Tijd en plek and
// Vervanger zoeken in one place); everywhere else, and with Vervanger off, it is the pencil that opens "Tijd en plek" at once.
const menuOn = () => !!(S.me && ritbeursOn() && myLinkedFamilyId());   // the same rule as ritbeursAvailable() in ui-ritbeurs.js
export function driverCarButtonHtml(day, direction, cls = 'roundBtn', menu = false) {
  if (!weekroosterActive() || isDayPast(S.currentWeekKey, day) || !myCarOf(day, direction)) return '';
  const asMenu = menu && menuOn(), label = t(asMenu ? 'driverCar.menu' : 'driverCar.knop');
  return `<button type="button" class="${cls}" data-drivercar="${day}|${direction}"${asMenu ? ' data-ridemenu="1" aria-haspopup="dialog"' : ''} aria-label="${esc(label)}" title="${esc(label)}">${phIcon(asMenu ? 'dots-three-vertical' : 'pencil')}</button>`;
}

export function wireDriverCar(box, rerender) {
  box.querySelectorAll('[data-drivercar]').forEach(b => b.onclick = () => {
    hapticTap();
    const [day, direction] = b.dataset.drivercar.split('|');
    if (b.dataset.ridemenu) openRideMenu(day, direction, rerender); else openDriverCarSheet(day, direction, rerender);
  });
}

// One sheet per sheet-opening: the same overlay shell for the menu and the offer form.
function openShell(html) {
  closeSheet();
  const ov = document.createElement('div'); ov.className = 'sheetOverlay'; ov.id = 'sheetOverlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"><div class="sheet__handle"></div>${html}</div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) closeSheet(); });
  return ov;
}
const rideWhen = (day, direction, car) => t('rideMenu.sub', { p1: dayLabel(day), p2: t(direction === 'heen' ? 'dir.heenShort' : 'dir.terugShort').toLowerCase(), p3: car.departureTime || computeRideDeparture(day, direction, car.girlIds) || '--:--' });

// The menu "Deze rit": Tijd en plek, and Vervanger zoeken (or Vervanger intrekken while the ride is on offer).
export function openRideMenu(day, direction, rerender) {
  const mine = myCarOf(day, direction);
  if (!mine) return;
  const { car, me } = mine, offer = openOfferOf(S.offers, S.currentWeekKey, day, direction, me);
  const row = (id, icon, label) => `<button type="button" class="settingsRow" id="${id}">${phIcon(icon)}<span class="settingsRow__label">${esc(label)}</span>${phIcon('caret-right')}</button>`;
  const dl = offer ? new Date(deadlineMs(offer.date)).toLocaleDateString('nl-NL', { weekday: 'long' }) : '';
  openShell(`<h3 id="sheetTitle">${esc(t('rideMenu.title'))}</h3>
    <p class="sheet__sub">${esc(rideWhen(day, direction, car))}${offer ? ' · ' + esc(t('ritbeurs.eigen.aangeboden')) : ''}</p>
    <div>${row('rmCar', 'pencil', t('driverCar.knop'))}${offer ? row('rmWithdraw', 'arrow-counter-clockwise', t('rideMenu.trekIn')) : row('rmOffer', 'arrows-left-right', t('ritbeurs.eigen.aanbieden'))}</div>
    <p class="noteLine">${esc(offer ? t('rideMenu.hintOpen', { p1: dl }) : t('rideMenu.hintZoek'))}</p>`);
  document.getElementById('rmCar').onclick = () => { hapticTap(); openDriverCarSheet(day, direction, rerender); };
  const off = document.getElementById('rmOffer'); if (off) off.onclick = () => { hapticTap(); openOfferSheet(day, direction, rerender); };
  const wd = document.getElementById('rmWithdraw');
  if (wd) wd.onclick = () => twoStepConfirm(wd, t('ritbeurs.trekIn') + '?', async () => {
    if (!(await withdrawOffer(offer.id))) return;
    if (S.offers[offer.id]) S.offers[offer.id] = { ...S.offers[offer.id], status: 'withdrawn' };   // the database says so too; the snapshot catches up
    closeSheet(); if (rerender) rerender();
  });
}

// Vervanger zoeken for the OWN ride: the ride on top (so it is clear whose ride it is), a message, what happens next, one button.
export function openOfferSheet(day, direction, rerender) {
  const mine = myCarOf(day, direction);
  if (!mine) return;
  const { car } = mine, cfg = locationsCfg();
  const names = car.girlIds.map(id => girlName(id)).join(', ');
  openShell(`<h3 id="sheetTitle">${esc(t('ritbeurs.form.title'))}</h3>
    <p class="sheet__sub">${esc(t('ritbeurs.form.eigen'))}</p>
    <div class="sheetRide"><div class="rideRow rideRow--mine rideRow--glow"><div class="rideRow__head">
      <div class="rideRow__time"><div class="rideRow__dep">${esc(car.departureTime || computeRideDeparture(day, direction, car.girlIds) || '--:--')}</div><div class="rideRow__sub">${esc(t(direction === 'heen' ? 'dir.heenShort' : 'dir.terugShort'))}</div></div>
      <div class="rideRow__mid"><div class="rideRow__lab rideRow__lab--me">${esc(t('myweek.jij_rijdt_lab'))}</div></div></div>
      <div class="rideRow__route">${phIcon('map-pin')}<span>${esc(routeLabel(car, direction, cfg, day))}</span></div>
      ${names ? `<div class="rideRow__pass"><span class="rideRow__lab">${esc(t('myweek.passagiers'))}</span>${esc(names)}</div>` : ''}</div></div>
    <div class="rbForm"><label for="rmMessage">${esc(t('ritbeurs.form.bericht'))}</label>
      <input type="text" id="rmMessage" maxlength="${RITBEURS_MESSAGE_MAX}" autocomplete="off" placeholder="${esc(t('ritbeurs.form.placeholder'))}">
      <p class="noteLine">${esc(t('ritbeurs.form.stappen'))}</p></div>
    <div class="sheet__actions"><button type="button" class="btn secondary" id="rmCancel">${esc(t('common.annuleren'))}</button><button type="button" class="btn" id="rmGo">${esc(t('ritbeurs.form.bevestig'))}</button></div>`);
  document.getElementById('rmCancel').onclick = () => { hapticTap(); closeSheet(); };
  document.getElementById('rmGo').onclick = async () => {
    hapticTap();
    if (await createOffer(day, direction, document.getElementById('rmMessage').value)) { closeSheet(); if (rerender) rerender(); }
  };
}

function placeOptions(car, day, direction, cfg) {
  const free = freeText(car);
  const chosen = !free && cfg.places.some(p => p.id === car.locationId) ? car.locationId : '';
  const stdName = (cfg.places.find(p => p.id === carStdId(car, cfg, day, direction)) || cfg.places[0]).name;
  return `<option value=""${chosen === '' && !free ? ' selected' : ''}>${esc(t('loc.useDefault', { name: stdName }))}</option>`
    + cfg.places.map(p => `<option value="${esc(p.id)}"${p.id === chosen ? ' selected' : ''}>${esc(p.name)}</option>`).join('')
    + `<option value="__free"${free ? ' selected' : ''}>${esc(t('loc.freeOption'))}</option>`;
}

export function openDriverCarSheet(day, direction, rerender) {
  const mine = myCarOf(day, direction);
  if (!mine) return;
  const { car, me } = mine, cfg = locationsCfg();
  const computed = computeRideDeparture(day, direction, car.girlIds);
  const free = freeText(car);
  const offered = hasOpenOffer(S.offers, S.currentWeekKey, day, direction, me);
  closeSheet();
  const ov = document.createElement('div'); ov.className = 'sheetOverlay'; ov.id = 'sheetOverlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="sheet__handle"></div>
    <h3 id="sheetTitle">${esc(t('driverCar.title'))}</h3>
    <p class="sheet__sub">${esc(t('driverCar.sub', { p1: dayLabel(day).toLowerCase(), p2: t(direction === 'heen' ? 'dir.heenShort' : 'dir.terugShort').toLowerCase(), p3: computed || '--:--', p4: car.girlIds.map(id => girlName(id)).join(', ') }))}</p>
    <label class="devField"><span>${esc(t('deviation.vertrek'))}</span><input type="time" class="devInput timeBig" id="drvTime" value="${esc(car.departureTime || computed || '')}" aria-label="${esc(t('deviation.vertrektijd'))}"></label>
    <label class="devField"><span>${esc(t('driverCar.plek'))}</span><select class="devInput" id="drvPlace">${placeOptions(car, day, direction, cfg)}</select></label>
    <input type="text" class="devInput" id="drvPlaceTxt" maxlength="${FREE_TEXT_MAX}" placeholder="${esc(t('loc.freePlaceholder'))}" aria-label="${esc(t('loc.freeLabel'))}" value="${esc(free)}"${free ? '' : ' hidden'}>
    <p class="noteLine">${esc(t('driverCar.uitleg'))}</p>
    ${offered ? `<p class="noteLine">${esc(t('driverCar.aanbod'))}</p>` : ''}
    <div class="sheet__actions"><button type="button" class="btn secondary" id="drvCancel">${esc(t('common.annuleren'))}</button><button type="button" class="btn" id="drvSave">${esc(t('driverCar.opslaan'))}</button></div>
    ${differsFromAuto(car, computed) ? `<button type="button" class="linkbtn" id="drvReset">${esc(t('driverCar.reset'))}</button>` : ''}
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) closeSheet(); });
  const sel = document.getElementById('drvPlace'), txt = document.getElementById('drvPlaceTxt');
  sel.onchange = () => { txt.hidden = sel.value !== '__free'; if (!txt.hidden) txt.focus(); };
  document.getElementById('drvCancel').onclick = () => { hapticTap(); closeSheet(); };

  const done = async (change, okText) => {
    const r = await saveDriverCar(day, direction, change);
    if (!r.ok) return;
    closeSheet();
    const warn = r.warning ? t(r.warning === 'laat' ? 'driverCar.warn.laat' : 'driverCar.warn.vroeg', { p1: r.computed }) : '';
    showToast(warn || okText, { ...(warn ? { icon: 'warning' } : {}), action: { label: t('deviation.ongedaan'), run: async () => { if (await r.undo()) { showToast(t('deviation.hersteld')); if (rerender) rerender(); } } } });
    if (rerender) rerender();
  };
  document.getElementById('drvSave').onclick = () => {
    hapticTap();
    const time = document.getElementById('drvTime').value;
    let locationId = '', locationText = '';
    if (sel.value === '__free') { locationText = txt.value.trim().slice(0, FREE_TEXT_MAX); if (!locationText) { showToast(t('driverCar.err.plek')); return; } }
    else locationId = sel.value;
    done({ time, locationId, locationText }, t('driverCar.opgeslagen'));
  };
  const reset = document.getElementById('drvReset');
  if (reset) reset.onclick = () => { hapticTap(); done({ reset: true }, t('driverCar.hersteld')); };
  const first = document.getElementById('drvTime'); if (first) first.focus();
}
