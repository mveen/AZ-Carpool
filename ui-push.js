// ui-push.js — Beheer card "Meldingen testen": the master switch, the coordinator's devices, "Ik ben Ouder van Saar", the scenarios and
// the phone-style preview. COORDINATOR ONLY and TEMPORARY (push-access.js). The rules are in push.js, the database in push-data.js.
// A tapped push opens the app in Testweergave as the family the message was meant for (applyPendingPushOpen).
import { t } from './i18n.js';
import { S } from './state.js';
import { activateTab } from './app.js';
import { esc, hapticTap, phIcon, showToast, twoStepConfirm } from './ui-common.js';
import { startImpersonate } from './ui-profile.js';
import { renderDeviationTab } from './ui-deviation.js';
import { ritbeursAvailable } from './ui-ritbeurs.js';
import { pushVisible } from './push-access.js';
import { isRealCoordinator } from './coordinator.js';
import { parsePushLink, recipientLabel, serverState } from './push.js';
import { SCENARIOS } from './push-scenarios.js';
import {
  clearTests, enablePush, permissionState, previewItems, pushMode, pushSupport, removeDevice, runScenario, sendToMyDevice, setDeviceCategory, setPersona, setPushMode,
} from './push-data.js';

// Text keys by state. Written out in full (not built from pieces) so the check "every key exists" and a search for a key both find them.
const K = {
  server: { ok: 'push.server.ok', stil: 'push.server.stil', onbekend: 'push.server.onbekend' },
  state: { bezorgd: 'push.preview.state.bezorgd', verlopen: 'push.preview.state.verlopen' },
  push: { verstuurd: 'push.preview.push.verstuurd', wachtrij: 'push.preview.push.wachtrij', geen: 'push.preview.push.geen' },
  bron: { test: 'push.preview.bron.test', echt: 'push.preview.bron.echt' },
  wie: { echt: 'push.wie.echt', gekozen: 'push.wie.gekozen' },
  reden: { ok: 'push.wie.reden.ok', 'niet-gedekt': 'push.wie.reden.niet-gedekt', 'eigen-rit': 'push.wie.reden.eigen-rit', bezig: 'push.wie.reden.bezig', dubbel: 'push.wie.reden.dubbel' },
  scen: { rijVrij: 'push.scen.rijVrij', overgenomen: 'push.scen.overgenomen', backup: 'push.scen.backup', nietGedekt: 'push.scen.nietGedekt', dagcoordinator: 'push.scen.dagcoordinator' },
};
const hhmm = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export function agoText(ms, nowMs = Date.now()){
  if(!ms) return '';
  const min = Math.max(0, Math.floor((nowMs - ms) / 60000));
  if(min < 1) return t('push.ago.nu');
  if(min < 60) return t('push.ago.min', { n: min });
  return t('push.ago.uur', { n: Math.floor(min / 60) });
}
const familyOptions = sel => {
  const list = Object.entries(S.families || {}).map(([id, f]) => [id, recipientLabel(f, id)]).sort((a, b) => a[1].localeCompare(b[1], 'nl'));
  return `<option value="">${esc(t('push.persona.kies'))}</option>` + list.map(([id, label]) => `<option value="${esc(id)}"${id === sel ? ' selected' : ''}>${esc(label)}</option>`).join('');
};
const nameOf = id => esc((S.families[id] && recipientLabel(S.families[id], id)) || id);

// ---------- the pieces ----------
function modeHtml(nowMs){
  const test = pushMode() === 'test';
  const server = serverState(S.push.status, nowMs);
  const st = S.push.status;
  const detail = server === 'onbekend' ? '' : t('push.server.detail', { ago: agoText(st.lastRunAt, nowMs), sent: st.sent || 0, pending: st.pending || 0 });
  return `<label class="switchRow" for="pushTestOn"><span>${t('push.mode.label')}</span>
      <input type="checkbox" role="switch" class="switch" id="pushTestOn"${test ? ' checked' : ''}></label>
    <p class="muted">${t('push.mode.uitleg')}</p>
    <div class="rowflex pushStatus"><span class="noticeChip ${test ? 'ok' : 'off'}">${t(test ? 'push.status.test' : 'push.status.uit')}</span>
      <span class="noticeChip ${server === 'ok' ? 'ok' : 'off'}">${t(K.server[server])}</span>
      <span class="muted">${esc(detail)}</span></div>`;
}

function devicesHtml(nowMs){
  const list = Object.entries(S.push.devices || {}).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
  const rows = list.map(([id, d]) => `<div class="pushDevice">
      <div class="pushDevice__main"><b>${esc(d.label || t('push.toestel.browser'))}</b>${id === S.push.thisDeviceId ? ` <span class="noticeChip ok">${t('push.toestel.dit')}</span>` : ''}
        <span class="muted">${esc(d.lastOkAt ? t('push.toestel.laatst', { ago: agoText(d.lastOkAt, nowMs) }) : t('push.toestel.nooit'))}</span></div>
      <label class="switchRow" for="pushCat_${esc(id)}"><span>${t('push.toestel.ritten')}</span>
        <input type="checkbox" role="switch" class="switch" id="pushCat_${esc(id)}" data-pushcat="${esc(id)}"${(d.categories && d.categories.ritbeurs === false) ? '' : ' checked'}></label>
      <button type="button" class="btn small secondary" data-pushdevdel="${esc(id)}">${phIcon('trash')} ${t('push.toestel.verwijder')}</button>
    </div>`).join('');
  const support = pushSupport();
  const perm = permissionState();
  let hint = '';
  if(support === 'iosInstalleren') hint = t('push.hint.ios');
  else if(support === 'geenSupport') hint = t('push.hint.geenSupport');
  else if(perm === 'denied') hint = t('push.hint.geweigerd');
  else if(!(S.push.key && S.push.key.publicKey)) hint = t(pushMode() === 'test' && serverState(S.push.status, nowMs) !== 'ok' ? 'push.hint.serverStil' : 'push.hint.geenSleutel');
  const canEnable = support === 'ok' && perm !== 'denied' && !S.push.thisDeviceId;
  return `<div class="sectionLabel">${t('push.toestellen.title')}</div>
    ${rows || `<p class="muted">${t('push.toestellen.leeg')}</p>`}
    ${canEnable ? `<button type="button" class="btn small" id="pushEnable">${phIcon('bell')} ${t('push.aanzetten')}</button>` : ''}
    ${hint ? `<p class="muted pushHint">${esc(hint)}</p>` : ''}`;
}

function personaHtml(){
  return `<div class="sectionLabel">${t('push.persona.title')}</div>
    <select id="pushPersona" class="rbSel pushSel" aria-label="${esc(t('push.persona.title'))}">${familyOptions(S.push.personaId)}</select>
    <p class="muted">${t('push.persona.uitleg')}</p>`;
}

function scenariosHtml(){
  const ready = !!S.push.personaId;
  const time = S.push.timeChoice === 'nacht' ? 'nacht' : 'nu';
  return `<div class="sectionLabel">${t('push.scen.title')}</div>
    <div class="rowflex pushTime"><label for="pushTime">${t('push.scen.tijd')}</label>
      <select id="pushTime" class="rbSel pushSel"><option value="nu"${time === 'nu' ? ' selected' : ''}>${t('push.scen.tijd.nu')}</option>
      <option value="nacht"${time === 'nacht' ? ' selected' : ''}>${t('push.scen.tijd.nacht')}</option></select></div>
    <div class="pushScen">${SCENARIOS.map(s => `<button type="button" class="btn small secondary" data-pushscen="${s.id}"${ready ? '' : ' disabled'}>${t(K.scen[s.id])}</button>`).join('')}</div>
    ${pushMode() === 'test' ? '' : `<p class="muted pushHint">${t('push.hint.testUit')}</p>`}`;
}

function itemHtml(it, nowMs){
  const stateText = it.state === 'wacht' ? t('push.preview.state.wacht', { time: hhmm(it.n.deliverAt) }) : t(K.state[it.state]);
  const pushText = t(K.push[it.push]);
  const canSend = pushMode() === 'test' && it.state !== 'verlopen';
  return `<div class="pushNotif${it.state === 'wacht' ? ' is-wait' : ''}">
      <div class="pushNotif__app"><span class="pushNotif__icon">${phIcon('car')}</span><span>${t('push.preview.app')}</span><span class="pushNotif__time">${esc(agoText(it.n.createdAt, nowMs))}</span></div>
      <b>${esc(it.text.title)}</b><span class="pushNotif__body">${esc(it.text.body)}</span>
      <div class="pushNotif__meta"><span class="noticeChip ${it.state === 'bezorgd' ? 'ok' : 'off'}">${esc(stateText)}</span>
        <span class="noticeChip off">${t(K.bron[it.source])}</span><span class="muted">${esc(pushText)}</span></div>
      ${canSend ? `<button type="button" class="btn small secondary" data-pushsend="${esc(it.path)}">${phIcon('bell')} ${t('push.preview.stuur')}</button>` : ''}
    </div>`;
}

function whoHtml(){
  const last = S.push.last;
  if(!last || (!last.rows.length && !(last.explain || []).length)) return '';
  const why = r => t(K.wie[r.why === 'echt' ? 'echt' : 'gekozen']);
  const reason = e => t(K.reden[e.reason] || K.reden.ok);
  return `<div class="sectionLabel">${t('push.wie.title')}</div>
    ${last.rows.map(r => `<div class="pushWho"><b>${nameOf(r.toFamilyId)}</b><span class="noticeChip ${r.persona ? 'ok' : 'off'}">${esc(why(r))}</span></div>`).join('')}
    ${(last.explain || []).length ? `<p class="muted">${t('push.wie.backups')}</p>${last.explain.map(e => `<div class="pushWho"><b>${nameOf(e.familyId)}</b><span class="noticeChip ${e.receives ? 'ok' : 'off'}">${esc(reason(e))}</span></div>`).join('')}` : ''}`;
}

function previewHtml(nowMs){
  if(!S.push.personaId) return `<div class="sectionLabel">${t('push.preview.titleLeeg')}</div><p class="muted">${t('push.preview.kiesEerst')}</p>`;
  const items = previewItems(nowMs);
  return `<div class="sectionLabel">${esc(t('push.preview.title', { who: recipientLabel(S.families[S.push.personaId], S.push.personaId) }))}</div>
    <div class="pushPreview">${items.length ? items.map(it => itemHtml(it, nowMs)).join('') : `<p class="muted">${t('push.preview.leeg')}</p>`}</div>
    ${whoHtml()}
    ${Object.keys(S.push.tests || {}).length ? `<div class="cardActions"><button type="button" class="btn small secondary" id="pushClear">${phIcon('trash')} ${t('push.opruimen')}</button></div>` : ''}`;
}

// ---------- the card ----------
// The heading stays outside #pushBody: Beheer folds every card (foldCards moves the h2 into the summary), and a redraw only touches #pushBody.
function bodyHtml(nowMs){
  return `<p class="muted">${t('push.intro')}</p>${modeHtml(nowMs)}${devicesHtml(nowMs)}${personaHtml()}${scenariosHtml()}${previewHtml(nowMs)}`;
}
export function pushCardHtml(nowMs = Date.now()){
  if(!pushVisible()) return '';
  return `<div class="card" id="pushCard"><h2>${t('push.title')}</h2><div id="pushBody">${bodyHtml(nowMs)}</div></div>`;
}
// Redraws only the body of this card; does nothing when the card is not on screen. The listeners call it in the background (often): then it
// leaves the card alone while a list inside it has the focus, so it cannot close a list the coordinator is choosing from. After an
// action of the coordinator (`force`) it always redraws: the chosen select keeps the focus, and the card must still show the result.
export function refreshPushCard(force = false){
  const el = typeof document !== 'undefined' && document.getElementById('pushBody');
  if(!el || !pushVisible()) return;
  const active = document.activeElement;
  if(!force && active && typeof el.contains === 'function' && el.contains(active) && /^SELECT$/.test(active.tagName || '')) return;
  el.innerHTML = bodyHtml(Date.now());
  wirePushCard();
}

// ---------- actions (also used by the tests) ----------
export async function togglePushTest(on){ const ok = await setPushMode(on ? 'test' : 'uit'); refreshPushCard(true); return ok; }
// Why enabling did nothing, said out loud (a tap that seems to do nothing is the worst answer). 'mislukt' and 'ongeldig' already told themselves.
const ENABLE_REFUSED = {
  geenSleutel: 'push.err.geenSleutel', geweigerd: 'push.hint.geweigerd', iosInstalleren: 'push.hint.ios', geenSupport: 'push.hint.geenSupport', ongeldig: 'push.err.ongeldig',
};
export async function enableThisDevice(){
  const res = await enablePush();
  if(!res.ok && ENABLE_REFUSED[res.reason]) showToast(t(ENABLE_REFUSED[res.reason]));
  refreshPushCard(true);
  return res;
}
export async function pickPersona(id){ setPersona(id); refreshPushCard(true); }
export async function playScenario(id, choice){ const res = await runScenario(id, choice); refreshPushCard(true); return res; }

export function wirePushCard(){
  const $ = id => document.getElementById(id);
  const sw = $('pushTestOn'); if(sw) sw.onchange = () => { hapticTap(); togglePushTest(!!sw.checked); };
  const en = $('pushEnable'); if(en) en.onclick = () => { hapticTap(); enableThisDevice(); };
  const per = $('pushPersona'); if(per) per.onchange = () => pickPersona(per.value);
  const tm = $('pushTime'); if(tm) tm.onchange = () => { S.push.timeChoice = tm.value === 'nacht' ? 'nacht' : 'nu'; };
  const clr = $('pushClear'); if(clr) clr.onclick = () => { hapticTap(); clearTests(); };
  document.querySelectorAll('[data-pushscen]').forEach(b => b.onclick = () => { hapticTap(); const tmv = $('pushTime'); playScenario(b.dataset.pushscen, tmv ? tmv.value : S.push.timeChoice); });
  document.querySelectorAll('[data-pushsend]').forEach(b => b.onclick = () => { hapticTap(); sendToMyDevice(b.dataset.pushsend); });
  document.querySelectorAll('[data-pushcat]').forEach(c => c.onchange = () => setDeviceCategory(c.dataset.pushcat, 'ritbeurs', !!c.checked));
  document.querySelectorAll('[data-pushdevdel]').forEach(b => b.onclick = () => twoStepConfirm(b, t('push.toestel.zeker'), () => removeDevice(b.dataset.pushdevdel)));
}

// ---------- a tapped push: open the app as the family the message was for ----------
// From the address (?pushas=<familyId>) or from the service worker's message when the app was already open.
export function queuePushOpen(familyId){
  const id = parsePushLink('?pushas=' + encodeURIComponent(String(familyId || '')));
  if(id) S.push.pendingOpen = id;
  return applyPendingPushOpen();
}
export function queuePushOpenFromUrl(search){
  const id = parsePushLink(search);
  if(id){ S.push.pendingOpen = id; try{ history.replaceState(null, '', location.pathname + (location.hash || '')); }catch(e){ /* the address stays; harmless */ } }
  return applyPendingPushOpen();
}
// Called after every redraw: waits until the app knows who is using it and which families exist. Only the real coordinator is ever taken
// into a Testweergave; for anybody else the request is dropped. The Ritten-ruilen screen is chosen as soon as the app knows that Ritten ruilen
// is on (its switch arrives after the families), so a cold start from a tapped push still ends on that screen.
export function applyPendingPushOpen(){
  const id = S.push.pendingOpen;
  if(!id){ applyPendingView(); return false; }
  if(!S.appReady || !S.linksLoaded) return false;
  if(!pushVisible() || !isRealCoordinator()){ S.push.pendingOpen = ''; return false; }
  if(!S.families[id]){ if(Object.keys(S.families).length) S.push.pendingOpen = ''; return false; }
  S.push.pendingOpen = '';
  S.push.pendingView = true;
  if(S.impersonateFamilyId !== id) startImpersonate(id);
  applyPendingView();
  renderDeviationTab();
  activateTab('deviation');
  if(S.rbView === 'ritbeurs') scrollToInbox();   // (activateTab scrolls to the top first)
  return true;
}
function applyPendingView(){
  if(!S.push.pendingView) return;
  if(!S.impersonateFamilyId){ S.push.pendingView = false; return; }   // the Testweergave was stopped meanwhile
  if(!ritbeursAvailable()) return;                                      // Ritten ruilen is not known (or not on) yet: try again at the next redraw
  S.push.pendingView = false;
  S.rbView = 'ritbeurs';
  renderDeviationTab();
  scrollToInbox();
}
// The notification a tapped push was about is in the card "Meldingen" at the bottom of the screen: bring it into view.
function scrollToInbox(){
  const card = typeof document !== 'undefined' && document.getElementById('rbNotifCard');
  if(card && typeof card.scrollIntoView === 'function'){ try{ card.scrollIntoView({ block: 'start' }); }catch(e){ /* scrolling is a convenience */ } }
}
