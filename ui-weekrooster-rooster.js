// ui-weekrooster-rooster.js — Afwijkend weekrooster, phase 3: Rooster "Deze week" and the day coordinator's action card in Mijn week.
//   Day coordinator (of the days he decides): the amber "Actie nodig" block, the log "Recente wijzigingen", a dot on the day pill,
//   the number on the Rooster tab, and the card "Actie nodig voor {dag}" in Mijn week.
//   Parent: read only; the own request shows as a note on that day. Nobody else's request is shown to a parent.
// These are status views, not notifications. Everything here only exists for a person with a family of their own (not Flex).
import { t } from './i18n.js';
import { S } from './state.js';
import { esc, foldHtml, hapticTap, phIcon, showToast } from './ui-common.js';
import { myFamilyId } from './coordinator.js';
import { girlName } from './rides.js';
import { contactButtonHtml } from './ui-contact.js';
import { activateTab } from './app.js';
import { dateForWeekday } from './dates.js';
import { renderSchedule } from './ui-schedule.js';
import { renderMyWeek } from './ui-myweek.js';
import { actionCounts, openRequestsOf, pendingForDay, recentChanges, selfChanges } from './weekrooster.js';
import { acceptDay, adviceForDay, dayEndMs, deciderFamilyOf, myDeciderDays, planOf, planStats, requestsForDeciding } from './weekrooster-data.js';
import { dayName, deciderLabel, deciderName, lower, summaryOf, upperFirst, weekroosterActive } from './ui-weekrooster-form.js';

const wk = () => S.currentWeekKey;
const counts = () => weekroosterActive() ? actionCounts(requestsForDeciding(), wk(), myDeciderDays(), Date.now(), day => dayEndMs(wk(), day)) : {};

// How many requests wait for this person (the number that is added to the Rooster tab). 0 for a person without a family of their own.
export function weekroosterActionCount() { return Object.values(counts()).reduce((a, b) => a + b, 0); }
// Does this day need an action from this person? (the dot on the day pill)
export function weekroosterDayDot(day) { return !!counts()[day]; }

const whenLabel = ms => {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return d.toLocaleDateString('nl-NL', { weekday: 'short' }).replace('.', '') + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
};
const requestLine = r => `${girlName(r.familyId)}: ${summaryOf(r)}`;

// The ONE line about the day coordinator in Rooster "Deze week". It is also "Jij bent dagcoördinator {dag}" when that is you (the line above the
// switch is then left out, see renderSchedule). Whoever may plan this day gets "Zelf indelen" here, on the line of the role, with no extra row,
// except when the amber card "Actie nodig" is on screen: with requests waiting the only way in is "Advies bekijken en aanpassen" (withAction = false).
function coordLineHtml(day, withAction = true) {
  const id = deciderFamilyOf(day), name = esc(deciderName(day) || t('weekrooster.decider.unknown'));
  const me = !!id && id === myFamilyId();
  const who = id ? contactButtonHtml(id, name) : `<strong>${name}</strong>`;
  const plan = withAction && (!!S.canEdit || myDeciderDays().includes(day));
  const act = plan ? `<button type="button" class="btn secondary small" data-wredit="${day}">${phIcon('pencil')} ${esc(t('weekrooster.edit.self'))}</button>` : '';
  const text = me ? esc(t('weekrooster.coord.you', { p1: lower(dayName(day)) })) : `${esc(t('weekrooster.coord.prefix'))} ${esc(lower(dayName(day)))}: ${who}`;
  return `<div class="coordLine${plan ? ' coordLine--act' : ''}">${phIcon(me ? 'star' : 'user-circle-gear')} <span>${text}</span>${act}</div>`;
}

// "Recente wijzigingen": only what is already settled (accepted, direct, changed by hand). What still waits is a row in the amber card.
// Folded, because it is history.
function logHtml(day) {
  const now = Date.now(), items = recentChanges(requestsForDeciding(), wk(), day, now, dayEndMs(wk(), day)).filter(r => r.state !== 'pending')
    .concat(selfChanges(S.deviations, wk(), day, deciderFamilyOf(day))).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!items.length) return '';
  const rows = items.map(r => {
    if (r.state === 'self') return `<div class="logItem"><span class="logItem__dot logItem__dot--ok" aria-hidden="true"></span>
      <span class="logItem__main">${esc(t(r.direction === 'heen' ? 'weekrooster.log.selfHeen' : 'weekrooster.log.selfTerug', { p1: girlName(r.familyId) }))}</span>
      <span class="logItem__side"><span class="tag">${esc(t('weekrooster.tag.self'))}</span><span class="logItem__when">${esc(whenLabel(r.updatedAt))}</span></span></div>`;
    return `<div class="logItem"><span class="logItem__dot logItem__dot--ok" aria-hidden="true"></span>
      <span class="logItem__main">${esc(requestLine(r))}</span>
      <span class="logItem__side"><span class="tag tag--ok">${esc(t(r.state === 'accepted' ? 'weekrooster.tag.accepted' : 'weekrooster.tag.direct'))}</span><span class="logItem__when">${esc(whenLabel(r.updatedAt))}</span></span></div>`;
  }).join('');
  return foldHtml('wrlog|' + day, `${esc(t('weekrooster.log.title'))} <b>${items.length}</b>`, rows, 'fold--quiet', 'wrLog');
}

// Above the day in Rooster "Deze week". Empty for a person without a family of their own.
export function scheduleDayExtrasHtml(day) {
  if (!weekroosterActive()) return '';
  const decides = myDeciderDays().includes(day);
  if (decides) {
    const n = counts()[day] || 0;
    // The requests that wait are not listed here: "Regel dit" opens the flow, whose first step shows them. This card only says how many and
    // what the advice would be (the cars as they are, least waiting), in one line.
    const now = Date.now(), end = dayEndMs(wk(), day);
    const hasDirect = recentChanges(requestsForDeciding(), wk(), day, now, end).some(r => r.state === 'direct');   // "Rijdt niet mee" is only mentioned when one was really processed
    const line = n ? (adviceLineOf(day) || t('weekrooster.alert.body')) + (hasDirect ? ' ' + t('weekrooster.alert.bodyDirect') : '') : '';
    const alert = n
      ? `<div class="entryCard" id="wrAlert"><span class="entryCard__icon">${phIcon('warning-circle-fill')}</span>
          <div class="entryCard__text"><b>${esc(t(n === 1 ? 'weekrooster.entry.titleOne' : 'weekrooster.entry.titleMany', { p1: n, p2: lower(dayName(day)) }))}</b><span>${esc(line)}</span></div>
          <button type="button" class="btn small" data-wradvice="${day}">${esc(t('weekrooster.entry.go'))}</button></div>`
      : '';
    return coordLineHtml(day, !n) + alert + logHtml(day);
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
// The advice for the day in one line (the cars as they are, least waiting); null when it does not fit in the existing cars: the day coordinator
// then decides in the flow, so there is nothing to take over in one tap.
export function adviceLineOf(day) {
  const advice = adviceForDay(day), plan = planOf(advice, 'best');
  if (!Object.keys(advice.directions).length || plan.blocked || plan.fallback) return null;
  const wait = planStats(advice, plan).extraWait;
  return wait ? t('weekrooster.action.adviceFitsWait', { p1: wait }) : t('weekrooster.action.adviceFits');
}

// The amber card "Actie nodig voor {dag}": what waits (and what came in directly) and the advice in one line.
// Mijn week shows it with buttons. The Advies and Zelf indelen views show the same card on top, without buttons, so the requests stay
// in sight while the day is planned. Empty when nothing waits.
export function actionCardHtml(day, { buttons = false, advice = true, dots = false, title = true } = {}) {
  const now = Date.now();
  const pending = pendingForDay(requestsForDeciding(), wk(), day, now, dayEndMs(wk(), day));
  if (!pending.length) return '';
  const direct = recentChanges(requestsForDeciding(), wk(), day, now, dayEndMs(wk(), day)).filter(r => r.state === 'direct');
  const row = (r, tag) => `<div class="alertCard__row"><span${dots ? ' class="reqDot"' : ''}>${esc(requestLine(r))}</span>${tag}</div>`;
  const rows = pending.map(r => row(r, `<span class="tag tag--warn">${esc(t('weekrooster.tag.request'))}</span>`))
    .concat(direct.map(r => row(r, `<span class="tag tag--ok">${esc(t('weekrooster.tag.direct'))}</span>`))).join('');
  const line = buttons || advice ? adviceLineOf(day) : null;
  return `<div class="alertCard alertCard--stack"${buttons ? ` data-wraction="${day}"` : ''}>${title ? `<div class="alertCard__text"><b>${esc(t('weekrooster.action.title', { p1: lower(dayName(day)) }))}</b></div>` : ''}${rows}
    ${line && advice ? `<div class="alertCard__text">${esc(line)}</div>` : ''}
    ${buttons ? `<div class="formActions"><button type="button" class="btn small secondary" data-wrlook="${day}">${esc(t('weekrooster.action.look'))}</button>${line ? `<button type="button" class="btn small" data-wrtake="${day}">${phIcon('check')}${esc(t('weekrooster.advice.accept'))}</button>` : ''}</div>` : ''}</div>`;
}

// Only on the calendar day before the carpool day does the card show open: that is the moment the day coordinator really has to arrange it.
// Before that (and on the day itself) it is one folded line, so it does not dominate Mijn week. The person can still open it (the fold remembers that).
export function isDayBefore(day, now = new Date()) {
  const prev = new Date(dateForWeekday(day)); prev.setDate(prev.getDate() - 1);
  return prev.toDateString() === now.toDateString();
}

export function myWeekActionCardsHtml() {
  if (!weekroosterActive()) return '';
  return myDeciderDays().map(day => {
    if (isDayBefore(day)) return actionCardHtml(day, { buttons: true });
    const n = pendingForDay(requestsForDeciding(), wk(), day, Date.now(), dayEndMs(wk(), day)).length;
    if (!n) return '';
    const body = actionCardHtml(day, { buttons: true, title: false });
    return foldHtml('wraction|' + day, `${esc(t('weekrooster.action.title', { p1: lower(dayName(day)) }))} <b>${n}</b>`, body, 'fold--alert', 'wrAction' + day);
  }).join('');
}

export function wireMyWeekActions(box) {
  box.querySelectorAll('[data-wrlook]').forEach(b => b.onclick = () => { hapticTap(); S.scheduleDay = b.dataset.wrlook; S.roosterMode = 'week'; S.wrAdvice = null; S.wrDone = null; renderSchedule(); activateTab('schedule'); });
  box.querySelectorAll('[data-wrtake]').forEach(b => b.onclick = async () => {
    hapticTap();
    const day = b.dataset.wrtake;
    b.disabled = true;
    const r = await acceptDay(day, 'best');
    if (!r.ok) { b.disabled = false; return; }
    S.wrAdvice = null; S.wrDone = null;
    showToast(t(r.n === 1 ? 'weekrooster.advice.doneOne' : 'weekrooster.advice.doneMany', { p1: r.n }), {
      action: { label: t('deviation.ongedaan'), run: async () => { if (await r.undo()) { showToast(t('weekrooster.advice.undone')); renderSchedule(); renderMyWeek(); } } },
    });
    renderSchedule(); renderMyWeek();
  });
}
