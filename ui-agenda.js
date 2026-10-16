// ui-agenda.js — Instellingen > Agenda: the two calendar links of a family (the next 3 weeks of rides, read only):
//   - the rides the family DRIVES (for the parents), secret in driverCalendarTokens/<familyId>
//   - the rides the daughter sits in (to share with her), secret in calendarTokens/<familyId>
// A link is https://azcarpool.nl/agenda/<secret>.ics. Each secret is made here, once per family, and stored (readable by that family and the coordinator only). The file itself is made on the server by cron/agenda.mjs.
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

// Android has no app that opens webcal:// links, so the button does nothing there. On Android the button opens Google Agenda's own
// "add by link" page instead (it subscribes to the same file); the copied link and the text below work for any other calendar app.
export const googleSubscribeUrl = token => 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcalUrl(token));
export const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
// iPhone and iPad (an iPad can report itself as a Mac, but then it has a touch screen). On these the webcal:// button made Apple Agenda
// warn "De verbinding is niet veilig" and then fail, so they get the same Google Agenda button as Android.
export const isIos = () => typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/i.test(navigator.userAgent || '') || (/Macintosh/i.test(navigator.userAgent || '') && (navigator.maxTouchPoints || 0) > 1));
const useGoogleButton = () => isAndroid() || isIos();

const validToken = x => typeof x === 'string' && TOKEN_RE.test(x);

// The inside of the Agenda sheet, for the family whose links they are: two blocks. "Mijn agenda" holds the rides the family drives (for the
// parents), "Agenda van {daughter}" the rides she sits in (to share with her).
// S.calendarLink = { familyId, token (daughter), driverToken (parents), status: 'loading' | 'ready' | 'error' }. The sheet has its own title.
export const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

export function agendaCardInnerHtml(familyId) {
  const link = S.calendarLink && S.calendarLink.familyId === familyId ? S.calendarLink : null;
  if (!link || link.status === 'loading') return `<div class="panel__sub">${t('agenda.laden')}</div>`;
  if (link.status === 'error' || !validToken(link.token) || !validToken(link.driverToken)) return `<div class="panel__sub">${t('agenda.laden_mislukt')}</div>`;
  const name = plainGirlName(familyId);
  return `
    <div class="panel__sub">${t('agenda.kaart_uitleg')}</div>
    <div class="panel agendaBlock">
      <div class="panel__title">${esc(t('agenda.rijden_titel'))}</div>
      <div class="panel__sub">${esc(t('agenda.rijden_uitleg'))}</div>
      <div class="formActions">
        ${useGoogleButton()
          ? `<a class="btn" id="agendaAddDriver" href="${esc(googleSubscribeUrl(link.driverToken))}" target="_blank" rel="noopener">${t('agenda.toevoegen_google')}</a>`
          : `<a class="btn" id="agendaAddDriver" href="${esc(webcalUrl(link.driverToken))}">${t('agenda.toevoegen')}</a>`}
        <button type="button" class="btn secondary" id="agendaCopyDriver">${t('agenda.kopieer')}</button>
      </div>
    </div>
    <div class="panel agendaBlock">
      <div class="panel__title">${esc(t('agenda.dochter_titel', { name }))}</div>
      <div class="panel__sub">${esc(t('agenda.dochter_uitleg', { name }))}</div>
      <div class="formActions">
        ${canShare() ? `<button type="button" class="btn" id="agendaShare">${esc(t('agenda.delen', { name }))}</button>` : ''}
        <button type="button" class="btn secondary" id="agendaCopy">${t('agenda.kopieer')}</button>
      </div>
    </div>
    <p class="muted">${t(isAndroid() ? 'agenda.android_uitleg' : isIos() ? 'agenda.ios_uitleg' : 'agenda.google_uitleg')}</p>
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
  const copyOf = key => async () => {
    const link = S.calendarLink;
    if (!link || !validToken(link[key])) return;
    try { await navigator.clipboard.writeText(calendarUrl(link[key])); showToast(t('agenda.gekopieerd')); }
    catch (e) { showToast(t('agenda.kopieer_mislukt')); }
  };
  const copyGirl = document.getElementById('agendaCopy'), copyDriver = document.getElementById('agendaCopyDriver'), share = document.getElementById('agendaShare');
  if (copyGirl) copyGirl.onclick = copyOf('token');
  if (copyDriver) copyDriver.onclick = copyOf('driverToken');
  if (share) share.onclick = async () => {
    const link = S.calendarLink;
    if (!link || !validToken(link.token)) return;
    const name = plainGirlName(link.familyId);
    try { await navigator.share({ title: t('agenda.kalendernaam', { name }), text: t('agenda.deel_tekst', { name }), url: calendarUrl(link.token) }); }
    catch (e) { /* the sheet was closed, or sharing is not possible: nothing to say, the copy button is right there */ }
  };
}

function redrawAgendaCard() {
  const el = document.getElementById('agendaCard');
  const id = ownFamilyId();
  if (!el || !id) return;
  el.innerHTML = agendaCardInnerHtml(id);
  wireAgendaCard();
}

// Reads the family's two secrets (daughter and parents), or makes what is missing the first time. Runs once per family per session (again after an error).
export async function loadCalendarLink() {
  const familyId = ownFamilyId();
  if (!db || !familyId) return;
  const cur = S.calendarLink;
  if (cur && cur.familyId === familyId && cur.status !== 'error') return;
  S.calendarLink = { familyId, token: '', driverToken: '', status: 'loading' };
  const getOrMake = async path => {
    const ref = db.doc(path + '/' + familyId);
    const read = async () => { const snap = await ref.get(); const d = snap.exists && snap.data(); return d && validToken(d.token) ? d.token : ''; };
    let token = await read();
    if (!token) {
      try { await ref.set({ token: newCalendarToken(), createdAt: Date.now() }); }
      catch (e) { /* another device of this family was a moment earlier: the rules do not allow a second one, so read theirs */ }
      token = await read();
    }
    return token;
  };
  try {
    const [token, driverToken] = [await getOrMake('calendarTokens'), await getOrMake('driverCalendarTokens')];
    S.calendarLink = { familyId, token, driverToken, status: token && driverToken ? 'ready' : 'error' };
  } catch (e) { S.calendarLink = { familyId, token: '', driverToken: '', status: 'error' }; }
  redrawAgendaCard();
}
