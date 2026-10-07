// maintenance.js — onderhoudsmodus: the coordinator switches it on in Beheer; every other user then sees a full-screen
// "the app is temporarily unavailable" page. Pure logic only (no DOM, no database).
// Stored in settings/maintenance: { on, text, updatedAt }. Members read, only the coordinator writes (general settings rule).

export const MAINTENANCE_MAX = 150;

// One line of plain text, at most MAINTENANCE_MAX characters. Never HTML: the UI escapes it again when it shows it.
export function cleanMaintenanceText(s){
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, MAINTENANCE_MAX).trim();
}

// What the app keeps in memory (S.maintenance) for any stored (or missing, or broken) document. Only `on === true` counts as on.
export function normalizeMaintenance(raw){
  const r = raw && typeof raw === 'object' ? raw : {};
  return { on: r.on === true, text: cleanMaintenanceText(r.text) };
}

// Does the maintenance page replace the app for this user? Only the real coordinator is never blocked
// (also while testing as a parent: the test view changes what is shown, not who the user is).
export function maintenanceBlocks(m, isRealCoordinator){
  return normalizeMaintenance(m).on && !isRealCoordinator;
}

// The document written to settings/maintenance. The text is kept when the mode is switched off.
export function maintenanceDoc(value, nowMs){
  const v = normalizeMaintenance(value);
  return { on: v.on, text: v.text, updatedAt: nowMs };
}
