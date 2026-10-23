// Run with: node ui-driver-car.test.js
// The driver's button "Tijd en plek" (Mijn week and Rooster), the sheet behind it, the log of the day coordinator
// and the explicit line "Vertrektijd gewijzigd" in Mijn week.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, useFakeDb, withFakeNow, withFakeNowAsync, NOW, sampleDbSeed, sampleParentState, sampleDeviations, assertNoUnusedImports } from './test-support.js';
import { S } from '../state.js';
import { syncWeekRequests } from '../weekrooster-data.js';
import { renderSchedule } from '../ui-schedule.js';
import { renderMyWeek } from '../ui-myweek.js';
import { driverCarButtonHtml, wireDriverCar, openDriverCarSheet } from '../ui-driver-car.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const tick = () => new Promise(r => setImmediate(r));
const toast = () => text(dom.doc.getElementById('toast').innerHTML);
const sheet = () => dom.doc.body.children[dom.doc.body.children.length - 1];
const DEV = (day, direction, cars, extra = {}) => ({ day, direction, weekKey: '2026-W40', expiresAt: 1791500000000, cars, ...extra });
const MINE = { driverFamilyId: 'f2', girlIds: ['f1', 'f2'], reserveFamilyIds: [], departureTime: '18:00' };
const setup = async (cars = [MINE], patch = {}, extra = {}) => {
  const devs = { Do_terug: DEV('Do', 'terug', cars), ...extra };
  const fake = useFakeDb({ ...sampleDbSeed(), ...Object.fromEntries(Object.entries(devs).map(([k, v]) => ['deviations/' + k, v])) });
  sampleParentState({ weekrooster: { mode: 'aan' }, dayCoordinators: { Do: 'f3' }, deviations: { ...sampleDeviations(), ...devs }, scheduleDay: 'Do', roosterMode: 'week', ...patch });
  syncWeekRequests(); await tick(); return fake;
};
const rooster = () => { withFakeNow(NOW, () => renderSchedule()); return dom.html('tab-schedule'); };
const myweek = () => { withFakeNow(NOW, () => renderMyWeek()); return dom.html('tab-myweek'); };
const open = (day = 'Do', dir = 'terug') => { withFakeNow(NOW, () => openDriverCarSheet(day, dir, null)); return sheet(); };

console.log('=== the button ===');
await testAsync('the driver sees "Tijd en plek" under the own car in Rooster and in Mijn week', async () => {
  await setup();
  const r = rooster(); assert.match(r, /data-drivercar="Do\|terug"/); assert.match(text(r), /Tijd en plek/);
  assert.match(myweek(), /data-drivercar="Do\|terug"/);
});
await testAsync('nobody else sees it: not a passenger\'s parent, not on a shift without my car, not while the new flow is off, not on a day that is over', async () => {
  await setup([MINE], { links: { p1: { familyId: 'f4' } } });
  assert.doesNotMatch(rooster(), /data-drivercar/); assert.doesNotMatch(myweek(), /data-drivercar/);
  await setup([MINE], { weekrooster: { mode: 'uit' } });
  assert.doesNotMatch(rooster(), /data-drivercar/); assert.doesNotMatch(myweek(), /data-drivercar/);
  await setup([MINE]);
  withFakeNow(NOW, () => { assert.equal(driverCarButtonHtml('Do', 'heen'), '', 'I do not drive Thursday heen'); assert.equal(driverCarButtonHtml('Ma', 'terug'), '', 'Monday is over'); assert.match(driverCarButtonHtml('Do', 'terug'), /data-drivercar/); });
});
await testAsync('the day coordinator gets the button for the own car as well (the car editor stays for the other cars)', async () => {
  await setup([MINE], { dayCoordinators: { Do: 'f2' } });
  assert.match(rooster(), /data-drivercar="Do\|terug"/);
});

console.log('=== the sheet ===');
await testAsync('the sheet shows the day, the calculated time, who rides along, the time of the car and the place options; no warning about the day coordinator', async () => {
  await setup(); const s = open(), html = s.innerHTML, t = text(html);
  assert.match(t, /Tijd en plek van jouw auto/); assert.match(t, /donderdag terug/); assert.match(t, /Berekende tijd: 18:00/); assert.match(t, /Eline, Jahaimy/);
  assert.match(html, /id="drvTime"[^>]*value="18:00"/); assert.match(html, /id="drvPlace"/); assert.match(t, /Standaard: Busstation/); assert.match(t, /Ander adres/);
  assert.match(html, /id="drvPlaceTxt"[^>]*hidden/); assert.doesNotMatch(t, /Dagcoördinator beslist/);
  assert.doesNotMatch(html, /id="drvReset"/, 'nothing to reset yet');
});
await testAsync('a car that differs from automatic shows "Weer automatisch berekenen"; an offered ride gets a note', async () => {
  await setup([{ ...MINE, departureTime: '18:30' }], { offers: { o1: { status: 'open', weekKey: '2026-W40', day: 'Do', direction: 'terug', offeredBy: 'f2', date: '2026-10-01', time: '18:30' } } });
  const html = open().innerHTML; assert.match(html, /id="drvReset"/); assert.match(text(html), /Je hebt deze rit aangeboden in Ritten ruilen/);
});
await testAsync('Opslaan saves the time and the place and says so, with Ongedaan', async () => {
  const fake = await setup(); open();
  dom.el('drvTime').value = '18:30'; dom.el('drvPlace').value = 'de-parel';
  await withFakeNowAsync(NOW, async () => { await dom.el('drvSave').onclick(); await tick(); });
  const c = fake.get('deviations/Do_terug').cars[0]; assert.deepEqual([c.departureTime, c.locationId], ['18:30', 'de-parel']);
  assert.match(toast(), /Tijd en plek opgeslagen/); assert.match(dom.el('toast').innerHTML, /Ongedaan/);
});
await testAsync('a free address is saved as free text; an empty free address is refused', async () => {
  const fake = await setup(); open();
  dom.el('drvTime').value = '18:30'; dom.el('drvPlace').value = '__free'; dom.el('drvPlaceTxt').value = '   ';
  await withFakeNowAsync(NOW, async () => { await dom.el('drvSave').onclick(); await tick(); });
  assert.match(toast(), /Vul een adres of een plek in/); assert.equal(fake.get('deviations/Do_terug').cars[0].departureTime, '18:00');
  dom.el('drvPlaceTxt').value = ' Hoofdweg 12 ';
  await withFakeNowAsync(NOW, async () => { await dom.el('drvSave').onclick(); await tick(); });
  assert.equal(fake.get('deviations/Do_terug').cars[0].locationText, 'Hoofdweg 12');
});
await testAsync('a time that makes someone late is saved but warns (terug earlier than calculated)', async () => {
  const fake = await setup(); open(); dom.el('drvTime').value = '17:00'; dom.el('drvPlace').value = '';
  await withFakeNowAsync(NOW, async () => { await dom.el('drvSave').onclick(); await tick(); });
  assert.equal(fake.get('deviations/Do_terug').cars[0].departureTime, '17:00'); assert.match(toast(), /Let op: de berekende tijd is 18:00\. Eerder vertrekken/);
});
await testAsync('an empty time is refused with a message', async () => {
  const fake = await setup(); open(); dom.el('drvTime').value = '';
  await withFakeNowAsync(NOW, async () => { await dom.el('drvSave').onclick(); await tick(); });
  assert.match(toast(), /Vul een geldige vertrektijd in/); assert.equal(fake.get('deviations/Do_terug').cars[0].departureTime, '18:00');
});
await testAsync('Weer automatisch berekenen takes the choice away', async () => {
  const fake = await setup([{ ...MINE, departureTime: '19:00', locationId: 'de-parel' }]); open();
  await withFakeNowAsync(NOW, async () => { await dom.el('drvReset').onclick(); await tick(); });
  const c = fake.get('deviations/Do_terug').cars[0]; assert.deepEqual([c.departureTime, c.locationId], ['18:00', undefined]);
});
await testAsync('the buttons are wired: a tap on "Tijd en plek" opens the sheet of that shift', async () => {
  await setup(); const btn = { dataset: { drivercar: 'Do|terug' } };
  withFakeNow(NOW, () => { wireDriverCar({ querySelectorAll: () => [btn] }, null); btn.onclick(); });
  assert.match(text(sheet().innerHTML), /Tijd en plek van jouw auto/);
});

console.log('=== the log of the day coordinator ===');
await testAsync('a change by a driver shows in "Recente wijzigingen" as a change made by the family itself', async () => {
  await setup([{ ...MINE, departureTime: '18:30' }], { dayCoordinators: { Do: 'f1' }, links: { p1: { familyId: 'f1' } } }, {});
  S.deviations.Do_terug = { ...S.deviations.Do_terug, selfBy: 'f2', selfAt: new Date(NOW).getTime() - 60000 };
  assert.match(text(rooster()), /Jahaimy: terug zelf aangepast/);
});

console.log('=== Mijn week says it ===');
await testAsync('a changed departure time shows "was 18:00" under the new time at my ride; an unchanged one says nothing', async () => {
  await setup([{ ...MINE, departureTime: '18:45' }], { groups: { Do_terug_1: { day: 'Do', direction: 'terug', girlIds: ['f1', 'f2'], driverFamilyId: 'f2', reserveFamilyIds: [], departureTime: '18:00' } } });
  assert.match(text(myweek()), /18:45 was 18:00/);
  await setup([MINE], { groups: { Do_terug_1: { day: 'Do', direction: 'terug', girlIds: ['f1', 'f2'], driverFamilyId: 'f2', reserveFamilyIds: [], departureTime: '18:00' } } });
  assert.doesNotMatch(text(myweek()), /was 18:00/);
  await setup([{ ...MINE, departureTime: '18:45' }], { groups: { Do_terug_1: { day: 'Do', direction: 'terug', girlIds: ['f1', 'f2'], driverFamilyId: 'f2', reserveFamilyIds: [], departureTime: '18:00' } }, links: { p1: { familyId: 'f1' } } });
  assert.match(text(myweek()), /18:45 was 18:00/, 'the parent of a girl in that car sees it too');
});

await testAsync('ui-driver-car.js imports nothing it does not use', async () => assertNoUnusedImports('ui-driver-car.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
