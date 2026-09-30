// Run with: node period.test.js
// The "periode met andere tijden": validation of the Beheer form and the phases (waiting, open, closed, over).
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import './test-support.js';
import { PERIOD_MAX_WORKDAYS, isValidIsoDate, isValidTime, isWorkday, periodWorkdays, normalizePeriod, validatePeriod, storedPeriod, deadlineMs, periodPhase } from '../period.js';

// The design example: Herfstvakantie, ma 26 okt - vr 30 okt 2026, opens wo 14 okt, deadline vr 16 okt 12:00.
const GOOD = { name: 'Herfstvakantie', firstDay: '2026-10-26', lastDay: '2026-10-30', opensOn: '2026-10-14', deadlineDate: '2026-10-16', deadlineTime: '12:00' };
const ms = s => new Date(s).getTime();

console.log('=== dates and workdays ===');
test('real calendar dates and times are accepted, made-up ones are not', () => {
  assert.equal(isValidIsoDate('2026-10-26'), true);
  ['2026-02-30', '2026-13-01', '26-10-2026', '', null, undefined, '2026-10-26T10:00'].forEach(v => assert.equal(isValidIsoDate(v), false, String(v)));
  assert.equal(isValidTime('00:00'), true); assert.equal(isValidTime('23:59'), true);
  ['24:00', '12:60', '9:00', '', null].forEach(v => assert.equal(isValidTime(v), false, String(v)));
});
test('isWorkday: Monday to Friday only', () => {
  assert.equal(isWorkday('2026-10-26'), true);   // Monday
  assert.equal(isWorkday('2026-10-30'), true);   // Friday
  assert.equal(isWorkday('2026-10-31'), false);  // Saturday
  assert.equal(isWorkday('2026-11-01'), false);  // Sunday
  assert.equal(isWorkday('nonsense'), false);
});
test('periodWorkdays lists Monday-Friday days, weekends left out, both ends included', () => {
  assert.deepEqual(periodWorkdays('2026-10-26', '2026-10-30'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
  assert.equal(periodWorkdays('2026-10-26', '2026-11-06').length, 10);
  assert.equal(periodWorkdays('2026-10-26', '2026-11-09').length, 11);
  assert.deepEqual(periodWorkdays('2026-10-30', '2026-10-26'), []);
  assert.deepEqual(periodWorkdays('x', '2026-10-26'), []);
});
test('the daylight-saving change (25 Oct 2026) does not drop or repeat a day', () => {
  assert.equal(periodWorkdays('2026-10-19', '2026-10-30').length, 10);
});

console.log('\n=== validatePeriod ===');
test('the design example is valid and comes back trimmed', () => {
  const r = validatePeriod({ ...GOOD, name: '  Herfstvakantie ' });
  assert.equal(r.ok, true); assert.deepEqual(r.errors, []); assert.deepEqual(r.value, GOOD);
});
test('two weeks (10 workdays) is allowed, 11 is not', () => {
  assert.equal(PERIOD_MAX_WORKDAYS, 10);
  assert.equal(validatePeriod({ ...GOOD, lastDay: '2026-11-06' }).ok, true);
  assert.deepEqual(validatePeriod({ ...GOOD, lastDay: '2026-11-09' }).errors, ['period.err.tooLong']);
});
test('a single day is a period too', () => {
  assert.equal(validatePeriod({ ...GOOD, lastDay: '2026-10-26' }).ok, true);
});
test('name: required and not longer than 40 characters', () => {
  assert.deepEqual(validatePeriod({ ...GOOD, name: '   ' }).errors, ['period.err.name']);
  assert.deepEqual(validatePeriod({ ...GOOD, name: 'x'.repeat(41) }).errors, ['period.err.nameLong']);
  assert.equal(validatePeriod({ ...GOOD, name: 'x'.repeat(40) }).ok, true);
});
test('first and last day are required, real dates', () => {
  assert.deepEqual(validatePeriod({ ...GOOD, firstDay: '' }).errors, ['period.err.days']);
  assert.deepEqual(validatePeriod({ ...GOOD, lastDay: '2026-02-30' }).errors, ['period.err.days']);
});
test('first and last day must be workdays', () => {
  assert.deepEqual(validatePeriod({ ...GOOD, firstDay: '2026-10-24' }).errors, ['period.err.weekend']);
  assert.deepEqual(validatePeriod({ ...GOOD, lastDay: '2026-11-01' }).errors, ['period.err.weekend']);
});
test('the last day cannot be before the first day', () => {
  assert.deepEqual(validatePeriod({ ...GOOD, firstDay: '2026-10-30', lastDay: '2026-10-26' }).errors, ['period.err.order']);
});
test('opening date and deadline (date and time) are required', () => {
  assert.deepEqual(validatePeriod({ ...GOOD, opensOn: '' }).errors, ['period.err.opens']);
  assert.deepEqual(validatePeriod({ ...GOOD, deadlineTime: '' }).errors, ['period.err.deadline']);
  assert.deepEqual(validatePeriod({ ...GOOD, deadlineDate: '' }).errors, ['period.err.deadline']);
});
test('the deadline cannot be before the day filling in opens; it may be the same day', () => {
  assert.deepEqual(validatePeriod({ ...GOOD, deadlineDate: '2026-10-13' }).errors, ['period.err.deadlineBeforeOpen']);
  assert.equal(validatePeriod({ ...GOOD, deadlineDate: '2026-10-14' }).ok, true);
});
test('the deadline must be before the first day of the period', () => {
  assert.deepEqual(validatePeriod({ ...GOOD, deadlineDate: '2026-10-26' }).errors, ['period.err.deadlineAfterStart']);
  assert.equal(validatePeriod({ ...GOOD, deadlineDate: '2026-10-25' }).ok, true);
});
test('every problem is reported, in the order of the form', () => {
  assert.deepEqual(validatePeriod({}).errors, ['period.err.name', 'period.err.days', 'period.err.opens', 'period.err.deadline']);
  assert.deepEqual(validatePeriod(null).errors.length, 4);
});
test('normalizePeriod copes with junk and never returns undefined fields', () => {
  assert.deepEqual(normalizePeriod(null), { name: '', firstDay: '', lastDay: '', opensOn: '', deadlineDate: '', deadlineTime: '' });
  assert.equal(normalizePeriod({ name: 5 }).name, '5');
});
test('storedPeriod: a valid document is used, a broken one counts as no period', () => {
  assert.deepEqual(storedPeriod(GOOD), GOOD);
  assert.equal(storedPeriod({ ...GOOD, lastDay: '' }), null);
  assert.equal(storedPeriod(null), null); assert.equal(storedPeriod('x'), null);
});

console.log('\n=== deadline and phases ===');
test('deadlineMs is the local moment of date + time', () => {
  assert.equal(deadlineMs(GOOD), ms('2026-10-16T12:00:00+02:00'));
  assert.equal(deadlineMs({ ...GOOD, deadlineTime: '' }), null);
});
test('periodPhase follows the calendar: none, waiting, open, closed, over', () => {
  assert.equal(periodPhase(null, ms('2026-10-01T10:00:00+02:00')), 'none');
  assert.equal(periodPhase({ ...GOOD, name: '' }, ms('2026-10-20T10:00:00+02:00')), 'none');
  assert.equal(periodPhase(GOOD, ms('2026-10-13T23:59:00+02:00')), 'waiting');
  assert.equal(periodPhase(GOOD, ms('2026-10-14T00:00:00+02:00')), 'open');
  assert.equal(periodPhase(GOOD, ms('2026-10-16T11:59:00+02:00')), 'open');
  assert.equal(periodPhase(GOOD, ms('2026-10-16T12:00:00+02:00')), 'closed');
  assert.equal(periodPhase(GOOD, ms('2026-10-28T09:00:00+01:00')), 'closed');
  assert.equal(periodPhase(GOOD, ms('2026-10-30T23:59:00+01:00')), 'closed');
  assert.equal(periodPhase(GOOD, ms('2026-10-31T00:00:00+01:00')), 'over');
});
test('without a moment given, periodPhase uses the clock (frozen at Wed 30 Sep 2026 10:00)', () => {
  assert.equal(periodPhase(GOOD), 'waiting');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
