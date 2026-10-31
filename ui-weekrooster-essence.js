// ui-weekrooster-essence.js — the core of a proposal in a few words: who rides with whom, which car leaves at another time.
// Used by the entry card (Rooster and Mijn week) and by step 2 of the Advies flow, so both say the same thing. Pure: it only reads.
import { t } from './i18n.js';
import { esc, phIcon } from './ui-common.js';
import { fam, sortGirlIds } from './rides.js';

const girl = id => fam(id).girlName || fam(id).parentName || id;
const parent = id => fam(id).parentName || '?';
const nice = names => (names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' ' + t('weekrooster.flow.and') + ' ' + names[names.length - 1]);
const bold = list => nice(list.map(n => `<b>${esc(n)}</b>`));

// [{ dir, html }] per direction that changes something; [] when the proposal is the situation as it is.
export function essenceOf(advice, plan) {
  const out = [];
  Object.keys(plan.dirs).forEach(dir => {
    const d = advice.directions[dir], now = d.cars.filter(c => (c.girlIds || []).length), parts = [];
    const oldCarOf = id => now.find(o => o.girlIds.includes(id));
    plan.dirs[dir].cars.filter(c => c.girlIds.length).forEach(c => {
      const old = now.find(o => o.driverFamilyId === c.driverFamilyId);
      if (old && c.departureTime && (old.departureTime || '') !== c.departureTime) parts.push(t('weekrooster.essence.dep', { p1: esc(parent(c.driverFamilyId)), p2: c.departureTime, p3: old.departureTime || '--:--' }));
      const coming = sortGirlIds(c.girlIds.filter(id => { const o = oldCarOf(id); return !o || o.driverFamilyId !== c.driverFamilyId; }));
      if (coming.length) parts.push(t(coming.length === 1 ? 'weekrooster.essence.join1' : 'weekrooster.essence.joinN', { p1: bold(coming.map(girl)), p2: esc(parent(c.driverFamilyId)), p3: c.departureTime || '--:--' }));
    });
    now.filter(o => !plan.dirs[dir].cars.some(c => c.driverFamilyId === o.driverFamilyId && c.girlIds.length)).forEach(o => parts.push(t('weekrooster.essence.gone', { p1: esc(parent(o.driverFamilyId)) })));
    const off = sortGirlIds((d.ctx.requests || []).filter(r => !r.rides && now.some(o => o.girlIds.includes(r.familyId))).map(r => r.familyId));
    if (off.length) parts.push(t('weekrooster.essence.off', { p1: bold(off.map(girl)) }));
    if (parts.length) out.push({ dir, html: parts.join('. ') });
  });
  return out;
}

// The rows as a block (heen sun on slate, terug moon on plum, as in the flow); '' when nothing changes.
export function essenceHtml(advice, plan, cls = '') {
  const rows = essenceOf(advice, plan);
  if (!rows.length) return '';
  return `<div class="essRows${cls ? ' ' + cls : ''}">${rows.map(r => `<div class="essRow essRow--${r.dir}"><span class="essRow__k">${phIcon(r.dir === 'heen' ? 'sun' : 'moon')}<b>${esc(t(r.dir === 'heen' ? 'dir.heenShort' : 'dir.terugShort'))}</b></span><span class="essRow__t">${r.html}</span></div>`).join('')}</div>`;
}
