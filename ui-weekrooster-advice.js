// ui-weekrooster-advice.js — Afwijkend weekrooster, phase 4: the "Advies" view in Rooster (Deze week) for the day coordinator.
// One screen for the whole day: the card with the requests on top, then heen and terug as the advice (Zuinigst) with what changes,
// and one "Overnemen" for the whole day. It makes the one-off change through the same deviations as Wijzigen (weekrooster-data.js
// acceptDay). After it: the toast with "Ongedaan" and the Dagbericht (the existing conclusieCard) ready to share.
import { t } from './i18n.js';
import { S } from './state.js';
import { esc, hapticTap, phIcon, showToast } from './ui-common.js';
import { driverNameHtml, fam, girlName, seats, sortGirlIds } from './rides.js';
import { isoDayLabel, weekKeyDayIso } from './dates.js';
import { conclusieCardHtml, devDirHeader, wireWhatsAppButton } from './ui-deviation.js';
import { buildConclusieMessage } from './message-texts.js';
import { renderSchedule } from './ui-schedule.js';
import { renderMyWeek } from './ui-myweek.js';
import { acceptDay, adviceForDay } from './weekrooster-data.js';
import { dayName, weekroosterActive } from './ui-weekrooster-form.js';
import { openDayEditor } from './ui-weekrooster-edit.js';
import { actionCardHtml } from './ui-weekrooster-rooster.js';

const dayLabel = dayName;
const names = ids => sortGirlIds(ids).map(id => girlName(id)).join(' & ');

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

// ---------- the view ----------
const VARIANT = 'zuinig';   // the advice of the screen: the fewest cars (the engine still knows 'gedoe', the screen does not offer it)
export function scheduleAdviceHtml() {
  if (!weekroosterActive()) return '';
  if (S.wrDone) return doneHtml(S.wrDone);
  const a = S.wrAdvice; if (!a) return '';
  const adv = adviceForDay(a.day), dirs = Object.keys(adv.directions);
  if (!dirs.length) { S.wrAdvice = null; return ''; }   // nothing (left) to advise: somebody decided, or the request ran out
  const iso = weekKeyDayIso(S.currentWeekKey, a.day);
  const blocked = dirs.some(k => adv.directions[k].variants[VARIANT].noSolution);
  const sections = dirs.map(k => {
    const d = adv.directions[k], v = d.variants[VARIANT];
    const now = d.cars.filter(c => (c.girlIds || []).length);
    return `<section class="wrStack wrStack--tight">${devDirHeader(k, v.cars)}${adviceCarsHtml(now, v.cars)}</section>`;
  }).join('');
  return `<div class="wrStack" id="wrAdvice">
    <button type="button" class="linkbtn" id="wrAdviceBack">${phIcon('arrow-left')}${esc(t('weekrooster.advice.back'))}</button>
    <div class="sectionHead"><div class="sectionHead__title">${esc(t('weekrooster.advice.headline', { p1: `${dayLabel(a.day).toLowerCase()} ${isoDayLabel(iso, '')}` }))}</div></div>
    ${actionCardHtml(a.day)}
    ${sections}
    ${blocked ? `<div class="noteLine">${esc(t('weekrooster.advice.noSolution'))}</div>` : ''}
    <div class="actionBar"><button type="button" class="btn secondary" id="wrSelf">${esc(t('weekrooster.edit.self'))}</button><button type="button" class="btn" id="wrAccept"${blocked ? ' disabled' : ''}>${phIcon('check')}${esc(t('weekrooster.advice.accept'))}</button></div></div>`;
}

function doneHtml(done) {
  return `<div class="wrStack"><div class="card" id="wrApplied"><h2>${phIcon('check')} ${esc(t('weekrooster.advice.applied', { p1: dayLabel(done.day).toLowerCase() }))}</h2>
      <button type="button" class="linkbtn" id="wrDoneClose">${esc(t('weekrooster.advice.closeDone'))}</button></div>${conclusieCardHtml(done.day)}</div>`;
}

// ---------- wiring ----------
const rerender = () => { renderSchedule(); renderMyWeek(); };
export function wireAdvice(box) {
  box.querySelectorAll('[data-wradvice]').forEach(b => b.onclick = () => { hapticTap(); S.wrAdvice = { day: b.dataset.wradvice }; S.wrDone = null; renderSchedule(); });
  const back = document.getElementById('wrAdviceBack'); if (back) back.onclick = () => { hapticTap(); S.wrAdvice = null; renderSchedule(); };
  const accept = document.getElementById('wrAccept');
  if (accept) accept.onclick = async () => {
    hapticTap();
    const { day } = S.wrAdvice;
    const r = await acceptDay(day, VARIANT);
    if (!r.ok) return;
    S.wrAdvice = null; S.wrDone = { day };
    showToast(t(r.n === 1 ? 'weekrooster.advice.doneOne' : 'weekrooster.advice.doneMany', { p1: r.n }), {
      action: { label: t('deviation.ongedaan'), run: async () => { if (await r.undo()) { S.wrDone = null; S.wrAdvice = { day }; showToast(t('weekrooster.advice.undone')); rerender(); } } },
    });
    rerender();
  };
  const self = document.getElementById('wrSelf'); if (self) self.onclick = () => { hapticTap(); openDayEditor(S.wrAdvice.day); };
  const close = document.getElementById('wrDoneClose'); if (close) close.onclick = () => { hapticTap(); S.wrDone = null; renderSchedule(); };
  wireWhatsAppButton('conclusieBtn', () => buildConclusieMessage(S.wrDone ? S.wrDone.day : S.scheduleDay));
}
