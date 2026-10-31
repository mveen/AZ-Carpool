// ui-weekrooster-edit.js — Afwijkend weekrooster, phase 5: planning a day by hand in Rooster "Deze week" (one screen: the request card on top,
// heen and terug, "Klaar" at the bottom; every change saves at once).
// "Zelf indelen" (the day coordinator, the real coordinator) and "Toch zelf wijzigen" (any parent, after a warning) open the SAME car
// editor Wijzigen always had (devRide / devForm, renderDevDirection) — only its place moved. Nothing new is stored except that a change
// by someone who does not decide that day is marked on the deviation (selfBy, selfAt), so the day coordinator sees "Zelf gewijzigd".
import { t } from './i18n.js';
import { S } from './state.js';
import { closeSheet, esc, hapticTap, phIcon, showToast } from './ui-common.js';
import { isoDayLabel, weekKeyDayIso } from './dates.js';
import { activateTab } from './app.js';
import { attachDeviationHandlers, conclusieCardHtml, renderDevDirection, wireWhatsAppButton } from './ui-deviation.js';
import { renderSchedule } from './ui-schedule.js';
import { adviceForDay, closeDayRequests, myDeciderDays } from './weekrooster-data.js';
import { renderMyWeek } from './ui-myweek.js';
import { dayName, deciderLabel, weekroosterActive } from './ui-weekrooster-form.js';
import { activeDeviation } from './rides.js';
import { pendingOfDay } from './weekrooster-data.js';
import { buildConclusieMessage } from './message-texts.js';
import { actionCardHtml } from './ui-weekrooster-rooster.js';

// Who may plan a day directly: the day coordinator of that day and the real coordinator.
export const mayPlanDay = day => !!S.canEdit || myDeciderDays().includes(day);

// Every way into the day editor ends here: planners go straight in, everybody else gets the warning first.
export function openDayEditor(day) {
  if (mayPlanDay(day)) return startEdit(day, false);
  askOverride(day);
}

function startEdit(day, override) {
  S.wrEdit = { day, override }; S.wrAdvice = null; S.wrDone = null;
  S.scheduleDay = day; S.roosterMode = 'week'; S.devKid = null; S.devUndo = null;
  renderSchedule(); activateTab('schedule');
}

// The sheet "Dagcoördinator beslist": the name of the coordinator of THAT day, then Doorgaan or Terug.
function askOverride(day) {
  closeSheet();
  const ov = document.createElement('div'); ov.className = 'sheetOverlay'; ov.id = 'sheetOverlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="sheet__handle"></div>
    <h3 id="sheetTitle">${esc(t('weekrooster.override.title'))}</h3>
    <p class="sheet__sub">${esc(t('weekrooster.override.text', { p1: deciderLabel(day) }))}</p>
    <div class="sheet__actions"><button type="button" class="btn secondary" id="wrOverrideBack">${esc(t('weekrooster.override.back'))}</button><button type="button" class="btn" id="wrOverrideGo">${esc(t('weekrooster.override.go'))}</button></div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) closeSheet(); });
  document.getElementById('wrOverrideBack').onclick = () => { hapticTap(); closeSheet(); };
  document.getElementById('wrOverrideGo').onclick = () => { hapticTap(); closeSheet(); startEdit(day, true); };
}

// Is there still an advice to look at for this day? Only for who decides the day: from the editor there is a way back to the Advies.
const hasAdvice = day => mayPlanDay(day) && Object.keys(adviceForDay(day).directions).length > 0;

// The editor, in place of the day. Empty when closed or for a person without a family of their own.
export function scheduleEditHtml() {
  if (!weekroosterActive() || !S.wrEdit) return '';
  const { day, override } = S.wrEdit;
  const iso = weekKeyDayIso(S.currentWeekKey, day);
  return `<div class="wrStack" id="wrEdit">
    <button type="button" class="linkbtn" id="wrEditBack">${phIcon('arrow-left')}${esc(t('weekrooster.advice.back'))}</button>
    <div class="sectionHead"><div class="sectionHead__title">${esc(t('weekrooster.edit.headline', { p1: `${dayName(day).toLowerCase()} ${isoDayLabel(iso, '')}` }))}</div></div>
    ${override ? `<p class="noteLine">${esc(t('weekrooster.edit.override', { p1: deciderLabel(day) }))}</p>` : ''}
    ${actionCardHtml(day, { advice: false, dots: true })}
    <div class="daysection"><h3 class="srOnly">${esc(dayName(day))}</h3>${renderDevDirection(day, 'heen')}${renderDevDirection(day, 'terug')}${pendingOfDay(day).length ? `<p class="noteLine reqDot">${esc(t('weekrooster.edit.legend'))}</p>` : ''}${conclusieCardHtml(day, { collapsed: true })}</div>
    ${hasAdvice(day) && (activeDeviation(day, 'heen') || activeDeviation(day, 'terug')) ? `<p class="noteCard" id="wrEditRecalc">${phIcon('info')}<span>${esc(t('weekrooster.edit.recalc'))}</span></p>` : ''}
    <div class="actionBar">${hasAdvice(day) ? `<button type="button" class="btn secondary" id="wrEditAdvice">${esc(t('weekrooster.advice.look'))}</button>` : ''}<button type="button" class="btn" id="wrEditDone">${esc(t('deviation.klaar'))}</button></div></div>`;
}

// Under the day in Rooster "Deze week": the small link "Toch zelf wijzigen" for everybody who does not plan the day.
// A planner has the button "Zelf indelen" on the line "Dagcoördinator {dag}" at the top (coordLineHtml in ui-weekrooster-rooster.js), so nothing here.
export function scheduleDayFootHtml(day) {
  if (!weekroosterActive() || S.wrEdit || mayPlanDay(day)) return '';
  return `<button type="button" class="linkbtn" data-wroverride="${day}">${esc(t('weekrooster.edit.override_link'))}</button>`;
}

async function settleDay(day) {
  const r = await closeDayRequests(day);
  if (!r.ok || !r.n) return;
  showToast(t(r.n === 1 ? 'weekrooster.edit.settledOne' : 'weekrooster.edit.settledMany', { p1: r.n }), {
    action: { label: t('deviation.ongedaan'), run: async () => { if (await r.undo()) { showToast(t('weekrooster.advice.undone')); renderSchedule(); renderMyWeek(); } } },
  });
  renderSchedule(); renderMyWeek();
}

export function wireEdit(box) {
  box.querySelectorAll('[data-wredit]').forEach(b => b.onclick = () => { hapticTap(); openDayEditor(b.dataset.wredit); });
  box.querySelectorAll('[data-wroverride]').forEach(b => b.onclick = () => { hapticTap(); openDayEditor(b.dataset.wroverride); });
  const adv = document.getElementById('wrEditAdvice'); if (adv) adv.onclick = () => { hapticTap(); const day = S.wrEdit.day; S.wrEdit = null; S.wrAdvice = { day, step: 'plan' }; S.wrDone = null; renderSchedule(); };
  const back = document.getElementById('wrEditBack'); if (back) back.onclick = () => { hapticTap(); S.wrEdit = null; renderSchedule(); };
  // Klaar = the day coordinator is done: the open requests of the day are settled. Not for "Toch zelf wijzigen" (a parent who does not decide).
  const done = document.getElementById('wrEditDone');
  if (done) done.onclick = () => {
    hapticTap();
    const { day, override } = S.wrEdit || {};
    S.wrEdit = null; renderSchedule();
    if (day && !override && mayPlanDay(day)) settleDay(day);
  };
  const tg = document.getElementById('conclusieToggle'); if (tg) tg.onclick = () => { hapticTap(); S.wrMsgOpen = !S.wrMsgOpen; renderSchedule(); };
  if (S.wrEdit) wireWhatsAppButton('conclusieBtn', () => buildConclusieMessage(S.wrEdit.day));
  if (S.wrEdit && weekroosterActive()) attachDeviationHandlers();
}
