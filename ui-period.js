// ui-period.js — "periode met andere tijden" for parents and the coordinator (Wijzigen): the task card ("Actie nodig"), the form for
// the whole period, the "doorgegeven" card, the coordinator's overview per family and the badge on the Wijzigen tab.
// Several periods can run at the same time: every period has its own cards; the badge counts the open tasks.
// Rules: see period.js (periodEntryState) and README. The standard rooster is never changed; times live in periodEntries/*.
import { t } from './i18n.js';
import { S } from './state.js';
import { dayUp, isoDayLabel, isoRangeLabel } from './dates.js';
import { esc, foldHtml, hapticTap, phIcon } from './ui-common.js';
import { myFamilyId } from './coordinator.js';
import { isFlex } from './rides.js';
import { savePeriodEntry } from './data.js';
import { renderDeviationTab } from './ui-deviation.js';
import { defaultEntryDays, describeEntryDay, normalizePeriod, periodDayKey, periodEntryId, periodEntryState, periodList, periodProgress, periodWorkdays, standardDay } from './period.js';

const NO_TASK = { show:null, canEdit:false, badge:false, phase:'none', familyId:null, family:null, entry:null, period:null };

// What one family sees for one period (`firstDay`): see periodEntryState. Nothing until the periods and the entries are loaded,
// so a card and the badge never flash up for a family that already handed in.
// The coordinator uses it for any family, to fill in on behalf of a parent (canEdit is then always true, also after the deadline).
export function periodTaskFor(familyId, firstDay, nowMs){
  const period = S.periods[firstDay];
  if(!period || !S.periodEntriesLoaded || !S.me) return NO_TASK;
  const family = S.families[familyId];
  const entry = S.periodEntries[periodEntryId(period, familyId)] || null;
  const st = periodEntryState(period, entry || undefined, { hasFamily:!!family, isFlex:isFlex(family), canEdit:S.canEdit }, nowMs);
  return { ...st, familyId, family, entry, period };
}

// The own tasks, one per period (oldest first); `show` is null where there is nothing to show for that period.
export function periodTasks(nowMs){
  return periodList(S.periods).map(p => periodTaskFor(myFamilyId(), p.firstDay, nowMs));
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
  const p = normalizePeriod(tk.period), girl = girlOf(tk.family);
  const locked = tk.phase==='closed';
  return `<div class="devAlert" id="periodTask_${p.firstDay}" data-periodtask="${p.firstDay}">
      <p class="devAlertTitle">${phIcon('lightning')} ${t('period.task.title')}</p>
      <p class="devAlertBody">${esc(t(S.canEdit? 'period.task.bodyCoord' : 'period.task.body',{p1:p.name, p2:isoRangeLabel(p.firstDay,p.lastDay), p3:girl}))}</p>
      <p class="devAlertBody" style="font-weight:700">${esc(locked? t('period.task.deadlinePassed') : t('period.task.deadline',{p1:deadlineLabel(p)}))}</p>
      <p class="devAlertBody" style="font-size:12px">${t('period.task.standardStays')}</p>
      <button type="button" class="btn small" id="periodOpen_${p.firstDay}" data-periodopen="${p.firstDay}">${t('period.task.button')}</button>
    </div>`;
}

function doneCardHtml(tk){
  const p = normalizePeriod(tk.period), girl = girlOf(tk.family);
  const rows = periodWorkdays(p.firstDay, p.lastDay).map(iso =>
    `<div class="periodSummary"><span>${esc(cap(isoDayLabel(iso)))}</span><span class="muted">${esc(periodDaySummary(tk.family, iso, tk.entry.days[iso]))}</span></div>`).join('');
  return `<details class="periodDone" id="periodDone_${p.firstDay}">
      <summary><p class="periodDoneTitle">${phIcon('check')} ${t('period.done.title')} <span class="periodDoneName">· ${esc(p.name)}</span></p></summary>
      <p class="devAlertBody">${esc(t(tk.canEdit? 'period.done.body' : 'period.done.locked', { p1:p.name, p2:girl, p3:deadlineLabel(p) }))}</p>
      <h3 style="margin:10px 0 2px;font-size:14px">${esc(t('period.done.yours',{p1:p.name}))}</h3>
      ${rows}
      ${tk.canEdit? `<button type="button" class="btn small secondary" id="periodEdit_${p.firstDay}" data-periodedit="${p.firstDay}">${t('period.done.edit')}</button>` : ''}
    </details>`;
}

// The form: one block per workday, a switch Rijdt mee / Rijdt niet mee and the two times. Changed values are amber.
export function periodFormHtml(){
  const f = S.periodForm, tk = f ? periodTaskFor(f.familyId, f.firstDay) : NO_TASK;
  if(!f || !tk.canEdit) return '';
  const p = normalizePeriod(tk.period), girl = girlOf(tk.family);
  const onBehalf = f.familyId!==myFamilyId()? `<p class="periodBehalf" id="periodOnBehalf">${esc(t('period.form.onBehalf',{p1:tk.family.parentName||'', p2:girl}))}</p>` : '';
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
      ${onBehalf}
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
  if(!S.periodForm) return false;
  const tk = periodTaskFor(S.periodForm.familyId, S.periodForm.firstDay);
  const other = S.periodForm.familyId!==myFamilyId();
  // Closed in the meantime: the period is gone, the deadline passed, the family shown is another one, or the coordinator rights are gone.
  if(!tk.canEdit || (other && !S.canEdit)) S.periodForm = null;
  return !!S.periodForm;
}

// The coordinator can fill in for other families while filling in is open and after the deadline; not in the "test as parent" view.
function behalfAllowed(firstDay){
  if(!S.canEdit || !S.periods[firstDay] || !S.periodEntriesLoaded) return false;
  const phase = periodTaskFor(myFamilyId(), firstDay).phase;
  return phase==='open' || phase==='closed';
}

// The families that still have to hand in come first, then the ones that did, each in name order. The own family is the own task.
export function periodBehalfRows(firstDay){
  const pr = periodProgress(S.periods[firstDay], S.families, S.periodEntries);
  const own = myFamilyId();
  const byName = (a, b) => girlOf(a.family).localeCompare(girlOf(b.family), 'nl');
  const rows = pr.rows.filter(r => r.id!==own);
  return { total: pr.total, done: pr.done, rows: [...rows.filter(r => !r.done).sort(byName), ...rows.filter(r => r.done).sort(byName)] };
}

function behalfCardHtml(firstDay, withIntro){
  const p = normalizePeriod(S.periods[firstDay]), pr = periodBehalfRows(firstDay), left = pr.total - pr.done;
  const intro = withIntro? `<p class="muted">${esc(t('period.coord.intro',{p1:p.name, p2:isoRangeLabel(p.firstDay,p.lastDay)}))}</p>
      <p class="muted" style="font-weight:700">${esc(periodTaskFor(myFamilyId(), firstDay).phase==='closed'? t('period.task.deadlinePassed') : t('period.task.deadline',{p1:deadlineLabel(p)}))}</p>` : '';
  const rows = pr.rows.map(r => {
    const key = firstDay+'|'+r.id;
    const open = S.periodView===key && r.done;
    const entry = S.periodEntries[periodEntryId(S.periods[firstDay], r.id)];
    const detail = open? `<div class="periodBehalfDetail" data-periodrow="${esc(key)}">${periodWorkdays(p.firstDay,p.lastDay).map(iso =>
        `<div class="periodSummary"><span>${esc(cap(isoDayLabel(iso)))}</span><span class="muted">${esc(periodDaySummary(r.family, iso, entry.days[iso]))}</span></div>`).join('')}
        <button type="button" class="btn small secondary" data-periodfill="${esc(key)}">${t('period.done.edit')}</button></div>` : '';
    return `<div class="periodBehalfRow" data-periodfamily="${esc(key)}">
        <div class="periodBehalfName"><strong>${esc(girlOf(r.family))}</strong><div class="muted" style="font-size:12px">${esc(r.family.parentName||'')}</div></div>
        <span class="periodPill${r.done? ' done' : ' todo'}">${t(r.done? 'period.coord.done' : 'period.coord.notYet')}</span>
        <button type="button" class="btn small secondary" ${r.done? `data-periodview="${esc(key)}"` : `data-periodfill="${esc(key)}"`}>${t(r.done? (open? 'period.coord.hide' : 'period.coord.view') : 'period.coord.fill')}</button>
      </div>${detail}`;
  }).join('');
  const title = `${esc(t('period.coord.title'))}${periodList(S.periods).length>1? ' · '+esc(p.name) : ''}`;
  return foldHtml('periodBehalf|'+firstDay, title, `${intro}
      <p class="muted" id="periodProgress_${firstDay}">${esc(left? t('period.coord.progress',{p1:pr.done, p2:pr.total, p3:left}) : t('period.coord.allDone',{p2:pr.total}))}</p>
      ${rows}`, 'card', 'periodBehalfCard_'+firstDay);
}

// The cards at the top of Wijzigen: per period (oldest first) the task or the "doorgegeven" card, and for the coordinator the overview
// per family. '' when there is nothing for this user.
export function periodCardsHtml(){
  return periodTasks().map(tk => {
    if(!tk.period) return '';
    const own = tk.show==='task'? taskCardHtml(tk) : tk.show==='done'? doneCardHtml(tk) : '';
    return own + (behalfAllowed(tk.period.firstDay)? behalfCardHtml(tk.period.firstDay, !own) : '');
  }).join('');
}

// The red number on the Wijzigen tab: how many periods wait for this family's times.
export function periodBadgeCount(nowMs){ return periodTasks(nowMs).filter(tk => tk.badge).length; }

export function updatePeriodBadge(){
  const el = document.getElementById('navDeviationBadge');
  if(!el) return;
  const n = periodBadgeCount();
  el.textContent = n? String(n) : '';
  el.style.display = n ? '' : 'none';
  if(n) el.setAttribute('aria-label', t('period.badge.aria')); else el.removeAttribute('aria-label');
}

const taskKey = () => periodTasks().map(tk => [tk.period && tk.period.firstDay, tk.show, tk.canEdit, tk.badge, tk.phase, tk.period && behalfAllowed(tk.period.firstDay)].join(':')).join('|');
// Called on every render of Wijzigen: remembers what was shown, and refreshes the badge.
export function markPeriodShown(){ S.periodPhaseKey = taskKey(); updatePeriodBadge(); }
// Called every minute: the moment filling in opens, or a deadline passes, changes what is shown without any database update.
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
  const f = S.periodForm; if(!f) return;
  const tk = periodTaskFor(f.familyId, f.firstDay);
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

// Own family by default; the coordinator can pass another family (on behalf of that parent).
export function openPeriodForm(firstDay, familyId){
  const id = familyId || myFamilyId();
  if(id!==myFamilyId() && !S.canEdit) return false;
  const tk = periodTaskFor(id, firstDay);
  if(!tk.canEdit) return false;
  S.periodForm = { familyId:id, firstDay, days:periodFormFrom(tk.period, tk.family, tk.entry) };
  S.periodView = null;
  renderDeviationTab();
  return true;
}

export function togglePeriodView(firstDay, familyId){
  const key = firstDay+'|'+familyId;
  S.periodView = S.periodView===key? null : key;
  renderDeviationTab();
}

export function cancelPeriodForm(){ S.periodForm = null; renderDeviationTab(); }

export async function submitPeriodForm(){
  if(!S.periodForm) return false;
  readForm();
  const ok = await savePeriodEntry(S.periodForm.familyId, S.periodForm.firstDay, S.periodForm.days);
  if(ok){ S.periodForm = null; renderDeviationTab(); }
  return ok;
}

const splitKey = key => { const i = String(key).indexOf('|'); return [String(key).slice(0,i), String(key).slice(i+1)]; };

export function wirePeriod(){
  document.querySelectorAll('[data-periodopen]').forEach(b => b.onclick = () => { hapticTap(); openPeriodForm(b.dataset.periodopen); });
  document.querySelectorAll('[data-periodedit]').forEach(b => b.onclick = () => { hapticTap(); openPeriodForm(b.dataset.periodedit); });
  const cancel = document.getElementById('periodCancel'); if(cancel) cancel.onclick = () => cancelPeriodForm();
  const submit = document.getElementById('periodSubmit'); if(submit) submit.onclick = () => { hapticTap(); return submitPeriodForm(); };
  document.querySelectorAll('[data-periodfill]').forEach(b => b.onclick = () => { hapticTap(); const [fd, id] = splitKey(b.dataset.periodfill); openPeriodForm(fd, id); });
  document.querySelectorAll('[data-periodview]').forEach(b => b.onclick = () => { hapticTap(); const [fd, id] = splitKey(b.dataset.periodview); togglePeriodView(fd, id); });
  document.querySelectorAll('.periodTime').forEach(el => el.oninput = () => { readForm(); markChanged(); });
  document.querySelectorAll('.periodRideInput').forEach(el => el.onchange = () => { readForm(); renderDeviationTab(); });
}
