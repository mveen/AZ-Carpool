// ui-maintenance.js — onderhoudsmodus: the full-screen page every user except the coordinator sees (#maintenanceOverlay),
// the thin bar the coordinator sees as a reminder (#maintenanceBanner) and the card in Beheer.
// Logic lives in maintenance.js. Stored in settings/maintenance; Firestore rules: members read, coordinator writes.
import { t } from './i18n.js';
import { S } from './state.js';
import { db } from './data.js';
import { isRealCoordinator } from './coordinator.js';
import { esc, hapticTap, phIcon, showToast } from './ui-common.js';
import { renderBeheer } from './ui-beheer.js';
import { MAINTENANCE_MAX, cleanMaintenanceText, maintenanceBlocks, maintenanceDoc, normalizeMaintenance } from './maintenance.js';

// The only brand mark of the design system is the app icon.
const LOGO_SVG = `<img src="./icon.svg" alt="" width="96" height="96">`;

// The parts of the app that are switched off for screen readers and the keyboard while the page covers them.
const COVERED = ['topbar', 'bottomnav'];

// The page itself. Also used (smaller) as the preview in the Beheer card.
export function maintenancePageHtml(text){
  const extra = cleanMaintenanceText(text);
  return `<div class="maintCard">
      <div class="maintLogo">${LOGO_SVG}</div>
      <h1 class="maintTitle">${esc(t('maint.page.title'))}</h1>
      <p class="maintText">${esc(extra || t('maint.page.default'))}</p>
      <p class="maintAuto">${esc(t('maint.page.auto'))}</p>
    </div>`;
}

// ---------- the page (everyone but the coordinator) and the reminder bar (coordinator) ----------
// Redrawn on every data change (data.js), so the page appears and disappears live, without a reload.
export function renderMaintenance(){
  const m = normalizeMaintenance(S.maintenance);
  const coord = isRealCoordinator();
  const blocked = maintenanceBlocks(m, coord);

  const ov = document.getElementById('maintenanceOverlay');
  if(ov){
    if(blocked){
      ov.style.display = 'flex'; ov.setAttribute('role', 'alert');
      const html = maintenancePageHtml(m.text);
      if(ov.innerHTML !== html) ov.innerHTML = html;
    } else { ov.style.display = 'none'; ov.innerHTML = ''; ov.removeAttribute('role'); }
  }
  COVERED.forEach(id => {
    const el = document.getElementById(id); if(!el) return;
    if(blocked) el.setAttribute('inert', ''); else el.removeAttribute('inert');
  });
  const main = document.querySelector('main');
  if(main){ if(blocked) main.setAttribute('inert', ''); else main.removeAttribute('inert'); }

  const bar = document.getElementById('maintenanceBanner');
  if(bar){
    if(m.on && coord){
      bar.style.display = 'flex'; bar.setAttribute('role', 'status');
      bar.innerHTML = `${phIcon('warning', { size:'14px' })}<span>${esc(t('maint.banner'))}</span>`;
    } else { bar.style.display = 'none'; bar.innerHTML = ''; bar.removeAttribute('role'); }
  }
  return blocked;
}

// ---------- the card in Beheer (coordinator) ----------
export function maintenanceCardHtml(){
  const v = S.maintenanceDraft ? { ...S.maintenanceDraft } : normalizeMaintenance(S.maintenance);
  const text = String(v.text || '');
  const live = normalizeMaintenance(S.maintenance).on;
  const status = live
    ? `<span class="noticeChip ok">${t('maint.status.on')}</span>`
    : `<span class="noticeChip off">${t('maint.status.off')}</span>`;
  return `<div class="card" id="maintenanceCard">
      <h2>${t('maint.title')}</h2>
      <p class="muted">${t('maint.intro')}</p>
      <p class="muted">${t('maint.autosave')}</p>
      <label class="switchRow" for="maintenanceOn"><span>${t('maint.show')}</span>
        <input type="checkbox" role="switch" class="maintenanceInput switch" id="maintenanceOn"${v.on ? ' checked' : ''}></label>
      <label for="maintenanceText">${t('maint.text')}</label>
      <input type="text" class="maintenanceInput" id="maintenanceText" maxlength="${MAINTENANCE_MAX}" autocomplete="off" value="${esc(text)}" placeholder="${esc(t('maint.placeholder'))}">
      <div class="muted noticeCount" id="maintenanceCount">${text.length} / ${MAINTENANCE_MAX}</div>
      <label>${t('maint.preview')}</label>
      <div class="noticePreview maintPreview" id="maintenancePreview">${maintenancePageHtml(text)}</div>
      <div class="rowflex" style="gap:8px;margin-top:10px;justify-content:space-between;align-items:center">${status}</div>
    </div>`;
}

export function readMaintenanceForm(){
  const f = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const on = document.getElementById('maintenanceOn');
  return { on: !!(on && on.checked), text: f('maintenanceText') };
}

// Keeps what is typed while other parts of Beheer redraw (same idea as the notice card).
export function rememberMaintenanceDraft(){
  S.maintenanceDraft = readMaintenanceForm();
  const c = document.getElementById('maintenanceCount'); if(c) c.textContent = `${String(S.maintenanceDraft.text).length} / ${MAINTENANCE_MAX}`;
  const p = document.getElementById('maintenancePreview'); if(p) p.innerHTML = maintenancePageHtml(S.maintenanceDraft.text);
}

export async function saveMaintenance(){
  if(!db){ showToast(t('data.geen_verbinding_met_opslag')); return false; }
  if(!isRealCoordinator()){ showToast(t('maint.err.coordinatorOnly')); return false; }
  const now = Date.now();
  const value = normalizeMaintenance(readMaintenanceForm());
  try{
    await db.doc('settings/maintenance').set(maintenanceDoc(value, now));
    S.maintenance = value; S.maintenanceDraft = null;
    showToast(t(value.on ? 'maint.saved.on' : 'maint.saved.off'));
    renderMaintenance(); renderBeheer();
    return true;
  }catch(e){
    // Not saved: drop what was typed, so the switch goes back to what is really stored.
    S.maintenanceDraft = null; renderBeheer();
    showToast(t('data.mislukt') + (e && e.message || e)); return false;
  }
}

// No save button: the switch saves at once, the text saves when the field is left (change). Typing only updates the preview.
export function wireMaintenanceCard(){
  document.querySelectorAll('.maintenanceInput').forEach(el => {
    el.oninput = rememberMaintenanceDraft;
    el.onchange = () => { hapticTap(); rememberMaintenanceDraft(); return saveMaintenance(); };
  });
}
