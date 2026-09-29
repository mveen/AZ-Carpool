// Run with: node coordinator.test.js
// Who is the coordinator, who may read/write, who still has to pass the access gate. The rules are pure
// functions of a small state object; the tests below run them with plain objects.
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
import { installFakeDom, resetState, sampleFamilies } from './test-support.js';
import { S } from './state.js';
import {
  isRealCoordinatorFor, canEditFor, isMemberFor, needsGateFor, myFamilyIdFor, isValidInviteCode,
  isRealCoordinator, isMemberNow, recomputeCanEdit, myFamilyId, needsGate, myLinkedFamilyId, myDisplayInfo,
  normalizePhone, genCode, slugify,
} from './coordinator.js';

installFakeDom();
const cfg = { uid: 'coord', familyId: 'f1' };

console.log('=== isRealCoordinatorFor ===');
test('the browser that claimed the coordinator role (uid) is coordinator', () => {
  assert.equal(isRealCoordinatorFor({ coordinatorConfig: cfg, me: 'coord', links: {} }), true);
});
test('a browser linked to the coordinator family is coordinator too', () => {
  assert.equal(isRealCoordinatorFor({ coordinatorConfig: { familyId: 'f1' }, me: 'other', links: { other: { familyId: 'f1' } } }), true);
});
test('a browser linked to another family is not', () => {
  assert.equal(isRealCoordinatorFor({ coordinatorConfig: cfg, me: 'p1', links: { p1: { familyId: 'f2' } } }), false);
});
test('nobody is coordinator before anyone claimed it, or before we know who "me" is', () => {
  assert.equal(isRealCoordinatorFor({ coordinatorConfig: null, me: 'coord', links: {} }), false);
  assert.equal(isRealCoordinatorFor({ coordinatorConfig: cfg, me: null, links: {} }), false);
});

console.log('\n=== canEditFor: "test as parent" always hides the coordinator rights ===');
test('coordinator can edit', () => { assert.equal(canEditFor({ coordinatorConfig: cfg, me: 'coord', links: {} }), true); });
test('coordinator testing as a parent cannot edit (only the view changes)', () => {
  assert.equal(canEditFor({ coordinatorConfig: cfg, me: 'coord', links: {}, impersonateFamilyId: 'f2' }), false);
});
test('a parent cannot edit', () => { assert.equal(canEditFor({ coordinatorConfig: cfg, me: 'p1', links: { p1: { familyId: 'f2' } } }), false); });

console.log('\n=== isMemberFor / needsGateFor / myFamilyIdFor ===');
test('members: coordinator, or anyone linked to a family', () => {
  assert.equal(isMemberFor({ coordinatorConfig: cfg, me: 'coord', links: {} }), true);
  assert.equal(isMemberFor({ coordinatorConfig: cfg, me: 'p1', links: { p1: { familyId: 'f2' } } }), true);
  assert.equal(isMemberFor({ coordinatorConfig: cfg, me: 'stranger', links: {} }), false);
});
test('a stranger must pass the gate; members and the coordinator must not', () => {
  assert.equal(needsGateFor({ me: 'stranger', canEdit: false, links: {} }), true);
  assert.equal(needsGateFor({ me: 'p1', canEdit: false, links: { p1: { familyId: 'f2' } } }), false);
  assert.equal(needsGateFor({ me: 'coord', canEdit: true, links: {} }), false);
});
test('no gate before we know who "me" is, nor while the coordinator tests as a parent', () => {
  assert.equal(needsGateFor({ me: null, canEdit: false, links: {} }), false);
  assert.equal(needsGateFor({ me: 'x', canEdit: false, links: {}, impersonateFamilyId: 'f2' }), false);
});
test('myFamilyIdFor: test-as-parent wins, then the linked family, then the browser id', () => {
  assert.equal(myFamilyIdFor({ me: 'p1', links: { p1: { familyId: 'f2' } }, impersonateFamilyId: 'f5' }), 'f5');
  assert.equal(myFamilyIdFor({ me: 'p1', links: { p1: { familyId: 'f2' } } }), 'f2');
  assert.equal(myFamilyIdFor({ me: 'p1', links: {} }), 'p1');
});

console.log('\n=== wrappers over the shared state ===');
test('recomputeCanEdit stores the result in S.canEdit', () => {
  resetState({ me: 'coord', coordinatorConfig: cfg, links: {} });
  recomputeCanEdit(); assert.equal(S.canEdit, true);
  S.impersonateFamilyId = 'f2'; recomputeCanEdit(); assert.equal(S.canEdit, false);
});
test('isRealCoordinator / isMemberNow / needsGate / myFamilyId / myLinkedFamilyId read S', () => {
  resetState({ me: 'p1', coordinatorConfig: cfg, links: { p1: { familyId: 'f2' } } });
  assert.equal(isRealCoordinator(), false); assert.equal(isMemberNow(), true); assert.equal(needsGate(), false);
  assert.equal(myFamilyId(), 'f2'); assert.equal(myLinkedFamilyId(), 'f2');
  resetState({ me: 'coord', coordinatorConfig: cfg, links: {} });
  assert.equal(myLinkedFamilyId(), null, 'a coordinator who is not linked to a family has no own family');
});
test('myDisplayInfo: the linked parent\'s name and phone', () => {
  resetState({ me: 'p1', links: { p1: { familyId: 'f2' } }, families: sampleFamilies() });
  assert.deepEqual(myDisplayInfo(), { name: 'Piet Pieters', phone: '0622222222' });
});
test('myDisplayInfo: an unlinked coordinator shows as "Coördinator", an unknown visitor as "Onbekend"', () => {
  resetState({ me: 'coord', canEdit: true, links: {} }); assert.equal(myDisplayInfo().name, 'Coördinator');
  resetState({ me: 'x', canEdit: false, links: {} }); assert.equal(myDisplayInfo().name, 'Onbekend');
});

console.log('\n=== codes, phone numbers, ids ===');
test('isValidInviteCode: 4-32 letters, digits or "-"', () => {
  assert.equal(isValidInviteCode('ABCD'), true); assert.equal(isValidInviteCode('1234567890'), true); assert.equal(isValidInviteCode('a-b-c-d'), true);
  assert.equal(isValidInviteCode('abc'), false); assert.equal(isValidInviteCode('has space'), false);
  assert.equal(isValidInviteCode('x'.repeat(33)), false); assert.equal(isValidInviteCode(''), false); assert.equal(isValidInviteCode(null), false);
});
test('genCode: 10 digits, never starting with 0, different each time', () => {
  const codes = Array.from({ length: 50 }, genCode);
  codes.forEach(c => assert.match(c, /^[1-9]\d{9}$/));
  assert.ok(new Set(codes).size > 45);
});
test('normalizePhone treats 06 / +316 / 00316 and stray spaces or dashes as the same number', () => {
  ['0612345678', '06 12 34 56 78', '06-12345678', '+31612345678', '+31 6 1234 5678', '0031612345678'].forEach(p =>
    assert.equal(normalizePhone(p), '0612345678', p));
});
test('normalizePhone copes with empty input', () => { assert.equal(normalizePhone(''), ''); assert.equal(normalizePhone(null), ''); });
test('slugify makes safe ids (no accents, no spaces)', () => {
  assert.equal(slugify('Loïs'), 'lois'); assert.equal(slugify('Van der Berg'), 'van-der-berg');
});

import { dayCoordinatorFor } from './coordinator.js';

console.log('\n=== dagcoördinator (US-02) ===');
const dcFams = { f1: { parentName: 'Merel', parentPhone1: '0611111111' }, f2: { parentName: 'Mirjam', parentPhone1: '', parentPhone2: '0622222222' } };
test('the coordinator of a day is read from the family chosen in Beheer', () => {
  assert.deepEqual(dayCoordinatorFor({ dayCoordinators: { Ma: 'f1', Di: 'f2' }, families: dcFams }, 'Ma'), { familyId: 'f1', name: 'Merel', phone: '0611111111' });
});
test('the phone number falls back to Tel.nr. 2', () => {
  assert.equal(dayCoordinatorFor({ dayCoordinators: { Di: 'f2' }, families: dcFams }, 'Di').phone, '0622222222');
});
test('names are never hard-coded: renaming the parent changes the result', () => {
  const state = { dayCoordinators: { Ma: 'f1' }, families: { f1: { parentName: 'Nieuwe Naam' } } };
  assert.equal(dayCoordinatorFor(state, 'Ma').name, 'Nieuwe Naam');
});
test('no coordinator for a day, an unknown family, or missing data gives null', () => {
  assert.equal(dayCoordinatorFor({ dayCoordinators: { Ma: 'f1' }, families: dcFams }, 'Wo'), null);
  assert.equal(dayCoordinatorFor({ dayCoordinators: { Ma: 'gone' }, families: dcFams }, 'Ma'), null);
  assert.equal(dayCoordinatorFor({ families: dcFams }, 'Ma'), null);
  assert.equal(dayCoordinatorFor({ dayCoordinators: { Ma: 'f1' } }, 'Ma'), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
