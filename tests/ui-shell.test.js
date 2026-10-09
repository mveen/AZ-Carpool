// Run with: node ui-shell.test.js
// The frame around every screen: header (title, week line, share button, avatar letters) and the Instellingen sheet.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, resetState, sampleParentState, sampleCoordinatorState } from './test-support.js';
import { S } from '../state.js';
import { initials, updateHeader, openSettings, initShell, TAB_TITLE_KEY } from '../ui-shell.js';

const dom = installFakeDom();

console.log('=== initials ===');
test('first and last name give two letters; one name gives one; empty gives nothing', () => {
  assert.equal(initials('Sophie Veen'), 'SV'); assert.equal(initials('Kees de Vries'), 'KV'); assert.equal(initials('jan'), 'J');
  assert.equal(initials('  '), ''); assert.equal(initials(null), '');
});

console.log('\n=== header ===');
test('every tab has a title text', () => {
  assert.deepEqual(Object.keys(TAB_TITLE_KEY).sort(), ['beheer', 'deviation', 'matches', 'myweek', 'profile', 'schedule']);
});
test('Mijn week: title, week line, share button and the avatar letters of the parent', () => {
  sampleParentState(); updateHeader('myweek');
  assert.equal(dom.el('headerTitle').textContent, 'Mijn week'); assert.match(dom.el('headerContext').textContent, /^Week \d+ /);
  assert.equal(dom.el('shareToggle').hidden, false); assert.equal(dom.el('avatarInitials').textContent, 'PP');
});
test('other screens hide the share button; Wedstrijd and Beheer show the route line instead of a week', () => {
  sampleParentState(); updateHeader('schedule'); assert.equal(dom.el('shareToggle').hidden, true); assert.match(dom.el('headerContext').textContent, /^Week \d+ /);
  updateHeader('matches'); assert.equal(dom.el('headerTitle').textContent, 'Wedstrijd'); assert.doesNotMatch(dom.el('headerContext').textContent, /^Week/);
});
test('an unknown screen falls back to Mijn week', () => { sampleParentState(); updateHeader('nope'); assert.equal(dom.el('headerTitle').textContent, 'Mijn week'); });
test('a coordinator without a family gets a C; an unlinked visitor gets a ?', () => {
  sampleCoordinatorState({ coordinatorConfig: { uid: 'coord' } }); updateHeader('myweek'); assert.equal(dom.el('avatarInitials').textContent, 'C');
  resetState({ me: 'x' }); updateHeader('myweek'); assert.equal(dom.el('avatarInitials').textContent, '?');
});

console.log('\n=== Instellingen sheet ===');
const realGetById = dom.doc.getElementById;
function installSheet() {
  const els = {};
  const mk = id => (els[id] = { id, onclick: null, focus() {}, addEventListener() {}, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {} });
  const ov = { html: '', mounted: false, removed: false, addEventListener() {}, remove() { ov.removed = true; },
    set innerHTML(v) { ov.html = v; }, get innerHTML() { return ov.html; },
    querySelector: sel => els[sel.slice(1)] || mk(sel.slice(1)) };
  dom.doc.createElement = () => ov; dom.doc.body.appendChild = () => { ov.mounted = true; };
  dom.doc.getElementById = id => (id === 'sheetOverlay' ? (ov.mounted && !ov.removed ? ov : null) : realGetById(id));
  return { ov, els };
}
test('the sheet shows the name, the role, Mijn gezin, the theme buttons and Help', () => {
  sampleParentState(); const { ov } = installSheet(); openSettings(() => {});
  assert.equal(ov.mounted, true);
  assert.match(ov.html, /Piet Pieters/); assert.match(ov.html, /Mijn gezin/); assert.match(ov.html, /id="themeLight"/); assert.match(ov.html, /id="themeDark"/); assert.match(ov.html, /id="setHelp"/);
});
test('a name with HTML in it is escaped', () => {
  sampleParentState(); S.families.f2.parentName = '<img onerror=x>'; const { ov } = installSheet(); openSettings(() => {});
  assert.doesNotMatch(ov.html, /<img onerror/); assert.match(ov.html, /&lt;img onerror=x&gt;/);
});
test('Mijn gezin closes the sheet and goes to the profile screen', () => {
  sampleParentState(); const { ov, els } = installSheet(); let went = null; openSettings(t => { went = t; });
  els.setProfile.onclick(); assert.equal(went, 'profile'); assert.equal(ov.removed, true);
});
test('the theme buttons set and remember the theme', () => {
  sampleParentState(); const { els } = installSheet(); openSettings(() => {});
  els.themeDark.onclick(); assert.equal(localStorage.getItem('theme-pref'), 'dark'); assert.equal(dom.doc.documentElement.getAttribute('data-theme'), 'dark');
  els.themeLight.onclick(); assert.equal(localStorage.getItem('theme-pref'), 'light');
});
test('a visitor who is not linked yet is told so', () => {
  resetState({ me: 'x' }); const { ov } = installSheet(); openSettings(() => {});
  assert.match(ov.html, /Nog niet gekoppeld/);
});
test('initShell wires the avatar to the sheet, the share button and the contact handler', () => {
  sampleParentState(); const { ov } = installSheet(); let clicks = 0; dom.doc.addEventListener = type => { if (type === 'click') clicks++; };
  initShell(() => {}); assert.equal(clicks, 1);
  dom.el('avatarBtn').onclick(); assert.equal(ov.mounted, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
