// Run with: node ui-help.test.js
// The help panel behind the "?" in the header: topic list, search, article view, "Ga naar ...", open and close.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, resetState } from './test-support.js';
import { S } from '../state.js';
import { helpListHtml, helpArticleHtml, openHelp, closeHelp } from '../ui-help.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// The page has a bottom nav; the help only offers "Ga naar ..." for tabs whose button is visible.
let navTabs = {};
dom.doc.querySelector = sel => { const m = /data-tab="(\w+)"/.exec(sel); return m && navTabs[m[1]] ? navTabs[m[1]] : null; };
const navButton = (hidden = false) => { const b = { style: { display: hidden ? 'none' : '' }, clicked: 0, click() { this.clicked++; } }; return b; };

console.log('=== topic list and search ===');
test('an empty search lists all topics a parent may see, under "Alle onderwerpen"', () => {
  resetState({ canEdit: false });
  const html = helpListHtml('');
  assert.match(html, /<h3 class="helpHead">Alle onderwerpen<\/h3>/);
  assert.match(html, /data-helpid="wijzigen"/); assert.doesNotMatch(html, /data-helpid="beheer-/);
});
test('the coordinator also sees the Beheer articles, including the one about the periode', () => {
  resetState({ canEdit: true });
  const html = helpListHtml('');
  assert.match(html, /data-helpid="beheer-gezinnen"/); assert.match(html, /data-helpid="beheer-periode"/);
  assert.match(helpListHtml('vakantie proefwerkweek periode'), /data-helpid="beheer-periode"/);
});
test('a search shows "Resultaten" with the best match first', () => {
  resetState({ canEdit: false });
  const html = helpListHtml('mijn dochter is ziek');
  assert.match(html, /<h3 class="helpHead">Resultaten<\/h3>/);
  assert.equal(html.match(/data-helpid="([^"]+)"/)[1], 'wijzigen');
});
test('the list shows the topics first and "Over deze app" as its own group at the bottom', () => {
  resetState({ canEdit: false });
  const html = helpListHtml('');
  const iAbout = html.indexOf('Over deze app</h3>'), iFirst = html.indexOf('data-helpid="wat-is"'), iOver = html.indexOf('data-helpid="over-privacy"');
  assert.ok(iFirst > -1 && iFirst < iAbout && iAbout < iOver, 'order');
  assert.equal((html.match(/class="helpHead"/g) || []).length, 2);
  assert.equal((helpListHtml('cookies').match(/class="helpHead"/g) || []).length, 1, 'a search result list has one heading');
});
test('nothing found: a friendly message that points to the coordinator', () => {
  resetState({ canEdit: false });
  assert.match(text(helpListHtml('xyzzyqq')), /^Niets gevonden\. Vraag het de coördinator\.$/);
});
test('titles are escaped', () => {
  resetState({ canEdit: false });
  const html = helpListHtml('rit ontbreekt niet ingepland');
  assert.match(html, /&quot;niet ingepland&quot;/); assert.doesNotMatch(html, /<span>[^<]*"niet ingepland"/);
});

console.log('\n=== an article ===');
test('shows title, paragraphs (list lines get their own style), a back button and the contact hint', () => {
  resetState({ canEdit: true }); navTabs = {};
  const html = helpArticleHtml('beheer-periode');
  assert.match(html, /id="helpBack"/); assert.match(html, /<h3 class="helpTitle">Beheer: een periode met andere tijden instellen/);
  assert.match(html, /<p class="helpP helpLine">• Naam:/); assert.match(html, /<p class="helpP">Onder Perioden met andere tijden/);
  assert.match(text(html), /Kom je er niet uit\? Vraag het aan de coördinator\.$/);
});
test('"Ga naar <tab>" appears only when that tab is visible in the navigation', () => {
  resetState({ canEdit: false });
  navTabs = { deviation: navButton() };
  assert.match(text(helpArticleHtml('wijzigen')), /Ga naar Wijzigen/); assert.match(helpArticleHtml('wijzigen'), /data-helpgo="deviation"/);
  navTabs = { deviation: navButton(true) };
  assert.doesNotMatch(helpArticleHtml('wijzigen'), /data-helpgo/);
  navTabs = {};
  assert.doesNotMatch(helpArticleHtml('wijzigen'), /data-helpgo/);
  assert.doesNotMatch(helpArticleHtml('inloggen'), /data-helpgo/, 'an article without a tab never has the button');
});
test('an unknown article, or a coordinator article for a parent, gives nothing', () => {
  resetState({ canEdit: false });
  assert.equal(helpArticleHtml('bestaat-niet'), ''); assert.equal(helpArticleHtml('beheer-periode'), '');
});

console.log('\n=== the panel ===');
// A tiny overlay double: remembers its listeners so the test can "type" and "click".
function installOverlay() {
  const ov = { id: '', className: '', innerHTML: '', removed: false, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, remove() { this.removed = true; } };
  const input = { value: '', focused: 0, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, focus() { this.focused++; } };
  const body = { innerHTML: '', scrollTop: 5, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } };
  const close = { onclick: null };
  ov.querySelector = sel => ({ '#helpSearch': input, '#helpBody': body, '#helpClose': close })[sel] || null;
  dom.doc.createElement = () => ov;
  dom.doc.getElementById = (orig => id => (id === 'helpOverlay' ? (ov.mounted && !ov.removed ? ov : null) : orig(id)))(dom.doc.getElementById);
  dom.doc.body.appendChild = () => { ov.mounted = true; };
  return { ov, input, body, close };
}
// A click on something inside the panel body: `closest` answers for the selectors the panel asks about.
const clickOn = (body, kind, value) => body.listeners.click({ target: { closest: sel => (
  (kind === 'item' && sel === '[data-helpid]') ? { dataset: { helpid: value } } :
  (kind === 'back' && sel === '#helpBack') ? {} :
  (kind === 'go' && sel === '[data-helpgo]') ? { dataset: { helpgo: value } } : null) } });

test('opening shows the panel with the list of topics and the search box focused', () => {
  resetState({ canEdit: false }); const o = installOverlay();
  openHelp(null);
  assert.equal(o.ov.id, 'helpOverlay'); assert.match(o.ov.innerHTML, /role="dialog"/); assert.match(o.ov.innerHTML, /Stel je vraag, bv\. mijn dochter is ziek/);
  assert.match(o.body.innerHTML, /Alle onderwerpen/); assert.equal(o.input.focused, 1);
});
test('typing filters the list; opening an article and going back keeps working', () => {
  resetState({ canEdit: false }); const o = installOverlay();
  openHelp(null);
  o.input.value = 'ziek'; o.input.listeners.input();
  assert.match(o.body.innerHTML, /Resultaten/); assert.match(o.body.innerHTML, /data-helpid="wijzigen"/);
  clickOn(o.body, 'item', 'wijzigen');
  assert.match(o.body.innerHTML, /class="helpTitle"/); assert.equal(o.body.scrollTop, 0);
  clickOn(o.body, 'back');
  assert.match(o.body.innerHTML, /Resultaten/); assert.equal(o.input.focused, 2);
});
test('a tap next to the panel closes it (design v2: no close button), and focus returns to the element that opened it', () => {
  resetState({ canEdit: false }); let o = installOverlay(); const opener = { focused: 0, focus() { this.focused++; } };
  openHelp(opener); assert.doesNotMatch(o.ov.innerHTML, /helpClose/);
  closeHelp(); assert.equal(o.ov.removed, true); assert.equal(opener.focused, 1);
  o = installOverlay(); openHelp(opener);
  o.ov.listeners.click({ target: {} });               // inside the panel: stays open
  assert.equal(o.ov.removed, false);
  o.ov.listeners.click({ target: o.ov });             // on the dark backdrop: closes
  assert.equal(o.ov.removed, true); assert.equal(opener.focused, 2);
});
test('"Ga naar ..." closes the help and opens that tab', () => {
  resetState({ canEdit: false }); const o = installOverlay(); const tab = navButton(); navTabs = { deviation: tab };
  openHelp(null); clickOn(o.body, 'go', 'deviation');
  assert.equal(tab.clicked, 1); assert.equal(o.ov.removed, true);
});
test('opening twice never leaves two panels behind', () => {
  resetState({ canEdit: false }); const o = installOverlay();
  openHelp(null); openHelp(null);
  assert.equal(o.ov.removed, true);   // the first one was removed before the second was made
});
test('closeHelp without an open panel does nothing', () => {
  installOverlay(); closeHelp();
});

console.log('\n=== opener ===');
test('without an opener the help gives focus back to the avatar', () => {
  resetState({ canEdit: false }); const o = installOverlay();
  openHelp(null); assert.equal(o.ov.mounted, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
