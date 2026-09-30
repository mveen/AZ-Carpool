// Run with: node state.test.js
// The shared app state lives on one object (S). These tests catch typos: a module reading S.somethingg
// would otherwise silently get undefined.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import fs from 'node:fs';
import { S } from '../state.js';

console.log('=== state.js ===');
test('S has the expected top-level fields with safe starting values', () => {
  assert.equal(S.me, null);
  assert.equal(S.canEdit, false);
  assert.deepEqual(S.families, {});
  assert.deepEqual(S.groups, {});
  assert.deepEqual(S.deviations, {});
  assert.deepEqual(S.links, {});
  assert.deepEqual(S.prefs, { rules: [] });
  assert.equal(S.settings.travelLeadMinutes, 60);
  assert.equal(S.roosterMode, 'week');
  assert.equal(S.weekschemaBase, null); assert.equal(S.weekschemaEdit, null); // Mijn gezin: no Weekschema edit is waiting for confirmation
});
test('coordEditId starts undefined (renderBeheer distinguishes "no editor" from "new family")', () => {
  assert.equal(S.coordEditId, undefined);
  assert.ok('coordEditId' in S);
});
test('week key and selected day are filled in by app.js at start-up, not here', () => {
  assert.equal(S.currentWeekKey, null);
  assert.equal(S.scheduleDay, null);
});
test('every S.<name> used by any module exists in state.js', () => {
  const dir = new URL('../', import.meta.url);
  const known = new Set(Object.keys(S));
  const unknown = new Set();
  fs.readdirSync(dir).filter(f => f.endsWith('.js') && !f.includes('.test.') && !['test-support.js', 'fake-db.js', 'run-tests.js'].includes(f)).forEach(f => {
    const code = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    for (const m of code.matchAll(/\bS\.(\w+)/g)) if (!known.has(m[1])) unknown.add(m[1] + ' (' + f + ')');
  });
  assert.deepEqual([...unknown], []);
});



test('dayCoordinators starts empty (Beheer fills it)', () => { assert.deepEqual(S.dayCoordinators, {}); });

test('periods (Beheer: perioden met andere tijden) start empty, with no unsaved form edits and none chosen', () => { assert.deepEqual(S.periods, {}); assert.deepEqual(S.periodsColl, {}); assert.equal(S.legacyPeriod, null); assert.equal(S.periodDraft, null); assert.equal(S.periodSel, null); });

test('handed-in period times: nothing loaded, no form open, no state remembered', () => {
  assert.deepEqual(S.periodEntries, {}); assert.equal(S.periodEntriesLoaded, false); assert.equal(S.periodForm, null); assert.equal(S.periodView, null); assert.equal(S.periodPhaseKey, null);
});

test('temporary rooster: no shifts loaded, no date open', () => { assert.deepEqual(S.periodCars, {}); assert.equal(S.periodDay, null); });

test('new fields: places, calculated distances and the impact switch start empty', () => {
  assert.equal(S.locationsDoc, null); assert.deepEqual(S.matchDistances, {}); assert.equal(S.matchDistancesLoaded, false); assert.equal(S.impactPreview, null);
});

test('collapsible sections start with nothing open', () => { assert.deepEqual(S.folds, {}); });

test('the notice state starts empty', () => { assert.equal(S.notice, null); assert.equal(S.noticeDraft, null); });

test('the last-session map starts empty and has no listener', () => {
  assert.deepEqual(S.lastSeenByFamily, {}); assert.equal(S.sessionsUnsub, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
