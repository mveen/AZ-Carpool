// Run with: node weekrooster.test.js
// Afwijkend weekrooster (weekrooster.js): the feature switch (uit / test / aan) and the request model: direct or request, the documents
// built from the week form, the state of a request, accepting, withdrawing, expiring and cleaning up. No reason or free text anywhere.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import './test-support.js';
import {
  WEEKROOSTER_MODES, REQUEST_DAYS, REQUEST_STATUSES, REQUEST_FIELDS,
  normalizeWeekrooster, weekroosterDoc, weekroosterVisible, requestId, isValidRequest, decideMode, buildRequests,
  requestState, canChangeRequest, withdrawRequest, acceptRequest, pendingForDay, staleRequestIds,
} from '../weekrooster.js';

console.log('=== the feature switch ===');
test('a missing, broken or unknown document means: uit', () => {
  [null, undefined, 'x', 5, {}, { mode: 'AAN' }, { mode: true }, { mode: 'aan ' }, { mode: 'aan-test' }].forEach(r => assert.deepEqual(normalizeWeekrooster(r), { mode: 'uit' }));
});
test('only the three real modes are kept, and nothing else comes along', () => {
  assert.deepEqual(WEEKROOSTER_MODES, ['uit', 'test', 'aan']);
  WEEKROOSTER_MODES.forEach(mode => assert.deepEqual(normalizeWeekrooster({ mode, extra: 1 }), { mode }));
});
test('the stored document has the mode and a time, and an unknown mode is stored as uit', () => {
  assert.deepEqual(weekroosterDoc('test', 5), { mode: 'test', updatedAt: 5 });
  assert.deepEqual(weekroosterDoc('whatever', 5), { mode: 'uit', updatedAt: 5 });
});
test('uit: nobody sees it; test: only the real coordinator; aan: everybody', () => {
  [true, false].forEach(c => assert.equal(weekroosterVisible('uit', c), false));
  [undefined, null, 'x'].forEach(m => [true, false].forEach(c => assert.equal(weekroosterVisible(m, c), false)));
  assert.equal(weekroosterVisible('test', true), true);
  assert.equal(weekroosterVisible('test', false), false);
  assert.equal(weekroosterVisible('aan', true), true);
  assert.equal(weekroosterVisible('aan', false), true);
});

console.log('=== direct or a request ===');
test('only the own daughter can be changed', () => {
  assert.equal(decideMode({ ownDaughter: false, rides: true, isDayCoordinator: true }), null);
  assert.equal(decideMode({ ownDaughter: false, rides: false, isDayCoordinator: false }), null);
});
test('"rijdt niet mee" is always direct', () => {
  assert.equal(decideMode({ ownDaughter: true, rides: false, isDayCoordinator: false }), 'direct');
  assert.equal(decideMode({ ownDaughter: true, rides: false, isDayCoordinator: true }), 'direct');
});
test('new times: a request, unless it is the own day of the day coordinator', () => {
  assert.equal(decideMode({ ownDaughter: true, rides: true, isDayCoordinator: false }), 'pending');
  assert.equal(decideMode({ ownDaughter: true, rides: true, isDayCoordinator: true }), 'direct');
});

console.log('=== the request documents ===');
const WK = '2026-W41';
const standard = { Ma: { heen: '16:00', terug: '17:00' }, Di: { heen: '16:00', terug: '17:00' }, Wo: { heen: '16:00', terug: '17:00' }, Do: { heen: '16:00', terug: '17:00' }, Vr: { heen: '15:00', terug: '16:00' } };
const base = { weekKey: WK, familyId: 'f2', standard, isPast: () => false, deciderOf: day => ({ Do: 'f9', Vr: 'f2' }[day] || 'f8'), existing: {}, nowMs: 1000 };
test('a changed day becomes one pending request with only times and "rijdt mee"', () => {
  const r = buildRequests({ ...base, days: { Do: { rides: true, heen: '16:30', terug: '17:45' } } });
  assert.equal(r.writes.length, 1);
  assert.equal(r.writes[0].id, '2026-W41_Do_f2');
  assert.deepEqual(r.writes[0].doc, { weekKey: WK, day: 'Do', familyId: 'f2', rides: true, heen: '16:30', terug: '17:45', status: 'pending', createdAt: 1000, updatedAt: 1000 });
  assert.ok(isValidRequest(r.writes[0].doc));
});
test('"rijdt niet mee" is direct and keeps no times', () => {
  const r = buildRequests({ ...base, days: { Wo: { rides: false, heen: '16:30', terug: '17:45' } } });
  assert.deepEqual(r.writes[0].doc, { weekKey: WK, day: 'Wo', familyId: 'f2', rides: false, heen: '', terug: '', status: 'direct', createdAt: 1000, updatedAt: 1000 });
  assert.ok(isValidRequest(r.writes[0].doc));
});
test('a week can be mixed: own day direct, another day a request', () => {
  const r = buildRequests({ ...base, days: { Do: { rides: true, heen: '16:30', terug: '17:00' }, Vr: { rides: true, heen: '14:00', terug: '16:00' } } });
  assert.deepEqual(r.writes.map(w => [w.doc.day, w.doc.status]), [['Do', 'pending'], ['Vr', 'direct']]);
  assert.equal(r.writes[1].doc.decidedBy, 'f2'); assert.equal(r.writes[1].doc.decidedAt, 1000);
  assert.ok(r.writes.every(w => isValidRequest(w.doc)));
});
test('days that equal the fixed rooster, past days and incomplete times are skipped, in week order', () => {
  const r = buildRequests({
    ...base, isPast: d => d === 'Ma',
    days: { Vr: { rides: true, heen: '15:00', terug: '16:00' }, Ma: { rides: true, heen: '10:00', terug: '11:00' }, Di: { rides: true, heen: '', terug: '17:00' }, Wo: { rides: true, heen: '9:00', terug: '17:00' }, Do: { rides: true, heen: '16:30', terug: '17:00' } },
  });
  assert.deepEqual(r.writes.map(w => w.doc.day), ['Do']);
  assert.deepEqual(r.skipped, [{ day: 'Ma', why: 'past' }, { day: 'Di', why: 'time' }, { day: 'Wo', why: 'time' }, { day: 'Vr', why: 'same' }]);
});
test('a replaced request keeps its createdAt, a test request carries test: true', () => {
  const existing = { '2026-W41_Do_f2': { createdAt: 77 } };
  const r = buildRequests({ ...base, existing, test: true, nowMs: 2000, days: { Do: { rides: true, heen: '16:45', terug: '17:00' } } });
  assert.equal(r.writes[0].doc.createdAt, 77); assert.equal(r.writes[0].doc.updatedAt, 2000); assert.equal(r.writes[0].doc.test, true);
  assert.ok(isValidRequest(r.writes[0].doc));
});
test('a day nobody asked for is left out; no day coordinator known still gives a request', () => {
  const r = buildRequests({ ...base, deciderOf: () => null, days: { Do: { rides: true, heen: '16:30', terug: '17:00' } } });
  assert.equal(r.writes[0].doc.status, 'pending');
  assert.deepEqual(buildRequests({ ...base, days: {} }), { writes: [], skipped: [] });
});

console.log('=== validity: no reason, no free text ===');
const good = { weekKey: WK, day: 'Do', familyId: 'f2', rides: true, heen: '16:30', terug: '17:00', status: 'pending', createdAt: 1, updatedAt: 1 };
test('a good request is valid; every unknown field (reason, note, text) makes it invalid', () => {
  assert.ok(isValidRequest(good));
  ['reason', 'reden', 'note', 'text', 'message', 'by', 'name'].forEach(k => assert.equal(isValidRequest({ ...good, [k]: 'ziek' }), false, k));
  assert.deepEqual(REQUEST_FIELDS.filter(k => /reason|reden|text|note|message|name|by/.test(k)), []);
});
test('bad values are refused', () => {
  const bad = [
    null, 'x', {}, { ...good, weekKey: '2026-41' }, { ...good, day: 'Za' }, { ...good, familyId: '' }, { ...good, rides: 'yes' }, { ...good, status: 'open' },
    { ...good, heen: '' }, { ...good, terug: '25:00' }, { ...good, heen: '9:00' }, { ...good, rides: false }, { ...good, rides: false, heen: '', terug: '17:00' },
    { ...good, createdAt: '1' }, { ...good, updatedAt: null }, { ...good, decidedAt: 'x' }, { ...good, decidedBy: 5 }, { ...good, test: false },
  ];
  bad.forEach((b, i) => assert.equal(isValidRequest(b), false, 'case ' + i));
  assert.ok(isValidRequest({ ...good, rides: false, heen: '', terug: '' }));
  assert.ok(isValidRequest({ ...good, status: 'accepted', decidedAt: 5, decidedBy: 'f9', test: true }));
});
test('the days and statuses are the agreed ones', () => {
  assert.deepEqual(REQUEST_DAYS, ['Ma', 'Di', 'Wo', 'Do', 'Vr']);
  assert.deepEqual(REQUEST_STATUSES, ['pending', 'direct', 'accepted', 'withdrawn']);
  assert.equal(requestId('2026-W41', 'Do', 'f2'), '2026-W41_Do_f2');
});

console.log('=== state, accepting, withdrawing, expiring ===');
const dayEnd = 5000;
test('a pending request is pending until its day is over, then it has expired (the fixed rooster stayed)', () => {
  assert.equal(requestState(good, 4999, dayEnd), 'pending');
  assert.equal(requestState(good, 5000, dayEnd), 'expired');
  assert.equal(requestState(good, 9999999, undefined), 'pending');
  assert.equal(requestState(null, 1, dayEnd), 'none');
  assert.equal(requestState({ ...good, status: 'weird' }, 1, dayEnd), 'none');
});
test('direct, accepted and withdrawn never expire', () => {
  ['direct', 'accepted', 'withdrawn'].forEach(status => assert.equal(requestState({ ...good, status }, 9e9, dayEnd), status));
});
test('a request can be changed or withdrawn only while it is pending and its day is not over', () => {
  assert.equal(canChangeRequest(good, 1, dayEnd), true);
  assert.equal(canChangeRequest(good, 5000, dayEnd), false);
  ['direct', 'accepted', 'withdrawn'].forEach(status => assert.equal(canChangeRequest({ ...good, status }, 1, dayEnd), false));
  const w = withdrawRequest(good, 9);
  assert.equal(w.status, 'withdrawn'); assert.equal(w.updatedAt, 9); assert.ok(isValidRequest(w)); assert.equal(good.status, 'pending');
});
test('the day coordinator accepts a pending request only; the result is valid and nothing else changes', () => {
  const a = acceptRequest(good, 'f9', 20);
  assert.deepEqual(a, { ...good, status: 'accepted', decidedAt: 20, decidedBy: 'f9', updatedAt: 20 });
  assert.ok(isValidRequest(a));
  ['direct', 'accepted', 'withdrawn'].forEach(status => assert.equal(acceptRequest({ ...good, status }, 'f9', 20), null));
  assert.equal(acceptRequest(null, 'f9', 20), null);
});
test('after an accepted request a new one for the same day is a normal pending request again', () => {
  const accepted = acceptRequest(good, 'f9', 20);
  const r = buildRequests({ ...base, existing: { [requestId(WK, 'Do', 'f2')]: accepted }, nowMs: 30, days: { Do: { rides: true, heen: '16:45', terug: '17:00' } } });
  assert.equal(r.writes[0].doc.status, 'pending'); assert.equal(r.writes[0].doc.decidedBy, undefined);
});

console.log('=== one agreement per day ===');
test('the pending requests of one day, oldest first; other days, weeks, states and expired ones stay out', () => {
  const reqs = {
    a: { ...good, familyId: 'fa', createdAt: 5 }, b: { ...good, familyId: 'fb', createdAt: 3 }, c: { ...good, day: 'Vr', familyId: 'fc' },
    d: { ...good, weekKey: '2026-W42', familyId: 'fd' }, e: { ...good, status: 'accepted', familyId: 'fe' }, f: { ...good, status: 'direct', familyId: 'ff' }, g: null,
  };
  assert.deepEqual(pendingForDay(reqs, WK, 'Do', 1, dayEnd).map(r => r.id), ['b', 'a']);
  assert.deepEqual(pendingForDay(reqs, WK, 'Do', 5000, dayEnd), []);
  assert.deepEqual(pendingForDay(undefined, WK, 'Do', 1, dayEnd), []);
});

console.log('=== cleaning up ===');
test('requests of an older week and withdrawn ones can be removed; the current and newer weeks stay', () => {
  const reqs = { a: { ...good, weekKey: '2026-W40' }, b: { ...good }, c: { ...good, weekKey: '2026-W42' }, d: { ...good, status: 'withdrawn' }, e: null, f: { ...good, weekKey: 'kapot' } };
  assert.deepEqual(staleRequestIds(reqs, '2026-W41').sort(), ['a', 'd']);
  assert.deepEqual(staleRequestIds(undefined, '2026-W41'), []);
});

import { assertNoUnusedImports } from './test-support.js';
test('weekrooster.js imports nothing it does not use', () => assertNoUnusedImports('weekrooster.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
