// Run with: node notice.test.js
// The "melding voor iedereen": cleaning, validation and when the notice is visible (pure functions).
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { NOTICE_MAX, cleanNoticeText, normalizeNotice, noticeOffAt, noticeActive, validateNotice, noticeDoc } from '../notice.js';

const at = (d, h, m) => new Date(2026, 8, d, h, m).getTime();
const NOW = at(30, 12, 0);

test('text: one line, trimmed, at most 100 characters, never undefined', () => {
  assert.equal(cleanNoticeText('  Geen \n training   zaterdag '), 'Geen training zaterdag');
  assert.equal(cleanNoticeText('x'.repeat(150)).length, NOTICE_MAX);
  assert.equal(cleanNoticeText(undefined), '');
});
test('normalizeNotice survives missing or broken documents', () => {
  assert.deepEqual(normalizeNotice(null), { on: false, text: '', offDate: '', offTime: '' });
  assert.deepEqual(normalizeNotice({ on: 'yes', text: 'a', offDate: 'morgen', offTime: '25:00' }), { on: false, text: 'a', offDate: '', offTime: '' });
});
test('noticeOffAt needs both date and time', () => {
  assert.equal(noticeOffAt({ offDate: '2026-10-01', offTime: '18:30' }), new Date(2026, 9, 1, 18, 30).getTime());
  assert.equal(noticeOffAt({ offDate: '2026-10-01' }), null);
});
test('visible only when on, with text, and before its end moment', () => {
  const base = { on: true, text: 'Zaterdag geen training', offDate: '2026-09-30', offTime: '18:00' };
  assert.equal(noticeActive(base, NOW), true);
  assert.equal(noticeActive(base, at(30, 18, 0)), false);
  assert.equal(noticeActive({ ...base, offDate: '', offTime: '' }, at(30, 23, 59)), true);
  assert.equal(noticeActive({ ...base, on: false }, NOW), false);
  assert.equal(noticeActive({ ...base, text: '  ' }, NOW), false);
  assert.equal(noticeActive(null, NOW), false);
});
test('validateNotice: text needed when on, date and time together, end in the future', () => {
  assert.deepEqual(validateNotice({ on: true, text: '' }, NOW).errors, ['notice.err.noText']);
  assert.deepEqual(validateNotice({ on: true, text: 'a', offDate: '2026-10-01' }, NOW).errors, ['notice.err.offBoth']);
  assert.deepEqual(validateNotice({ on: true, text: 'a', offDate: 'x', offTime: '10:00' }, NOW).errors, ['notice.err.invalidOff']);
  assert.deepEqual(validateNotice({ on: true, text: 'a', offDate: '2026-09-29', offTime: '10:00' }, NOW).errors, ['notice.err.offPast']);
  assert.equal(validateNotice({ on: false, text: '' }, NOW).ok, true);
  assert.equal(validateNotice({ on: true, text: 'a', offDate: '2026-10-01', offTime: '10:00' }, NOW).ok, true);
});
test('noticeDoc stores the end moment and the time of saving', () => {
  const d = noticeDoc({ on: true, text: 'a', offDate: '2026-10-01', offTime: '10:00' }, NOW);
  assert.equal(d.offAt, new Date(2026, 9, 1, 10, 0).getTime()); assert.equal(d.updatedAt, NOW); assert.equal(d.on, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
