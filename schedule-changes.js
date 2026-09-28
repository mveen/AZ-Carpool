// ============================================================
// AZ Carpool — schedule-change tracking (for coordinator notifications)
// ============================================================
// Pure functions only: no DOM, no Firebase, no globals — same contract as planning.js.
// Unit-tested in schedule-changes.test.js — run `node schedule-changes.test.js` after ANY
// change here, before it's wired back into index.html.
//
// A "change" is one day+direction whose time moved:
//   { day:'Ma', direction:'heen'|'terug', from:'08:30', to:'09:15' }
// ('' means "no time set", so adding or clearing a time also counts as a change.)
//
// Pending (not yet seen by the coordinator) changes are stored on the family document
// itself as `timeChanges: [{day, direction, from, to, at, by}]`. Keeping them there means
// no extra Firestore collection (and no extra security rules) is needed: parents can already
// write their own family doc, and the coordinator can already write every family doc.

export const DAY_KEYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr'];
export const DIRECTIONS = ['heen', 'terug'];

function timeOf(schedule, day, direction) {
  const d = schedule && schedule[day];
  const t = d && d[direction];
  return typeof t === 'string' ? t.trim() : '';
}

// Every day+direction whose time differs between two schedule objects, in weekday order.
export function diffSchedules(oldSchedule, newSchedule) {
  const changes = [];
  for (const day of DAY_KEYS) {
    for (const direction of DIRECTIONS) {
      const from = timeOf(oldSchedule, day, direction);
      const to = timeOf(newSchedule, day, direction);
      if (from !== to) changes.push({ day, direction, from, to });
    }
  }
  return changes;
}

// Fold freshly detected changes into the still-pending list for one family.
// - Same day+direction already pending: keep its ORIGINAL `from`, take the new `to`
//   (so 08:30→09:00→09:15 shows as a single 08:30→09:15).
// - If that makes to===from (changed and changed back), the entry disappears.
// - `at`/`by` always reflect the latest edit.
// Result is sorted in weekday order, heen before terug.
export function mergePendingChanges(pending, newChanges, meta = {}) {
  const byKey = new Map();
  for (const c of pending || []) byKey.set(c.day + '_' + c.direction, { ...c });
  for (const c of newChanges || []) {
    const key = c.day + '_' + c.direction;
    const existing = byKey.get(key);
    const entry = {
      day: c.day,
      direction: c.direction,
      from: existing ? existing.from : c.from,
      to: c.to,
      at: meta.at != null ? meta.at : (existing && existing.at) || null,
      by: meta.by != null ? meta.by : (existing && existing.by) || '',
    };
    if (entry.from === entry.to) byKey.delete(key);
    else byKey.set(key, entry);
  }
  const order = (c) => DAY_KEYS.indexOf(c.day) * 2 + DIRECTIONS.indexOf(c.direction);
  return [...byKey.values()].sort((a, b) => order(a) - order(b));
}

// All families that have pending changes, newest edit first:
// [{ familyId, girlName, parentName, changes:[...], latestAt }]
export function collectPendingChanges(families) {
  const list = [];
  for (const [familyId, f] of Object.entries(families || {})) {
    const changes = (f && Array.isArray(f.timeChanges)) ? f.timeChanges : [];
    if (!changes.length) continue;
    const latestAt = Math.max(0, ...changes.map((c) => c.at || 0));
    list.push({ familyId, girlName: f.girlName || '', parentName: f.parentName || '', changes, latestAt });
  }
  return list.sort((a, b) => b.latestAt - a.latestAt);
}

export function countPendingChanges(families) {
  return collectPendingChanges(families).reduce((n, f) => n + f.changes.length, 0);
}

// Human-readable (Dutch) one-liner, plain text — callers escape it before putting it in HTML.
export function describeChange(c) {
  const label = c.direction === 'heen' ? 'Heen (aankomst Alkmaar)' : 'Terug (klaar om op te halen)';
  const from = c.from || 'geen tijd';
  const to = c.to || 'geen tijd';
  return `${c.day} · ${label}: ${from} → ${to}`;
}
