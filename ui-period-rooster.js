// ui-period-rooster.js — "periode met andere tijden", step 4: the Rooster tab.
//   - the overview card for the coordinator (how many handed in, who not, what changes per day, "Tijdelijk rooster maken"),
//   - the third view next to "Deze week" and "Vast rooster": the temporary rooster of the period, day by day,
//   - the coordinator's edits of it (driver, move a girl, plan a shift again).
// The temporary rooster replaces the standard rooster only inside the period; one-off changes in Wijzigen still go before it.
// The data rules live in period.js and rides.js; storage in data.js (periodCars/*).
import { t } from './i18n.js';
import { S } from './state.js';
import { dayUp, isoDayLabel, isoRangeLabel } from './dates.js';
import { dirLabelHtml, esc, hapticTap, phIcon, shiftLocationHtml, showToast, twoStepConfirm } from './ui-common.js';
import { plainGirlName, famTime, fam, girlName, isFlex, periodCarsFor, periodDeparture, periodEligibleDrivers, periodRidersFor, periodTimeFor, periodUnplacedFor, seats, plainDriverName } from './rides.js';
import { deletePeriodRooster, makePeriodRooster, replanPeriodShift, savePeriodShift } from './data.js';
import { describeEntryDay, normalizePeriod, periodDayKey, periodEntryId, periodMoveGirl, periodPhase, periodProgress, periodSetDriver, periodWorkdays } from './period.js';
import { driverLineHtml, renderSchedule } from './ui-schedule.js';
import { myLinkedFamilyId } from './coordinator.js';

const madeShifts = () => {
  const p = S.period; if(!p) return 0;
  return Object.values(S.periodCars || {}).filter(d => d && d.periodFirstDay===p.firstDay).length;
};

// Is the third view there? The coordinator has it from the day filling in opens until the period is over;
// everybody else once the temporary rooster has been made.
export function periodModeAvailable(nowMs){
  const p = S.period; if(!p) return false;
  const phase = periodPhase(p, nowMs);
  if(phase!=='open' && phase!=='closed') return false;
  return S.canEdit || madeShifts()>0;
}

// The button is small: a name of more than 10 characters is cut ("Herfstvakantie" -> "Herfstvak.", "Kerst" stays "Kerst").
export function periodModeLabel(){
  const n = normalizePeriod(S.period).name;
  return n.length>10? n.slice(0,9)+'.' : n;
}

export function periodModeInfoHtml(){
  const p = normalizePeriod(S.period);
  return esc(t(S.canEdit? 'period.view.coordInfo' : 'period.view.parentInfo', { p1:p.name, p2:isoRangeLabel(p.firstDay, p.lastDay) }));
}

// The date shown in the temporary view: the chosen one, else the first date of the period that is not past, else the first.
export function periodViewDay(){
  const p = S.period; if(!p) return null;
  const days = periodWorkdays(p.firstDay, p.lastDay);
  if(S.periodDay && days.includes(S.periodDay)) return S.periodDay;
  const d = new Date(); const today = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  return days.find(iso => iso>=today) || days[0] || null;
}

// How many families handed in something that differs from their standard rooster on a date, and how many of them do not ride.
export function periodDayChanges(iso){
  const p = S.period;
  let changes = 0, out = 0;
  Object.entries(S.families).forEach(([id, f]) => {
    if(isFlex(f)) return;
    const entry = S.periodEntries[periodEntryId(p, id)];
    if(!entry || !entry.days || !entry.days[iso]) return;
    const d = describeEntryDay(f, iso, entry.days[iso]);
    if(d.kind!=='standard') changes++;
    if(d.kind==='out') out++;
  });
  return { changes, out };
}

// ---------- the overview card (coordinator, above the switch) ----------
export function periodOverviewHtml(nowMs){
  const p = S.period;
  if(!S.canEdit || !p || !S.periodEntriesLoaded) return '';
  const phase = periodPhase(p, nowMs);
  if(phase!=='open' && phase!=='closed') return '';
  const v = normalizePeriod(p), pr = periodProgress(p, S.families, S.periodEntries);
  const missing = pr.rows.filter(r => !r.done).map(r => plainGirlName(r.id));
  const shown = missing.slice(0,5).join(', ') + (missing.length>5? ' +'+(missing.length-5) : '');
  const dl = isoDayLabel(v.deadlineDate)+' '+v.deadlineTime;
  const deadline = phase==='open'
    ? (missing.length? t('period.ov.deadlineOpen',{p1:dl, p2:shown}) : t('period.ov.deadlineOpenAll',{p1:dl}))
    : (missing.length? t('period.ov.deadlineClosed',{p2:shown}) : t('period.ov.deadlineClosedAll'));
  const chips = periodWorkdays(v.firstDay, v.lastDay).map(iso => {
    const c = periodDayChanges(iso);
    return `<div class="periodChip" title="${esc(t('period.ov.dayTitle',{p1:isoDayLabel(iso,'long'), p2:c.changes, p3:c.out}))}">
        <span class="periodChipDay">${esc(dayUp(periodDayKey(iso)))} ${esc(isoDayLabel(iso,'').split(' ')[0])}</span>
        <span class="muted">${esc(c.changes? t('period.ov.dayChanges',{p1:c.changes}) : t('period.ov.noChanges'))}</span>
      </div>`;
  }).join('');
  const made = madeShifts()>0;
  return `<div class="card" id="periodOverview">
      <h2>${esc(t('period.ov.title',{p1:v.name, p2:isoRangeLabel(v.firstDay, v.lastDay)}))}</h2>
      <div class="rowflex"><span class="muted">${t('period.ov.handed')}</span><b>${esc(t('period.ov.handedValue',{p1:pr.done, p2:pr.total}))}</b></div>
      <p class="muted" style="margin:4px 0 0">${esc(deadline)}</p>
      <div class="periodChips">${chips}</div>
      <div class="rowflex" style="gap:6px;margin-top:10px">
        <button type="button" class="btn small${made? ' secondary' : ''}" id="${made? 'periodRemake' : 'periodMake'}">${t(made? 'period.ov.remake' : 'period.ov.make')}</button>
        ${made? `<button type="button" class="iconbtn danger" id="periodRemove" aria-label="${esc(t('period.ov.remove'))}" title="${esc(t('period.ov.remove'))}">${phIcon('trash')}</button>` : ''}
      </div>
      <p class="muted" style="margin:8px 0 0;font-size:12px">${t('period.ov.explain')}</p>
    </div>`;
}

// ---------- the temporary rooster, one date ----------
const dayKeyOf = iso => periodDayKey(iso);

// Who rides on a date and direction, with the handed-in time next to the standard one (struck through when it differs).
export function periodTimesHtml(iso, direction){
  const day = dayKeyOf(iso);
  const rows = Object.entries(S.families)
    .filter(([, f]) => !isFlex(f))
    .map(([id, f]) => ({ id, f, std:famTime(id, day, direction), per:periodTimeFor(id, iso, direction) }))
    .filter(r => r.std || r.per)
    .sort((a, b) => (a.per||a.std).localeCompare(b.per||b.std) || plainGirlName(a.id).localeCompare(plainGirlName(b.id), 'nl'));
  if(!rows.length) return `<p class="muted">${t('period.view.nobody')}</p>`;
  return rows.map(r => {
    const changed = r.std!==r.per;
    const time = r.per? (changed? `<s class="muted">${esc(r.std||'–')}</s> <strong class="periodChanged">${esc(r.per)}</strong>` : `<strong>${esc(r.per)}</strong>`)
      : `<s class="muted">${esc(r.std)}</s> <span class="periodChanged">${t('period.view.notRiding')}</span>`;
    return `<div class="periodTimeRow"><span><strong>${girlName(r.id)}</strong> <span class="muted">${esc(r.f.parentName||'')}</span></span><span>${time}</span></div>`;
  }).join('');
}

function carHtml(iso, direction, car, idx, cars){
  const day = dayKeyOf(iso), driver = car.driverFamilyId? fam(car.driverFamilyId) : null;
  const edit = S.canEdit, myId = myLinkedFamilyId();
  const cap = driver? seats(driver) : null;
  const driverTaken = new Set(cars.filter((c, i) => i!==idx).map(c => c.driverFamilyId).filter(Boolean));
  const options = periodEligibleDrivers(iso, direction, Math.max(1, (car.girlIds||[]).length)).filter(([id]) => id===car.driverFamilyId || !driverTaken.has(id));
  const known = car.driverFamilyId && options.some(([id]) => id===car.driverFamilyId);
  const driverPart = edit
    ? `<label class="periodLbl" for="periodDrv_${idx}">${t('period.view.driver')}</label>
       <select id="periodDrv_${idx}" class="periodSel" data-pdrv="${idx}" data-iso="${iso}" data-dir="${direction}">
         <option value="">${t('period.view.noDriver')}</option>
         ${car.driverFamilyId && !known? `<option value="${esc(car.driverFamilyId)}" selected>${esc(plainDriverName(car.driverFamilyId))}</option>` : ''}
         ${options.map(([id, f]) => `<option value="${esc(id)}"${id===car.driverFamilyId? ' selected' : ''}>${esc(f.parentName||id)} (${seats(f)})</option>`).join('')}
       </select>`
    : driverLineHtml(car.driverFamilyId, myId);
  const targets = cars.map((c, i) => ({ value:'car:'+i, label:t('period.view.moveTo',{p1:i+1, p2:plainDriverName(c.driverFamilyId)}) })).filter((x, i) => i!==idx);
  const riders = (car.girlIds||[]).map(id => edit
    ? `<div class="periodRider"><span class="pill${id===myId? ' mine' : ''}">${girlName(id)}</span>
        <select class="periodSel periodMove" data-pmove="${esc(id)}" data-iso="${iso}" data-dir="${direction}" aria-label="${esc(t('period.view.move'))} ${esc(plainGirlName(id))}">
          <option value="">${t('period.view.move')}</option>
          ${targets.map(x => `<option value="${x.value}">${esc(x.label)}</option>`).join('')}
          <option value="none">${t('period.view.notPlaced')}</option>
        </select></div>`
    : `<span class="pill${id===myId? ' mine' : ''}">${girlName(id)}</span>`).join('');
  return `<div class="group confirmed${myId && car.driverFamilyId===myId? ' minedriving' : ''}">
      <div class="rowflex" style="align-items:flex-start;gap:10px">
        <div class="rowflex" style="gap:10px;align-items:flex-start;flex:1">
          <span class="dayBadge accent">${idx+1}</span>
          <div><div class="dir">${t('deviation.vertrek')}</div><div class="time">${esc(car.departureTime||'--:--')}</div></div>
        </div>
        ${driver? `<span class="capbadge${cap!=null && (car.girlIds||[]).length>cap? ' fitbad' : ''}">${(car.girlIds||[]).length}/${cap} ${t('schedule.plekken')}</span>` : ''}
      </div>
      <div>${riders}</div>
      ${driverPart}
      ${shiftLocationHtml(car, direction, {day})}
    </div>`;
}

function unplacedHtml(iso, direction, cars){
  const un = periodUnplacedFor(iso, direction);
  if(!un.length) return '';
  const free = periodEligibleDrivers(iso, direction, 1).filter(([id]) => !cars.some(c => c.driverFamilyId===id));
  const rows = un.map(([id]) => S.canEdit
    ? `<div class="row"><span><strong>${girlName(id)}</strong></span>
        <select class="periodSel periodMove" data-pmove="${esc(id)}" data-iso="${iso}" data-dir="${direction}" aria-label="${esc(t('period.view.place'))} ${esc(plainGirlName(id))}">
          <option value="">${t('period.view.place')}</option>
          ${cars.map((c, i) => `<option value="car:${i}">${esc(t('period.view.moveTo',{p1:i+1, p2:plainDriverName(c.driverFamilyId)}))}</option>`).join('')}
          ${free.map(([did, f]) => `<option value="new:${esc(did)}">${esc(t('period.view.newCar',{p1:f.parentName||did}))}</option>`).join('')}
        </select></div>`
    : `<div class="row"><span><strong>${girlName(id)}</strong></span></div>`).join('');
  return `<div class="unplacedAlert"><div class="ttl">${phIcon('warning')} ${esc(t('period.view.unplaced',{p1:un.length}))}</div>${rows}</div>`;
}

// One direction of one date: the handed-in times, the cars, and (coordinator) the buttons to change them.
export function periodDirectionHtml(iso, direction){
  const cars = periodCarsFor(iso, direction);
  const made = cars!==null;
  const body = made
    ? ((cars.length? cars.map((c, i) => carHtml(iso, direction, c, i, cars)).join('') : `<p class="muted">${t('period.view.noCars')}</p>`) + unplacedHtml(iso, direction, cars))
    : `<p class="muted">${t('period.view.notMade')}</p>`;
  const replan = S.canEdit? `<button type="button" class="btn small secondary" data-preplan="${iso}|${direction}">${t('period.view.replan')}</button>` : '';
  return `<div class="periodDir" data-perdir="${iso}|${direction}" style="margin-bottom:12px">
      <div class="rowflex" style="justify-content:space-between;gap:6px">${dirLabelHtml(direction)}${replan}</div>
      <div class="periodTimes"><div class="muted" style="font-size:12px;margin:6px 0 2px">${t('period.view.times')}</div>${periodTimesHtml(iso, direction)}</div>
      ${body}
    </div>`;
}

// The whole third view: the pills of the period's dates and the open date.
export function periodViewHtml(){
  const p = S.period; if(!p) return '';
  const days = periodWorkdays(p.firstDay, p.lastDay), open = periodViewDay();
  const pills = days.map(iso => {
    const carCount = ['heen','terug'].reduce((n, d) => n + (periodCarsFor(iso, d) || []).length, 0);
    const unplaced = ['heen','terug'].reduce((n, d) => n + periodUnplacedFor(iso, d).length, 0);
    return `<button type="button" class="daypill${iso===open? ' active' : ''}" data-perday="${iso}" aria-pressed="${iso===open}" aria-label="${esc(isoDayLabel(iso,'long'))}, ${carCount} ${t('schedule.rit')}${carCount===1? '' : 'ten'}${unplaced? ', '+esc(t('period.view.unplaced',{p1:unplaced})) : ''}">
        <span class="daypillTop">${esc(dayUp(periodDayKey(iso)))} ${esc(isoDayLabel(iso,'').split(' ')[0])}</span>
        <span class="daypillSub">${carCount} ${t('schedule.rit')}${carCount===1? '' : 'ten'}</span>
        ${unplaced? `<span class="daypillAlert" aria-hidden="true">${unplaced}</span>` : ''}
      </button>`;
  }).join('');
  return `<div class="daypills periodPills" role="group" aria-label="${esc(t('deviation.kies_een_dag'))}">${pills}</div>
    <div class="daysection"><h3>${esc(isoDayLabel(open,'long'))}</h3>
      ${periodDirectionHtml(open,'heen')}
      ${periodDirectionHtml(open,'terug')}
    </div>`;
}

// ---------- the coordinator's edits ----------
const cur = (iso, direction) => (periodCarsFor(iso, direction) || []).map(c => ({ ...c, girlIds:[...(c.girlIds||[])] }));
const capOf = id => (id && S.families[id])? seats(S.families[id]) : null;

// One edit of one shift: `edit(cars)` -> { cars, error }. Nothing is stored when there is an error.
async function editShift(iso, direction, edit){
  const r = edit(cur(iso, direction));
  if(r.error){ showToast(t(r.error.key, { p1:r.error.p1, p2:r.error.p2 })); renderSchedule(); return false; }
  const ok = await savePeriodShift(iso, direction, r.cars);
  if(ok) showToast(t('period.rooster.saved'));
  renderSchedule();
  return ok;
}

export function movePeriodGirl(iso, direction, girlId, target){
  return editShift(iso, direction, cars => periodMoveGirl(cars, girlId, target, ids => periodDeparture(iso, direction, ids), capOf));
}
export function setPeriodDriver(iso, direction, index, driverId){
  return editShift(iso, direction, cars => periodSetDriver(cars, index, driverId, capOf));
}

export function wirePeriodRooster(){
  document.querySelectorAll('[data-perday]').forEach(b => b.onclick = () => { S.periodDay = b.dataset.perday; hapticTap(); renderSchedule(); });
  if(!S.canEdit) return;
  const make = document.getElementById('periodMake'); if(make) make.onclick = () => { hapticTap(); return makePeriodRooster().then(() => renderSchedule()); };
  const remake = document.getElementById('periodRemake'); if(remake) remake.onclick = () => twoStepConfirm(remake, t('beheer.zeker_nogmaals_klikken'), () => makePeriodRooster().then(() => renderSchedule()));
  const remove = document.getElementById('periodRemove'); if(remove) remove.onclick = () => twoStepConfirm(remove, t('beheer.zeker_nogmaals_klikken'), () => deletePeriodRooster().then(() => renderSchedule()));
  document.querySelectorAll('[data-preplan]').forEach(b => b.onclick = () => {
    const [iso, direction] = b.dataset.preplan.split('|');
    hapticTap(); return replanPeriodShift(iso, direction).then(() => renderSchedule());
  });
  document.querySelectorAll('[data-pdrv]').forEach(el => el.onchange = () => setPeriodDriver(el.dataset.iso, el.dataset.dir, +el.dataset.pdrv, el.value));
  document.querySelectorAll('.periodMove').forEach(el => el.onchange = () => { if(el.value) movePeriodGirl(el.dataset.iso, el.dataset.dir, el.dataset.pmove, el.value); });
}
