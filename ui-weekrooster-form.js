// ui-weekrooster-form.js — Afwijkend weekrooster, phase 2: what a parent (or a day coordinator for the own daughter) sees.
//   Wijzigen: the week form (same look as the period form), then the "Doorgegeven" card (days, what others notice, actions) and the day coordinators.
//   Mijn week: the button "Tijden wijzigen", the amber block of an open request in the card of its day, and next week's open requests as one block.
// Everything here only shows while the switch is on for this person (weekroosterOn) and the person has a daughter of their own
// (not Flex). Rules and requests: weekrooster.js; database: weekrooster-data.js.
import { t } from './i18n.js';
import { S } from './state.js';
import { DAYS } from './constants.js';
import { dayUp, isoDayLabel, isoRangeLabel, weekKeyDayIso } from './dates.js';
import { esc, hapticTap, phIcon, showToast, twoStepConfirm } from './ui-common.js';
import { myFamilyId, myLinkedFamilyId } from './coordinator.js';
import { baseCars, effectiveCars, fam, girlName, isFlex, rideTime } from './rides.js';
import { contactButtonHtml } from './ui-contact.js';
import { renderDeviationTab } from './ui-deviation.js';
import { activateTab } from './app.js';
import { REQUEST_DAYS, requestId, requestState, weekFormFrom, openRequestsOf } from './weekrooster.js';
import { expectedImpact } from './weekrooster-impact.js';
import { currentMarks, dayEndMs, deciderFamilyOf, isDayPast, standardTimes, submitWeekRequests, weekKeyFor, weekroosterOn, withdrawWeekRequests } from './weekrooster-data.js';

export const dayName = day => (DAYS.find(([k]) => k === day) || [day, day])[1];
export const lower = s => String(s || '').toLowerCase();
export const upperFirst = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
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
    const input = (dir, label) => `<input type="time" class="periodTime wrTime${(d[dir] || '') !== (std[day][dir] || '') ? ' changed' : ''}" id="${dir === 'heen' ? 'wrHeen_' : 'wrTerug_'}${day}" value="${esc(d[dir] || '')}" aria-label="${esc(label)} ${esc(dayName(day))}">`;
    // One cell per ride, on one line: the switch (small version of the one in Mijn week), then the time, or "Rijdt niet mee" while it is off.
    const cell = (dir, label) => {
      const on = isOn(d, dir), name = t(dir === 'heen' ? 'dir.heenShort' : 'dir.terugShort');
      return `<div class="wrCell">
          <button type="button" class="switch switch--sm${on ? ' on' : ''}" role="switch" aria-checked="${on}" aria-label="${esc(t('ov.switchLabel', { p1: name, p2: dayName(day) }))}" data-wrtoggle="${day}" data-wrdir="${dir}"><span class="switch__track"><span class="switch__knob">${phIcon(on ? 'car-profile-bold' : 'x-bold')}</span></span></button>
          ${on ? input(dir, label) : `<div class="wrCell__off">${t('weekrooster.form.notRiding')}</div>`}
        </div>`;
    };
    const body = past
      ? `<p class="muted">${t('weekrooster.form.past')}</p>`
      : `<div class="grid2">${cell('heen', t('weekrooster.form.heenAria'))}${cell('terug', t('weekrooster.form.terugAria'))}</div>`;
    return `<div class="periodDay${changed ? ' changed' : ''}${past ? ' periodDay--past wrPastDay' : ''}" data-wrday="${day}">
        <div class="periodDayHead">
          <span><strong>${esc(dayUp(day))}</strong> <span class="muted">${esc(isoDayLabel(iso, ''))}</span></span>
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
      out.forEach(text => lines.push(`<p class="noteLine">${esc(tag)}: ${esc(text)}</p>`));
    });
  });
  return lines.length ? lines.join('') : `<p class="noteLine">${esc(t('weekrooster.who.none'))}</p>`;
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
    return `<div class="reqRow"><div><div class="reqRow__day">${esc(dayName(r.day))} <span>${esc(isoDayLabel(weekKeyDayIso(wk, r.day), ''))}</span></div><div class="reqRow__times">${esc(summaryOf(r))}</div></div>${tag}</div>`;
  }).join('');
  return `<div class="periodDone periodDone--stack${waiting ? ' periodDone--wait' : ''}" id="wrDone">
      <p class="periodDoneTitle">${phIcon(waiting ? 'clock' : 'check')} ${esc(t('weekrooster.done.title', { p1: weekNumber(wk) }))}</p>
      ${rows}
      ${waiting ? `<div id="wrWho">${whoRowsHtml(w, open)}<p class="noteLine">${esc(t('weekrooster.done.body'))}</p></div>` : `<p class="noteLine">${esc(t('weekrooster.done.bodyDirect'))}</p>`}
      <button type="button" class="btn secondary" id="wrEdit">${phIcon('pencil')}${t('weekrooster.done.edit')}</button>
      ${waiting ? `<button type="button" class="linkbtn danger" id="wrWithdraw">${t('weekrooster.done.withdraw')}</button>` : ''}
    </div>
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
  renderDeviationTab();
  const el = needsTime && document.getElementById((dir === 'heen' ? 'wrHeen_' : 'wrTerug_') + day);
  if (el && el.focus) el.focus();
}

export async function submitWeekForm() {
  const f = S.wrForm; if (!f) return false;
  readForm();
  const res = await submitWeekRequests(f.which, f.days);
  if (res.ok) { S.wrForm = null; renderDeviationTab(); return true; }
  if (res.error || S.wrBusy) return false;   // a refused save has shown its own message; do not say "nothing changed" on top of it
  if (res.skipped.some(s => s.why === 'time')) showToast(t('weekrooster.form.timeNeeded'));
  else if (!res.skipped.length || res.skipped.every(s => s.why === 'same' || s.why === 'past' || s.why === 'unchanged')) showToast(t('weekrooster.form.nothing'));
  return false;
}

// Called at the end of renderDeviationTab, AFTER wirePeriod: the inputs share the period form's look (class periodTime), so this
// has to be the last word on their handlers.
export function wireWeekrooster() {
  document.querySelectorAll('[data-wrweek]').forEach(b => b.onclick = () => { hapticTap(); S.wrWeek = b.dataset.wrweek === 'next' ? 'next' : 'this'; S.wrForm = null; renderDeviationTab(); });
  document.querySelectorAll('.wrTime').forEach(el => el.oninput = () => { if (S.wrForm) S.wrForm.touched = true; readForm(); markChanged(); });
  document.querySelectorAll('[data-wrtoggle]').forEach(b => b.onclick = () => { hapticTap(); toggleRide(b.dataset.wrtoggle, b.dataset.wrdir); });
  const cancel = document.getElementById('wrCancel'); if (cancel) cancel.onclick = () => { hapticTap(); S.wrForm = null; renderDeviationTab(); };
  const submit = document.getElementById('wrSubmit'); if (submit) submit.onclick = () => { hapticTap(); return submitWeekForm(); };
  const edit = document.getElementById('wrEdit'); if (edit) edit.onclick = () => { hapticTap(); S.wrForm = null; formFor(which()); renderDeviationTab(); };
  const wd = document.getElementById('wrWithdraw');
  if (wd) wd.onclick = () => twoStepConfirm(wd, t('weekrooster.done.withdrawConfirm'), async () => {
    if (await withdrawWeekRequests(which())) { S.wrForm = null; showToast(t('weekrooster.done.withdrawn')); renderDeviationTab(); }
  });
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
// The link "Wijzigen" in the header opens Wijzigen on the tab "Volgende week".
export function myWeekNextWeekHtml() {
  if (!weekroosterActive()) return '';
  const next = mine('next').filter(r => r.status === 'pending');
  if (!next.length) return '';
  const wk = weekKeyFor('next');
  const dates = isoRangeLabel(weekKeyDayIso(wk, REQUEST_DAYS[0]), weekKeyDayIso(wk, REQUEST_DAYS[REQUEST_DAYS.length - 1]));
  const cell = (r, dir) => { const v = r.rides === false ? '' : (r[dir] || ''); return v ? `<span class="nwRow__t">${esc(v)}</span>` : `<span class="nwRow__t nwRow__t--off">${esc(t('weekrooster.myweek.notRidingShort'))}</span>`; };
  const rows = next.map(r => `<div class="nwRow"><b class="nwRow__day">${esc(dayName(r.day).slice(0, 2))}</b>${cell(r, 'heen')}${cell(r, 'terug')}<span class="nwRow__who">${esc(upperFirst(deciderLabel(r.day)))}</span><button type="button" class="iconBtn" data-wrwithdraw-next="${r.day}" aria-label="${esc(t('weekrooster.myweek.withdrawDay', { p1: dayName(r.day) }))}">${phIcon('x')}</button></div>`).join('');
  const sub = next.length === 1 ? t('weekrooster.myweek.requestsOne') : t('weekrooster.myweek.requestsMany', { p1: next.length });
  return `<div class="sectionHead"><span class="sectionHead__title">${esc(t('weekrooster.myweek.nextTitle'))} <span class="sectionHead__dates">${esc(dates)}</span></span><button type="button" class="linkbtn" id="wrChangeNext">${phIcon('pencil')}${esc(t('weekrooster.myweek.editNext'))}</button></div>
    <div class="reqBlock reqBlock--week"><div class="reqBlock__head">${phIcon('clock')}<b>${esc(sub)}</b></div>
    <div class="nwHead"><span></span><span>${esc(t('weekrooster.myweek.colAt'))}</span><span>${esc(t('weekrooster.myweek.colReady'))}</span><span>${esc(t('weekrooster.myweek.colWho'))}</span><span></span></div>${rows}</div>`;
}
export function wireMyWeekWeekrooster(box, rerender) {
  const b = box.querySelector('#wrChange');
  if (b) b.onclick = () => { hapticTap(); S.wrWeek = 'this'; S.wrForm = null; renderDeviationTab(); activateTab('deviation'); };
  // "Wijzigen" at next week: straight to the tab Volgende week of Wijzigen.
  const n = box.querySelector('#wrChangeNext');
  if (n) n.onclick = () => { hapticTap(); S.wrWeek = 'next'; S.wrForm = null; renderDeviationTab(); activateTab('deviation'); };
  // Intrekken in the request block of a day (this week) or in a row of next week: two taps (design rule 9a), only that day's request.
  const withdraw = (btn, w, day, label) => twoStepConfirm(btn, label, async () => {
    if (await withdrawWeekRequests(w, day)) { S.wrForm = null; showToast(t('weekrooster.done.withdrawn')); if (rerender) rerender(); }
  });
  box.querySelectorAll('[data-wrwithdraw]').forEach(btn => btn.onclick = () => withdraw(btn, 'this', btn.dataset.wrwithdraw, t('weekrooster.done.withdrawConfirm')));
  box.querySelectorAll('[data-wrwithdraw-next]').forEach(btn => btn.onclick = () => withdraw(btn, 'next', btn.dataset.wrwithdrawNext, t('weekrooster.myweek.withdrawSure')));
}
