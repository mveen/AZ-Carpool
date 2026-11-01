// ui-ritbeurs.js — the Ruilen tab (the Ritbeurs): rides that look for a replacement ("Zoekt een vervanger"), "Ik kan inspringen" moments and the
// notifications (only when there are any). Offering your own ride is done in Mijn week (ui-driver-car.js). The rules are in ritbeurs.js, everything that writes is in ritbeurs-data.js.
// Everything here is hidden when the feature switch (settings/ritbeurs) is off; the Beheer card with that switch is at the bottom.
import { t } from './i18n.js';
import { S } from './state.js';
import { DAYS, PH_PATHS } from './constants.js';
import { dayUp, weekKeyDayIso } from './dates.js';
import { myFamilyId, myLinkedFamilyId } from './coordinator.js';
import { effectiveCars, fam } from './rides.js';
import { esc, hapticTap, locationsCfg, phIcon, twoStepConfirm } from './ui-common.js';
import { routeLabel } from './locations.js';
import { notificationText } from './notif-text.js';
import { pushVisible } from './push-access.js';
import { renderDeviationTab } from './ui-deviation.js';
import { openOfferSheet } from './ui-driver-car.js';
import { redrawAfterTyping, weekroosterActive } from './ui-weekrooster-form.js';
import { renderBeheer } from './ui-beheer.js';
import { periodCardsHtml } from './ui-period.js';
import { familiesWithPush, serverState } from './push.js';
import {
  activeMoments, hasOpenOffer, momentCovers, openOffers, rideStartMs, sortedNotifications, unreadCount, urgency,
} from './ritbeurs.js';
import {
  addMoment, allRides, markNotificationsRead, pushLiveOn, removeMoment, ridesOf, ritbeursOn, setPushLive, setRitbeurs, takeOffer, warningsFor, withdrawOffer,
} from './ritbeurs-data.js';

const dayLabel = k => (DAYS.find(([d]) => d === k) || [k, String(k || '')])[1];
const famName = id => esc((S.families[id] && (S.families[id].parentName || S.families[id].girlName)) || t('ritbeurs.notif.onbekend'));
const NOTIFICATIONS_SHOWN = 5;
const SEEN_MS = 4000;   // the notifications count as read after the tab has been open this long
const dirShort = d => t(d === 'heen' ? 'dir.heenShort' : 'dir.terugShort');

// Is the Ritbeurs usable for this user? The switch is on and the user has a linked family.
export function ritbeursAvailable(){ return !!(S.me && ritbeursOn() && myLinkedFamilyId()); }

// Notifications that may be shown now (not dismissed on this phone, not expired).
// "Negeren" / "Sluiten" on a notification card is remembered on this phone only (the database rules let a notification change nothing but `read`).
const DISMISS_KEY = 'azc.dismissedNotifications';
let dismissedMem = null;
function dismissedSet(){
  if(!dismissedMem){ try{ dismissedMem = new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); }catch(e){ dismissedMem = new Set(); } }
  return dismissedMem;
}
var myWeekRedraw;   // var on purpose: ui-myweek.js sets it while this module is still loading (circular import)
export function setMyWeekRedraw(fn){ myWeekRedraw = fn; }
export function dismissNotification(id){
  const set = dismissedSet(); set.add(id);
  try{ localStorage.setItem(DISMISS_KEY, JSON.stringify([...set].slice(-200))); }catch(e){ /* kept in memory for this session */ }
}
export function resetDismissedNotifications(){ dismissedMem = null; }
export function visibleNotifications(nowMs = Date.now()){
  const own = {}, gone = dismissedSet();
  Object.entries(S.notifications || {}).forEach(([id, n]) => { if(n && !gone.has(id) && !(n.expiresAt < nowMs)) own[id] = n; });
  return own;
}
// The number on the Ruilen tab: open rides of other families + unread notifications. 0 when the switch is off.
export function ritbeursBadgeCount(nowMs = Date.now()){
  if(!ritbeursAvailable()) return 0;
  const me = myLinkedFamilyId();
  return openOffers(S.offers, S.currentWeekKey, nowMs).filter(o => o.offeredBy !== me).length + unreadCount(visibleNotifications(nowMs));
}

// ---------- the tab: name, icon and colour follow the feature ----------
// While the Ritbeurs is on the tab is Ruilen (teal, two people with an arrow). Without it the tab is the old Wijzigen (day by day editor), and for a
// family with a weekrooster it is hidden: Tijden wijzigen opens from Mijn week.
export function syncVervangerNav(){
  const btn = document.querySelector && document.querySelector('nav button[data-tab="deviation"]'); if(!btn || !btn.querySelector) return;
  const on = ritbeursAvailable(), icon = btn.querySelector('.navicon'), label = btn.querySelector('.navlabel');
  if(icon && !btn.dataset.iconDefault) btn.dataset.iconDefault = icon.innerHTML;
  if(btn.classList) btn.classList.toggle('navtab--ruil', on);
  if(icon) icon.innerHTML = on ? `<svg class="ph-regular" viewBox="0 0 256 256" aria-hidden="true">${PH_PATHS['users-swap']}</svg><svg class="ph-fill" viewBox="0 0 256 256" aria-hidden="true">${PH_PATHS['users-swap-fill']}</svg>` : btn.dataset.iconDefault;
  if(label){ label.setAttribute('data-i18n', on ? 'nav.vervanger' : 'nav.deviation'); label.textContent = t(on ? 'nav.vervanger' : 'nav.deviation'); }
  btn.style.display = (!on && weekroosterActive() && !periodCardsHtml()) ? 'none' : '';   // a waiting period task keeps the tab
}
export function setRbView(view){ S.rbView = view === 'ritbeurs' ? 'ritbeurs' : 'wijzigen'; S.rbConfirm = null; renderDeviationTab(); }

// ---------- the view ----------
// Only what is wrong when taking a ride over (not enough seats, another ride too close); empty when everything fits. A warning, never a block.
function problemLines(w){
  const out = [];
  if(w && !w.seats.ok) out.push(`⚠ ${t('ritbeurs.warn.zitplaatsen', { need: w.seats.need, have: w.seats.have })}`);
  if(w && w.conflict) out.push(`⚠ ${t('ritbeurs.warn.conflict', { day: dayLabel(w.conflict.day).toLowerCase(), dir: dirShort(w.conflict.direction).toLowerCase(), time: w.conflict.time })}`);
  return out;
}
function offerCardHtml(o, nowMs){
  const me = myLinkedFamilyId();
  const me_ = myFamilyId();
  const mine = o.offeredBy === me;
  const car = effectiveCars(o.day, o.direction).find(c => c.driverFamilyId === o.offeredBy && (!o.time || c.departureTime === o.time)) || effectiveCars(o.day, o.direction).find(c => c.driverFamilyId === o.offeredBy);
  const route = car ? routeLabel(car, o.direction, locationsCfg(), o.day) : '';
  const girls = car ? (car.girlIds || []).map(id => `<span class="chip${id === me_ ? ' chip--mine' : ''}">${esc((fam(id).girlName) || id)}</span>`).join('') : '';
  const u = urgency(o.date, nowMs);
  const urgentText = u === 'late' ? ` · ${t('ritbeurs.urg.late')}` : u === 'soon' ? ` · ${t('ritbeurs.urg.soon')}` : '';
  const w = mine ? null : warningsFor(o, me);
  const hasWarn = !!(w && (!w.seats.ok || w.conflict));
  let confirm = '';
  if(S.rbConfirm === o.id && !mine){
    // Only what is wrong is shown (not enough seats, another ride too close); when everything fits there is just the question and the button.
    const problems = problemLines(w);
    confirm = `<div class="rbConfirm" role="group" aria-label="${esc(t('ritbeurs.confirm.title'))}">
      <h4>${t('ritbeurs.confirm.title', { short: `${dayLabel(o.day).toLowerCase()} ${dirShort(o.direction).toLowerCase()} ${t('ritbeurs.om')} ${o.time}` })}</h4>
      ${problems.length ? `<p class="rbChecks">${problems.map(esc).join('<br>')}</p>` : ''}
      <div class="rowflex"><button type="button" class="btn" data-rbtake="${esc(o.id)}">${t('ritbeurs.confirm.ja')}</button>
      <button type="button" class="btn secondary" data-rbconfirmno="1">${t('ritbeurs.confirm.nee')}</button></div></div>`;
  }
  const status = `<span class="tag tag--ruil">${t('ritbeurs.tag.open')}</span>`;
  return `<div class="card rbOffer${hasWarn ? ' rbHasWarn' : ''}" data-rboffer="${esc(o.id)}">
    <div class="rbHeadline">${status}<span class="rbWhen">${esc(dayLabel(o.day))} · ${esc(dirShort(o.direction).toLowerCase())}${esc(urgentText)}</span></div>
    <div class="rbRideLine"><span class="rbTime">${esc(o.time)}</span><span class="rbRoute">${esc(route)}</span></div>
    <div class="rbBy"><b>${mine ? t('ritbeurs.open.eigen') : famName(o.offeredBy)}</b>${o.message ? ` · <i>“${esc(o.message)}”</i>` : ''}</div>
    ${girls ? `<div class="chips rbPills">${girls}</div>` : ''}
    ${mine ? `<button type="button" class="btn secondary" data-rbwithdraw="${esc(o.id)}">${t('ritbeurs.trekIn')}</button>`
      : (S.rbConfirm === o.id ? '' : `<button type="button" class="btn" data-rbask="${esc(o.id)}">${t(hasWarn ? 'ritbeurs.toch' : 'ritbeurs.neemOver')}</button>`)}
    ${confirm}
  </div>`;
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
    return `<div class="rbMoment">
      <span><b>${esc(dl)}</b> ${esc(m.from)}–${esc(m.to)}</span>
      <button type="button" class="btn small secondary iconBtn" data-rbmomentdel="${esc(m.id)}" aria-label="${esc(t('ritbeurs.moment.verwijder'))}">${phIcon('trash')}</button></div>`;
  }).join('') : '';
  // Closed: only the own moments (if any) and one button. The form opens with a tap (and stays open while a draft is being typed).
  if(!S.rbMomentOpen && !S.rbMomentDraft){
    return `${list}<button type="button" class="btn secondary rbAddMoment" id="rbmOpen">${phIcon('plus-circle')}${t('ritbeurs.moment.toevoegen')}</button>`;
  }
  const d = momentDraft();
  // The same day buttons as in Mijn week: five equal columns over the full width.
  const days = DAYS.map(([k, label]) => {
    const iso = weekKeyDayIso(S.currentWeekKey, k);
    const past = rideStartMs(iso, '23:59') <= nowMs;
    return `<button type="button" class="dayPill${d.date === iso ? ' on' : ''}" data-rbmday="${iso}" aria-pressed="${d.date === iso}" aria-label="${esc(label)}"${past ? ' disabled' : ''}><span class="dayPill__ab">${esc(dayUp(k).toLowerCase())}</span><span class="dayPill__n">${Number(String(iso).slice(8, 10))}</span></button>`;
  }).join('');
  const preview = momentPreview(d);
  return `${list}
    <div class="rbForm"><h4>${t('ritbeurs.moment.nieuw')}</h4>
      <p class="muted rbIntro">${t('ritbeurs.moment.intro')}</p>
      <div class="dayPills" role="group" aria-label="${esc(t('ritbeurs.moment.dag'))}">${days}</div>
      <div class="rbTimes">
        <label for="rbmFrom"><span>${t('ritbeurs.moment.van')}</span><select id="rbmFrom" class="rbSel">${timeOptions(d.from)}</select></label>
        <label for="rbmTo"><span>${t('ritbeurs.moment.tot')}</span><select id="rbmTo" class="rbSel">${timeOptions(d.to)}</select></label></div>
      <div class="rbSaveRow"><span class="muted" id="rbmPreview">${esc(preview)}</span>
        <button type="button" class="btn" id="rbmSave">${t('ritbeurs.moment.opslaan')}</button></div></div>`;
}
// How many rides (of other families) the draft moment touches.
export function momentPreview(d){
  const me = myLinkedFamilyId();
  const n = allRides().filter(r => r.familyId !== me && momentCovers({ date: d.date, from: d.from, to: d.to }, r.date, r.time)).length;
  return n ? t(n === 1 ? 'ritbeurs.moment.raaktEen' : 'ritbeurs.moment.raakt', { n }) : t('ritbeurs.moment.raaktGeen');
}

const familyNameOf = id => (S.families[id] && (S.families[id].parentName || S.families[id].girlName)) || '';
function notificationLine(n){
  return notificationText(n, { nameOf: familyNameOf, currentWeekKey: S.currentWeekKey });
}
// Test phase (coordinator only): in Testweergave as a family, the made-up notifications of that family are part of the inbox too, marked "test"
// (never counted in the badge), so a tapped test push lands on the notification it was about. 
export function testNotificationsForView(nowMs = Date.now()){
  if(!S.impersonateFamilyId || !pushVisible()) return {};
  const out = {};
  Object.entries(S.push.tests || {}).forEach(([id, n]) => { if(n && n.toFamilyId === S.impersonateFamilyId && !(n.expiresAt <= nowMs)) out[id] = n; });
  return out;
}
// A notification in the look of the day-coordinator card (amber edge, warning icon, bold title, text). `go` adds a button (used in Mijn week).
// The own rides that a "back-up for your ride" notification is about and that can still be offered: inside the back-up's time slot, not started,
// not on offer yet. The card then has the button(s) "Bied mijn rit aan" that open the offer form at once.
export function ridesInSlotOf(n, nowMs = Date.now()){
  const me = myLinkedFamilyId();
  if(!me || !n || n.kind !== 'backupForRide' || !n.date) return [];
  return ridesOf(me).filter(r => momentCovers({ date: n.date, from: n.momentFrom, to: n.momentTo }, r.date, r.time) && rideStartMs(r.date, r.time) > nowMs);
}
export function offerableRidesFor(n, nowMs = Date.now()){
  const me = myLinkedFamilyId();
  return ridesInSlotOf(n, nowMs).filter(r => !hasOpenOffer(S.offers, S.currentWeekKey, r.day, r.direction, me));
}
// Done: the notification is about rides of mine that are all on offer already, so there is nothing left to do with it (hidden everywhere).
// "Rit vrij" (a back-up gets it when a ride is offered inside their moment): the offer it is about, while it can still be taken over by this family
// (open, not their own, not started). Gone, taken or withdrawn: nothing left to decide, so the card is hidden everywhere.
export function takeableOfferOf(n, nowMs = Date.now()){
  const me = myLinkedFamilyId(), o = n && n.kind === 'offerBackup' && n.sourceId ? S.offers[n.sourceId] : null;
  return o && me && o.status === 'open' && o.offeredBy !== me && rideStartMs(o.date, o.time) > nowMs ? { id: n.sourceId, ...o } : null;
}
const notifDone = (n, nowMs) => n.kind === 'offerBackup' ? !takeableOfferOf(n, nowMs) : ridesInSlotOf(n, nowMs).length > 0 && !offerableRidesFor(n, nowMs).length;
function notifCardHtml({ n, txt }, go, nowMs = Date.now()){
  const rides = offerableRidesFor(n, nowMs);
  const take = n.isTest ? null : takeableOfferOf(n, nowMs);
  const problems = take ? problemLines(warningsFor(take, myLinkedFamilyId())) : [];   // shown up front, so Overnemen can be one tap
  const who = familyNameOf(n.fromFamilyId);   // the back-up: the offer form names them (and prefills the message)
  const offerBtns = rides.map(r => `<button type="button" class="btn entryCard__go" data-rboffernow="${esc(r.day)}|${esc(r.direction)}" data-rbwho="${esc(who)}">${rides.length === 1 ? t('ritbeurs.notif.biedAan') : t('ritbeurs.notif.biedAanRit', { when: `${dayLabel(r.day).toLowerCase()} ${dirShort(r.direction).toLowerCase()} ${r.time}` })}</button>`).join('');
  go = go && !rides.length && !take;
  const takeBtns = take ? `<button type="button" class="btn entryCard__go" data-rbnotiftake="${esc(take.id)}">${t(problems.length ? 'ritbeurs.toch' : 'ritbeurs.notif.neemOver')}</button>` : '';
  const dismissKey = n.kind === 'backupForRide' ? 'ritbeurs.notif.negeer' : take ? 'ritbeurs.notif.wijsAf' : 'ritbeurs.notif.sluit';
  return `<div class="entryCard entryCard--stack rbNotifCard" role="status">
    <div class="entryCard__head"><span class="entryCard__icon">${phIcon('warning-circle-fill')}</span><b>${esc(txt.title)}${n.isTest ? ` <span class="noticeChip off">${t('push.preview.bron.test')}</span>` : ''}</b></div>
    <p class="entryCard__text">${esc(txt.body)}</p>${problems.length ? `<p class="rbChecks">${problems.map(esc).join('<br>')}</p>` : ''}${n.isTest ? '' : `<div class="rbNotifActs">${offerBtns}${takeBtns}${go ? `<button type="button" class="btn entryCard__go" data-rbnotifgo="1">${t('ritbeurs.notif.bekijk')}</button>` : ''}<button type="button" class="btn secondary entryCard__go" data-rbnotifdismiss="${esc(n.id)}">${t(dismissKey)}</button></div>`}</div>`;
}
// Mijn week: the notifications that still need something (unread, or a ride that can be offered), at most three.
export function myWeekNotificationsHtml(nowMs = Date.now()){
  if(!ritbeursAvailable()) return '';
  return sortedNotifications(visibleNotifications(nowMs)).filter(n => !notifDone(n, nowMs) && (n.read !== true || offerableRidesFor(n, nowMs).length)).map(n => ({ n, txt: notificationLine(n) })).filter(x => x.txt).slice(0, 3).map(x => notifCardHtml(x, true, nowMs)).join('');
}
export function wireMyWeekNotifications(box, goToRuilen, rerender){
  box.querySelectorAll('[data-rbnotifgo]').forEach(b => b.onclick = () => { hapticTap(); goToRuilen(); });
  box.querySelectorAll('[data-rboffernow]').forEach(b => b.onclick = () => offerNow(b, rerender));
  box.querySelectorAll('[data-rbnotiftake]').forEach(b => b.onclick = () => { hapticTap(); b.disabled = true; takeFromNotification(b.dataset.rbnotiftake, rerender); });
  box.querySelectorAll('[data-rbnotifdismiss]').forEach(b => b.onclick = () => { hapticTap(); dismissNotification(b.dataset.rbnotifdismiss); renderDeviationTab(); if(rerender) rerender(); });
}
// "Overnemen" on a "Rit vrij" card: takes the ride over at once (the card shows a seat/time warning up front when there is one). Then both screens are
// redrawn; the local copy of the offer is set to taken so the card is gone at once (the snapshot catches up).
export async function takeFromNotification(offerId, rerender){
  const ok = await takeOffer(offerId);
  if(ok && S.offers[offerId]) S.offers[offerId] = { ...S.offers[offerId], status: 'taken', takenBy: myLinkedFamilyId() };
  renderDeviationTab(); if(rerender) rerender(); else if(myWeekRedraw) myWeekRedraw();
  return ok;
}
// "Bied mijn rit aan" on a notification card: the same offer form as in Mijn week (ui-driver-car.js) in its back-up variant (the back-up is named,
// the message is prefilled, the button reads "Bied mijn rit aan"), then both screens are redrawn.
function offerNow(b, rerender){
  hapticTap(); const [day, direction] = b.dataset.rboffernow.split('|');
  openOfferSheet(day, direction, () => { renderDeviationTab(); if(rerender) rerender(); }, { backup: true, who: b.dataset.rbwho || '' });
}

// The latest few notifications; nothing at all when there are none. They count as read when the tab has been open for a moment.
function notificationsHtml(nowMs){
  const tests = sortedNotifications(testNotificationsForView(nowMs)).map(n => ({ ...n, isTest: true, read: true }));
  const list = [...sortedNotifications(visibleNotifications(nowMs)).filter(n => !notifDone(n, nowMs)), ...tests].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(n => ({ n, txt: notificationLine(n) })).filter(x => x.txt);
  return list.slice(0, NOTIFICATIONS_SHOWN).map(x => notifCardHtml(x, false, nowMs)).join('');
}

export function ritbeursViewHtml(nowMs = Date.now()){
  const me = myLinkedFamilyId();
  const open = openOffers(S.offers, S.currentWeekKey, nowMs);
  const mineFirst = [...open.filter(o => o.offeredBy !== me), ...open.filter(o => o.offeredBy === me)];
  const head = key => `<div class="sectionHead"><span class="sectionHead__title">${t(key)}</span></div>`;
  const notifs = notificationsHtml(nowMs);
  return `${notifs ? `<div id="rbNotifCard">${notifs}</div>` : ''}
    <div class="infoLine"><span class="infoLine__text">${t('ritbeurs.intro')}</span></div>
    ${head('ritbeurs.open.title')}${mineFirst.length ? mineFirst.map(o => offerCardHtml(o, nowMs)).join('') : `<p class="muted">${t('ritbeurs.open.leeg')}</p>`}
    ${head('ritbeurs.moment.title')}<div class="card" id="rbMomentCard">${momentsHtml(nowMs)}</div>`;
}

// ---------- actions (also used by the tests) ----------
export function readMomentForm(){
  const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const d = momentDraft();
  return { ...d, from: v('rbmFrom') || d.from, to: v('rbmTo') || d.to, onlyIfFree: true };
}
export async function saveMomentDraft(){
  const d = readMomentForm();
  S.rbMomentDraft = d;
  const ok = await addMoment(d);
  if(ok) S.rbMomentOpen = false;
  renderDeviationTab();
  return ok;
}
export async function takeRide(id){ const ok = await takeOffer(id); renderDeviationTab(); return ok; }

// Notifications count as read once the tab has been open for a moment (SEEN_MS), so the red dots can still be seen first. No button for it.
let seenTimer = null;
function markSeenSoon(){
  clearTimeout(seenTimer);
  if(!unreadCount(visibleNotifications())) return;
  seenTimer = setTimeout(() => {
    const tab = document.getElementById('tab-deviation');
    if(tab && tab.style && tab.style.display === 'block') markNotificationsRead();
  }, SEEN_MS);
  if(seenTimer && seenTimer.unref) seenTimer.unref();
}

export function wireRitbeurs(){
  const $$ = (sel, fn) => document.querySelectorAll(sel).forEach(fn);
  $$('[data-rbask]', b => b.onclick = () => { hapticTap(); S.rbConfirm = b.dataset.rbask; renderDeviationTab(); });
  $$('[data-rbconfirmno]', b => b.onclick = () => { S.rbConfirm = null; renderDeviationTab(); });
  $$('[data-rbtake]', b => b.onclick = () => { hapticTap(); takeRide(b.dataset.rbtake); });
  $$('[data-rbwithdraw]', b => b.onclick = () => twoStepConfirm(b, t('ritbeurs.trekIn') + '?', async () => { await withdrawOffer(b.dataset.rbwithdraw); renderDeviationTab(); }));
  $$('[data-rbmday]', b => b.onclick = () => { S.rbMomentDraft = { ...readMomentForm(), date: b.dataset.rbmday }; renderDeviationTab(); });
  ['rbmFrom', 'rbmTo'].forEach(id => { const el = document.getElementById(id); if(el) el.onchange = () => { S.rbMomentDraft = readMomentForm(); if(el.blur) el.blur(); renderDeviationTab(); }; });
  // A list that is open must not be redrawn under the finger (see holdFormRedraw): a held redraw is done after the list is left.
  $$('.rbSel', el => { el.onblur = () => setTimeout(redrawAfterTyping, 700); });
  const openForm = document.getElementById('rbmOpen'); if(openForm) openForm.onclick = () => { hapticTap(); S.rbMomentOpen = true; renderDeviationTab(); };
  const save = document.getElementById('rbmSave'); if(save) save.onclick = () => { hapticTap(); saveMomentDraft(); };
  $$('[data-rbmomentdel]', b => b.onclick = () => { removeMoment(b.dataset.rbmomentdel).then(() => renderDeviationTab()); });
  $$('[data-rboffernow]', b => b.onclick = () => offerNow(b, null));
  $$('[data-rbnotiftake]', b => b.onclick = () => { hapticTap(); b.disabled = true; takeFromNotification(b.dataset.rbnotiftake, null); });
  $$('[data-rbnotifdismiss]', b => b.onclick = () => { hapticTap(); dismissNotification(b.dataset.rbnotifdismiss); renderDeviationTab(); if(myWeekRedraw) myWeekRedraw(); });
  markSeenSoon();
}
// ---------- Beheer: the feature switches (coordinator) ----------
// The card has two switches: Ritten ruilen itself, and the push messages for the parents (default off). Testing the pushes always works,
// whatever these two say: that is the card "Push-meldingen testen".
function pushLiveHtml(nowMs){
  const live = pushLiveOn();
  const phones = familiesWithPush(S.push.devices), families = Object.keys(S.families || {}).length;
  const server = serverState(S.push.status, nowMs);
  return `<div class="sectionLabel">${t('ritbeurs.beheer.push.title')}</div>
      <p class="muted">${t('ritbeurs.beheer.push.uitleg')}</p>
      <label class="switchRow" for="pushLiveOn"><span>${t('ritbeurs.beheer.push.label')}</span>
        <input type="checkbox" role="switch" class="switch" id="pushLiveOn"${live ? ' checked' : ''}></label>
      <div class="rowflex"><span class="noticeChip ${live ? 'ok' : 'off'}">${t(live ? 'ritbeurs.beheer.status.on' : 'ritbeurs.beheer.status.off')}</span>
      <span class="muted">${esc(live ? t('ritbeurs.beheer.push.statusAan', { n: phones, m: families }) : t('ritbeurs.beheer.push.statusUit'))}</span></div>
      ${live && server !== 'ok' ? `<p class="muted">${t('ritbeurs.beheer.push.serverStil')}</p>` : ''}`;
}
export function ritbeursCardHtml(nowMs = Date.now()){
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
      ${pushLiveHtml(nowMs)}
    </div>`;
}
export function wireRitbeursCard(){
  const sw = document.getElementById('ritbeursOn');
  if(sw){
    sw.onchange = async () => {
      hapticTap();
      const want = !!sw.checked;
      const ok = await setRitbeurs(want);
      if(!ok) sw.checked = ritbeursOn();
      renderBeheer(); renderDeviationTab();
    };
  }
  const live = document.getElementById('pushLiveOn');
  if(live){
    live.onchange = async () => {
      hapticTap();
      const ok = await setPushLive(!!live.checked);
      if(!ok) live.checked = pushLiveOn();
      renderBeheer();
    };
  }
}
