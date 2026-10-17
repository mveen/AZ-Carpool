// Run with: node ui-weekrooster.test.js
// Afwijkend weekrooster, the screens (phase 1): the switch card in Beheer, and the promise that with the switch off, or on for
// someone else, no new element shows up anywhere and nothing new is written.
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
import { installFakeDom, useFakeDb, withFakeNow, NOW, sampleDbSeed, sampleParentState, sampleCoordinatorState } from './test-support.js';
import { renderBeheer } from '../ui-beheer.js';
import { renderMyWeek } from '../ui-myweek.js';
import { renderSchedule } from '../ui-schedule.js';
import { renderDeviationTab } from '../ui-deviation.js';
import { weekroosterCardHtml, wireWeekroosterCard } from '../ui-weekrooster.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

console.log('=== the Beheer card ===');
test('the card has the three modes, uit is selected by default and the text says what each mode does', () => {
  sampleCoordinatorState({});
  const html = weekroosterCardHtml(), s = text(html);
  assert.match(html, /id="weekroosterCard"/);
  assert.deepEqual([...html.matchAll(/data-wrmode="(\w+)"/g)].map(m => m[1]), ['uit', 'test', 'aan']);
  assert.match(html, /class="active" data-wrmode="uit" aria-pressed="true"/);
  assert.match(html, /data-wrmode="test" aria-pressed="false"/);
  assert.match(s, /Uit: de app werkt precies als voorheen/);
  assert.match(s, /De schakelaar slaat direct op/);
  assert.match(s, /database-regels/);
});
test('each mode shows its own explanation and chip', () => {
  sampleCoordinatorState({ weekrooster: { mode: 'test' } });
  assert.match(text(weekroosterCardHtml()), /Test: alleen jij ziet de nieuwe functie/);
  assert.match(weekroosterCardHtml(), /noticeChip ok/);
  sampleCoordinatorState({ weekrooster: { mode: 'aan' } });
  assert.match(text(weekroosterCardHtml()), /Aan: iedereen ziet de nieuwe functie/);
  sampleCoordinatorState({ weekrooster: { mode: 'kapot' } });
  assert.match(weekroosterCardHtml(), /class="active" data-wrmode="uit"/); assert.match(weekroosterCardHtml(), /noticeChip off/);
});
test('the card sits in Beheer, Berichten, right after Ritten ruilen, for the coordinator only, with no Opslaan button and no inline style', () => {
  useFakeDb(sampleDbSeed()); sampleCoordinatorState({});
  withFakeNow(NOW, () => renderBeheer());
  const html = dom.html('tab-beheer');
  assert.ok(html.indexOf('id="ritbeursCard"') < html.indexOf('id="weekroosterCard"') && html.indexOf('id="weekroosterCard"') < html.indexOf('id="pushCard"'));
  const card = html.match(/id="weekroosterCard"[\s\S]*?<\/div>\s*<\/div>/)[0];
  assert.doesNotMatch(card, /Opslaan|style="/);
  sampleParentState({}); withFakeNow(NOW, () => renderBeheer());
  assert.doesNotMatch(dom.html('tab-beheer'), /weekroosterCard/);
});
await testAsync('a tap on a mode saves at once and the card shows it; a tap on the current mode does nothing', async () => {
  const fake = useFakeDb({ ...sampleDbSeed() }); sampleCoordinatorState({});
  withFakeNow(NOW, () => renderBeheer());
  const btns = ['uit', 'test', 'aan'].map(m => ({ dataset: { wrmode: m }, onclick: null }));
  const realQsa = dom.doc.querySelectorAll;
  dom.doc.querySelectorAll = sel => (sel === '[data-wrmode]' ? btns : realQsa(sel));
  try {
    wireWeekroosterCard();
    await btns[0].onclick();
    assert.equal(fake.get('settings/weekrooster'), undefined, 'uit while uit: no write');
    await withFakeNow(NOW, () => btns[1].onclick());
    assert.equal(fake.get('settings/weekrooster').mode, 'test');
    assert.match(dom.html('tab-beheer'), /class="active" data-wrmode="test"/);
  } finally { dom.doc.querySelectorAll = realQsa; }
});

console.log('=== uit (or someone else): nothing new anywhere ===');
const tabs = () => {
  withFakeNow(NOW, () => { renderMyWeek(); renderSchedule(); renderDeviationTab(); });
  return ['tab-myweek', 'tab-schedule', 'tab-deviation'].map(id => dom.html(id)).join('\n');
};
test('with every mode, parents get exactly the same screens as before (phase 1 shows nothing new)', () => {
  useFakeDb(sampleDbSeed());
  const out = {};
  [null, { mode: 'uit' }, { mode: 'test' }, { mode: 'aan' }, { mode: 'kapot' }].forEach((w, i) => { sampleParentState({ weekrooster: w }); out[i] = tabs(); });
  Object.values(out).forEach(h => assert.equal(h, out[0]));
  assert.doesNotMatch(out[0], /weekrooster|Tijden wijzigen|Toch zelf wijzigen|Doorgegeven|Aanvraag/i);
});
test('the coordinator gets the same parent screens in every mode as well', () => {
  useFakeDb(sampleDbSeed());
  const out = [];
  [null, { mode: 'test' }, { mode: 'aan' }].forEach(w => { sampleCoordinatorState({ weekrooster: w }); out.push(tabs()); });
  out.forEach(h => assert.equal(h, out[0]));
});
test('looking at the screens writes nothing to the database', () => {
  const fake = useFakeDb(sampleDbSeed()); const before = JSON.stringify([...fake.store.entries()]);
  sampleParentState({ weekrooster: { mode: 'aan' } }); tabs();
  sampleCoordinatorState({ weekrooster: { mode: 'test' } }); tabs(); withFakeNow(NOW, () => renderBeheer());
  assert.equal(JSON.stringify([...fake.store.entries()]), before);
});

import { assertNoUnusedImports } from './test-support.js';
test('ui-weekrooster.js imports nothing it does not use', () => assertNoUnusedImports('ui-weekrooster.js'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
