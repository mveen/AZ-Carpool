// ui-ride-log.js — the card "Gereden shifts" in Beheer: how many shifts each family has driven, per month or per year, with a CSV export.
// Three screens inside the one card: the overview (a row per family), the shifts of one family, and all shifts by date. On the last two
// the coordinator can remove a ride (and put it back). The counting and the CSV live in ride-log.js; the log itself is written by
// data.js (logPassedShifts, setRideRemoved). Coordinator only.
import { t, locale } from './i18n.js';
import { S } from './state.js';
import { esc, hapticTap, openSheet, phIcon, showToast } from './ui-common.js';
import { renderBeheer } from './ui-beheer.js';
import { setRideRemoved } from './data.js';
import { logYears, rideLogFileName, ridesCsv, shiftList, sortRows, spread, tally, yearCsv } from './ride-log.js';

// What the coordinator looks at; the current month until she picks something else. `screen` is only there for 'family' (with `familyKey`) and 'all'.
export function rideLogView(now = new Date()){
  const v = S.rideLogView || {};
  const out = { mode: v.mode === 'year' ? 'year' : 'month', year: v.year || now.getFullYear(), month: v.month || now.getMonth() + 1 };
  if(v.screen === 'family' && v.familyKey) { out.screen = 'family'; out.familyKey = v.familyKey; }
  else if(v.screen === 'all') out.screen = 'all';
  return out;
}

const num = n => String(Math.round(n * 10) / 10).replace('.', ',');
const isoDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const dayLabel = iso => isoDate(iso).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
const loggedLabel = ms => ms ? new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const dirText = d => d === 'terug' ? t('ridelog.dir_terug') : t('ridelog.dir_heen');
const girlsLabel = n => n === 1 ? t('ridelog.girls_one') : t('ridelog.girls', { p1: n });
const periodOf = v => v.mode === 'month' ? { year: v.year, month: v.month } : { year: v.year };
const periodLabel = v => v.mode === 'month' ? new Date(v.year, v.month - 1, 1).toLocaleDateString(locale(), { month: 'long', year: 'numeric' }) : String(v.year);

export function rideLogRowsHtml(rows, showYear, yearTotals){
  const max = Math.max(1, ...rows.map(r => r.total));
  return `<table class="avail rideLogTable">
      <thead><tr><th scope="col" style="text-align:left">${t('ridelog.col_family')}</th><th scope="col">${t('ridelog.col_heen')}</th><th scope="col">${t('ridelog.col_terug')}</th><th scope="col">${t('ridelog.col_total')}</th>${showYear? `<th scope="col">${t('ridelog.col_year')}</th>` : ''}</tr></thead>
      <tbody>${rows.map(r=>`<tr>
        <th scope="row" style="text-align:left;font-weight:700"><button type="button" class="rideLogOpen" data-rlfam="${esc(r.key)}" aria-label="${esc(t('ridelog.open_family', { p1: r.name }))}" style="display:flex;align-items:center;gap:6px;width:100%;min-height:44px;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer">
          <span style="flex:1;min-width:0"><span style="display:block">${esc(r.name)}</span>${r.parent? `<span class="muted" style="display:block;font-weight:400">${esc(r.parent)}</span>` : ''}<span class="rideLogBar" aria-hidden="true" style="display:block;height:4px;border-radius:2px;background:var(--accent);opacity:.55;width:${Math.round(r.total/max*100)}%;margin-top:3px"></span></span>${phIcon('chevron-right')}</button></th>
        <td>${r.heen}</td><td>${r.terug}</td><td><strong class="${r.total? '' : 'fitbad'}">${r.total}</strong></td>${showYear? `<td>${yearTotals[r.key] || 0}</td>` : ''}
      </tr>`).join('')}</tbody>
    </table>`;
}

// Month / year switch and the step buttons: the same on every screen of the card.
function periodControlsHtml(v){
  const isMonth = v.mode === 'month';
  return `<div class="rowflex" style="gap:8px;justify-content:flex-start;flex-wrap:wrap">
        <button type="button" class="btn small ${isMonth? '' : 'secondary'}" data-rlmode="month" aria-pressed="${isMonth}">${t('ridelog.per_month')}</button>
        <button type="button" class="btn small ${isMonth? 'secondary' : ''}" data-rlmode="year" aria-pressed="${!isMonth}">${t('ridelog.per_year')}</button>
      </div>
      <div class="rowflex" style="gap:8px;margin:10px 0;align-items:center;justify-content:space-between">
        <button type="button" class="iconbtn" data-rlstep="-1" aria-label="${t('ridelog.prev')}" title="${t('ridelog.prev')}">${phIcon('chevron-left')}</button>
        <strong style="font-size:16px" id="rideLogLabel" aria-live="polite">${esc(periodLabel(v))}</strong>
        <button type="button" class="iconbtn" data-rlstep="1" aria-label="${t('ridelog.next')}" title="${t('ridelog.next')}">${phIcon('chevron-right')}</button>
      </div>`;
}

const backHtml = () => `<button type="button" class="btn small secondary" data-rlback style="align-self:flex-start">${phIcon('chevron-left')} ${t('ridelog.title')}</button>`;

// One shift of the list: the day (only on the all-shifts screen the family is the main line), heen / terug, and the remove or restore button.
function shiftRowHtml(r, withFamily){
  const main = withFamily ? esc(r.name) : esc(dayLabel(r.date));
  const sub = [girlsLabel(r.girls), r.loggedAt ? t('ridelog.logged', { p1: loggedLabel(r.loggedAt) }) : ''].filter(Boolean).join(' · ');
  const dir = dirText(r.direction);
  const ref = `data-rlid="${esc(r.id)}" data-rlidx="${r.index}" data-rlfid="${esc(r.familyId)}"`;
  const label = esc(t('ridelog.remove_label', { p1: r.name, p2: dayLabel(r.date), p3: dir }));
  return `<li class="rideLogShift${r.removed? ' rideLogRemoved' : ''}" style="display:flex;align-items:center;gap:10px;min-height:60px;border-bottom:1px solid var(--line)${r.removed? ';opacity:.85' : ''}">
      <span class="pill" style="box-sizing:border-box;width:56px;flex-shrink:0;text-align:center;margin:0;font-size:12px;font-weight:700;padding:4px 10px;border-radius:9999px;background:${r.direction === 'heen' ? 'var(--info-soft)' : 'var(--warn-soft)'};color:${r.direction === 'heen' ? 'var(--text-1)' : 'var(--warn-ink)'}">${esc(dir)}</span>
      <span style="flex:1;min-width:0"><strong style="display:block;font-size:14px">${main}</strong><span class="muted" style="display:block">${esc(sub)}</span></span>
      ${r.removed
        ? `<button type="button" class="btn small secondary" data-rlrestore ${ref}>${t('ridelog.restore')}</button>`
        : `<button type="button" class="iconbtn danger" data-rlremove ${ref} aria-label="${label}" title="${t('ridelog.remove')}">${phIcon('trash')}</button>`}
    </li>`;
}

function shiftListHtml(rows, withFamily, byDay){
  if(!rows.length) return `<p class="muted">${t('ridelog.none_in_period')}</p>`;
  if(!byDay) return `<ul style="list-style:none;margin:0;padding:0">${rows.map(r => shiftRowHtml(r, withFamily)).join('')}</ul>`;
  const days = [];
  rows.forEach(r => { const last = days[days.length - 1]; if(last && last.date === r.date) last.rows.push(r); else days.push({ date: r.date, rows: [r] }); });
  return days.map(d => `<div><div class="muted" style="font-weight:800;padding:10px 0 6px;border-bottom:1px solid var(--line)">${esc(dayLabel(d.date))}</div>
      <ul style="list-style:none;margin:0;padding:0">${d.rows.map(r => shiftRowHtml(r, true)).join('')}</ul></div>`).join('');
}

function removedHtml(rows, withFamily){
  if(!rows.length) return '';
  return `<div style="margin-top:12px;padding:12px;border-radius:var(--radius-control);border:1px dashed var(--control-line)">
      <div class="muted" style="font-weight:700;margin-bottom:4px">${t('ridelog.removed_head', { p1: rows.length })}</div>
      <ul style="list-style:none;margin:0;padding:0">${rows.map(r => shiftRowHtml(r, withFamily)).join('')}</ul>
      <p class="muted" style="margin:6px 0 0">${t('ridelog.removed_note')}</p>
    </div>`;
}

function familyScreenHtml(v, logs, families){
  const p = periodOf(v);
  const row = tally(logs, families, p).find(r => r.key === v.familyKey);
  const mine = r => r.familyId === v.familyKey;
  const active = shiftList(logs, families, p).filter(mine), removed = shiftList(logs, families, p, true).filter(mine);
  const name = row ? row.name : '?';
  return `<div class="card" id="rideLogCard" data-rlscreen="family">
      ${backHtml()}
      <h2 style="margin-top:12px">${esc(name)}</h2>
      ${row && row.parent? `<p class="muted" style="margin-top:0">${esc(row.parent)}</p>` : ''}
      ${periodControlsHtml(v)}
      <p id="rideLogSummary"><strong>${t('ridelog.family_summary', { p1: row ? row.total : 0, p2: row ? row.heen : 0, p3: row ? row.terug : 0 })}</strong></p>
      <div class="muted" style="font-weight:700;padding-bottom:6px;border-bottom:1px solid var(--line)">${t('ridelog.list_head')}</div>
      ${shiftListHtml(active, false, false)}
      ${removedHtml(removed, false)}
    </div>`;
}

function allScreenHtml(v, logs, families){
  const p = periodOf(v);
  const active = shiftList(logs, families, p), removed = shiftList(logs, families, p, true);
  return `<div class="card" id="rideLogCard" data-rlscreen="all">
      ${backHtml()}
      <h2 style="margin-top:12px">${t('ridelog.all_title')}</h2>
      ${periodControlsHtml(v)}
      <p id="rideLogSummary"><strong>${t('ridelog.all_summary', { p1: active.length })}</strong></p>
      ${shiftListHtml(active, true, true)}
      ${removedHtml(removed, true)}
    </div>`;
}

export function rideLogCardHtml(now = new Date()){
  const v = rideLogView(now), logs = S.rideLog || {}, families = S.families || {};
  if(v.screen === 'family') return familyScreenHtml(v, logs, families);
  if(v.screen === 'all') return allScreenHtml(v, logs, families);
  const years = logYears(logs, now.getFullYear());
  const isMonth = v.mode === 'month';
  const rows = sortRows(tally(logs, families, periodOf(v)));
  const yearTotals = isMonth ? Object.fromEntries(tally(logs, families, { year: v.year }).map(r => [r.key, r.total])) : {};
  const s = spread(rows);
  const empty = !Object.keys(logs).length;
  return `<div class="card" id="rideLogCard">
      <h2>${t('ridelog.title')}</h2>
      <p class="muted">${t('ridelog.intro')}</p>
      ${periodControlsHtml(v)}
      ${empty? `<p class="muted">${t('ridelog.empty')}</p>` : ''}
      <p id="rideLogSummary">${t('ridelog.summary',{p1:s.total,p2:num(s.average),p3:s.min,p4:s.max})}${s.idle? ` <span class="fitbad">${t('ridelog.idle',{p1:s.idle})}</span>` : ''}</p>
      ${rows.length? `<p class="muted">${t('ridelog.hint')}</p>${rideLogRowsHtml(rows, isMonth, yearTotals)}` : `<p class="muted">${t('beheer.nog_geen_gezinnen_toegevoegd')}</p>`}
      <div class="cardActions" style="margin-top:10px">
        <button type="button" class="btn small secondary" data-rlall>${phIcon('list')} ${t('ridelog.all_button')}</button>
      </div>
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

// Moves the view one month or one year; the month wraps into the next or previous year. The screen stays as it is.
export function stepRideLog(delta, now = new Date()){
  const v = rideLogView(now);
  if(v.mode === 'year') S.rideLogView = { ...v, year: v.year + delta };
  else { const d = new Date(v.year, v.month - 1 + delta, 1); S.rideLogView = { ...v, year: d.getFullYear(), month: d.getMonth() + 1 }; }
  renderBeheer();
}

// Goes to another screen of the card ('family' with a key, 'all'), or back to the overview (no screen).
export function showRideLogScreen(screen, familyKey, now = new Date()){
  const { screen: _s, familyKey: _k, ...rest } = rideLogView(now);
  S.rideLogView = screen ? { ...rest, screen, ...(familyKey ? { familyKey } : {}) } : rest;
  renderBeheer();
}

// Asks first (a bottom sheet with the shift and what changes), then removes the ride from the counts.
export function askRemoveRide(id, index, familyId, now = new Date()){
  const v = rideLogView(now), p = periodOf(v);
  const r = shiftList(S.rideLog, S.families, {}, false).find(x => x.id === id && x.index === index && x.familyId === familyId);
  if(!r) return;
  const row = tally(S.rideLog, S.families, p).find(x => x.key === familyId);
  const before = row ? row.total : 0;
  const what = `${dayLabel(r.date)} · ${dirText(r.direction)} · ${r.name}`;
  openSheet(t('ridelog.remove_title'), `<strong>${esc(what)}</strong><br>${esc(t('ridelog.remove_text', { p1: r.name, p2: before, p3: Math.max(0, before - 1), p4: periodLabel(v) }))}`,
    [{ label: t('ridelog.remove'), onClick: () => changeRide(id, index, familyId, true) }]);
}

export async function changeRide(id, index, familyId, removed){
  const ok = await setRideRemoved(id, index, familyId, removed);
  showToast(t(ok ? (removed ? 'ridelog.removed_toast' : 'ridelog.restored_toast') : 'ridelog.save_failed'));
  return ok;
}

export function wireRideLogCard(){
  document.querySelectorAll('[data-rlmode]').forEach(b => b.onclick = () => { hapticTap(); S.rideLogView = { ...rideLogView(), mode: b.dataset.rlmode }; renderBeheer(); });
  document.querySelectorAll('[data-rlstep]').forEach(b => b.onclick = () => { hapticTap(); stepRideLog(+b.dataset.rlstep); });
  document.querySelectorAll('[data-rlfam]').forEach(b => b.onclick = () => { hapticTap(); showRideLogScreen('family', b.dataset.rlfam); });
  document.querySelectorAll('[data-rlall]').forEach(b => b.onclick = () => { hapticTap(); showRideLogScreen('all'); });
  document.querySelectorAll('[data-rlback]').forEach(b => b.onclick = () => { hapticTap(); showRideLogScreen(null); });
  document.querySelectorAll('[data-rlremove]').forEach(b => b.onclick = () => { hapticTap(); askRemoveRide(b.dataset.rlid, +b.dataset.rlidx, b.dataset.rlfid); });
  document.querySelectorAll('[data-rlrestore]').forEach(b => b.onclick = () => { hapticTap(); changeRide(b.dataset.rlid, +b.dataset.rlidx, b.dataset.rlfid, false); });
  const sel = document.getElementById('rideLogYear'); if(sel) sel.onchange = () => { S.rideLogView = { ...rideLogView(), year: +sel.value }; renderBeheer(); };
  const ey = document.getElementById('rideLogExportYear'); if(ey) ey.onclick = () => { hapticTap(); exportRideLog('year'); };
  const ea = document.getElementById('rideLogExportAll'); if(ea) ea.onclick = () => { hapticTap(); exportRideLog('all'); };
}
