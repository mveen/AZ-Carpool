// ui-weekrooster-advice.js — Afwijkend weekrooster: the flow of the day coordinator in Rooster (Deze week), in three steps.
//   1  Aanvragen   the amber card (ui-weekrooster-rooster.js): one button, "Advies bekijken en aanpassen".
//   2  Indeling    the advice (the cars and drivers as they are, least waiting) or the alternative, the girls who change, the cars with what
//                  changes, and every change by hand: a girl to another car, the time, driver and place of a car. Nothing is saved yet.
//   3  Controleren one summary, one button "Doorvoeren voor {dag}" (weekrooster-data.js acceptDay). After it: "Alles terugdraaien" and the Dagbericht.
// The state is S.wrAdvice = { day, step: 'plan'|'check', variant: 'best'|'alt', edits: { heen?: cars, terug?: cars } }; the changes by hand
// are pure functions in weekrooster-plan.js. Planning a day without requests by hand is the editor (ui-weekrooster-edit.js).
import { t } from './i18n.js';
import { S } from './state.js';
import { closeSheet, esc, hapticTap, locationsCfg, phIcon, showToast } from './ui-common.js';
import { driverNameHtml, fam, girlName, seats, sortGirlIds } from './rides.js';
import { isoDayLabel, weekKeyDayIso } from './dates.js';
import { ATC_NAME, FREE_TEXT_MAX, arrivalLabel, arrivalPlaces, carStdId, destinationFor, freeText, routeLabel } from './locations.js';
import { wireWhatsAppButton } from './ui-deviation.js';
import { buildConclusieMessage } from './message-texts.js';
import { renderSchedule } from './ui-schedule.js';
import { renderMyWeek } from './ui-myweek.js';
import { evaluateCars } from './weekrooster-impact.js';
import { acceptDay, adviceForDay, planOf, planStats } from './weekrooster-data.js';
import { timeAfter, withDeparture, withDestination, withDriver, withGirlIn, withNewCar, withPlace } from './weekrooster-plan.js';
import { dayName, weekroosterActive } from './ui-weekrooster-form.js';
import { actionCardHtml } from './ui-weekrooster-rooster.js';

const dayLabel = dayName;
const parent = id => esc(fam(id).parentName || '?');
const DIRS = ['heen', 'terug'];

// The state of the flow with its defaults filled in.
function flowState() {
  const f = S.wrAdvice;
  if (!f) return null;
  if (f.step !== 'check') f.step = 'plan';
  if (f.variant !== 'alt') f.variant = 'best';
  if (!f.edits) f.edits = {};
  return f;
}
const fresh = day => ({ day, step: 'plan', variant: 'best', edits: {} });

// ---------- the pieces ----------
// The three named steps: green = done, amber = the one you are on and the ones to come.
function stepsHtml(current) {
  const names = ['weekrooster.flow.step1', 'weekrooster.flow.step2', 'weekrooster.flow.step3'];
  return `<ol class="flowSteps">${names.map((k, i) => {
    const state = i + 1 < current ? 'done' : i + 1 === current ? 'current' : 'todo';
    return `<li class="flowSteps__step flowSteps__step--${state}"${state === 'current' ? ' aria-current="step"' : ''}><span class="flowSteps__bar"></span><span class="flowSteps__name">${i + 1} ${esc(t(k))}</span></li>`;
  }).join('')}</ol>`;
}

const minutes = n => t('weekrooster.flow.wait', { p1: n });
function statsHtml(stats) {
  const m = stats.moved.length, n = stats.familiesChanged.length;
  const items = [
    stats.extraWait ? minutes(stats.extraWait) : t('weekrooster.flow.wait0'),
    m === 0 ? t('weekrooster.flow.moved0') : m === 1 ? t('weekrooster.flow.moved1') : t('weekrooster.flow.movedN', { p1: m }),
    n === 0 ? t('weekrooster.flow.notice0') : n === 1 ? t('weekrooster.flow.notice1') : t('weekrooster.flow.noticeN', { p1: n }),
  ];
  return `<div class="chips flowStats">${items.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>`;
}

// A girl who asked or who changes car: her time, the car she gets and the car she had. Tap = another car.
function girlRowHtml(dir, d, plan, id) {
  const car = plan.dirs[dir].cars.find(c => c.girlIds.includes(id)), old = d.cars.find(c => (c.girlIds || []).includes(id));
  const tm = timeAfter(d.ctx, id), was = d.ctx.timeOf(id) || '';
  const sub = tm
    ? `<b>${esc(tm)}</b>${was && was !== tm ? ` <span class="wasTime">${esc(t('weekrooster.flow.girlWas', { p1: was }))}</span>` : ''}`
    : esc(t('weekrooster.flow.girlHome'));
  let right = '';
  if (tm) {
    const diff = !old ? t('weekrooster.flow.girlNew') : car && old.driverFamilyId !== car.driverFamilyId ? t('weekrooster.flow.girlWas', { p1: fam(old.driverFamilyId).parentName || '?' }) : '';
    right = `<span class="planRow__car">${car ? driverNameHtml(car.driverFamilyId) : ''}${diff ? `<span class="diffLabel">${esc(diff)}</span>` : ''}</span>${phIcon('caret-right')}`;
  }
  const inner = `<span class="planRow__who"><span class="planRow__name">${girlName(id)}</span><span class="planRow__sub">${sub}</span></span>${right}`;
  return tm ? `<button type="button" class="planRow" data-wrgirl="${dir}|${esc(id)}">${inner}</button>` : `<div class="planRow planRow--static">${inner}</div>`;
}

const sameKids = (a, b) => JSON.stringify([...(a.girlIds || [])].sort()) === JSON.stringify([...(b.girlIds || [])].sort());
function carCardHtml(dir, c, old) {
  const cfg = locationsCfg(), max = seats(fam(c.driverFamilyId)), was = old ? old.girlIds || [] : [];
  const chips = sortGirlIds(c.girlIds).map(id => `<span class="chip${old && !was.includes(id) ? ' chip--add' : ''}">${old && !was.includes(id) ? '+ ' : ''}${girlName(id)}</span>`).join('')
    + sortGirlIds(was.filter(id => !c.girlIds.includes(id))).map(id => `<span class="chip chip--gone">${girlName(id)}</span>`).join('');
  const timeChanged = old && (old.departureTime || '') !== (c.departureTime || '');
  return `<div class="carCard carCard--changed">
    <div class="carCard__head"><span class="carCard__time">${esc(c.departureTime || '--:--')}</span>
      <div class="carCard__who"><span class="carCard__driver">${driverNameHtml(c.driverFamilyId)}</span>${old ? '' : `<span class="tag tag--warn">${esc(t('weekrooster.advice.new'))}</span>`}
        <div class="carCard__route">${esc(routeLabel(c, dir, cfg, S.wrAdvice.day))}</div></div>
      <span class="tag">${c.girlIds.length}/${max}</span></div>
    ${timeChanged ? `<div class="diffLabel">${esc(t('weekrooster.flow.girlWas', { p1: old.departureTime || '--:--' }))}</div>` : ''}
    <div class="chips">${chips || ''}</div></div>`;
}
const quietRowHtml = c => `<div class="planRow planRow--quiet"><span class="planRow__time">${esc(c.departureTime || '--:--')}</span><span class="planRow__who">${driverNameHtml(c.driverFamilyId)}</span><span class="planRow__sub">${sortGirlIds(c.girlIds).map(id => girlName(id)).join(', ')}</span></div>`;
const goneCardHtml = c => `<div class="carCard carCard--gone"><div class="carCard__head"><span class="carCard__time">${esc(c.departureTime || '--:--')}</span>
  <div class="carCard__who"><span class="carCard__driver">${driverNameHtml(c.driverFamilyId)}</span></div><span class="tag">${esc(t('weekrooster.advice.gone'))}</span></div></div>`;

const arrivalText = (dir, cars) => arrivalPlaces(cars, locationsCfg()).map(arrivalLabel).join(' / ');

function directionHtml(dir, adv, plan, stats) {
  const d = adv.directions[dir], p = plan.dirs[dir], now = d.cars.filter(c => (c.girlIds || []).length);
  const asking = d.ctx.requests.map(r => r.familyId), moved = stats.perDir[dir].moved;
  const ids = sortGirlIds([...new Set([...asking, ...moved])]);
  const changed = [], quiet = [];
  p.cars.forEach(c => {
    const old = now.find(o => o.driverFamilyId === c.driverFamilyId);
    const same = old && sameKids(old, c) && (old.departureTime || '') === (c.departureTime || '');
    (same ? quiet : changed).push({ c, old });
  });
  const gone = now.filter(o => !p.cars.some(c => c.driverFamilyId === o.driverFamilyId && c.girlIds.length)).map(goneCardHtml);
  const title = t(dir === 'heen' ? 'weekrooster.flow.carsHeen' : 'weekrooster.flow.carsTerug', { p1: arrivalText(dir, p.cars) });
  return `<section class="wrStack wrStack--tight" data-wrdir="${dir}">
    <div class="sectionHead"><div class="sectionHead__title">${esc(t(dir === 'heen' ? 'weekrooster.flow.girlsHeen' : 'weekrooster.flow.girlsTerug'))}</div></div>
    ${ids.map(id => girlRowHtml(dir, d, plan, id)).join('')}
    <div class="sectionHead"><div class="sectionHead__title">${esc(title)}</div></div>
    ${changed.map(x => carCardHtml(dir, x.c, x.old)).join('')}${gone.join('')}
    ${quiet.length ? `<div class="sectionHead__note">${esc(t('weekrooster.flow.unchanged'))}</div>${quiet.map(x => quietRowHtml(x.c)).join('')}` : ''}
  </section>`;
}

// ---------- step 2: the plan ----------
function planHtml(adv, f, plan, stats) {
  const hasAlt = !plan.fallback && Object.values(adv.directions).some(d => d.keep && d.keep.alt);
  const seg = hasAlt ? `<div class="segmented" role="group" aria-label="${esc(t('weekrooster.flow.segAria'))}">
      <button type="button" data-wrvariant="best" class="${f.variant === 'best' ? 'active' : ''}" aria-pressed="${f.variant === 'best'}">${esc(t('weekrooster.flow.segAdvice'))}</button>
      <button type="button" data-wrvariant="alt" class="${f.variant === 'alt' ? 'active' : ''}" aria-pressed="${f.variant === 'alt'}">${esc(t('weekrooster.flow.segAlt'))}</button></div>` : '';
  const unplaced = stats.problems.filter(p => p.key === 'unplaced').flatMap(p => p.ids);
  return `${seg}${plan.fallback ? `<p class="noteCard">${phIcon('info')}<span>${esc(t('weekrooster.flow.notFit'))}</span></p>` : statsHtml(stats)}
    ${Object.keys(plan.dirs).map(dir => directionHtml(dir, adv, plan, stats)).join('')}
    ${plan.blocked ? `<div class="noteLine">${esc(t('weekrooster.advice.noSolution'))}</div>` : ''}
    ${unplaced.length ? `<div class="noteLine">${esc(t('weekrooster.flow.unplaced', { p1: sortGirlIds(unplaced).map(id => girlName(id)).join(', ') }))}</div>` : ''}
    <button type="button" class="linkbtn" id="wrAdjust">${phIcon('pencil')}${esc(t('weekrooster.flow.adjust'))}</button>
    <div class="actionBar"><button type="button" class="btn" id="wrToCheck"${plan.blocked ? ' disabled' : ''}>${esc(t('weekrooster.flow.toCheck'))}</button></div>`;
}

// ---------- step 3: check ----------
function checkHtml(adv, f, plan, stats) {
  const day = f.day, n = adv.requests.length;
  const bad = key => stats.problems.some(p => p.key === key);
  const chip = (ok, text) => `<span class="chip ${ok ? 'chip--add' : 'chip--req'}">${phIcon(ok ? 'check' : 'warning')} ${esc(text)}</span>`;
  const swapped = Object.entries(plan.dirs).some(([dir, p]) => {
    const was = adv.directions[dir].cars.filter(c => (c.girlIds || []).length).map(c => c.driverFamilyId);
    return p.cars.some(c => c.girlIds.length && !was.includes(c.driverFamilyId)) || was.some(id => !p.cars.some(c => c.girlIds.length && c.driverFamilyId === id));
  });
  const unplacedIds = stats.problems.filter(p => p.key === 'unplaced').flatMap(p => p.ids);
  const placedN = adv.requests.filter(r => !unplacedIds.includes(r.familyId)).length;
  const chips = [
    chip(placedN === n, t('weekrooster.flow.chipRequests', { p1: placedN, p2: n })),
    chip(!swapped, t(swapped ? 'weekrooster.flow.chipSwap' : 'weekrooster.flow.chipNoSwap')),
    chip(!bad('seats'), t(bad('seats') ? 'weekrooster.flow.chipSeatsBad' : 'weekrooster.flow.chipSeatsOk')),
    ...(bad('unplaced') ? [chip(false, t('weekrooster.flow.chipUnplaced'))] : []),
    ...(bad('late') ? [chip(false, t('weekrooster.flow.chipLate'))] : []),
  ].join('');
  const notice = stats.familiesChanged.length ? `<p class="noteLine">${esc(t('weekrooster.flow.notice', { p1: stats.familiesChanged.map(id => fam(id).parentName || '?').join(', ') }))}</p>` : '';
  const lines = Object.entries(plan.dirs).map(([dir, p]) => `<div class="planSum__dir">${esc(t(dir === 'heen' ? 'dir.heenShort' : 'dir.terugShort'))}</div>${
    p.cars.filter(c => c.girlIds.length).map(quietRowHtml).join('')}`).join('');
  return `<div class="chips">${chips}</div>${notice}
    <div class="planSum"><div class="sectionHead__title">${esc(t('weekrooster.flow.summary', { p1: dayLabel(day).toLowerCase() }))}</div>${lines}</div>
    <div class="applyBox"><button type="button" class="btn" id="wrAccept"${plan.blocked ? ' disabled' : ''}>${phIcon('check')}${esc(t('weekrooster.flow.apply', { p1: dayLabel(day).toLowerCase() }))}</button>
      <p class="applyBox__sub">${esc(t('weekrooster.flow.applySub'))}</p>
      <button type="button" class="linkbtn" id="wrBackToPlan">${phIcon('arrow-left')}${esc(t('weekrooster.flow.backToPlan'))}</button></div>`;
}

// ---------- the view ----------
export function scheduleAdviceHtml() {
  if (!weekroosterActive()) return '';
  if (S.wrDone) return doneHtml(S.wrDone);
  const f = flowState(); if (!f) return '';
  const adv = adviceForDay(f.day);
  if (!Object.keys(adv.directions).length) { S.wrAdvice = null; return ''; }   // nothing (left) to advise: somebody decided, or the request ran out
  const plan = planOf(adv, f.variant, f.edits), stats = planStats(adv, plan);
  const iso = weekKeyDayIso(S.currentWeekKey, f.day), when = `${dayLabel(f.day).toLowerCase()} ${isoDayLabel(iso, '')}`;
  const body = f.step === 'check' ? checkHtml(adv, f, plan, stats) : planHtml(adv, f, plan, stats);
  return `<div class="wrStack" id="wrAdvice">
    <button type="button" class="linkbtn" id="wrAdviceBack">${phIcon('arrow-left')}${esc(t('weekrooster.advice.back'))}</button>
    ${stepsHtml(f.step === 'check' ? 3 : 2)}
    <div class="sectionHead"><div class="sectionHead__title">${esc(t(f.step === 'check' ? 'weekrooster.flow.checkTitle' : 'weekrooster.advice.headline', { p1: when }))}</div></div>
    ${actionCardHtml(f.day)}
    ${body}</div>`;
}

// What happened per girl who asked, in words, for the screen after Doorvoeren: [{ name, lines: [text] }]. Made before saving, from the plan.
function resultRows(adv, plan) {
  return adv.requests.map(r => {
    const lines = [];
    DIRS.forEach(dir => {
      const d = adv.directions[dir]; if (!d || !d.ctx.requests.some(x => x.familyId === r.familyId)) return;
      const tm = timeAfter(d.ctx, r.familyId), car = plan.dirs[dir].cars.find(c => c.girlIds.includes(r.familyId));
      if (!tm || !car) lines.push(t(dir === 'heen' ? 'weekrooster.flow.doneNoHeen' : 'weekrooster.flow.doneNoTerug'));
      else lines.push(t(dir === 'heen' ? 'weekrooster.flow.doneRideHeen' : 'weekrooster.flow.doneRideTerug', { p1: fam(car.driverFamilyId).parentName || '?', p2: tm }));
    });
    return { name: fam(r.familyId).girlName || fam(r.familyId).parentName || '?', lines };
  }).filter(x => x.lines.length);
}
const plural = (n, one, many) => (n === 1 ? t(one) : t(many, { p1: n }));

function doneHtml(done) {
  const day = dayLabel(done.day).toLowerCase(), rows = done.rows || [];
  const changes = rows.reduce((n, r) => n + r.lines.length, 0);
  return `<div class="wrStack flowDone" id="wrApplied">${stepsHtml(4)}
    <div class="flowDone__badge">${phIcon('check')}</div>
    <h2 class="flowDone__title">${esc(t('weekrooster.flow.doneTitle', { p1: day.charAt(0).toUpperCase() + day.slice(1) }))}</h2>
    <p class="flowDone__sub">${esc(t('weekrooster.flow.doneSummary', { p1: plural(changes, 'weekrooster.flow.doneCount1', 'weekrooster.flow.doneCountN'), p2: plural(done.n, 'weekrooster.flow.doneReq1', 'weekrooster.flow.doneReqN') }))}</p>
    ${rows.length ? `<div class="flowDone__list">${rows.map(r => `<div class="flowDone__row"><span class="flowDone__tick">${phIcon('check')}</span><span class="flowDone__what"><b>${esc(r.name)}</b>${r.lines.map(l => `<span>${esc(l)}</span>`).join('')}</span></div>`).join('')}</div>` : ''}
    <button type="button" class="btn" id="conclusieBtn">${phIcon('whatsapp-logo-fill')}${esc(t('weekrooster.flow.doneShare'))}</button>
    <button type="button" class="btn secondary" id="wrDoneClose">${esc(t('weekrooster.advice.closeDone'))}</button>
    ${done.undo ? `<button type="button" class="btn secondary flowUndo" id="wrUndoAll"><span class="flowUndo__title">${phIcon('arrow-counter-clockwise')}${esc(t('weekrooster.flow.undoAll'))}</span><span class="flowUndo__text">${esc(done.n === 1 ? t('weekrooster.flow.undoTextOne', { p1: day }) : t('weekrooster.flow.undoTextMany', { p1: day, p2: done.n }))}</span></button>` : ''}
  </div>`;
}

// ---------- the sheets ----------
function overlay(inner) {
  closeSheet();
  const ov = document.createElement('div'); ov.className = 'sheetOverlay'; ov.id = 'sheetOverlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"><div class="sheet__handle"></div>${inner}</div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) closeSheet(); });
  return ov;
}
const redraw = () => renderSchedule();
const currentCars = (adv, f, dir) => planOf(adv, f.variant, f.edits).dirs[dir].cars;
const setCars = (f, dir, cars) => { f.edits = { ...f.edits, [dir]: cars }; };

// A girl to another car: the cars of this shift, with the time, the free seats and what it means for her.
function openGirlSheet(dir, id) {
  const f = flowState(), adv = adviceForDay(f.day), d = adv.directions[dir], cars = currentCars(adv, f, dir);
  const here = cars.find(c => c.girlIds.includes(id));
  const items = cars.map(c => {
    const free = seats(fam(c.driverFamilyId)) - c.girlIds.length + (c.girlIds.includes(id) ? 1 : 0);
    const next = withGirlIn(d.ctx, [...cars], id, c.driverFamilyId);
    const ev = evaluateCars(d.ctx, next), w = ev.waitOf[id];
    const nextCar = next.find(x => x.driverFamilyId === c.driverFamilyId);
    const bits = [c === here ? t('weekrooster.flow.pickHere') : free <= 0 ? t('weekrooster.flow.pickFull') : t(free === 1 ? 'weekrooster.flow.pickSeats1' : 'weekrooster.flow.pickSeatsN', { p1: free })];
    if (c !== here && free > 0) bits.push(w < 0 ? t('weekrooster.flow.pickLate') : w > 0 ? t('weekrooster.flow.pickWait', { p1: w }) : '');
    return { icon: c === here ? 'check' : 'arrows-left-right', muted: c !== here && free <= 0,
      label: esc(t('weekrooster.flow.pickItem', { p1: fam(c.driverFamilyId).parentName || '?', p2: (nextCar && nextCar.departureTime) || c.departureTime || '--:--' })),
      sub: esc(bits.filter(Boolean).join(' · ')),
      onClick: () => { if (c === here || free <= 0) return; setCars(f, dir, withGirlIn(d.ctx, cars, id, c.driverFamilyId)); redraw(); } };
  });
  const ov = overlay(`<h3 id="sheetTitle">${esc(t('weekrooster.flow.pickTitle', { p1: girlName(id) }))}</h3><p class="sheet__sub">${esc(t('weekrooster.flow.pickSub'))}</p>
    ${items.map((it, i) => `<button type="button" class="sheetItem${it.muted ? ' sheetItem--muted' : ''}" data-sheetidx="${i}">${phIcon(it.icon)}<span class="sheetItem__label">${it.label}</span><span class="sub">${it.sub}</span></button>`).join('')}`);
  ov.querySelectorAll('[data-sheetidx]').forEach(b => b.onclick = () => { const it = items[+b.dataset.sheetidx]; closeSheet(); it.onClick(); });
}

// "Auto's aanpassen": per car the departure (calculated or chosen), the driver, the pickup / drop-off place and the arrival; plus a car for another driver.
function openAdjustSheet() {
  const f = flowState(), adv = adviceForDay(f.day), cfg = locationsCfg();
  const draw = () => {
    const plan = planOf(adv, f.variant, f.edits);
    const html = Object.keys(plan.dirs).map(dir => {
      const d = adv.directions[dir], cars = plan.dirs[dir].cars;
      const driving = new Set(cars.map(c => c.driverFamilyId));
      const others = Object.entries(S.families).filter(([id]) => !driving.has(id));
      const carsHtml = cars.map(c => {
        const key = `${dir}|${c.driverFamilyId}`, calc = d.ctx ? withDeparture(d.ctx, [{ ...c, depManual: false }], c.driverFamilyId, '')[0].departureTime : '';
        const free = freeText(c), chosen = !free && cfg.places.some(p => p.id === c.locationId) ? c.locationId : '';
        const stdName = (cfg.places.find(p => p.id === carStdId(c, cfg, f.day, dir)) || cfg.places[0]).name;
        const place = `<option value="">${esc(t('loc.useDefault', { name: stdName }))}</option>${cfg.places.map(p => `<option value="${esc(p.id)}"${p.id === chosen ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="__free"${free ? ' selected' : ''}>${esc(t('loc.freeOption'))}</option>`;
        const dest = destinationFor(c, cfg);
        const destBtn = (k, name) => `<button type="button" class="devDest${dest.key === k ? ' on' : ''}" data-adj="dest" data-key="${esc(key)}" data-dest="${k}" aria-pressed="${dest.key === k}"><span class="devDestName">${esc(name)}</span></button>`;
        return `<div class="adjCar" data-adjcar="${esc(key)}">
          <div class="adjCar__title">${esc(t(dir === 'heen' ? 'dir.heenShort' : 'dir.terugShort'))} · ${driverNameHtml(c.driverFamilyId)}</div>
          <div class="devFormTop">
            <label class="devField"><span>${esc(t('deviation.vertrek'))}</span><select class="devInput" data-adj="depmode" data-key="${esc(key)}"><option value="calc"${c.depManual ? '' : ' selected'}>${esc(t('weekrooster.flow.depCalc', { p1: calc || '--:--' }))}</option><option value="manual"${c.depManual ? ' selected' : ''}>${esc(t('weekrooster.flow.depManual'))}</option></select></label>
            ${c.depManual ? `<label class="devField"><span>${esc(t('deviation.vertrektijd'))}</span><input type="time" class="devInput timeBig" data-adj="deptime" data-key="${esc(key)}" value="${esc(c.departureTime || '')}"></label>` : ''}
            <label class="devField"><span>${esc(t('deviation.chauffeur'))}</span><select class="devInput" data-adj="driver" data-key="${esc(key)}"><option value="${esc(c.driverFamilyId)}" selected>${parent(c.driverFamilyId)}</option>${others.map(([id, fm]) => `<option value="${esc(id)}">${esc(fm.parentName || '?')}</option>`).join('')}</select></label>
          </div>
          <label class="devField"><span>${esc(t('deviation.ophalen'))}</span><select class="devInput" data-adj="place" data-key="${esc(key)}">${place}</select></label>
          ${free || S.adjFree === key ? `<input type="text" class="devInput" data-adj="placetext" data-key="${esc(key)}" maxlength="${FREE_TEXT_MAX}" value="${esc(free)}" placeholder="${esc(t('loc.freePlaceholder'))}" aria-label="${esc(t('loc.freeLabel'))}">` : ''}
          <div class="devField"><span>${esc(t('deviation.aankomst'))}</span><div class="devDestRow">${destBtn('AFC', cfg.destination.name)}${destBtn('ATC', ATC_NAME)}</div></div></div>`;
      }).join('');
      const add = others.length ? `<label class="devField"><span>${esc(t('weekrooster.flow.addCar'))} · ${esc(t(dir === 'heen' ? 'dir.heenShort' : 'dir.terugShort'))}</span><select class="devInput" data-adj="addcar" data-dir="${dir}"><option value="">${esc(t('weekrooster.flow.addCarTitle'))}</option>${others.map(([id, fm]) => `<option value="${esc(id)}">${esc(fm.parentName || '?')}</option>`).join('')}</select></label>` : '';
      return carsHtml + add;
    }).join('');
    const ov = overlay(`<h3 id="sheetTitle">${esc(t('weekrooster.flow.adjustTitle'))}</h3><p class="sheet__sub">${esc(t('weekrooster.flow.adjustSub', { p1: dayLabel(f.day).toLowerCase() }))}</p>${html}
      <div class="sheet__actions"><button type="button" class="btn" id="wrAdjustDone">${esc(t('weekrooster.flow.adjustDone'))}</button></div>`);
    const apply = (dir, fn) => { const cars = currentCars(adv, f, dir); setCars(f, dir, fn(adv.directions[dir].ctx, cars)); draw(); redraw(); };
    const parts = el => el.dataset.key.split('|');
    ov.querySelectorAll('[data-adj]').forEach(el => {
      const kind = el.dataset.adj;
      if (kind === 'dest') { el.onclick = () => { const [dir, id] = parts(el); apply(dir, (ctx, cars) => withDestination(cars, id, el.dataset.dest)); }; return; }
      el.onchange = () => {
        if (kind === 'addcar') { if (el.value) apply(el.dataset.dir, (ctx, cars) => withNewCar(cars, el.value)); return; }
        const [dir, id] = parts(el);
        if (kind === 'depmode') apply(dir, (ctx, cars) => withDeparture(ctx, cars, id, el.value === 'manual' ? ((cars.find(c => c.driverFamilyId === id) || {}).departureTime || '12:00') : ''));
        else if (kind === 'deptime') apply(dir, (ctx, cars) => withDeparture(ctx, cars, id, el.value));
        else if (kind === 'driver') apply(dir, (ctx, cars) => withDriver(cars, id, el.value));
        else if (kind === 'place') {
          if (el.value === '__free') { S.adjFree = el.dataset.key; draw(); return; }
          S.adjFree = null; apply(dir, (ctx, cars) => withPlace(cars, id, el.value ? { locationId: el.value } : {}));
        } else if (kind === 'placetext') apply(dir, (ctx, cars) => withPlace(cars, id, el.value.trim() ? { locationText: el.value.trim().slice(0, FREE_TEXT_MAX) } : {}));
      };
    });
    const done = document.getElementById('wrAdjustDone'); if (done) done.onclick = () => { hapticTap(); S.adjFree = null; closeSheet(); };
  };
  draw();
}

function askUndo(done) {
  const day = dayLabel(done.day).toLowerCase();
  const ov = overlay(`<h3 id="sheetTitle">${esc(t('weekrooster.flow.undoSure'))}</h3>
    <p class="sheet__sub">${esc(done.n === 1 ? t('weekrooster.flow.undoTextOne', { p1: day }) : t('weekrooster.flow.undoTextMany', { p1: day, p2: done.n }))}</p>
    <div class="sheet__actions"><button type="button" class="btn secondary" id="wrUndoNo">${esc(t('weekrooster.flow.undoNo'))}</button><button type="button" class="btn" id="wrUndoYes">${esc(t('weekrooster.flow.undoYes'))}</button></div>`);
  document.getElementById('wrUndoNo').onclick = () => { hapticTap(); closeSheet(); };
  document.getElementById('wrUndoYes').onclick = async () => { hapticTap(); closeSheet(); await undoAll(done); };
}
async function undoAll(done) {
  if (!done.undo || !(await done.undo())) return;
  S.wrDone = null; S.wrAdvice = fresh(done.day);
  showToast(t('weekrooster.advice.undone')); rerender();
}

// ---------- wiring ----------
const rerender = () => { renderSchedule(); renderMyWeek(); };
export function wireAdvice(box) {
  box.querySelectorAll('[data-wradvice]').forEach(b => b.onclick = () => { hapticTap(); S.wrAdvice = fresh(b.dataset.wradvice); S.wrDone = null; renderSchedule(); });
  box.querySelectorAll('[data-wrvariant]').forEach(b => b.onclick = () => { hapticTap(); const f = flowState(); f.variant = b.dataset.wrvariant; f.edits = {}; renderSchedule(); });
  box.querySelectorAll('[data-wrgirl]').forEach(b => b.onclick = () => { hapticTap(); const [dir, id] = b.dataset.wrgirl.split('|'); openGirlSheet(dir, id); });
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('wrAdviceBack', () => { hapticTap(); S.wrAdvice = null; renderSchedule(); });
  on('wrAdjust', () => { hapticTap(); openAdjustSheet(); });
  on('wrToCheck', () => { hapticTap(); flowState().step = 'check'; renderSchedule(); });
  on('wrBackToPlan', () => { hapticTap(); flowState().step = 'plan'; renderSchedule(); });
  on('wrAccept', async () => {
    hapticTap();
    const f = flowState(), { day } = f;
    const adv = adviceForDay(day), rows = resultRows(adv, planOf(adv, f.variant, f.edits));
    const r = await acceptDay(day, f.variant, f.edits);
    if (!r.ok) return;
    S.wrAdvice = null; S.wrDone = { day, n: r.n, undo: r.undo, rows };
    showToast(t(r.n === 1 ? 'weekrooster.advice.doneOne' : 'weekrooster.advice.doneMany', { p1: r.n }));
    rerender();
  });
  on('wrUndoAll', () => { hapticTap(); if (S.wrDone) askUndo(S.wrDone); });
  on('wrDoneClose', () => { hapticTap(); S.wrDone = null; renderSchedule(); });
  wireWhatsAppButton('conclusieBtn', () => buildConclusieMessage(S.wrDone ? S.wrDone.day : S.scheduleDay));
}
