// ui-weekrooster-advice.js — Afwijkend weekrooster, phase 4: the "Advies" view in Rooster (Deze week) for the day coordinator.
// Two variants (Zuinigst, Minste gedoe), what changes for whom, the reason (made from the planning, never typed), and "Overnemen",
// which makes the one-off change through the same deviations as Wijzigen (weekrooster-data.js acceptDay). After it: the toast with
// "Ongedaan" and the Dagbericht (the existing conclusieCard) ready to share.
import { t } from './i18n.js';
import { S } from './state.js';
import { esc, hapticTap, phIcon, showToast } from './ui-common.js';
import { driverNameHtml, fam, girlName, seats, sortGirlIds } from './rides.js';
import { isoDayLabel, weekKeyDayIso } from './dates.js';
import { conclusieCardHtml, wireWhatsAppButton } from './ui-deviation.js';
import { buildConclusieMessage } from './message-texts.js';
import { renderSchedule } from './ui-schedule.js';
import { renderMyWeek } from './ui-myweek.js';
import { ADVICE_VARIANTS, acceptDay, adviceForDay } from './weekrooster-data.js';
import { dayName, weekroosterActive } from './ui-weekrooster-form.js';
import { openDayEditor } from './ui-weekrooster-edit.js';

const dayLabel = dayName;
const names = ids => sortGirlIds(ids).map(id => girlName(id)).join(' & ');
const parentOf = id => esc(fam(id).parentName || '?');

// ---------- the sentences of the reason (from the facts of the planning) ----------
function reasonText(reasons) {
  return reasons.map(r => {
    const p = r.params || {};
    switch (r.key) {
      case 'out': return t('weekrooster.reason.out', { p1: names(p.ids) });
      case 'saves': return t(p.n === 1 ? 'weekrooster.reason.savesOne' : 'weekrooster.reason.savesMany', { p1: p.n });
      case 'extra': return t('weekrooster.reason.extra');
      case 'same': return t('weekrooster.reason.same');
      case 'free': return t(p.n === 1 ? 'weekrooster.reason.freeOne' : 'weekrooster.reason.freeMany', { p1: parentOf(p.id), p2: p.n });
      case 'keep': return t('weekrooster.reason.keep');
      case 'noSolution': return t('weekrooster.reason.noSolution');
      default: return '';
    }
  }).filter(Boolean).join(' ');
}

// ---------- the cards ----------
const sameKids = (a, b) => JSON.stringify([...(a.girlIds || [])].sort()) === JSON.stringify([...(b.girlIds || [])].sort());
const carHtml = (c, mark, old) => {
  const max = seats(fam(c.driverFamilyId));
  const was = old ? (old.girlIds || []) : [];
  const chips = sortGirlIds(c.girlIds).map(id => `<span class="chip${old && !was.includes(id) ? ' chip--add' : ''}">${old && !was.includes(id) ? '+ ' : ''}${girlName(id)}</span>`).join('')
    + (old ? sortGirlIds(was.filter(id => !c.girlIds.includes(id))).map(id => `<span class="chip chip--gone">${girlName(id)}</span>`).join('') : '');
  const tag = mark === 'new' ? `<span class="tag tag--warn">${esc(t('weekrooster.advice.new'))}</span>` : '';
  return `<div class="carCard${mark ? ' carCard--changed' : ''}">
    <div class="carCard__head"><span class="carCard__time">${esc(c.departureTime || '--:--')}</span>
      <div class="carCard__who"><span class="carCard__driver">${driverNameHtml(c.driverFamilyId)}</span>${tag}</div>
      <span class="tag">${c.girlIds.length}/${max}</span></div>
    <div class="chips">${chips}</div>
    ${old && mark === 'changed' ? `<div class="diffLabel">${esc(sameKids(c, old) ? t('weekrooster.advice.beforeTime', { p1: old.departureTime || '--:--' }) : t('weekrooster.advice.before', { p1: names(was) }))}</div>` : ''}
  </div>`;
};
const goneHtml = c => `<div class="carCard carCard--gone"><div class="carCard__head"><span class="carCard__time">${esc(c.departureTime || '--:--')}</span>
  <div class="carCard__who"><span class="carCard__driver">${driverNameHtml(c.driverFamilyId)}</span></div><span class="tag">${esc(t('weekrooster.advice.gone'))}</span></div></div>`;

function adviceCarsHtml(now, next) {
  const out = next.map(c => {
    const old = now.find(o => o.driverFamilyId === c.driverFamilyId);
    const same = old && JSON.stringify([...old.girlIds].sort()) === JSON.stringify([...c.girlIds].sort()) && (old.departureTime || '') === (c.departureTime || '');
    return carHtml(c, !old ? 'new' : same ? '' : 'changed', old);
  });
  const gone = now.filter(o => (o.girlIds || []).length && !next.some(c => c.driverFamilyId === o.driverFamilyId)).map(goneHtml);
  return out.concat(gone).join('');
}

const signed = n => (n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '±0');

// ---------- the view ----------
export function scheduleAdviceHtml() {
  if (!weekroosterActive()) return '';
  if (S.wrDone) return doneHtml(S.wrDone);
  const a = S.wrAdvice; if (!a) return '';
  const adv = adviceForDay(a.day), dirs = Object.keys(adv.directions);
  if (!dirs.length) { S.wrAdvice = null; return ''; }   // nothing (left) to advise: somebody decided, or the request ran out
  const direction = dirs.includes(a.direction) ? a.direction : dirs[0];
  const variant = ADVICE_VARIANTS.includes(a.variant) ? a.variant : 'zuinig';
  const d = adv.directions[direction], v = d.variants[variant];
  const now = d.cars.filter(c => (c.girlIds || []).length);
  const diff = v.carsAfter - d.carsBefore, n = v.familiesChanged.length;
  const iso = weekKeyDayIso(S.currentWeekKey, a.day);
  const seg = (attr, items, cur, aria) => `<div class="segmented" role="group" aria-label="${esc(t(aria))}">${items.map(([k, label]) => `<button type="button" class="${k === cur ? 'active' : ''}" ${attr}="${k}" aria-pressed="${k === cur}">${esc(label)}</button>`).join('')}</div>`;
  return `<div class="wrStack" id="wrAdvice">
    <button type="button" class="linkbtn" id="wrAdviceBack">${phIcon('arrow-left')}${esc(t('weekrooster.advice.back'))}</button>
    <div class="sectionHead"><div class="sectionHead__title">${esc(t('weekrooster.advice.headline', { p1: `${dayLabel(a.day).toLowerCase()} ${isoDayLabel(iso, '')}`, p2: t(direction === 'heen' ? 'weekrooster.advice.heen' : 'weekrooster.advice.terug').toLowerCase() }))}</div></div>
    ${dirs.length > 1 ? seg('data-wrdir', dirs.map(k => [k, t(k === 'heen' ? 'weekrooster.advice.heen' : 'weekrooster.advice.terug')]), direction, 'weekrooster.advice.dirAria') : ''}
    ${seg('data-wrvariant', ADVICE_VARIANTS.map(k => [k, t(k === 'zuinig' ? 'weekrooster.advice.zuinig' : 'weekrooster.advice.gedoe')]), variant, 'weekrooster.advice.variantAria')}
    <div class="chips">
      <span class="tag ${diff < 0 ? 'tag--ok' : diff > 0 ? 'tag--warn' : ''}">${esc(t(v.carsAfter === 1 ? 'weekrooster.advice.carsOne' : 'weekrooster.advice.carsMany', { p1: v.carsAfter, p2: signed(diff) }))}</span>
      <span class="tag">${esc(n === 0 ? t('weekrooster.advice.familiesNone') : t(n === 1 ? 'weekrooster.advice.familiesOne' : 'weekrooster.advice.familiesMany', { p1: n }))}</span>
    </div>
    <section class="wrStack wrStack--tight"><div class="sectionHead"><div class="sectionHead__title">${esc(t('weekrooster.advice.now'))}</div></div>
    ${now.map(c => carHtml(c, '', null)).join('') || `<p class="muted">${esc(t('weekrooster.advice.noCars'))}</p>`}</section>
    <section class="wrStack wrStack--tight"><div class="sectionHead"><div class="sectionHead__title">${esc(t('weekrooster.advice.advice'))}</div></div>
    ${adviceCarsHtml(now, v.cars)}</section>
    <div class="noteLine" id="wrReason">${esc(t('weekrooster.reason.prefix'))} ${reasonText(v.reasons)}</div>
    <div class="actionBar"><button type="button" class="btn secondary" id="wrSelf">${esc(t('weekrooster.edit.self'))}</button><button type="button" class="btn" id="wrAccept"${dirs.some(k => adv.directions[k].variants[variant].noSolution) ? ' disabled' : ''}>${phIcon('check')}${esc(t('weekrooster.advice.accept'))}</button></div></div>`;
}

function doneHtml(done) {
  return `<div class="wrStack"><div class="card" id="wrApplied"><h2>${phIcon('check')} ${esc(t('weekrooster.advice.applied', { p1: dayLabel(done.day).toLowerCase() }))}</h2>
      <button type="button" class="linkbtn" id="wrDoneClose">${esc(t('weekrooster.advice.closeDone'))}</button></div>${conclusieCardHtml(done.day)}</div>`;
}

// ---------- wiring ----------
const rerender = () => { renderSchedule(); renderMyWeek(); };
export function wireAdvice(box) {
  box.querySelectorAll('[data-wradvice]').forEach(b => b.onclick = () => { hapticTap(); S.wrAdvice = { day: b.dataset.wradvice, direction: 'heen', variant: 'zuinig' }; S.wrDone = null; renderSchedule(); });
  const back = document.getElementById('wrAdviceBack'); if (back) back.onclick = () => { hapticTap(); S.wrAdvice = null; renderSchedule(); };
  box.querySelectorAll('[data-wrdir]').forEach(b => b.onclick = () => { hapticTap(); S.wrAdvice = { ...S.wrAdvice, direction: b.dataset.wrdir }; renderSchedule(); });
  box.querySelectorAll('[data-wrvariant]').forEach(b => b.onclick = () => { hapticTap(); S.wrAdvice = { ...S.wrAdvice, variant: b.dataset.wrvariant }; renderSchedule(); });
  const accept = document.getElementById('wrAccept');
  if (accept) accept.onclick = async () => {
    hapticTap();
    const { day, variant } = S.wrAdvice;
    const r = await acceptDay(day, variant);
    if (!r.ok) return;
    S.wrAdvice = null; S.wrDone = { day };
    showToast(t(r.n === 1 ? 'weekrooster.advice.doneOne' : 'weekrooster.advice.doneMany', { p1: r.n }), {
      action: { label: t('deviation.ongedaan'), run: async () => { if (await r.undo()) { S.wrDone = null; S.wrAdvice = { day, direction: 'heen', variant }; showToast(t('weekrooster.advice.undone')); rerender(); } } },
    });
    rerender();
  };
  const self = document.getElementById('wrSelf'); if (self) self.onclick = () => { hapticTap(); openDayEditor(S.wrAdvice.day); };
  const close = document.getElementById('wrDoneClose'); if (close) close.onclick = () => { hapticTap(); S.wrDone = null; renderSchedule(); };
  wireWhatsAppButton('conclusieBtn', () => buildConclusieMessage(S.wrDone ? S.wrDone.day : S.scheduleDay));
}
