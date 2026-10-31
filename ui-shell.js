// ui-shell.js — the frame around every screen (design system v2): the header with the screen title,
// the week line, the share button and the avatar, and the Instellingen sheet behind the avatar
// (Mijn gezin, theme, Agenda, help). The tab bar itself is plain markup in index.html.
import { t } from './i18n.js';
import { S } from './state.js';
import { esc, phIcon, closeSheet, applyTheme, currentTheme, setTheme, showToast } from './ui-common.js';
import { APP_VERSION } from './constants.js';
import { weekRangeLabel } from './dates.js';
import { fam } from './rides.js';
import { canSwitchViewFor, isRealCoordinator, myFamilyId, recomputeCanEdit } from './coordinator.js';
import { startImpersonate, stopImpersonate } from './ui-profile.js';
import { openHelp } from './ui-help.js';
import { sendWhatsAppUpdate } from './ui-deviation.js';
import { AVATARS, avatarOf, avatarInner, avatarClass, avatarLabel } from './avatars.js';
import { saveAvatar } from './data.js';
import { buildMyWeekWhatsAppMessage } from './message-texts.js';
import { initContact } from './ui-contact.js';
import { hasAgenda, openAgendaSheet } from './ui-agenda.js';
import { openPushSheet, pushRowVisible } from './ui-push-device.js';

// Which text key names each screen in the header.
export const TAB_TITLE_KEY = { myweek: 'nav.myweek', schedule: 'nav.rooster', deviation: 'nav.deviation', matches: 'nav.matches', beheer: 'nav.beheer', profile: 'nav.profile' };
// Only Mijn week has the share button (it shares that week).
const SHOWS_SHARE = new Set(['myweek']);

// "Sophie Veen" -> "SV", "Jan" -> "J", nothing -> "" (the caller picks a fallback).
export function initials(name){
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return '';
  const first = parts[0][0], last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// The signed-in parent's name, or '' when this device is not linked to a family (the same test as the old header line).
function parentName(){
  const linked = !!(S.links && S.links[S.me] && S.links[S.me].familyId) || !!S.impersonateFamilyId;
  return linked ? (fam(myFamilyId()).parentName || '') : '';
}

// The family whose avatar this device may change: only when linked to a family (or testing as one), never the bare coordinator.
function ownFamilyId(){
  const linked = !!(S.links && S.links[S.me] && S.links[S.me].familyId) || !!S.impersonateFamilyId;
  return linked ? myFamilyId() : '';
}
function ownAvatar(){ const id = ownFamilyId(); return id ? avatarOf(fam(id)) : ''; }

// The small line above the screen title (design v2): Mijn week shows the week, the other screens say what they are for.
export function contextLine(screen){
  const week = S.currentWeekKey ? weekRangeLabel() : '';
  if(screen === 'myweek') return week || t('shell.context_gezin');
  if(screen === 'schedule') return S.currentWeekKey ? t('shell.context_rooster', { week: week.split(' · ')[0].replace(/^\D+/, '') }) : t('shell.context_gezin');
  if(screen === 'deviation') return t('shell.context_wijzigen');
  if(screen === 'matches'){ const team = (S.matchFeeds && S.matchFeeds[0] && S.matchFeeds[0].label) || ''; return team ? t('shell.context_wedstrijden', { team: team.replace(/^AZ\s+/i, '') }) : t('shell.context_wedstrijden_plain'); }
  if(screen === 'beheer') return t('shell.context_beheer');
  return t('shell.context_gezin');
}

// Redraws the header for the given screen (title, week line, share button, avatar letters).
export function updateHeader(tab){
  if(!tab){ const on = document.querySelector('nav button.active'); tab = on && on.dataset ? on.dataset.tab : 'myweek'; }
  const screen = TAB_TITLE_KEY[tab] ? tab : 'myweek';
  const title = document.getElementById('headerTitle');
  if(title) title.textContent = t(TAB_TITLE_KEY[screen]);
  const ctx = document.getElementById('headerContext');
  if(ctx) ctx.textContent = contextLine(screen);
  const share = document.getElementById('shareToggle');
  if(share) share.hidden = !SHOWS_SHARE.has(screen);
  const sw = document.getElementById('switchParentBtn');
  if(sw){
    sw.hidden = !isRealCoordinator();   // real coordinator rights, so it stays when the Beheer tab is hidden in a test view
    const ic = document.getElementById('switchParentIcon');
    if(ic) ic.innerHTML = phIcon('users') + `<span class="roundBtn__badge">${phIcon('arrows-left-right-fill')}</span>`;
    if(sw.classList) sw.classList.toggle('on', !!S.impersonateFamilyId);
  }
  const av = document.getElementById('avatarInitials');
  if(av){
    const pick = ownAvatar();
    av.innerHTML = avatarInner(pick, initials(parentName()) || (S.canEdit ? t('shell.avatar_coordinator') : '?'));
    const btn = document.getElementById('avatarBtn'); if(btn && btn.classList) btn.classList.toggle('avatar--icon', !!pick);
  }
}

// The list behind the switch button: every parent (name first, daughter below), plus "Terug naar mezelf" while a test view runs.
export function switchParentRows(){
  return Object.keys(S.families || {})
    .map(id => ({ id, parent: (S.families[id].parentName || '').trim(), girl: (S.families[id].girlName || '').trim() }))
    .filter(r => r.parent || r.girl)
    .sort((a, b) => (a.parent || a.girl).localeCompare(b.parent || b.girl, 'nl'));
}

export function openSwitchParent(){
  if(!isRealCoordinator()) return;
  closeSheet();
  const cur = S.impersonateFamilyId || '';
  const rows = switchParentRows();
  const self = cur ? `<button type="button" class="sheetItem sheetItem--self" data-switch-self="1">${phIcon('arrow-left')}<span class="sheetItem__label">${esc(t('shell.switch_self'))}<br><span class="sub">${esc(t('shell.switch_self_sub'))}</span></span></button>` : '';
  const item = r => `<button type="button" class="sheetItem${r.id === cur ? ' sheetItem--current' : ''}" data-switch-id="${esc(r.id)}" data-q="${esc((r.parent + ' ' + r.girl).toLowerCase())}"${r.id === cur ? ' aria-current="true"' : ''}>${phIcon('user')}<span class="sheetItem__label">${esc(r.parent || r.girl)}${r.parent && r.girl ? `<br><span class="sub">${esc(t('shell.parent_of', { name: r.girl }))}</span>` : ''}</span>${r.id === cur ? `<span class="tag tag--ok">${esc(t('shell.switch_current'))}</span>` : ''}</button>`;
  const ov = document.createElement('div'); ov.className = 'sheetOverlay'; ov.id = 'sheetOverlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="sheet__handle"></div>
    <h3 id="sheetTitle">${esc(t('shell.switch_title'))}</h3><p class="sheet__sub">${esc(t('shell.switch_sub'))}</p>
    ${self}
    <input type="search" id="switchSearch" class="switchSearch" placeholder="${esc(t('shell.switch_search'))}" aria-label="${esc(t('shell.switch_search_label'))}" autocomplete="off">
    <div id="switchList">${rows.map(item).join('')}</div>
    <p class="sheet__sub" id="switchNone" hidden>${esc(t('shell.switch_none'))}</p>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target === ov) closeSheet(); });
  const selfBtn = ov.querySelector('[data-switch-self]'); if(selfBtn) selfBtn.onclick = () => { closeSheet(); stopImpersonate(); };
  ov.querySelectorAll('[data-switch-id]').forEach(b => b.onclick = () => {
    const id = b.dataset.switchId; closeSheet();
    if(id !== S.impersonateFamilyId) startImpersonate(id);
  });
  const search = ov.querySelector('#switchSearch');
  if(search) search.oninput = () => {
    const q = String(search.value || '').trim().toLowerCase(); let shown = 0;
    ov.querySelectorAll('[data-switch-id]').forEach(b => { const ok = !q || String(b.dataset.q || '').includes(q); b.hidden = !ok; if(ok) shown++; });
    const none = ov.querySelector('#switchNone'); if(none) none.hidden = shown > 0;
  };
}

// "Mijn week delen": a sheet with the text and one Delen button. The phone's own share menu opens when the browser has one (any app);
// otherwise WhatsApp opens with the text filled in. Nothing is sent by the app itself.
export async function shareWeek(text){
  if(typeof navigator !== 'undefined' && navigator.share){
    try{ await navigator.share({ text }); return true; }
    catch(e){ if(e && e.name === 'AbortError') return false; /* any other error: use the fallback below */ }
  }
  sendWhatsAppUpdate(() => text);
  return true;
}

export function openShare(){
  closeSheet();
  const text = buildMyWeekWhatsAppMessage();
  const ov = document.createElement('div'); ov.className = 'sheetOverlay'; ov.id = 'sheetOverlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="sheet__handle"></div>
    <h3 id="sheetTitle">${esc(t('shell.share_title'))}</h3><p class="sheet__sub">${esc(t('shell.share_sub'))}</p>
    <div class="sharePreview">${esc(text)}</div>
    <button type="button" class="btn" id="doShare" style="width:100%">${phIcon('share-fat')}${esc(t('shell.share_button'))}</button>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target === ov) closeSheet(); });
  ov.querySelector('#doShare').onclick = async () => { closeSheet(); await shareWeek(text); };
}

// Views of a coordinator who also has a family: "Ouder" hides the coordinator tools (view only: rights on the server do not change).
export function setViewAs(mode, onViewChange){
  S.viewAsParent = mode === 'parent';
  try{ localStorage.setItem('view-as', S.viewAsParent ? 'parent' : 'coordinator'); }catch(e){}
  recomputeCanEdit();
  markSegments();
  if(onViewChange) onViewChange();
}

// Marks the active button of the "Bekijk als" switch in the sheet.
function markSegments(){
  [['viewParent', S.viewAsParent], ['viewCoord', !S.viewAsParent]].forEach(([id, on]) => {
    const b = document.getElementById(id);
    if(b){ if(on) b.classList.add('active'); else b.classList.remove('active'); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  });
}

// The Instellingen sheet: who you are, then one row per setting (Mijn gezin, Thema, Bekijk als [coordinator only], Agenda, Push-meldingen, Help) and the version.
export function openSettings(onNavigate, onViewChange){
  closeSheet();
  const name = parentName();
  const girl = fam(myFamilyId()).girlName;
  const linked = !!name;
  // The team (e.g. O15-1) when the app has exactly one match calendar: the only place the app knows a team name.
  const feeds = S.matchFeeds || [];
  const team = feeds.length === 1 && feeds[0].label ? String(feeds[0].label).replace(/^AZ\s+/i, '') : '';
  const role = [linked && girl ? t('shell.parent_of', { name: girl }) : (linked ? t('common.ouder') : t('shell.not_linked')), linked ? team : '', S.canEdit || (canSwitchViewFor(S)) ? t('coordinator.coordinator') : ''].filter(Boolean).join(' · ');
  const go = onNavigate || (() => {});
  const row = (id, icon, label, hint) => `<button type="button" class="settingsRow" id="${id}">${phIcon(icon)}<span class="settingsRow__label">${esc(label)}</span>${hint ? `<span class="settingsRow__hint">${esc(hint)}</span>` : ''}${phIcon('caret-right')}</button>`;
  const viewRow = canSwitchViewFor(S) ? `<div class="settingsRow">${phIcon('user-switch')}<span class="settingsRow__label">${esc(t('shell.view_as'))}</span>
      <div class="segmented segmented--inline" role="group" aria-label="${esc(t('shell.view_as'))}"><button type="button" id="viewParent">${esc(t('shell.view_parent'))}</button><button type="button" id="viewCoord">${esc(t('shell.view_coord'))}</button></div></div>` : '';
  const ov = document.createElement('div'); ov.className = 'sheetOverlay'; ov.id = 'sheetOverlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="sheet__handle"></div>
    <div class="settingsHead">${avatarHead(name)}
      <div><h3 id="sheetTitle">${esc(name || t('shell.settings'))}</h3><p class="sheet__sub">${esc(role)}</p></div></div>
    ${row('setProfile', 'users', t('nav.profile'), t('shell.family_hint'))}
    <div class="settingsRow">${phIcon('moon')}<span class="settingsRow__label">${esc(t('shell.theme'))}</span>
      <div class="segmented segmented--inline" role="group" aria-label="${esc(t('shell.theme'))}"><button type="button" id="themeLight">${esc(t('shell.theme_light'))}</button><button type="button" id="themeDark">${esc(t('shell.theme_dark'))}</button></div></div>
    ${viewRow}
    ${hasAgenda() ? row('setAgenda', 'calendar', t('agenda.kaart_titel')) : ''}
    ${pushRowVisible() ? row('setPush', 'bell', t('push.me.title')) : ''}
    ${row('setHelp', 'question', t('help.title'))}
    <div class="settingsRow settingsRow--info">${phIcon('info')}<span class="settingsRow__label">${esc(t('shell.app_name'))}</span><span class="settingsRow__hint">${esc(APP_VERSION)}</span></div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target === ov) closeSheet(); });
  ov.querySelector('#setProfile').onclick = () => { closeSheet(); go('profile'); };
  const setAv = ov.querySelector('#setAvatar'); if(setAv) setAv.onclick = () => openAvatarPicker(onNavigate, onViewChange);
  const setAgenda = ov.querySelector('#setAgenda'); if(setAgenda) setAgenda.onclick = () => openAgendaSheet();
  const setPush = ov.querySelector('#setPush'); if(setPush) setPush.onclick = () => openPushSheet();
  ov.querySelector('#setHelp').onclick = () => { closeSheet(); openHelp(document.getElementById('avatarBtn')); };
  ov.querySelector('#themeLight').onclick = () => setTheme('light');
  ov.querySelector('#themeDark').onclick = () => setTheme('dark');
  if(viewRow){
    ov.querySelector('#viewParent').onclick = () => setViewAs('parent', onViewChange);
    ov.querySelector('#viewCoord').onclick = () => setViewAs('coordinator', onViewChange);
    markSegments();
  }
  applyTheme(currentTheme());   // marks the active theme button
  const first = ov.querySelector('#setProfile'); if(first) first.focus();
}

// The big avatar in the Instellingen sheet: a button (with a pencil) when this device can pick an avatar, a plain circle otherwise.
function avatarHead(name){
  const pick = ownAvatar(), inner = avatarInner(pick, initials(name) || (S.canEdit ? t('shell.avatar_coordinator') : '?'));
  if(!ownFamilyId()) return `<span class="settingsAvatar">${inner}</span>`;
  return `<button type="button" class="settingsAvatar settingsAvatar--btn${avatarClass(pick)}" id="setAvatar" aria-label="${esc(t('avatar.edit'))}">${inner}<span class="settingsAvatar__edit">${phIcon('pencil')}</span></button>`;
}

// "Kies je avatar": a sheet with the initials (default) and the library. A tap saves at once, with Ongedaan (design rule 9a).
export function openAvatarPicker(onNavigate, onViewChange){
  const fid = ownFamilyId(); if(!fid) return;
  const current = ownAvatar(), name = parentName();
  const letters = initials(name) || '?';
  const tile = (id, inner, label, cls) => `<button type="button" class="avatarTile" data-avatar="${esc(id)}" aria-pressed="${id === current}"><span class="avatarTile__disc${cls}">${inner}</span><span class="avatarTile__label">${esc(label)}</span></button>`;
  closeSheet();
  const ov = document.createElement('div'); ov.className = 'sheetOverlay'; ov.id = 'sheetOverlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="sheet__handle"></div>
    <h3 id="sheetTitle">${esc(t('avatar.title'))}</h3><p class="sheet__sub">${esc(t('avatar.sub'))}</p>
    <div class="avatarGrid">${tile('', esc(letters), t('avatar.initials'), '')}${AVATARS.map(id => tile(id, phIcon(id), avatarLabel(id), ' avatar--icon')).join('')}</div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => {
    if(e.target === ov){ closeSheet(); return; }
    const b = e.target && e.target.closest ? e.target.closest('[data-avatar]') : null;
    if(!b) return;
    pickAvatar(fid, b.dataset.avatar, onNavigate, onViewChange);
  });
  const sel = ov.querySelector('[aria-pressed="true"]'); if(sel && sel.focus) sel.focus();
}

async function pickAvatar(fid, next, onNavigate, onViewChange){
  const prev = avatarOf(fam(fid));
  closeSheet();
  if(next === prev){ openSettings(onNavigate, onViewChange); return; }
  if(!(await saveAvatar(fid, next))) return;
  updateHeader();
  showToast(t('avatar.saved'), { action: { label: t('avatar.undo'), run: async () => {
    if(await saveAvatar(fid, prev)){ updateHeader(); showToast(t('avatar.restored')); }
  } } });
  openSettings(onNavigate, onViewChange);
}

// Brave on Android now and then computes 100dvh too tall (after coming back to the app, or while the address bar moves),
// which pushes the tab bar off the screen until the browser is restarted. So the visible height is measured here and kept in
// --app-h (tokens.css); when this cannot measure, the stylesheet's own 100dvh stays in charge.
export function syncAppHeight(){
  const h = Math.round(Number(window.innerHeight) || 0);
  if(h > 0 && document.documentElement && document.documentElement.style && document.documentElement.style.setProperty) document.documentElement.style.setProperty('--app-h', h + 'px');
}

// Called once from app.js bootstrap: wires the avatar, the share button, the contact names and the "back to Instellingen" links.
export function initShell(onNavigate, onViewChange){
  const av = document.getElementById('avatarBtn');
  if(av) av.onclick = () => openSettings(onNavigate, onViewChange);
  const sh = document.getElementById('shareToggle'); if(sh) sh.onclick = openShare;
  const sw = document.getElementById('switchParentBtn'); if(sw) sw.onclick = openSwitchParent;
  initContact();
  syncAppHeight();
  for(const ev of ['resize', 'orientationchange', 'pageshow']) window.addEventListener(ev, syncAppHeight);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) syncAppHeight(); });
  if(window.visualViewport && window.visualViewport.addEventListener) window.visualViewport.addEventListener('resize', syncAppHeight);
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest ? e.target.closest('[data-opensettings]') : null;
    if(b) openSettings(onNavigate, onViewChange);
    // Vast | Flex switch in the family form: drives the (hidden) select that the save code reads.
    const ft = e.target && e.target.closest ? e.target.closest('[data-famtype]') : null;
    if(ft){
      const sel = document.getElementById(ft.dataset.famtypefor);
      if(sel) sel.value = ft.dataset.famtype;
      document.querySelectorAll('[data-famtypefor="' + ft.dataset.famtypefor + '"]').forEach(x => x.classList.toggle('active', x === ft));
    }
  });
}
