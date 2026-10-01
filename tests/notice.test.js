// Run with: node notice.test.js
// "Melding voor iedereen" (notice.js): text cleaning, when the notice is visible, validation of the Beheer form, the stored document.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import './test-support.js';
import { NOTICE_MAX, cleanNoticeText, normalizeNotice, noticeOffAt, noticeActive, validateNotice, noticeDoc } from '../notice.js';

const NOW = new Date(2026, 8, 30, 10, 0).getTime();   // 30 Sep 2026 10:00 local
const at = (d, h, m = 0) => new Date(2026, 8, d, h, m).getTime();

console.log('=== text ===');
test('the text is one line of plain text, cut at 100 characters', () => {
  assert.equal(NOTICE_MAX, 100);
  assert.equal(cleanNoticeText('  Zaterdag\n geen   training.  '), 'Zaterdag geen training.');
  assert.equal(cleanNoticeText('x'.repeat(150)).length, 100);
  assert.equal(cleanNoticeText(null), ''); assert.equal(cleanNoticeText(undefined), '');
});
test('HTML in the text is kept as text (the UI escapes it), never interpreted here', () => {
  assert.equal(cleanNoticeText('<b>Let op</b>'), '<b>Let op</b>');
});

console.log('=== normalize ===');
test('a missing or broken document becomes: off, empty, no end', () => {
  [null, undefined, 'x', 5, {}, { on: 'yes' }].forEach(r => assert.deepEqual(normalizeNotice(r), { on: false, text: '', offDate: '', offTime: '' }));
});
test('only a real date and a real time survive', () => {
  assert.deepEqual(normalizeNotice({ on: true, text: 'Hoi', offDate: '2026-10-02', offTime: '18:30' }), { on: true, text: 'Hoi', offDate: '2026-10-02', offTime: '18:30' });
  assert.equal(normalizeNotice({ offDate: '2026-02-31' }).offDate, '');
  assert.equal(normalizeNotice({ offTime: '25:00' }).offTime, '');
});

console.log('=== when is it visible ===');
test('off, or on without text: never visible', () => {
  assert.equal(noticeActive({ on: false, text: 'Hoi' }, NOW), false);
  assert.equal(noticeActive({ on: true, text: '   ' }, NOW), false);
  assert.equal(noticeActive(null, NOW), false);
});
test('on without an end: visible', () => { assert.equal(noticeActive({ on: true, text: 'Hoi' }, NOW), true); });
test('on with an end: visible before, gone at and after the end moment', () => {
  const n = { on: true, text: 'Hoi', offDate: '2026-09-30', offTime: '18:00' };
  assert.equal(noticeOffAt(n), at(30, 18));
  assert.equal(noticeActive(n, at(30, 17, 59)), true);
  assert.equal(noticeActive(n, at(30, 18)), false);
  assert.equal(noticeActive(n, at(30, 18, 1)), false);
});
test('a date without a time (or the other way round) means no end', () => {
  assert.equal(noticeOffAt({ offDate: '2026-09-30' }), null); assert.equal(noticeOffAt({ offTime: '18:00' }), null);
});

console.log('=== validate (Beheer form) ===');
test('switching on needs a text', () => {
  const r = validateNotice({ on: true, text: '  ' }, NOW);
  assert.equal(r.ok, false); assert.deepEqual(r.errors, ['notice.err.noText']);
});
test('switching off without a text is fine (nothing to show)', () => { assert.equal(validateNotice({ on: false, text: '' }, NOW).ok, true); });
test('date and time belong together', () => {
  assert.deepEqual(validateNotice({ on: true, text: 'Hoi', offDate: '2026-10-01', offTime: '' }, NOW).errors, ['notice.err.offBoth']);
  assert.deepEqual(validateNotice({ on: true, text: 'Hoi', offDate: '', offTime: '12:00' }, NOW).errors, ['notice.err.offBoth']);
});
test('an impossible date or time is refused', () => {
  assert.deepEqual(validateNotice({ on: true, text: 'Hoi', offDate: '2026-02-31', offTime: '12:00' }, NOW).errors, ['notice.err.invalidOff']);
});
test('an end moment in the past is refused while switched on, allowed while off', () => {
  const past = { text: 'Hoi', offDate: '2026-09-29', offTime: '12:00' };
  assert.deepEqual(validateNotice({ on: true, ...past }, NOW).errors, ['notice.err.offPast']);
  assert.equal(validateNotice({ on: false, ...past }, NOW).ok, true);
});
test('a good form is ok and returns the cleaned value', () => {
  const r = validateNotice({ on: true, text: ' Zaterdag  geen training. ', offDate: '2026-10-03', offTime: '09:00' }, NOW);
  assert.equal(r.ok, true); assert.deepEqual(r.value, { on: true, text: 'Zaterdag geen training.', offDate: '2026-10-03', offTime: '09:00' });
});

console.log('=== stored document ===');
test('noticeDoc has the fields and the end as a moment (ms), or null', () => {
  assert.deepEqual(noticeDoc({ on: true, text: 'Hoi', offDate: '2026-10-03', offTime: '09:00' }, NOW), { on: true, text: 'Hoi', offDate: '2026-10-03', offTime: '09:00', offAt: new Date(2026, 9, 3, 9, 0).getTime(), updatedAt: NOW });
  assert.deepEqual(noticeDoc({ on: false, text: 'Hoi' }, NOW), { on: false, text: 'Hoi', offDate: '', offTime: '', offAt: null, updatedAt: NOW });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
