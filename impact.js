// impact.js — impact preview on a deviation (US-07). PILOT: delete this file and its 2 hooks to remove it.
//   Hook 1: data.js saveDeviationCars() asks impactGate() before it saves.
//   Hook 2: ui-beheer.js renders impactCardHtml() and calls wireImpactCard().
// What it does: before a change in Wijzigen is saved, the planning engine looks at the shift WITHOUT and WITH the
// change and says one of: "scheelt een auto", "geen effect", "extra plek nodig → voorstel: <chauffeur>",
// "geen oplossing → back-up <naam>". It only shows a sheet: nothing is stored about the preview. The only thing in
// Firestore is the on/off switch (settings/features), which is deleted again when the switch goes off.
import { t } from './i18n.js';
import { S } from './state.js';
import { planShift, timeToMinutes } from './planning.js';
import { db } from './data.js';
import { esc, openSheet, phIcon, showToast } from './ui-common.js';
import { effectiveCars, shiftFamilies } from './rides.js';

// ---------- pure: the analysis ----------
const seatsOf = f => Math.max(0, ((f && f.capacity) || 0) - 1);
const availOf = (f, day, dir) => (f && f.availability && f.availability[day]) || {};
const isStandaard = (f, day, dir) => !!availOf(f, day, dir)[dir];
const isBackup = (f, day, dir) => !!availOf(f, day, dir)[dir === 'heen' ? 'backupHeen' : 'backupTerug'];
const withGirls = cars => (cars || []).filter(c => (c.girlIds || []).length);

// Fewest cars the planning engine needs for the girls in these cars, or null when it finds no solution.
function engineCars({ day, direction, cars, families, settings, prefs, priority }) {
  const riders = [];
  withGirls(cars).forEach(c => c.girlIds.forEach(id => {
    const f = families[id];
    const min = timeToMinutes((f && f.schedule && f.schedule[day] && f.schedule[day][direction]) || c.departureTime || '');
    if (min != null) riders.push({ id, min });
  }));
  if (!riders.length) return 0;
  const rankOf = id => (priority && priority[id] != null ? priority[id] : 999);
  const drivers = new Map();
  Object.entries(families).forEach(([id, f]) => {
    const std = isStandaard(f, day, direction);
    if (std || isBackup(f, day, direction)) drivers.set(id, { id, seats: seatsOf(f), standard: std, rank: rankOf(id) });
  });
  withGirls(cars).forEach(c => { if (c.driverFamilyId && families[c.driverFamilyId]) drivers.set(c.driverFamilyId, { id: c.driverFamilyId, seats: seatsOf(families[c.driverFamilyId]), standard: true, rank: rankOf(c.driverFamilyId) }); });
  const rules = (prefs && prefs.rules) || [];
  const plan = planShift({
    riders, drivers: [...drivers.values()], direction,
    gapLimitMinutes: ((settings && settings.gapThresholdHours) || 3) * 60,
    togetherRules: rules.filter(r => r.type === 'together'), preferRules: rules.filter(r => r.type === 'prefer'),
    prefWindowMinutes: settings && settings.prefWindowMinutes != null ? settings.prefWindowMinutes : 30,
    parentPrefWindowMinutes: settings && settings.parentPrefWindowMinutes != null ? settings.parentPrefWindowMinutes : 60,
  });
  return plan.unplaced.length ? null : plan.cars.length;
}

// ctx: { day, direction, before:[car], after:[car], families:{id:family}, settings, prefs, priority:{id:rank} }
// Result: { kind:'saves' } | { kind:'none' } | { kind:'needSeat', driverId } | { kind:'noSolution', backupId|null }
export function analyzeImpact(ctx) {
  const { day, direction, before, after, families } = ctx;
  const rank = id => (ctx.priority && ctx.priority[id] != null ? ctx.priority[id] : 999);
  const afterCars = withGirls(after);
  const driving = new Set(afterCars.map(c => c.driverFamilyId).filter(Boolean));

  // A car with no driver, or with more girls than seats, needs one more seat somewhere else.
  let need = 0;
  afterCars.forEach(c => {
    const f = c.driverFamilyId && families[c.driverFamilyId];
    if (!f) need = Math.max(need, c.girlIds.length);
    else if (c.girlIds.length > seatsOf(f)) need = Math.max(need, c.girlIds.length - seatsOf(f));
  });
  if (need) {
    const pool = Object.entries(families).filter(([id, f]) => !driving.has(id) && seatsOf(f) >= need).sort((a, b) => rank(a[0]) - rank(b[0]));
    const std = pool.find(([, f]) => isStandaard(f, day, direction));
    if (std) return { kind: 'needSeat', driverId: std[0] };
    const bak = pool.find(([, f]) => isBackup(f, day, direction));
    return { kind: 'noSolution', backupId: bak ? bak[0] : null };
  }

  const nb = engineCars({ day, direction, cars: before, families, settings: ctx.settings, prefs: ctx.prefs, priority: ctx.priority });
  const na = engineCars({ day, direction, cars: after, families, settings: ctx.settings, prefs: ctx.prefs, priority: ctx.priority });
  if ((na != null && nb != null && na < nb) || afterCars.length < withGirls(before).length) return { kind: 'saves' };
  return { kind: 'none' };
}

// ---------- texts ----------
export function impactText(result, nameOf) {
  if (result.kind === 'saves') return t('impact.saves');
  if (result.kind === 'none') return t('impact.none');
  if (result.kind === 'needSeat') return t('impact.needSeat', { name: nameOf(result.driverId) });
  return result.backupId ? t('impact.noSolution', { name: nameOf(result.backupId) }) : t('impact.noSolutionNoBackup');
}

// ---------- the switch (Beheer) ----------
export async function impactEnabled() {
  try { const s = await db.doc('settings/features').get(); return !!(s.exists && s.data().impactPreview); }
  catch (e) { return false; }   // when in doubt: behave as before (no preview)
}
export async function setImpactEnabled(on) {
  if (on) await db.doc('settings/features').set({ impactPreview: true });
  else await db.doc('settings/features').delete();   // off leaves nothing behind
  S.impactPreview = !!on;
}
export function impactCardHtml() {
  return `<div class="card" id="impactCard">
    <h2>${t('impact.beheerTitle')}</h2>
    <p class="muted">${t('impact.beheerIntro')}</p>
    <label class="chip"><input type="checkbox" id="impactToggle" ${S.impactPreview ? 'checked' : ''}> ${t('impact.beheerToggle')}</label>
  </div>`;
}
// rerender: called after the stored value was loaded or changed, so Beheer shows the right state.
export function wireImpactCard(rerender) {
  const cb = document.getElementById('impactToggle');
  if (S.impactPreview == null) { impactEnabled().then(v => { S.impactPreview = v; if (rerender) rerender(); }); }
  if (cb) cb.onchange = async () => {
    try { await setImpactEnabled(cb.checked); showToast(t(cb.checked ? 'impact.on' : 'impact.off')); }
    catch (e) { cb.checked = !cb.checked; showToast(t('data.mislukt') + (e && e.message || e)); }
    if (rerender) rerender();
  };
}

// ---------- hook 1: before a deviation is saved ----------
// Returns true when the save is HELD (a sheet is shown; "Opslaan" saves for real), false when it may go ahead.
export async function impactGate(day, direction, cars, save, rerender) {
  if (!(await impactEnabled())) return false;
  const result = analyzeImpact({
    day, direction, before: effectiveCars(day, direction), after: cars,
    families: shiftFamilies(day, direction), settings: S.settings, prefs: S.prefs, priority: S.shiftPriority[day + '_' + direction],
  });
  const name = id => (S.families[id] && S.families[id].parentName) || '?';
  const text = impactText(result, name);
  const icon = result.kind === 'saves' || result.kind === 'none' ? 'check-circle' : 'warning';
  if (rerender) rerender();   // the changed field goes back to what is really saved until the change is confirmed
  openSheet(t('impact.title'), `${phIcon(icon)} <strong>${esc(text)}</strong>`, [
    { label: t('impact.save'), onClick: async () => { if (await save()) showToast(t('data.opgeslagen')); } },
  ]);
  return true;
}
