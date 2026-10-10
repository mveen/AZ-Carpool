// ui-contact.js — "tap a name, contact that person" (design system v2). Every driver and coordinator name in the app is a
// button with data-contact="<familyId>"; one click handler opens a sheet with WhatsApp and Bellen. Names are never links
// straight to WhatsApp any more, so a mis-tap cannot start a chat.
import { t } from './i18n.js';
import { S } from './state.js';
import { esc, phIcon, closeSheet } from './ui-common.js';
import { fam } from './rides.js';
import { normalizePhone } from './coordinator.js';

// "Sanne de Vries" -> "SV" (same rule as the avatar in the header).
function initials(name){ const p = String(name||'').trim().split(/\s+/).filter(Boolean); return p.length ? (p[0][0] + (p.length>1 ? p[p.length-1][0] : '')).toUpperCase() : ''; }

// wa.me wants the number in international format, digits only: 06-12345678 -> 31612345678.
export function waPhone(p){
  let d = normalizePhone(p);             // Dutch numbers normalised to 06…
  if(!d) return '';
  if(d.startsWith('00')) return d.slice(2);  // other international numbers: 0044… -> 44…
  if(d.startsWith('0')) return '31'+d.slice(1);
  return d;
}

// "06 12 34 56 78" for display; anything that is not a plain Dutch mobile number is shown as typed.
export function phoneText(p){
  const d = normalizePhone(p);
  return /^06\d{8}$/.test(d) ? d.replace(/^(06)(\d\d)(\d\d)(\d\d)(\d\d)$/, '$1 $2 $3 $4 $5') : String(p || '').trim();
}

// A name as a button that opens the contact sheet. `askText` (optional) is put in the WhatsApp message.
export function contactButtonHtml(familyId, nameHtml, askText, cls){
  return `<button type="button" class="${cls || 'nameLink'}" data-contact="${esc(familyId)}"${askText ? ` data-contact-text="${esc(askText)}"` : ''}>${nameHtml}</button>`;
}

export function openContactSheet(familyId, askText){
  const f = fam(familyId);
  closeSheet();
  const num = waPhone(f.parentPhone1);
  const tel = normalizePhone(f.parentPhone1);
  const sub = [f.girlName ? t('contact.parent_of', { name: f.girlName }) : t('common.ouder'), phoneText(f.parentPhone1)].filter(Boolean).join(' · ');
  const href = num ? 'https://wa.me/' + num + (askText ? '?text=' + encodeURIComponent(askText) : '') : '';
  const buttons = num
    ? `<div class="sheet__actions">
        <a class="btn" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${phIcon('whatsapp-logo-fill')}${esc(t('contact.whatsapp'))}</a>
        <a class="btn secondary" href="tel:${esc(tel)}">${phIcon('phone-fill')}${esc(t('contact.call'))}</a>
      </div>`
    : `<p class="sheet__sub">${esc(t('contact.no_phone'))}</p>`;
  const ov = document.createElement('div'); ov.className = 'sheetOverlay'; ov.id = 'sheetOverlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="sheet__handle"></div>
    <div class="settingsHead contactHead"><span class="settingsAvatar contactAvatar">${esc(initials(f.parentName) || '?')}</span>
      <div><h3 id="sheetTitle">${esc(f.parentName || '?')}</h3><p class="sheet__sub">${esc(sub)}</p></div></div>
    ${buttons}
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target === ov) closeSheet(); });
  const first = ov.querySelector('a.btn'); if(first && first.focus) first.focus();
}

// Called once at start-up: one handler for every [data-contact] button in the app.
export function initContact(){
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest ? e.target.closest('[data-contact]') : null;
    if(b && S.families && S.families[b.dataset.contact]) openContactSheet(b.dataset.contact, b.dataset.contactText || '');
  });
}
