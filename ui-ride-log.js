// ui-ride-log.js — the card "Gereden shifts" in Beheer: how many shifts each family has driven, per month or per year, with a CSV export.
// The counting and the CSV live in ride-log.js; the log itself is written by data.js (logPassedShifts). Coordinator only.
import { t, locale } from './i18n.js';
import { S } from './state.js';
import { esc, hapticTap, phIcon, showToast } from './ui-common.js';
import { renderBeheer } from './ui-beheer.js';
import { logYears, rideLogFileName, ridesCsv, sortRows, spread, tally, yearCsv } from './ride-log.js';

// What the coordinator looks at; the current month until she picks something else.
export function rideLogView(now = new Date()){
  const v = S.rideLogView || {};
  return { mode: v.mode === 'year' ? 'year' : 'month', year: v.year || now.getFullYear(), month: v.month || now.getMonth() + 1 };
}

const num = n => String(Math.round(n * 10) / 10).replace('.', ',');

export function rideLogRowsHtml(rows, showYear, yearTotals){
  const max = Math.max(1, ...rows.map(r => r.total));
  return `<table class="avail rideLogTable">
      <thead><tr><th scope="col" style="text-align:left">${t('ridelog.col_family')}</th><th scope="col">${t('ridelog.col_heen')}</th><th scope="col">${t('ridelog.col_terug')}</th><th scope="col">${t('ridelog.col_total')}</th>${showYear? `<th scope="col">${t('ridelog.col_year')}</th>` : ''}</tr></thead>
      <tbody>${rows.map(r=>`<tr>
        <th scope="row" style="text-align:left;font-weight:700">${esc(r.name)}${r.parent? `<div class="muted" style="font-weight:400">${esc(r.parent)}</div>` : ''}
          <div class="rideLogBar" aria-hidden="true" style="height:4px;border-radius:2px;background:var(--accent);opacity:.55;width:${Math.round(r.total/max*100)}%;margin-top:3px"></div></th>
        <td>${r.heen}</td><td>${r.terug}</td><td><strong class="${r.total? '' : 'fitbad'}">${r.total}</strong></td>${showYear? `<td>${yearTotals[r.key] || 0}</td>` : ''}
      </tr>`).join('')}</tbody>
    </table>`;
}

export function rideLogCardHtml(now = new Date()){
  const v = rideLogView(now), logs = S.rideLog || {}, families = S.families || {};
  const years = logYears(logs, now.getFullYear());
  const isMonth = v.mode === 'month';
  const rows = sortRows(tally(logs, families, isMonth ? { year: v.year, month: v.month } : { year: v.year }));
  const yearTotals = isMonth ? Object.fromEntries(tally(logs, families, { year: v.year }).map(r => [r.key, r.total])) : {};
  const s = spread(rows);
  const label = isMonth ? new Date(v.year, v.month - 1, 1).toLocaleDateString(locale(), { month: 'long', year: 'numeric' }) : String(v.year);
  const empty = !Object.keys(logs).length;
  return `<div class="card" id="rideLogCard">
      <h2>${t('ridelog.title')}</h2>
      <p class="muted">${t('ridelog.intro')}</p>
      <div class="rowflex" style="gap:8px;justify-content:flex-start;flex-wrap:wrap">
        <button type="button" class="btn small ${isMonth? '' : 'secondary'}" data-rlmode="month" aria-pressed="${isMonth}">${t('ridelog.per_month')}</button>
        <button type="button" class="btn small ${isMonth? 'secondary' : ''}" data-rlmode="year" aria-pressed="${!isMonth}">${t('ridelog.per_year')}</button>
      </div>
      <div class="rowflex" style="gap:8px;margin:10px 0;align-items:center;justify-content:space-between">
        <button type="button" class="iconbtn" data-rlstep="-1" aria-label="${t('ridelog.prev')}" title="${t('ridelog.prev')}">${phIcon('chevron-left')}</button>
        <strong style="font-size:16px" id="rideLogLabel" aria-live="polite">${esc(label)}</strong>
        <button type="button" class="iconbtn" data-rlstep="1" aria-label="${t('ridelog.next')}" title="${t('ridelog.next')}">${phIcon('chevron-right')}</button>
      </div>
      ${empty? `<p class="muted">${t('ridelog.empty')}</p>` : ''}
      <p id="rideLogSummary">${t('ridelog.summary',{p1:s.total,p2:num(s.average),p3:s.min,p4:s.max})}${s.idle? ` <span class="fitbad">${t('ridelog.idle',{p1:s.idle})}</span>` : ''}</p>
      ${rows.length? rideLogRowsHtml(rows, isMonth, yearTotals) : `<p class="muted">${t('beheer.nog_geen_gezinnen_toegevoegd')}</p>`}
      <div class="cardActions" style="margin-top:10px">
        <button type="button" class="btn small secondary" id="rideLogExportYear">${phIcon('download')} ${t('ridelog.export_year',{p1:v.year})}</button>
        <button type="button" class="btn small secondary" id="rideLogExportAll">${phIcon('download')} ${t('ridelog.export_all')}</button>
      </div>
      <select id="rideLogYear" aria-label="${t('ridelog.pick_year')}" style="margin-top:10px">${years.map(y=>`<option value="${y}"${y===v.year? ' selected' : ''}>${y}</option>`).join('')}</select>
    </div>`;
}

function download(text, fileName){
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportRideLog(kind, now = new Date()){
  const year = rideLogView(now).year;
  const text = kind === 'year' ? yearCsv(S.rideLog, S.families, year) : ridesCsv(S.rideLog, S.families);
  download(text, rideLogFileName(kind, year, now));
  showToast(t('ridelog.exported'));
}

// Moves the view one month or one year; the month wraps into the next or previous year.
export function stepRideLog(delta, now = new Date()){
  const v = rideLogView(now);
  if(v.mode === 'year') S.rideLogView = { ...v, year: v.year + delta };
  else { const d = new Date(v.year, v.month - 1 + delta, 1); S.rideLogView = { ...v, year: d.getFullYear(), month: d.getMonth() + 1 }; }
  renderBeheer();
}

export function wireRideLogCard(){
  document.querySelectorAll('[data-rlmode]').forEach(b => b.onclick = () => { hapticTap(); S.rideLogView = { ...rideLogView(), mode: b.dataset.rlmode }; renderBeheer(); });
  document.querySelectorAll('[data-rlstep]').forEach(b => b.onclick = () => { hapticTap(); stepRideLog(+b.dataset.rlstep); });
  const sel = document.getElementById('rideLogYear'); if(sel) sel.onchange = () => { S.rideLogView = { ...rideLogView(), year: +sel.value }; renderBeheer(); };
  const ey = document.getElementById('rideLogExportYear'); if(ey) ey.onclick = () => { hapticTap(); exportRideLog('year'); };
  const ea = document.getElementById('rideLogExportAll'); if(ea) ea.onclick = () => { hapticTap(); exportRideLog('all'); };
}
