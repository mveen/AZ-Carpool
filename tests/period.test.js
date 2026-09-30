// Run with: node period.test.js
// The "periode met andere tijden": validation of the Beheer form and the phases (waiting, open, closed, over).
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import './test-support.js';
import { PERIOD_MAX_WORKDAYS, isValidIsoDate, isValidTime, isWorkday, periodWorkdays, normalizePeriod, validatePeriod, storedPeriod, deadlineMs, periodPhase, periodEntryId, periodDayKey, standardDay, defaultEntryDays, validateEntry, describeEntryDay, periodEntryState, periodProgress, periodShiftId, periodMoveGirl, periodSetDriver, periodList, periodForDate, mergePeriods } from '../period.js';

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

console.log('\n=== the times a family hands in (step 2) ===');
const FAM = { girlName: 'Jahaimy', schedule: { Ma: { heen: '08:30', terug: '17:30' }, Di: { heen: '10:30', terug: '12:30' }, Do: { heen: '08:30', terug: '17:30' }, Vr: { heen: '08:30', terug: '17:30' } } };   // no Wednesday
test('periodEntryId and periodDayKey', () => {
  assert.equal(periodEntryId(GOOD, 'f2'), '2026-10-26_f2');
  assert.equal(periodDayKey('2026-10-26'), 'Ma'); assert.equal(periodDayKey('2026-10-30'), 'Vr'); assert.equal(periodDayKey('2026-10-31'), null); assert.equal(periodDayKey('x'), null);
});
test('standardDay reads the standard rooster; a missing day or a bad time is empty', () => {
  assert.deepEqual(standardDay(FAM, '2026-10-26'), { heen: '08:30', terug: '17:30' });
  assert.deepEqual(standardDay(FAM, '2026-10-28'), { heen: '', terug: '' });
  assert.deepEqual(standardDay({ schedule: { Ma: { heen: 'x', terug: '09:00' } } }, '2026-10-26'), { heen: '', terug: '09:00' });
  assert.deepEqual(standardDay(null, '2026-10-26'), { heen: '', terug: '' });
});
test('the form starts as the standard rooster; a day without standard times starts as "rijdt niet mee"', () => {
  const d = defaultEntryDays(GOOD, FAM);
  assert.deepEqual(Object.keys(d), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
  assert.deepEqual(d['2026-10-26'], { out: false, heen: '08:30', terug: '17:30' });
  assert.deepEqual(d['2026-10-28'], { out: true, heen: '', terug: '' });
  assert.deepEqual(defaultEntryDays(null, FAM), {});
});
const okDays = () => { const d = defaultEntryDays(GOOD, FAM); d['2026-10-28'] = { out: true }; return d; };
test('validateEntry stores the standard as it is, "out" days as {out:true} and only the times that are filled in', () => {
  const r = validateEntry(GOOD, { ...okDays(), '2026-10-27': { out: false, heen: '10:30', terug: '' }, '2026-10-29': { out: false, heen: '', terug: '12:30' } });
  assert.equal(r.ok, true); assert.deepEqual(r.errors, []);
  assert.deepEqual(r.days, { '2026-10-26': { heen: '08:30', terug: '17:30' }, '2026-10-27': { heen: '10:30' }, '2026-10-28': { out: true }, '2026-10-29': { terug: '12:30' }, '2026-10-30': { heen: '08:30', terug: '17:30' } });
});
test('validateEntry: every workday must be there; days outside the period are dropped', () => {
  const d = okDays(); delete d['2026-10-27'];
  assert.deepEqual(validateEntry(GOOD, d).errors, [{ day: '2026-10-27', key: 'period.entry.err.missing' }]);
  const r = validateEntry(GOOD, { ...okDays(), '2026-11-02': { out: true } });
  assert.equal(r.ok, true); assert.equal('2026-11-02' in r.days, false);
});
test('validateEntry: a riding day needs a time, a valid one, and Terug after Heen', () => {
  const bad = (day) => validateEntry(GOOD, { ...okDays(), '2026-10-27': day }).errors;
  assert.deepEqual(bad({ out: false, heen: '', terug: '' }), [{ day: '2026-10-27', key: 'period.entry.err.noTime' }]);
  assert.deepEqual(bad({ out: false, heen: '25:00', terug: '' }), [{ day: '2026-10-27', key: 'period.entry.err.time' }]);
  assert.deepEqual(bad({ out: false, heen: '12:00', terug: '11:00' }), [{ day: '2026-10-27', key: 'period.entry.err.order' }]);
  assert.deepEqual(bad({ out: false, heen: '12:00', terug: '12:00' }), [{ day: '2026-10-27', key: 'period.entry.err.order' }]);
  assert.deepEqual(bad(null), [{ day: '2026-10-27', key: 'period.entry.err.missing' }]);
  assert.deepEqual(bad({ out: true, heen: '99', terug: '' }), [], 'an "out" day ignores the times');
});
test('validateEntry without a usable period reports that, and stores nothing', () => {
  const r = validateEntry(null, {}); assert.equal(r.ok, false); assert.deepEqual(r.errors, [{ day: '', key: 'period.entry.err.noPeriod' }]); assert.deepEqual(r.days, {});
  assert.equal(validateEntry(GOOD, { ...okDays(), '2026-10-27': { out: false, heen: '99', terug: '' } }).ok, false);
});
test('describeEntryDay compares with the standard rooster and names only what differs', () => {
  assert.deepEqual(describeEntryDay(FAM, '2026-10-26', { heen: '08:30', terug: '17:30' }), { kind: 'standard' });
  assert.deepEqual(describeEntryDay(FAM, '2026-10-27', { heen: '10:30', terug: '13:00' }), { kind: 'times', terug: '13:00' });
  assert.deepEqual(describeEntryDay(FAM, '2026-10-27', { heen: '09:00', terug: '12:30' }), { kind: 'times', heen: '09:00' });
  assert.deepEqual(describeEntryDay(FAM, '2026-10-27', { heen: '10:30' }), { kind: 'times', terug: null });
  assert.deepEqual(describeEntryDay(FAM, '2026-10-26', { out: true }), { kind: 'out' });
  assert.deepEqual(describeEntryDay(FAM, '2026-10-28', { out: true }), { kind: 'standard' }, 'no standard times: not riding is the standard');
  assert.deepEqual(describeEntryDay(FAM, '2026-10-28', { heen: '09:00' }), { kind: 'times', heen: '09:00' }, 'riding on a day without standard times: only the new time is named');
});
console.log('\n=== who sees a task, and who can still change times ===');
const at = s => ms(s);
const ctx = (o = {}) => ({ hasFamily: true, isFlex: false, canEdit: false, ...o });
const entryDoc = { familyId: 'f2', periodFirstDay: '2026-10-26', days: {} };
test('before filling in opens, and after the period, nothing shows', () => {
  assert.equal(periodEntryState(GOOD, undefined, ctx(), at('2026-10-13T12:00:00+02:00')).show, null);
  assert.equal(periodEntryState(GOOD, undefined, ctx({ canEdit: true }), at('2026-10-13T12:00:00+02:00')).show, null);
  assert.equal(periodEntryState(GOOD, undefined, ctx({ canEdit: true }), at('2026-11-02T12:00:00+01:00')).show, null);
  assert.equal(periodEntryState(GOOD, entryDoc, ctx(), at('2026-11-02T12:00:00+01:00')).show, null);
  assert.equal(periodEntryState(null, undefined, ctx(), at('2026-10-15T12:00:00+02:00')).show, null);
});
test('while filling in is open: a task with a badge until the times are handed in, then a "doorgegeven" card that can be changed', () => {
  assert.deepEqual(periodEntryState(GOOD, undefined, ctx(), at('2026-10-15T09:00:00+02:00')), { show: 'task', canEdit: true, badge: true, phase: 'open' });
  assert.deepEqual(periodEntryState(GOOD, entryDoc, ctx(), at('2026-10-15T09:00:00+02:00')), { show: 'done', canEdit: true, badge: false, phase: 'open' });
});
test('after the deadline a parent can change nothing: the handed-in card stays (read only), without an entry nothing shows', () => {
  assert.deepEqual(periodEntryState(GOOD, entryDoc, ctx(), at('2026-10-20T09:00:00+02:00')), { show: 'done', canEdit: false, badge: false, phase: 'closed' });
  assert.equal(periodEntryState(GOOD, undefined, ctx(), at('2026-10-20T09:00:00+02:00')).show, null);
});
test('after the deadline the coordinator can still fill in and change, without a badge', () => {
  assert.deepEqual(periodEntryState(GOOD, undefined, ctx({ canEdit: true }), at('2026-10-20T09:00:00+02:00')), { show: 'task', canEdit: true, badge: false, phase: 'closed' });
  assert.deepEqual(periodEntryState(GOOD, entryDoc, ctx({ canEdit: true }), at('2026-10-20T09:00:00+02:00')), { show: 'done', canEdit: true, badge: false, phase: 'closed' });
});
test('no family (not linked yet), or a Flex family (signs up per day): no task and no badge', () => {
  assert.equal(periodEntryState(GOOD, undefined, ctx({ hasFamily: false }), at('2026-10-15T09:00:00+02:00')).show, null);
  assert.equal(periodEntryState(GOOD, undefined, ctx({ isFlex: true }), at('2026-10-15T09:00:00+02:00')).badge, false);
  assert.equal(periodEntryState(GOOD, undefined, undefined, at('2026-10-15T09:00:00+02:00')).show, null);
});

console.log('\n=== who has handed in (step 3) ===');
test('periodProgress counts the families that handed in for THIS period; Flex families are not counted', () => {
  const fams = { f1: { girlName: 'A' }, f2: { girlName: 'B' }, f3: { girlName: 'C', familyType: 'flex' }, f4: { girlName: 'D' } };
  const entries = { '2026-10-26_f2': {}, '2026-10-26_f3': {}, '2026-12-21_f1': {}, '2026-10-26_zzz': {} };   // f3 is Flex, f1 handed in for another period, zzz is no family
  const pr = periodProgress(GOOD, fams, entries);
  assert.equal(pr.total, 3); assert.equal(pr.done, 1);
  assert.deepEqual(pr.rows.map(r => [r.id, r.done]), [['f1', false], ['f2', true], ['f4', false]]);
  assert.equal(pr.rows[1].family, fams.f2);
});
test('periodProgress copes with nothing', () => {
  assert.deepEqual(periodProgress(GOOD, null, null), { total: 0, done: 0, rows: [] });
  assert.equal(periodProgress(GOOD, { f1: null, f2: {} }, undefined).total, 1);
});

console.log('\n=== the temporary rooster (step 4) ===');
test('periodShiftId: one document per period, date and direction', () => {
  assert.equal(periodShiftId(GOOD, '2026-10-27', 'terug'), '2026-10-26_2026-10-27_terug');
});
const carsBase = () => [{ driverFamilyId: 'd1', girlIds: ['a', 'b'], departureTime: '09:00' }, { driverFamilyId: 'd2', girlIds: ['c'], departureTime: '10:00' }];
const dep = ids => 'T' + ids.join('');
const cap = id => ({ d1: 3, d2: 1 })[id] ?? null;
test('periodMoveGirl: to another car; both cars get a new departure time', () => {
  const r = periodMoveGirl(carsBase(), 'a', 'car:1', dep, id => ({ d1: 3, d2: 2 })[id]);
  assert.equal(r.error, null); assert.deepEqual(r.cars, [{ driverFamilyId: 'd1', girlIds: ['b'], departureTime: 'Tb' }, { driverFamilyId: 'd2', girlIds: ['c', 'a'], departureTime: 'Tca' }]);
});
test('periodMoveGirl: a full car is refused and nothing changes', () => {
  const cars = carsBase(), r = periodMoveGirl(cars, 'a', 'car:1', dep, cap);
  assert.deepEqual(r.error, { key: 'period.rooster.err.full', p1: 1, p2: 1 }); assert.equal(r.cars, cars);
});
test('periodMoveGirl: out of every car ("niet ingedeeld"); an emptied car disappears', () => {
  const r = periodMoveGirl(carsBase(), 'c', 'none', dep, cap);
  assert.equal(r.error, null); assert.deepEqual(r.cars, [{ driverFamilyId: 'd1', girlIds: ['a', 'b'], departureTime: '09:00' }].map(c => ({ ...c, departureTime: '09:00' })));
});
test('periodMoveGirl: into a new car with that driver', () => {
  const r = periodMoveGirl(carsBase(), 'b', 'new:d3', dep, cap);
  assert.deepEqual(r.cars, [{ driverFamilyId: 'd1', girlIds: ['a'], departureTime: 'Ta' }, { driverFamilyId: 'd2', girlIds: ['c'], departureTime: '10:00' }, { driverFamilyId: 'd3', girlIds: ['b'], departureTime: 'Tb' }]);
});
test('periodMoveGirl: a girl who is in no car yet can be placed; the input is never changed', () => {
  const cars = carsBase(), snapshot = JSON.stringify(cars);
  const r = periodMoveGirl(cars, 'z', 'car:0', dep, cap);
  assert.deepEqual(r.cars[0].girlIds, ['a', 'b', 'z']); assert.equal(JSON.stringify(cars), snapshot);
  assert.deepEqual(periodMoveGirl([], 'z', 'new:d1', dep, cap).cars, [{ driverFamilyId: 'd1', girlIds: ['z'], departureTime: 'Tz' }]);
});
test('periodMoveGirl: an unknown target or car is an error, not a silent change', () => {
  assert.equal(periodMoveGirl(carsBase(), 'a', 'car:9', dep, cap).error.key, 'period.rooster.err.unknown');
  assert.equal(periodMoveGirl(carsBase(), 'a', 'sideways', dep, cap).error.key, 'period.rooster.err.unknown');
  assert.equal(periodMoveGirl(carsBase(), 'a', '', dep, cap).error.key, 'period.rooster.err.unknown');
});
test('periodSetDriver: another driver; not one that already drives another car; not one with too few seats', () => {
  assert.deepEqual(periodSetDriver(carsBase(), 1, 'd9', cap).cars[1].driverFamilyId, 'd9');
  assert.equal(periodSetDriver(carsBase(), 1, 'd1', cap).error.key, 'period.rooster.err.driverBusy');
  assert.deepEqual(periodSetDriver(carsBase(), 0, 'd9', id => ({ d9: 1 })[id]).error, { key: 'period.rooster.err.full', p1: 2, p2: 1 });
  assert.equal(periodSetDriver(carsBase(), 0, '', cap).cars[0].driverFamilyId, '', 'no driver is allowed: it shows as a warning');
  assert.equal(periodSetDriver(carsBase(), 5, 'd9', cap).error.key, 'period.rooster.err.unknown');
});
test('periodSetDriver keeps the same driver on the same car without complaining', () => {
  assert.equal(periodSetDriver(carsBase(), 0, 'd1', cap).error, null);
});

console.log('\n=== several periods at the same time ===');
const NEXT = { name: 'Toetsweek', firstDay: '2026-11-09', lastDay: '2026-11-13', opensOn: '2026-10-27', deadlineDate: '2026-11-04', deadlineTime: '12:00' };
test('validatePeriod: a period may not share a day with another one', () => {
  const r = validatePeriod({ ...NEXT, firstDay: '2026-10-29', lastDay: '2026-11-03', opensOn: '2026-10-14', deadlineDate: '2026-10-16' }, [GOOD]);
  assert.deepEqual(r.errors, ['period.err.overlap']); assert.equal(r.ok, false); assert.equal(r.overlap.name, 'Herfstvakantie');
});
test('validatePeriod: touching is overlapping (one shared day), a gap of a weekend is not', () => {
  const at = (first, last) => validatePeriod({ ...NEXT, firstDay: first, lastDay: last, opensOn: '2026-10-14', deadlineDate: '2026-10-16' }, [GOOD]).errors;
  assert.deepEqual(at('2026-10-30', '2026-11-03'), ['period.err.overlap']);   // Friday 30 is the last day of GOOD
  assert.deepEqual(at('2026-10-19', '2026-10-26'), ['period.err.overlap']);   // Monday 26 is the first day of GOOD
  assert.deepEqual(at('2026-10-19', '2026-10-23'), []); assert.deepEqual(at('2026-11-02', '2026-11-06'), []);
  assert.deepEqual(at('2026-10-27', '2026-10-28'), ['period.err.overlap'], 'inside the other one');
  assert.deepEqual(at('2026-10-23', '2026-11-02'), ['period.err.overlap'], 'around the other one');
});
test('validatePeriod: the filling-in windows may overlap freely (collect the next period while the first one runs)', () => {
  assert.equal(validatePeriod(NEXT, [GOOD]).ok, true);   // NEXT opens on 27 Oct, inside GOOD (26-30 Oct)
});
test('validatePeriod: without others, or with broken others, nothing changes; an invalid range is not reported as overlap', () => {
  assert.equal(validatePeriod(GOOD).ok, true); assert.equal(validatePeriod(GOOD, []).ok, true); assert.equal(validatePeriod(GOOD, [null, {}, { name: 'x' }]).ok, true);
  assert.deepEqual(validatePeriod({ ...GOOD, firstDay: '2026-10-30', lastDay: '2026-10-26' }, [GOOD]).errors, ['period.err.order']);
  assert.equal(validatePeriod(GOOD, [GOOD]).ok, false, 'a period overlaps itself: callers leave the edited period out of `others`');
});
test('periodList: valid periods, oldest first; broken ones are left out', () => {
  assert.deepEqual(periodList({ b: NEXT, a: GOOD, c: { ...GOOD, lastDay: '' }, d: null }).map(p => p.name), ['Herfstvakantie', 'Toetsweek']);
  assert.deepEqual(periodList(null), []); assert.deepEqual(periodList({}), []);
});
test('periodForDate: the period a date belongs to, none between periods or for a bad date', () => {
  const ps = { '2026-10-26': GOOD, '2026-11-09': NEXT };
  assert.equal(periodForDate(ps, '2026-10-26').name, 'Herfstvakantie'); assert.equal(periodForDate(ps, '2026-10-30').name, 'Herfstvakantie'); assert.equal(periodForDate(ps, '2026-11-11').name, 'Toetsweek');
  assert.equal(periodForDate(ps, '2026-11-02'), null); assert.equal(periodForDate(ps, '2026-10-25'), null); assert.equal(periodForDate(ps, 'x'), null); assert.equal(periodForDate({}, '2026-10-26'), null);
});
test('mergePeriods: the collection plus the old single period; the collection wins; a document under the wrong id is ignored', () => {
  assert.deepEqual(Object.keys(mergePeriods({ '2026-11-09': NEXT }, GOOD)).sort(), ['2026-10-26', '2026-11-09']);
  assert.equal(mergePeriods({ '2026-10-26': { ...GOOD, name: 'Uit de collectie' } }, GOOD)['2026-10-26'].name, 'Uit de collectie');
  assert.deepEqual(mergePeriods({ wrong: NEXT, '2026-11-09': { ...NEXT, lastDay: '' } }, null), {});
  assert.deepEqual(mergePeriods(null, null), {}); assert.deepEqual(mergePeriods({}, { broken: true }), {});
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
