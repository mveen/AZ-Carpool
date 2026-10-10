// ui-notice.js — the "melding voor iedereen": the thin yellow bar at the top of the app (everyone) and the card in Beheer (coordinator).
// Logic (what is valid, when it is visible) lives in notice.js. Stored in settings/notice; Firestore rules: members read, coordinator writes.
import { t } from './i18n.js';
import { S } from './state.js';
import { db } from './data.js';
import { esc, hapticTap, phIcon, showToast } from './ui-common.js';
import { renderBeheer } from './ui-beheer.js';
import { NOTICE_MAX, cleanNoticeText, noticeActive, noticeDoc, normalizeNotice, validateNotice } from './notice.js';

// ---------- the bar (everyone) ----------
// Redrawn on every data change, every minute and when the app comes back to the front (app.js), so a notice with an end moment
// disappears by itself without a reload.
export function renderNoticeBanner(){
  const el = document.getElementById('noticeBanner');
  if(!el) return;
  if(noticeActive(S.notice, Date.now())){
    const n = normalizeNotice(S.notice);
    el.style.display = 'flex';
    el.setAttribute('role', 'status');
    el.innerHTML = `${phIcon('info', { size:'14px' })}<span>${esc(n.text)}</span>`;
  } else {
    el.style.display = 'none'; el.innerHTML = ''; el.removeAttribute('role');
  }
}

// ---------- the card in Beheer (coordinator) ----------
export function noticeCardHtml(){
  const v = S.noticeDraft ? { ...S.noticeDraft } : normalizeNotice(S.notice);
  const text = String(v.text || '');
  const now = Date.now();
  const live = noticeActive(S.notice, now);
  const status = live
    ? `<span class="noticeChip ok">${t('notice.status.on')}</span>`
    : (normalizeNotice(S.notice).on ? `<span class="noticeChip off">${t('notice.status.ended')}</span>` : `<span class="noticeChip off">${t('notice.status.off')}</span>`);
  return `<div class="card" id="noticeCard">
      <h2>${t('notice.title')}</h2>
      <p class="muted">${t('notice.intro')}</p>
      <label class="switchRow" for="noticeOn"><span>${t('notice.show')}</span>
        <input type="checkbox" role="switch" class="noticeInput switch" id="noticeOn"${v.on ? ' checked' : ''}></label>
      <label for="noticeText">${t('notice.text')}</label>
      <input type="text" class="noticeInput" id="noticeText" maxlength="${NOTICE_MAX}" autocomplete="off" value="${esc(text)}" placeholder="${esc(t('notice.placeholder'))}">
      <div class="muted noticeCount" id="noticeCount">${text.length} / ${NOTICE_MAX}</div>
      <label style="margin-top:10px">${t('notice.off.label')}</label>
      <div class="rowflex" style="gap:8px">
        <input type="date" class="noticeInput" id="noticeOffDate" aria-label="${esc(t('notice.off.date'))}" value="${esc(v.offDate || '')}">
        <input type="time" class="noticeInput" id="noticeOffTime" aria-label="${esc(t('notice.off.time'))}" value="${esc(v.offTime || '')}">
      </div>
      <p class="muted" style="margin-top:3px">${t('notice.off.hint')}</p>
      <label>${t('notice.preview')}</label>
      <div class="noticePreview" id="noticePreview">${noticePreviewHtml(text)}</div>
      <div class="rowflex" style="gap:8px;margin-top:10px;justify-content:space-between;align-items:center">${status}</div>
      <button type="button" class="btn" id="noticeSave" style="width:100%">${t('notice.save')}</button>
    </div>`;
}

function noticePreviewHtml(text){
  return text
    ? `<div class="noticeBar" style="display:flex">${phIcon('megaphone-fill', { size:'14px' })}<span>${esc(text)}</span></div>`
    : `<div class="muted" style="padding:6px 12px;font-size:12px">${t('notice.preview.empty')}</div>`;
}

export function readNoticeForm(){
  const f = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const on = document.getElementById('noticeOn');
  return { on: !!(on && on.checked), text: f('noticeText'), offDate: f('noticeOffDate'), offTime: f('noticeOffTime') };
}

// Keeps what is typed while other parts of Beheer redraw (same idea as the period form).
export function rememberNoticeDraft(){
  S.noticeDraft = readNoticeForm();
  const c = document.getElementById('noticeCount'); if(c) c.textContent = `${String(S.noticeDraft.text).length} / ${NOTICE_MAX}`;
  const p = document.getElementById('noticePreview'); if(p) p.innerHTML = noticePreviewHtml(cleanNoticeText(S.noticeDraft.text));
}

export async function saveNotice(){
  if(!db){ showToast(t('data.geen_verbinding_met_opslag')); return false; }
  const now = Date.now();
  const res = validateNotice(readNoticeForm(), now);
  if(!res.ok){ S.noticeDraft = readNoticeForm(); showToast(t(res.errors[0])); return false; }
  try{
    await db.doc('settings/notice').set(noticeDoc(res.value, now));
    S.notice = res.value; S.noticeDraft = null;
    showToast(t(res.value.on ? 'notice.saved.on' : 'notice.saved.off'));
    renderNoticeBanner(); renderBeheer();
    return true;
  }catch(e){ showToast(t('data.mislukt') + (e && e.message || e)); return false; }
}

export function wireNoticeCard(){
  document.querySelectorAll('.noticeInput').forEach(el => { el.oninput = rememberNoticeDraft; el.onchange = rememberNoticeDraft; });
  const save = document.getElementById('noticeSave'); if(save) save.onclick = () => { hapticTap(); return saveNotice(); };
}
