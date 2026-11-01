// ui-weekrooster-form.js — Afwijkend weekrooster, phase 2: what a parent (or a day coordinator for the own daughter) sees.
//   Wijzigen: the week form (same look as the period form), then the "Doorgegeven" card (days, what others notice, actions) and the day coordinators.
//   Mijn week: the button "Tijden wijzigen", the amber block of an open request in the card of its day, and next week's open requests as one block.
// Everything here only shows for a person who has a daughter of their own
// (not Flex). Rules and requests: weekrooster.js; database: weekrooster-data.js.
import { t } from './i18n.js';
import { S } from './state.js';
import { DAYS } from './constants.js';
import { dayUp, isoDayLabel, isoRangeLabel, weekKeyDayIso } from './dates.js';
import { esc, hapticTap, phIcon, showToast, twoStepConfirm } from './ui-common.js';
import { myFamilyId, myLinkedFamilyId } from './coordinator.js';
import { fam, girlName, isFlex, rideTime, setAskedTimeOf } from './rides.js';
import { renderDeviationTab } from './ui-deviation.js';
import { renderAll } from './app.js';
import { REQUEST_DAYS, requestId, requestState, weekFormFrom, openRequestsOf } from './weekrooster.js';
import { currentMarks, dayEndMs, deciderFamilyOf, isDayPast, standardTimes, submitWeekRequests, weekKeyFor, withdrawWeekRequests } from './weekrooster-data.js';

export const dayName = day => (DAYS.find(([k]) => k === day) || [day, day])[1];
export const lower = s => String(s || '').toLowerCase();
export const upperFirst = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const weekNumber = weekKey => +String(weekKey).split('-W')[1];

// ---------- who sees it ----------
// The Wijzigen / Mijn week parts of the Afwijkend weekrooster: a family of their own (also in Testweergave), and not Flex.
export function weekroosterActive() {
  if (!myLinkedFamilyId()) return false;
  return !isFlex(fam(myFamilyId()));
}

// ---------- reading what is handed in ----------
const which = () => (S.wrWeek === 'next' ? 'next' : 'this');
function mine(w) {
  const wk = weekKeyFor(w);
  return openRequestsOf(S.weekRequests, wk, myFamilyId(), Date.now(), day => dayEndMs(wk, day));
}
export const deciderName = day => { const id = deciderFamilyOf(day); return id ? (fam(id).parentName || '') : ''; };
export const deciderLabel = day => deciderName(day) || t('weekrooster.decider.unknown');

// One short text for a handed-in day: "Heen 16:30 · Terug 17:45" or "Rijdt niet mee".
export function summaryOf(r) {
  if (r.rides === false) return t('weekrooster.done.out');
  return [r.heen ? t('weekrooster.done.heen', { p1: r.heen }) : '', r.terug ? t('weekrooster.done.terug', { p1: r.terug }) : ''].filter(Boolean).join(' · ');
}

// ---------- the form ----------
// What the form opens from (this week: the marks per shift and the requests; next week: the requests). When it changes under a form nobody has
// typed in yet (a toggle in Mijn week, another phone), that form is rebuilt; a form that is being filled in is never replaced.
const sourceOf = w => { const fid = myFamilyId(), wk = weekKeyFor(w); return JSON.stringify([w === 'this' ? currentMarks(fid) : null, REQUEST_DAYS.map(d => S.weekRequests[requestId(wk, d, fid)] || null)]); };
function formFor(w) {
  const sig = sourceOf(w);
  if (!S.wrForm || S.wrForm.which !== w || (!S.wrForm.touched && S.wrForm.sig !== sig)) {
    const wk = weekKeyFor(w), fid = myFamilyId();
    // This week the marks per shift (what Mijn week shows) are the truth; next week has no marks yet, there the requests are all there is.
    S.wrForm = { which: w, sig, touched: false, days: weekFormFrom({ weekKey: wk, familyId: fid, standard: standardTimes(fid, w), requests: S.weekRequests, marks: w === 'this' ? currentMarks(fid) : undefined }) };
  }
  return S.wrForm;
}
// One ride (heen or terug) of a day is "on" while the day rides and it has a time (or was just switched on and waits for one).
const isOn = (d, dir) => d.rides !== false && ((d[dir] || '') !== '' || !!(d.want && d.want[dir]));
const sameAsStandard = (d, std) => d.rides !== false && (d.heen || '') === (std.heen || '') && (d.terug || '') === (std.terug || '');

// ---------- Tijden wijzigen: its own screen over Mijn week (no tab bar behind it), like the Advies flow ----------
// S.wrFlow: false = closed, true = open, 'confirm' = open with the question "Wijzigingen weggooien?" (closing a form that was typed in).
function weekSegmentHtml() {
  const w = which();
  return `<div class="segmented" role="group" aria-label="${esc(t('weekrooster.seg.aria'))}">
    <button type="button" class="${w === 'this' ? 'active' : ''}" data-wrweek="this" aria-pressed="${w === 'this'}">${t('weekrooster.seg.this')}</button>
    <button type="button" class="${w === 'next' ? 'active' : ''}" data-wrweek="next" aria-pressed="${w === 'next'}">${t('weekrooster.seg.next')}</button>
  </div>`;
}

// "was 09:00" under a time that differs from the fixed rooster ('' when it is the same). An empty standard says "rijdt niet mee".
function wasText(d, std, dir) {
  const now = isOn(d, dir) ? (d[dir] || '') : '', was = std[dir] || '';
  if (d.rides !== false && now === was) return '';
  if (!isOn(d, dir) && !was) return '';
  return was ? t('weekrooster.flow.was', { p1: was }) : t('weekrooster.flow.wasOff');
}
const changedDays = (f, std, wk) => REQUEST_DAYS.filter(day => !isDayPast(wk, day) && !sameAsStandard(f.days[day], std[day]));
const changedNote = n => n === 0 ? t('weekrooster.flow.noteNone') : n === 1 ? t('weekrooster.flow.noteOne') : t('weekrooster.flow.noteMany', { p1: n });

function dayCardHtml(w, day, f, std, wk) {
  const d = f.days[day], past = isDayPast(wk, day), iso = weekKeyDayIso(wk, day);
  const changed = !past && !sameAsStandard(d, std[day]);
  const cell = (dir, label) => {
    const on = isOn(d, dir), name = t(dir === 'heen' ? 'dir.heenShort' : 'dir.terugShort');
    const field = on
      ? `<input type="time" class="periodTime wrTime${(d[dir] || '') !== (std[day][dir] || '') ? ' changed' : ''}" id="${dir === 'heen' ? 'wrHeen_' : 'wrTerug_'}${day}" value="${esc(d[dir] || '')}" aria-label="${esc(label)} ${esc(dayName(day))}">`
      : `<div class="wrCell__off">${t('weekrooster.form.notRiding')}</div>`;
    return `<div><div class="wrCell">
        <button type="button" class="switch switch--sm${on ? ' on' : ''}" role="switch" aria-checked="${on}" aria-label="${esc(t('ov.switchLabel', { p1: name, p2: dayName(day) }))}" data-wrtoggle="${day}" data-wrdir="${dir}"><span class="switch__track"><span class="switch__knob">${phIcon(on ? 'car-profile-bold' : 'x-bold')}</span></span></button>
        ${field}
      </div><div class="wrCell__was" data-wrwas="${day}|${dir}">${esc(wasText(d, std[day], dir))}</div></div>`;
  };
  const body = past
    ? `<p class="wrDay__past">${t('weekrooster.form.past')}</p>`
    : `<div class="wrDay__cells">${cell('heen', t('weekrooster.form.heenAria'))}${cell('terug', t('weekrooster.form.terugAria'))}</div>`;
  return `<div class="wrDay${changed ? ' wrDay--changed' : ''}${past ? ' wrDay--past wrPastDay' : ''}" data-wrday="${day}">
      <div class="wrDay__head"><span class="wrDay__name">${esc(dayUp(day))}<small>${esc(isoDayLabel(iso, ''))}</small></span><span class="tag tag--warn" data-wrtag="${day}"${changed ? '' : ' hidden'}>${t('weekrooster.flow.changed')}</span></div>
      ${body}
    </div>`;
}

export function wrFlowHtml() {
  const w = which(), f = formFor(w), wk = weekKeyFor(w), std = standardTimes(myFamilyId(), w);
  const n = changedDays(f, std, wk).length;
  const head = `<div class="flowHead"><button type="button" class="roundBtn" id="wrFlowClose" aria-label="${esc(t('weekrooster.flow.close'))}">${phIcon('x')}</button>
    <div class="flowHead__text"><div class="flowHead__ctx">${esc(t('weekrooster.flow.ctx', { p1: weekNumber(wk) }))}</div><h1 class="flowHead__title" id="flowTitle">${esc(t('weekrooster.flow.title'))}</h1></div></div>`;
  const body = `${weekSegmentHtml()}
    <p class="wrFlow__intro">${esc(t('weekrooster.flow.intro', { p1: girlName(myFamilyId()) }))}</p>
    <div class="wrFlow__cols"><span>${t('weekrooster.flow.colHeen')}</span><span>${t('weekrooster.flow.colTerug')}</span></div>
    ${REQUEST_DAYS.map(day => dayCardHtml(w, day, f, std, wk)).join('')}`;
  const foot = S.wrFlow === 'confirm'
    ? `<p class="flowScreen__note">${esc(t('weekrooster.flow.discardAsk'))}</p>
       <button type="button" class="btn" id="wrKeep">${t('weekrooster.flow.keep')}</button>
       <button type="button" class="linkbtn danger" id="wrDiscard">${t('weekrooster.flow.discard')}</button>`
    : `<button type="button" class="btn" id="wrSubmit">${t('weekrooster.form.submit')}</button>
       <p class="flowScreen__note" id="wrNote">${esc(changedNote(n))}</p>`;
  return `<div class="flowScreen__panel" id="wrFlowPanel">${head}<div class="flowScreen__body">${body}</div><div class="flowScreen__foot">${foot}</div></div>`;
}

// Draws (or removes) the layer. Called when it opens and after every change of the form, and from renderDeviationTab so that live data keeps it fresh.
export function renderWrFlow() {
  let el = document.getElementById('wrFlowScreen');
  if (!S.wrFlow || !weekroosterActive()) {
    if (el && el.remove) el.remove();
    if (document.body.classList && !document.getElementById('flowScreen')) document.body.classList.remove('flowOpen');
    return;
  }
  if (holdFormRedraw()) return;
  if (!el || !el.parentNode) {
    el = document.createElement('div'); el.id = 'wrFlowScreen'; el.className = 'flowScreen wrFlow';
    if (el.setAttribute) { el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'flowTitle'); }
    el.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.getElementById('sheetOverlay')) requestCloseWrFlow(); });
    document.body.appendChild(el);
  }
  const body = el.querySelector && el.querySelector('.flowScreen__body'), keep = body ? body.scrollTop : 0;
  el.innerHTML = wrFlowHtml();
  const nb = el.querySelector && el.querySelector('.flowScreen__body'); if (nb) nb.scrollTop = keep;
  if (document.body.classList) document.body.classList.add('flowOpen');
  wireWeekrooster(el);
}
export function openWrFlow(w) {
  S.wrWeek = w === 'next' ? 'next' : 'this'; S.wrForm = null; S.wrFlow = true;
  formFor(which());
  renderWrFlow();
}
export function closeWrFlow() { S.wrFlow = false; S.wrForm = null; renderWrFlow(); }
// X / Escape: a form nobody typed in closes at once; a typed-in form asks first.
export function requestCloseWrFlow() {
  if (S.wrForm && S.wrForm.touched) { S.wrFlow = 'confirm'; renderWrFlow(); return; }
  closeWrFlow();
}
// Every redraw of the form goes through here: the flow when it is open (the form lives nowhere else now).
const redrawForm = () => { if (S.wrFlow) renderWrFlow(); else renderDeviationTab(); };

// ---------- the form: reading, amber, handing in ----------
function readForm() {
  const f = S.wrForm; if (!f) return;
  REQUEST_DAYS.forEach(day => {
    ['heen', 'terug'].forEach(dir => {
      const el = document.getElementById((dir === 'heen' ? 'wrHeen_' : 'wrTerug_') + day);
      if (el && !el.disabled) f.days[day][dir] = el.value || '';
    });
  });
}
// What is typed shows at once (border and tag of the day, "was …", the note under Doorgeven), without redrawing the form (a redraw would take the focus away).
function markChanged() {
  const f = S.wrForm; if (!f) return;
  const std = standardTimes(myFamilyId(), f.which), wk = weekKeyFor(f.which);
  REQUEST_DAYS.forEach(day => {
    const changed = !isDayPast(wk, day) && !sameAsStandard(f.days[day], std[day]);
    const row = document.querySelector && document.querySelector(`[data-wrday="${day}"]`);
    if (row && row.classList) row.classList.toggle('wrDay--changed', changed);
    const tag = document.querySelector && document.querySelector(`[data-wrtag="${day}"]`); if (tag) tag.hidden = !changed;
    ['heen', 'terug'].forEach(dir => {
      const el = document.getElementById((dir === 'heen' ? 'wrHeen_' : 'wrTerug_') + day);
      if (el && el.classList) el.classList.toggle('changed', (f.days[day][dir] || '') !== (std[day][dir] || ''));
      const was = document.querySelector && document.querySelector(`[data-wrwas="${day}|${dir}"]`); if (was) was.textContent = wasText(f.days[day], std[day], dir);
    });
  });
  const note = document.getElementById('wrNote'); if (note) note.textContent = changedNote(changedDays(f, std, wk).length);
}

// A switch of one ride: off empties the time (what an emptied time always meant: "rijdt niet mee" on that ride) and remembers it, on brings it back.
// Both rides off = the whole day off. Nothing new is stored: the form hands in the same fields as before.
export function toggleRide(day, dir) {
  const f = S.wrForm; if (!f || !f.days[day]) return;
  readForm();
  const d = f.days[day], std = standardTimes(myFamilyId(), f.which)[day] || {}, other = dir === 'heen' ? 'terug' : 'heen';
  f.touched = true;
  d.keep = d.keep || {}; d.want = d.want || {};
  if (isOn(d, dir)) {
    d.keep[dir] = d[dir] || ''; d[dir] = ''; d.want[dir] = false;
    if (!isOn(d, other)) d.rides = false;
  } else {
    if (d.rides === false) { d.keep[other] = d[other] || ''; d[other] = ''; d.want[other] = false; }   // a day that was off comes back with only this ride
    d.rides = true; d[dir] = d.keep[dir] || std[dir] || ''; d.want[dir] = true;
  }
  const needsTime = !d[dir];
  redrawForm();
  const el = needsTime && document.getElementById((dir === 'heen' ? 'wrHeen_' : 'wrTerug_') + day);
  if (el && el.focus) el.focus();
}

export async function submitWeekForm() {
  const f = S.wrForm; if (!f) return false;
  readForm();
  const w = f.which;
  const res = await submitWeekRequests(w, f.days);
  if (res.ok) {
    S.wrForm = null; S.wrFlow = false; renderWrFlow();
    afterSubmit(w, res.written.map(d => d.day));
    return true;
  }
  if (res.error || S.wrBusy) return false;   // a refused save has shown its own message; do not say "nothing changed" on top of it
  if (res.skipped.some(s => s.why === 'time')) showToast(t('weekrooster.form.timeNeeded'));
  else if (!res.skipped.length || res.skipped.every(s => s.why === 'same' || s.why === 'past' || s.why === 'unchanged')) showToast(t('weekrooster.form.nothing'));
  return false;
}
// After Doorgeven: back on Mijn week, with a toast. "Ongedaan" takes back the requests that wait for a day coordinator (a request that was
// accepted at once, because the family decides itself, has nothing to take back: the toast then has no button).
function afterSubmit(w, days) {
  renderAll();
  const wk = weekKeyFor(w), fid = myFamilyId();
  const waiting = days.filter(day => { const r = S.weekRequests[requestId(wk, day, fid)]; return r && r.status === 'pending'; });
  if (!waiting.length) { showToast(t('weekrooster.flow.sentDirect')); return; }
  showToast(t('weekrooster.flow.sent'), { action: { label: t('deviation.ongedaan'), run: async () => {
    let ok = false;
    for (const day of waiting) ok = (await withdrawWeekRequests(w, day)) || ok;
    if (ok) { showToast(t('weekrooster.done.withdrawn')); renderAll(); }
  } } });
}

// While a time field of the form (or a time list of Ritbeurs: class rbSel) has the focus (on a phone: the picker or list is open) the form must not be redrawn: the live data (any change in the
// database draws Wijzigen again) would replace the field, the picker closes and the chosen time is lost. renderDeviationTab asks this first and,
// when it is true, skips the redraw; the redraw is done as soon as the field loses the focus (see wireWeekrooster).
let redrawWaiting = false;
export function holdFormRedraw() {
  const a = typeof document !== 'undefined' && document.activeElement;
  if (!(a && a.classList && (a.classList.contains('wrTime') || a.classList.contains('rbSel')))) return false;
  redrawWaiting = true; return true;
}
export function redrawAfterTyping() {
  if (!redrawWaiting || holdFormRedraw()) return false;
  redrawWaiting = false; redrawForm(); return true;
}

// Wires the flow layer (called by renderWrFlow). The time inputs share the period form's look (class periodTime).
export function wireWeekrooster(root) {
  const $$ = (sel, fn) => (root || document).querySelectorAll(sel).forEach(fn);
  $$('[data-wrweek]', b => b.onclick = () => { hapticTap(); S.wrWeek = b.dataset.wrweek === 'next' ? 'next' : 'this'; S.wrForm = null; formFor(which()); redrawForm(); });
  // A picker on a phone gives 'change' (when OK is tapped) and not always 'input': listen to both, and draw again after the field is left.
  const typed = () => { if (S.wrForm) S.wrForm.touched = true; readForm(); markChanged(); };
  $$('.wrTime', el => { el.oninput = typed; el.onchange = typed; el.onblur = () => setTimeout(redrawAfterTyping, 700); });
  $$('[data-wrtoggle]', b => b.onclick = () => { hapticTap(); toggleRide(b.dataset.wrtoggle, b.dataset.wrdir); });
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('wrFlowClose', () => { hapticTap(); requestCloseWrFlow(); });
  on('wrSubmit', () => { hapticTap(); return submitWeekForm(); });
  on('wrKeep', () => { hapticTap(); S.wrFlow = true; renderWrFlow(); });
  on('wrDiscard', () => { hapticTap(); closeWrFlow(); });
}

// ---------- Mijn week ----------
// Mijn week: the button "Tijden wijzigen" (secondary) at the top. An open request is not a card of its own any more: it sits in the card of
// the day it is about (requestBlockHtml), and next week's requests are one block under the days (myWeekNextWeekHtml).
export function myWeekWeekroosterHtml() {
  if (!weekroosterActive()) return '';
  return `<div class="wrStack"><button type="button" class="btn secondary" id="wrChange">${phIcon('pencil')}${t('weekrooster.myweek.change')}</button></div>`;
}
// One line of the request block: the label, the time that holds now (struck through when the request changes it) and the asked time.
// An empty asked time (or a whole day off) is "rijdt niet mee" on that ride.
function askedLine(labelKey, doc, dir, day) {
  const asked = doc.rides === false ? '' : (doc[dir] || '');
  const now = rideTime(myFamilyId(), day, dir);
  const was = now && now !== asked ? `<s>${esc(now)}</s> ` : '';
  return `<div class="reqBlock__line">${esc(t(labelKey))} ${was}${asked ? `<b>${esc(asked)}</b>` : `<span>${esc(t('weekrooster.done.out'))}</span>`}</div>`;
}
// The time the family itself asked for on one ride of this week while the request is still open ('' when nothing is open or the ride is not asked).
// Her own time ("aanwezig om" / "klaar om") is a fact about her, not a decision of the day coordinator: it shows at once. Only the car (departure,
// which car) waits for the coordinator, so rideTime() (the planning input) stays on the time that holds now.
export function openAskedTime(day, dir) { return openAskedTimeOf(myFamilyId(), day, dir); }
// The same for any family: the own requests (weekRequests) and, for a day coordinator, the requests of the others (dayRequests).
export function openAskedTimeOf(familyId, day, dir) {
  if (!weekroosterActive() || !familyId) return '';
  const wk = weekKeyFor('this'), id = requestId(wk, day, familyId);
  const doc = (S.weekRequests && S.weekRequests[id]) || (S.dayRequests && S.dayRequests[id]);
  if (!doc || doc.rides === false || requestState(doc, Date.now(), dayEndMs(wk, day)) !== 'pending') return '';
  return doc[dir] || '';
}
setAskedTimeOf(openAskedTimeOf);
// The dashed amber block in the card of a day of THIS week that has an open request: what was asked ("aanwezig" and "klaar", each on its own line,
// the time that holds now struck through), who decides, and Intrekken (that day only).
export function requestBlockHtml(day) {
  if (!weekroosterActive()) return '';
  const wk = weekKeyFor('this'), doc = S.weekRequests[requestId(wk, day, myFamilyId())];
  if (!doc || requestState(doc, Date.now(), dayEndMs(wk, day)) !== 'pending') return '';
  return `<div class="reqBlock"><div class="reqBlock__head">${phIcon('clock')}<b>${esc(t('weekrooster.myweek.blockTitle'))}</b></div>
    <div class="reqBlock__times">${askedLine('weekrooster.myweek.at', doc, 'heen', day)}${askedLine('weekrooster.myweek.ready', doc, 'terug', day)}</div>
    <div class="reqBlock__foot"><span>${esc(t('weekrooster.tag.wait', { p1: deciderLabel(day) }))}</span><button type="button" class="linkbtn danger" data-wrwithdraw="${day}">${esc(t('weekrooster.myweek.blockWithdraw'))}</button></div></div>`;
}
// Under the days: the open requests for next week as ONE dashed block with columns (day, aanwezig, klaar, who decides) and an Intrekken per day.
// Closed by default: the line "N aanvragen wachten op antwoord" is the button that unfolds the columns (S.myWeekNextOpen).
// The link "Wijzigen" in the header opens Wijzigen on the tab "Volgende week".
export function myWeekNextWeekHtml() {
  if (!weekroosterActive()) return '';
  const next = mine('next').filter(r => r.status === 'pending');
  if (!next.length) { S.myWeekNextOpen = false; return ''; }
  const open = !!S.myWeekNextOpen, wk = weekKeyFor('next');
  const dates = isoRangeLabel(weekKeyDayIso(wk, REQUEST_DAYS[0]), weekKeyDayIso(wk, REQUEST_DAYS[REQUEST_DAYS.length - 1]));
  const cell = (r, dir) => { const v = r.rides === false ? '' : (r[dir] || ''); return v ? `<span class="nwRow__t">${esc(v)}</span>` : `<span class="nwRow__t nwRow__t--off">${esc(t('weekrooster.myweek.notRidingShort'))}</span>`; };
  const rows = next.map(r => `<div class="nwRow"><b class="nwRow__day">${esc(dayName(r.day).slice(0, 2))}</b>${cell(r, 'heen')}${cell(r, 'terug')}<span class="nwRow__who">${esc(upperFirst(deciderLabel(r.day)))}</span><button type="button" class="iconBtn" data-wrwithdraw-next="${r.day}" aria-label="${esc(t('weekrooster.myweek.withdrawDay', { p1: dayName(r.day) }))}">${phIcon('x')}</button></div>`).join('');
  const sub = next.length === 1 ? t('weekrooster.myweek.requestsOne') : t('weekrooster.myweek.requestsMany', { p1: next.length });
  return `<div class="sectionHead"><span class="sectionHead__title">${esc(t('weekrooster.myweek.nextTitle'))} <span class="sectionHead__dates">${esc(dates)}</span></span><button type="button" class="linkbtn" id="wrChangeNext">${phIcon('pencil')}${esc(t('weekrooster.myweek.editNext'))}</button></div>
    <div class="reqBlock reqBlock--week${open ? '' : ' reqBlock--closed'}"><button type="button" class="reqBlock__toggle" id="wrNextToggle" aria-expanded="${open}">${phIcon('clock')}<b>${esc(sub)}</b><span class="reqBlock__chev">${phIcon(open ? 'caret-up' : 'caret-down')}</span></button>${open ? `
    <div class="nwHead"><span></span><span>${esc(t('weekrooster.myweek.colAt'))}</span><span>${esc(t('weekrooster.myweek.colReady'))}</span><span>${esc(t('weekrooster.myweek.colWho'))}</span><span></span></div>${rows}` : ''}</div>`;
}
export function wireMyWeekWeekrooster(box, rerender) {
  const b = box.querySelector('#wrChange');
  if (b) b.onclick = () => { hapticTap(); openWrFlow('this'); };
  // The line "N aanvragen wachten op antwoord" folds the next-week block open and closed.
  const tg = box.querySelector('#wrNextToggle');
  if (tg) tg.onclick = () => { hapticTap(); S.myWeekNextOpen = !S.myWeekNextOpen; if (rerender) rerender(); };
  // "Wijzigen" at next week: the same screen, on "Volgende week".
  const n = box.querySelector('#wrChangeNext');
  if (n) n.onclick = () => { hapticTap(); openWrFlow('next'); };
  // Intrekken in the request block of a day (this week) or in a row of next week: two taps (design rule 9a), only that day's request.
  const withdraw = (btn, w, day, label) => twoStepConfirm(btn, label, async () => {
    if (await withdrawWeekRequests(w, day)) { S.wrForm = null; showToast(t('weekrooster.done.withdrawn')); if (rerender) rerender(); }
  });
  box.querySelectorAll('[data-wrwithdraw]').forEach(btn => btn.onclick = () => withdraw(btn, 'this', btn.dataset.wrwithdraw, t('weekrooster.done.withdrawConfirm')));
  box.querySelectorAll('[data-wrwithdraw-next]').forEach(btn => btn.onclick = () => withdraw(btn, 'next', btn.dataset.wrwithdrawNext, t('weekrooster.myweek.withdrawSure')));
}
