// Run with: node maintenance.test.js
// Onderhoudsmodus (maintenance.js): text cleaning, what a stored document means, who is blocked, the stored document.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import './test-support.js';
import { MAINTENANCE_MAX, cleanMaintenanceText, normalizeMaintenance, maintenanceBlocks, maintenanceDoc } from '../maintenance.js';

console.log('=== text ===');
test('the text is one line of plain text, cut at 150 characters', () => {
  assert.equal(MAINTENANCE_MAX, 150);
  assert.equal(cleanMaintenanceText('  Terug\n rond   20:00.  '), 'Terug rond 20:00.');
  assert.equal(cleanMaintenanceText('x'.repeat(300)).length, 150);
  assert.equal(cleanMaintenanceText(null), ''); assert.equal(cleanMaintenanceText(undefined), '');
});
test('HTML in the text is kept as text (the UI escapes it), never interpreted here', () => {
  assert.equal(cleanMaintenanceText('<b>Let op</b>'), '<b>Let op</b>');
});

console.log('=== normalize ===');
test('a missing or broken document means: off', () => {
  [null, undefined, 'x', 5, {}, { on: 'yes' }, { on: 1 }, { on: 'true' }].forEach(r => assert.deepEqual(normalizeMaintenance(r), { on: false, text: '' }));
});
test('only a real true switches it on; the text is cleaned', () => {
  assert.deepEqual(normalizeMaintenance({ on: true, text: ' Hoi  daar ' }), { on: true, text: 'Hoi daar' });
});

console.log('=== who is blocked ===');
test('off: nobody is blocked', () => {
  assert.equal(maintenanceBlocks(null, false), false);
  assert.equal(maintenanceBlocks({ on: false, text: 'x' }, false), false);
  assert.equal(maintenanceBlocks({ on: false }, true), false);
});
test('on: every user is blocked, except the real coordinator', () => {
  assert.equal(maintenanceBlocks({ on: true }, false), true);
  assert.equal(maintenanceBlocks({ on: true, text: '' }, false), true);
  assert.equal(maintenanceBlocks({ on: true }, true), false);
});

console.log('=== stored document ===');
test('the document has switch, text and a time; off keeps the text', () => {
  assert.deepEqual(maintenanceDoc({ on: true, text: ' Terug om 8 ' }, 123), { on: true, text: 'Terug om 8', updatedAt: 123 });
  assert.deepEqual(maintenanceDoc({ on: false, text: 'Terug om 8' }, 5), { on: false, text: 'Terug om 8', updatedAt: 5 });
  assert.deepEqual(maintenanceDoc(null, 9), { on: false, text: '', updatedAt: 9 });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
