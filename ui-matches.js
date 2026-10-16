// ui-matches.js — the Wedstrijden tab (violet "match" theme). Moved here from the bottom of Wijzigen.
// Lists every match of the next 29 days. A carpool can be set up only for the first 8 days
// (matches.js: isMatchPlannable); later matches are shown with a small "not plannable yet" note.
// Parents can also add a practice match (oefenwedstrijd) with the button on the info line; it then behaves like any match.
import { t, locale } from './i18n.js';
import { closeSheet, esc, hapticTap, locationsCfg, phIcon, showToast } from './ui-common.js';
import { buildPracticeDoc, carpoolFor, currentMatchList, isMatchPlannable, isPracticeMatch, matchCarCapacityState, matchLabel, matchSlug, matchesNext29Days, plannableFrom, practiceIdOf, practiceToMatch, suggestedMatchDeparture } from './matches.js';
import { FREE_TEXT_MAX, MATCH_FROM_OTHER, matchFromChoice, matchFromFields, matchFromName, matchFromOptions } from './locations.js';
import { fam, girlName, seats, sortFamEntriesFlexLast, sortGirlIds } from './rides.js';
import { S } from './state.js';
import { db } from './data.js';
import { matchInfoHtml } from './ui-myweek.js';
import { myLinkedFamilyId } from './coordinator.js';

// ---------- "Vertrek vanaf" (every car of a match carpool) ----------
// The select (all known places + "Andere locatie") and, for a free input, a text field. `car` is the car being edited, or null.
export function matchFromFieldsHtml(slug, car){
  const cfg = locationsCfg();
  const choice = matchFromChoice(car, cfg);
  const options = matchFromOptions(cfg).map(o=>`<option value="${esc(o.id)}"${choice.id===o.id?' selected':''}>${esc(o.name)}</option>`).join('')
    + `<option value="${MATCH_FROM_OTHER}"${choice.id===MATCH_FROM_OTHER?' selected':''}>${esc(t('matches.vertrek_andere'))}</option>`;
  return `<label for="matchCarFrom_${slug}">${t('matches.vertrek_vanaf_label')}</label>
    <select id="matchCarFrom_${slug}">${options}</select>
    <input type="text" id="matchCarFromTxt_${slug}" class="matchFromTxt" maxlength="${FREE_TEXT_MAX}" placeholder="${esc(t('matches.vertrek_andere_ph'))}" aria-label="${esc(t('matches.vertrek_vanaf_label'))}" value="${esc(choice.text)}"${choice.id===MATCH_FROM_OTHER?'':' hidden'}>`;
}

// One car of a match carpool. `editable` adds the delete button (Wedstrijden tab only); `highlightId`
// tints the row when that family drives it or has its daughter in it.
export function matchCarRowHtml(c, opts){
  opts = opts||{};
  const girlIds = c.girlIds||[];
  const driver = c.driverFamilyId? esc(fam(c.driverFamilyId).parentName) : t('deviation.nog_geen_chauffeur');
  const cap = c.driverFamilyId? seats(fam(c.driverFamilyId)) : null;
  const over = cap!=null && girlIds.length>cap;
  const mine = !!opts.highlightId && (c.driverFamilyId===opts.highlightId || girlIds.includes(opts.highlightId));
  const overHtml = over? ` <span class="fitbad" title="${t('deviation.meer_passagiers_dan_plekken')}">${phIcon('warning')} ${girlIds.length}/${cap}</span>` : '';
  const seatHtml = cap!=null && !over? ` <span class="tag">${girlIds.length}/${cap}</span>` : '';
  const delHtml = opts.editable? `<button type="button" class="iconbtn danger" data-delmatchcar="${opts.slug}|${opts.idx}" aria-label="Verwijder carpool van ${driver}" title="${t('deviation.verwijder_carpool')}">${phIcon('trash')}</button>` : '';
  const editHtml = opts.editable? `<button type="button" class="iconbtn" data-editmatchcar="${opts.slug}|${opts.idx}" aria-label="${t('matches.auto_wijzigen',{driver})}" title="${t('matches.auto_wijzigen',{driver})}">${phIcon('pencil')}</button>` : '';
  const place = matchFromName(c, locationsCfg());
  const fromHtml = `<span class="matchCarFrom">${phIcon('map-pin')} ${esc(t('matches.vertrek_vanaf',{place}))}</span>`;
  return `<div class="matchCarRow${mine?' mine':''}">
    <span class="matchCarDep">${esc(c.departureTime||'--:--')}</span>
    <span class="matchCarWho">${phIcon('car')} <strong>${driver}</strong> · ${sortGirlIds(girlIds).map(id=>girlName(id)).join(', ')||t('deviation.geen_passagiers')}${overHtml}${seatHtml}${fromHtml}</span>
    ${editHtml}${delHtml}
  </div>`;
}

// A match card. A practice match gets a pencil and a trash button next to its title (anyone may change or remove it).
function matchCardHtml(m, bodyHtml){
  if(!isPracticeMatch(m)) return `<div class="card matchCard">${matchInfoHtml(m,{geo:true})}${bodyHtml}</div>`;
  const id = esc(practiceIdOf(m));
  const tools = `<div class="matchTools">
    <button type="button" class="iconbtn" data-editpractice="${id}" aria-label="${esc(t('matches.oefen_wijzig_aria'))}" title="${esc(t('matches.oefen_wijzig_aria'))}">${phIcon('pencil')}</button>
    <button type="button" class="iconbtn danger" data-delpractice="${id}" aria-label="${esc(t('matches.oefen_verwijder_aria'))}" title="${esc(t('matches.oefen_verwijder_aria'))}">${phIcon('trash')}</button>
  </div>`;
  return `<div class="card matchCard"><div class="matchCard__top">${matchInfoHtml(m,{geo:true})}${tools}</div>${bodyHtml}</div>`;
}

const addPracticeBtn = () => `<button type="button" class="btn small secondary" data-addpractice="1">${phIcon('plus-circle')}${esc(t('matches.oefen_knop'))}</button>`;

// The card with every match of the next 29 days. With no match at all only the info line (and its button) is shown.
export function matchesCardHtml(){
  const list = matchesNext29Days(currentMatchList());
  S.weekendMatchBySlug = {};   // only matches that can get a carpool (first 8 days) end up here
  if(!list.length) return `<div id="matchCarpoolCard"><div class="infoLine"><span class="infoLine__text">${t('matches.geen')}</span>${addPracticeBtn()}</div></div>`;
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
      return matchCardHtml(m, `${carsHtml}<p class="matchNote">${phIcon('calendar')} ${t('matches.nog_niet_te_plannen', { date: from })}</p>`);
    }
    S.weekendMatchBySlug[slug] = m;
    const isOpen = S.openMatchCarpoolForm===slug;
    const own = myLinkedFamilyId();
    const ownIdx = own? cars.findIndex(c=>c.driverFamilyId===own) : -1;
    // One row of two buttons ("Ik rij ook" only while the own car is not in yet); while the form is open the row is hidden.
    const quickHtml = !own || ownIdx>=0? ''
      : `<button type="button" class="btn small" data-iride="${slug}">${phIcon('plus-circle')}${t('matches.ik_rij_ook')}</button>`;
    const actionsHtml = isOpen? '' : `<div class="matchActions">${quickHtml}<button type="button" class="btn small secondary" data-addmatchcar="${slug}">${phIcon('car')}${t('matches.auto_toevoegen')}</button></div>`;
    let formHtml = '';
    if(isOpen){
      const editing = S.editMatchCarIdx!=null && cars[S.editMatchCarIdx] || null;   // the car being edited, or null when adding
      const suggestedDep = (editing && editing.departureTime) || suggestedMatchDeparture(m.start);
      const girlOptions = sortFamEntriesFlexLast(allFamilies).map(([id,f])=>`<label class="chip"><input type="checkbox" class="matchCarGirlPick" value="${id}"${editing && (editing.girlIds||[]).includes(id)?' checked':''}>${esc(f.girlName||f.parentName||id)}</label>`).join('');
      const driverOptions = allFamilies.map(([id,f])=>`<option value="${id}"${editing && editing.driverFamilyId===id?' selected':''}>${esc(f.parentName)} (${seats(f)} ${seats(f)===1?t('common.plek'):t('common.plekken')})</option>`).join('');
      formHtml = `<div class="dayFormCard">
        <label>${t('deviation.chauffeur')}</label>
        <select id="matchCarDriver_${slug}"><option value="">${t('deviation.kies')}</option>${driverOptions}</select>
        <label>${t('deviation.welke_passagiers')} <span id="matchCarCount_${slug}"></span></label>
        <div>${girlOptions}</div>
        <div id="matchCarCapWarn_${slug}" class="matchCapWarn" role="status" aria-live="polite"></div>
        ${matchFromFieldsHtml(slug, editing)}
        <label>${t('deviation.vertrektijd')}</label>
        <input type="time" id="matchCarTime_${slug}" value="${suggestedDep}">
        <div class="formActions">
          <button type="button" class="btn small" data-savematchcar="${slug}">${t('deviation.opslaan')}</button>
          <button type="button" class="btn small secondary" data-cancelmatchcar="${slug}">${t('common.annuleren')}</button>
        </div>
      </div>`;
    }
    return matchCardHtml(m, `${carsHtml || t('deviation.p_class_muted_style_font')}${actionsHtml}${formHtml}`);
  }).join('');
  return `<div id="matchCarpoolCard">
    <div class="infoLine"><span class="infoLine__text">${t('matches.titel')} ${anyPlannable? t('deviation.zet_een_carpool_op_voor') : ''}</span>${addPracticeBtn()}</div>
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

// What is stored for one match carpool: the match itself (denormalized, so Mijn week and the agenda need no calendar) plus the cars.
function carpoolDoc(m, slug, cars){
  return {matchSlug:slug, calendarId:m.calendarId||'', eventId:m.eventId||'', teamLabel:matchLabel(m), summary:m.summary, location:m.location||'', startMs:m.start.getTime(), cars};
}

// Writes the cars of one match carpool (shared by the full form and the quick "Ik rij ook" button).
// An old name-keyed document is moved over to the ID-keyed one.
async function writeMatchCars(m, cp, slug, cars){
  if(cars.length){
    await db.doc("matchCarpools/"+slug).set(carpoolDoc(m, slug, cars));
  } else if(cp.doc){ await db.doc("matchCarpools/"+cp.id).delete(); }
  if(cars.length && cp.doc && cp.id!==slug){ try{ await db.doc("matchCarpools/"+cp.id).delete(); }catch(e){} }
}

// ---------- Practice matches ----------
const newPracticeId = () => 'pm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Validates and stores a practice match (a new one, or editId to change one). When a match that already has a carpool is changed,
// the carpool's copy of the match info (date, place, name) follows. Returns {ok:false, errors} or {ok:true, id, slug, old, oldCarpool, beyond}.
export async function savePractice(input, editId){
  const r = buildPracticeDoc(input, S.matchFeeds, Date.now());
  if(!r.ok) return r;
  const old = editId && S.practiceMatches && S.practiceMatches[editId] || null;
  const id = old? editId : newPracticeId();
  const doc = {...r.doc, createdAt: (old && old.createdAt) || Date.now()};
  await db.doc('practiceMatches/'+id).set(doc);
  const m = practiceToMatch(id, doc), slug = matchSlug(m);
  const oldCarpool = S.matchCarpools[slug] || null;
  if(old && oldCarpool) await db.doc('matchCarpools/'+slug).set({...oldCarpool, ...carpoolDoc(m, slug, oldCarpool.cars||[])});
  return {ok:true, id, slug, old, oldCarpool, beyond: matchesNext29Days([m]).length===0};
}

// Removes a practice match together with its carpool. Returns what is needed to put it back, or null when it is not there.
export async function deletePractice(id){
  const old = S.practiceMatches && S.practiceMatches[id]; if(!old) return null;
  const slug = matchSlug(practiceToMatch(id, old));
  const cp = S.matchCarpools[slug] || null;
  await db.doc('practiceMatches/'+id).delete();
  if(cp) await db.doc('matchCarpools/'+slug).delete();
  return {id, old, slug, cp};
}
async function restorePractice(r){
  await db.doc('practiceMatches/'+r.id).set(r.old);
  if(r.cp) await db.doc('matchCarpools/'+r.slug).set(r.cp);
}

const pad2 = n => String(n).padStart(2,'0');
// The values the sheet starts with: empty for a new practice match, the stored ones for a change.
function practiceFormValues(editId){
  const d = editId && S.practiceMatches && S.practiceMatches[editId];
  const first = (S.matchFeeds||[])[0];
  if(!d) return {calendarId:first? first.calendarId : '', opponent:'', isHome:true, locKey:'AFC', locText:'', date:'', time:''};
  const s = new Date(d.startMs);
  const atFixed = d.isHome!==false && d.location===t('loc.fixedAFC')? 'AFC' : d.isHome!==false && d.location===t('loc.fixedATC')? 'ATC' : MATCH_FROM_OTHER;
  return {calendarId:d.calendarId||'', opponent:d.opponent||'', isHome:d.isHome!==false, locKey:atFixed, locText:atFixed===MATCH_FROM_OTHER? (d.location||'') : '',
    date:`${s.getFullYear()}-${pad2(s.getMonth()+1)}-${pad2(s.getDate())}`, time:`${pad2(s.getHours())}:${pad2(s.getMinutes())}`};
}

// The sheet (pure html). Thuis: a choice of the fixed locations (+ other); Uit: free text.
export function practiceSheetHtml(editId){
  const v = practiceFormValues(editId);
  const title = t(editId? 'matches.oefen_titel_wijzig' : 'matches.oefen_titel');
  const feeds = S.matchFeeds||[];
  if(!feeds.length) return `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"><div class="sheet__handle"></div><h3 id="sheetTitle">${esc(title)}</h3><p class="sheet__sub">${esc(t('matches.oefen_geen_teams'))}</p></div>`;
  const teamOptions = feeds.map(f=>`<option value="${esc(f.calendarId)}"${f.calendarId===v.calendarId?' selected':''}>${esc(f.label||f.calendarId)}</option>`).join('');
  const locOptions = [['AFC',t('loc.fixedAFC')],['ATC',t('loc.fixedATC')],[MATCH_FROM_OTHER,t('matches.oefen_locatie_andere')]].map(([k,l])=>`<option value="${k}"${v.locKey===k?' selected':''}>${esc(l)}</option>`).join('');
  const showTxt = !v.isHome || v.locKey===MATCH_FROM_OTHER;
  return `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="sheet__handle"></div>
    <h3 id="sheetTitle">${esc(title)}</h3><p class="sheet__sub">${esc(t('matches.oefen_sub'))}</p>
    <label for="practiceTeam">${esc(t('matches.oefen_team'))}</label>
    <select id="practiceTeam">${teamOptions}</select><p class="formErr" id="practiceErr_team" role="alert" hidden>${esc(t('matches.oefen_fout_team'))}</p>
    <label for="practiceOpp">${esc(t('matches.oefen_tegenstander'))}</label>
    <input type="text" id="practiceOpp" maxlength="60" placeholder="${esc(t('matches.oefen_tegenstander_ph'))}" value="${esc(v.opponent)}"><p class="formErr" id="practiceErr_opponent" role="alert" hidden>${esc(t('matches.oefen_fout_tegenstander'))}</p>
    <label>${esc(t('matches.oefen_thuis_uit'))}</label>
    <div class="segmented" role="group" aria-label="${esc(t('matches.oefen_thuis_uit'))}"><button type="button" data-practicehome="1" class="${v.isHome?'active':''}" aria-pressed="${v.isHome}">${esc(t('matches.oefen_thuis'))}</button><button type="button" data-practicehome="0" class="${v.isHome?'':'active'}" aria-pressed="${!v.isHome}">${esc(t('matches.oefen_uit'))}</button></div>
    <label for="practiceLocSel">${esc(t('matches.oefen_locatie'))}</label>
    <select id="practiceLocSel"${v.isHome?'':' hidden'}>${locOptions}</select>
    <input type="text" id="practiceLocTxt" class="matchFromTxt" maxlength="${FREE_TEXT_MAX}" placeholder="${esc(t('matches.oefen_locatie_ph'))}" aria-label="${esc(t('matches.oefen_locatie'))}" value="${esc(v.locText)}"${showTxt?'':' hidden'}>
    <p class="formErr" id="practiceErr_location" role="alert" hidden>${esc(t('matches.oefen_fout_locatie'))}</p>
    <p class="formHint" id="practiceHintHome"${v.isHome?'':' hidden'}>${esc(t('matches.oefen_hint_thuis'))}</p>
    <p class="formHint" id="practiceHintAway"${v.isHome?' hidden':''}>${esc(t('matches.oefen_hint_uit'))}</p>
    <div class="formRow">
      <div><label for="practiceDate">${esc(t('matches.oefen_datum'))}</label><input type="date" id="practiceDate" value="${esc(v.date)}"></div>
      <div><label for="practiceTime">${esc(t('matches.oefen_aftrap'))}</label><input type="time" id="practiceTime" value="${esc(v.time)}"></div>
    </div>
    <p class="formErr" id="practiceErr_date" role="alert" hidden>${esc(t('matches.oefen_fout_datum'))}</p>
    <button type="button" class="btn sheet__submit" id="practiceSave">${esc(t('matches.oefen_opslaan'))}</button>
  </div>`;
}

export function openPracticeSheet(editId){
  closeSheet();
  const ov = document.createElement('div'); ov.className = 'sheetOverlay'; ov.id = 'sheetOverlay';
  ov.innerHTML = practiceSheetHtml(editId);
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target===ov) closeSheet(); });
  wirePracticeSheet(editId);
}

function wirePracticeSheet(editId){
  const el = id => document.getElementById(id);
  const save = el('practiceSave');
  if(!save) return;   // no teams: the sheet only explains that
  let isHome = practiceFormValues(editId).isHome;
  const sync = () => {
    const sel = el('practiceLocSel'), txt = el('practiceLocTxt');
    sel.hidden = !isHome; txt.hidden = isHome && sel.value!==MATCH_FROM_OTHER;
    el('practiceHintHome').hidden = !isHome; el('practiceHintAway').hidden = isHome;
    document.querySelectorAll('[data-practicehome]').forEach(b=>{ const on = (b.dataset.practicehome==='1')===isHome; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
  };
  document.querySelectorAll('[data-practicehome]').forEach(b=>b.onclick=()=>{ isHome = b.dataset.practicehome==='1'; sync(); });
  el('practiceLocSel').onchange = sync;
  const showErrors = errors => {
    [['team','practiceTeam'],['opponent','practiceOpp'],['location',null],['date',null]].forEach(([k,inputId])=>{
      const msg = el('practiceErr_'+k); if(msg) msg.hidden = !errors[k];
      if(inputId){ const inp = el(inputId); if(inp && inp.classList) inp.classList.toggle('is-invalid', !!errors[k]); }
    });
    ['practiceLocTxt'].forEach(i=>{ const inp = el(i); if(inp && inp.classList) inp.classList.toggle('is-invalid', !!errors.location); });
    ['practiceDate','practiceTime'].forEach(i=>{ const inp = el(i); if(inp && inp.classList) inp.classList.toggle('is-invalid', !!errors.date); });
  };
  save.onclick = async () => {
    const sel = el('practiceLocSel');
    const location = isHome && sel.value!==MATCH_FROM_OTHER? (sel.value==='AFC'? t('loc.fixedAFC') : t('loc.fixedATC')) : el('practiceLocTxt').value;
    const input = {calendarId:el('practiceTeam').value, opponent:el('practiceOpp').value, isHome, location, date:el('practiceDate').value, time:el('practiceTime').value};
    save.disabled = true;
    try{
      const r = await savePractice(input, editId);
      if(!r.ok){ showErrors(r.errors); save.disabled = false; return; }
      closeSheet(); hapticTap();
      const undo = {label:t('deviation.ongedaan'), run: async ()=>{
        if(r.old){ await db.doc('practiceMatches/'+r.id).set(r.old); if(r.oldCarpool) await db.doc('matchCarpools/'+r.slug).set(r.oldCarpool); }
        else await db.doc('practiceMatches/'+r.id).delete();
      }};
      showToast(t(r.beyond? 'matches.oefen_later' : editId? 'matches.oefen_bijgewerkt' : 'matches.oefen_toegevoegd'), {action:undo});
    }catch(e){ save.disabled = false; showToast(t('data.opslaan_mislukt')+(e&&e.message||e)); }
  };
}

export function wireMatchCarpool(){
  if(S.openMatchCarpoolForm){
    const slug=S.openMatchCarpoolForm;
    const driverSel=document.getElementById('matchCarDriver_'+slug);
    if(driverSel) driverSel.onchange=()=>updateMatchCarCapacityWarning(slug);
    document.querySelectorAll('.matchCarGirlPick').forEach(c=>c.onchange=()=>updateMatchCarCapacityWarning(slug));
    if(S.editMatchCarIdx!=null) updateMatchCarCapacityWarning(slug);   // an edit starts with riders already chosen
    // "Andere locatie" shows its text field.
    const fromSel=document.getElementById('matchCarFrom_'+slug), fromTxt=document.getElementById('matchCarFromTxt_'+slug);
    if(fromSel && fromTxt) fromSel.onchange=()=>{ fromTxt.hidden = fromSel.value!==MATCH_FROM_OTHER; if(!fromTxt.hidden && fromTxt.focus) fromTxt.focus(); };
  }
  document.querySelectorAll('[data-addpractice]').forEach(b=>b.onclick=()=>{ hapticTap(); openPracticeSheet(null); });
  document.querySelectorAll('[data-editpractice]').forEach(b=>b.onclick=()=>{ hapticTap(); openPracticeSheet(b.dataset.editpractice); });
  document.querySelectorAll('[data-delpractice]').forEach(b=>b.onclick=async ()=>{
    try{
      const r = await deletePractice(b.dataset.delpractice); if(!r) return;
      showToast(t('matches.oefen_verwijderd'), {action:{label:t('deviation.ongedaan'), run:()=>restorePractice(r)}});
    }catch(e){ showToast(t('beheer.verwijderen_mislukt')+(e&&e.message||e)); }
  });
  document.querySelectorAll('[data-addmatchcar]').forEach(b=>b.onclick=()=>{ S.openMatchCarpoolForm=b.dataset.addmatchcar; S.editMatchCarIdx=null; hapticTap(); renderMatchesTab(); });
  // Pencil on a car: the same form, filled in with that car. Anyone may change any car.
  document.querySelectorAll('[data-editmatchcar]').forEach(b=>b.onclick=()=>{
    const [slug,idxStr]=b.dataset.editmatchcar.split('|');
    S.openMatchCarpoolForm=slug; S.editMatchCarIdx=+idxStr; hapticTap(); renderMatchesTab();
  });
  document.querySelectorAll('[data-cancelmatchcar]').forEach(b=>b.onclick=()=>{ S.openMatchCarpoolForm=null; S.editMatchCarIdx=null; renderMatchesTab(); });
  document.querySelectorAll('[data-savematchcar]').forEach(b=>b.onclick=async ()=>{
    const slug=b.dataset.savematchcar;
    const driverSel=document.getElementById('matchCarDriver_'+slug);
    const timeInp=document.getElementById('matchCarTime_'+slug);
    const fromSel=document.getElementById('matchCarFrom_'+slug), fromTxt=document.getElementById('matchCarFromTxt_'+slug);
    const girlIds=[...document.querySelectorAll('.matchCarGirlPick:checked')].map(c=>c.value);
    if(!driverSel || !driverSel.value){ showToast(t('deviation.kies_een_chauffeur')); return; }
    if(!girlIds.length){ showToast(t('deviation.kies_minstens_1_dochter')); return; }
    const from = matchFromFields(fromSel? fromSel.value : '', fromTxt? fromTxt.value : '', locationsCfg());
    if(!from){ showToast(t('matches.vertrek_vul_in')); return; }
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
    const newCar = {driverFamilyId:driverSel.value, girlIds, departureTime:timeInp.value, ...from};
    const editIdx = S.editMatchCarIdx;
    const oldCars = (cp.doc&&cp.doc.cars)||[];
    if(editIdx!=null && !oldCars[editIdx]){ showToast(t('deviation.kon_deze_wedstrijd_niet_vinden')); return; }   // someone removed the car meanwhile
    const cars = editIdx!=null? oldCars.map((c,i)=>i===editIdx? {...c, ...newCar} : c) : [...oldCars, newCar];
    try{
      await db.doc("matchCarpools/"+slug).set(carpoolDoc(m, slug, cars));
      // An old name-keyed document is moved over to the ID-keyed one.
      if(cp.doc && cp.id!==slug){ try{ await db.doc("matchCarpools/"+cp.id).delete(); }catch(e){} }
      S.openMatchCarpoolForm=null; S.editMatchCarIdx=null;
      showToast(t(editIdx!=null? 'matches.auto_bijgewerkt' : 'deviation.carpool_toegevoegd'));
    }catch(e){ showToast(t('data.opslaan_mislukt')+(e&&e.message||e)); }
  });
  // Quick "Ik rij ook": own car with the own daughter, unless she already sits in another car of this match. Leaves from Busstation.
  document.querySelectorAll('[data-iride]').forEach(b=>b.onclick=async ()=>{
    const slug=b.dataset.iride; const m=S.weekendMatchBySlug[slug]; const own=myLinkedFamilyId();
    if(!m || !own || !isMatchPlannable(m)){ showToast(t('deviation.kon_deze_wedstrijd_niet_vinden')); return; }
    const cp=carpoolFor(m); const cars=(cp.doc&&cp.doc.cars)||[];
    const taken=cars.some(c=>(c.girlIds||[]).includes(own));
    const newCar={driverFamilyId:own, girlIds:taken?[]:[own], departureTime:suggestedMatchDeparture(m.start), ...matchFromFields('busstation','',locationsCfg())};
    try{ await writeMatchCars(m,cp,slug,[...cars,newCar]); showToast(t('matches.ik_rij_toegevoegd')); }
    catch(e){ showToast(t('data.opslaan_mislukt')+(e&&e.message||e)); }
  });
  document.querySelectorAll('[data-delmatchcar]').forEach(b=>b.onclick=async ()=>{
    const [slug,idxStr]=b.dataset.delmatchcar.split('|'); const idx=+idxStr;
    const existing=S.matchCarpools[slug]; if(!existing) return;
    const cars = existing.cars.filter((_,i)=>i!==idx);
    try{
      if(cars.length) await db.doc("matchCarpools/"+slug).set({...existing, cars});
      else await db.doc("matchCarpools/"+slug).delete();
      showToast(t('matches.auto_weggehaald'), {action:{label:t('deviation.ongedaan'), run:()=>db.doc("matchCarpools/"+slug).set(existing)}});
    }catch(e){ showToast(t('beheer.verwijderen_mislukt')+(e&&e.message||e)); }
  });
}
