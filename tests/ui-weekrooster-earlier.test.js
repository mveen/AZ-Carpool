// Run with: node ui-weekrooster-earlier.test.js
// "Al aangepast voor donderdag" (what the day already deviates from the standard rooster), the block "Dit voorstel past eerdere wijzigingen aan",
// the reminder next to Doorvoeren and the log lines that acceptDay stored (overwrote).
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, useFakeDb, withFakeNow, NOW, sampleDbSeed, sampleParentState, sampleGroups, assertNoUnusedImports } from './test-support.js';
import { S } from '../state.js';
import { itemText, earlierText, nowText, overwriteText, earlierOf, earlierFoldHtml, overDriversOf, overwriteBlockHtml, overwriteNoteHtml, overwroteLog } from '../ui-weekrooster-earlier.js';

installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const WK = '2026-W40';
const car = (dir, n, driver, girls, dep) => ({ ['Do_' + dir + '_' + n]: { day: 'Do', direction: dir, girlIds: girls, driverFamilyId: driver, reserveFamilyIds: [], departureTime: dep } });
const CARS = { ...sampleGroups(), ...car('heen', 1, 'f1', ['f1', 'f3'], '07:30'), ...car('heen', 2, 'f2', ['f2', 'f4'], '09:15'), ...car('terug', 1, 'f1', ['f1', 'f3'], '17:00'), ...car('terug', 2, 'f2', ['f2', 'f4'], '18:00') };
const dev = (dir, cars, extra = {}) => ({ day: 'Do', direction: dir, weekKey: WK, expiresAt: 9e15, cars: cars.map(([d, g, t]) => ({ driverFamilyId: d, girlIds: g, reserveFamilyIds: [], departureTime: t })), ...extra });
const setup = (deviations = {}) => { useFakeDb(sampleDbSeed()); sampleParentState({ scheduleDay: 'Do', roosterMode: 'week', groups: CARS }); S.deviations = deviations; };

console.log('=== the words ===');
test('every kind of change has a sentence with the names of the family', () => {
  setup();
  assert.equal(itemText({ type: 'out', girlId: 'f4' }), 'Evi rijdt niet mee');
  assert.equal(itemText({ type: 'moved', girlId: 'f4', driverId: 'f1' }), 'Evi in auto van Jan Jansen');
  assert.equal(itemText({ type: 'extra', girlId: 'f5', driverId: 'f1' }), 'Lois rijdt mee in auto van Jan Jansen');
  assert.equal(itemText({ type: 'driver', driverId: 'f3', fromDriverId: 'f2' }), 'Kees de Vries rijdt, was Piet Pieters');
  assert.equal(itemText({ type: 'newcar', driverId: 'f3' }), 'Extra auto van Kees de Vries');
  assert.equal(itemText({ type: 'time', driverId: 'f2', time: '18:30' }), 'Auto van Piet Pieters vertrekt 18:30');
  assert.match(itemText({ type: 'place', driverId: 'f2', place: 'ATC' }), /^Auto van Piet Pieters gaat naar /);
  assert.equal(itemText({ type: 'nonsense' }), '');
  assert.equal(earlierText('terug', { type: 'out', girlId: 'f4' }), 'Terug · Evi rijdt niet mee');
});
test('where it is now: a girl in a car, a girl who stays home, a car with a time, a car that is gone', () => {
  setup();
  assert.equal(nowText({ girlId: 'f4' }, { driverId: 'f1', time: '07:30' }), 'nu: in auto van Jan Jansen');
  assert.equal(nowText({ girlId: 'f4' }, null), 'nu: rijdt niet mee');
  assert.equal(nowText({ driverId: 'f2' }, { driverId: 'f2', time: '18:00' }), 'nu: vertrek 18:00');
  assert.equal(nowText({ driverId: 'f2' }, null), 'nu: auto vervalt');
  assert.equal(overwriteText({ dir: 'terug', item: { type: 'time', driverId: 'f2', time: '18:30' }, after: { driverId: 'f2', time: '18:00' } }), 'Terug · Auto van Piet Pieters vertrekt 18:30 · nu: vertrek 18:00');
});

console.log('=== Al aangepast ===');
test('a day that still is the standard rooster has no line', () => {
  setup(); assert.deepEqual(earlierOf('Do'), []); assert.equal(earlierFoldHtml('Do'), '');
});
test('the earlier changes of both directions are listed, folded, with their number', () => {
  setup({ Do_heen: dev('heen', [['f1', ['f1', 'f3', 'f4'], '07:30'], ['f2', ['f2'], '09:15']]), Do_terug: dev('terug', [['f1', ['f1', 'f3'], '17:00'], ['f2', ['f2', 'f4'], '18:30']]) });
  assert.deepEqual(earlierOf('Do').map(x => x.dir), ['heen', 'terug']);
  const html = withFakeNow(NOW, () => earlierFoldHtml('Do')), s = text(html);
  assert.match(html, /<details class="fold fold--earlier"/); assert.doesNotMatch(html, /<details[^>]*\bopen\b/);   // folded
  assert.match(s, /Al aangepast voor donderdag 2/); assert.match(s, /Heen · Evi in auto van Jan Jansen/); assert.match(s, /Terug · Auto van Piet Pieters vertrekt 18:30/);
  assert.doesNotMatch(html.replace(/<svg[\s\S]*?<\/svg>/g, ''), /style=/);
});
test('a deviation of another week is not an earlier change of this week', () => {
  setup({ Do_terug: dev('terug', [['f1', ['f1', 'f3'], '17:00'], ['f2', ['f2', 'f4'], '18:30']], { weekKey: '2026-W39' }) });
  assert.equal(earlierFoldHtml('Do'), '');
});

console.log('=== Dit voorstel past eerdere wijzigingen aan ===');
const cars = (...x) => x.map(([d, g, t]) => ({ driverFamilyId: d, girlIds: g, departureTime: t }));
const over2 = [
  { dir: 'heen', item: { type: 'moved', girlId: 'f4', driverId: 'f1', time: '07:30' }, after: { driverId: 'f2', time: '09:15' } },
  { dir: 'terug', item: { type: 'time', driverId: 'f2', time: '18:30' }, after: { driverId: 'f2', time: '18:00' } },
];
test('the block names the number, shows was and now per line, and the total in cars when it differs', () => {
  setup();
  const adv = { directions: { heen: { cars: cars(['f1', ['f1', 'f3', 'f4'], '07:30'], ['f2', ['f2'], '09:15']) }, terug: { cars: cars(['f1', ['f1', 'f3'], '17:00'], ['f2', ['f2', 'f4'], '18:30']) } } };
  const plan = { dirs: { heen: { cars: cars(['f1', ['f1', 'f3'], '07:30'], ['f2', ['f2', 'f4'], '09:15']) }, terug: { cars: cars(['f1', ['f1', 'f3', 'f2', 'f4'], '17:00']) } } };
  const html = overwriteBlockHtml(over2, adv, plan), s = text(html);
  assert.match(html, /class="alertCard alertCard--stack"/); assert.match(html, /role="note"/);
  assert.match(s, /Dit voorstel past 2 eerdere wijzigingen aan/);
  assert.match(s, /Heen · Evi in auto van Jan Jansen · nu: in auto van Piet Pieters/); assert.match(s, /Terug · Auto van Piet Pieters vertrekt 18:30 · nu: vertrek 18:00/);
  assert.match(s, /Totaal: 3 auto’s in plaats van 4/);
  assert.doesNotMatch(html.replace(/<svg[\s\S]*?<\/svg>/g, ''), /style=/);
});
test('one change: singular title; one car left: "1 auto"; the same number of cars: no total line', () => {
  setup();
  const adv = { directions: { terug: { cars: cars(['f1', ['f1', 'f3'], '17:00'], ['f2', ['f2', 'f4'], '18:30']) } } };
  const one = { dirs: { terug: { cars: cars(['f1', ['f1', 'f3', 'f2', 'f4'], '17:00']) } } }, same = { dirs: { terug: { cars: cars(['f1', ['f1', 'f3'], '17:00'], ['f2', ['f2', 'f4'], '18:00']) } } };
  assert.match(text(overwriteBlockHtml([over2[1]], adv, one)), /Dit voorstel past 1 eerdere wijziging aan[\s\S]*Totaal: 1 auto in plaats van 2/);
  assert.doesNotMatch(text(overwriteBlockHtml([over2[1]], adv, same)), /Totaal/);
});
test('nothing overwritten: no block and no reminder', () => { assert.equal(overwriteBlockHtml([], {}, {}), ''); assert.equal(overwriteNoteHtml([]), ''); });
test('the reminder next to Doorvoeren counts the changes', () => {
  assert.match(text(overwriteNoteHtml([over2[0]])), /^1 eerdere wijziging wordt overschreven$/); assert.match(text(overwriteNoteHtml(over2)), /^2 eerdere wijzigingen worden overschreven$/);
  assert.match(overwriteNoteHtml(over2), /class="noteCard"/);
});
test('the cars that are involved (the driver then and in the plan) get the tag', () => {
  assert.deepEqual([...overDriversOf(over2, 'heen')].sort(), ['f1', 'f2']); assert.deepEqual([...overDriversOf(over2, 'terug')], ['f2']); assert.deepEqual([...overDriversOf([], 'heen')], []);
});

console.log('=== the log ===');
test('what acceptDay stored shows as log lines of this week and day, newest data from the deviation', () => {
  setup({ Do_terug: dev('terug', [['f1', ['f1', 'f3', 'f2', 'f4'], '17:00']], { overwroteAt: 1234, overwrote: [{ item: over2[1].item, after: over2[1].after }] }),
    Do_heen: dev('heen', [['f1', ['f1']]], { overwroteAt: 99, overwrote: [{ item: over2[0].item, after: over2[0].after }] }) });
  const log = overwroteLog('Do'); assert.equal(log.length, 2);
  assert.deepEqual(log.map(x => x.dir), ['heen', 'terug']); assert.equal(log[1].updatedAt, 1234); assert.equal(log[1].state, 'over');
  assert.equal(log[1].text, 'Terug · Auto van Piet Pieters vertrekt 18:30 · nu: vertrek 18:00');
  assert.deepEqual(overwroteLog('Vr'), []);
});
test('no log without the stored fields, for another week, or with a broken field', () => {
  setup({ Do_terug: dev('terug', [], {}) }); assert.deepEqual(overwroteLog('Do'), []);
  setup({ Do_terug: dev('terug', [], { weekKey: '2026-W39', overwroteAt: 1, overwrote: [{ item: over2[1].item, after: null }] }) }); assert.deepEqual(overwroteLog('Do'), []);
  setup({ Do_terug: dev('terug', [], { overwroteAt: 'x', overwrote: 'y' }) }); assert.deepEqual(overwroteLog('Do'), []);
  setup({ Do_terug: dev('terug', [], { overwroteAt: 5, overwrote: [null, { nothing: 1 }] }) }); assert.deepEqual(overwroteLog('Do'), []);
});

test('ui-weekrooster-earlier.js imports nothing it does not use', () => assertNoUnusedImports('ui-weekrooster-earlier.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
