// ui-install-prompt.js — a one-time sheet that offers to put the app on the home screen.
//
// FEATURE TOGGLE (temporary): the sheet is OFF in every deployment until INSTALL_PROMPT_ENABLED below is set to true.
// To try it on ONE phone first, add  ?installprompt=1  to the address once (this device only; ?installprompt=0 switches it off,
// and =1 also forgets earlier answers so it can be tried again). Nothing goes into the database: what was shown is remembered
// per device, because installing is per device too.
//
// AFTER THE ROLLOUT, remove the toggle but keep the feature: delete INSTALL_PROMPT_ENABLED, PREVIEW_KEY, applyPreviewParam(),
// previewOn() and isEnabled() (and the 'off' line in blockedReason()), plus the preview tests at the end of
// tests/ui-install-prompt.test.js. No database field, Beheer card or CSS to clean up.
// To remove the WHOLE feature instead: delete this file, its test, the 'installprompt.*' texts, its line in service-worker.js
// (ASSETS), its README row, and the import plus the two maybeShowInstallPrompt() calls in app.js.
import { t } from './i18n.js';
import { S } from './state.js';
import { closeSheet, esc, isIOSDevice, isStandaloneDisplay, phIcon } from './ui-common.js';

export const INSTALL_PROMPT_ENABLED = false;   // <- the toggle. Off at deployment; set to true to roll out.

const STORE_KEY = 'install-prompt';            // per device: { v:1, n: times shown, until: ms, done: bool }
const PREVIEW_KEY = 'install-prompt-preview';  // per device switch set by ?installprompt=1
const SHOW_DELAY_MS = 1500;                    // let the first screen settle before the sheet comes up
const REPEAT_AFTER_MS = 14 * 24 * 3600 * 1000; // dismissed without "Begrepen": ask again after two weeks
const MAX_SHOWS = 3;                           // ... at most three times in total
const EMPTY = { v: 1, n: 0, until: 0, done: false };

let scheduled = false;                         // at most one sheet per page load

// ---------- the toggle ----------
let previewApplied = false;
// Reads ?installprompt= once per page load (not on every check, or a later check would wipe what the sheet just stored).
function applyPreviewParam(){
  if(previewApplied) return;
  previewApplied = true;
  try{
    const q = new URLSearchParams(String((typeof location !== 'undefined' && location.search) || '')).get('installprompt');
    if(q === '1'){ localStorage.setItem(PREVIEW_KEY, '1'); localStorage.removeItem(STORE_KEY); }
    else if(q === '0'){ localStorage.removeItem(PREVIEW_KEY); }
  }catch(e){}
}
function previewOn(){
  applyPreviewParam();
  try{ return localStorage.getItem(PREVIEW_KEY) === '1'; }catch(e){ return false; }
}
export function isEnabled(){ return INSTALL_PROMPT_ENABLED || previewOn(); }

// ---------- what was shown before (this device only) ----------
function storageWorks(){
  try{ localStorage.setItem('install-prompt-probe', '1'); localStorage.removeItem('install-prompt-probe'); return true; }
  catch(e){ return false; }   // private mode / blocked storage: we could not remember the answer, so we do not ask at all
}
export function readState(){
  try{ const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); return s && s.v === 1 ? { ...EMPTY, ...s } : { ...EMPTY }; }
  catch(e){ return { ...EMPTY }; }
}
function writeState(s){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(s)); }catch(e){} }

// ---------- which offer fits this device ----------
// 'native'  Android/Chrome handed us the install dialog (S.deferredInstallPrompt): one button.
// 'ios'     iPhone/iPad in Safari-like browsers: no install API exists, so we explain the three taps.
// 'firefox' Firefox on Android: it never hands us an install dialog, so we explain the taps in its menu.
// ''        nothing to offer: already installed, or a browser that cannot do it (the WhatsApp in-app browser, desktop).
export function installPromptKind(){
  if(S.appIsInstalled || isStandaloneDisplay()) return '';
  if(S.deferredInstallPrompt) return 'native';
  // In-app browsers (WhatsApp, Instagram, ...) on iOS have no "Zet op beginscherm"; they leave "Safari/" out of the user agent.
  const ua = (navigator && navigator.userAgent) || '';
  if(isIOSDevice() && /Safari\//.test(ua)) return 'ios';
  if(/Android/.test(ua) && /Firefox\//.test(ua)) return 'firefox';
  return '';
}

// '' when the sheet may come up now, otherwise why not (handy in tests).
export function blockedReason(now = Date.now()){
  if(!isEnabled()) return 'off';
  if(!installPromptKind()) return 'nothing-to-offer';
  if(!S.appReady || !S.linksLoaded) return 'not-ready';
  const gate = document.getElementById('tab-gate');
  if(gate && gate.style && gate.style.display === 'block') return 'gate';   // not linked yet: the person has other things to do first
  if(document.getElementById('sheetOverlay')) return 'sheet-open';
  if(!storageWorks()) return 'no-storage';
  const s = readState();
  if(s.done || s.n >= MAX_SHOWS) return 'done';
  if(now < s.until) return 'later';
  return '';
}

// ---------- the sheet ----------
export function installPromptHtml(kind){
  const step = (icon, key) => `<div class="settingsRow">${phIcon(icon)}<span class="settingsRow__label">${esc(t(key))}</span></div>`;
  const body = kind === 'native'
    ? ''
    : kind === 'firefox'
      ? step('dots-three-vertical', 'installprompt.ff_stap1') + step('plus-circle', 'installprompt.ff_stap2') + step('house', 'installprompt.stap3')
      : step('share-fat', 'installprompt.stap1') + step('plus-circle', 'installprompt.stap2') + step('house', 'installprompt.stap3');
  const ok = kind === 'native'
    ? `<button type="button" class="btn" id="installPromptOk">${esc(t('common.installeer_app'))}</button>`
    : `<button type="button" class="btn" id="installPromptOk">${esc(t('installprompt.begrepen'))}</button>`;
  return `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="sheet__handle"></div>
    <h3 id="sheetTitle">${esc(t('installprompt.title'))}</h3><p class="sheet__sub">${esc(t(kind === 'native' ? 'installprompt.sub_native' : 'installprompt.sub'))}</p>
    ${body}
    <div class="sheet__actions"><button type="button" class="btn secondary" id="installPromptLater">${esc(t('installprompt.later'))}</button>${ok}</div>
  </div>`;
}

// Shows the sheet right now (when allowed). Showing counts as "asked once" at once, so every way of leaving the sheet
// (tap outside, Escape, another sheet taking over) behaves like "Later"; only "Begrepen" / a finished install stops it for good.
export function showInstallPrompt(){
  if(blockedReason()) return false;
  const kind = installPromptKind(), s = readState();
  writeState({ ...s, n: s.n + 1, until: Date.now() + REPEAT_AFTER_MS });
  closeSheet();
  const ov = document.createElement('div'); ov.className = 'sheetOverlay'; ov.id = 'sheetOverlay';
  ov.innerHTML = installPromptHtml(kind);
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target === ov) closeSheet(); });
  const later = ov.querySelector('#installPromptLater'), ok = ov.querySelector('#installPromptOk');
  if(later) later.onclick = () => closeSheet();
  if(ok) ok.onclick = async () => {
    closeSheet();
    if(kind === 'native' && S.deferredInstallPrompt){
      const ev = S.deferredInstallPrompt;
      try{ ev.prompt(); const c = await ev.userChoice; if(c && c.outcome !== 'accepted') return; }catch(e){ return; }
      S.deferredInstallPrompt = null;
    }
    writeState({ ...readState(), done: true });
  };
  if(ok && ok.focus) ok.focus();
  return true;
}

// Called when the app is ready (app.js). Waits a moment, checks again, and shows the sheet at most once per page load.
export function maybeShowInstallPrompt(delayMs = SHOW_DELAY_MS){
  if(scheduled || blockedReason()) return false;
  scheduled = true;
  setTimeout(() => { if(!showInstallPrompt()) scheduled = false; }, delayMs);
  return true;
}
