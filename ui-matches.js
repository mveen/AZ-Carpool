// ui-matches.js — the Wedstrijden tab (violet "match" theme). Moved here from the bottom of Wijzigen.
// Lists every match of the next 29 days. A carpool can be set up only for the first 8 days
// (matches.js: isMatchPlannable); later matches are shown with a small "not plannable yet" note.
import { t, locale } from './i18n.js';
import { esc, hapticTap, phIcon, showToast } from './ui-common.js';
import { carpoolFor, currentMatchList, isMatchPlannable, matchCarCapacityState, matchLabel, matchSlug, matchesNext29Days, plannableFrom, suggestedMatchDeparture } from './matches.js';
import { fam, girlName, seats, sortFamEntriesByGirl, sortGirlIds } from './rides.js';
import { S } from './state.js';
import { db } from './data.js';
import { matchInfoHtml } from './ui-myweek.js';

// One car of a match carpool. `editable` adds the delete button (Wedstrijden tab only); `highlightId`
// tints the row when that family drives it or has its daughter in it.
export function matchCarRowHtml(c, opts){
  opts = opts||{};
  const girlIds = c.girlIds||[];
  const driver = c.driverFamilyId? esc(fam(c.driverFamilyId).parentName) : t('deviation.nog_geen_chauffeur');
  const cap = c.driverFamilyId? seats(fam(c.driverFamilyId)) : null;
  const over = cap!=null && girlIds.length>cap;
  const mine = !!opts.highlightId && (c.driverFamilyId===opts.highlightId || girlIds.includes(opts.highlightId));
  const overHtml = over? ` <span class="fitbad" style="white-space:nowrap" title="${t('deviation.meer_passagiers_dan_plekken')}">${phIcon('warning')} ${girlIds.length}/${cap}</span>` : '';
  const delHtml = opts.editable? `<button type="button" class="iconbtn danger" data-delmatchcar="${opts.slug}|${opts.idx}" aria-label="Verwijder carpool van ${driver}" title="${t('deviation.verwijder_carpool')}">${phIcon('trash')}</button>` : '';
  return `<div class="matchCarRow${mine?' mine':''}">
    <span class="matchCarDep">${esc(c.departureTime||'--:--')}</span>
    <span style="flex:1;min-width:0">${phIcon('car')} <strong>${driver}</strong> · ${sortGirlIds(girlIds).map(id=>girlName(id)).join(', ')||t('deviation.geen_passagiers')}${overHtml}</span>
    ${delHtml}
  </div>`;
}

// The card with every match of the next 29 days. Nothing at all (empty string) when there is no match.
export function matchesCardHtml(){
  const list = matchesNext29Days(currentMatchList());
  S.weekendMatchBySlug = {};   // only matches that can get a carpool (first 8 days) end up here
  if(!list.length) return '';
  const allFamilies = Object.entries(S.families);
  const anyPlannable = list.some(isMatchPlannable);
  const matchesHtml = list.map(m=>{
    const slug = matchSlug(m);
    const plannable = isMatchPlannable(m);
    const cp = carpoolFor(m);
    const cars = (cp.doc && cp.doc.cars) || [];
    const carsHtml = cars.length? cars.map((c,idx)=>matchCarRowHtml(c,{editable:plannable, slug:cp.id, idx})).join('') : '';
    if(!plannable){
      // Too far ahead: no carpool yet. A small note says from which day it can be set up.
      const from = plannableFrom(m).toLocaleDateString(locale(),{weekday:'long', day:'numeric', month:'long'});
      return `<div class="card matchCard">${matchInfoHtml(m,{geo:true})}${carsHtml}<p class="matchNote">${phIcon('calendar')} ${t('matches.nog_niet_te_plannen', { date: from })}</p></div>`;
    }
    S.weekendMatchBySlug[slug] = m;
    const isOpen = S.openMatchCarpoolForm===slug;
    let formHtml;
    if(isOpen){
      const suggestedDep = suggestedMatchDeparture(m.start);
      const girlOptions = sortFamEntriesByGirl(allFamilies).map(([id,f])=>`<label class="chip"><input type="checkbox" class="matchCarGirlPick" value="${id}">${esc(f.girlName||f.parentName||id)}</label>`).join('');
      const driverOptions = allFamilies.map(([id,f])=>`<option value="${id}">${esc(f.parentName)} (${seats(f)} ${seats(f)===1?t('common.plek'):t('common.plekken')})</option>`).join('');
      formHtml = `<div class="dayFormCard" style="margin-top:8px">
        <label style="margin-top:0">${t('deviation.chauffeur')}</label>
        <select id="matchCarDriver_${slug}"><option value="">${t('deviation.kies')}</option>${driverOptions}</select>
        <label>${t('deviation.welke_passagiers')} <span id="matchCarCount_${slug}"></span></label>
        <div>${girlOptions}</div>
        <div id="matchCarCapWarn_${slug}" class="matchCapWarn" role="status" aria-live="polite"></div>
        <label>${t('deviation.vertrektijd')}</label>
        <input type="time" id="matchCarTime_${slug}" value="${suggestedDep}">
        <button type="button" class="btn small secondary" data-savematchcar="${slug}">${t('deviation.opslaan')}</button>
        <button type="button" class="btn small secondary" data-cancelmatchcar="${slug}">${t('common.annuleren')}</button>
      </div>`;
    } else {
      formHtml = `<button type="button" class="btn small secondary" data-addmatchcar="${slug}" style="margin-top:6px">${t('deviation.auto_toevoegen')}</button>`;
    }
    return `<div class="card matchCard">${matchInfoHtml(m,{geo:true})}${carsHtml || t('deviation.p_class_muted_style_font')}${formHtml}</div>`;
  }).join('');
  return `<div id="matchCarpoolCard">
    <div class="infoLine"><span class="infoLine__text">${t('matches.titel')}. ${anyPlannable? t('deviation.zet_een_carpool_op_voor') : ''}</span></div>
    ${matchesHtml}
  </div>`;
}

export function renderMatchesTab(){
  const box=document.getElementById('tab-matches');
  if(!box) return;
  if(!S.me){ box.innerHTML=''; return; }
  box.innerHTML = matchesCardHtml();
  wireMatchCarpool();
}

export function updateMatchCarCapacityWarning(slug){
  const st = matchCarCapacityState(slug);
  const cnt=document.getElementById('matchCarCount_'+slug);
  if(cnt) cnt.textContent = st.n? '('+t('deviation.gekozen',{n:st.n})+(st.cap!=null?` / ${st.cap} ${st.cap===1?t('common.plek'):t('common.plekken')}`:'')+')' : '';
  const warn=document.getElementById('matchCarCapWarn_'+slug);
  if(warn) warn.innerHTML = st.over
    ? t('deviation.heeft_maar_je_hebt_passagiers', { p1: phIcon('warning'), p2: esc(fam(st.driverId).parentName), p3: st.cap, p4: st.cap===1?'passagiersplek':'passagiersplekken', p5: st.n })
    : '';
  // Any change to the selection cancels a pending "toch opslaan" confirmation.
  const saveBtn=document.querySelector(`[data-savematchcar="${slug}"]`);
  if(saveBtn && saveBtn.dataset.confirmOver==='1'){ saveBtn.dataset.confirmOver=''; saveBtn.textContent=t('deviation.opslaan'); }
}

export function wireMatchCarpool(){
  if(S.openMatchCarpoolForm){
    const slug=S.openMatchCarpoolForm;
    const driverSel=document.getElementById('matchCarDriver_'+slug);
    if(driverSel) driverSel.onchange=()=>updateMatchCarCapacityWarning(slug);
    document.querySelectorAll('.matchCarGirlPick').forEach(c=>c.onchange=()=>updateMatchCarCapacityWarning(slug));
  }
  document.querySelectorAll('[data-addmatchcar]').forEach(b=>b.onclick=()=>{ S.openMatchCarpoolForm=b.dataset.addmatchcar; hapticTap(); renderMatchesTab(); });
  document.querySelectorAll('[data-cancelmatchcar]').forEach(b=>b.onclick=()=>{ S.openMatchCarpoolForm=null; renderMatchesTab(); });
  document.querySelectorAll('[data-savematchcar]').forEach(b=>b.onclick=async ()=>{
    const slug=b.dataset.savematchcar;
    const driverSel=document.getElementById('matchCarDriver_'+slug);
    const timeInp=document.getElementById('matchCarTime_'+slug);
    const girlIds=[...document.querySelectorAll('.matchCarGirlPick:checked')].map(c=>c.value);
    if(!driverSel || !driverSel.value){ showToast(t('deviation.kies_een_chauffeur')); return; }
    if(!girlIds.length){ showToast(t('deviation.kies_minstens_1_dochter')); return; }
    const capState = matchCarCapacityState(slug);
    if(capState.over && b.dataset.confirmOver!=='1'){
      b.dataset.confirmOver='1'; b.textContent=t('deviation.toch_opslaan');
      showToast(t('deviation.te_veel_passagiers_tik_nogmaals', { p1: capState.n, p2: capState.cap }), {icon:'warning'});
      return;
    }
    const m = S.weekendMatchBySlug[slug];
    // Second safety net: never store a carpool for a match that is more than 8 days away.
    if(!m || !isMatchPlannable(m)){ showToast(t('deviation.kon_deze_wedstrijd_niet_vinden')); return; }
    const cp = carpoolFor(m);
    const newCar = {driverFamilyId:driverSel.value, girlIds, departureTime:timeInp.value};
    const cars = cp.doc? [...(cp.doc.cars||[]), newCar] : [newCar];
    try{
      await db.doc("matchCarpools/"+slug).set({matchSlug:slug, calendarId:m.calendarId||'', eventId:m.eventId||'', teamLabel:matchLabel(m), summary:m.summary, location:m.location||'', startMs:m.start.getTime(), cars});
      // An old name-keyed document is moved over to the ID-keyed one.
      if(cp.doc && cp.id!==slug){ try{ await db.doc("matchCarpools/"+cp.id).delete(); }catch(e){} }
      S.openMatchCarpoolForm=null;
      showToast(t('deviation.carpool_toegevoegd'));
    }catch(e){ showToast(t('data.opslaan_mislukt')+(e&&e.message||e)); }
  });
  document.querySelectorAll('[data-delmatchcar]').forEach(b=>b.onclick=async ()=>{
    const [slug,idxStr]=b.dataset.delmatchcar.split('|'); const idx=+idxStr;
    const existing=S.matchCarpools[slug]; if(!existing) return;
    const cars = existing.cars.filter((_,i)=>i!==idx);
    try{
      if(cars.length) await db.doc("matchCarpools/"+slug).set({...existing, cars});
      else await db.doc("matchCarpools/"+slug).delete();
    }catch(e){ showToast(t('beheer.verwijderen_mislukt')+(e&&e.message||e)); }
  });
}
