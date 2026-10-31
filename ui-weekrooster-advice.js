// ui-weekrooster-advice.js — Afwijkend weekrooster: the flow of the day coordinator in Rooster (Deze week), in three steps.
// The flow is its own screen on top of the app (renderFlowScreen), one screen per step, like the design "Morgen regelen":
//   1  Aanvragen   what the parents asked, the advice in one card (waiting, girls in another car), "Advies bekijken en aanpassen" or "Zelf indelen".
//                  The way in is the small card in Rooster (ui-weekrooster-rooster.js).
//   2  Indeling    per shift one situation ("Eva en Lotte komen om 17:30"): per girl was → wordt (tap = another car), then the cars with what
//                  changes; Advies or Alternatief; every change by hand (time, driver, place). Nothing is saved yet.
//   3  Controleren one summary, one button "Doorvoeren voor {dag}" (weekrooster-data.js acceptDay). After it: "Alles terugdraaien" and the Dagbericht.
// The state is S.wrAdvice = { day, step: 'requests'|'plan'|'check', variant: 'best'|'alt', edits: { heen?: cars, terug?: cars } }; the changes by hand
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
import { myFamilyId } from './coordinator.js';
import { evaluateCars } from './weekrooster-impact.js';
import { acceptDay, adviceForDay, planOf, planStats } from './weekrooster-data.js';
import { timeAfter, withDeparture, withDestination, withDriver, withGirlIn, withNewCar, withPlace } from './weekrooster-plan.js';
import { dayName, weekroosterActive } from './ui-weekrooster-form.js';
import { openDayEditor } from './ui-weekrooster-edit.js';

const dayLabel = dayName;
const parent = id => esc(fam(id).parentName || '?');
const DIRS = ['heen', 'terug'];
const STEPS = ['requests', 'plan', 'check'];

// The state of the flow with its defaults filled in.
function flowState() {
  const f = S.wrAdvice;
  if (!f) return null;
  if (!STEPS.includes(f.step)) f.step = 'requests';
  if (f.variant !== 'alt') f.variant = 'best';
  if (!f.edits) f.edits = {};
  return f;
}
const fresh = day => ({ day, step: 'requests', variant: 'best', edits: {} });
const rawGirl = id => fam(id).girlName || fam(id).parentName || id;
const rawParent = id => fam(id).parentName || '?';
// "Eva", "Eva en Lotte", "Eva, Lotte en Sara"
const niceList = names => (names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' ' + t('weekrooster.flow.and') + ' ' + names[names.length - 1]);
const pad2 = n => String(n).padStart(2, '0');
const isoOf = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const isTomorrow = iso => !!iso && iso === isoOf(new Date(Date.now() + 864e5));

// ---------- the pieces ----------
// The three named steps: green = done, amber = the one you are on and the ones to come. 4 = all done.
function stepsHtml(current) {
  const names = ['weekrooster.flow.step1', 'weekrooster.flow.step2', 'weekrooster.flow.step3'];
  return `<ol class="flowSteps">${names.map((k, i) => {
    const state = i + 1 < current ? 'done' : i + 1 === current ? 'current' : 'todo';
    return `<li class="flowSteps__step flowSteps__step--${state}"${state === 'current' ? ' aria-current="step"' : ''}><span class="flowSteps__bar"></span><span class="flowSteps__name">${i + 1} ${esc(t(k))}</span></li>`;
  }).join('')}</ol>`;
}

// The top of a step: close (step 1) or back (steps 2 and 3), the day and the title.
function headHtml(step, day) {
  const iso = weekKeyDayIso(S.currentWeekKey, day), name = dayLabel(day).toLowerCase();
  const when = (isTomorrow(iso) ? t('weekrooster.flow.tomorrow') + ' · ' : '') + `${name} ${isoDayLabel(iso, '')}`;
  const forDay = isTomorrow(iso) ? t('weekrooster.flow.tomorrowLower') : name;
  const title = step === 'plan' ? t('weekrooster.flow.titlePlan', { p1: forDay }) : step === 'check' ? t('weekrooster.flow.titleCheck') : t('weekrooster.flow.titleRequests', { p1: forDay });
  const close = step === 'requests';
  return `<div class="flowHead"><button type="button" class="roundBtn" id="wrNav" aria-label="${esc(t(close ? 'weekrooster.flow.close' : 'weekrooster.flow.prev'))}">${phIcon(close ? 'x' : 'arrow-left')}</button>
    <div class="flowHead__text"><div class="flowHead__ctx">${esc(when)}</div><h1 class="flowHead__title" id="flowTitle">${esc(title)}</h1></div></div>`;
}

const tile = (value, label, ok) => `<div class="statTile${ok ? ' statTile--ok' : ''}"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
const movedLabel = n => t(n === 1 ? 'weekrooster.flow.tileMoved1' : 'weekrooster.flow.tileMovedN');
const noticeLabel = n => t(n === 1 ? 'weekrooster.flow.tileNotice1' : 'weekrooster.flow.tileNoticeN');
const waitTile = stats => tile(t('weekrooster.flow.tileMin', { p1: stats.extraWait }), t('weekrooster.flow.tileWait'), !stats.extraWait);

// ---------- step 1: the requests ----------
function requestRowHtml(adv, r) {
  const lines = DIRS.map(dir => {
    const d = adv.directions[dir], q = d && d.ctx.requests.find(x => x.familyId === r.familyId);
    if (!q) return '';
    const was = d.ctx.timeOf(r.familyId) || '', heen = dir === 'heen';
    if (!q.time) return `<div class="reqItem__line">${esc(t(heen ? 'weekrooster.flow.reqNoHeen' : 'weekrooster.flow.reqNoTerug'))}${was ? ` <s>${esc(was)}</s>` : ''}</div>`;
    return `<div class="reqItem__line">${esc(t(heen ? 'weekrooster.flow.reqHeen' : 'weekrooster.flow.reqTerug'))} <span class="reqItem__t">${esc(q.time)}</span>${was && was !== q.time ? ` <s>${esc(was)}</s>` : ''}</div>`;
  }).join('');
  const by = r.familyId === myFamilyId() ? t('weekrooster.flow.reqByMe') : t('weekrooster.flow.reqBy', { p1: rawGirl(r.familyId) });
  return `<div class="reqItem"><b>${girlName(r.familyId)}</b>${lines}<div class="reqItem__by">${esc(by)}</div></div>`;
}

function heroHtml(adv, plan, stats) {
  const n = adv.requests.length, unplaced = stats.problems.some(p => p.key === 'unplaced');
  const fits = !plan.fallback && !plan.blocked && !unplaced;
  const m = stats.moved.length;
  return `<div class="adviceHero">
    <span class="tag tag--ink">${esc(t(fits ? 'weekrooster.flow.heroTag' : 'weekrooster.flow.heroTagNoFit'))}</span>
    <h2 class="adviceHero__title">${esc(fits ? t(n === 1 ? 'weekrooster.flow.heroFits1' : 'weekrooster.flow.heroFitsN', { p1: n }) : t('weekrooster.flow.heroNoFit'))}</h2>
    ${fits ? `<div class="statTiles">${waitTile(stats)}${tile(String(m), movedLabel(m), false)}</div>` : ''}
    <p class="adviceHero__text">${esc(t(fits ? 'weekrooster.flow.heroBody' : 'weekrooster.flow.notFit'))}</p></div>`;
}

function requestsStep(adv, f, plan, stats) {
  const n = adv.requests.length;
  return {
    body: `<div class="flowStack">
      <div class="sectionHead"><div class="sectionHead__title">${esc(t(n === 1 ? 'weekrooster.flow.reqTitle1' : 'weekrooster.flow.reqTitleN', { p1: n }))}</div><div class="sectionHead__sub">${esc(t('weekrooster.flow.youDecide'))}</div></div>
      <div class="reqPanel">${adv.requests.map(r => requestRowHtml(adv, r)).join('')}</div>
      ${heroHtml(adv, plan, stats)}
      <div class="infoNote">${phIcon('info')}<span>${esc(t('weekrooster.flow.nothingChanges'))}</span></div></div>`,
    foot: `<button type="button" class="btn" id="wrToPlan">${esc(t('weekrooster.advice.look'))}${phIcon('arrow-right')}</button>
      <button type="button" class="linkbtn" id="wrSelf" data-day="${esc(f.day)}">${esc(t('weekrooster.edit.self'))}</button>`,
  };
}

// ---------- step 2: the plan ----------
const sameKids = (a, b) => JSON.stringify([...(a.girlIds || [])].sort()) === JSON.stringify([...(b.girlIds || [])].sort());
const arrivalText = (dir, cars) => arrivalPlaces(cars, locationsCfg()).map(arrivalLabel).join(' / ');

// The title of the situation: "Eva en Lotte komen om 17:30" when everybody who asked on this shift asks the same time.
function sceneTitle(dir, ctx) {
  const heen = dir === 'heen', riding = ctx.requests.filter(r => r.rides && r.time), times = [...new Set(riding.map(r => r.time))];
  if (riding.length && riding.length === ctx.requests.length && times.length === 1) {
    const names = niceList(sortGirlIds(riding.map(r => r.familyId)).map(rawGirl)), one = riding.length === 1;
    return t(`weekrooster.flow.scene${heen ? 'Heen' : 'Terug'}${one ? '1' : 'N'}`, { p1: names, p2: times[0] });
  }
  return t(heen ? 'weekrooster.flow.sceneHeenMixed' : 'weekrooster.flow.sceneTerugMixed');
}

// One girl: what she was (car and time), what she becomes (tap = another car), and in a few words how that is for her.
function girlRowHtml(dir, d, plan, ev, id, asked) {
  const car = plan.dirs[dir].cars.find(c => c.girlIds.includes(id)), old = d.cars.find(c => (c.girlIds || []).includes(id));
  const tm = timeAfter(d.ctx, id), was = d.ctx.timeOf(id) || '', w = ev.waitOf[id], heen = dir === 'heen';
  let cap = '', warn = false;
  if (!tm) cap = t('weekrooster.flow.capHome');
  else if (w < 0) { cap = t('weekrooster.flow.pickLate'); warn = true; }
  else if (w > 0) { cap = t(heen ? 'weekrooster.flow.capEarly' : 'weekrooster.flow.capLate', { p1: w }); warn = true; }
  else cap = t(asked ? 'weekrooster.flow.capAsked' : heen ? 'weekrooster.flow.capSameHeen' : 'weekrooster.flow.capSameTerug');
  const wasHtml = old ? `${esc(rawParent(old.driverFamilyId))}${was ? `<i>${esc(was)}</i>` : ''}` : esc(t('weekrooster.flow.wasNone'));
  const changed = !old || !car || old.driverFamilyId !== car.driverFamilyId || was !== tm;
  const now = tm && car
    ? `<button type="button" class="wwSel${changed ? '' : ' wwSel--same'}" data-wrgirl="${dir}|${esc(id)}" aria-label="${esc(t('weekrooster.flow.pickAria', { p1: rawGirl(id) }))}"><span>${esc(rawParent(car.driverFamilyId))}<i>${esc(tm)}</i></span>${phIcon('caret-down')}</button>`
    : `<div class="wwSel wwSel--off"><span>${esc(t('weekrooster.flow.capHome'))}</span></div>`;
  return `<div class="wwRow"><div class="wwRow__top"><b>${girlName(id)}</b><span class="wwRow__cap${warn ? ' wwRow__cap--warn' : tm ? '' : ' wwRow__cap--off'}">${esc(cap)}</span></div>
    <div class="ww"><div class="wwWas">${wasHtml}</div><span class="wwArrow">${phIcon('caret-right')}</span>${now}</div></div>`;
}

// A car of the shift. `old` = the same driver's car now (null: a new car); plain = nothing changes in it.
function carCardHtml(dir, ctx, c, old, plain) {
  const cfg = locationsCfg(), max = seats(fam(c.driverFamilyId)), was = old ? old.girlIds || [] : [];
  const route = esc(routeLabel(c, dir, cfg, S.wrAdvice.day));
  const timeChanged = old && (old.departureTime || '') !== (c.departureTime || '');
  const time = `<div class="carCard__t"><span class="carCard__time">${esc(c.departureTime || '--:--')}</span>${timeChanged ? `<span class="carCard__was">${esc(t('weekrooster.flow.girlWas', { p1: old.departureTime || '--:--' }))}</span>` : ''}</div>`;
  const head = (sub, tag) => `<div class="carCard__head">${time}<div class="carCard__who"><span class="carCard__driver">${driverNameHtml(c.driverFamilyId)}</span>${old || plain ? '' : `<span class="tag tag--warn">${esc(t('weekrooster.advice.new'))}</span>`}<div class="carCard__route">${sub}</div></div>${tag}</div>`;
  const tag = `<span class="tag">${c.girlIds.length}/${max}</span>`;
  if (plain) return `<div class="carCard carCard--plain">${head(`${sortGirlIds(c.girlIds).map(rawGirl).map(esc).join(', ')} · ${route}`, tag)}</div>`;
  const chipTime = id => { const tm = timeAfter(ctx, id); return tm ? ` <span class="chipTime">${esc(tm)}</span>` : ''; };
  const chips = sortGirlIds(c.girlIds).map(id => { const add = old && !was.includes(id); return `<span class="chip${add ? ' chip--add' : ''}">${add ? '+ ' : ''}${girlName(id)}${chipTime(id)}</span>`; }).join('')
    + sortGirlIds(was.filter(id => !c.girlIds.includes(id))).map(id => `<span class="chip chip--gone">${girlName(id)}</span>`).join('');
  return `<div class="carCard carCard--changed">${head(route, tag)}<div class="chips">${chips}</div></div>`;
}
const goneCardHtml = c => `<div class="carCard carCard--gone"><div class="carCard__head"><div class="carCard__t"><span class="carCard__time">${esc(c.departureTime || '--:--')}</span></div>
  <div class="carCard__who"><span class="carCard__driver">${driverNameHtml(c.driverFamilyId)}</span></div><span class="tag">${esc(t('weekrooster.advice.gone'))}</span></div></div>`;

function sceneHtml(dir, adv, plan, stats) {
  const d = adv.directions[dir], p = plan.dirs[dir], ev = stats.perDir[dir], now = d.cars.filter(c => (c.girlIds || []).length);
  const asking = d.ctx.requests.map(r => r.familyId);
  const ids = sortGirlIds([...new Set([...asking, ...ev.moved])]);
  const changed = [], plain = [];
  p.cars.forEach(c => {
    const old = now.find(o => o.driverFamilyId === c.driverFamilyId);
    const same = old && sameKids(old, c) && (old.departureTime || '') === (c.departureTime || '');
    (same ? plain : changed).push({ c, old });
  });
  const gone = now.filter(o => !p.cars.some(c => c.driverFamilyId === o.driverFamilyId && c.girlIds.length));
  const heen = dir === 'heen';
  const names = ev.familiesChanged.map(rawParent).map(esc);
  return `<section class="scene" data-wrdir="${dir}">
    <div class="scene__head"><b>${esc(sceneTitle(dir, d.ctx))}</b><span>${esc(t(heen ? 'dir.heenShort' : 'dir.terugShort'))}</span></div>
    <div class="ww ww--cols" aria-hidden="true"><span>${esc(t('weekrooster.flow.colWas'))}</span><span></span><span class="ww__now">${esc(t('weekrooster.flow.colNow'))}</span></div>
    ${ids.map(id => girlRowHtml(dir, d, plan, ev, id, asking.includes(id))).join('')}
    <div class="scene__cars"><div class="scene__label">${esc(t(heen ? 'weekrooster.flow.carsHeen' : 'weekrooster.flow.carsTerug', { p1: arrivalText(dir, p.cars) }))}</div>
      ${changed.map(x => carCardHtml(dir, d.ctx, x.c, x.old, false)).join('')}${gone.map(goneCardHtml).join('')}${plain.map(x => carCardHtml(dir, d.ctx, x.c, null, true)).join('')}</div>
    <div class="scene__note">${phIcon('info')}<span>${names.length ? t('weekrooster.flow.notice', { p1: names.join(', ') }) : esc(t('weekrooster.flow.notice0'))}</span></div></section>`;
}

function planStep(adv, f, plan, stats) {
  const hasAlt = !plan.fallback && Object.values(adv.directions).some(d => d.keep && d.keep.alt);
  // The subtitle is what the choice costs, worked out per variant (never a fixed claim).
  const sub = v => { const s = planStats(adv, planOf(adv, v, {})); return `${t('weekrooster.flow.tileMin', { p1: s.extraWait })} ${t('weekrooster.flow.tileWait')}`; };
  const opt = (v, key) => `<button type="button" class="tog__opt${f.variant === v ? ' on' : ''}" data-wrvariant="${v}" aria-pressed="${f.variant === v}"><b>${esc(t(key))}</b><span>${esc(sub(v))}</span></button>`;
  const seg = hasAlt ? `<div class="tog" role="group" aria-label="${esc(t('weekrooster.flow.segAria'))}">${opt('best', 'weekrooster.flow.segAdvice')}${opt('alt', 'weekrooster.flow.segAlt')}</div>` : '';
  const n = stats.familiesChanged.length, m = stats.moved.length;
  const tiles = plan.fallback ? '' : `<div class="statTiles statTiles--3">${waitTile(stats)}${tile(String(m), movedLabel(m), false)}${tile(String(n), noticeLabel(n), false)}</div>`;
  const unplaced = stats.problems.filter(p => p.key === 'unplaced').flatMap(p => p.ids);
  return {
    body: `<div class="flowStack">${seg}${plan.fallback ? `<p class="noteCard">${phIcon('info')}<span>${esc(t('weekrooster.flow.notFit'))}</span></p>` : ''}${tiles}
      ${Object.keys(plan.dirs).map(dir => sceneHtml(dir, adv, plan, stats)).join('')}
      ${plan.blocked ? `<div class="noteLine">${esc(t('weekrooster.advice.noSolution'))}</div>` : ''}
      ${unplaced.length ? `<div class="noteLine">${esc(t('weekrooster.flow.unplaced', { p1: sortGirlIds(unplaced).map(rawGirl).join(', ') }))}</div>` : ''}
      <button type="button" class="lnkRow" id="wrAdjust"><span>${esc(t('weekrooster.flow.adjust'))}</span>${phIcon('caret-right')}</button></div>`,
    foot: `<button type="button" class="btn" id="wrToCheck"${plan.blocked ? ' disabled' : ''}>${esc(t('weekrooster.flow.toCheck'))}${phIcon('arrow-right')}</button>
      <p class="flowScreen__note">${esc(t('weekrooster.flow.notYet'))}</p>`,
  };
}

// ---------- step 3: check ----------
const quietRowHtml = c => `<div class="planRow planRow--quiet"><span class="planRow__time">${esc(c.departureTime || '--:--')}</span><span class="planRow__who">${driverNameHtml(c.driverFamilyId)}</span><span class="planRow__sub">${sortGirlIds(c.girlIds).map(id => girlName(id)).join(', ')}</span></div>`;

function checkStep(adv, f, plan, stats) {
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
  const notice = stats.familiesChanged.length ? `<div class="infoNote">${phIcon('info')}<span>${esc(t('weekrooster.flow.noticeSee', { p1: stats.familiesChanged.map(rawParent).join(', ') }))}</span></div>` : '';
  const lines = Object.entries(plan.dirs).map(([dir, p]) => `<div class="planSum__dir">${esc(t(dir === 'heen' ? 'dir.heenShort' : 'dir.terugShort'))}</div>${
    p.cars.filter(c => c.girlIds.length).map(quietRowHtml).join('')}`).join('');
  return {
    body: `<div class="flowStack"><div class="chips">${chips}</div>${notice}
      <div class="sectionHead"><div class="sectionHead__title">${esc(t('weekrooster.flow.summary', { p1: dayLabel(day).toLowerCase() }))}</div><div class="sectionHead__sub">${esc(t('weekrooster.flow.afterApply'))}</div></div>
      <div class="planSum">${lines}</div></div>`,
    foot: `<button type="button" class="btn flowApply" id="wrAccept"${plan.blocked ? ' disabled' : ''}><span class="flowApply__title">${esc(t('weekrooster.flow.apply', { p1: dayLabel(day).toLowerCase() }))}</span><span class="flowApply__text">${esc(t('weekrooster.flow.applySub'))}</span></button>
      <button type="button" class="linkbtn" id="wrBackToPlan">${esc(t('weekrooster.flow.backToPlan'))}</button>`,
  };
}

// ---------- the view ----------
const screenHtml = (head, steps, body, foot) => `<div class="flowScreen__panel" id="wrAdvice">${head}<div class="flowScreen__steps">${steps}</div>
  <div class="flowScreen__body">${body}</div>${foot ? `<div class="flowScreen__foot">${foot}</div>` : ''}</div>`;

// The whole screen of the flow (its own layer on top of the app, see renderFlowScreen). Empty when the flow is closed.
export function scheduleAdviceHtml() {
  if (!weekroosterActive()) return '';
  if (S.wrDone) return doneHtml(S.wrDone);
  const f = flowState(); if (!f) return '';
  const adv = adviceForDay(f.day);
  if (!Object.keys(adv.directions).length) { S.wrAdvice = null; return ''; }   // nothing (left) to advise: somebody decided, or the request ran out
  const plan = planOf(adv, f.variant, f.edits), stats = planStats(adv, plan);
  const step = f.step === 'check' ? checkStep(adv, f, plan, stats) : f.step === 'plan' ? planStep(adv, f, plan, stats) : requestsStep(adv, f, plan, stats);
  return screenHtml(headHtml(f.step, f.day), stepsHtml(STEPS.indexOf(f.step) + 1), step.body, step.foot);
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
  const body = `<div class="flowStack flowDone" id="wrApplied">
    <div class="flowDone__badge">${phIcon('check')}</div>
    <h1 class="flowDone__title" id="flowTitle">${esc(t('weekrooster.flow.doneTitle', { p1: day.charAt(0).toUpperCase() + day.slice(1) }))}</h1>
    <p class="flowDone__sub">${esc(t('weekrooster.flow.doneSummary', { p1: plural(changes, 'weekrooster.flow.doneCount1', 'weekrooster.flow.doneCountN'), p2: plural(done.n, 'weekrooster.flow.doneReq1', 'weekrooster.flow.doneReqN') }))}</p>
    ${rows.length ? `<div class="flowDone__list">${rows.map(r => `<div class="flowDone__row"><span class="flowDone__tick">${phIcon('check')}</span><span class="flowDone__what"><b>${esc(r.name)}</b>${r.lines.map(l => `<span>${esc(l)}</span>`).join('')}</span></div>`).join('')}</div>` : ''}</div>`;
  const foot = `<button type="button" class="btn" id="conclusieBtn">${phIcon('whatsapp-logo-fill')}${esc(t('weekrooster.flow.doneShare'))}</button>
    <button type="button" class="btn secondary" id="wrDoneClose">${esc(t('weekrooster.advice.closeDone'))}</button>
    ${done.undo ? `<button type="button" class="btn secondary flowUndo" id="wrUndoAll"><span class="flowUndo__title">${phIcon('arrow-counter-clockwise')}${esc(t('weekrooster.flow.undoAll'))}</span><span class="flowUndo__text">${esc(done.n === 1 ? t('weekrooster.flow.undoTextOne', { p1: day }) : t('weekrooster.flow.undoTextMany', { p1: day, p2: done.n }))}</span></button>` : ''}`;
  return screenHtml('', stepsHtml(4), body, foot);
}

// The flow is its own layer on top of the app (no tab bar, no Rooster behind it): one screen per step, closing with the X or the back arrow.
// Called after every render of Rooster; the layer appears, changes or goes away with S.wrAdvice / S.wrDone.
export function renderFlowScreen() {
  const html = S.wrAdvice || S.wrDone ? scheduleAdviceHtml() : '';
  let el = document.getElementById('flowScreen');
  if (!html) { if (el && el.remove) el.remove(); if (document.body.classList) document.body.classList.remove('flowOpen'); return; }
  if (!el || !el.parentNode) {
    el = document.createElement('div'); el.id = 'flowScreen'; el.className = 'flowScreen';
    if (el.setAttribute) { el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'flowTitle'); }
    el.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.getElementById('sheetOverlay')) closeFlow(); });
    document.body.appendChild(el);
  }
  const key = S.wrDone ? 'done' : (S.wrAdvice.day + '|' + S.wrAdvice.step);
  const body = el.querySelector && el.querySelector('.flowScreen__body'), keep = body && el.dataset && el.dataset.step === key ? body.scrollTop : 0;
  el.innerHTML = html;
  if (el.dataset) el.dataset.step = key;
  const nb = el.querySelector && el.querySelector('.flowScreen__body'); if (nb) nb.scrollTop = keep;
  if (document.body.classList) document.body.classList.add('flowOpen');
  wireAdvice(el);
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
function closeFlow() { S.wrAdvice = null; S.wrDone = null; renderSchedule(); }
// X on step 1 closes the flow; the back arrow on steps 2 and 3 goes one step back.
function navBack() {
  const f = flowState(); if (!f) return closeFlow();
  if (f.step === 'check') f.step = 'plan'; else if (f.step === 'plan') f.step = 'requests'; else return closeFlow();
  renderSchedule();
}
// The small card in Rooster ("Regel dit") opens the flow on step 1.
export function wireAdviceEntry(box) {
  box.querySelectorAll('[data-wradvice]').forEach(b => b.onclick = () => { hapticTap(); S.wrAdvice = fresh(b.dataset.wradvice); S.wrDone = null; renderSchedule(); });
}
export function wireAdvice(box) {
  box.querySelectorAll('[data-wrvariant]').forEach(b => b.onclick = () => { hapticTap(); const f = flowState(); f.variant = b.dataset.wrvariant; f.edits = {}; renderSchedule(); });
  box.querySelectorAll('[data-wrgirl]').forEach(b => b.onclick = () => { hapticTap(); const [dir, id] = b.dataset.wrgirl.split('|'); openGirlSheet(dir, id); });
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('wrNav', () => { hapticTap(); navBack(); });
  on('wrToPlan', () => { hapticTap(); flowState().step = 'plan'; renderSchedule(); });
  on('wrSelf', () => { hapticTap(); const day = flowState().day; S.wrAdvice = null; openDayEditor(day); });
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
