// Run with: node impact.test.js
// Impact preview on a deviation (US-07): the analysis, the texts, the on/off switch and the save gate.
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
import { installFakeDom, useFakeDb, resetState, sampleFamilies, sampleGroups, sampleParentState, withFakeNowAsync, NOW } from './test-support.js';
import { S } from '../state.js';
import { analyzeImpact, impactText, impactEnabled, setImpactEnabled, impactCardHtml, wireImpactCard, impactGate } from '../impact.js';
import { saveDeviationCars } from '../data.js';

const dom = installFakeDom();
const tick = () => new Promise(r => setImmediate(r));

// Ma heen: Eline (08:30) and Jahaimy (08:30), Anouk (10:15). Drivers available Ma: f1 (3 seats), f2 (4), f3 (5), f6 (3).
const fams = sampleFamilies();
const base = { day: 'Ma', direction: 'heen', families: fams, settings: { gapThresholdHours: 3, prefWindowMinutes: 30 }, prefs: { rules: [] } };
const car = (driver, girls, time = '07:30') => ({ driverFamilyId: driver, girlIds: girls, departureTime: time });

console.log('=== the four outcomes ===');
test('scheelt een auto: a girl drops out and the planning engine now needs one car fewer (both cars still have girls)', () => {
  const strict = { ...base, settings: { gapThresholdHours: 0.5, prefWindowMinutes: 30 } };   // max 30 min between girls in 1 car
  const before = [car('f1', ['f1', 'f2']), car('f6', ['f3', 'f4'])];   // 08:30 08:30 | 10:15 11:00 -> 3 cars needed
  const after = [car('f1', ['f1', 'f2']), car('f6', ['f3'])];          // f4 (11:00) drops out -> 2 cars needed
  assert.deepEqual(analyzeImpact({ ...strict, before, after }), { kind: 'saves' });
});
test('scheelt een auto: a car is emptied by moving its girl to another car', () => {
  const before = [car('f1', ['f1']), car('f2', ['f2'])];
  const after = [car('f1', ['f1', 'f2']), car('f2', [])];
  assert.deepEqual(analyzeImpact({ ...base, before, after }), { kind: 'saves' });
});
test('geen effect: only the departure time or the driver changes and the car count stays', () => {
  const before = [car('f1', ['f1', 'f2'])];
  assert.deepEqual(analyzeImpact({ ...base, before, after: [car('f1', ['f1', 'f2'], '07:15')] }), { kind: 'none' });
  assert.deepEqual(analyzeImpact({ ...base, before, after: [car('f2', ['f1', 'f2'])] }), { kind: 'none' });
});
test('geen effect: a girl is added and still fits', () => {
  const before = [car('f1', ['f1'])];
  assert.deepEqual(analyzeImpact({ ...base, before, after: [car('f1', ['f1', 'f2'])] }), { kind: 'none' });
});
test('extra plek nodig: a car gets more girls than seats → a driver with room is proposed (standard availability first, then Selectievolgorde)', () => {
  const f = { ...fams, f1: { ...fams.f1, capacity: 2 } };     // f1 has 1 passenger seat
  const before = [car('f1', ['f1'])];
  const after = [car('f1', ['f1', 'f2'])];                    // 2 girls, 1 seat: one more seat needed
  const r = analyzeImpact({ ...base, families: f, before, after, priority: { f3: 1, f2: 2 } });
  assert.deepEqual(r, { kind: 'needSeat', driverId: 'f3' });
});
test('extra plek nodig: the proposed driver is not one who already drives in this shift, and is not a Flex family', () => {
  const f = { ...fams, f1: { ...fams.f1, capacity: 2 }, f3: { ...fams.f3, familyType: 'flex' } };
  const r = analyzeImpact({ ...base, families: f, before: [car('f1', ['f1'])], after: [car('f1', ['f1', 'f4']), car('f2', ['f2'])], priority: { f2: 1, f6: 2 } });
  assert.equal(r.kind, 'needSeat'); assert.equal(r.driverId, 'f6');
});
test('extra plek nodig: a car whose driver was removed needs a driver with enough seats', () => {
  const r = analyzeImpact({ ...base, before: [car('f1', ['f1', 'f2'])], after: [car(null, ['f1', 'f2'])] });
  assert.equal(r.kind, 'needSeat');
  assert.ok(['f1', 'f2', 'f3', 'f6'].includes(r.driverId), r.driverId);   // any available driver with at least 2 seats
});
test('geen oplossing → back-up: nobody with standard availability has room, but a back-up driver has', () => {
  const only = { f1: { ...fams.f1, capacity: 2 }, f2: fams.f2, f4: { ...fams.f4, availability: { Ma: { heen: false, terug: false, backupHeen: true, backupTerug: false } }, capacity: 6 } };
  const r = analyzeImpact({ ...base, families: { ...only, f2: { ...fams.f2, capacity: 2, availability: { Ma: { heen: true } } } }, before: [car('f1', ['f1'])], after: [car('f1', ['f1', 'f2', 'f4'])] });
  assert.deepEqual(r, { kind: 'noSolution', backupId: 'f4' });
});
test('geen oplossing: without any back-up the result says so (no name)', () => {
  const lone = { f1: { ...fams.f1, capacity: 2 }, f2: { ...fams.f2, capacity: 2, availability: {} } };
  const r = analyzeImpact({ ...base, families: lone, before: [car('f1', ['f1'])], after: [car('f1', ['f1', 'f2'])] });
  assert.deepEqual(r, { kind: 'noSolution', backupId: null });
});

console.log('\n=== texts ===');
const nm = id => ({ f3: 'Kees de Vries', f4: 'Mo Bakker' }[id]);
test('the four texts', () => {
  assert.equal(impactText({ kind: 'saves' }, nm), 'Scheelt een auto');
  assert.equal(impactText({ kind: 'none' }, nm), 'Geen effect');
  assert.equal(impactText({ kind: 'needSeat', driverId: 'f3' }, nm), 'Extra plek nodig → voorstel: Kees de Vries');
  assert.equal(impactText({ kind: 'noSolution', backupId: 'f4' }, nm), 'Geen oplossing → back-up Mo Bakker');
  assert.equal(impactText({ kind: 'noSolution', backupId: null }, nm), 'Geen oplossing en geen back-up beschikbaar');
});

console.log('\n=== the switch: off by default, nothing left behind ===');
await testAsync('off by default: no document, impactEnabled is false', async () => {
  useFakeDb({}); resetState();
  assert.equal(await impactEnabled(), false);
});
await testAsync('switching on stores one flag; switching off deletes the document again', async () => {
  const fake = useFakeDb({}); resetState();
  await setImpactEnabled(true);
  assert.equal(await impactEnabled(), true); assert.deepEqual(fake.get('settings/features'), { impactPreview: true });
  await setImpactEnabled(false);
  assert.equal(await impactEnabled(), false); assert.equal(fake.get('settings/features'), undefined);
  assert.deepEqual(fake.collection('settings'), []);
});
test('the Beheer card shows the pilot text and the state of the switch', () => {
  resetState({ impactPreview: false });
  assert.match(impactCardHtml(), /id="impactToggle" >/);
  assert.match(impactCardHtml(), /pilot|Pilot/);
  resetState({ impactPreview: true });
  assert.match(impactCardHtml(), /id="impactToggle" checked>/);
});
await testAsync('wireImpactCard loads the stored value once and asks for a re-render', async () => {
  useFakeDb({ 'settings/features': { impactPreview: true } }); resetState({ impactPreview: null });
  let n = 0; wireImpactCard(() => n++); await tick(); await tick();
  assert.equal(S.impactPreview, true); assert.equal(n, 1);
});

console.log('\n=== the save gate (hook in saveDeviationCars) ===');
await testAsync('switch off: a deviation is saved at once, exactly as before', async () => {
  const fake = useFakeDb({}); sampleParentState();
  const ok = await withFakeNowAsync(NOW, () => saveDeviationCars('Ma', 'heen', [car('f1', ['f1'])]));
  assert.equal(ok, true); assert.ok(fake.get('deviations/Ma_heen'));
});
await testAsync('switch on: the save is held, the sheet shows the impact, and nothing is written until "Opslaan"', async () => {
  const fake = useFakeDb({ 'settings/features': { impactPreview: true } }); sampleParentState();
  const added = []; const realCreate = dom.doc.createElement; dom.doc.createElement = () => { const e = realCreate(); e.querySelector = () => ({ onclick: null, focus() {} }); e.querySelectorAll = () => []; added.push(e); return e; };
  const cars = [{ driverFamilyId: 'f1', girlIds: ['f1'], departureTime: '07:30' }, { driverFamilyId: 'f2', girlIds: [], departureTime: '' }];
  const ok = await withFakeNowAsync(NOW, () => saveDeviationCars('Ma', 'heen', cars));
  dom.doc.createElement = realCreate;
  assert.equal(ok, false, 'held');
  assert.equal(fake.get('deviations/Ma_heen'), undefined, 'nothing stored yet');
  assert.ok(added.length && /Geen effect/.test(added[0].innerHTML), 'the sheet names the impact');
  assert.match(added[0].innerHTML, /Opslaan/);
});
await testAsync('confirming saves for real without asking again, and stores no preview data', async () => {
  const fake = useFakeDb({ 'settings/features': { impactPreview: true } }); sampleParentState();
  const cars = [car('f1', ['f1', 'f2'])];
  const held = await withFakeNowAsync(NOW, () => impactGate('Ma', 'heen', cars, () => saveDeviationCars('Ma', 'heen', cars, { skipGate: true }), null));
  assert.equal(held, true);
  const saved = await withFakeNowAsync(NOW, () => saveDeviationCars('Ma', 'heen', cars, { skipGate: true }));
  assert.equal(saved, true);
  assert.deepEqual(fake.collection('deviations').map(e => e[0]), ['Ma_heen']);
  assert.deepEqual(fake.collection('settings').map(e => e[0]), ['features', 'lastUpdateDeviation']);   // no preview document
});
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
