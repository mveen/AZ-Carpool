// ui-weekrooster-form.js — Afwijkend weekrooster, phase 2: what a parent (or a day coordinator for the own daughter) sees.
//   Wijzigen: the week form (same look as the period form), then the "Doorgegeven" card with "Wie merkt dit" and the day coordinators.
//   Mijn week: the button "Tijden wijzigen", the amber card of an open request and the pill "Aanvraag" on the ride.
// Everything here only shows while the switch is on for this person (weekroosterOn) and the person has a daughter of their own
// (not Flex). Rules and requests: weekrooster.js; database: weekrooster-data.js.
import { t } from './i18n.js';
import { S } from './state.js';
import { DAYS } from './constants.js';
import { dayUp, isoDayLabel, weekKeyDayIso } from './dates.js';
import { esc, hapticTap, phIcon, showToast, twoStepConfirm } from './ui-common.js';
import { myFamilyId, myLinkedFamilyId } from './coordinator.js';
import { baseCars, effectiveCars, fam, girlName, isFlex } from './rides.js';
import { contactButtonHtml } from './ui-contact.js';
import { renderDeviationTab } from './ui-deviation.js';
import { activateTab } from './app.js';
import { REQUEST_DAYS, requestId, requestState, weekFormFrom, openRequestsOf } from './weekrooster.js';
import { expectedImpact } from './weekrooster-impact.js';
import { dayEndMs, deciderFamilyOf, isDayPast, standardTimes, submitWeekRequests, weekKeyFor, weekroosterOn, withdrawWeekRequests } from './weekrooster-data.js';

const dayName = day => (DAYS.find(([k]) => k === day) || [day, day])[1];
const lower = s => String(s || '').toLowerCase();
const upperFirst = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const weekNumber = weekKey => +String(weekKey).split('-W')[1];

// ---------- who sees it ----------
// The new Wijzigen / Mijn week parts: switch on for this person, a family of their own (also in Testweergave), and not Flex.
export function weekroosterActive() {
  if (!weekroosterOn() || !myLinkedFamilyId()) return false;
  return !isFlex(fam(myFamilyId()));
}

// ---------- reading what is handed in ----------
const which = () => (S.wrWeek === 'next' ? 'next' : 'this');
function mine(w) {
  const wk = weekKeyFor(w);
  return openRequestsOf(S.weekRequests, wk, myFamilyId(), Date.now(), day => dayEndMs(wk, day));
}
const deciderName = day => { const id = deciderFamilyOf(day); return id ? (fam(id).parentName || '') : ''; };
const deciderLabel = day => deciderName(day) || t('weekrooster.decider.unknown');

// One short text for a handed-in day: "Heen 16:30 · Terug 17:45" or "Rijdt niet mee".
function summaryOf(r) {
  if (r.rides === false) return t('weekrooster.done.out');
  return [r.heen ? t('weekrooster.done.heen', { p1: r.heen }) : '', r.terug ? t('weekrooster.done.terug', { p1: r.terug }) : ''].filter(Boolean).join(' · ');
}

// ---------- the form ----------
function formFor(w) {
  if (!S.wrForm || S.wrForm.which !== w) {
    const wk = weekKeyFor(w), fid = myFamilyId();
    S.wrForm = { which: w, days: weekFormFrom({ weekKey: wk, familyId: fid, standard: standardTimes(fid, w), requests: S.weekRequests }) };
  }
  return S.wrForm;
}
const sameAsStandard = (d, std) => d.rides !== false && (d.heen || '') === (std.heen || '') && (d.terug || '') === (std.terug || '');

function weekSegmentHtml() {
  const w = which();
  return `<div class="segmented" role="group" aria-label="${esc(t('weekrooster.seg.aria'))}">
    <button type="button" class="${w === 'this' ? 'active' : ''}" data-wrweek="this" aria-pressed="${w === 'this'}">${t('weekrooster.seg.this')}</button>
    <button type="button" class="${w === 'next' ? 'active' : ''}" data-wrweek="next" aria-pressed="${w === 'next'}">${t('weekrooster.seg.next')}</button>
  </div>`;
}

function formHtml(w) {
  const f = formFor(w), wk = weekKeyFor(w), std = standardTimes(myFamilyId(), w);
  const rows = REQUEST_DAYS.map(day => {
    const d = f.days[day], past = isDayPast(wk, day), iso = weekKeyDayIso(wk, day);
    const changed = !past && !sameAsStandard(d, std[day]);
    const input = (dir, label) => `<input type="time" class="periodTime wrTime${(d[dir] || '') !== (std[day][dir] || '') ? ' changed' : ''}" id="${dir === 'heen' ? 'wrHeen_' : 'wrTerug_'}${day}" value="${esc(d[dir] || '')}" aria-label="${esc(label)} ${esc(dayName(day))}"${past ? ' disabled' : ''}>`;
    const body = past
      ? `<p class="muted">${t('weekrooster.form.past')}</p>`
      : d.rides === false ? '' : `<div class="grid2">${input('heen', t('weekrooster.form.heenAria'))}${input('terug', t('weekrooster.form.terugAria'))}</div>`;
    return `<div class="periodDay${changed ? ' changed' : ''}${past ? ' periodDay--past' : ''}" data-wrday="${day}">
        <div class="periodDayHead">
          <span><strong>${esc(dayUp(day))}</strong> <span class="muted">${esc(isoDayLabel(iso, ''))}</span></span>
          <label class="periodRide" for="wrRide_${day}"><input type="checkbox" class="wrRideInput" id="wrRide_${day}"${d.rides === false ? '' : ' checked'}${past ? ' disabled' : ''}> <span>${t('weekrooster.form.rides')}</span></label>
        </div>
        ${body}
      </div>`;
  }).join('');
  return `<div class="card" id="wrForm">
      <h2>${esc(t(w === 'next' ? 'weekrooster.form.titleNext' : 'weekrooster.form.titleThis'))}</h2>
      <p class="muted">${t('weekrooster.form.hint')}</p>
      <div class="periodColHead"><span>${t('weekrooster.form.heen')}</span><span>${t('weekrooster.form.terug')}</span></div>
      ${rows}
      <div class="formActions">
        <button type="button" class="btn secondary" id="wrCancel">${t('weekrooster.form.cancel')}</button>
        <button type="button" class="btn" id="wrSubmit">${t('weekrooster.form.submit')}</button>
      </div>
    </div>`;
}

// ---------- "Doorgegeven" + "Wie merkt dit" ----------
function whoRowsHtml(w, open) {
  const fid = myFamilyId();
  const lines = [];
  open.filter(r => r.status === 'pending').forEach(r => {
    ['heen', 'terug'].forEach(dir => {
      const time = r.rides === false ? '' : r[dir];
      const res = expectedImpact({
        day: r.day, direction: dir, cars: w === 'next' ? baseCars(r.day, dir) : effectiveCars(r.day, dir),
        requests: [{ familyId: fid, rides: r.rides !== false, time }], families: S.families, settings: S.settings, prefs: S.prefs,
        priority: (S.shiftPriority || {})[r.day + '_' + dir],
      });
      const who = deciderLabel(r.day), tag = `${dayUp(r.day)} ${t(dir === 'heen' ? 'dir.heenShort' : 'dir.terugShort')}`;
      const out = [];
      res.changes.forEach(c => out.push(t('weekrooster.who.line', { p1: who, p2: girlName(c.familyId), p3: c.to, p4: c.from })));
      if (res.noSolution) out.push(t('weekrooster.who.noSolution'));
      else if (res.carsAfter < res.carsBefore) out.push(t('weekrooster.who.saves', { p1: who, p2: res.carsBefore - res.carsAfter }));
      else if (res.carsAfter > res.carsBefore) out.push(t('weekrooster.who.extra'));
      out.forEach(text => lines.push(`<div class="periodSummary"><span>${esc(tag)}</span><span class="muted">${esc(text)}</span></div>`));
    });
  });
  return lines.length ? lines.join('') : `<p class="muted">${t('weekrooster.who.none')}</p>`;
}

function coordLineHtml(open) {
  const days = open.filter(r => r.status === 'pending').map(r => r.day);
  if (!days.length) return '';
  const parts = days.map((day, i) => {
    const id = deciderFamilyOf(day), name = esc(deciderName(day) || t('weekrooster.decider.unknown'));
    const who = id ? contactButtonHtml(id, name) : `<strong>${name}</strong>`;
    return `${i === 0 ? esc(t('weekrooster.coord.prefix')) + ' ' : ''}${esc(lower(dayName(day)))}: ${who}`;
  });
  return `<div class="coordLine">${phIcon('user-circle-gear')} <span>${parts.join(' · ')}</span></div>`;
}

function doneHtml(w, open) {
  const wk = weekKeyFor(w), waiting = open.some(r => r.status === 'pending');
  const rows = open.map(r => {
    const tag = r.status === 'pending'
      ? `<span class="tag tag--warn">${esc(deciderName(r.day) ? t('weekrooster.tag.wait', { p1: deciderName(r.day) }) : t('weekrooster.tag.waitUnknown'))}</span>`
      : `<span class="tag tag--ok">${esc(t('weekrooster.tag.direct'))}</span>`;
    return `<div class="periodSummary"><span>${esc(dayUp(r.day))} <span class="muted">${esc(isoDayLabel(weekKeyDayIso(wk, r.day), ''))}</span></span><span class="muted">${esc(summaryOf(r))}</span>${tag}</div>`;
  }).join('');
  return `<div class="periodDone${waiting ? ' periodDone--wait' : ''}" id="wrDone">
      <p class="periodDoneTitle">${phIcon('check')} ${esc(t('weekrooster.done.title', { p1: weekNumber(wk) }))}</p>
      <p class="devAlertBody">${esc(t(waiting ? 'weekrooster.done.body' : 'weekrooster.done.bodyDirect'))}</p>
      ${rows}
      <div class="formActions">
        <button type="button" class="btn small secondary" id="wrEdit">${t('weekrooster.done.edit')}</button>
        ${waiting ? `<button type="button" class="linkbtn" id="wrWithdraw">${t('weekrooster.done.withdraw')}</button>` : ''}
      </div>
    </div>
    ${waiting ? `<div class="card" id="wrWho"><h2>${t('weekrooster.who.title')}</h2>${whoRowsHtml(w, open)}<p class="noteLine">${t('weekrooster.who.note')}</p></div>` : ''}
    ${coordLineHtml(open)}`;
}

// The whole body of Wijzigen while the new flow is on: the week segment, then the form or what was handed in.
export function weekroosterBodyHtml() {
  const w = which();
  const open = mine(w);
  const editing = S.wrForm && S.wrForm.which === w;
  return weekSegmentHtml() + (open.length && !editing ? doneHtml(w, open) : formHtml(w));
}

// ---------- the form: reading, amber, handing in ----------
function readForm() {
  const f = S.wrForm; if (!f) return;
  REQUEST_DAYS.forEach(day => {
    const ride = document.getElementById('wrRide_' + day);
    if (ride && !ride.disabled) f.days[day].rides = !!ride.checked;
    ['heen', 'terug'].forEach(dir => {
      const el = document.getElementById((dir === 'heen' ? 'wrHeen_' : 'wrTerug_') + day);
      if (el && !el.disabled) f.days[day][dir] = el.value || '';
    });
  });
}
// Amber follows what is typed, without redrawing the form (a redraw would take the focus away).
function markChanged() {
  const f = S.wrForm; if (!f) return;
  const std = standardTimes(myFamilyId(), f.which);
  REQUEST_DAYS.forEach(day => {
    const row = document.querySelector && document.querySelector(`[data-wrday="${day}"]`);
    if (row && row.classList) row.classList.toggle('changed', !sameAsStandard(f.days[day], std[day]));
    ['heen', 'terug'].forEach(dir => {
      const el = document.getElementById((dir === 'heen' ? 'wrHeen_' : 'wrTerug_') + day);
      if (el && el.classList) el.classList.toggle('changed', (f.days[day][dir] || '') !== (std[day][dir] || ''));
    });
  });
}

export async function submitWeekForm() {
  const f = S.wrForm; if (!f) return false;
  readForm();
  const res = await submitWeekRequests(f.which, f.days);
  if (res.ok) { S.wrForm = null; renderDeviationTab(); return true; }
  if (S.wrBusy) return false;
  if (res.skipped.some(s => s.why === 'time')) showToast(t('weekrooster.form.timeNeeded'));
  else if (!res.skipped.length || res.skipped.every(s => s.why === 'same' || s.why === 'past')) showToast(t('weekrooster.form.nothing'));
  return false;
}

// Called at the end of renderDeviationTab, AFTER wirePeriod: the inputs share the period form's look (class periodTime), so this
// has to be the last word on their handlers.
export function wireWeekrooster() {
  document.querySelectorAll('[data-wrweek]').forEach(b => b.onclick = () => { hapticTap(); S.wrWeek = b.dataset.wrweek === 'next' ? 'next' : 'this'; S.wrForm = null; renderDeviationTab(); });
  document.querySelectorAll('.wrTime').forEach(el => el.oninput = () => { readForm(); markChanged(); });
  document.querySelectorAll('.wrRideInput').forEach(el => el.onchange = () => { readForm(); renderDeviationTab(); });
  const cancel = document.getElementById('wrCancel'); if (cancel) cancel.onclick = () => { hapticTap(); S.wrForm = null; renderDeviationTab(); };
  const submit = document.getElementById('wrSubmit'); if (submit) submit.onclick = () => { hapticTap(); return submitWeekForm(); };
  const edit = document.getElementById('wrEdit'); if (edit) edit.onclick = () => { hapticTap(); S.wrForm = null; formFor(which()); renderDeviationTab(); };
  const wd = document.getElementById('wrWithdraw');
  if (wd) wd.onclick = () => twoStepConfirm(wd, t('weekrooster.done.withdrawConfirm'), async () => {
    if (await withdrawWeekRequests(which())) { S.wrForm = null; showToast(t('weekrooster.done.withdrawn')); renderDeviationTab(); }
  });
}

// ---------- Mijn week ----------
// "Tijden wijzigen" (ink) at the top, and an amber card per open request of the own daughter (this week and next week).
export function myWeekWeekroosterHtml() {
  if (!weekroosterActive()) return '';
  const cards = [];
  ['this', 'next'].forEach(w => {
    mine(w).filter(r => r.status === 'pending').forEach(r => {
      const when = w === 'next' ? t('weekrooster.myweek.nextWeek', { p1: lower(dayName(r.day)) }) : lower(dayName(r.day));
      cards.push(`<div class="alertCard"><span class="alertCard__icon">${phIcon('warning-circle-fill')}</span>
        <div class="alertCard__text"><b>${esc(t('weekrooster.myweek.request', { p1: when, p2: lower(summaryOf(r)), p3: upperFirst(deciderLabel(r.day)) }))}</b></div></div>`);
    });
  });
  return `<button type="button" class="btn" id="wrChange">${t('weekrooster.myweek.change')}</button>${cards.join('')}`;
}
// The pill "Aanvraag" on the ride of a day with an open request of this week.
export function requestPillHtml(day) {
  if (!weekroosterActive()) return '';
  const wk = weekKeyFor('this'), doc = S.weekRequests[requestId(wk, day, myFamilyId())];
  return doc && requestState(doc, Date.now(), dayEndMs(wk, day)) === 'pending' ? `<span class="tag tag--warn">${esc(t('weekrooster.pill.request'))}</span>` : '';
}
export function wireMyWeekWeekrooster(box) {
  const b = box.querySelector('#wrChange');
  if (b) b.onclick = () => { hapticTap(); S.wrWeek = 'this'; S.wrForm = null; renderDeviationTab(); activateTab('deviation'); };
}
