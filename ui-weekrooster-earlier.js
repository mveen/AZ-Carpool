// ui-weekrooster-earlier.js — what the day already deviates from the standard rooster ("Al aangepast voor donderdag") and which of those earlier
// changes the proposal of the Advies flow takes back ("Dit voorstel past 2 eerdere wijzigingen aan"). Everything is worked out from the cars
// (day-changes.js); the only thing stored is the log line acceptDay writes (`overwrote` on the deviation), shown in "Recente wijzigingen".
import { t } from './i18n.js';
import { S } from './state.js';
import { esc, foldHtml, locationsCfg, phIcon } from './ui-common.js';
import { ATC_NAME } from './locations.js';
import { baseCars, effectiveCars, plainDriverName, plainGirlName } from './rides.js';
import { dayChanges } from './day-changes.js';
import { deviationKey } from './dates.js';
import { dayName, lower } from './ui-weekrooster-form.js';

const DIRS = ['heen', 'terug'];
const dirName = dir => t(dir === 'heen' ? 'dir.heenShort' : 'dir.terugShort');
const placeName = key => (key === 'ATC' ? ATC_NAME : locationsCfg().destination.name);

// One change in words, without the direction: "Eline in auto van Piet Pieters".
export function itemText(it) {
  const girl = plainGirlName(it.girlId), driver = plainDriverName(it.driverId);
  switch (it.type) {
    case 'out': return t('weekrooster.earlier.out', { p1: girl });
    case 'moved': return t('weekrooster.earlier.moved', { p1: girl, p2: driver });
    case 'extra': return t('weekrooster.earlier.extra', { p1: girl, p2: driver });
    case 'driver': return t('weekrooster.earlier.driver', { p1: driver, p2: plainDriverName(it.fromDriverId) });
    case 'newcar': return t('weekrooster.earlier.newcar', { p1: driver });
    case 'time': return t('weekrooster.earlier.time', { p1: driver, p2: it.time || '--:--' });
    case 'place': return t('weekrooster.earlier.place', { p1: driver, p2: placeName(it.place) });
    default: return '';
  }
}
export const earlierText = (dir, it) => `${dirName(dir)} · ${itemText(it)}`;

// Where it is now, in the plan: "nu: in auto van Jan Jansen", "nu: vertrek 18:30", or that the girl / the car is gone.
export function nowText(it, after) {
  if (it.girlId) return after ? t('weekrooster.over.nowGirl', { p1: plainDriverName(after.driverId) }) : t('weekrooster.over.nowGirlOff');
  return after ? t('weekrooster.over.nowCar', { p1: after.time || '--:--' }) : t('weekrooster.over.nowCarOff');
}
export const overwriteText = o => `${earlierText(o.dir, o.item)} · ${nowText(o.item, o.after)}`;

// The earlier changes of the day, both directions: [{ dir, item }].
export function earlierOf(day) {
  return DIRS.flatMap(dir => dayChanges(baseCars(day, dir), effectiveCars(day, dir)).map(item => ({ dir, item })));
}

// In the amber card of the day coordinator: one folded line, the list when opened. Empty when the day still is the standard rooster.
export function earlierFoldHtml(day) {
  const list = earlierOf(day);
  if (!list.length) return '';
  const rows = list.map(({ dir, item }) => `<div class="logItem"><span class="logItem__dot" aria-hidden="true"></span><span class="logItem__main">${esc(earlierText(dir, item))}</span></div>`).join('');
  return foldHtml('wrearlier|' + day, `${phIcon('clock')}<span>${esc(t('weekrooster.earlier.title', { p1: lower(dayName(day)) }))} <b>${list.length}</b></span>`, rows, 'fold--earlier', 'wrEarlier' + day);
}

// The cars that are involved in an overwritten change (the driver then and the driver in the plan): they get a tag in the plan.
export function overDriversOf(over, dir) {
  const ids = new Set();
  over.filter(o => o.dir === dir).forEach(o => { if (o.item.driverId) ids.add(o.item.driverId); if (o.after && o.after.driverId) ids.add(o.after.driverId); });
  return ids;
}

// The block on top of the plan and in Controleren: which earlier changes the proposal takes back, and the total in cars when that changes.
// `adv`: the advice with the changes by hand; `plan`: the plan as it would run.
export function overwriteBlockHtml(over, adv, plan) {
  if (!over.length) return '';
  const count = src => Object.keys(plan.dirs).reduce((n, dir) => n + src(dir).filter(c => (c.girlIds || []).length).length, 0);
  const was = count(dir => adv.directions[dir].cars), now = count(dir => plan.dirs[dir].cars);
  const total = was === now ? '' : `<p class="alertCard__sub">${esc(now === 1 ? t('weekrooster.over.totalOne', { p1: was }) : t('weekrooster.over.totalMany', { p1: now, p2: was }))}</p>`;
  return `<div class="alertCard alertCard--stack" role="note"><div class="alertCard__head"><span class="alertCard__icon">${phIcon('arrow-counter-clockwise')}</span>
    <span class="alertCard__text"><b>${esc(over.length === 1 ? t('weekrooster.over.title1') : t('weekrooster.over.titleN', { p1: over.length }))}</b></span></div>
    ${over.map(o => `<div class="alertCard__row"><span>${esc(overwriteText(o))}</span></div>`).join('')}${total}</div>`;
}
// The reminder next to the button "Doorvoeren".
export const overwriteNoteHtml = over => (over.length ? `<p class="noteCard">${phIcon('warning')}<span>${esc(over.length === 1 ? t('weekrooster.over.foot1') : t('weekrooster.over.footN', { p1: over.length }))}</span></p>` : '');

// "Recente wijzigingen": the earlier changes a doorgevoerd plan took back, as acceptDay stored them: [{ id, dir, text, updatedAt }].
export function overwroteLog(day) {
  return DIRS.flatMap(dir => {
    const d = (S.deviations || {})[deviationKey(day, dir)];
    if (!d || d.weekKey !== S.currentWeekKey || !Array.isArray(d.overwrote) || typeof d.overwroteAt !== 'number') return [];
    return d.overwrote.filter(o => o && o.item).map((o, i) => ({ id: 'over_' + day + '_' + dir + '_' + i, dir, text: overwriteText({ dir, item: o.item, after: o.after || null }), updatedAt: d.overwroteAt, state: 'over' }));
  });
}
