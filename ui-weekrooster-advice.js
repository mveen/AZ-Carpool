// ui-weekrooster-advice.js — Afwijkend weekrooster: the flow of the day coordinator in Rooster (Deze week), in three steps.
// The flow is its own screen on top of the app (renderFlowScreen), one screen per step, like the design "Morgen regelen":
//   1  Aanvragen   what the parents asked, the advice in one card (waiting, girls in another car), "Advies bekijken en aanpassen" or "Zelf indelen".
//                  The way in is the small card in Rooster (ui-weekrooster-rooster.js).
//   2  Indeling    per shift one situation ("Eva en Lotte komen om 17:30"): the cars, each with its departure once, why, and the riders with their
//                  own time and wait (tap a rider = another car); Advies or Alternatief; every change by hand (time, driver, place). Nothing is saved yet.
//   3  Controleren one summary, one button "Doorvoeren voor {dag}" (weekrooster-data.js acceptDay). After it: "Alles terugdraaien" and the Dagbericht.
// The state is S.wrAdvice = { day, step: 'requests'|'plan'|'check', variant: 'best'|'alt', edits: { heen?: cars, terug?: cars } }; the changes by hand
// are pure functions in weekrooster-plan.js. Planning a day without requests by hand is the editor (ui-weekrooster-edit.js).
import { t } from './i18n.js';
import { S } from './state.js';
import { closeSheet, esc, hapticTap, locationsCfg, phIcon, showToast } from './ui-common.js';
import { driverNameHtml, fam, girlName, isFlex, seats, sortGirlIds } from './rides.js';
import { isoDayLabel, weekKeyDayIso } from './dates.js';
import { ATC_NAME, FREE_TEXT_MAX, arrivalLabel, arrivalPlaces, carStdId, destinationFor, freeText, routeLabel } from './locations.js';
import { wireWhatsAppButton } from './ui-deviation.js';
import { buildConclusieMessage } from './message-texts.js';
import { renderSchedule } from './ui-schedule.js';
import { renderMyWeek } from './ui-myweek.js';
import { evaluateCars } from './weekrooster-impact.js';
import { acceptDay, adviceForDay, planOf, planStats, withManual } from './weekrooster-data.js';
import { timeAfter, withDeparture, withDestination, withDriver, withGirlIn, withNewCar, withPlace, withoutGirl } from './weekrooster-plan.js';
import { dayName, weekroosterActive } from './ui-weekrooster-form.js';

const dayLabel = dayName;
const adviceOf = f => withManual(adviceForDay(f.day), f.edits);   // the advice with the girls taken out / added by hand worked in
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
  if (!DIRS.includes(f.editDir)) f.editDir = null;
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
// The wait tile is a button: it opens the sum behind the number (now against the proposal).
const waitTile = stats => `<button type="button" class="statTile statTile--btn${stats.extraWait ? '' : ' statTile--ok'}" data-wrwait="1" aria-haspopup="dialog"><b>${esc(t('weekrooster.flow.tileMin', { p1: stats.extraWait }))}</b><span>${esc(t('weekrooster.flow.tileWait'))} ${phIcon('info')}</span></button>`;

// ---------- step 1: the requests ----------
function requestRowHtml(adv, r) {
  const lines = DIRS.map(dir => {
    const d = adv.directions[dir], q = d && d.ctx.requests.find(x => x.familyId === r.familyId);
    if (!q) return '';
    const was = d.ctx.timeOf(r.familyId) || '', heen = dir === 'heen';
    if (!q.time) return `<div class="reqItem__line">${esc(t(heen ? 'weekrooster.flow.reqNoHeen' : 'weekrooster.flow.reqNoTerug'))}${was ? ` <s>${esc(was)}</s>` : ''}</div>`;
    return `<div class="reqItem__line">${esc(t(heen ? 'weekrooster.flow.reqHeen' : 'weekrooster.flow.reqTerug'))} <span class="reqItem__t">${esc(q.time)}</span>${was && was !== q.time ? ` <s>${esc(was)}</s>` : ''}</div>`;
  }).join('');
  return `<div class="reqItem"><b>${girlName(r.familyId)}</b>${lines}</div>`;
}

function heroHtml(adv, plan, stats) {
  const n = adv.requests.length, unplaced = stats.problems.some(p => p.key === 'unplaced');
  const fits = !plan.fallback && !plan.blocked && !unplaced;
  const m = stats.moved.length;
  return `<div class="adviceHero">
    <span class="tag tag--ink">${esc(t(fits ? 'weekrooster.flow.heroTag' : 'weekrooster.flow.heroTagNoFit'))}</span>
    <h2 class="adviceHero__title">${esc(fits ? t(n === 1 ? 'weekrooster.flow.heroFits1' : 'weekrooster.flow.heroFitsN', { p1: n }) : t('weekrooster.flow.heroNoFit'))}</h2>
    ${fits ? `<div class="statTiles">${tile(String(m), movedLabel(m), false)}${waitTile(stats)}</div>` : ''}
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
    foot: `<button type="button" class="btn" id="wrToPlan">${esc(t('weekrooster.advice.look'))}${phIcon('arrow-right')}</button>`,
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

// A rider in a car, with HER time, how long she waits and (when she moves) where she comes from. Tap = another car.
// Vocabulary (the same everywhere in this step): "haar tijd" = her own time, "vertrek" = when the car leaves, "wacht" = the difference.
function waitChip(w) {
  if (w < 0) return `<span class="chip chip--bad">${esc(t('weekrooster.flow.riderLate'))}</span>`;
  return w > 0 ? `<span class="chip chip--warn">${esc(t('weekrooster.flow.riderWait', { p1: w }))}</span>` : `<span class="chip chip--ok">${esc(t('weekrooster.flow.riderZero'))}</span>`;
}
// Who is new in a car, as few lines as possible: where they come from once (when it is another car), and everybody with the same time and wait on one line.
function changesHtml(d, ev, c, ids) {
  const fromOf = id => { const o = d.cars.find(x => (x.girlIds || []).includes(id)); return o && o.driverFamilyId !== c.driverFamilyId ? o.driverFamilyId : ''; };
  const groups = new Map();
  ids.forEach(id => { const k = fromOf(id); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(id); });
  return [...groups.entries()].map(([from, g]) => {
    const lines = new Map();
    g.forEach(id => { const k = `${timeAfter(d.ctx, id) || '--:--'}|${ev.waitOf[id]}`; if (!lines.has(k)) lines.set(k, []); lines.get(k).push(id); });
    const body = [...lines.values()].map(x => `<div class="chgLine"><b>${niceList(sortGirlIds(x).map(rawGirl).map(esc))}</b><span class="chgLine__t">${esc(timeAfter(d.ctx, x[0]) || '--:--')}</span>${waitChip(ev.waitOf[x[0]])}</div>`).join('');
    return `<div class="chgGroup">${from ? `<div class="chgGroup__cap">${esc(t('weekrooster.flow.fromCar', { p1: rawParent(from) }))}</div>` : ''}${body}</div>`;
  }).join('');
}
const carBlock = (title, count, inner) => `<div class="carBlock"><div class="carBlock__h"><span>${esc(title)}</span>${count ? `<b>${esc(count)}</b>` : ''}</div>${inner}</div>`;

// The fields of one car (by hand): time and driver side by side (as in the day editor of Rooster), then pick-up place and arrival.
function carFormHtml(dir, d, c, all) {
  const cfg = locationsCfg(), key = `${dir}|${c.driverFamilyId}`, day = flowState().day;
  const calc = d.ctx ? withDeparture(d.ctx, [{ ...c, depManual: false }], c.driverFamilyId, '')[0].departureTime : '';
  const free = freeText(c), chosen = !free && cfg.places.some(p => p.id === c.locationId) ? c.locationId : '';
  const stdName = (cfg.places.find(p => p.id === carStdId(c, cfg, day, dir)) || cfg.places[0]).name;
  const place = `<option value="">${esc(t('loc.useDefault', { name: stdName }))}</option>${cfg.places.map(p => `<option value="${esc(p.id)}"${p.id === chosen ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="__free"${free ? ' selected' : ''}>${esc(t('loc.freeOption'))}</option>`;
  const dest = destinationFor(c, cfg);
  const destBtn = (k, name) => `<button type="button" class="devDest${dest.key === k ? ' on' : ''}" data-adj="dest" data-key="${esc(key)}" data-dest="${k}" aria-pressed="${dest.key === k}"><span class="devDestName">${esc(name)}</span></button>`;
  const driving = new Set(all.map(x => x.driverFamilyId)), others = Object.entries(S.families).filter(([id]) => !driving.has(id));
  return carBlock(t('weekrooster.flow.blockEdit'), '', `<div class="carEdit">
    <div class="devFormTop">
      <label class="devField"><span>${esc(t('deviation.vertrektijd'))}</span><input type="time" class="devInput timeBig" data-adj="deptime" data-key="${esc(key)}" value="${esc(c.departureTime || calc || '')}"></label>
      <label class="devField"><span>${esc(t('deviation.chauffeur'))}</span><select class="devInput" data-adj="driver" data-key="${esc(key)}"><option value="${esc(c.driverFamilyId)}" selected>${parent(c.driverFamilyId)}</option>${others.map(([id, fm]) => `<option value="${esc(id)}">${esc(fm.parentName || '?')}</option>`).join('')}</select></label>
    </div>
    ${c.depManual ? `<button type="button" class="linkbtn carEdit__reset" data-adj="depreset" data-key="${esc(key)}">${esc(t('weekrooster.flow.depReset', { p1: calc || '--:--' }))}</button>` : `<p class="carEdit__hint">${esc(t('weekrooster.flow.depAuto'))}</p>`}
    <label class="devField"><span>${esc(t('deviation.ophalen'))}</span><select class="devInput" data-adj="place" data-key="${esc(key)}">${place}</select></label>
    ${free || S.adjFree === key ? `<input type="text" class="devInput" data-adj="placetext" data-key="${esc(key)}" maxlength="${FREE_TEXT_MAX}" value="${esc(free)}" placeholder="${esc(t('loc.freePlaceholder'))}" aria-label="${esc(t('loc.freeLabel'))}">` : ''}
    <div class="devField"><span>${esc(t('deviation.aankomst'))}</span><div class="devDestRow">${destBtn('AFC', cfg.destination.name)}${destBtn('ATC', ATC_NAME)}</div></div></div>`);
}

// A car of the shift, in three blocks: Wijzigingen (who is new, with her time and wait), Bezetting (everybody in the car: a tap = another car, + Passagier = add one),
// Niet meer in deze auto. In "Aanpassen" the fields of the car come first. `old` = the same driver's car now (null: a new car); plain = nothing changes in it.
function carCardHtml(dir, d, ev, c, old, plain, askedBy, edit, all) {
  const cfg = locationsCfg(), max = seats(fam(c.driverFamilyId)), was = old ? old.girlIds || [] : [];
  const route = esc(routeLabel(c, dir, cfg, S.wrAdvice.day));
  const timeChanged = old && (old.departureTime || '') !== (c.departureTime || '');
  const time = `<div class="carCard__t"><span class="carCard__time">${esc(c.departureTime || '--:--')}</span>${timeChanged ? `<span class="carCard__was">${esc(t('weekrooster.flow.girlWas', { p1: old.departureTime || '--:--' }))}</span>` : ''}</div>`;
  const head = (sub, tag) => `<div class="carCard__head">${time}<div class="carCard__who"><span class="carCard__driver">${driverNameHtml(c.driverFamilyId)}</span>${old || plain ? '' : `<span class="tag tag--warn">${esc(t('weekrooster.advice.new'))}</span>`}<div class="carCard__route">${sub}</div></div>${tag}</div>`;
  const tag = `<span class="tag">${c.girlIds.length}/${max}</span>`;
  if (plain && !edit) return `<div class="carCard carCard--plain">${head(`${sortGirlIds(c.girlIds).map(rawGirl).map(esc).join(', ')} · ${route}`, tag)}</div>`;
  const key = id => askedBy.has(id) || !old || !was.includes(id);
  const all2 = sortGirlIds(c.girlIds), news = all2.filter(key);
  const askers = sortGirlIds(c.girlIds.filter(id => { const r = askedBy.get(id); return r && r.rides && r.time; }));
  const askTimes = [...new Set(askers.map(id => askedBy.get(id).time))];
  const why = !askers.length ? ''
    : askTimes.length === 1 ? t(askers.length === 1 ? 'weekrooster.flow.whyAsked1' : 'weekrooster.flow.whyAskedN', { p1: niceList(askers.map(rawGirl)), p2: askTimes[0] })
    : t('weekrooster.flow.whyAskedMixed', { p1: niceList(askers.map(rawGirl)) });
  const left = sortGirlIds(was.filter(id => !c.girlIds.includes(id)));
  const chip = id => { const isNew = news.includes(id); return `<button type="button" class="chip ${isNew ? 'chip--add' : 'chip--btn'}" data-wrgirl="${dir}|${esc(id)}" aria-label="${esc(t('weekrooster.flow.pickAria', { p1: rawGirl(id) }))}">${isNew ? '+ ' : ''}${girlName(id)}</button>`; };
  const addBtn = max - c.girlIds.length > 0 ? `<button type="button" class="chip chip--flex" data-wradd="${dir}|${esc(c.driverFamilyId)}">${esc(t('weekrooster.flow.addPassenger'))}</button>` : '';
  return `<div class="carCard${plain ? '' : ' carCard--changed'}${edit ? ' carCard--editing' : ''}">${head(route, tag)}
    ${why ? `<p class="carCard__why">${timeChanged ? `<b>${esc(t('weekrooster.flow.whyTime', { p1: c.departureTime || '--:--' }))}</b> ` : ''}${esc(why)}</p>` : ''}
    ${edit ? carFormHtml(dir, d, c, all) : ''}
    ${news.length ? carBlock(t('weekrooster.flow.blockChanges'), `+${news.length}`, changesHtml(d, ev, c, news)) : ''}
    ${carBlock(t('weekrooster.flow.blockSeats'), `${c.girlIds.length}/${max}`, `<div class="chips">${all2.map(chip).join('')}${addBtn}</div>`)}
    ${left.length ? carBlock(t('weekrooster.flow.blockOut'), '', `<div class="chips">${left.map(id => `<span class="chip chip--gone">${esc(rawGirl(id))}</span>`).join('')}</div>`) : ''}</div>`;
}
const goneCardHtml = c => `<div class="carCard carCard--gone"><div class="carCard__head"><div class="carCard__t"><span class="carCard__time">${esc(c.departureTime || '--:--')}</span></div>
  <div class="carCard__who"><span class="carCard__driver">${driverNameHtml(c.driverFamilyId)}</span></div><span class="tag">${esc(t('weekrooster.advice.gone'))}</span></div></div>`;

// Who waits longer or shorter than now: the plan against the cars as they are today (the same sum as "extra wachten", per person).
function waitChanges(adv, plan) {
  const out = [];
  Object.keys(plan.dirs).forEach(dir => {
    const d = adv.directions[dir], after = evaluateCars(d.ctx, plan.dirs[dir].cars).waitOf, before = evaluateCars(d.ctx, d.cars).waitOf;
    Object.keys(after).forEach(id => { const dl = Math.max(0, after[id]) - Math.max(0, before[id] || 0); if (dl) out.push({ id, dl }); });
  });
  return out;
}
const waitSumHtml = (adv, plan, stats) => {
  const ch = waitChanges(adv, plan).sort((a, b) => b.dl - a.dl);
  if (!ch.length || !stats.extraWait) return '';   // only where it explains a number above 0: otherwise plus and minus cancel and it only confuses
  const items = ch.slice(0, 5).map(x => `${rawGirl(x.id)} ${x.dl > 0 ? '+' : '−'}${Math.abs(x.dl)}`).join(' · ');
  return `<p class="statTiles__sum">${esc(t('weekrooster.flow.waitSum', { p1: items }))}${ch.length > 5 ? ' …' : ''}</p>`;
};

function sceneHtml(dir, adv, plan, stats, editDir) {
  const d = adv.directions[dir], p = plan.dirs[dir], ev = stats.perDir[dir], now = d.cars.filter(c => (c.girlIds || []).length);
  const askedBy = new Map(d.ctx.requests.filter(r => !r.manual).map(r => [r.familyId, r]));
  const off = d.ctx.requests.filter(r => r.manual && !r.rides).map(r => r.familyId);
  const changed = [], plain = [];
  p.cars.forEach(c => {
    const old = now.find(o => o.driverFamilyId === c.driverFamilyId);
    const same = old && sameKids(old, c) && (old.departureTime || '') === (c.departureTime || '');
    (same && !c.girlIds.some(id => askedBy.has(id)) ? plain : changed).push({ c, old, diff: !same });   // a car with someone who asked always shows her (time and wait), also when nothing changes
  });
  const gone = now.filter(o => !p.cars.some(c => c.driverFamilyId === o.driverFamilyId && c.girlIds.length));
  const riding = new Set(p.cars.flatMap(c => c.girlIds));
  const notRiding = sortGirlIds([...new Set([...askedBy.keys(), ...off, ...ev.moved])].filter(id => !riding.has(id)));
  const heen = dir === 'heen';
  const names = ev.familiesChanged.map(rawParent).map(esc);
  const quiet = changed.every(x => !x.diff) && !gone.length && !notRiding.length;
  const nChanged = changed.filter(x => x.diff).length + gone.length;
  const edit = editDir === dir, driving = new Set(p.cars.map(c => c.driverFamilyId));
  const others = Object.entries(S.families).filter(([id]) => !driving.has(id));
  const editBtn = `<button type="button" class="btn small ${edit ? '' : 'secondary'}" data-wradjust="${dir}" aria-pressed="${edit}">${phIcon(edit ? 'check' : 'pencil')}${esc(t(edit ? 'weekrooster.flow.adjustDone' : 'weekrooster.flow.adjust'))}</button>`;
  const addCar = edit && others.length ? `<label class="devField"><span>${esc(t('weekrooster.flow.addCar'))}</span><select class="devInput" data-adj="addcar" data-dir="${dir}"><option value="">${esc(t('weekrooster.flow.addCarTitle'))}</option>${others.map(([id, fm]) => `<option value="${esc(id)}">${esc(fm.parentName || '?')}</option>`).join('')}</select></label>` : '';
  return `<section class="scene scene--${heen ? 'heen' : 'terug'}" data-wrdir="${dir}">
    <div class="scene__head"><span class="scene__badge">${phIcon(heen ? 'sun' : 'moon')}</span><div class="scene__headText"><span>${esc(t(heen ? 'dir.heenShort' : 'dir.terugShort'))}</span><b>${esc(sceneTitle(dir, d.ctx))}</b></div>${editBtn}</div>
    ${quiet ? `<p class="scene__ok">${phIcon('check')}<span>${esc(t('weekrooster.flow.sceneNoChange'))}</span></p>` : `<p class="scene__chg"><span class="chip chip--warn">${esc(t(nChanged === 1 ? 'weekrooster.flow.sceneChanges1' : 'weekrooster.flow.sceneChangesN', { p1: nChanged }))}</span></p>`}
    <div class="scene__cars"><div class="scene__label">${esc(t(heen ? 'weekrooster.flow.carsHeen' : 'weekrooster.flow.carsTerug', { p1: arrivalText(dir, p.cars) }))}</div>
      ${changed.map(x => carCardHtml(dir, d, ev, x.c, x.old, false, askedBy, edit, p.cars)).join('')}${gone.map(goneCardHtml).join('')}${plain.map(x => carCardHtml(dir, d, ev, x.c, edit ? x.old : null, true, askedBy, edit, p.cars)).join('')}${addCar}
      ${notRiding.map(id => `<div class="rider rider--off"><b class="rider__name">${girlName(id)}</b><span class="chip chip--muted">${esc(t('weekrooster.flow.capHome'))}</span></div>`).join('')}</div>
    <div class="scene__note">${phIcon('info')}<span>${names.length ? t('weekrooster.flow.notice', { p1: names.join(', ') }) : esc(t('weekrooster.flow.notice0'))}</span></div></section>`;
}

function planStep(adv, f, plan, stats) {
  const hasAlt = !plan.fallback && Object.values(adv.directions).some(d => d.keep && d.keep.alt);
  // The subtitle is what the choice costs, worked out per variant (never a fixed claim).
  const sub = v => { const s = planStats(adv, planOf(adv, v, {})); return `${t('weekrooster.flow.tileMin', { p1: s.extraWait })} ${t('weekrooster.flow.tileWait')}`; };
  const opt = (v, key) => `<button type="button" class="tog__opt${f.variant === v ? ' on' : ''}" data-wrvariant="${v}" aria-pressed="${f.variant === v}"><b>${esc(t(key))}</b><span>${esc(sub(v))}</span></button>`;
  const seg = hasAlt ? `<div class="tog" role="group" aria-label="${esc(t('weekrooster.flow.segAria'))}">${opt('best', 'weekrooster.flow.segAdvice')}${opt('alt', 'weekrooster.flow.segAlt')}</div>` : '';
  const n = stats.familiesChanged.length, m = stats.moved.length;
  const tiles = plan.fallback ? '' : `<div class="statTiles statTiles--3">${tile(String(m), movedLabel(m), false)}${tile(String(n), noticeLabel(n), false)}${waitTile(stats)}</div>${waitSumHtml(adv, plan, stats)}`;
  const unplaced = stats.problems.filter(p => p.key === 'unplaced').flatMap(p => p.ids);
  return {
    body: `<div class="flowStack">${seg}${plan.fallback ? `<p class="noteCard">${phIcon('info')}<span>${esc(t('weekrooster.flow.notFit'))}</span></p>` : ''}${tiles}
      ${Object.keys(plan.dirs).map(dir => sceneHtml(dir, adv, plan, stats, f.editDir)).join('')}
      ${plan.blocked ? `<div class="noteLine">${esc(t('weekrooster.advice.noSolution'))}</div>` : ''}
      ${unplaced.length ? `<div class="noteLine">${esc(t('weekrooster.flow.unplaced', { p1: sortGirlIds(unplaced).map(rawGirl).join(', ') }))}</div>` : ''}</div>`,
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
  const lines = Object.entries(plan.dirs).map(([dir, p]) => `<div class="planSum__group scene--${dir}"><div class="planSum__dir"><span class="scene__badge">${phIcon(dir === 'heen' ? 'sun' : 'moon')}</span>${esc(t(dir === 'heen' ? 'dir.heenShort' : 'dir.terugShort'))}</div>${
    p.cars.filter(c => c.girlIds.length).map(quietRowHtml).join('')}</div>`).join('');
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
  const adv = adviceOf(f);
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
// `from` ('Right' | 'Left'): a follow-up screen inside the same sheet; the sheet itself stays, only the content slides in from that side.
function overlay(inner, from = '') {
  closeSheet();
  const ov = document.createElement('div'); ov.className = 'sheetOverlay' + (from ? ' sheetOverlay--still' : ''); ov.id = 'sheetOverlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"><div class="sheet__handle"></div><div class="sheetPane${from ? ' sheetPane--from' + from : ''}">${inner}</div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) closeSheet(); });
  return ov;
}
const redraw = () => renderSchedule();
const currentCars = (adv, f, dir) => planOf(adv, f.variant, f.edits).dirs[dir].cars;
// The cars of one direction by hand; the lists of girls taken out / added follow (a girl in a car is not "out"; an added girl who left again is not "added").
function setCars(f, dir, cars) {
  const inCar = id => cars.some(c => c.girlIds.includes(id));
  const off = ((f.edits.off || {})[dir] || []).filter(id => !inCar(id)), add = Object.fromEntries(Object.entries((f.edits.add || {})[dir] || {}).filter(([id]) => inCar(id)));
  f.edits = { ...f.edits, [dir]: cars, off: { ...f.edits.off, [dir]: off }, add: { ...f.edits.add, [dir]: add } };
}

// A girl to another car: the cars of this shift, with the time, the free seats and what it means for her.
function openGirlSheet(dir, id) {
  const f = flowState(), adv = adviceOf(f), d = adv.directions[dir], cars = currentCars(adv, f, dir);
  const here = cars.find(c => c.girlIds.includes(id)), ev0 = evaluateCars(d.ctx, cars), tm = timeAfter(d.ctx, id);
  const items = cars.map(c => {
    const free = seats(fam(c.driverFamilyId)) - c.girlIds.length + (c.girlIds.includes(id) ? 1 : 0);
    const next = withGirlIn(d.ctx, [...cars], id, c.driverFamilyId);
    const ev = evaluateCars(d.ctx, next), w = ev.waitOf[id];
    const nextCar = next.find(x => x.driverFamilyId === c.driverFamilyId), nextDep = (nextCar && nextCar.departureTime) || c.departureTime || '--:--';
    const bits = [c === here ? t('weekrooster.flow.pickHere') : free <= 0 ? t('weekrooster.flow.pickFull') : t(free === 1 ? 'weekrooster.flow.pickSeats1' : 'weekrooster.flow.pickSeatsN', { p1: free })];
    const more = [];
    if (c !== here && free > 0) {
      bits.push(w < 0 ? t('weekrooster.flow.pickLate') : w > 0 ? t('weekrooster.flow.pickWait', { p1: w }) : '');
      if (nextDep !== (c.departureTime || '--:--')) more.push(t('weekrooster.flow.pickDepChange', { p1: nextDep, p2: rawGirl(id) }));
      const worse = (nextCar ? nextCar.girlIds : []).filter(o => o !== id && Math.max(0, ev.waitOf[o] || 0) > Math.max(0, ev0.waitOf[o] || 0));
      if (worse.length) more.push(t(worse.length === 1 ? 'weekrooster.flow.pickOthers1' : 'weekrooster.flow.pickOthersN', { p1: niceList(sortGirlIds(worse).map(rawGirl)) }));
    }
    return { icon: c === here ? 'check' : 'arrows-left-right', muted: c !== here && free <= 0,
      label: esc(t('weekrooster.flow.pickItem', { p1: fam(c.driverFamilyId).parentName || '?', p2: c.departureTime || '--:--' })),
      sub: esc(bits.filter(Boolean).join(' · ')), more: more.map(esc),
      onClick: () => { if (c === here || free <= 0) return; setCars(f, dir, withGirlIn(d.ctx, cars, id, c.driverFamilyId)); redraw(); } };
  });
  const ov = overlay(`<h3 id="sheetTitle">${esc(t('weekrooster.flow.pickTitle', { p1: girlName(id) }))}</h3><p class="sheet__sub">${esc(t('weekrooster.flow.pickSubTime', { p1: tm || '--:--' }))}</p>
    ${items.map((it, i) => `<button type="button" class="sheetItem${it.muted ? ' sheetItem--muted' : ''}" data-sheetidx="${i}">${phIcon(it.icon)}<span class="sheetItem__label">${it.label}<span class="sheetItem__more">${[it.sub, ...it.more].filter(Boolean).join('</span><span class="sheetItem__more">')}</span></span></button>`).join('')}
    ${here ? `<button type="button" class="sheetItem sheetItem--remove" data-sheetremove="1">${phIcon('x')}<span class="sheetItem__label">${esc(t('weekrooster.flow.removeItem'))}</span></button>` : ''}`);
  ov.querySelectorAll('[data-sheetidx]').forEach(b => b.onclick = () => { const it = items[+b.dataset.sheetidx]; closeSheet(); it.onClick(); });
  ov.querySelectorAll('[data-sheetremove]').forEach(b => b.onclick = () => { closeSheet(); askRemove(dir, id); });
}
// Out of the car: asks first. She then rides no car in this direction (a car left without girls goes too).
function askRemove(dir, id) {
  const f = flowState(), adv = adviceOf(f), d = adv.directions[dir], cars = currentCars(adv, f, dir);
  const here = cars.find(c => c.girlIds.includes(id)); if (!here) return;
  const last = here.girlIds.length === 1;
  const ov = overlay(`<h3 id="sheetTitle">${esc(t('weekrooster.flow.removeTitle', { p1: rawGirl(id) }))}</h3>
    <p class="sheet__sub">${esc(t('weekrooster.flow.removeText', { p1: rawGirl(id), p2: t(dir === 'heen' ? 'dir.heenShort' : 'dir.terugShort').toLowerCase() }))}${last ? ' ' + esc(t('weekrooster.flow.removeLast', { p1: rawParent(here.driverFamilyId) })) : ''}</p>
    <div class="sheet__actions"><button type="button" class="btn secondary" id="wrRemoveNo">${esc(t('weekrooster.flow.removeNo'))}</button><button type="button" class="btn" id="wrRemoveYes">${esc(t('weekrooster.flow.removeYes'))}</button></div>`);
  document.getElementById('wrRemoveNo').onclick = () => { hapticTap(); closeSheet(); };
  document.getElementById('wrRemoveYes').onclick = () => {
    hapticTap(); closeSheet();
    const wasRiding = !!timeAfter(adviceForDay(f.day).directions[dir].ctx, id);   // only a girl who rode before is stored as "does not ride"
    setCars(f, dir, withoutGirl(d.ctx, cars, id));
    if (wasRiding) f.edits = { ...f.edits, off: { ...f.edits.off, [dir]: [...new Set([...((f.edits.off || {})[dir] || []), id])] } };
    redraw();
  };
}
// The sum behind "extra wachten": per direction, per person the waiting now (old times, the cars as they are) against the proposal.
// Any tap closes it (no button needed).
function openWaitSheet() {
  const f = flowState(), adv = adviceOf(f), plan = planOf(adv, f.variant, f.edits);
  let extra = 0;
  const groups = Object.keys(plan.dirs).map(dir => {
    const d = adv.directions[dir], ev = evaluateCars(d.ctx, plan.dirs[dir].cars);
    const ids = sortGirlIds([...new Set([...Object.keys(ev.baseOf), ...Object.keys(ev.waitOf)])]);
    const dirExtra = Math.max(0, ev.waitMinutes - ev.baseWait); extra += dirExtra;
    const min = n => t('weekrooster.flow.calcMin', { p1: n });
    const rows = ids.map(id => `<div class="waitCalc__row"><span>${girlName(id)}</span><span class="waitCalc__num">${ev.baseOf[id] == null ? '–' : esc(min(ev.baseOf[id]))}</span><span class="waitCalc__num">${ev.waitOf[id] == null ? '–' : esc(min(Math.max(0, ev.waitOf[id])))}</span></div>`).join('');
    return `<section class="adjDir scene--${dir}"><div class="adjDir__head"><span class="scene__badge">${phIcon(dir === 'heen' ? 'sun' : 'moon')}</span>${esc(t(dir === 'heen' ? 'dir.heenShort' : 'dir.terugShort'))}</div>
      <div class="waitCalc__row waitCalc__row--head"><span></span><span class="waitCalc__num">${esc(t('weekrooster.flow.calcNow'))}</span><span class="waitCalc__num">${esc(t('weekrooster.flow.calcPlan'))}</span></div>${rows}
      <div class="waitCalc__row waitCalc__row--sum"><span>${esc(t('weekrooster.flow.calcTotal'))}</span><span class="waitCalc__num">${esc(min(ev.baseWait))}</span><span class="waitCalc__num">${esc(min(ev.waitMinutes))}</span></div>
      <p class="waitCalc__result">${esc(t('weekrooster.flow.calcDir', { p1: ev.waitMinutes, p2: ev.baseWait, p3: dirExtra }))}</p></section>`;
  }).join('');
  const ov = overlay(`<h3 id="sheetTitle">${esc(t('weekrooster.flow.calcTitle'))}</h3><p class="sheet__sub">${esc(t('weekrooster.flow.calcSub'))}</p>${groups}
    <p class="waitCalc__final"><b>${esc(t('weekrooster.flow.calcFinal', { p1: extra }))}</b></p><p class="sheet__sub">${esc(t('weekrooster.flow.calcClose'))}</p>`);
  ov.addEventListener('click', closeSheet);   // every tap closes
}
// Add a passenger to this car: the girls of the other cars and who is not placed. "Ook speelsters zonder rit" (one more tap) lists the ones with no ride this way
// (flex players, a girl who is not on the standard rooster); for them the time is asked first.
function openAddSheet(dir, driverId, more, from = '') {
  const f = flowState(), adv = adviceOf(f), d = adv.directions[dir], cars = currentCars(adv, f, dir);
  const target = cars.find(c => c.driverFamilyId === driverId); if (!target) return;
  const ev0 = evaluateCars(d.ctx, cars), riding = new Set(cars.flatMap(c => c.girlIds));
  const askedBy = new Map(d.ctx.requests.filter(r => !r.manual).map(r => [r.familyId, r]));
  const out = d.ctx.requests.filter(r => r.manual && !r.rides).map(r => r.familyId);
  const loose = [...new Set([...askedBy.keys(), ...out, ...ev0.moved])].filter(id => !riding.has(id));
  const ids = sortGirlIds([...cars.filter(c => c !== target).flatMap(c => c.girlIds), ...loose]);
  const rest = sortGirlIds(Object.keys(S.families).filter(id => !riding.has(id) && !loose.includes(id) && (fam(id).girlName || fam(id).parentName)));
  const items = (more ? rest : ids).map(id => {
    if (more) return { id, label: esc(rawGirl(id) + (isFlex(fam(id)) ? ' · ' + t('flex.chip') : '')), sub: esc(t('weekrooster.flow.addNoRide')) };
    const from = cars.find(c => c.girlIds.includes(id)), next = withGirlIn(d.ctx, [...cars], id, driverId), ev = evaluateCars(d.ctx, next), w = ev.waitOf[id];
    const nextCar = next.find(x => x.driverFamilyId === driverId), nextDep = (nextCar && nextCar.departureTime) || target.departureTime || '--:--';
    const bits = [from ? t('weekrooster.flow.addNow', { p1: fam(from.driverFamilyId).parentName || '?', p2: timeAfter(d.ctx, id) || '--:--' }) : t('weekrooster.flow.addNone'), w < 0 ? t('weekrooster.flow.pickLate') : w > 0 ? t('weekrooster.flow.pickWait', { p1: w }) : ''];
    if (nextDep !== (target.departureTime || '--:--')) bits.push(t('weekrooster.flow.pickDepChange', { p1: nextDep, p2: rawGirl(id) }));
    return { id, label: esc(rawGirl(id)), sub: esc(bits.filter(Boolean).join(' · ')) };
  });
  const list = items.length ? items.map((it, i) => `<button type="button" class="sheetItem" data-sheetidx="${i}">${phIcon('arrows-left-right')}<span class="sheetItem__label">${it.label}<span class="sheetItem__more">${it.sub}</span></span></button>`).join('') : `<p class="sheet__sub">${esc(t('weekrooster.flow.addEmpty'))}</p>`;
  // The first screen ends with a menu item to the second (to the right); the second has a way back (to the left).
  const foot = more ? '' : `<button type="button" class="sheetItem sheetItem--menu" data-sheetmore="1">${phIcon('users')}<span class="sheetItem__label">${esc(t('weekrooster.flow.addMore'))}<span class="sheetItem__more">${esc(t('weekrooster.flow.addMoreSub'))}</span></span>${phIcon('caret-right')}</button>`;
  const head = more
    ? `<div class="sheetHead"><button type="button" class="roundBtn" id="wrSheetBack" aria-label="${esc(t('weekrooster.flow.prev'))}">${phIcon('arrow-left')}</button><div><h3 id="sheetTitle">${esc(t('weekrooster.flow.addMore'))}</h3><p class="sheet__sub">${esc(t('weekrooster.flow.addSub', { p1: fam(driverId).parentName || '?' }))}</p></div></div>`
    : `<h3 id="sheetTitle">${esc(t('weekrooster.flow.addTitle'))}</h3><p class="sheet__sub">${esc(t('weekrooster.flow.addSub', { p1: fam(driverId).parentName || '?' }))}</p>`;
  const ov = overlay(`${head}${list}${foot}`, from);
  const back = document.getElementById('wrSheetBack'); if (back) back.onclick = () => { hapticTap(); openAddSheet(dir, driverId, false, 'Left'); };
  ov.querySelectorAll('[data-sheetmore]').forEach(b => b.onclick = () => { hapticTap(); openAddSheet(dir, driverId, true, 'Right'); });
  ov.querySelectorAll('[data-sheetidx]').forEach(b => b.onclick = () => {
    const it = items[+b.dataset.sheetidx]; closeSheet();
    if (!more) { setCars(f, dir, withGirlIn(d.ctx, cars, it.id, driverId)); redraw(); return; }
    askTime(dir, driverId, it.id);
  });
}
// A girl without a ride this way: her time first (heen: when she must be there; terug: when she is ready), then she joins the car.
function askTime(dir, driverId, id) {
  const f = flowState(), adv = adviceOf(f), d = adv.directions[dir], cars = currentCars(adv, f, dir);
  const target = cars.find(c => c.driverFamilyId === driverId); if (!target) return;
  const guess = (target.girlIds.map(g => timeAfter(d.ctx, g)).filter(Boolean).sort()[0]) || '';
  const ov = overlay(`<h3 id="sheetTitle">${esc(t('weekrooster.flow.timeTitle', { p1: rawGirl(id) }))}</h3>
    <label class="devField"><span>${esc(t(dir === 'heen' ? 'weekrooster.flow.timeHeen' : 'weekrooster.flow.timeTerug'))}</span><input type="time" class="devInput timeBig" id="wrAddTime" value="${esc(guess)}"></label>
    <div class="sheet__actions"><button type="button" class="btn secondary" id="wrTimeNo">${esc(t('weekrooster.flow.removeNo'))}</button><button type="button" class="btn" id="wrTimeYes">${esc(t('weekrooster.flow.timeAdd'))}</button></div>`);
  document.getElementById('wrTimeNo').onclick = () => { hapticTap(); closeSheet(); };
  document.getElementById('wrTimeYes').onclick = () => {
    const tm = (document.getElementById('wrAddTime') || {}).value || ''; if (!tm) return;
    hapticTap(); closeSheet();
    f.edits = { ...f.edits, add: { ...f.edits.add, [dir]: { ...((f.edits.add || {})[dir] || {}), [id]: tm } } };
    const next = withManual(adviceForDay(f.day), f.edits).directions[dir].ctx;
    setCars(f, dir, withGirlIn(next, cars, id, driverId)); redraw();
  };
}

// The fields inside the car cards (Aanpassen): every change is worked into the plan at once and the screen is drawn again.
function wireEdit(box) {
  const f = flowState(); if (!f) return;
  const adv = adviceOf(f);
  const apply = (dir, fn) => { const cars = currentCars(adv, f, dir); setCars(f, dir, fn(adv.directions[dir].ctx, cars)); redraw(); };
  const parts = el => el.dataset.key.split('|');
  box.querySelectorAll('[data-adj]').forEach(el => {
    const kind = el.dataset.adj;
    if (kind === 'depreset') { el.onclick = () => { hapticTap(); const [dir, id] = parts(el); apply(dir, (ctx, cars) => withDeparture(ctx, cars, id, '')); }; return; }
    if (kind === 'dest') { el.onclick = () => { hapticTap(); const [dir, id] = parts(el); apply(dir, (ctx, cars) => withDestination(cars, id, el.dataset.dest)); }; return; }
    el.onchange = () => {
      if (kind === 'addcar') { if (el.value) apply(el.dataset.dir, (ctx, cars) => withNewCar(cars, el.value)); return; }
      const [dir, id] = parts(el);
      if (kind === 'deptime') apply(dir, (ctx, cars) => withDeparture(ctx, cars, id, el.value));
      else if (kind === 'driver') apply(dir, (ctx, cars) => withDriver(cars, id, el.value));
      else if (kind === 'place') {
        if (el.value === '__free') { S.adjFree = el.dataset.key; redraw(); return; }
        S.adjFree = null; apply(dir, (ctx, cars) => withPlace(cars, id, el.value ? { locationId: el.value } : {}));
      } else if (kind === 'placetext') apply(dir, (ctx, cars) => withPlace(cars, id, el.value.trim() ? { locationText: el.value.trim().slice(0, FREE_TEXT_MAX) } : {}));
    };
  });
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
  box.querySelectorAll('[data-wradjust]').forEach(b => b.onclick = () => { hapticTap(); const f = flowState(); if (!f) return; f.editDir = f.editDir === b.dataset.wradjust ? null : b.dataset.wradjust; S.adjFree = null; renderSchedule(); });
  box.querySelectorAll('[data-wradd]').forEach(b => b.onclick = () => { hapticTap(); const [dir, id] = b.dataset.wradd.split('|'); openAddSheet(dir, id); });
  wireEdit(box);
  box.querySelectorAll('[data-wrwait]').forEach(b => b.onclick = () => { hapticTap(); openWaitSheet(); });
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
