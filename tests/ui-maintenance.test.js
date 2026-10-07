// Run with: node ui-maintenance.test.js
// Onderhoudsmodus: the full-screen page (everyone but the coordinator), the reminder bar (coordinator), the Beheer card and saving.
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
import { installFakeDom, useFakeDb, sampleDbSeed, sampleCoordinatorState, sampleParentState } from './test-support.js';
import { S } from '../state.js';
import { renderMaintenance, maintenanceCardHtml, maintenancePageHtml, saveMaintenance, rememberMaintenanceDraft, readMaintenanceForm } from '../ui-maintenance.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const toast = () => dom.doc.getElementById('toast').innerHTML;
const setForm = v => { dom.el('maintenanceOn').checked = !!v.on; dom.el('maintenanceText').value = v.text || ''; };

console.log('=== the page for users ===');
test('off or not loaded: no page, nothing covered', () => {
  sampleParentState({ maintenance: null });
  assert.equal(renderMaintenance(), false);
  assert.equal(dom.el('maintenanceOverlay').style.display, 'none'); assert.equal(dom.html('maintenanceOverlay'), '');
  assert.equal(dom.el('topbar').getAttribute('inert'), null); assert.equal(dom.el('bottomnav').getAttribute('inert'), null);
  sampleParentState({ maintenance: { on: false, text: 'Terug om 8' } });
  assert.equal(renderMaintenance(), false); assert.equal(dom.el('maintenanceOverlay').style.display, 'none');
});
test('on: a parent sees the page with the default text, and the app behind it is switched off for keyboard and screen readers', () => {
  sampleParentState({ maintenance: { on: true, text: '' } });
  assert.equal(renderMaintenance(), true);
  assert.equal(dom.el('maintenanceOverlay').style.display, 'flex'); assert.equal(dom.el('maintenanceOverlay').getAttribute('role'), 'alert');
  const s = text(dom.html('maintenanceOverlay'));
  assert.match(s, /De app is even niet beschikbaar/); assert.match(s, /We doen onderhoud aan de app/); assert.match(s, /verdwijnt vanzelf/);
  assert.equal(dom.el('topbar').getAttribute('inert'), ''); assert.equal(dom.el('bottomnav').getAttribute('inert'), '');
  assert.equal(dom.el('maintenanceBanner').style.display, 'none');
});
test('the page shows only the car of the logo (one colour, no red button, no image file, no warning icon)', () => {
  sampleParentState({ maintenance: { on: true } }); renderMaintenance();
  const h = dom.html('maintenanceOverlay');
  assert.match(h, /<div class="maintLogo"><svg viewBox="14 192 430 176"/); assert.ok(!h.includes('<img')); assert.ok(!h.includes('#fff'));
  assert.ok(!h.includes('M236 208H20'), 'the warning triangle is gone');
});
test('on with own text: the coordinator\'s text replaces the default line', () => {
  sampleParentState({ maintenance: { on: true, text: 'We zijn terug rond 20:00.' } });
  renderMaintenance();
  const s = text(dom.html('maintenanceOverlay'));
  assert.match(s, /We zijn terug rond 20:00\./); assert.ok(!/We doen onderhoud/.test(s));
});
test('a user who is not linked (new browser) is blocked too while it is on', () => {
  sampleParentState({ links: {}, maintenance: { on: true } });
  assert.equal(renderMaintenance(), true);
});
test('the text is escaped: HTML typed by the coordinator never runs', () => {
  sampleParentState({ maintenance: { on: true, text: '<img src=x onerror=alert(1)>' } });
  renderMaintenance();
  assert.ok(!dom.html('maintenanceOverlay').includes('<img src=x')); assert.ok(dom.html('maintenanceOverlay').includes('&lt;img'));
});
test('switched off again: the page and the cover disappear at once', () => {
  sampleParentState({ maintenance: { on: true } }); renderMaintenance();
  S.maintenance = { on: false, text: '' }; assert.equal(renderMaintenance(), false);
  assert.equal(dom.el('maintenanceOverlay').style.display, 'none'); assert.equal(dom.html('maintenanceOverlay'), '');
  assert.equal(dom.el('topbar').getAttribute('inert'), null); assert.equal(dom.el('bottomnav').getAttribute('inert'), null);
});

console.log('=== the coordinator ===');
test('on: the coordinator is never blocked and sees a reminder bar instead', () => {
  sampleCoordinatorState({ maintenance: { on: true, text: 'x' } });
  assert.equal(renderMaintenance(), false);
  assert.equal(dom.el('maintenanceOverlay').style.display, 'none'); assert.equal(dom.el('topbar').getAttribute('inert'), null);
  assert.equal(dom.el('maintenanceBanner').style.display, 'flex'); assert.match(text(dom.html('maintenanceBanner')), /Onderhoudsmodus staat aan/);
});
test('the coordinator in the test view as a parent is not blocked either', () => {
  sampleCoordinatorState({ maintenance: { on: true }, impersonateFamilyId: 'f2', canEdit: false });
  assert.equal(renderMaintenance(), false); assert.equal(dom.el('maintenanceOverlay').style.display, 'none');
});
test('a coordinator who is a family-linked browser (not the claiming browser) is not blocked', () => {
  sampleParentState({ me: 'phone2', links: { phone2: { familyId: 'f1' } }, coordinatorConfig: { familyId: 'f1' }, maintenance: { on: true } });
  assert.equal(renderMaintenance(), false);
});
test('off: no reminder bar', () => {
  sampleCoordinatorState({ maintenance: { on: false } }); renderMaintenance();
  assert.equal(dom.el('maintenanceBanner').style.display, 'none'); assert.equal(dom.html('maintenanceBanner'), '');
});

console.log('=== the card in Beheer ===');
test('the card shows the switch, the text (max 150), the preview and the status', () => {
  sampleCoordinatorState({ maintenance: { on: true, text: 'Terug om 8' } });
  const h = maintenanceCardHtml(); const s = text(h);
  assert.match(s, /Onderhoudsmodus/); assert.match(s, /Onderhoudsmodus aan/); assert.match(s, /10 \/ 150/); assert.match(s, /Zo zien gebruikers het/);
  assert.match(s, /Aan, gebruikers zien de onderhoudspagina/); assert.match(h, /id="maintenanceOn"[^>]* checked/); assert.match(h, /maxlength="150"/);
  assert.match(s, /Terug om 8/);
});
test('no document yet: switch off, status "Uit"', () => {
  sampleCoordinatorState({ maintenance: null });
  const h = maintenanceCardHtml();
  assert.ok(!/id="maintenanceOn"[^>]* checked/.test(h)); assert.match(text(h), /Uit, de app is gewoon open/); assert.match(text(h), /0 \/ 150/);
});
test('what is typed survives a redraw (draft), and is escaped in the card', () => {
  sampleCoordinatorState({ maintenance: null });
  setForm({ on: true, text: 'A "quote" <b>' }); rememberMaintenanceDraft();
  const h = maintenanceCardHtml();
  assert.match(h, /value="A &quot;quote&quot; &lt;b&gt;"/); assert.match(h, /id="maintenanceOn"[^>]* checked/);
});
test('the preview is the same page the users see', () => {
  assert.equal(text(maintenancePageHtml('Hoi')), text(maintenancePageHtml('  Hoi ')));
  assert.match(text(maintenancePageHtml('')), /We doen onderhoud aan de app/);
});

console.log('=== saving ===');
await testAsync('switch on: saved in settings/maintenance, state updated, reminder bar visible, toast', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ maintenance: null, maintenanceDraft: null });
  setForm({ on: true, text: ' Terug  rond 20:00 ' });
  assert.equal(await saveMaintenance(), true);
  const doc = fake.get('settings/maintenance');
  assert.equal(doc.on, true); assert.equal(doc.text, 'Terug rond 20:00'); assert.equal(typeof doc.updatedAt, 'number');
  assert.equal(S.maintenance.on, true); assert.equal(S.maintenanceDraft, null);
  assert.equal(dom.el('maintenanceBanner').style.display, 'flex'); assert.equal(dom.el('maintenanceOverlay').style.display, 'none');
  assert.match(toast(), /Onderhoudsmodus staat aan/);
});
await testAsync('switch on without text is fine (default text is used)', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ maintenance: null });
  setForm({ on: true, text: '' });
  assert.equal(await saveMaintenance(), true); assert.equal(fake.get('settings/maintenance').on, true);
});
await testAsync('switch off: saved, text kept, reminder bar gone', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ maintenance: { on: true, text: 'Hoi' } });
  setForm({ on: false, text: 'Hoi' });
  assert.equal(await saveMaintenance(), true);
  assert.equal(fake.get('settings/maintenance').on, false); assert.equal(fake.get('settings/maintenance').text, 'Hoi');
  assert.equal(dom.el('maintenanceBanner').style.display, 'none'); assert.match(toast(), /Onderhoudsmodus staat uit/);
});
await testAsync('a parent cannot save it (and nothing is written)', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState({ maintenance: null });
  setForm({ on: true, text: 'x' });
  assert.equal(await saveMaintenance(), false);
  assert.equal(fake.get('settings/maintenance'), undefined); assert.match(toast(), /Alleen de coördinator/);
});
test('readMaintenanceForm reads both fields', () => {
  setForm({ on: true, text: 'Hoi' });
  assert.deepEqual(readMaintenanceForm(), { on: true, text: 'Hoi' });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
