// Run with: node match-legs.test.js
// Which leg of a match a car drives (heen / terug / both). Pure functions, nothing on screen.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import './test-support.js';
import { LEGS, coversLeg, legChoices, legField, legOf } from '../match-legs.js';

console.log('=== legOf / coversLeg ===');
test('without the bus a car without a leg drives both ways (as it always did); heen and terug are the explicit choices', () => {
  assert.equal(legOf({}, false), 'beide'); assert.equal(legOf({ leg: '' }, false), 'beide'); assert.equal(legOf(null, false), 'beide'); assert.equal(legOf({ leg: 'rubbish' }, false), 'beide');
  assert.equal(legOf({ leg: 'heen' }, false), 'heen'); assert.equal(legOf({ leg: 'terug' }, false), 'terug');
});
test('by bus a car is ONE leg: no leg counts as heen', () => {
  assert.equal(legOf({}, true), 'heen'); assert.equal(legOf({ leg: '' }, true), 'heen'); assert.equal(legOf({ leg: 'terug' }, true), 'terug'); assert.equal(legOf({ leg: 'heen' }, true), 'heen');
});
test('a car that drives both counts for each leg; the others only for their own', () => {
  assert.equal(coversLeg({}, 'heen', false), true); assert.equal(coversLeg({}, 'terug', false), true);
  assert.equal(coversLeg({ leg: 'heen' }, 'terug', false), false); assert.equal(coversLeg({ leg: 'terug' }, 'heen', false), false); assert.equal(coversLeg({ leg: 'terug' }, 'terug', false), true);
  assert.equal(coversLeg({}, 'terug', true), false);   // by bus the old car without a leg is a heen car only
});

console.log('\n=== what the form stores and offers ===');
test('legField stores "both" as nothing (so such a car stays as before), heen and terug as they are', () => {
  assert.equal(legField('beide'), ''); assert.equal(legField('heen'), 'heen'); assert.equal(legField('terug'), 'terug'); assert.equal(legField(undefined), ''); assert.equal(legField('x'), '');
});
test('the form offers heen / terug by bus and heen en terug / heen / terug without; the first is the default', () => {
  assert.deepEqual(legChoices(true), ['heen', 'terug']); assert.deepEqual(legChoices(false), ['beide', 'heen', 'terug']); assert.deepEqual(LEGS, ['heen', 'terug']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
