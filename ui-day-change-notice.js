// ui-day-change-notice.js — "Melding dagwijzigingen": the hint in the screen "Wijzigingen voor <dag>" (everyone who processes a day)
// and the card in Beheer (coordinator). Logic (when the hint shows) lives in day-change-notice.js.
// Stored in settings/dayChangeNotice; Firestore rules: members read, coordinator writes (the general settings rule).
import { t, locale } from './i18n.js';
import { S } from './state.js';
import { db } from './data.js';
import { esc, hapticTap, phIcon, showToast } from './ui-common.js';
import { renderBeheer } from './ui-beheer.js';
import { weekKeyDayIso } from './dates.js';
import { dayChangeNoticeDoc, dayChangeNoticeFor, normalizeDayChangeNotice, validateDayChangeNotice } from './day-change-notice.js';

// ---------- the hint (everyone who processes a day) ----------
// '' when it is not needed: switched off, or the time on the day before has passed.
export function dayChangeNoticeHtml(day, nowMs = Date.now()){
  const iso = weekKeyDayIso(S.currentWeekKey, day);
  const n = dayChangeNoticeFor(S.dayChangeNotice, iso, nowMs);
  if(!n) return '';
  const [y, m, d] = n.dayBeforeIso.split('-').map(Number);
  const when = n.isToday ? t('dayNotice.today') : new Date(y, m - 1, d).toLocaleDateString(locale(), { weekday: 'long' });
  return `<div class="infoNote infoNote--warn" id="dayChangeNotice" role="status">${phIcon('info')}<span>${esc(t('dayNotice.text', { p1: when }))}</span></div>`;
}

// ---------- the card in Beheer (coordinator) ----------
export function dayChangeNoticeCardHtml(){
  const v = S.dayChangeNoticeDraft ? { ...S.dayChangeNoticeDraft } : normalizeDayChangeNotice(S.dayChangeNotice);
  return `<div class="card" id="dayNoticeCard">
      <h2>${t('dayNotice.title')}</h2>
      <p class="muted">${t('dayNotice.intro')}</p>
      <label class="switchRow" for="dayNoticeOn"><span>${t('dayNotice.show')}</span>
        <input type="checkbox" role="switch" class="dayNoticeInput switch" id="dayNoticeOn"${v.on ? ' checked' : ''}></label>
      <label for="dayNoticeUntil">${t('dayNotice.until')}</label>
      <input type="time" class="dayNoticeInput" id="dayNoticeUntil" value="${esc(v.until || '')}">
      <button type="button" class="btn" id="dayNoticeSave">${t('dayNotice.save')}</button>
    </div>`;
}

export function readDayChangeNoticeForm(){
  const on = document.getElementById('dayNoticeOn'), until = document.getElementById('dayNoticeUntil');
  return { on: !!(on && on.checked), until: until ? until.value : '' };
}

// Keeps what is filled in while other parts of Beheer redraw (same idea as the notice card).
export function rememberDayChangeNoticeDraft(){ S.dayChangeNoticeDraft = readDayChangeNoticeForm(); }

export async function saveDayChangeNotice(){
  if(!db){ showToast(t('data.geen_verbinding_met_opslag')); return false; }
  const res = validateDayChangeNotice(readDayChangeNoticeForm());
  if(!res.ok){ S.dayChangeNoticeDraft = readDayChangeNoticeForm(); showToast(t(res.errors[0])); return false; }
  try{
    await db.doc('settings/dayChangeNotice').set(dayChangeNoticeDoc(res.value, Date.now()));
    S.dayChangeNotice = normalizeDayChangeNotice(res.value); S.dayChangeNoticeDraft = null;
    showToast(t(res.value.on ? 'dayNotice.saved.on' : 'dayNotice.saved.off'));
    renderBeheer();
    return true;
  }catch(e){ showToast(t('data.mislukt') + (e && e.message || e)); return false; }
}

export function wireDayChangeNoticeCard(){
  document.querySelectorAll('.dayNoticeInput').forEach(el => { el.oninput = rememberDayChangeNoticeDraft; el.onchange = rememberDayChangeNoticeDraft; });
  const save = document.getElementById('dayNoticeSave'); if(save) save.onclick = () => { hapticTap(); return saveDayChangeNotice(); };
}
