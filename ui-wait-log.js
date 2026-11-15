// ui-wait-log.js — the card "Wachttijd speelsters" in Beheer: how long each player waits and the average, per week, month or year, so the
// coordinator can see whether a complaint about waiting more than the others is justified. The counting lives in wait-log.js; the waiting
// is written into the ride log by ride-log.js / rides.js (carWaits). Coordinator only.
import { t, locale } from './i18n.js';
import { S } from './state.js';
import { esc, hapticTap, phIcon } from './ui-common.js';
import { renderBeheer } from './ui-beheer.js';
import { getISOWeekKey, isoRangeLabel, weekKeyDayIso } from './dates.js';
import { WAIT_MARGIN_MIN, WAIT_MIN_RIDES, fmtMinutes, shiftWeekKey, sortWaitRows, waitSummary, waitTally, waitsMore } from './wait-log.js';

// What the coordinator looks at; the current month until she picks something else.
export function waitLogView(now = new Date()){
  const v = S.waitLogView || {};
  const mode = v.mode === 'week' || v.mode === 'year' ? v.mode : 'month';
  const weekKey = /^\d{4}-W\d{2}$/.test(String(v.weekKey || '')) ? v.weekKey : getISOWeekKey(now);
  return { mode, weekKey, year: v.year || now.getFullYear(), month: v.month || now.getMonth() + 1 };
}

const periodOf = v => v.mode === 'week' ? { weekKey: v.weekKey } : v.mode === 'month' ? { year: v.year, month: v.month } : { year: v.year };
export function waitPeriodLabel(v){
  if(v.mode === 'week') return t('waitlog.week_label', { p1: +v.weekKey.slice(6), p2: isoRangeLabel(weekKeyDayIso(v.weekKey, 'Ma'), weekKeyDayIso(v.weekKey, 'Vr')) });
  if(v.mode === 'month') return new Date(v.year, v.month - 1, 1).toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
  return String(v.year);
}

const dirText = r => t('waitlog.directions', { p1: r.heen == null ? t('waitlog.no_direction') : fmtMinutes(r.heen), p2: r.terug == null ? t('waitlog.no_direction') : fmtMinutes(r.terug) });

export function waitRowsHtml(rows, summary){
  return `<table class="avail waitLogTable">
      <thead><tr><th scope="col">${t('waitlog.col_girl')}</th><th scope="col">${t('waitlog.col_rides')}</th><th scope="col">${t('waitlog.col_total')}</th><th scope="col">${t('waitlog.col_average')}</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <th scope="row">${esc(r.name)}<span class="muted waitLogSub">${esc(dirText(r))}</span></th>
        <td>${r.rides}</td><td>${esc(fmtMinutes(r.total))}</td><td><strong class="${waitsMore(r, summary) ? 'fitbad' : ''}">${esc(fmtMinutes(r.average))}</strong></td>
      </tr>`).join('')}</tbody>
    </table>`;
}

// The sentence that answers the question of the coordinator: does somebody wait clearly longer than the rest?
function verdictHtml(rows, summary){
  const more = sortWaitRows(rows.filter(r => waitsMore(r, summary))).sort((a, b) => b.average - a.average);
  const names = more.map(r => r.name).join(', ');
  const text = !more.length ? t('waitlog.more_none') : more.length === 1 ? t('waitlog.more_one', { p1: names }) : t('waitlog.more_many', { p1: more.length, p2: names });
  return `<p id="waitLogVerdict"><strong class="${more.length ? 'fitbad' : 'fitok'}">${esc(text)}</strong></p><p class="muted">${t('waitlog.more_rule', { p1: WAIT_MARGIN_MIN, p2: WAIT_MIN_RIDES })}</p>`;
}

export function waitLogCardHtml(now = new Date()){
  const v = waitLogView(now), logs = S.rideLog || {}, families = S.families || {};
  const rows = sortWaitRows(waitTally(logs, families, periodOf(v)));
  const s = waitSummary(rows);
  const empty = !Object.values(logs).some(d => d && Array.isArray(d.cars) && d.cars.some(c => c && c.waits));
  const modeBtn = (mode, key) => `<button type="button" class="btn small ${v.mode === mode ? '' : 'secondary'}" data-wlmode="${mode}" aria-pressed="${v.mode === mode}">${t(key)}</button>`;
  return `<div class="card" id="waitLogCard">
      <h2>${t('waitlog.title')}</h2>
      <p class="muted">${t('waitlog.intro')}</p>
      <div class="waitLogControls">${modeBtn('week', 'waitlog.per_week')}${modeBtn('month', 'waitlog.per_month')}${modeBtn('year', 'waitlog.per_year')}</div>
      <div class="rowflex waitLogStep">
        <button type="button" class="iconbtn" data-wlstep="-1" aria-label="${t('waitlog.prev')}" title="${t('waitlog.prev')}">${phIcon('chevron-left')}</button>
        <strong id="waitLogLabel" aria-live="polite">${esc(waitPeriodLabel(v))}</strong>
        <button type="button" class="iconbtn" data-wlstep="1" aria-label="${t('waitlog.next')}" title="${t('waitlog.next')}">${phIcon('chevron-right')}</button>
      </div>
      ${empty ? `<p class="muted">${t('waitlog.empty')}</p>` : ''}
      ${rows.length
        ? `<p id="waitLogSummary">${esc(t('waitlog.summary', { p1: s.rides, p2: fmtMinutes(s.average), p3: fmtMinutes(s.perGirl) }))}</p>${verdictHtml(rows, s)}<p class="muted">${t('waitlog.hint')}</p>${waitRowsHtml(rows, s)}`
        : (empty ? '' : `<p class="muted">${t('waitlog.none_in_period')}</p>`)}
    </div>`;
}

// Moves the view one week, month or year; the month wraps into the next or previous year.
export function stepWaitLog(delta, now = new Date()){
  const v = waitLogView(now);
  if(v.mode === 'week') S.waitLogView = { ...v, weekKey: shiftWeekKey(v.weekKey, delta) };
  else if(v.mode === 'year') S.waitLogView = { ...v, year: v.year + delta };
  else { const d = new Date(v.year, v.month - 1 + delta, 1); S.waitLogView = { ...v, year: d.getFullYear(), month: d.getMonth() + 1 }; }
  renderBeheer();
}

export function wireWaitLogCard(){
  document.querySelectorAll('[data-wlmode]').forEach(b => b.onclick = () => { hapticTap(); S.waitLogView = { ...waitLogView(), mode: b.dataset.wlmode }; renderBeheer(); });
  document.querySelectorAll('[data-wlstep]').forEach(b => b.onclick = () => { hapticTap(); stepWaitLog(+b.dataset.wlstep); });
}
