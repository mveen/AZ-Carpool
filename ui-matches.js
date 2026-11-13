// ui-matches.js — the Wedstrijden tab (violet "match" theme). Moved here from the bottom of Wijzigen.
// Lists every match of the next 29 days. A carpool can be set up only for the first 8 days
// (matches.js: isMatchPlannable); later matches are shown with a small "not plannable yet" note.
// Parents can also add a practice match (oefenwedstrijd) with the button on the info line; it then behaves like any match.
import { t, locale } from './i18n.js';
import { closeSheet, esc, hapticTap, locationsCfg, phIcon, showToast } from './ui-common.js';
import { analyzeMatch, buildPracticeDoc, busPlaceOfMatch, busStateOf, carpoolFor, currentMatchList, isMatchPlannable, isPracticeMatch, matchCarCapacityState, matchLabel, matchSlug, matchesNext29Days, plannableFrom, practiceIdOf, practiceToMatch, suggestedMatchDeparture } from './matches.js';
import { FREE_TEXT_MAX, MATCH_FROM_OTHER, matchFromChoice, matchFromFields, matchFromName, matchFromOptions } from './locations.js';
import { familyRiding, fam, girlName, playerSeats, seats, sortFamEntriesFlexLast, sortGirlIds } from './rides.js';
import { S } from './state.js';
import { db } from './data.js';
import { matchInfoHtml } from './ui-myweek.js';
import { canEditFor, myLinkedFamilyId } from './coordinator.js';
import { changeMatchCar, logEntries } from './match-cars.js';
import { BUS_DRIVE_MIN, BUS_MARGIN_MIN, busPatch, busPlaceOf, carArrival, carMissesBus, pickupOf, setMatchBus, suggestedBusCarDeparture, validTime } from './match-bus.js';

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
// The line under a car of a match by bus: when it is at AFC '34 and when it picks up again. `bad` = it would arrive after the bus left. null = nothing to say.
export function busCarSub(c, st){
  const arrive = carArrival(c.departureTime), pickup = pickupOf(c, st);
  if(!arrive && !pickup) return null;
  if(carMissesBus(c.departureTime, st.depart)) return {bad:true, text:t('matches.bus_auto_te_laat', { arrive, depart: st.depart })};
  return {bad:false, text:[arrive? t('matches.bus_auto_aankomst', { arrive }) : '', pickup? t('matches.bus_auto_terug', { pickup }) : ''].filter(Boolean).join(' · ')};
}

export function matchCarRowHtml(c, opts){
  opts = opts||{};
  const girlIds = c.girlIds||[];
  const driver = c.driverFamilyId? esc(fam(c.driverFamilyId).parentName) : t('deviation.nog_geen_chauffeur');
  const family = familyRiding(c.familyCount);
  const cap = c.driverFamilyId? playerSeats(fam(c.driverFamilyId), family) : null;
  const over = cap!=null && girlIds.length>cap;
  const mine = !!opts.highlightId && (c.driverFamilyId===opts.highlightId || girlIds.includes(opts.highlightId));
  const overHtml = over? ` <span class="fitbad" title="${t('deviation.meer_passagiers_dan_plekken')}">${phIcon('warning')} ${girlIds.length}/${cap}</span>` : '';
  const seatHtml = cap!=null && !over? ` <span class="tag">${girlIds.length}/${cap}</span>` : '';
  const familyHtml = family? ` <span class="tag tag--ok">${esc(t('matches.gezin_tag',{n:family}))}</span>` : '';
  const delHtml = opts.editable? `<button type="button" class="iconbtn danger" data-delmatchcar="${opts.slug}|${opts.idx}" aria-label="Verwijder carpool van ${driver}" title="${t('deviation.verwijder_carpool')}">${phIcon('trash')}</button>` : '';
  const editHtml = opts.editable? `<button type="button" class="iconbtn" data-editmatchcar="${opts.slug}|${opts.idx}" aria-label="${t('matches.auto_wijzigen',{driver})}" title="${t('matches.auto_wijzigen',{driver})}">${phIcon('pencil')}</button>` : '';
  const place = matchFromName(c, locationsCfg());
  const sub = opts.bus && opts.bus.on? busCarSub(c, opts.bus) : null;
  const subHtml = sub? `<span class="matchCarSub${sub.bad?' matchCarSub--bad':''}">${sub.bad? phIcon('warning')+' ' : ''}${esc(sub.text)}</span>` : '';
  const fromHtml = `<span class="matchCarFrom">${phIcon('map-pin')} ${esc(t('matches.vertrek_vanaf',{place}))}</span>${subHtml}`;
  return `<div class="matchCarRow${mine?' mine':''}">
    <span class="matchCarDep">${esc(c.departureTime||'--:--')}</span>
    <span class="matchCarWho">${phIcon('car')} <strong>${driver}</strong> · ${sortGirlIds(girlIds).map(id=>girlName(id)).join(', ')||t('deviation.geen_passagiers')}${overHtml}${seatHtml}${familyHtml}${fromHtml}</span>
    ${editHtml}${delHtml}
  </div>`;
}

// A match card. A practice match gets a pencil and a trash button next to its title (anyone may change or remove it).
function matchCardHtml(m, bodyHtml, info){
  const infoOpts = {geo:true, ...(info||{})};
  if(!isPracticeMatch(m)) return `<div class="card matchCard">${matchInfoHtml(m,infoOpts)}${bodyHtml}</div>`;
  const id = esc(practiceIdOf(m));
  const tools = `<div class="matchTools">
    <button type="button" class="iconbtn" data-editpractice="${id}" aria-label="${esc(t('matches.oefen_wijzig_aria'))}" title="${esc(t('matches.oefen_wijzig_aria'))}">${phIcon('pencil')}</button>
    <button type="button" class="iconbtn danger" data-delpractice="${id}" aria-label="${esc(t('matches.oefen_verwijder_aria'))}" title="${esc(t('matches.oefen_verwijder_aria'))}">${phIcon('trash')}</button>
  </div>`;
  return `<div class="card matchCard"><div class="matchCard__top">${matchInfoHtml(m,infoOpts)}${tools}</div>${bodyHtml}</div>`;
}

// ---------- Met de bus (match-bus.js) ----------
// The switch at the right of the head of an away match: tap = the bus is on or off for this match.
function busSwitchHtml(slug, st){
  return `<span class="swWrap"><button type="button" class="switch switch--sm${st.on?' on':''}" role="switch" aria-checked="${st.on}" aria-label="${esc(t('matches.bus_aria'))}" data-busswitch="${slug}"><span class="switch__track"><span class="switch__knob">${phIcon('bus')}</span></span></button><span class="swCap">${esc(t(st.on?'matches.bus_aan':'matches.bus_uit'))}</span></span>`;
}
// The name of the place where the bus leaves ('AFC' = AFC '34 unless the carpool says otherwise).
export function busPlaceName(place){
  return place.key==='OTHER'? place.text : t(place.key==='ATC'? 'loc.fixedATC' : 'loc.fixedAFC');
}
// The two bus times (one tap target each, both open the same sheet), or one dashed line while they are not known yet.
function busTimesHtml(slug, st){
  if(!st.depart && !st.back) return `<div class="busTimes"><button type="button" class="busTimes__cell busTimes__cell--empty" data-busedit="${slug}" aria-label="${esc(t('matches.bus_tijden_aria'))}"><div class="busTimes__time">${phIcon('clock')} ${esc(t('matches.bus_onbekend'))}</div><div class="busTimes__sub">${esc(t('matches.bus_onbekend_sub'))}</div></button></div>`;
  const cell = (cls, cap, time, sub) => `<button type="button" class="busTimes__cell scene scene--${cls}" data-busedit="${slug}" aria-label="${esc(t('matches.bus_tijden_aria'))}"><div class="busTimes__cap">${esc(cap)} ${phIcon('pencil')}</div><div class="busTimes__time">${time? esc(time) : '--:--'}</div><div class="busTimes__sub">${esc(sub)}</div></button>`;
  return `<div class="busTimes">${cell('heen', t('matches.bus_heen'), st.depart, t('matches.bus_vertrekt'))}${cell('terug', t('matches.bus_terug'), st.back? '± '+st.back : '', t('matches.bus_weer_terug'))}</div>`;
}
export function busSheetHtml(slug){
  const m = S.weekendMatchBySlug && S.weekendMatchBySlug[slug]; if(!m) return '';
  const st = busStateOf(m), place = busPlaceOfMatch(m);
  const placeOpt = (k, name) => `<option value="${k}"${place.key===k?' selected':''}>${esc(name)}</option>`;
  return `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="sheet__handle"></div>
    <h3 id="sheetTitle">${esc(t('matches.bus_sheet_titel'))}</h3><p class="sheet__sub">${esc(t('matches.bus_sheet_sub', { match: matchLabel(m)+' '+t('myweek.vs')+' '+analyzeMatch(m.summary).opponent }))}</p>
    <label for="busPlaceSel">${esc(t('matches.bus_plek_label'))}</label>
    <select id="busPlaceSel">${placeOpt('AFC', t('loc.fixedAFC'))}${placeOpt('ATC', t('loc.fixedATC'))}${placeOpt('OTHER', t('matches.vertrek_andere'))}</select>
    <input type="text" id="busPlaceTxt" class="matchFromTxt" maxlength="80" placeholder="${esc(t('matches.vertrek_andere_ph'))}" aria-label="${esc(t('matches.bus_plek_label'))}" value="${esc(place.text)}"${place.key==='OTHER'?'':' hidden'}>
    <div class="formRow">
      <div><label for="busDepartInp">${esc(t('matches.bus_vertrekt_label'))}</label><input type="time" id="busDepartInp" value="${esc(st.depart)}"></div>
      <div><label for="busBackInp">${esc(t('matches.bus_terug_label'))}</label><input type="time" id="busBackInp" value="${esc(st.back)}"></div>
    </div>
    <p class="formHint">${esc(t('matches.bus_sheet_hint'))}</p>
    <p class="formErr" id="busErr" role="alert" hidden>${esc(t('matches.bus_fout_tijd'))}</p>
    <button type="button" class="btn sheet__submit" id="busSave" data-slug="${slug}">${esc(t('matches.bus_opslaan'))}</button>
  </div>`;
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
    const bus = busStateOf(m, cp.doc||null);   // by bus? (only an away match can be)
    const carsHtml = cars.length? cars.map((c,idx)=>matchCarRowHtml(c,{editable:plannable, slug:cp.id, idx, bus})).join('') : '';
    if(!plannable){
      // Too far ahead: no carpool yet. A small note says from which day it can be set up. By bus: only a tag (the switch comes with the carpool).
      const from = plannableFrom(m).toLocaleDateString(locale(),{weekday:'long', day:'numeric', month:'long'});
      const busTag = bus.on? `<span class="tag">${phIcon('bus')}${esc(t('matches.bus_aan'))}</span>` : '';
      return matchCardHtml(m, `${carsHtml}<p class="matchNote">${phIcon('calendar')} ${t('matches.nog_niet_te_plannen', { date: from })}</p>`, {headTags:busTag});
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
      const editing = S.editMatchCarBefore || null;   // the car being edited (as it was when the pencil was tapped), or null when adding
      const suggestedDep = (editing && editing.departureTime) || (bus.on && suggestedBusCarDeparture(bus.depart)) || suggestedMatchDeparture(m.start);
      const girlOptions = sortFamEntriesFlexLast(allFamilies).map(([id,f])=>`<label class="chip"><input type="checkbox" class="matchCarGirlPick" value="${id}"${editing && (editing.girlIds||[]).includes(id)?' checked':''}>${esc(f.girlName||f.parentName||id)}</label>`).join('');
      const driverOptions = allFamilies.map(([id,f])=>`<option value="${id}"${editing && editing.driverFamilyId===id?' selected':''}>${esc(f.parentName)} (${seats(f)} ${seats(f)===1?t('common.plek'):t('common.plekken')})</option>`).join('');
      formHtml = `<div class="dayFormCard">
        <label>${t('deviation.chauffeur')}</label>
        <select id="matchCarDriver_${slug}"><option value="">${t('deviation.kies')}</option>${driverOptions}</select>
        <div class="panel panel--row stepperCard">
          <div class="stepperInfo">${phIcon('users')}<div>
            <div class="stepperTitle">${t('matches.gezin_titel')}</div>
            <div class="stepperSub">${t('matches.gezin_sub')}</div>
          </div></div>
          <div class="stepperControls">
            <button type="button" class="stepperBtn" data-famdown="${slug}" aria-label="${esc(t('matches.gezin_minder'))}">−</button>
            <span class="stepperValue" id="matchCarFamilyValue_${slug}">${familyRiding(editing && editing.familyCount)}</span>
            <button type="button" class="stepperBtn" data-famup="${slug}" aria-label="${esc(t('matches.gezin_meer'))}">+</button>
          </div>
        </div>
        <input type="hidden" id="matchCarFamily_${slug}" value="${familyRiding(editing && editing.familyCount)}">
        <p class="noteLine" id="matchCarFree_${slug}" role="status" aria-live="polite"></p>
        <label>${t('deviation.welke_passagiers')} <span id="matchCarCount_${slug}"></span></label>
        <div>${girlOptions}</div>
        <div id="matchCarCapWarn_${slug}" class="matchCapWarn" role="status" aria-live="polite"></div>
        ${matchFromFieldsHtml(slug, editing)}
        ${bus.on? `<div class="formRow">
          <div><label for="matchCarTime_${slug}">${t('deviation.vertrektijd')}</label><input type="time" id="matchCarTime_${slug}" value="${suggestedDep}"></div>
          <div><label for="matchCarPickup_${slug}">${esc(t('matches.bus_form_ophalen', { place: busPlaceName(busPlaceOf(cp.doc||null)) }))}</label><input type="time" id="matchCarPickup_${slug}" value="${esc((editing && editing.pickupTime) || bus.back)}"></div>
        </div>${bus.depart? `<p class="noteLine">${esc(t('matches.bus_form_hint', { depart: bus.depart, drive: BUS_DRIVE_MIN, margin: BUS_MARGIN_MIN }))}</p>` : ''}`
        : `<label>${t('deviation.vertrektijd')}</label>
        <input type="time" id="matchCarTime_${slug}" value="${suggestedDep}">`}
        <div class="formActions">
          <button type="button" class="btn small" data-savematchcar="${slug}">${t('deviation.opslaan')}</button>
          <button type="button" class="btn small secondary" data-cancelmatchcar="${slug}">${t('common.annuleren')}</button>
        </div>
      </div>`;
    }
    const info = bus.applies? { headExtra: busSwitchHtml(slug, bus) } : {};
    return matchCardHtml(m, `${bus.on? busTimesHtml(slug, bus) : ''}${carsHtml || t('deviation.p_class_muted_style_font')}${actionsHtml}${formHtml}${matchLogHtml(cp.doc)}`, info);
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
  const free=document.getElementById('matchCarFree_'+slug);
  if(free) free.textContent = st.cap!=null? t('matches.gezin_vrij',{n:st.cap, plekken:st.cap===1?t('common.plek'):t('common.plekken')}) : '';
  const famVal=document.getElementById('matchCarFamilyValue_'+slug);
  if(famVal) famVal.textContent = String(st.family);
  const warn=document.getElementById('matchCarCapWarn_'+slug);
  if(warn) warn.innerHTML = st.over
    ? t('deviation.heeft_maar_je_hebt_passagiers', { p1: phIcon('warning'), p2: esc(fam(st.driverId).parentName), p3: st.cap, p4: st.cap===1?'passagiersplek':'passagiersplekken', p5: st.n })
    : '';
  // Any change to the selection cancels a pending "toch opslaan" confirmation.
  const saveBtn=document.querySelector(`[data-savematchcar="${slug}"]`);
  if(saveBtn && saveBtn.dataset.confirmOver==='1'){ saveBtn.dataset.confirmOver=''; saveBtn.textContent=t('deviation.opslaan'); }
}

// What is stored for one match carpool: the match itself (denormalized, so Mijn week and the agenda need no calendar) plus the cars.
function carpoolInfo(m, slug){
  return {matchSlug:slug, calendarId:m.calendarId||'', eventId:m.eventId||'', teamLabel:matchLabel(m), summary:m.summary, location:m.location||'', startMs:m.start.getTime()};
}
function carpoolDoc(m, slug, cars){ return {...carpoolInfo(m, slug), cars}; }

// The log of a match carpool, for the coordinator only: who added, changed or removed which car (newest first, see match-cars.js).
function logLineText(e){
  const who = e.by && S.families[e.by]? S.families[e.by].parentName : t('matches.log_iemand');
  const car = c => t('matches.log_auto', { driver: c.driverFamilyId && S.families[c.driverFamilyId]? S.families[c.driverFamilyId].parentName : '?', time: c.departureTime||'--:--', girls: sortGirlIds(c.girlIds||[]).map(id=>girlName(id)).join(', ') });
  const when = new Date(e.at).toLocaleString(locale(), {weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
  const key = {add:'matches.log_add', edit:'matches.log_edit', del:'matches.log_del', undo:'matches.log_undo'}[e.act] || 'matches.log_add';
  return `${when} · ` + t(key, { who, car: car(e.car), to: e.to? car(e.to) : '' });
}
function matchLogHtml(doc){
  if(!canEditFor(S)) return '';   // coordinator view only: "Bekijk als ouder" hides it too
  const list = logEntries(doc);
  if(!list.length) return '';
  return `<div class="matchLog"><p class="matchNote"><strong>${esc(t('matches.log_titel'))}</strong></p>${list.map(e=>`<p class="matchNote">${esc(logLineText(e))}</p>`).join('')}</div>`;
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
  if(old && oldCarpool){
    // On the fresh document, so a car that somebody added a moment ago is not lost (only the match info, not the cars, follows the change).
    await db.transact(async tx=>{
      const snap = await tx.get('matchCarpools/'+slug);
      if(snap.exists) tx.set('matchCarpools/'+slug, {...snap.data(), ...carpoolInfo(m, slug)});
    });
  }
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

// The sheet with the two bus times of a match (same look as the practice-match sheet). Saves at once, with Ongedaan.
export function openBusSheet(slug){
  const html = busSheetHtml(slug); if(!html) return;
  closeSheet();
  const ov = document.createElement('div'); ov.className = 'sheetOverlay'; ov.id = 'sheetOverlay';
  ov.innerHTML = html;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target===ov) closeSheet(); });
  wireBusSheet(slug);
}
function wireBusSheet(slug){
  const el = id => document.getElementById(id), save = el('busSave');
  if(!save) return;
  const sel = el('busPlaceSel'), txt = el('busPlaceTxt');
  if(sel && txt) sel.onchange = () => { txt.hidden = sel.value!=='OTHER'; if(!txt.hidden && txt.focus) txt.focus(); };
  save.onclick = async () => {
    const m = S.weekendMatchBySlug[slug]; if(!m || !isMatchPlannable(m)){ showToast(t('deviation.kon_deze_wedstrijd_niet_vinden')); return; }
    const r = busPatch({ on:true, depart:el('busDepartInp').value, back:el('busBackInp').value, place:el('busPlaceSel').value, placeText:el('busPlaceTxt').value });
    if(!r.ok){ el('busErr').hidden = false; return; }
    const cp = carpoolFor(m), doc = cp.doc||{};
    const old = { bus: typeof doc.bus==='boolean'? doc.bus : true, busDepart: doc.busDepart||'', busBack: doc.busBack||'', busAt: doc.busAt||'', busAtText: doc.busAtText||'' };
    save.disabled = true;
    try{
      await setMatchBus({ info:carpoolInfo(m, slug), slug, fromId:cp.id, patch:r.patch });
      closeSheet(); hapticTap();
      showToast(t('matches.bus_opgeslagen'), {action:{label:t('deviation.ongedaan'), run:()=>setMatchBus({ info:carpoolInfo(m, slug), slug, fromId:slug, patch:old })}});
    }catch(e){ save.disabled = false; showToast(t('data.opslaan_mislukt')+(e&&e.message||e)); }
  };
}

// True while a car is being written. The database echoes our own write back (and re-draws the tab) before the write has
// finished, so without this a second tap on Opslaan / Ik rij ook would still see the old state and add the car again.
let savingMatchCar = false;

// The "gezinsleden" stepper: +1 / -1 / 0 (0 only re-checks the limit, e.g. after another driver was picked). At least one seat stays
// for a player; with no driver chosen yet the limit is the biggest car.
function stepMatchFamily(slug, delta){
  const hidden = document.getElementById('matchCarFamily_'+slug);
  if(!hidden) return;
  const driverSel = document.getElementById('matchCarDriver_'+slug);
  const max = driverSel && driverSel.value? Math.max(0, seats(fam(driverSel.value)) - 1) : 7;
  hidden.value = String(Math.min(max, Math.max(0, familyRiding(hidden.value) + delta)));
}

export function wireMatchCarpool(){
  if(S.openMatchCarpoolForm){
    const slug=S.openMatchCarpoolForm;
    const driverSel=document.getElementById('matchCarDriver_'+slug);
    if(driverSel) driverSel.onchange=()=>{ stepMatchFamily(slug, 0); updateMatchCarCapacityWarning(slug); };
    const famDown=document.querySelector(`[data-famdown="${slug}"]`), famUp=document.querySelector(`[data-famup="${slug}"]`);
    if(famDown) famDown.onclick=()=>{ hapticTap(); stepMatchFamily(slug, -1); updateMatchCarCapacityWarning(slug); };
    if(famUp) famUp.onclick=()=>{ hapticTap(); stepMatchFamily(slug, 1); updateMatchCarCapacityWarning(slug); };
    updateMatchCarCapacityWarning(slug);   // shows the free seats from the start
    document.querySelectorAll('.matchCarGirlPick').forEach(c=>c.onchange=()=>updateMatchCarCapacityWarning(slug));
    if(S.editMatchCarIdx!=null) updateMatchCarCapacityWarning(slug);   // an edit starts with riders already chosen
    // "Andere locatie" shows its text field.
    const fromSel=document.getElementById('matchCarFrom_'+slug), fromTxt=document.getElementById('matchCarFromTxt_'+slug);
    if(fromSel && fromTxt) fromSel.onchange=()=>{ fromTxt.hidden = fromSel.value!==MATCH_FROM_OTHER; if(!fromTxt.hidden && fromTxt.focus) fromTxt.focus(); };
  }
  // Bus switch: the bus is on or off for this match (stored on its carpool document; tap again or Ongedaan puts it back).
  document.querySelectorAll('[data-busswitch]').forEach(b=>b.onclick=async ()=>{
    const slug=b.dataset.busswitch, m=S.weekendMatchBySlug[slug];
    if(!m || !isMatchPlannable(m)){ showToast(t('deviation.kon_deze_wedstrijd_niet_vinden')); return; }
    const cp=carpoolFor(m), was=busStateOf(m, cp.doc||null);
    const doc=cp.doc||{}, keep={busDepart:doc.busDepart||'', busBack:doc.busBack||''};
    hapticTap();
    try{
      await setMatchBus({ info:carpoolInfo(m, slug), slug, fromId:cp.id, patch:{bus:!was.on, ...keep} });
      showToast(t(was.on? 'matches.bus_uit_toast' : 'matches.bus_aan_toast'), {action:{label:t('deviation.ongedaan'), run:()=>setMatchBus({ info:carpoolInfo(m, slug), slug, fromId:slug, patch:{bus:was.on, ...keep} })}});
    }catch(e){ showToast(t('data.opslaan_mislukt')+(e&&e.message||e)); }
  });
  document.querySelectorAll('[data-busedit]').forEach(b=>b.onclick=()=>{ hapticTap(); openBusSheet(b.dataset.busedit); });
  document.querySelectorAll('[data-addpractice]').forEach(b=>b.onclick=()=>{ hapticTap(); openPracticeSheet(null); });
  document.querySelectorAll('[data-editpractice]').forEach(b=>b.onclick=()=>{ hapticTap(); openPracticeSheet(b.dataset.editpractice); });
  document.querySelectorAll('[data-delpractice]').forEach(b=>b.onclick=async ()=>{
    try{
      const r = await deletePractice(b.dataset.delpractice); if(!r) return;
      showToast(t('matches.oefen_verwijderd'), {action:{label:t('deviation.ongedaan'), run:()=>restorePractice(r)}});
    }catch(e){ showToast(t('beheer.verwijderen_mislukt')+(e&&e.message||e)); }
  });
  document.querySelectorAll('[data-addmatchcar]').forEach(b=>b.onclick=()=>{ S.openMatchCarpoolForm=b.dataset.addmatchcar; S.editMatchCarIdx=null; S.editMatchCarBefore=null; hapticTap(); renderMatchesTab(); });
  // Pencil on a car: the same form, filled in with that car. Anyone may change any car.
  document.querySelectorAll('[data-editmatchcar]').forEach(b=>b.onclick=()=>{
    const [slug,idxStr]=b.dataset.editmatchcar.split('|');
    // The car as it is now: the save is matched on this, so a car that moved or changed meanwhile is never mixed up with another one.
    const car = ((S.matchCarpools[slug]||{}).cars||[])[+idxStr];
    if(!car){ showToast(t('deviation.kon_deze_wedstrijd_niet_vinden')); return; }
    S.openMatchCarpoolForm=slug; S.editMatchCarIdx=+idxStr; S.editMatchCarBefore=JSON.parse(JSON.stringify(car)); hapticTap(); renderMatchesTab();
  });
  document.querySelectorAll('[data-cancelmatchcar]').forEach(b=>b.onclick=()=>{ S.openMatchCarpoolForm=null; S.editMatchCarIdx=null; S.editMatchCarBefore=null; renderMatchesTab(); });
  document.querySelectorAll('[data-savematchcar]').forEach(b=>b.onclick=async ()=>{
    if(savingMatchCar) return;
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
    const before = S.editMatchCarBefore;   // the car being edited as it was shown, or null when adding
    if(S.editMatchCarIdx!=null && !before){ showToast(t('deviation.kon_deze_wedstrijd_niet_vinden')); return; }
    // familyCount is an optional extra field: only stored when family rides along, or to reset it on a car that had it (so cars without family stay exactly as before).
    const familyField = capState.family>0 || (before && before.familyCount!=null)? {familyCount:capState.family} : {};
    // By bus: the time this car picks up at AFC '34 after the match (optional field `pickupTime`; an empty field follows the time of the bus).
    const busNow = busStateOf(m, cp.doc||null);
    const pickupInp = busNow.on? document.getElementById('matchCarPickup_'+slug) : null;
    if(pickupInp && pickupInp.value && !validTime(pickupInp.value)){ showToast(t('matches.bus_fout_tijd')); return; }
    const pickupField = pickupInp? {pickupTime: pickupInp.value && pickupInp.value!==busNow.back? pickupInp.value : ''} : {};
    const newCar = {driverFamilyId:driverSel.value, girlIds, ...familyField, departureTime:timeInp.value, ...pickupField, ...from};
    savingMatchCar = true; b.disabled = true;
    try{
      // One change on the fresh document (match-cars.js): somebody else's car added a moment ago stays, and a car that was changed or removed meanwhile is refused.
      const r = await changeMatchCar({ info:carpoolInfo(m, slug), slug, fromId:cp.id, change: before? {act:'edit', before, car:newCar} : {act:'add', car:newCar}, by:myLinkedFamilyId()||'' });
      S.openMatchCarpoolForm=null; S.editMatchCarIdx=null; S.editMatchCarBefore=null;
      savingMatchCar = false;
      renderMatchesTab();   // the echo of our own write was drawn while the form was still open: close it now
      showToast(!r.ok? t('matches.auto_intussen_gewijzigd') : t(before? 'matches.auto_bijgewerkt' : 'deviation.carpool_toegevoegd'));
    }catch(e){ savingMatchCar = false; b.disabled = false; showToast(t('data.opslaan_mislukt')+(e&&e.message||e)); }
  });
  // Quick "Ik rij ook": own car with the own daughter, unless she already sits in another car of this match. Leaves from Busstation.
  document.querySelectorAll('[data-iride]').forEach(b=>b.onclick=async ()=>{
    if(savingMatchCar) return;
    const slug=b.dataset.iride; const m=S.weekendMatchBySlug[slug]; const own=myLinkedFamilyId();
    if(!m || !own || !isMatchPlannable(m)){ showToast(t('deviation.kon_deze_wedstrijd_niet_vinden')); return; }
    const cp=carpoolFor(m); const cars=(cp.doc&&cp.doc.cars)||[];
    const taken=cars.some(c=>(c.girlIds||[]).includes(own));
    const bus=busStateOf(m, cp.doc||null);   // by bus: leave in time for the bus (the pick-up time follows the time of the bus)
    const newCar={driverFamilyId:own, girlIds:taken?[]:[own], departureTime:(bus.on && suggestedBusCarDeparture(bus.depart)) || suggestedMatchDeparture(m.start), ...matchFromFields('busstation','',locationsCfg())};
    if(cars.some(c=>c.driverFamilyId===own && (c.girlIds||[]).length===newCar.girlIds.length && newCar.girlIds.every(g=>(c.girlIds||[]).includes(g)) && c.departureTime===newCar.departureTime)) return;   // already in
    savingMatchCar = true;
    try{ await changeMatchCar({ info:carpoolInfo(m, slug), slug, fromId:cp.id, change:{act:'add', car:newCar}, by:own }); showToast(t('matches.ik_rij_toegevoegd')); }
    catch(e){ showToast(t('data.opslaan_mislukt')+(e&&e.message||e)); }
    finally{ savingMatchCar = false; }
  });
  document.querySelectorAll('[data-delmatchcar]').forEach(b=>b.onclick=async ()=>{
    const [slug,idxStr]=b.dataset.delmatchcar.split('|'); const idx=+idxStr;
    const existing=S.matchCarpools[slug]; const car=existing && (existing.cars||[])[idx]; if(!car) return;
    const before = JSON.parse(JSON.stringify(car)), by = myLinkedFamilyId()||'';
    const { cars:_c, log:_l, ...info } = existing;   // the match fields, to put the document back if it is gone when "Ongedaan" is tapped
    try{
      // Removes exactly this car from the fresh document (and logs it). The document stays, with cars [] when it was the last one, so the log is kept.
      await changeMatchCar({ slug, fromId:slug, change:{act:'del', before}, by });
      showToast(t('matches.auto_weggehaald'), {action:{label:t('deviation.ongedaan'), run:()=>changeMatchCar({ info, slug, fromId:slug, change:{act:'add', car:before, undo:true}, by }).catch(e=>showToast(t('data.opslaan_mislukt')+(e&&e.message||e)))}});
    }catch(e){ showToast(t('beheer.verwijderen_mislukt')+(e&&e.message||e)); }
  });
}
