// ui-agenda.js — Instellingen > Agenda: the link to the calendar of the family's daughter (the next 3 weeks of rides, read only).
// The link is https://azcarpool.nl/agenda/<secret>.ics. The secret is made here, once per family, and stored in calendarTokens/<familyId>
// (readable by that family and the coordinator only). The file itself is made on the server by cron/agenda.mjs.
// There is no "new link": the link stays the same, so a calendar that was set up once keeps working.
import { t } from './i18n.js';
import { S } from './state.js';
import { db } from './data.js';
import { APP_URL } from './constants.js';
import { esc, phIcon, showToast, closeSheet } from './ui-common.js';
import { fam, plainGirlName } from './rides.js';
import { myFamilyId } from './coordinator.js';
import { TOKEN_RE, newCalendarToken } from './calendar-feed.js';

export const calendarUrl = token => APP_URL + 'agenda/' + token + '.ics';
// webcal:// opens the calendar app on an iPhone, iPad and Mac directly; Google Agenda takes the https link (see the text on the card).
export const webcalUrl = token => calendarUrl(token).replace(/^https?:/, 'webcal:');

const validToken = x => typeof x === 'string' && TOKEN_RE.test(x);

// The inside of the Agenda sheet, for the family whose link it is. S.calendarLink = { familyId, token, status: 'loading' | 'ready' | 'error' }.
// The sheet has its own title, so the text starts straight away.
export function agendaCardInnerHtml(familyId) {
  const link = S.calendarLink && S.calendarLink.familyId === familyId ? S.calendarLink : null;
  const head = '';
  if (!link || link.status === 'loading') return `${head}<div class="panel__sub">${t('agenda.laden')}</div>`;
  if (link.status === 'error' || !validToken(link.token)) return `${head}<div class="panel__sub">${t('agenda.laden_mislukt')}</div>`;
  return `${head}
    <div class="panel__sub">${esc(t('agenda.kaart_uitleg', { name: plainGirlName(familyId) }))}</div>
    <div class="formActions">
      <a class="btn" id="agendaAdd" href="${esc(webcalUrl(link.token))}">${t('agenda.toevoegen')}</a>
      <button type="button" class="btn secondary" id="agendaCopy">${t('agenda.kopieer')}</button>
    </div>
    <p class="muted">${t('agenda.google_uitleg')}</p>
    <p class="muted">${t('agenda.bijwerken')}</p>
    <p class="muted">${t('agenda.geheim')}</p>`;
}

// The family whose link this browser may show: its own, as linked through the gate. Not the family the coordinator looks at in the test
// view (that link is theirs), and nobody for a coordinator without a family of their own.
function ownFamilyId() {
  if (S.impersonateFamilyId || !S.me || !(S.links[S.me] && S.links[S.me].familyId)) return '';
  return myFamilyId() || '';
}

// Does this browser have an agenda link to show? Decides whether the Agenda row appears in Instellingen.
export function hasAgenda() { return !!ownFamilyId(); }

// Instellingen > Agenda: a sheet with the card. The link is read (or made, the first time) when the sheet opens.
export function openAgendaSheet() {
  const id = ownFamilyId(); if (!id) return;
  closeSheet();
  const ov = document.createElement('div'); ov.className = 'sheetOverlay'; ov.id = 'sheetOverlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="sheet__handle"></div>
    <h3 id="sheetTitle">${esc(t('agenda.kaart_titel'))}</h3>
    <div id="agendaCard">${agendaCardInnerHtml(id)}</div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) closeSheet(); });
  wireAgendaCard();
  loadCalendarLink();
}

export function wireAgendaCard() {
  const copy = document.getElementById('agendaCopy');
  if (!copy) return;
  copy.onclick = async () => {
    const link = S.calendarLink;
    if (!link || !validToken(link.token)) return;
    try { await navigator.clipboard.writeText(calendarUrl(link.token)); showToast(t('agenda.gekopieerd')); }
    catch (e) { showToast(t('agenda.kopieer_mislukt')); }
  };
}

function redrawAgendaCard() {
  const el = document.getElementById('agendaCard');
  const id = ownFamilyId();
  if (!el || !id) return;
  el.innerHTML = agendaCardInnerHtml(id);
  wireAgendaCard();
}

// Reads the family's secret, or makes it the first time. Runs once per family per session (again after an error).
export async function loadCalendarLink() {
  const familyId = ownFamilyId();
  if (!db || !familyId) return;
  const cur = S.calendarLink;
  if (cur && cur.familyId === familyId && cur.status !== 'error') return;
  S.calendarLink = { familyId, token: '', status: 'loading' };
  const ref = db.doc('calendarTokens/' + familyId);
  const read = async () => { const snap = await ref.get(); const d = snap.exists && snap.data(); return d && validToken(d.token) ? d.token : ''; };
  try {
    let token = await read();
    if (!token) {
      try { await ref.set({ token: newCalendarToken(), createdAt: Date.now() }); }
      catch (e) { /* another device of this family was a moment earlier: the rules do not allow a second one, so read theirs */ }
      token = await read();
    }
    S.calendarLink = { familyId, token, status: token ? 'ready' : 'error' };
  } catch (e) { S.calendarLink = { familyId, token: '', status: 'error' }; }
  redrawAgendaCard();
}
