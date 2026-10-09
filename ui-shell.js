// ui-shell.js — the frame around every screen (design system v2): the header with the screen title,
// the week line, the share button and the avatar, and the Instellingen sheet behind the avatar
// (Mijn gezin, theme, help). The tab bar itself is plain markup in index.html.
import { t } from './i18n.js';
import { S } from './state.js';
import { esc, phIcon, closeSheet, applyTheme, currentTheme, setTheme } from './ui-common.js';
import { weekRangeLabel } from './dates.js';
import { fam } from './rides.js';
import { myFamilyId } from './coordinator.js';
import { openHelp } from './ui-help.js';
import { wireWhatsAppButton } from './ui-deviation.js';
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

// Redraws the header for the given screen (title, week line, share button, avatar letters).
export function updateHeader(tab){
  if(!tab){ const on = document.querySelector('nav button.active'); tab = on && on.dataset ? on.dataset.tab : 'myweek'; }
  const screen = TAB_TITLE_KEY[tab] ? tab : 'myweek';
  const title = document.getElementById('headerTitle');
  if(title) title.textContent = t(TAB_TITLE_KEY[screen]);
  const ctx = document.getElementById('headerContext');
  if(ctx) ctx.textContent = SHOWS_WEEK.has(screen) && S.currentWeekKey ? weekRangeLabel() : t('app.route');
  const share = document.getElementById('shareToggle');
  if(share) share.hidden = !SHOWS_SHARE.has(screen);
  const av = document.getElementById('avatarInitials');
  if(av) av.textContent = initials(parentName()) || (S.canEdit ? t('shell.avatar_coordinator') : '?');
}

// The Instellingen sheet: who you are, Mijn gezin, theme, help.
export function openSettings(onNavigate){
  closeSheet();
  const name = parentName();
  const role = S.canEdit ? t('coordinator.coordinator') : (name ? t('common.ouder') : t('shell.not_linked'));
  const go = onNavigate || (() => {});
  const ov = document.createElement('div'); ov.className = 'sheetOverlay'; ov.id = 'sheetOverlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="sheet__handle"></div>
    <h3 id="sheetTitle">${esc(name || t('shell.settings'))}</h3><p class="sheet__sub">${esc(role)}</p>
    <button type="button" class="sheetItem" id="setProfile"><span>${esc(t('nav.profile'))}</span>${phIcon('arrow-right')}</button>
    <p class="sheet__label">${esc(t('shell.theme'))}</p>
    <div class="segmented" role="group" aria-label="${esc(t('shell.theme'))}">
      <button type="button" id="themeLight">${esc(t('shell.theme_light'))}</button><button type="button" id="themeDark">${esc(t('shell.theme_dark'))}</button>
    </div>
    <button type="button" class="sheetItem" id="setHelp"><span>${esc(t('help.title'))}</span>${phIcon('arrow-right')}</button>
    <button type="button" class="btn secondary" id="sheetCancel" style="width:100%">${esc(t('shell.close'))}</button>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target === ov) closeSheet(); });
  ov.querySelector('#sheetCancel').onclick = closeSheet;
  ov.querySelector('#setProfile').onclick = () => { closeSheet(); go('profile'); };
  ov.querySelector('#setHelp').onclick = () => { closeSheet(); openHelp(document.getElementById('avatarBtn')); };
  ov.querySelector('#themeLight').onclick = () => setTheme('light');
  ov.querySelector('#themeDark').onclick = () => setTheme('dark');
  applyTheme(currentTheme());   // marks the active theme button
  const first = ov.querySelector('#setProfile'); if(first) first.focus();
}

// Called once from app.js bootstrap: wires the avatar and the share button.
export function initShell(onNavigate){
  const av = document.getElementById('avatarBtn');
  if(av) av.onclick = () => openSettings(onNavigate);
  wireWhatsAppButton('shareToggle', buildMyWeekWhatsAppMessage);
  initContact();
}
