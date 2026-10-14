// notif-text.js — the words of a Ritten-ruilen notification (title + body), as plain text. PURE: no DOM, no database.
// The in-app inbox (ui-ritbeurs.js), the preview in Beheer (ui-push.js) and the push sender on the server (cron/push.mjs) all use this,
// so a notification reads the same everywhere. Callers escape the text when they put it in HTML; here it is never escaped.
import { t } from './i18n.js';
import { DAYS } from './constants.js';
import { weekKeyDayIso } from './dates.js';

const TEXT = {
  offerBackup: p => ({ title: t('ritbeurs.notif.offerBackup', p), body: t('ritbeurs.notif.offerBackupBody', p) }),
  backupForRide: p => ({ title: t('ritbeurs.notif.backupForRide', p), body: t('ritbeurs.notif.backupForRideBody', p) }),
  taken: p => ({ title: t('ritbeurs.notif.taken', p), body: t('ritbeurs.notif.takenBody', p) }),
  takenDayCoordinator: p => ({ title: t('ritbeurs.notif.takenDayCoordinator', p), body: t('ritbeurs.notif.takenDayCoordinatorBody', p) }),
  uncovered: p => ({ title: t('ritbeurs.notif.uncovered', p), body: t('ritbeurs.notif.uncoveredBody', p) }),
};
export const NOTIFICATION_KINDS = Object.keys(TEXT);

const dayLabel = k => (DAYS.find(([d]) => d === k) || [k, String(k || '')])[1];

// "do 16:15" — the ride a notification is about.
export function whenText(day, time){ return `${dayLabel(day).toLowerCase()} ${time || ''}`.trim(); }

// n = the notification document. ctx = { nameOf(familyId) -> name or '' , currentWeekKey }.
// Returns { title, body }, or null for a kind this version does not know (a newer app may write one).
export function notificationText(n, ctx){
  if(!n || !TEXT[n.kind]) return null;
  const nameOf = (ctx && ctx.nameOf) || (() => '');
  const weekKey = n.weekKey || (ctx && ctx.currentWeekKey) || '';
  const day = DAYS.find(([k]) => weekKey && weekKeyDayIso(weekKey, k) === n.date);
  const p = {
    when: whenText(n.day, n.time),
    who: nameOf(n.fromFamilyId) || t('ritbeurs.notif.onbekend'),
    date: (day ? day[1] : n.date || '').toLowerCase(),
    from: n.momentFrom, to: n.momentTo,
  };
  return TEXT[n.kind](p);
}
