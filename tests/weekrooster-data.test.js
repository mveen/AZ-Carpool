// Run with: node weekrooster-data.test.js
// Afwijkend weekrooster, the database side: only the real coordinator can switch it, it is stored with a time, and it is off
// until a real mode is read. The database here is ALWAYS the in-memory fake.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, useFakeDb, sampleDbSeed, sampleParentState, sampleCoordinatorState } from './test-support.js';
import { S } from '../state.js';
import { weekroosterMode, weekroosterOn, setWeekrooster } from '../weekrooster-data.js';

const dom = installFakeDom();
const toast = () => dom.doc.getElementById('toast').innerHTML.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

console.log('=== the mode ===');
await testAsync('the mode is uit when nothing is stored and only a real mode counts', async () => {
  sampleParentState({}); assert.equal(S.weekrooster, null); assert.equal(weekroosterMode(), 'uit');
  S.weekrooster = { mode: 'aan ' }; assert.equal(weekroosterMode(), 'uit');
  S.weekrooster = { mode: 'test' }; assert.equal(weekroosterMode(), 'test');
});
await testAsync('uit: nobody; test: only the real coordinator, also when he looks as a family; aan: everybody', async () => {
  sampleParentState({ weekrooster: { mode: 'uit' } }); assert.equal(weekroosterOn(), false);
  sampleCoordinatorState({ weekrooster: { mode: 'uit' } }); assert.equal(weekroosterOn(), false);
  sampleParentState({ weekrooster: { mode: 'test' } }); assert.equal(weekroosterOn(), false);
  sampleCoordinatorState({ weekrooster: { mode: 'test' } }); assert.equal(weekroosterOn(), true);
  sampleCoordinatorState({ weekrooster: { mode: 'test' }, impersonateFamilyId: 'f2' }); assert.equal(weekroosterOn(), true);
  sampleParentState({ weekrooster: { mode: 'aan' } }); assert.equal(weekroosterOn(), true);
});

console.log('=== switching ===');
await testAsync('a parent cannot switch it and nothing is written', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({});
  assert.equal(await setWeekrooster('aan'), false);
  assert.match(toast(), /Alleen de coördinator/);
  assert.equal(fake.get('settings/weekrooster'), undefined); assert.equal(S.weekrooster, null);
});
await testAsync('the coordinator switches it, it is stored with a time and nothing else is touched', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({});
  const before = [...fake.store.keys()].sort();
  assert.equal(await setWeekrooster('test'), true);
  const d = fake.get('settings/weekrooster');
  assert.equal(d.mode, 'test'); assert.equal(typeof d.updatedAt, 'number'); assert.deepEqual(Object.keys(d).sort(), ['mode', 'updatedAt']);
  assert.deepEqual([...fake.store.keys()].sort(), [...before, 'settings/weekrooster'].sort());
  assert.equal(weekroosterMode(), 'test'); assert.match(toast(), /Test/);
  assert.equal(await setWeekrooster('aan'), true); assert.equal(fake.get('settings/weekrooster').mode, 'aan'); assert.match(toast(), /Aan/);
  assert.equal(await setWeekrooster('uit'), true); assert.equal(fake.get('settings/weekrooster').mode, 'uit'); assert.equal(weekroosterOn(), false); assert.match(toast(), /Uit/);
});
await testAsync('an unknown mode is stored as uit, never as something else', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({});
  assert.equal(await setWeekrooster('maybe'), true);
  assert.equal(fake.get('settings/weekrooster').mode, 'uit'); assert.equal(weekroosterMode(), 'uit');
});
await testAsync('a refused save says why and keeps the old mode', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ weekrooster: { mode: 'uit' } });
  fake.failWrites('settings/weekrooster', 'permission-denied');
  assert.equal(await setWeekrooster('aan'), false);
  assert.match(toast(), /permission-denied/); assert.equal(weekroosterMode(), 'uit');
});

import { assertNoUnusedImports } from './test-support.js';
await testAsync('weekrooster-data.js imports nothing it does not use', async () => assertNoUnusedImports('weekrooster-data.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
