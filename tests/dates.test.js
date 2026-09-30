// Run with: node dates.test.js
// Dates are the easiest thing to get subtly wrong (week 53, the weekend rolling to next week), so every
// test pins "now" with withFakeNow() and the Amsterdam timezone.
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
import { withFakeNow, resetState, NOW, WEEK_KEY } from './test-support.js';
import { S } from '../state.js';
import { dayUp, startOfWeek, effectivePlanningDate, dateForWeekday, getISOWeekKey, refreshWeekKey, deviationExpiryMs, deviationKey, weekRangeLabel, waDayDate, isoDayLabel, isoRangeLabel } from '../dates.js';

const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

console.log('=== small helpers ===');
test('dayUp capitalises day keys and copes with empty values', () => {
  assert.equal(dayUp('Ma'), 'MA'); assert.equal(dayUp(null), ''); assert.equal(dayUp(undefined), '');
});
test('deviationKey joins day and direction', () => { assert.equal(deviationKey('Di', 'heen'), 'Di_heen'); });

console.log('\n=== startOfWeek ===');
test('a Wednesday goes back to Monday 00:00', () => {
  const s = startOfWeek(new Date(2026, 8, 30, 15, 45));
  assert.equal(ymd(s), '2026-09-28'); assert.equal(s.getHours(), 0);
});
test('a Sunday belongs to the week that just ended (Monday is 6 days earlier)', () => {
  assert.equal(ymd(startOfWeek(new Date(2026, 9, 4))), '2026-09-28');
});
test('a Monday stays on itself', () => { assert.equal(ymd(startOfWeek(new Date(2026, 8, 28))), '2026-09-28'); });

console.log('\n=== effectivePlanningDate: the weekend already means "next week" ===');
test('on a weekday it is today', () => {
  withFakeNow(NOW, () => assert.equal(ymd(effectivePlanningDate()), '2026-09-30'));
});
test('on Saturday it is the coming Monday', () => {
  withFakeNow('2026-10-03T12:00:00+02:00', () => assert.equal(ymd(effectivePlanningDate()), '2026-10-05'));
});
test('on Sunday it is tomorrow (Monday)', () => {
  withFakeNow('2026-10-04T12:00:00+02:00', () => assert.equal(ymd(effectivePlanningDate()), '2026-10-05'));
});

console.log('\n=== dateForWeekday ===');
test('Wednesday 30 Sep: Ma is the 28th, Vr is 2 Oct', () => {
  withFakeNow(NOW, () => {
    assert.equal(ymd(dateForWeekday('Ma')), '2026-09-28');
    assert.equal(ymd(dateForWeekday('Vr')), '2026-10-02');
  });
});
test('on Saturday the day buttons already show next week', () => {
  withFakeNow('2026-10-03T12:00:00+02:00', () => assert.equal(ymd(dateForWeekday('Ma')), '2026-10-05'));
});

console.log('\n=== getISOWeekKey ===');
test('30 Sep 2026 is week 40', () => { assert.equal(getISOWeekKey(new Date(2026, 8, 30)), '2026-W40'); });
test('31 Dec 2026 and 1 Jan 2027 are still week 53 of 2026', () => {
  assert.equal(getISOWeekKey(new Date(2026, 11, 31)), '2026-W53');
  assert.equal(getISOWeekKey(new Date(2027, 0, 1)), '2026-W53');
});
test('4 Jan 2027 starts week 1 of 2027', () => { assert.equal(getISOWeekKey(new Date(2027, 0, 4)), '2027-W01'); });
test('30 Dec 2024 already belongs to week 1 of 2025', () => { assert.equal(getISOWeekKey(new Date(2024, 11, 30)), '2025-W01'); });
test('week numbers are zero-padded', () => { assert.equal(getISOWeekKey(new Date(2026, 0, 5)), '2026-W02'); });

console.log('\n=== refreshWeekKey ===');
test('returns false when the stored week is still right', () => {
  resetState({ currentWeekKey: WEEK_KEY });
  withFakeNow(NOW, () => assert.equal(refreshWeekKey(), false));
  assert.equal(S.currentWeekKey, WEEK_KEY);
});
test('returns true and updates the key when a new week has begun', () => {
  resetState({ currentWeekKey: '2026-W39' });
  withFakeNow(NOW, () => assert.equal(refreshWeekKey(), true));
  assert.equal(S.currentWeekKey, WEEK_KEY);
});
test('over the weekend the key already moves to next week', () => {
  resetState({ currentWeekKey: WEEK_KEY });
  withFakeNow('2026-10-03T09:00:00+02:00', () => assert.equal(refreshWeekKey(), true));
  assert.equal(S.currentWeekKey, '2026-W41');
});

console.log('\n=== deviationExpiryMs ===');
test('deviations expire on Saturday 00:00 Amsterdam time of their week', () => {
  withFakeNow(NOW, () => assert.equal(new Date(deviationExpiryMs()).toISOString(), '2026-10-02T22:00:00.000Z'));
});

console.log('\n=== labels ===');
test('weekRangeLabel: "Week 40 · 28 sep – 2 okt"', () => {
  resetState({ currentWeekKey: WEEK_KEY });
  withFakeNow(NOW, () => assert.equal(weekRangeLabel(), 'Week 40 · 28 sep – 2 okt'));
});
test('waDayDate: full Dutch date for a weekday key', () => {
  withFakeNow(NOW, () => assert.equal(waDayDate('Ma'), 'maandag 28 september'));
});

test('isoDayLabel: short and long weekday, or only the date', () => {
  assert.equal(isoDayLabel('2026-10-26'), 'ma 26 okt'); assert.equal(isoDayLabel('2026-10-16', 'long'), 'vrijdag 16 okt'); assert.equal(isoDayLabel('2026-10-26', ''), '26 okt');
});
test('isoRangeLabel: "26 – 30 okt" in one month, both months when the range crosses one', () => {
  assert.equal(isoRangeLabel('2026-10-26', '2026-10-30'), '26 – 30 okt');
  assert.equal(isoRangeLabel('2026-10-29', '2026-11-06'), '29 okt – 6 nov');
  assert.equal(isoRangeLabel('2026-12-28', '2027-01-08'), '28 dec – 8 jan');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
