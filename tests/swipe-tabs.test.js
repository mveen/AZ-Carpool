// Run with: node swipe-tabs.test.js
// Swiping between tabs: only a clear, fast, sideways swipe changes tab.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { swipeTarget } from '../swipe-tabs.js';

const tabs = ['myweek', 'schedule', 'deviation', 'matches'];

console.log('=== swipeTarget ===');
test('swipe left goes to the next tab, swipe right to the previous', () => {
  assert.equal(swipeTarget(-120, 5, 200, tabs, 'myweek'), 'schedule');
  assert.equal(swipeTarget(120, 5, 200, tabs, 'deviation'), 'schedule');
});
test('no tab beyond the first or last', () => {
  assert.equal(swipeTarget(120, 0, 200, tabs, 'myweek'), null);
  assert.equal(swipeTarget(-120, 0, 200, tabs, 'matches'), null);
});
test('a short swipe, a slow drag or a mostly vertical move does nothing', () => {
  assert.equal(swipeTarget(-30, 0, 100, tabs, 'myweek'), null);
  assert.equal(swipeTarget(-150, 0, 900, tabs, 'myweek'), null);
  assert.equal(swipeTarget(-100, 90, 200, tabs, 'myweek'), null);
});
test('an unknown current tab does nothing', () => { assert.equal(swipeTarget(-120, 0, 200, tabs, 'nope'), null); });
test('with the coordinator tab in the list it is reachable', () => {
  assert.equal(swipeTarget(-120, 0, 200, [...tabs, 'beheer'], 'matches'), 'beheer');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
