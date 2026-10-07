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

// The app logo (the car of the header), drawn in one colour (currentColor, red via .maintLogo) without the red button behind it.
const LOGO_SVG = `<svg viewBox="14 192 430 176" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="22" stroke-linecap="round"><path d="M44 252 H80"/><path d="M28 286 H80"/><path d="M52 320 H78"/></g><g fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"><path d="M124 322 Q112 322 112 310 V232 Q112 206 138 206 H290 Q302 206 310 214 L352 254 L404 262 Q430 266 430 290 V310 Q430 322 418 322 H410"/><path d="M234 322 H298"/></g><path d="M134 226 H212 V268 H134 Z M226 226 H288 Q294 226 298 230 L336 268 H226 Z" fill="currentColor" opacity=".35"/><g fill="currentColor"><circle cx="178" cy="242" r="12"/><path d="M168 236 C150 232 142 246 146 260 C150 252 158 250 168 250 Z"/><path d="M158 268 Q158 256 178 256 Q198 256 198 268 Z"/></g><rect x="404" y="276" width="18" height="10" rx="5" fill="#fbbf24"/><circle cx="179" cy="326" r="36" fill="currentColor"/><g transform="translate(179 326)"><polygon points="0,-15 14.3,-4.6 8.8,12.1 -8.8,12.1 -14.3,-4.6" fill="var(--bg)"/><g stroke="var(--bg)" stroke-width="4.5" stroke-linecap="round"><line x1="0" y1="-15" x2="0" y2="-34"/><line x1="14.3" y1="-4.6" x2="32.3" y2="-10.5"/><line x1="8.8" y1="12.1" x2="20" y2="27.5"/><line x1="-8.8" y1="12.1" x2="-20" y2="27.5"/><line x1="-14.3" y1="-4.6" x2="-32.3" y2="-10.5"/></g></g><circle cx="352" cy="326" r="36" fill="currentColor"/><circle cx="352" cy="326" r="13" fill="var(--bg)"/></svg>`;

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
      <label class="switchRow" for="maintenanceOn"><span>${t('maint.show')}</span>
        <input type="checkbox" role="switch" class="maintenanceInput switch" id="maintenanceOn"${v.on ? ' checked' : ''}></label>
      <label for="maintenanceText">${t('maint.text')}</label>
      <input type="text" class="maintenanceInput" id="maintenanceText" maxlength="${MAINTENANCE_MAX}" autocomplete="off" value="${esc(text)}" placeholder="${esc(t('maint.placeholder'))}">
      <div class="muted noticeCount" id="maintenanceCount">${text.length} / ${MAINTENANCE_MAX}</div>
      <label>${t('maint.preview')}</label>
      <div class="noticePreview maintPreview" id="maintenancePreview">${maintenancePageHtml(text)}</div>
      <div class="rowflex" style="gap:8px;margin-top:10px;justify-content:space-between;align-items:center">${status}</div>
      <button type="button" class="btn" id="maintenanceSave" style="width:100%">${t('maint.save')}</button>
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
  }catch(e){ showToast(t('data.mislukt') + (e && e.message || e)); return false; }
}

export function wireMaintenanceCard(){
  document.querySelectorAll('.maintenanceInput').forEach(el => { el.oninput = rememberMaintenanceDraft; el.onchange = rememberMaintenanceDraft; });
  const save = document.getElementById('maintenanceSave'); if(save) save.onclick = () => { hapticTap(); return saveMaintenance(); };
}
