// ui-weekrooster-edit.js — Afwijkend weekrooster, phase 5: planning a day by hand in Rooster "Deze week" (one screen: the request card on top,
// heen and terug, "Klaar" at the bottom; every change saves at once).
// "Zelf indelen" (the day coordinator, the real coordinator) and "Toch zelf wijzigen" (any parent, after a warning) open the SAME car
// editor Wijzigen always had (devRide / devForm, renderDevDirection) — only its place moved. Nothing new is stored except that a change
// by someone who does not decide that day is marked on the deviation (selfBy, selfAt), so the day coordinator sees "Zelf gewijzigd".
import { t } from './i18n.js';
import { S } from './state.js';
import { closeSheet, esc, hapticTap, phIcon } from './ui-common.js';
import { isoDayLabel, weekKeyDayIso } from './dates.js';
import { activateTab } from './app.js';
import { attachDeviationHandlers, conclusieCardHtml, renderDevDirection } from './ui-deviation.js';
import { renderSchedule } from './ui-schedule.js';
import { adviceForDay, myDeciderDays } from './weekrooster-data.js';
import { dayName, deciderLabel, weekroosterActive } from './ui-weekrooster-form.js';
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

// The editor, in place of the day. Empty when closed or when the switch is off for this person.
export function scheduleEditHtml() {
  if (!weekroosterActive() || !S.wrEdit) return '';
  const { day, override } = S.wrEdit;
  const iso = weekKeyDayIso(S.currentWeekKey, day);
  return `<div class="wrStack" id="wrEdit">
    <button type="button" class="linkbtn" id="wrEditBack">${phIcon('arrow-left')}${esc(t('weekrooster.advice.back'))}</button>
    <div class="sectionHead"><div class="sectionHead__title">${esc(t('weekrooster.edit.headline', { p1: `${dayName(day).toLowerCase()} ${isoDayLabel(iso, '')}` }))}</div></div>
    ${override ? `<p class="noteLine">${esc(t('weekrooster.edit.override', { p1: deciderLabel(day) }))}</p>` : ''}
    ${actionCardHtml(day, { advice: false })}
    <div class="daysection"><h3 class="srOnly">${esc(dayName(day))}</h3>${renderDevDirection(day, 'heen')}${renderDevDirection(day, 'terug')}${conclusieCardHtml(day)}</div>
    <div class="actionBar">${hasAdvice(day) ? `<button type="button" class="btn secondary" id="wrEditAdvice">${esc(t('weekrooster.advice.look'))}</button>` : ''}<button type="button" class="btn" id="wrEditDone">${esc(t('deviation.klaar'))}</button></div></div>`;
}

// Under the day in Rooster "Deze week": the way into the editor. A planner: "Zelf indelen". Everybody else: the small link "Toch zelf wijzigen".
export function scheduleDayFootHtml(day) {
  if (!weekroosterActive() || S.wrEdit) return '';
  return mayPlanDay(day)
    ? `<button type="button" class="linkbtn" data-wredit="${day}">${esc(t('weekrooster.edit.self'))}</button>`
    : `<button type="button" class="linkbtn" data-wroverride="${day}">${esc(t('weekrooster.edit.override_link'))}</button>`;
}

export function wireEdit(box) {
  box.querySelectorAll('[data-wredit]').forEach(b => b.onclick = () => { hapticTap(); openDayEditor(b.dataset.wredit); });
  box.querySelectorAll('[data-wroverride]').forEach(b => b.onclick = () => { hapticTap(); openDayEditor(b.dataset.wroverride); });
  const adv = document.getElementById('wrEditAdvice'); if (adv) adv.onclick = () => { hapticTap(); const day = S.wrEdit.day; S.wrEdit = null; S.wrAdvice = { day }; S.wrDone = null; renderSchedule(); };
  for (const id of ['wrEditBack', 'wrEditDone']) { const b = document.getElementById(id); if (b) b.onclick = () => { hapticTap(); S.wrEdit = null; renderSchedule(); }; }
  if (S.wrEdit && weekroosterActive()) attachDeviationHandlers();
}
