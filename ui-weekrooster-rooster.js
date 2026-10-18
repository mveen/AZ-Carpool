// ui-weekrooster-rooster.js — Afwijkend weekrooster, phase 3: Rooster "Deze week" and the day coordinator's action card in Mijn week.
//   Day coordinator (of the days he decides): the amber "Actie nodig" block, the log "Recente wijzigingen", a dot on the day pill,
//   the number on the Rooster tab, and the card "Actie nodig voor {dag}" in Mijn week.
//   Parent: read only; the own request shows as a note on that day. Nobody else's request is shown to a parent.
// These are status views, not notifications. Everything here only exists while the switch is on for this person.
import { t } from './i18n.js';
import { S } from './state.js';
import { esc, hapticTap, phIcon, showToast } from './ui-common.js';
import { myFamilyId } from './coordinator.js';
import { girlName } from './rides.js';
import { contactButtonHtml } from './ui-contact.js';
import { activateTab } from './app.js';
import { renderSchedule } from './ui-schedule.js';
import { renderMyWeek } from './ui-myweek.js';
import { actionCounts, openRequestsOf, pendingForDay, recentChanges, selfChanges } from './weekrooster.js';
import { acceptDay, adviceForDay, dayEndMs, deciderFamilyOf, myDeciderDays, requestsForDeciding } from './weekrooster-data.js';
import { dayName, deciderLabel, deciderName, lower, summaryOf, upperFirst, weekroosterActive } from './ui-weekrooster-form.js';

const wk = () => S.currentWeekKey;
const counts = () => weekroosterActive() ? actionCounts(requestsForDeciding(), wk(), myDeciderDays(), Date.now(), day => dayEndMs(wk(), day)) : {};

// How many requests wait for this person (the number that is added to the Rooster tab). 0 when the switch is off for this person.
export function weekroosterActionCount() { return Object.values(counts()).reduce((a, b) => a + b, 0); }
// Does this day need an action from this person? (the dot on the day pill)
export function weekroosterDayDot(day) { return !!counts()[day]; }

const whenLabel = ms => {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return d.toLocaleDateString('nl-NL', { weekday: 'short' }).replace('.', '') + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
};
const requestLine = r => `${girlName(r.familyId)}: ${summaryOf(r)}`;

function coordLineHtml(day) {
  const id = deciderFamilyOf(day), name = esc(deciderName(day) || t('weekrooster.decider.unknown'));
  const who = id ? contactButtonHtml(id, name) : `<strong>${name}</strong>`;
  return `<div class="coordLine">${phIcon('user-circle-gear')} <span>${esc(t('weekrooster.coord.prefix'))} ${esc(lower(dayName(day)))}: ${who}</span></div>`;
}

function logHtml(day) {
  const now = Date.now(), items = recentChanges(requestsForDeciding(), wk(), day, now, dayEndMs(wk(), day))
    .concat(selfChanges(S.deviations, wk(), day, deciderFamilyOf(day))).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!items.length) return '';
  const rows = items.map(r => {
    if (r.state === 'self') return `<div class="logItem"><span class="logItem__dot logItem__dot--ok" aria-hidden="true"></span>
      <span class="logItem__main">${esc(t(r.direction === 'heen' ? 'weekrooster.log.selfHeen' : 'weekrooster.log.selfTerug', { p1: girlName(r.familyId) }))}</span>
      <span class="logItem__side"><span class="tag">${esc(t('weekrooster.tag.self'))}</span><span class="logItem__when">${esc(whenLabel(r.updatedAt))}</span></span></div>`;
    const waiting = r.state === 'pending';
    const tag = waiting ? `<span class="tag tag--warn">${esc(t('weekrooster.tag.request'))}</span>` : `<span class="tag tag--ok">${esc(t(r.state === 'accepted' ? 'weekrooster.tag.accepted' : 'weekrooster.tag.direct'))}</span>`;
    return `<div class="logItem"><span class="logItem__dot${waiting ? '' : ' logItem__dot--ok'}" aria-hidden="true"></span>
      <span class="logItem__main">${esc(requestLine(r))}</span>
      <span class="logItem__side">${tag}<span class="logItem__when">${esc(whenLabel(r.updatedAt))}</span></span></div>`;
  }).join('');
  return `<div class="card" id="wrLog"><h2>${esc(t('weekrooster.log.title'))}</h2>${rows}</div>`;
}

// Above the day in Rooster "Deze week". Empty when the switch is off for this person.
export function scheduleDayExtrasHtml(day) {
  if (!weekroosterActive()) return '';
  const decides = myDeciderDays().includes(day);
  if (decides) {
    const n = counts()[day] || 0;
    const alert = n
      ? `<div class="devAlert" id="wrAlert"><p class="devAlertTitle">${phIcon('warning-circle-fill')} ${esc(t(n === 1 ? 'weekrooster.alert.titleOne' : 'weekrooster.alert.titleMany', { p1: n, p2: lower(dayName(day)) }))}</p>
          <p class="devAlertBody">${esc(t('weekrooster.alert.body'))}</p>
          <div class="formActions"><button type="button" class="btn small" data-wradvice="${day}">${esc(t('weekrooster.advice.look'))}</button></div></div>`
      : '';
    return coordLineHtml(day) + alert + logHtml(day);
  }
  // A parent: the own open request of this day as a note, and the open requests of the other families.
  const own = openRequestsOf(S.weekRequests, wk(), myFamilyId(), Date.now(), d => dayEndMs(wk(), d)).filter(r => r.day === day && r.status === 'pending');
  const notes = own.map(r => `<div class="noteLine">${esc(t('weekrooster.note.own', { p1: lower(summaryOf(r)), p2: upperFirst(deciderLabel(day)) }))}</div>`).join('');
  // The requests of the other families on this day that still wait for the day coordinator: who, what, and who decides.
  const others = pendingForDay(S.dayRequests, wk(), day, Date.now(), dayEndMs(wk(), day)).filter(r => r.familyId !== myFamilyId())
    .map(r => `<div class="noteLine">${esc(t('weekrooster.note.other', { p1: girlName(r.familyId), p2: lower(summaryOf(r)), p3: upperFirst(deciderLabel(day)) }))}</div>`).join('');
  return coordLineHtml(day) + notes + others;
}

// Mijn week, for the days this person decides: what waits, with "Bekijk" (opens Rooster on that day).
// The advice for the day in one line (cars saved or added, all directions, "Zuinigst"); null when there is no sound arrangement.
export function adviceLineOf(day) {
  const advice = adviceForDay(day), dirs = Object.keys(advice.directions);
  if (!dirs.length || dirs.some(d => advice.directions[d].variants.zuinig.noSolution)) return null;
  const diff = dirs.reduce((sum, d) => sum + advice.directions[d].variants.zuinig.carsAfter - advice.directions[d].carsBefore, 0);
  if (diff === 0) return t('weekrooster.action.adviceSame');
  const n = Math.abs(diff);
  if (diff < 0) return n === 1 ? t('weekrooster.action.adviceLess1') : t('weekrooster.action.adviceLessN', { p1: n });
  return n === 1 ? t('weekrooster.action.adviceMore1') : t('weekrooster.action.adviceMoreN', { p1: n });
}

// The amber card "Actie nodig voor {dag}": what waits (and what came in directly) and the advice in one line.
// Mijn week shows it with buttons. The Advies and Zelf indelen views show the same card on top, without buttons, so the requests stay
// in sight while the day is planned. Empty when nothing waits.
export function actionCardHtml(day, { buttons = false, advice = true, dots = false } = {}) {
  const now = Date.now();
  const pending = pendingForDay(requestsForDeciding(), wk(), day, now, dayEndMs(wk(), day));
  if (!pending.length) return '';
  const direct = recentChanges(requestsForDeciding(), wk(), day, now, dayEndMs(wk(), day)).filter(r => r.state === 'direct');
  const row = (r, tag) => `<div class="alertCard__row"><span${dots ? ' class="reqDot"' : ''}>${esc(requestLine(r))}</span>${tag}</div>`;
  const rows = pending.map(r => row(r, `<span class="tag tag--warn">${esc(t('weekrooster.tag.request'))}</span>`))
    .concat(direct.map(r => row(r, `<span class="tag tag--ok">${esc(t('weekrooster.tag.direct'))}</span>`))).join('');
  const line = buttons || advice ? adviceLineOf(day) : null;
  return `<div class="alertCard alertCard--stack"${buttons ? ` data-wraction="${day}"` : ''}><div class="alertCard__text"><b>${esc(t('weekrooster.action.title', { p1: lower(dayName(day)) }))}</b></div>${rows}
    ${line && advice ? `<div class="alertCard__text">${esc(line)}</div>` : ''}
    ${buttons ? `<div class="formActions"><button type="button" class="btn small secondary" data-wrlook="${day}">${esc(t('weekrooster.action.look'))}</button>${line ? `<button type="button" class="btn small" data-wrtake="${day}">${phIcon('check')}${esc(t('weekrooster.advice.accept'))}</button>` : ''}</div>` : ''}</div>`;
}

export function myWeekActionCardsHtml() {
  if (!weekroosterActive()) return '';
  return myDeciderDays().map(day => actionCardHtml(day, { buttons: true })).join('');
}

export function wireMyWeekActions(box) {
  box.querySelectorAll('[data-wrlook]').forEach(b => b.onclick = () => { hapticTap(); S.scheduleDay = b.dataset.wrlook; S.roosterMode = 'week'; S.wrAdvice = null; S.wrDone = null; renderSchedule(); activateTab('schedule'); });
  box.querySelectorAll('[data-wrtake]').forEach(b => b.onclick = async () => {
    hapticTap();
    const day = b.dataset.wrtake;
    b.disabled = true;
    const r = await acceptDay(day, 'zuinig');
    if (!r.ok) { b.disabled = false; return; }
    S.wrAdvice = null; S.wrDone = null;
    showToast(t(r.n === 1 ? 'weekrooster.advice.doneOne' : 'weekrooster.advice.doneMany', { p1: r.n }), {
      action: { label: t('deviation.ongedaan'), run: async () => { if (await r.undo()) { showToast(t('weekrooster.advice.undone')); renderSchedule(); renderMyWeek(); } } },
    });
    renderSchedule(); renderMyWeek();
  });
}
