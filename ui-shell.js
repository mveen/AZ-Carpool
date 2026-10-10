// ui-shell.js — the frame around every screen (design system v2): the header with the screen title,
// the week line, the share button and the avatar, and the Instellingen sheet behind the avatar
// (Mijn gezin, theme, help). The tab bar itself is plain markup in index.html.
import { t } from './i18n.js';
import { S } from './state.js';
import { esc, phIcon, closeSheet, applyTheme, currentTheme, setTheme } from './ui-common.js';
import { APP_VERSION } from './constants.js';
import { weekRangeLabel } from './dates.js';
import { fam } from './rides.js';
import { canSwitchViewFor, myFamilyId, recomputeCanEdit } from './coordinator.js';
import { openHelp } from './ui-help.js';
import { sendWhatsAppUpdate } from './ui-deviation.js';
import { buildMyWeekWhatsAppMessage } from './message-texts.js';
import { initContact } from './ui-contact.js';

// Which text key names each screen in the header.
export const TAB_TITLE_KEY = { myweek: 'nav.myweek', schedule: 'nav.rooster', deviation: 'nav.deviation', matches: 'nav.matches', beheer: 'nav.beheer', profile: 'nav.profile' };
// Screens that belong to one planning week show the week line under the icon.
const SHOWS_WEEK = new Set(['myweek', 'schedule', 'deviation']);
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
  const av = document.getElementById('avatarInitials');
  if(av) av.textContent = initials(parentName()) || (S.canEdit ? t('shell.avatar_coordinator') : '?');
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

// The Instellingen sheet: who you are, then one row per setting (Mijn gezin, Thema, Bekijk als, Help) and the version.
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
    <div class="settingsHead"><span class="settingsAvatar">${esc(initials(name) || (S.canEdit ? t('shell.avatar_coordinator') : '?'))}</span>
      <div><h3 id="sheetTitle">${esc(name || t('shell.settings'))}</h3><p class="sheet__sub">${esc(role)}</p></div></div>
    ${row('setProfile', 'users', t('nav.profile'), t('shell.family_hint'))}
    <div class="settingsRow">${phIcon('moon')}<span class="settingsRow__label">${esc(t('shell.theme'))}</span>
      <div class="segmented segmented--inline" role="group" aria-label="${esc(t('shell.theme'))}"><button type="button" id="themeLight">${esc(t('shell.theme_light'))}</button><button type="button" id="themeDark">${esc(t('shell.theme_dark'))}</button></div></div>
    ${viewRow}
    ${row('setHelp', 'question', t('help.title'))}
    <div class="settingsRow settingsRow--info">${phIcon('info')}<span class="settingsRow__label">${esc(t('shell.app_name'))}</span><span class="settingsRow__hint">${esc(APP_VERSION)}</span></div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target === ov) closeSheet(); });
  ov.querySelector('#setProfile').onclick = () => { closeSheet(); go('profile'); };
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

// Called once from app.js bootstrap: wires the avatar, the share button, the contact names and the "back to Instellingen" links.
export function initShell(onNavigate, onViewChange){
  const av = document.getElementById('avatarBtn');
  if(av) av.onclick = () => openSettings(onNavigate, onViewChange);
  const sh = document.getElementById('shareToggle'); if(sh) sh.onclick = openShare;
  initContact();
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest ? e.target.closest('[data-opensettings]') : null;
    if(b) openSettings(onNavigate, onViewChange);
  });
}
