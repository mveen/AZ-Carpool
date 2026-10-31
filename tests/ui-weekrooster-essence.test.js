// Run with: node ui-weekrooster-essence.test.js
// ui-weekrooster-essence.js: the core of a proposal in a few words (who rides with whom, which car leaves at another time), shared by the entry card and step 2.
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
import { installFakeDom, useFakeDb, withFakeNow, NOW, sampleDbSeed, sampleParentState, sampleGroups, assertNoUnusedImports } from './test-support.js';
import { adviceForDay, planOf, syncWeekRequests, withManual } from '../weekrooster-data.js';
import { essenceHtml, essenceOf, requestRowsHtml } from '../ui-weekrooster-essence.js';

installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const tick = () => new Promise(r => setImmediate(r));
const car = (dir, n, driver, girls, dep) => ({ ['Do_' + dir + '_' + n]: { day: 'Do', direction: dir, girlIds: girls, driverFamilyId: driver, reserveFamilyIds: [], departureTime: dep } });
const CARS = { ...sampleGroups(), ...car('heen', 1, 'f1', ['f1', 'f3'], '07:30'), ...car('heen', 2, 'f2', ['f2', 'f4'], '09:15'), ...car('terug', 1, 'f1', ['f1', 'f3'], '17:00'), ...car('terug', 2, 'f2', ['f2', 'f4'], '18:00') };
const lois = { weekKey: '2026-W40', day: 'Do', familyId: 'f5', rides: true, heen: '09:00', terug: '17:00', status: 'pending', createdAt: 1, updatedAt: 1 };
const setup = async (req = lois) => { useFakeDb({ ...sampleDbSeed(), ['weekRequests/2026-W40_Do_' + req.familyId]: req }); sampleParentState({ dayCoordinators: { Do: 'f2' }, scheduleDay: 'Do', roosterMode: 'week', groups: CARS }); syncWeekRequests(); await tick(); };

await testAsync('the advice in a few words: who rides with whom, in the tints of heen (sun) and terug (moon)', async () => {
  await setup();
  withFakeNow(NOW, () => {
    const adv = adviceForDay('Do'), plan = planOf(adv, 'best');
    const html = essenceHtml(adv, plan, 'entryCard__more'), s = text(html);
    assert.match(html, /^<div class="essRows entryCard__more">/); assert.match(html, /essRow essRow--heen/); assert.doesNotMatch(html, /essRow--terug/);   // only heen changes on this day
    assert.match(s, /^Heen Lois rijdt mee met Jan Jansen \(07:30\)$/); assert.match(html, /<b>Lois<\/b>/);
    assert.doesNotMatch(html.replace(/<svg[\s\S]*?<\/svg>/g, ''), /style=/);
  });
});
await testAsync('the requests as they are asked: per direction, a girl per line, "aanwezig om" / "klaar om", the old time struck through, no icons', async () => {
  await setup();
  withFakeNow(NOW, () => {
    const html = requestRowsHtml(adviceForDay('Do')), s = text(html);
    assert.match(html, /^<div class="essRows essRows--req">/); assert.match(html, /essRow essRow--heen/); assert.doesNotMatch(html, /essRow--terug/);   // Lois only asks another time for heen
    assert.match(s, /^Heen Lois aanwezig om 09:00 08:30$/); assert.match(html, /<s>08:30<\/s>/); assert.match(html, /<b>Lois<\/b>/);
    assert.doesNotMatch(html, /<svg|style=|rijdt mee/);   // the tint says heen or terug; "rijdt mee" is not what is asked
  });
});
await testAsync('a car that leaves at another time, several girls who come, and a car that stops driving', async () => {
  await setup();
  withFakeNow(NOW, () => {
    const adv = adviceForDay('Do');
    const p = planOf(adv, 'best', { heen: [{ driverFamilyId: 'f2', girlIds: ['f2', 'f4', 'f5', 'f3'], departureTime: '08:00' }] });
    assert.deepEqual(essenceOf(adv, p).map(r => r.dir), ['heen']);
    assert.equal(text(essenceOf(adv, p)[0].html), 'Piet Pieters vertrekt 08:00 (was 09:15). Anouk en Lois rijden mee met Piet Pieters (08:00). Jan Jansen rijdt niet meer');
    const same = planOf(adv, 'best', { heen: adv.directions.heen.cars });
    assert.equal(essenceHtml(adv, same), '');   // the situation as it is: nothing to say
  });
});
await testAsync('a girl taken out of her car by hand is named', async () => {
  await setup();
  withFakeNow(NOW, () => {
    const adv = withManual(adviceForDay('Do'), { off: { heen: ['f4'] } }), p = planOf(adv, 'best', { heen: [{ driverFamilyId: 'f1', girlIds: ['f1', 'f3'], departureTime: '07:30' }, { driverFamilyId: 'f2', girlIds: ['f2'], departureTime: '09:15' }] });
    assert.match(text(essenceHtml(adv, p)), /Evi rijdt niet mee/);
  });
});
test('ui-weekrooster-essence.js imports nothing it does not use', () => assertNoUnusedImports('ui-weekrooster-essence.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
