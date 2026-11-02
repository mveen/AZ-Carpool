// ui-weekrooster-rooster.js — Afwijkend weekrooster, phase 3: Rooster "Deze week" and the day coordinator's action card in Mijn week.
//   Day coordinator (of the days he decides): the amber "Actie nodig" block, the log "Recente wijzigingen", a dot on the day pill,
//   the number on the Rooster tab, and the card "Actie nodig voor {dag}" in Mijn week.
//   Parent: read only; the own request shows as a note on that day. Nobody else's request is shown to a parent.
// These are status views, not notifications. Everything here only exists for a person with a family of their own (not Flex).
import { t } from './i18n.js';
import { S } from './state.js';
import { esc, foldHtml, hapticTap, phIcon } from './ui-common.js';
import { dateForWeekday } from './dates.js';
import { myFamilyId } from './coordinator.js';
import { girlName } from './rides.js';
import { requestRowsHtml } from './ui-weekrooster-essence.js';
import { contactButtonHtml } from './ui-contact.js';
import { renderSchedule } from './ui-schedule.js';
import { actionCounts, pendingForDay, recentChanges, selfChanges } from './weekrooster.js';
import { adviceForDay, dayEndMs, deciderFamilyOf, myDeciderDays, planOf, planStats, requestsForDeciding } from './weekrooster-data.js';
import { dayName, deciderName, lower, summaryOf, weekroosterActive } from './ui-weekrooster-form.js';

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

// Within 24 hours of the start of the carpool day (the day itself counts): then the day coordinator's card shows open in Rooster.
export function isWithin24h(day, now = new Date()) {
  const start = new Date(dateForWeekday(day)); start.setHours(0, 0, 0, 0);
  return start.getTime() - now.getTime() <= 24 * 3600 * 1000;
}

// "Recente wijzigingen" of the day, BELOW the day (after the cars of heen and terug). Only for the day coordinator of that day.
export function scheduleDayLogHtml(day) {
  return weekroosterActive() && myDeciderDays().includes(day) ? logHtml(day) : '';
}

// Above the day in Rooster "Deze week": the requests of every day, for everybody, folded. Open when this person is the day coordinator and the
// day is less than 24 hours away. Empty for a person without a family of their own.
export function scheduleDayExtrasHtml(day) {
  if (!weekroosterActive()) return '';
  const icon = `<span class="entryCard__icon">${phIcon('warning-circle-fill')}</span>`;
  if (myDeciderDays().includes(day)) {
    const n = counts()[day] || 0;
    // The requests that wait are listed in the card (as they are asked, per heen and terug); "Verzoeken verwerken" opens the flow.
    const card = entryCardHtml(day, n, 'data-wradvice', ' id="wrAlert"', false, true);
    return card ? foldHtml('wrroost|' + day, `${icon}<span class="entryCard__title"><b>${esc(titleOf(n, day))}</b></span>`, card, 'fold--alert', 'wrRoost' + day, isWithin24h(day)) : '';
  }
  // Somebody else decides this day: the same card, with the name of the day coordinator and "Overnemen" (after a warning). Always folded.
  const card = takeOverCardHtml(day, { title: false });
  if (!card) return '';
  const n = pendingForDay(requestsForDeciding(), wk(), day, Date.now(), dayEndMs(wk(), day)).length;
  return foldHtml('wrroost|' + day, `${icon}<span class="entryCard__title"><b>${esc(titleOf(n, day))}</b>${takeCaptionHtml(day)}</span>`, card, 'fold--alert', 'wrRoost' + day);
}

// The card that announces what waits for the day coordinator: how many requests, the requests as they are asked (per heen and terug, per girl) and
// "Verzoeken verwerken" (opens the flow). `attr` is the data attribute of the button, `extra` more attributes of the card.
// Mijn week: with a warning icon. Rooster (`plain`): the same white card with the thin amber edge, nothing to signal there.
const titleOf = (n, day) => t(n === 1 ? 'weekrooster.entry.titleOne' : 'weekrooster.entry.titleMany', { p1: n, p2: lower(dayName(day)) });
export function entryCardHtml(day, n, attr, extra = '', title = true, plain = false) {
  if (!n) return '';
  const rows = requestRowsHtml(adviceForDay(day));
  const head = title ? `<div class="entryCard__head">${plain ? '' : `<span class="entryCard__icon">${phIcon('warning-circle-fill')}</span>`}<b>${esc(titleOf(n, day))}</b></div>` : '';
  return `<div class="entryCard entryCard--stack${plain ? ' entryCard--plain' : ''}"${extra}>${head}${rows}
    <button type="button" class="btn entryCard__go" ${attr}="${day}">${esc(t('weekrooster.entry.go'))}</button></div>`;
}

// A day somebody else decides, with requests waiting: the same card, the day coordinator named under the title, "Bel" (contact sheet) and
// "Overnemen". Overnemen first shows the warning in the card itself; "Ja, ik neem over" opens Zelf indelen (wireTakeOver in ui-weekrooster-edit.js).
// `title: false` is the body of the folded line in Mijn week (the line has the title). `othersOnly`: only when another family asked (Mijn week
// already shows the own request in the day).
const takeCoord = day => deciderName(day) || t('weekrooster.decider.unknown');
export function takeOverCardHtml(day, { plain = false, title = true, othersOnly = false } = {}) {
  const pending = pendingForDay(requestsForDeciding(), wk(), day, Date.now(), dayEndMs(wk(), day));
  if (!pending.length || (othersOnly && pending.every(r => r.familyId === myFamilyId()))) return '';
  const id = deciderFamilyOf(day), name = takeCoord(day);
  const head = title ? `<div class="entryCard__head">${plain ? '' : `<span class="entryCard__icon">${phIcon('warning-circle-fill')}</span>`}<span class="entryCard__title"><b>${esc(titleOf(pending.length, day))}</b>${takeCaptionHtml(day)}</span></div>` : '';
  const call = id ? contactButtonHtml(id, `${phIcon('phone')}${esc(t('weekrooster.take.call', { p1: name }))}`, undefined, 'btn secondary') : '';
  return `<div class="entryCard entryCard--stack${plain ? ' entryCard--plain' : ''}" data-wrtake="${day}">${head}${requestRowsHtml(adviceForDay(day))}
    <div class="takeBtns" data-take-btns>${call}<button type="button" class="btn secondary" data-wrtakeover="${day}">${esc(t('weekrooster.take.go'))}</button></div>
    <div class="takeWarn" data-take-warn hidden><p class="takeWarn__t"><b>${esc(t('weekrooster.take.warnTitle', { p1: name }))}</b></p><p class="takeWarn__p">${esc(t('weekrooster.take.warnText', { p1: name }))}</p>
      <div class="takeWarn__btns"><button type="button" class="btn" data-wrtakeyes="${day}">${esc(t('weekrooster.take.yes'))}</button><button type="button" class="btn secondary" data-wrtakeno>${esc(t('weekrooster.take.no'))}</button></div></div></div>`;
}
const takeCaptionHtml = day => `<span class="entryCard__cap">${esc(t('weekrooster.take.coord'))} <b>${esc(takeCoord(day))}</b></span>`;

// Mijn week, for the days this person decides: what waits, with "Bekijk" (opens Rooster on that day).
// The advice for the day in one line (the cars as they are, least waiting); null when it does not fit in the existing cars: the day coordinator
// then decides in the flow, so there is nothing to take over in one tap.
export function adviceLineOf(day) {
  const advice = adviceForDay(day), plan = planOf(advice, 'best');
  if (!Object.keys(advice.directions).length || plan.blocked || plan.fallback) return null;
  const st = planStats(advice, plan), wait = st.extraWait, n = st.moved.length;
  if (n) return t(n === 1 ? 'weekrooster.action.adviceMoved1' : 'weekrooster.action.adviceMovedN', { p1: t(wait ? 'weekrooster.action.waitSome' : 'weekrooster.action.waitNone', { p1: wait }), p2: n });   // somebody in another car: say so, the details are below
  return wait ? t('weekrooster.action.adviceFitsWait', { p1: wait }) : t('weekrooster.action.adviceFits');
}

// The requests of the day in the normal white card, without a button: the Zelf indelen view shows it on top, so the requests stay in sight
// while the day is planned. Empty when nothing waits.
export function actionCardHtml(day) {
  const n = pendingForDay(requestsForDeciding(), wk(), day, Date.now(), dayEndMs(wk(), day)).length;
  if (!n) return '';
  return `<div class="entryCard entryCard--stack entryCard--plain"><div class="entryCard__head"><b>${esc(titleOf(n, day))}</b></div>${requestRowsHtml(adviceForDay(day))}</div>`;
}

// Only on the calendar day before the carpool day does the card show open: that is the moment the day coordinator really has to arrange it.
// Before that (and on the day itself) it is one folded line, so it does not dominate Mijn week. The person can still open it (the fold remembers that).
export function isDayBefore(day, now = new Date()) {
  const prev = new Date(dateForWeekday(day)); prev.setDate(prev.getDate() - 1);
  return prev.toDateString() === now.toDateString();
}

export function myWeekActionCardsHtml() {
  if (!weekroosterActive()) return '';
  const mine = myDeciderDays();
  const foldTitle = (n, day, cap) => `<span class="entryCard__icon">${phIcon('warning-circle-fill')}</span><span class="entryCard__title"><b>${esc(titleOf(n, day))}</b>${cap}</span>`;
  const decided = mine.map(day => {
    const n = pendingForDay(requestsForDeciding(), wk(), day, Date.now(), dayEndMs(wk(), day)).length;
    if (!n) return '';
    const extra = ` data-wraction="${day}"`;
    if (isDayBefore(day)) return entryCardHtml(day, n, 'data-wrlook', extra);
    return foldHtml('wraction|' + day, foldTitle(n, day, ''), entryCardHtml(day, n, 'data-wrlook', extra, false), 'fold--alert', 'wrAction' + day);
  });
  return decided.join('');
}

export function wireMyWeekActions(box) {
  box.querySelectorAll('[data-wrlook]').forEach(b => b.onclick = () => { hapticTap(); S.scheduleDay = b.dataset.wrlook; S.roosterMode = 'week'; S.wrDone = null; S.wrAdvice = { day: b.dataset.wrlook, step: 'requests', variant: 'best', edits: {} }; renderSchedule(); });   // the same flow as "Regel dit" in Rooster: its own screen, step 1, over the tab you are on
}
