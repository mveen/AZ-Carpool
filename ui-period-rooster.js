// ui-period-rooster.js — "periode met andere tijden", step 4: the Rooster tab.
//   - the overview card for the coordinator (how many handed in, who not, what changes per day, "Tijdelijk rooster maken"),
//   - the third view next to "Deze week" and "Vast rooster": the temporary rooster of the period, day by day,
//   - the coordinator's edits of it (driver, move a girl, plan a shift again).
// The temporary rooster replaces the standard rooster only inside the period; one-off changes in Wijzigen still go before it.
// The data rules live in period.js and rides.js; storage in data.js (periodCars/*).
import { t } from './i18n.js';
import { S } from './state.js';
import { dayUp, isoDayLabel, isoRangeLabel } from './dates.js';
import { esc, hapticTap, phIcon, showToast, twoStepConfirm } from './ui-common.js';
import { plainGirlName, famTime, fam, girlName, isFlex, sortGirlIds, periodCarsFor, periodDeparture, periodEligibleDrivers, periodRidersFor, periodTimeFor, periodUnplacedFor, seats, plainDriverName } from './rides.js';
import { deletePeriodRooster, makePeriodRooster, replanPeriodShift, savePeriodShift } from './data.js';
import { describeEntryDay, normalizePeriod, periodDayKey, periodEntryId, periodForDate, periodList, periodMoveGirl, periodPhase, periodProgress, periodSetDriver, periodWorkdays } from './period.js';
import { carRouteHtml, driverLineHtml, flexSuffix, openCarPlaceSheet, renderSchedule } from './ui-schedule.js';
import { myLinkedFamilyId } from './coordinator.js';

const madeShifts = p => Object.values(S.periodCars || {}).filter(d => d && d.periodFirstDay===p.firstDay).length;
const todayIso = () => { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };

// The periods that have a temporary view: the coordinator has one for every period from the day filling in opens until it is over;
// everybody else for the periods whose temporary rooster has been made.
export function availablePeriods(nowMs){
  return periodList(S.periods).filter(p => {
    const phase = periodPhase(p, nowMs);
    return (phase==='open' || phase==='closed') && (S.canEdit || madeShifts(p)>0);
  });
}
export function periodModeAvailable(nowMs){ return availablePeriods(nowMs).length>0; }

// The period shown in the temporary view: the chosen one; else the one that is running today; else the next one; else the first.
export function selectedPeriod(nowMs){
  const list = availablePeriods(nowMs);
  if(!list.length) return null;
  const chosen = list.find(p => p.firstDay===S.periodSel);
  if(chosen) return chosen;
  const today = todayIso();
  return list.find(p => p.firstDay<=today && today<=p.lastDay) || list.find(p => p.firstDay>today) || list[0];
}

// The button is small: a name of more than 10 characters is cut ("Herfstvakantie" -> "Herfstvak.", "Kerst" stays "Kerst").
export function periodModeLabel(){
  const p = selectedPeriod(); if(!p) return '';
  const n = normalizePeriod(p).name;
  return n.length>10? n.slice(0,9)+'.' : n;
}

export function periodModeInfoHtml(){
  const p = selectedPeriod(); if(!p) return '';
  return esc(t(S.canEdit? 'period.view.coordInfo' : 'period.view.parentInfo', { p1:p.name, p2:isoRangeLabel(p.firstDay, p.lastDay) }));
}

// The date shown in the temporary view: the chosen one, else the first date of the period that is not past, else the first.
export function periodViewDay(){
  const p = selectedPeriod(); if(!p) return null;
  const days = periodWorkdays(p.firstDay, p.lastDay);
  if(S.periodDay && days.includes(S.periodDay)) return S.periodDay;
  const today = todayIso();
  return days.find(iso => iso>=today) || days[0] || null;
}

// How many families handed in something that differs from their standard rooster on a date, and how many of them do not ride.
export function periodDayChanges(iso){
  const p = periodForDate(S.periods, iso);
  let changes = 0, out = 0;
  if(!p) return { changes, out };
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

// ---------- the overview cards (coordinator, above the switch): one per period ----------
function overviewCardHtml(p, phase){
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
  const made = madeShifts(v)>0, k = v.firstDay;
  return `<div class="card" id="periodOverview_${k}">
      <h2>${esc(t('period.ov.title',{p1:v.name, p2:isoRangeLabel(v.firstDay, v.lastDay)}))}</h2>
      <div class="rowflex"><span class="muted">${t('period.ov.handed')}</span><b>${esc(t('period.ov.handedValue',{p1:pr.done, p2:pr.total}))}</b></div>
      <p class="muted" style="margin:4px 0 0">${esc(deadline)}</p>
      <div class="periodChips">${chips}</div>
      <div class="rowflex" style="gap:6px;margin-top:10px">
        <button type="button" class="btn small${made? ' secondary' : ''}" id="${made? 'periodRemake_' : 'periodMake_'}${k}" ${made? 'data-periodremake' : 'data-periodmake'}="${k}">${t(made? 'period.ov.remake' : 'period.ov.make')}</button>
        ${made? `<button type="button" class="iconbtn danger" id="periodRemove_${k}" data-periodremove="${k}" aria-label="${esc(t('period.ov.remove'))}" title="${esc(t('period.ov.remove'))}">${phIcon('trash')}</button>` : ''}
      </div>
      <p class="muted" style="margin:8px 0 0;font-size:12px">${t('period.ov.explain')}</p>
    </div>`;
}

export function periodOverviewHtml(nowMs){
  if(!S.canEdit || !S.periodEntriesLoaded) return '';
  return availablePeriods(nowMs).map(p => overviewCardHtml(p, periodPhase(p, nowMs))).join('');
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
  const riders = sortGirlIds(car.girlIds||[]).map(id => edit
    ? `<div class="periodRider"><span class="chip${id===myId? ' chip--mine' : ''}${isFlex(fam(id))? ' chip--flex' : ''}">${girlName(id)}${flexSuffix(id)}</span>
        <select class="periodSel periodMove" data-pmove="${esc(id)}" data-iso="${iso}" data-dir="${direction}" aria-label="${esc(t('period.view.move'))} ${esc(plainGirlName(id))}">
          <option value="">${t('period.view.move')}</option>
          ${targets.map(x => `<option value="${x.value}">${esc(x.label)}</option>`).join('')}
          <option value="none">${t('period.view.notPlaced')}</option>
        </select></div>`
    : `<span class="chip${id===myId? ' chip--mine' : ''}">${girlName(id)}</span>`).join('');
  return `<div class="carCard">
      <div class="carCard__head">
        <span class="carCard__time">${esc(car.departureTime||'--:--')}</span>
        <div class="carCard__who">${edit? '' : driverPart}${carRouteHtml(car, direction, day, { edit, pcar:iso+'|'+direction+'|'+idx })}</div>
        ${driver? `<span class="tag${cap!=null && (car.girlIds||[]).length>cap? ' tag--warn' : ''}" aria-label="${(car.girlIds||[]).length}/${cap} ${t('schedule.plekken')}">${(car.girlIds||[]).length}/${cap}</span>` : ''}
      </div>
      ${edit? `<div class="carCard__note">${driverPart}</div>` : ''}
      <div class="chips">${riders}</div>
    </div>`;
}

function unplacedHtml(iso, direction, cars){
  const un = periodUnplacedFor(iso, direction);
  if(!un.length) return '';
  const free = periodEligibleDrivers(iso, direction, 1).filter(([id]) => !cars.some(c => c.driverFamilyId===id));
  const rows = sortGirlIds(un.map(([id]) => id)).map(id => S.canEdit
    ? `<div class="alertCard__row"><span><strong>${girlName(id)}</strong></span>
        <select class="periodSel periodMove" data-pmove="${esc(id)}" data-iso="${iso}" data-dir="${direction}" aria-label="${esc(t('period.view.place'))} ${esc(plainGirlName(id))}">
          <option value="">${t('period.view.place')}</option>
          ${cars.map((c, i) => `<option value="car:${i}">${esc(t('period.view.moveTo',{p1:i+1, p2:plainDriverName(c.driverFamilyId)}))}</option>`).join('')}
          ${free.map(([did, f]) => `<option value="new:${esc(did)}">${esc(t('period.view.newCar',{p1:f.parentName||did}))}</option>`).join('')}
        </select></div>`
    : `<div class="alertCard__row"><span><strong>${girlName(id)}</strong></span></div>`).join('');
  return `<div class="alertCard alertCard--stack" role="alert"><div class="alertCard__text"><b><span class="alertCard__icon">${phIcon('warning-circle-fill')}</span> ${esc(t('period.view.unplaced',{p1:un.length}))}</b></div>${rows}</div>`;
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
      <div class="sectionHead"><div class="sectionHead__title">${direction==='heen'? t('dir.heenShort') : t('dir.terugShort')}</div>${replan}</div>
      <div class="periodTimes"><div class="muted" style="font-size:12px;margin:6px 0 2px">${t('period.view.times')}</div>${periodTimesHtml(iso, direction)}</div>
      ${body}
    </div>`;
}

// The whole third view: a field to choose the period (only when there is more than one), the pills of its dates and the open date.
export function periodViewHtml(){
  const p = selectedPeriod(); if(!p) return '';
  const list = availablePeriods();
  const days = periodWorkdays(p.firstDay, p.lastDay), open = periodViewDay();
  const pick = list.length>1
    ? `<div style="margin-bottom:10px"><label class="periodLbl" for="periodPick">${t('period.view.pick')}</label>
        <select id="periodPick" class="periodSel" data-periodpick="1">${list.map(q => `<option value="${q.firstDay}"${q.firstDay===p.firstDay? ' selected' : ''}>${esc(q.name)} · ${esc(isoRangeLabel(q.firstDay, q.lastDay))}</option>`).join('')}</select></div>` : '';
  const pills = days.map(iso => {
    const carCount = ['heen','terug'].reduce((n, d) => n + (periodCarsFor(iso, d) || []).length, 0);
    const unplaced = ['heen','terug'].reduce((n, d) => n + periodUnplacedFor(iso, d).length, 0);
    return `<button type="button" class="dayPill${iso===open? ' on' : ''}" data-perday="${iso}" aria-pressed="${iso===open}" aria-label="${esc(isoDayLabel(iso,'long'))}, ${carCount} ${t('schedule.rit')}${carCount===1? '' : 'ten'}${unplaced? ', '+esc(t('period.view.unplaced',{p1:unplaced})) : ''}">
        <span class="dayPill__ab">${esc(dayUp(periodDayKey(iso)).toLowerCase())}</span>
        <span class="dayPill__n">${esc(isoDayLabel(iso,'').split(' ')[0])}</span>
        ${unplaced? `<span class="dayPill__dot" aria-hidden="true"></span>` : ''}
      </button>`;
  }).join('');
  return `${pick}<div class="dayPills periodPills" role="group" aria-label="${esc(t('deviation.kies_een_dag'))}">${pills}</div>
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

// Another departure and/or arrival place for one car of the temporary rooster (only this car, only this date). '' = follow the standard.
export function setPeriodCarPlace(iso, direction, index, fields){
  return editShift(iso, direction, cars => {
    if(!cars[index]) return { cars, error: { key:'period.rooster.err.unknown' } };
    const car = { ...cars[index], ...fields };
    ['stdLocationId','stdDestination'].forEach(k => { if(!car[k]) delete car[k]; });
    return { cars: cars.map((c, i) => i===index? car : c), error: null };
  });
}

function openPeriodCarPlace(iso, direction, index){
  const car = (periodCarsFor(iso, direction) || [])[index]; if(!car) return;
  const day = dayKeyOf(iso);
  const dirName = direction==='heen'? t('dir.heenShort') : t('dir.terugShort');
  openCarPlaceSheet(car, day, direction, t('loc.periodTitle'), t('loc.periodSub',{p1:dirName, p2:isoDayLabel(iso,'long')}), fields => setPeriodCarPlace(iso, direction, index, fields));
}

export function wirePeriodRooster(){
  document.querySelectorAll('[data-perday]').forEach(b => b.onclick = () => { S.periodDay = b.dataset.perday; hapticTap(); renderSchedule(); });
  document.querySelectorAll('[data-periodpick]').forEach(el => el.onchange = () => { S.periodSel = el.value; S.periodDay = null; renderSchedule(); });
  if(!S.canEdit) return;
  const then = () => renderSchedule();
  document.querySelectorAll('[data-periodmake]').forEach(b => b.onclick = () => { hapticTap(); return makePeriodRooster(b.dataset.periodmake).then(then); });
  document.querySelectorAll('[data-periodremake]').forEach(b => b.onclick = () => twoStepConfirm(b, t('beheer.zeker_nogmaals_klikken'), () => makePeriodRooster(b.dataset.periodremake).then(then)));
  document.querySelectorAll('[data-periodremove]').forEach(b => b.onclick = () => twoStepConfirm(b, t('beheer.zeker_nogmaals_klikken'), () => deletePeriodRooster(b.dataset.periodremove).then(then)));
  document.querySelectorAll('[data-preplan]').forEach(b => b.onclick = () => {
    const [iso, direction] = b.dataset.preplan.split('|');
    hapticTap(); return replanPeriodShift(iso, direction).then(then);
  });
  document.querySelectorAll('[data-pcarplace]').forEach(b => b.onclick = () => {
    const [iso, direction, idx] = b.dataset.pcarplace.split('|');
    hapticTap(); openPeriodCarPlace(iso, direction, +idx);
  });
  document.querySelectorAll('[data-pdrv]').forEach(el => el.onchange = () => setPeriodDriver(el.dataset.iso, el.dataset.dir, +el.dataset.pdrv, el.value));
  document.querySelectorAll('.periodMove').forEach(el => el.onchange = () => { if(el.value) movePeriodGirl(el.dataset.iso, el.dataset.dir, el.dataset.pmove, el.value); });
}
