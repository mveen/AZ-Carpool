// ui-ritbeurs.js — the Ritbeurs screen (a segment inside the Wijzigen tab): open rides to take over, own rides to offer, "Ik kan inspringen"
// moments and the notifications inbox. The rules are in ritbeurs.js, everything that writes is in ritbeurs-data.js.
// Everything here is hidden when the feature switch (settings/ritbeurs) is off; the Beheer card with that switch is at the bottom.
import { t } from './i18n.js';
import { S } from './state.js';
import { DAYS } from './constants.js';
import { weekKeyDayIso } from './dates.js';
import { myLinkedFamilyId } from './coordinator.js';
import { effectiveCars, fam } from './rides.js';
import { esc, hapticTap, locationsCfg, phIcon, twoStepConfirm } from './ui-common.js';
import { routeLabel } from './locations.js';
import { renderDeviationTab } from './ui-deviation.js';
import { renderBeheer } from './ui-beheer.js';
import {
  RITBEURS_MESSAGE_MAX, activeMoments, momentCovers, openOffers, rideStartMs, sortedNotifications, unreadCount, urgency,
} from './ritbeurs.js';
import {
  addMoment, allRides, createOffer, markNotificationsRead, quietOf, removeMoment, ridesOf, ritbeursOn, saveQuiet, setRitbeurs, takeOffer, warningsFor, withdrawOffer,
} from './ritbeurs-data.js';

const NOTIF_TEXT = {
  offerBackup: p => ({ title: t('ritbeurs.notif.offerBackup', p), body: t('ritbeurs.notif.offerBackupBody', p) }),
  backupForRide: p => ({ title: t('ritbeurs.notif.backupForRide', p), body: t('ritbeurs.notif.backupForRideBody', p) }),
  taken: p => ({ title: t('ritbeurs.notif.taken', p), body: t('ritbeurs.notif.takenBody', p) }),
  takenDayCoordinator: p => ({ title: t('ritbeurs.notif.takenDayCoordinator', p), body: t('ritbeurs.notif.takenDayCoordinatorBody', p) }),
  uncovered: p => ({ title: t('ritbeurs.notif.uncovered', p), body: t('ritbeurs.notif.uncoveredBody', p) }),
};
const dayLabel = k => (DAYS.find(([d]) => d === k) || [k, String(k || '')])[1];
const famName = id => esc((S.families[id] && (S.families[id].parentName || S.families[id].girlName)) || t('ritbeurs.notif.onbekend'));
const dirShort = d => t(d === 'heen' ? 'dir.heenShort' : 'dir.terugShort');
const whenText = (day, time) => `${dayLabel(day).toLowerCase()} ${time || ''}`.trim();

// Is the Ritbeurs usable for this user? The switch is on and the user has a linked family.
export function ritbeursAvailable(){ return !!(S.me && ritbeursOn() && myLinkedFamilyId()); }

// Notifications that may be shown now (those held back by quiet hours appear when the quiet hours end).
export function visibleNotifications(nowMs = Date.now()){
  const own = {};
  Object.entries(S.notifications || {}).forEach(([id, n]) => { if(n && !(n.deliverAt > nowMs) && !(n.expiresAt < nowMs)) own[id] = n; });
  return own;
}
// The number on the Wijzigen tab: open rides of other families + unread notifications. 0 when the switch is off.
export function ritbeursBadgeCount(nowMs = Date.now()){
  if(!ritbeursAvailable()) return 0;
  const me = myLinkedFamilyId();
  return openOffers(S.offers, S.currentWeekKey, nowMs).filter(o => o.offeredBy !== me).length + unreadCount(visibleNotifications(nowMs));
}

// ---------- the segment "Wijzigen | Ritbeurs (n)" ----------
export function ritbeursSegmentHtml(){
  const n = ritbeursBadgeCount();
  const on = S.rbView === 'ritbeurs';
  return `<div class="segmented" role="group" aria-label="${esc(t('ritbeurs.seg.aria'))}">
    <button type="button" class="${on ? '' : 'active'}" data-rbview="wijzigen" aria-pressed="${!on}">${t('ritbeurs.seg.wijzigen')}</button>
    <button type="button" class="${on ? 'active' : ''}" data-rbview="ritbeurs" aria-pressed="${on}">${t('ritbeurs.seg.ritbeurs')}${n ? ` (${n})` : ''}</button>
  </div>`;
}
export function setRbView(view){ S.rbView = view === 'ritbeurs' ? 'ritbeurs' : 'wijzigen'; S.rbConfirm = null; S.rbOffering = null; renderDeviationTab(); }

// ---------- the view ----------
function offerCardHtml(o, nowMs){
  const me = myLinkedFamilyId();
  const mine = o.offeredBy === me;
  const car = effectiveCars(o.day, o.direction).find(c => c.driverFamilyId === o.offeredBy && (!o.time || c.departureTime === o.time)) || effectiveCars(o.day, o.direction).find(c => c.driverFamilyId === o.offeredBy);
  const route = car ? routeLabel(car, o.direction, locationsCfg(), o.day) : '';
  const girls = car ? (car.girlIds || []).map(id => `<span class="pill rbPill">${esc((fam(id).girlName) || id)}</span>`).join('') : '';
  const u = urgency(o.date, nowMs);
  const chip = `<span class="rbChip rbChip-${u}">${t(u === 'late' ? 'ritbeurs.urg.late' : u === 'soon' ? 'ritbeurs.urg.soon' : 'ritbeurs.urg.ok')}</span>`;
  const w = mine ? null : warningsFor(o, me);
  const hasWarn = !!(w && (!w.seats.ok || w.conflict));
  let confirm = '';
  if(S.rbConfirm === o.id && !mine){
    const warns = [];
    if(w && !w.seats.ok) warns.push(t('ritbeurs.warn.zitplaatsen', { need: w.seats.need, have: w.seats.have }));
    if(w && w.conflict) warns.push(t('ritbeurs.warn.conflict', { day: dayLabel(w.conflict.day).toLowerCase(), dir: dirShort(w.conflict.direction).toLowerCase(), time: w.conflict.time }));
    confirm = `<div class="rbConfirm" role="group" aria-label="${esc(t('ritbeurs.confirm.title'))}">
      <h4>${t('ritbeurs.confirm.title')}</h4>
      <ul class="rbChecks">${[t('ritbeurs.confirm.regel1'), t('ritbeurs.confirm.regel2'), t('ritbeurs.confirm.regel3')].map(x => `<li>${phIcon('check')} ${esc(x)}</li>`).join('')}</ul>
      ${warns.map(x => `<p class="rbWarn">${phIcon('warning')} ${esc(x)}</p>`).join('')}
      <div class="rowflex" style="gap:8px;margin-top:8px"><button type="button" class="btn" data-rbtake="${esc(o.id)}">${t('ritbeurs.confirm.ja')}</button>
      <button type="button" class="btn secondary" data-rbconfirmno="1">${t('ritbeurs.confirm.nee')}</button></div></div>`;
  }
  return `<div class="card rbOffer${hasWarn ? ' rbHasWarn' : ''}" data-rboffer="${esc(o.id)}">
    <div class="rowflex" style="justify-content:space-between;gap:8px"><span class="rbTime">${esc(dayLabel(o.day))} ${esc(o.time)}</span>${chip}</div>
    <div class="rbRoute">${esc(dirShort(o.direction))}${route ? ' · ' + esc(route) : ''}</div>
    ${girls ? `<div class="rbPills">${girls}</div>` : ''}
    <p class="muted rbBy">${mine ? t('ritbeurs.open.eigen') : t('ritbeurs.open.door', { name: famName(o.offeredBy) })}${o.message ? ' · “' + esc(o.message) + '”' : ''}</p>
    ${mine ? `<button type="button" class="btn small secondary" data-rbwithdraw="${esc(o.id)}">${phIcon('trash')} ${t('ritbeurs.trekIn')}</button>`
      : (S.rbConfirm === o.id ? '' : `<button type="button" class="btn" data-rbask="${esc(o.id)}">${t(hasWarn ? 'ritbeurs.toch' : 'ritbeurs.neemOver')}</button>`)}
    ${confirm}
  </div>`;
}

function ownRidesHtml(nowMs){
  const me = myLinkedFamilyId();
  const rides = ridesOf(me).filter(r => rideStartMs(r.date, r.time) > nowMs);
  if(!rides.length) return `<p class="muted">${t('ritbeurs.eigen.leeg')}</p>`;
  return rides.map(r => {
    const key = `${r.day}|${r.direction}`;
    const offer = openOffers(S.offers, S.currentWeekKey, nowMs).find(o => o.offeredBy === me && o.day === r.day && o.direction === r.direction);
    const form = S.rbOffering === key ? `<div class="rbForm">
        <label for="rbMessage">${t('ritbeurs.form.bericht')}</label>
        <input type="text" id="rbMessage" maxlength="${RITBEURS_MESSAGE_MAX}" autocomplete="off" placeholder="${esc(t('ritbeurs.form.placeholder'))}">
        <p class="muted">${t('ritbeurs.form.stappen')}</p>
        <div class="rowflex" style="gap:8px"><button type="button" class="btn" data-rboffergo="${esc(key)}">${t('ritbeurs.form.bevestig')}</button>
        <button type="button" class="btn secondary" data-rbofferno="1">${t('ritbeurs.confirm.nee')}</button></div></div>` : '';
    return `<div class="rbMine"><div class="rowflex" style="justify-content:space-between;gap:8px;align-items:center">
        <span><b class="rbTime">${esc(dayLabel(r.day))} ${esc(r.time)}</b> · ${esc(dirShort(r.direction))}</span>
        ${offer ? `<span class="noticeChip ok">${t('ritbeurs.eigen.aangeboden')}</span>`
          : `<button type="button" class="btn small secondary" data-rboffer-open="${esc(key)}">${t('ritbeurs.eigen.aanbieden')}</button>`}</div>${form}</div>`;
  }).join('');
}

// The draft of the "Nieuw tijdvak" form (defaults: the first day of this week that has not ended, 15:00-18:30).
export function momentDraft(){
  if(S.rbMomentDraft) return S.rbMomentDraft;
  const nowMs = Date.now();
  const first = DAYS.map(([k]) => weekKeyDayIso(S.currentWeekKey, k)).find(d => d && rideStartMs(d, '23:59') > nowMs) || weekKeyDayIso(S.currentWeekKey, 'Ma');
  return { date: first, from: '15:00', to: '18:30', onlyIfFree: true };
}
const timeOptions = sel => { const o = []; for(let m = 5 * 60; m <= 23 * 60; m += 15){ const v = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; o.push(`<option value="${v}"${v === sel ? ' selected' : ''}>${v}</option>`); } return o.join(''); };

function momentsHtml(nowMs){
  const me = myLinkedFamilyId();
  const mine = activeMoments(S.moments, nowMs).filter(m => m.familyId === me);
  const list = mine.length ? mine.map(m => {
    const d = DAYS.find(([k]) => weekKeyDayIso(S.currentWeekKey, k) === m.date);
    const dl = d ? d[1] : m.date;
    return `<div class="rbMoment rowflex" style="justify-content:space-between;gap:8px;align-items:center">
      <span><b>${esc(dl)}</b> ${esc(m.from)}–${esc(m.to)}${m.onlyIfFree ? ' · ' + t('ritbeurs.moment.vrij') : ''}</span>
      <button type="button" class="btn small secondary iconBtn" data-rbmomentdel="${esc(m.id)}" aria-label="${esc(t('ritbeurs.moment.verwijder'))}">${phIcon('trash')}</button></div>`;
  }).join('') : `<p class="muted">${t('ritbeurs.moment.leeg')}</p>`;
  const d = momentDraft();
  const days = DAYS.map(([k, label]) => {
    const iso = weekKeyDayIso(S.currentWeekKey, k);
    const past = rideStartMs(iso, '23:59') <= nowMs;
    return `<button type="button" class="rbOpt${d.date === iso ? ' active' : ''}" data-rbmday="${iso}" aria-pressed="${d.date === iso}"${past ? ' disabled' : ''}>${esc(label.slice(0, 2))}</button>`;
  }).join('');
  const preview = momentPreview(d);
  return `${list}
    <div class="rbForm"><h4>${t('ritbeurs.moment.nieuw')}</h4>
      <div class="rbOpts" role="group" aria-label="${esc(t('ritbeurs.moment.dag'))}">${days}</div>
      <div class="rowflex" style="gap:10px;align-items:center;margin-top:8px">
        <label for="rbmFrom">${t('ritbeurs.moment.van')}</label><select id="rbmFrom" class="rbSel">${timeOptions(d.from)}</select>
        <label for="rbmTo">${t('ritbeurs.moment.tot')}</label><select id="rbmTo" class="rbSel">${timeOptions(d.to)}</select></div>
      <label class="switchRow" for="rbmFree"><span>${t('ritbeurs.moment.alleenVrij')}</span><input type="checkbox" role="switch" class="switch" id="rbmFree"${d.onlyIfFree ? ' checked' : ''}></label>
      <p class="muted" id="rbmPreview">${esc(preview)}</p>
      <button type="button" class="btn" id="rbmSave">${t('ritbeurs.moment.opslaan')}</button></div>`;
}
// How many rides (of other families) the draft moment touches.
export function momentPreview(d){
  const me = myLinkedFamilyId();
  const n = allRides().filter(r => r.familyId !== me && momentCovers({ date: d.date, from: d.from, to: d.to }, r.date, r.time)).length;
  return n ? t('ritbeurs.moment.raakt', { n }) : t('ritbeurs.moment.raaktGeen');
}

function notificationText(n){
  const when = whenText(n.day, n.time);
  const who = famName(n.fromFamilyId);
  const dl = (DAYS.find(([k]) => weekKeyDayIso(n.weekKey || S.currentWeekKey, k) === n.date) || [0, n.date])[1].toLowerCase();
  const p = { when, who, date: dl, from: n.momentFrom, to: n.momentTo };
  return NOTIF_TEXT[n.kind] ? NOTIF_TEXT[n.kind](p) : null;
}
function notificationsHtml(nowMs){
  const list = sortedNotifications(visibleNotifications(nowMs)).map(n => ({ n, txt: notificationText(n) })).filter(x => x.txt);
  const unread = unreadCount(visibleNotifications(nowMs));
  const q = quietOf(myLinkedFamilyId());
  const hours = sel => { const o = []; for(let h = 0; h < 24; h++){ const v = `${String(h).padStart(2, '0')}:00`; o.push(`<option value="${v}"${v === sel ? ' selected' : ''}>${v}</option>`); } return o.join(''); };
  return `${list.length ? list.slice(0, 20).map(({ n, txt }) => `<div class="rbNotif${n.read === true ? '' : ' unread'}"><b>${esc(txt.title)}</b><span>${esc(txt.body)}</span></div>`).join('') : `<p class="muted">${t('ritbeurs.notif.leeg')}</p>`}
    ${unread ? `<button type="button" class="btn small secondary" id="rbReadAll">${t('ritbeurs.notif.gelezen')}</button>` : ''}
    <div class="rbQuiet"><b>${t('ritbeurs.quiet.title')}</b><p class="muted" style="margin:2px 0 8px">${t('ritbeurs.quiet.uitleg')}</p>
      <div class="rowflex" style="gap:10px;align-items:center"><label for="rbqFrom">${t('ritbeurs.quiet.van')}</label><select id="rbqFrom" class="rbSel">${hours(q.from)}</select>
      <label for="rbqTo">${t('ritbeurs.quiet.tot')}</label><select id="rbqTo" class="rbSel">${hours(q.to)}</select></div></div>`;
}

export function ritbeursViewHtml(nowMs = Date.now()){
  const me = myLinkedFamilyId();
  const open = openOffers(S.offers, S.currentWeekKey, nowMs);
  const mineFirst = [...open.filter(o => o.offeredBy !== me), ...open.filter(o => o.offeredBy === me)];
  return `<div class="devAlert"><p class="devAlertTitle">${phIcon('lightning')} ${t('ritbeurs.title')}</p><p class="devAlertBody">${t('ritbeurs.intro')}</p></div>
    <div class="daysection"><h3>${t('ritbeurs.open.title')}</h3>${mineFirst.length ? mineFirst.map(o => offerCardHtml(o, nowMs)).join('') : `<p class="muted">${t('ritbeurs.open.leeg')}</p>`}</div>
    <div class="card"><h2>${t('ritbeurs.eigen.title')}</h2>${ownRidesHtml(nowMs)}</div>
    <div class="card" id="rbMomentCard"><h2>${t('ritbeurs.moment.title')}</h2><p class="muted">${t('ritbeurs.moment.intro')}</p>${momentsHtml(nowMs)}</div>
    <div class="card" id="rbNotifCard"><h2>${t('ritbeurs.notif.title')}</h2>${notificationsHtml(nowMs)}</div>`;
}

// ---------- actions (also used by the tests) ----------
export function readMomentForm(){
  const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const free = document.getElementById('rbmFree');
  const d = momentDraft();
  return { ...d, from: v('rbmFrom') || d.from, to: v('rbmTo') || d.to, onlyIfFree: free ? !!free.checked : d.onlyIfFree };
}
export async function saveMomentDraft(){
  const d = readMomentForm();
  S.rbMomentDraft = d;
  const ok = await addMoment(d);
  renderDeviationTab();
  return ok;
}
export async function offerRide(key){
  const [day, direction] = String(key).split('|');
  const el = document.getElementById('rbMessage');
  const ok = await createOffer(day, direction, el ? el.value : '');
  if(ok) S.rbOffering = null;
  renderDeviationTab();
  return ok;
}
export async function takeRide(id){ const ok = await takeOffer(id); renderDeviationTab(); return ok; }

export function wireRitbeurs(){
  const $$ = (sel, fn) => document.querySelectorAll(sel).forEach(fn);
  wireRitbeursSegment();
  $$('[data-rbask]', b => b.onclick = () => { hapticTap(); S.rbConfirm = b.dataset.rbask; renderDeviationTab(); });
  $$('[data-rbconfirmno]', b => b.onclick = () => { S.rbConfirm = null; renderDeviationTab(); });
  $$('[data-rbtake]', b => b.onclick = () => { hapticTap(); takeRide(b.dataset.rbtake); });
  $$('[data-rbwithdraw]', b => b.onclick = () => twoStepConfirm(b, t('ritbeurs.trekIn') + '?', async () => { await withdrawOffer(b.dataset.rbwithdraw); renderDeviationTab(); }));
  $$('[data-rboffer-open]', b => b.onclick = () => { hapticTap(); S.rbOffering = b.dataset['rbofferOpen']; renderDeviationTab(); });
  $$('[data-rbofferno]', b => b.onclick = () => { S.rbOffering = null; renderDeviationTab(); });
  $$('[data-rboffergo]', b => b.onclick = () => { hapticTap(); offerRide(b.dataset.rboffergo); });
  $$('[data-rbmday]', b => b.onclick = () => { S.rbMomentDraft = { ...readMomentForm(), date: b.dataset.rbmday }; renderDeviationTab(); });
  ['rbmFrom', 'rbmTo', 'rbmFree'].forEach(id => { const el = document.getElementById(id); if(el) el.onchange = () => { S.rbMomentDraft = readMomentForm(); renderDeviationTab(); }; });
  const save = document.getElementById('rbmSave'); if(save) save.onclick = () => { hapticTap(); saveMomentDraft(); };
  $$('[data-rbmomentdel]', b => b.onclick = () => { removeMoment(b.dataset.rbmomentdel).then(() => renderDeviationTab()); });
  const all = document.getElementById('rbReadAll'); if(all) all.onclick = () => { hapticTap(); markNotificationsRead(); };
  const qf = document.getElementById('rbqFrom'), qt = document.getElementById('rbqTo');
  const saveQ = () => saveQuiet(qf.value, qt.value);
  if(qf) qf.onchange = saveQ; if(qt) qt.onchange = saveQ;
}
export function wireRitbeursSegment(){
  document.querySelectorAll('[data-rbview]').forEach(b => b.onclick = () => { hapticTap(); setRbView(b.dataset.rbview); });
}

// ---------- Beheer: the feature switch (coordinator) ----------
export function ritbeursCardHtml(){
  const on = ritbeursOn();
  const open = on ? openOffers(S.offers, S.currentWeekKey, Date.now()).length : 0;
  const moments = on ? activeMoments(S.moments, Date.now()).length : 0;
  return `<div class="card" id="ritbeursCard">
      <h2>${t('ritbeurs.beheer.title')}</h2>
      <p class="muted">${t('ritbeurs.beheer.intro')}</p>
      <p class="muted">${t('ritbeurs.beheer.autosave')}</p>
      <label class="switchRow" for="ritbeursOn"><span>${t('ritbeurs.beheer.show')}</span>
        <input type="checkbox" role="switch" class="switch" id="ritbeursOn"${on ? ' checked' : ''}></label>
      <div class="rowflex" style="gap:8px;margin-top:10px;align-items:center"><span class="noticeChip ${on ? 'ok' : 'off'}">${t(on ? 'ritbeurs.beheer.status.on' : 'ritbeurs.beheer.status.off')}</span>
      <span class="muted">${esc(on ? t('ritbeurs.beheer.statusAan', { n: open, m: moments }) : t('ritbeurs.beheer.statusUit'))}</span></div>
    </div>`;
}
export function wireRitbeursCard(){
  const sw = document.getElementById('ritbeursOn');
  if(!sw) return;
  sw.onchange = async () => {
    hapticTap();
    const want = !!sw.checked;
    const ok = await setRitbeurs(want);
    if(!ok) sw.checked = ritbeursOn();
    renderBeheer(); renderDeviationTab();
  };
}
