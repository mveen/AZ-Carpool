// Run with: node ui-common.test.js
// Small shared UI helpers: escaping, icons, toast, header status line, theme, bottom sheet.
// They run against a tiny fake DOM (test-support.js), so no browser is needed.
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
import { installFakeDom, resetState, sampleParentState, sampleCoordinatorState } from './test-support.js';
import { S } from '../state.js';
import {
  foldHtml, phIcon, dirLabelHtml, openSheet, closeSheet, hapticTap, esc, lastUpdateFooter, applyTheme, currentTheme, setTheme, isStandaloneDisplay,
  isIOSDevice, installCardHtml, setStatus, showToast, twoStepConfirm, showConnectionError, updateStatusLine, applyStaticTexts,
} from '../ui-common.js';

const dom = installFakeDom();

console.log('=== esc ===');
test('escapes the five HTML characters', () => { assert.equal(esc('<a href="x">Tom & \'Jerry\'</a>'), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;'); });
test('null and undefined become an empty string, numbers are kept', () => { assert.equal(esc(null), ''); assert.equal(esc(undefined), ''); assert.equal(esc(0), '0'); });

console.log('\n=== icons and labels ===');
test('phIcon returns an inline svg that follows the text colour', () => {
  const svg = phIcon('check');
  assert.match(svg, /^<svg viewBox="0 0 256 256"/); assert.match(svg, /width:1em;height:1em/); assert.match(svg, /currentColor/);
});
test('phIcon honours size and extra style, and returns nothing for an unknown icon', () => {
  assert.match(phIcon('check', { size: '20px', style: 'color:red' }), /width:20px;height:20px;[^"]*;color:red/);
  assert.equal(phIcon('does-not-exist'), '');
});
test('dirLabelHtml uses the one wording of each direction', () => {
  assert.equal(dirLabelHtml('heen'), '<span class="dirLabel">Heen · Aalsmeer → Alkmaar</span>');
  assert.match(dirLabelHtml('terug', '<b>x</b>'), /Terug · Alkmaar → Aalsmeer<\/span><b>x<\/b>$/);
});
test('lastUpdateFooter: empty without data, otherwise who and when (name escaped)', () => {
  assert.equal(lastUpdateFooter(null), ''); assert.equal(lastUpdateFooter({}), '');
  const html = lastUpdateFooter({ by: 'Jan <b>', at: new Date('2026-09-30T10:05:00+02:00').getTime() });
  assert.match(html, /Laatst bijgewerkt door: Jan &lt;b&gt; — 30-09-2026,? 10:05/);
});

console.log('\n=== toast, status line, confirm ===');
test('showToast shows escaped text, optionally with an icon', () => {
  showToast('Mislukt: <script>');
  assert.equal(dom.html('toast'), 'Mislukt: &lt;script&gt;'); assert.equal(dom.el('toast').style.display, 'flex');
  showToast('Let op', { icon: 'warning' }); assert.match(dom.html('toast'), /^<svg.*<\/svg> Let op$/);
});
test('setStatus writes the header line, with a warning icon when asked', () => {
  setStatus('Niet verbonden.', true); assert.match(dom.html('whoami'), /^<svg.*<\/svg> Niet verbonden\.$/);
  setStatus('Jan'); assert.equal(dom.html('whoami'), 'Jan');
});
test('only a warning is shown in the visible line under the header; a plain name is not', () => {
  setStatus('Niet verbonden.', true); assert.equal(dom.el('statusLine').hidden, false); assert.match(dom.html('statusLine'), /Niet verbonden\./);
  setStatus('Jan'); assert.equal(dom.el('statusLine').hidden, true); assert.equal(dom.html('statusLine'), '');
});
test('updateStatusLine: parent name; coordinator suffix; unlinked; nobody', () => {
  sampleParentState(); updateStatusLine(); assert.equal(dom.html('whoami'), 'Piet Pieters');
  sampleCoordinatorState({ links: { coord: { familyId: 'f1' } } }); updateStatusLine(); assert.equal(dom.html('whoami'), 'Jan Jansen (Coördinator)');
  sampleCoordinatorState(); updateStatusLine(); assert.equal(dom.html('whoami'), 'Coördinator');
  resetState({ me: 'x' }); updateStatusLine(); assert.equal(dom.html('whoami'), 'Nog niet gekoppeld — vul je telefoonnummer en code in');
  resetState({ me: null }); updateStatusLine(); assert.equal(dom.html('whoami'), '');
});
test('twoStepConfirm: first tap asks, second tap acts and restores the label (also an icon-only button)', () => {
  const btn = dom.doc.createElement('button'); btn.innerHTML = phIcon('trash'); let done = 0;
  twoStepConfirm(btn, 'Zeker?', () => { done++; });
  assert.equal(btn.textContent, 'Zeker?'); assert.equal(done, 0);
  twoStepConfirm(btn, 'Zeker?', () => { done++; });
  assert.equal(btn.innerHTML, phIcon('trash')); assert.equal(done, 1);
});

console.log('\n=== theme ===');
test('applyTheme sets data-theme and marks the matching button of the Instellingen sheet', () => {
  applyTheme('dark');
  assert.equal(dom.doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(dom.el('themeDark').getAttribute('aria-pressed'), 'true'); assert.equal(dom.el('themeLight').getAttribute('aria-pressed'), 'false');
  assert.equal(dom.el('themeDark').classList.contains('active'), true); assert.equal(dom.el('themeLight').classList.contains('active'), false);
  applyTheme('anything');
  assert.equal(dom.doc.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(dom.el('themeLight').getAttribute('aria-pressed'), 'true'); assert.equal(dom.el('themeDark').getAttribute('aria-pressed'), 'false');
});
test('setTheme applies the choice and remembers it; currentTheme reads it back (light when nothing is stored)', () => {
  localStorage.removeItem('theme-pref'); assert.equal(currentTheme(), 'light');
  setTheme('dark'); assert.equal(localStorage.getItem('theme-pref'), 'dark'); assert.equal(currentTheme(), 'dark'); assert.equal(dom.doc.documentElement.getAttribute('data-theme'), 'dark');
  setTheme('light'); assert.equal(localStorage.getItem('theme-pref'), 'light'); assert.equal(currentTheme(), 'light');
  setTheme('rubbish'); assert.equal(currentTheme(), 'light');
});

console.log('\n=== install card ===');
test('no card when already installed', () => { resetState({ appIsInstalled: true }); assert.equal(installCardHtml(), ''); });
test('a browser that offers an install prompt gets the button', () => {
  resetState({ deferredInstallPrompt: {} }); assert.match(installCardHtml(), /id="installAppBtn"/);
});
test('iPhone gets the "Zet op beginscherm" instructions instead', () => {
  const ua = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' }, configurable: true });
  try { resetState({}); assert.equal(isIOSDevice(), true); assert.match(installCardHtml(), /Zet op beginscherm/); }
  finally { Object.defineProperty(globalThis, 'navigator', ua); }
});
test('isStandaloneDisplay is false in a normal browser tab', () => { assert.equal(isStandaloneDisplay(), false); });

console.log('\n=== bottom sheet ===');
test('openSheet builds a dialog with one button per item, and closeSheet removes it', () => {
  let removed = false;
  dom.doc.getElementById('sheetOverlay').remove = () => { removed = true; };
  openSheet('Verplaats Eline', 'Heen · Maandag', [{ label: 'Auto 1', sub: '3 plekken', icon: 'car', onClick() {} }, { label: 'Auto 2', muted: true, onClick() {} }]);
  const html = dom.doc.body.children.at(-1).innerHTML;
  assert.match(html, /role="dialog"/); assert.match(html, /Verplaats Eline/); assert.match(html, /Heen · Maandag/);
  assert.equal((html.match(/data-sheetidx=/g) || []).length, 2); assert.match(html, /3 plekken/); assert.doesNotMatch(html, /Annuleren|sheetCancel/);   // design v2: tap outside or Escape closes it
  assert.match(html, /class="sheet__handle"/); assert.match(html, /sheetItem sheetItem--muted/); assert.match(html, /<svg[^>]*>.*<\/svg><span class="sheetItem__label">Auto 1/s);
  closeSheet(); assert.equal(removed, true);
});
test('hapticTap never throws, with or without vibration support', () => { hapticTap(); });

console.log('\n=== connection error and static texts ===');
test('showConnectionError replaces the app by an explanation with the error message', () => {
  showConnectionError(new Error('offline'));
  assert.equal(dom.el('tab-gate').style.display, 'block'); assert.match(dom.html('tab-gate'), /Geen verbinding/); assert.match(dom.html('tab-gate'), /offline/);
  assert.equal(dom.el('tab-myweek').style.display, 'none');
});
test('applyStaticTexts fills data-i18n elements and aria-labels from the dictionary', () => {
  const a = dom.doc.createElement('span'); a.setAttribute('data-i18n', 'nav.myweek');
  const b = dom.doc.createElement('nav'); b.setAttribute('data-i18n-aria-label', 'nav.main');
  const orig = dom.doc.querySelectorAll;
  dom.doc.querySelectorAll = sel => (sel === '[data-i18n]' ? [a] : sel === '[data-i18n-aria-label]' ? [b] : []);
  try { applyStaticTexts(); } finally { dom.doc.querySelectorAll = orig; }
  assert.equal(a.textContent, 'Mijn week'); assert.equal(b.getAttribute('aria-label'), 'Hoofdnavigatie');
});

console.log('\n=== shift location (US-15) ===');
import { shiftLocationHtml, locationsCfg, foldCards } from '../ui-common.js';
const flat = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
test('a ride shows "time place → destination" and a no map button', () => {
  resetState({ locationsDoc: { places: [{ id: 'busstation', address: 'Stationsweg 1, Aalsmeer' }] } });
  const html = shiftLocationHtml({ departureTime: '07:05' }, 'heen');
  assert.match(flat(html), /07:05 Busstation → AFC '34/);
  assert.doesNotMatch(html, /<a |geo:|google|Kaart/i);
});
test('a terug ride goes from the destination to the drop-off place; a one-off change is marked', () => {
  resetState({ locationsDoc: { defaults: { heen: 'busstation', terug: 'de-parel' } } });
  const html = shiftLocationHtml({ departureTime: '17:30', locationId: 'a4-de-hoek' }, 'terug');
  assert.match(flat(html), /17:30 AFC '34 → A4-De Hoek/); assert.match(html, /eenmalig gewijzigd/);
  assert.doesNotMatch(shiftLocationHtml({ departureTime: '17:30' }, 'terug'), /eenmalig gewijzigd/);
});
test('in the standaardrooster the place is a button for ONE car (group id); a car\'s own standard place is not marked as changed', () => {
  resetState({});
  const html = shiftLocationHtml({ departureTime: '09:00', stdLocationId: 'de-parel', stdDestination: 'ATC' }, 'heen', { day: 'Ma', edit: true, gid: 'Ma_heen_2' });
  assert.match(html, /data-shiftloc="Ma_heen_2"/); assert.match(flat(html), /09:00 De Parel → ATC/); assert.doesNotMatch(html, /eenmalig gewijzigd/);
});
test('without an address the shift still shows the place name and no link', () => {
  resetState({}); assert.doesNotMatch(shiftLocationHtml({}, 'heen'), /<a /); assert.match(flat(shiftLocationHtml({}, 'heen')), /Busstation/);
});
test('locationsCfg fills in the defaults when nothing is stored', () => {
  resetState({}); assert.equal(locationsCfg().places.length, 3);
});

console.log('\n=== collapsible sections ===');
test('a section is collapsed by default and open once its key is in S.folds', () => {
  resetState({});
  assert.doesNotMatch(foldHtml('k1', 'Titel', '<p>x</p>', 'card'), / open/);
  S.folds['k1'] = true;
  const html = foldHtml('k1', 'Titel', '<p>x</p>', 'card', 'myId');
  assert.match(html, /<details class="fold card" id="myId" data-fold="k1" open>/); assert.match(html, /<summary>Titel<\/summary>/);
  S.folds = {};
});

test('foldCards finds cards inside a .begSec section and shows the card icon in the summary', () => {
  const mk = (tag, o = {}) => ({ tag, kids: [], dataset: {}, classList: { contains: c => (o.cls || []).includes(c) }, append(...c) { this.kids.push(...c); }, appendChild(c) { this.kids.push(c); return c; }, ...o });
  const h2 = { innerHTML: 'Titel', textContent: 'Titel', remove() {} };
  const card = mk('div', { cls: ['card'], id: 'c9', dataset: { icon: 'users' }, querySelector: () => h2, firstChild: null, replaceWith(n) { this.replacedBy = n; } });
  const section = mk('section', { cls: ['begSec'], children: [card] });
  const realCreate = document.createElement; document.createElement = tag => mk(tag);
  S.folds = {};
  foldCards({ children: [section] });
  document.createElement = realCreate;
  const sum = card.replacedBy.kids[0];
  assert.match(sum.innerHTML, /^<span class="foldTitle"><span class="foldIcon"><svg/); assert.match(sum.innerHTML, /<\/span>Titel<\/span>$/);
});

test('twoStepConfirm: the second-tap state is red (class confirming) and is cleared again', () => {
  const classes = new Set(); const btn = { dataset: {}, innerHTML: 'Verwijder', textContent: '', classList: { add: c => classes.add(c), remove: c => classes.delete(c) } };
  let done = 0; twoStepConfirm(btn, 'Zeker? Tik nogmaals', () => { done++; });
  assert.equal(classes.has('confirming'), true); assert.equal(btn.textContent, 'Zeker? Tik nogmaals'); assert.equal(done, 0);
  twoStepConfirm(btn, 'Zeker? Tik nogmaals', () => { done++; });
  assert.equal(classes.has('confirming'), false); assert.equal(done, 1);
});
test('a toast stays 3.8 seconds (design v2), also with an action', () => {
  const real = globalThis.setTimeout; const seen = [];
  globalThis.setTimeout = (fn, ms) => { seen.push(ms); return 0; };
  try { showToast('Opgeslagen'); showToast('Weg', { action: { label: 'Ongedaan', run() {} } }); } finally { globalThis.setTimeout = real; }
  assert.deepEqual(seen, [3800, 3800]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
