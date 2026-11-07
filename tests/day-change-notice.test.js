// Run with: node day-change-notice.test.js
// "Melding dagwijzigingen" (day-change-notice.js): when the hint in "Wijzigingen voor <dag>" is shown, validation of the Beheer form, the stored document.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import './test-support.js';
import { DEFAULT_UNTIL, normalizeDayChangeNotice, dayChangeNoticeCutoffMs, dayChangeNoticeFor, validateDayChangeNotice, dayChangeNoticeDoc } from '../day-change-notice.js';

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();   // November 2026, local time: 8 Nov is a Sunday, 9 Nov a Monday
const MON = '2026-11-09';

console.log('=== settings ===');
test('no document, or a broken one: switched on at 11:00', () => {
  assert.equal(DEFAULT_UNTIL, '11:00');
  for (const raw of [null, undefined, {}, 'x', { until: '25:99' }, { on: 'ja', until: '' }]) assert.deepEqual(normalizeDayChangeNotice(raw), { on: true, until: '11:00' });
});
test('only an explicit off switches it off; a valid time is kept', () => {
  assert.deepEqual(normalizeDayChangeNotice({ on: false, until: '09:30' }), { on: false, until: '09:30' });
  assert.deepEqual(normalizeDayChangeNotice({ on: true, until: '13:15' }), { on: true, until: '13:15' });
});

console.log('=== when the hint shows ===');
test('the cut-off is the day before, at the chosen time (Monday: Sunday)', () => {
  assert.equal(dayChangeNoticeCutoffMs(MON, '11:00'), at(8, 11));
  assert.equal(dayChangeNoticeCutoffMs('2026-12-01', '11:00'), new Date(2026, 10, 30, 11).getTime());   // across a month
});
test('shown up to 10:59 on the day before, gone from 11:00', () => {
  assert.ok(dayChangeNoticeFor(null, MON, at(8, 10, 59)));
  assert.equal(dayChangeNoticeFor(null, MON, at(8, 11)), null);
  assert.equal(dayChangeNoticeFor(null, MON, at(8, 20)), null);
});
test('shown on all earlier days too', () => {
  assert.ok(dayChangeNoticeFor(null, MON, at(5, 8))); assert.ok(dayChangeNoticeFor(null, MON, at(7, 23, 59)));
});
test('the time is the coordinator\'s: 14:00 keeps it up longer, and it also applies to a day that is already today', () => {
  assert.ok(dayChangeNoticeFor({ on: true, until: '14:00' }, MON, at(8, 13, 59)));
  assert.equal(dayChangeNoticeFor({ on: true, until: '14:00' }, MON, at(8, 14)), null);
  assert.equal(dayChangeNoticeFor(null, MON, at(9, 8)), null);
});
test('switched off, or no valid day: never', () => {
  assert.equal(dayChangeNoticeFor({ on: false, until: '11:00' }, MON, at(5, 8)), null);
  assert.equal(dayChangeNoticeFor(null, null, at(5, 8)), null);
  assert.equal(dayChangeNoticeFor(null, '2026-13-40', at(5, 8)), null);
});
test('it says which day before it is, and whether that is today', () => {
  assert.deepEqual(dayChangeNoticeFor(null, MON, at(5, 8)), { dayBeforeIso: '2026-11-08', isToday: false });
  assert.deepEqual(dayChangeNoticeFor(null, MON, at(8, 8)), { dayBeforeIso: '2026-11-08', isToday: true });
});

console.log('=== Beheer form and stored document ===');
test('a valid time is accepted, an empty or broken one refused with a message', () => {
  assert.deepEqual(validateDayChangeNotice({ on: true, until: '11:00' }), { ok: true, errors: [], value: { on: true, until: '11:00' } });
  assert.deepEqual(validateDayChangeNotice({ on: false, until: '08:45' }).value, { on: false, until: '08:45' });
  for (const until of ['', '25:00', 'elf uur', undefined]) assert.deepEqual(validateDayChangeNotice({ on: true, until }).errors, ['dayNotice.err.time']);
  assert.equal(validateDayChangeNotice(null).ok, false);
});
test('the stored document has the switch, the time and when it was saved, nothing else', () => {
  assert.deepEqual(dayChangeNoticeDoc({ on: true, until: '11:00', extra: 1 }, 123), { on: true, until: '11:00', updatedAt: 123 });
  assert.deepEqual(dayChangeNoticeDoc({ on: false, until: 'x' }, 5), { on: false, until: '11:00', updatedAt: 5 });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
