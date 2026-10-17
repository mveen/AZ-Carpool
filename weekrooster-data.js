// weekrooster-data.js — Afwijkend weekrooster, the database side. The rules are in weekrooster.js; the Beheer card is in ui-weekrooster.js.
//
// Phase 1 only holds the feature switch (settings/weekrooster). With mode "uit" (the default, also for a missing document or an unknown
// value) nothing of the new flow is shown or written; the Firestore rules check the same switch, so an app that is still open stops too.
import { t } from './i18n.js';
import { S } from './state.js';
import { isRealCoordinator } from './coordinator.js';
import { showToast } from './ui-common.js';
import { db } from './data.js';
import { normalizeWeekrooster, weekroosterDoc, weekroosterVisible } from './weekrooster.js';

export function weekroosterMode() { return normalizeWeekrooster(S.weekrooster).mode; }
// Does THIS person see and use the new flow? "test": only the real coordinator (Testweergave does not change that). "aan": everybody.
export function weekroosterOn() { return weekroosterVisible(weekroosterMode(), isRealCoordinator()); }

// The coordinator switches the feature: 'uit' | 'test' | 'aan'. Saves at once. Existing data is never touched.
export async function setWeekrooster(mode) {
  if (!db) { showToast(t('data.geen_verbinding_met_opslag')); return false; }
  if (!isRealCoordinator()) { showToast(t('weekrooster.err.coordinatorOnly')); return false; }
  const next = normalizeWeekrooster({ mode }).mode;
  try {
    await db.doc('settings/weekrooster').set(weekroosterDoc(next, Date.now()));
    S.weekrooster = normalizeWeekrooster({ mode: next });
    showToast(next === 'aan' ? t('weekrooster.saved.aan') : next === 'test' ? t('weekrooster.saved.test') : t('weekrooster.saved.uit'));
    return true;
  } catch (e) { showToast(t('data.mislukt') + (e && e.message || e)); return false; }
}
