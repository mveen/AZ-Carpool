// ui-period.js — "periode met andere tijden" for parents and the coordinator's own family (Wijzigen, step 2):
// the task card ("Actie nodig"), the form for the whole period, the "doorgegeven" card and the badge on the Wijzigen tab.
// Rules: see period.js (periodEntryState) and README. The standard rooster is never changed; times live in periodEntries/*.
import { t } from './i18n.js';
import { S } from './state.js';
import { dayUp, isoDayLabel, isoRangeLabel } from './dates.js';
import { esc, hapticTap, phIcon } from './ui-common.js';
import { myFamilyId } from './coordinator.js';
import { isFlex } from './rides.js';
import { savePeriodEntry } from './data.js';
import { renderDeviationTab } from './ui-deviation.js';
import { defaultEntryDays, describeEntryDay, normalizePeriod, periodDayKey, periodEntryId, periodEntryState, periodWorkdays, standardDay } from './period.js';

const NO_TASK = { show:null, canEdit:false, badge:false, phase:'none', familyId:null, family:null, entry:null };

// What the current user sees for the period: see periodEntryState. Nothing until the period and the entries are loaded,
// so the card and the badge never flash up for a family that already handed in.
export function periodTask(nowMs){
  if(!S.period || !S.periodEntriesLoaded || !S.me) return NO_TASK;
  const familyId = myFamilyId(), family = S.families[familyId];
  const entry = S.periodEntries[periodEntryId(S.period, familyId)] || null;
  const st = periodEntryState(S.period, entry || undefined, { hasFamily:!!family, isFlex:isFlex(family), canEdit:S.canEdit }, nowMs);
  return { ...st, familyId, family, entry };
}

const girlOf = f => (f && (f.girlName || f.parentName)) || '';
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const deadlineLabel = p => isoDayLabel(p.deadlineDate, 'long') + ' ' + p.deadlineTime;

// The form as it opens: what was handed in before, else the standard rooster.
export function periodFormFrom(period, family, entry){
  const days = defaultEntryDays(period, family);
  Object.keys(days).forEach(iso => {
    const e = entry && entry.days && entry.days[iso];
    if(!e) return;
    days[iso] = e.out ? { ...days[iso], out:true } : { out:false, heen:e.heen || '', terug:e.terug || '' };
  });
  return days;
}

// One line for a handed-in day, compared with the standard rooster.
export function periodDaySummary(family, iso, day){
  const d = describeEntryDay(family, iso, day);
  if(d.kind==='standard') return t('period.done.standard');
  if(d.kind==='out') return t('period.done.out');
  const parts = [];
  if('heen' in d) parts.push(d.heen ? t('period.done.heen',{p1:d.heen}) : t('period.done.noHeen'));
  if('terug' in d) parts.push(d.terug ? t('period.done.terug',{p1:d.terug}) : t('period.done.noTerug'));
  return parts.join(' · ');
}

function taskCardHtml(tk){
  const p = normalizePeriod(S.period), girl = girlOf(tk.family);
  const locked = tk.phase==='closed';
  return `<div class="devAlert" id="periodTask">
      <p class="devAlertTitle">${phIcon('lightning')} ${t('period.task.title')}</p>
      <p class="devAlertBody">${esc(t('period.task.body',{p1:p.name, p2:isoRangeLabel(p.firstDay,p.lastDay), p3:girl}))}</p>
      <p class="devAlertBody" style="font-weight:700">${esc(locked? t('period.task.deadlinePassed') : t('period.task.deadline',{p1:deadlineLabel(p)}))}</p>
      <p class="devAlertBody" style="font-size:12px">${t('period.task.standardStays')}</p>
      <button type="button" class="btn small" id="periodOpen">${t('period.task.button')}</button>
    </div>`;
}

function doneCardHtml(tk){
  const p = normalizePeriod(S.period), girl = girlOf(tk.family);
  const rows = periodWorkdays(p.firstDay, p.lastDay).map(iso =>
    `<div class="periodSummary"><span>${esc(cap(isoDayLabel(iso)))}</span><span class="muted">${esc(periodDaySummary(tk.family, iso, tk.entry.days[iso]))}</span></div>`).join('');
  return `<div class="periodDone" id="periodDone">
      <p class="periodDoneTitle">${phIcon('check')} ${t('period.done.title')}</p>
      <p class="devAlertBody">${esc(t(tk.canEdit? 'period.done.body' : 'period.done.locked', { p1:p.name, p2:girl, p3:deadlineLabel(p) }))}</p>
      <h3 style="margin:10px 0 2px;font-size:14px">${esc(t('period.done.yours',{p1:p.name}))}</h3>
      ${rows}
      ${tk.canEdit? `<button type="button" class="btn small secondary" id="periodEdit">${t('period.done.edit')}</button>` : ''}
    </div>`;
}

// The form: one block per workday, a switch Rijdt mee / Rijdt niet mee and the two times. Changed values are amber.
export function periodFormHtml(){
  const tk = periodTask(), f = S.periodForm;
  if(!f || !tk.canEdit) return '';
  const p = normalizePeriod(S.period), girl = girlOf(tk.family);
  const rows = Object.keys(f.days).sort().map(iso => {
    const d = f.days[iso], std = standardDay(tk.family, iso);
    const changed = describeEntryDay(tk.family, iso, d.out? { out:true } : d).kind !== 'standard';
    const timeInput = (dir) => `<input type="time" class="periodTime${d[dir]!==std[dir]? ' changed' : ''}" id="period${dir==='heen'?'Heen':'Terug'}_${iso}" value="${esc(d[dir]||'')}" aria-label="${esc(t(dir==='heen'? 'period.form.heen' : 'period.form.terug'))} ${esc(isoDayLabel(iso,'long'))}">`;
    return `<div class="periodDay${changed? ' changed' : ''}" data-periodday="${iso}">
        <div class="periodDayHead">
          <span><strong>${esc(dayUp(periodDayKey(iso)))}</strong> <span class="muted">${esc(isoDayLabel(iso,''))}</span></span>
          <label class="periodRide" for="periodRide_${iso}"><input type="checkbox" class="periodRideInput" id="periodRide_${iso}" ${d.out? '' : 'checked'}> <span>${t(d.out? 'period.form.notRides' : 'period.form.rides')}</span></label>
        </div>
        ${d.out
          ? `<p class="muted" style="margin:0">${esc(t('period.form.notRidesDay',{p1:girl}))}</p>`
          : `<div class="grid2">${timeInput('heen')}${timeInput('terug')}</div>`}
      </div>`;
  }).join('');
  return `<div class="card" id="periodForm">
      <h2>${esc(t('period.form.title',{p1:p.name}))}</h2>
      <p class="muted">${esc(t('period.form.sub',{p1:p.name, p2:isoRangeLabel(p.firstDay,p.lastDay), p3:isoDayLabel(p.deadlineDate)+' '+p.deadlineTime}))}</p>
      <p class="muted">${t('period.form.hint')}</p>
      <div class="grid2" style="margin-top:8px"><span class="muted" style="font-size:12px">${t('period.form.heen')}</span><span class="muted" style="font-size:12px">${t('period.form.terug')}</span></div>
      ${rows}
      <div class="rowflex" style="gap:6px;margin-top:12px">
        <button type="button" class="btn small secondary" id="periodCancel">${t('period.form.cancel')}</button>
        <button type="button" class="btn small" id="periodSubmit">${t('period.form.submit')}</button>
      </div>
    </div>`;
}

// True while the form is what Wijzigen shows (the rest of the tab is hidden then, to keep the focus on the form).
export function periodFormActive(){
  const tk = periodTask();
  if(S.periodForm && (!tk.canEdit || S.periodForm.familyId!==tk.familyId)) S.periodForm = null;   // deadline passed or other family in the meantime
  return !!S.periodForm;
}

// The card at the top of Wijzigen: the task, or the "doorgegeven" card. '' when there is nothing for this user.
export function periodCardsHtml(){
  const tk = periodTask();
  if(tk.show==='task') return taskCardHtml(tk);
  if(tk.show==='done') return doneCardHtml(tk);
  return '';
}

export function updatePeriodBadge(){
  const el = document.getElementById('navDeviationBadge');
  if(!el) return;
  const on = periodTask().badge;
  el.textContent = on ? '1' : '';
  el.style.display = on ? '' : 'none';
  if(on) el.setAttribute('aria-label', t('period.badge.aria')); else el.removeAttribute('aria-label');
}

const taskKey = () => { const tk = periodTask(); return [tk.show, tk.canEdit, tk.badge, tk.phase].join('|'); };
// Called on every render of Wijzigen: remembers what was shown, and refreshes the badge.
export function markPeriodShown(){ S.periodPhaseKey = taskKey(); updatePeriodBadge(); }
// Called every minute: the moment filling in opens, or the deadline passes, changes what is shown without any database update.
export function refreshPeriodTask(){
  if(taskKey()===S.periodPhaseKey) return false;
  renderDeviationTab();
  return true;
}

// ---------- the form ----------
function readForm(){
  const f = S.periodForm; if(!f) return;
  Object.keys(f.days).forEach(iso => {
    const ride = document.getElementById('periodRide_'+iso);
    if(ride) f.days[iso].out = !ride.checked;
    ['heen','terug'].forEach(dir => {
      const el = document.getElementById('period'+(dir==='heen'?'Heen':'Terug')+'_'+iso);
      if(el) f.days[iso][dir] = el.value || '';
    });
  });
}

// Amber follows what is typed, without redrawing the form (a redraw would take the focus away).
function markChanged(){
  const tk = periodTask(), f = S.periodForm; if(!f) return;
  Object.keys(f.days).forEach(iso => {
    const d = f.days[iso], std = standardDay(tk.family, iso);
    const row = document.querySelector && document.querySelector(`[data-periodday="${iso}"]`);
    if(row && row.classList) row.classList.toggle('changed', describeEntryDay(tk.family, iso, d.out? { out:true } : d).kind !== 'standard');
    ['heen','terug'].forEach(dir => {
      const el = document.getElementById('period'+(dir==='heen'?'Heen':'Terug')+'_'+iso);
      if(el && el.classList) el.classList.toggle('changed', (d[dir]||'') !== std[dir]);
    });
  });
}

export function openPeriodForm(){
  const tk = periodTask();
  if(!tk.canEdit) return false;
  S.periodForm = { familyId:tk.familyId, days:periodFormFrom(S.period, tk.family, tk.entry) };
  renderDeviationTab();
  return true;
}

export function cancelPeriodForm(){ S.periodForm = null; renderDeviationTab(); }

export async function submitPeriodForm(){
  if(!S.periodForm) return false;
  readForm();
  const ok = await savePeriodEntry(S.periodForm.familyId, S.periodForm.days);
  if(ok){ S.periodForm = null; renderDeviationTab(); }
  return ok;
}

export function wirePeriod(){
  const open = document.getElementById('periodOpen'); if(open) open.onclick = () => { hapticTap(); openPeriodForm(); };
  const edit = document.getElementById('periodEdit'); if(edit) edit.onclick = () => { hapticTap(); openPeriodForm(); };
  const cancel = document.getElementById('periodCancel'); if(cancel) cancel.onclick = () => cancelPeriodForm();
  const submit = document.getElementById('periodSubmit'); if(submit) submit.onclick = () => { hapticTap(); return submitPeriodForm(); };
  document.querySelectorAll('.periodTime').forEach(el => el.oninput = () => { readForm(); markChanged(); });
  document.querySelectorAll('.periodRideInput').forEach(el => el.onchange = () => { readForm(); renderDeviationTab(); });
}
