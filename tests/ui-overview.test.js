// Run with: node ui-overview.test.js
// Weekoverzicht: the whole week on one page in the layout of the PDF (Rooster → Weekoverzicht), with print / save as PDF.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, sampleParentState, withFakeNow, NOW, expectSnapshot } from './test-support.js';
import { S } from '../state.js';
import { overviewData, overviewHtml, openOverview, closeOverview, printOverview } from '../ui-overview.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').replace(/ ,/g, ',').trim();
const html = (patch = {}) => withFakeNow(NOW, () => { sampleParentState({ dayCoordinators: { Ma: 'f2', Di: 'f1' }, ...patch }); return overviewHtml(); });

console.log('=== Weekoverzicht: gegevens ===');
test('per day the rides come as heen then terug, with driver, passengers, seats used and the reserves of that shift', () => {
  withFakeNow(NOW, () => sampleParentState({ dayCoordinators: { Ma: 'f2' } }));
  const d = overviewData();
  assert.deepEqual(d.days.map(x => x.day), ['Ma', 'Di', 'Wo', 'Do', 'Vr']);
  const ma = d.days[0];
  assert.equal(ma.coordinator, 'Piet Pieters');
  const heen = ma.shifts[0];
  assert.equal(heen.direction, 'heen');
  assert.deepEqual(heen.rows.map(r => [r.car, r.time, r.driver, r.passengers.join('+'), r.used, r.seats]), [[1, '07:30', 'Jan Jansen', 'Eline+Jahaimy', 2, 3]]);
  assert.deepEqual(heen.reserve, ['Piet Pieters', 'Kees de Vries', 'Tom Visser']);   // Jan drives, so he is not a reserve
});
test('a one-off change of this week replaces the standard rooster and is flagged', () => {
  withFakeNow(NOW, () => sampleParentState());
  const di = overviewData().days[1].shifts[0];
  assert.equal(di.changed, true);
  assert.deepEqual(di.rows.map(r => [r.driver, r.time]), [['Kees de Vries', '09:15']]);
  assert.equal(overviewData().days[0].shifts[0].changed, false);
});
test('a driver of the shift is never in the reserve list of that shift', () => {
  withFakeNow(NOW, () => sampleParentState());
  overviewData().days.forEach(day => day.shifts.forEach(s => s.rows.forEach(r => assert.ok(!s.reserve.includes(r.driver), `${r.driver} drives and is also reserve on ${day.day} ${s.direction}`))));
});
test('rijfrequentie counts the rides each driver has this week, most rides first', () => {
  withFakeNow(NOW, () => sampleParentState());
  const total = overviewData().days.reduce((n, d) => n + d.shifts.reduce((m, s) => m + s.rows.filter(r => r.driverId).length, 0), 0);
  const f = overviewData().frequency;
  assert.equal(f.reduce((n, x) => n + x.n, 0), total);
  for (let i = 1; i < f.length; i++) assert.ok(f[i - 1].n >= f[i].n);
});
test('speelsters: arrival time (heen) and pick-up time (terug) per day, empty when she does not ride', () => {
  withFakeNow(NOW, () => sampleParentState());
  const eline = overviewData().girls.find(g => g.name === 'Eline');
  assert.deepEqual(eline.times[0], { heen: '08:30', terug: '17:00' });   // Monday
  assert.deepEqual(eline.times[2], { heen: '', terug: '16:00' });        // Wednesday: only terug
  assert.deepEqual(overviewData().girls.map(g => g.name), [...overviewData().girls.map(g => g.name)].sort((a, b) => a.localeCompare(b, 'nl-NL')));
});

console.log('\n=== Weekoverzicht: pagina ===');
test('header lines follow the PDF: title, week, departure places, version', () => {
  const s = text(html());
  assert.match(s, /Carpooloverzicht AZ, regio Aalsmeer/);
  assert.match(s, /Week 40 · 28 sep – 2 okt/);
  assert.match(s, /Vertrektijden heen: Busstation, terug: AFC &#39;34/);
  assert.match(s, /Versie: \d{1,2}-\d{1,2}-2026 \d{2}:\d{2}/);
});
test('the standard-ride cost line uses the fixed distance from Beheer and 20 ct/km, and is left out without it', () => {
  const s = text(html({ locationsDoc: { fixedKm: { AFC: 55, ATC: 12 } } }));
  assert.match(s, /Standaardrit = 55 km \(€11,-\); heen & weer = 110 km \(€22,-\) \(20ct\/km\)/);
  assert.doesNotMatch(text(html()), /Standaardrit/);
});
test('the table has the PDF columns, a row per day with its coordinator, and Dag/Rit/Tijdstip/Auto/Chauffeur/Passagiers/Bezetting/Reserve per ride', () => {
  const s = text(html());
  assert.match(s, /Dag Rit Tijdstip Auto Chauffeur Passagiers Bezetting Reserve \(volgorde van vragen\)/);
  assert.match(s, /MAANDAG Coördinator: Piet Pieters/);
  assert.match(s, /DINSDAG Coördinator: Jan Jansen/);
  assert.match(s, /Ma Heen 07:30 1 Jan Jansen Eline, Jahaimy 2\/3 Piet Pieters, Kees de Vries, Tom Visser/);
});
test('every ride of a shift shows the same reserve list (as in the PDF)', () => {
  const s = text(html());
  assert.match(s, /Ma Terug 17:30 1 Piet Pieters Eline, Jahaimy, Saar 3\/4 Jan Jansen, Kees de Vries, Tom Visser/);
  const d = withFakeNow(NOW, () => { sampleParentState({ deviations: {}, groups: { a: { day: 'Ma', direction: 'heen', girlIds: ['f1'], driverFamilyId: 'f1', departureTime: '08:00' }, b: { day: 'Ma', direction: 'heen', girlIds: ['f6'], driverFamilyId: 'f6', departureTime: '09:00' } } }); return overviewData(); });
  const rows = d.days[0].shifts[0];
  assert.equal(rows.rows.length, 2);
  assert.deepEqual(rows.reserve, ['Piet Pieters', 'Kees de Vries']);   // both drivers of the shift left out
  const h = withFakeNow(NOW, () => overviewHtml());
  assert.equal((h.match(/Piet Pieters, Kees de Vries<\/td>/g) || []).length, 2);
});
test('a changed shift is marked with * and explained under the table', () => {
  const s = text(html());
  assert.match(s, /Di Heen 09:15\* 1 Kees de Vries Eline, Evi/);
  assert.match(s, /\* Deze week aangepast ten opzichte van het vaste rooster\./);
});
test('names are escaped', () => {
  const s = withFakeNow(NOW, () => { sampleParentState(); S.families.f1.parentName = '<b>Jan</b>'; return overviewHtml(); });
  assert.doesNotMatch(s, /<b>Jan<\/b>/); assert.match(s, /&lt;b&gt;Jan&lt;\/b&gt;/);
});
test('the rijfrequentie table and the speelsters table come with the page', () => {
  const s = text(html());
  assert.match(s, /Auto Rijfrequentie/);
  assert.match(s, /Speelster Ma Di Wo Do Vr aank\. klaar aank\. klaar aank\. klaar aank\. klaar aank\. klaar/);
  assert.match(s, /Eline 08:30 17:00 10:15 17:30 – 16:00/);
});
test('page as a snapshot', () => { expectSnapshot('ui-overview', 'week 40 overview', html({ locationsDoc: { fixedKm: { AFC: 55, ATC: 12 } } })); });

console.log('\n=== Weekoverzicht: openen, afdrukken, sluiten ===');
test('opening puts the overview on top of the app, with a print button and a close button', () => {
  dom.doc.body.children.length = 0;
  withFakeNow(NOW, () => { sampleParentState(); openOverview(); });
  const ov = dom.doc.body.children[0];
  assert.equal(ov.id, 'ovOverlay'); assert.equal(ov.getAttribute('role'), 'dialog');
  assert.match(ov.innerHTML, /id="ovPrint"[^>]*>[^<]*<svg[\s\S]*?Afdrukken \/ PDF/);
  assert.match(ov.innerHTML, /id="ovClose"[\s\S]*?Sluiten/);
  assert.match(ov.innerHTML, /class="ovBar noPrint"/);       // the buttons are not printed
  assert.match(ov.innerHTML, /Carpooloverzicht AZ, regio Aalsmeer/);
});
test('the print button prints (the print dialog also offers "save as PDF")', () => {
  let printed = 0; globalThis.print = () => { printed++; };
  printOverview();
  assert.equal(printed, 1);
  globalThis.print = () => { throw new Error('no printer'); };
  printOverview();                                            // a failing print must not break the app
  delete globalThis.print;
});
test('closing removes the overview again', () => {
  const ov = dom.el('ovOverlay'); let removed = 0; ov.remove = () => { removed++; };
  closeOverview();
  assert.equal(removed, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
