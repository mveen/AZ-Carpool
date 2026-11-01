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
import { redrawAfterTyping, weekroosterActive } from './ui-weekrooster-form.js';
import { renderBeheer } from './ui-beheer.js';
import { periodCardsHtml } from './ui-period.js';
import { familiesWithPush, serverState } from './push.js';
import {
  activeMoments, momentCovers, openOffers, rideStartMs, sortedNotifications, unreadCount, urgency,
} from './ritbeurs.js';
import {
  addMoment, allRides, markNotificationsRead, pushLiveOn, removeMoment, ritbeursOn, setPushLive, setRitbeurs, takeOffer, warningsFor, withdrawOffer,
} from './ritbeurs-data.js';

const dayLabel = k => (DAYS.find(([d]) => d === k) || [k, String(k || '')])[1];
const famName = id => esc((S.families[id] && (S.families[id].parentName || S.families[id].girlName)) || t('ritbeurs.notif.onbekend'));
const NOTIFICATIONS_SHOWN = 5;
const SEEN_MS = 4000;   // the notifications count as read after the tab has been open this long
const dirShort = d => t(d === 'heen' ? 'dir.heenShort' : 'dir.terugShort');

// Is the Ritbeurs usable for this user? The switch is on and the user has a linked family.
export function ritbeursAvailable(){ return !!(S.me && ritbeursOn() && myLinkedFamilyId()); }

// Notifications that may be shown now (those held back by quiet hours appear when the quiet hours end).
export function visibleNotifications(nowMs = Date.now()){
  const own = {};
  Object.entries(S.notifications || {}).forEach(([id, n]) => { if(n && !(n.deliverAt > nowMs) && !(n.expiresAt < nowMs)) own[id] = n; });
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
    const problems = [];
    if(w && !w.seats.ok) problems.push(`⚠ ${t('ritbeurs.warn.zitplaatsen', { need: w.seats.need, have: w.seats.have })}`);
    if(w && w.conflict) problems.push(`⚠ ${t('ritbeurs.warn.conflict', { day: dayLabel(w.conflict.day).toLowerCase(), dir: dirShort(w.conflict.direction).toLowerCase(), time: w.conflict.time })}`);
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
    <div class="rbBy">${mine ? t('ritbeurs.open.eigen') : t('ritbeurs.open.door', { name: famName(o.offeredBy) })}</div>
    ${o.message ? `<div class="rbNote">“${esc(o.message)}”</div>` : ''}
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
  }).join('') : `<p class="muted">${t('ritbeurs.moment.leeg')}</p>`;
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
      <div class="dayPills" role="group" aria-label="${esc(t('ritbeurs.moment.dag'))}">${days}</div>
      <div class="rbTimes">
        <label for="rbmFrom"><span>${t('ritbeurs.moment.van')}</span><select id="rbmFrom" class="rbSel">${timeOptions(d.from)}</select></label>
        <label for="rbmTo"><span>${t('ritbeurs.moment.tot')}</span><select id="rbmTo" class="rbSel">${timeOptions(d.to)}</select></label></div>
      <p class="muted" id="rbmPreview">${esc(preview)}</p>
      <button type="button" class="btn" id="rbmSave">${t('ritbeurs.moment.opslaan')}</button></div>`;
}
// How many rides (of other families) the draft moment touches.
export function momentPreview(d){
  const me = myLinkedFamilyId();
  const n = allRides().filter(r => r.familyId !== me && momentCovers({ date: d.date, from: d.from, to: d.to }, r.date, r.time)).length;
  return n ? t(n === 1 ? 'ritbeurs.moment.raaktEen' : 'ritbeurs.moment.raakt', { n }) : t('ritbeurs.moment.raaktGeen');
}

function notificationLine(n){
  return notificationText(n, { nameOf: id => (S.families[id] && (S.families[id].parentName || S.families[id].girlName)) || '', currentWeekKey: S.currentWeekKey });
}
// Test phase (coordinator only): in Testweergave as a family, the made-up notifications of that family are part of the inbox too, marked "test"
// (never counted in the badge), so a tapped test push lands on the notification it was about. Held back by quiet hours like a real one.
export function testNotificationsForView(nowMs = Date.now()){
  if(!S.impersonateFamilyId || !pushVisible()) return {};
  const out = {};
  Object.entries(S.push.tests || {}).forEach(([id, n]) => { if(n && n.toFamilyId === S.impersonateFamilyId && !(n.deliverAt > nowMs) && !(n.expiresAt <= nowMs)) out[id] = n; });
  return out;
}
// A notification in the look of the day-coordinator card (amber edge, warning icon, bold title, text). `go` adds a button (used in Mijn week).
function notifCardHtml({ n, txt }, go){
  return `<div class="entryCard entryCard--stack rbNotifCard${n.read === true ? '' : ' unread'}" role="status">
    <div class="entryCard__head"><span class="entryCard__icon">${phIcon('warning-circle-fill')}</span><b>${esc(txt.title)}${n.isTest ? ` <span class="noticeChip off">${t('push.preview.bron.test')}</span>` : ''}</b></div>
    <p class="entryCard__text">${esc(txt.body)}</p>${go ? `<button type="button" class="btn entryCard__go" data-rbnotifgo="1">${t('ritbeurs.notif.bekijk')}</button>` : ''}</div>`;
}
// Mijn week: the unread notifications (at most three) on top. They disappear when the Ruilen tab has been open for a moment.
export function myWeekNotificationsHtml(nowMs = Date.now()){
  if(!ritbeursAvailable()) return '';
  return sortedNotifications(visibleNotifications(nowMs)).filter(n => n.read !== true).map(n => ({ n, txt: notificationLine(n) })).filter(x => x.txt).slice(0, 3).map(x => notifCardHtml(x, true)).join('');
}
export function wireMyWeekNotifications(box, goToRuilen){ box.querySelectorAll('[data-rbnotifgo]').forEach(b => b.onclick = () => { hapticTap(); goToRuilen(); }); }

// The latest few notifications; nothing at all when there are none. They count as read when the tab has been open for a moment.
function notificationsHtml(nowMs){
  const tests = sortedNotifications(testNotificationsForView(nowMs)).map(n => ({ ...n, isTest: true, read: true }));
  const list = [...sortedNotifications(visibleNotifications(nowMs)), ...tests].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(n => ({ n, txt: notificationLine(n) })).filter(x => x.txt);
  return list.slice(0, NOTIFICATIONS_SHOWN).map(x => notifCardHtml(x, false)).join('');
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
    ${head('ritbeurs.moment.title')}<div class="card" id="rbMomentCard"><p class="muted">${t('ritbeurs.moment.intro')}</p>${momentsHtml(nowMs)}</div>`;
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
  const save = document.getElementById('rbmSave'); if(save) save.onclick = () => { hapticTap(); saveMomentDraft(); };
  $$('[data-rbmomentdel]', b => b.onclick = () => { removeMoment(b.dataset.rbmomentdel).then(() => renderDeviationTab()); });
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
