// Run with: node ui-contact.test.js
// "Tap a name, contact that person": the name button, the contact sheet (WhatsApp / Bellen) and the one click handler.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, resetState, sampleParentState } from './test-support.js';
import { S } from '../state.js';
import { waPhone, phoneText, contactButtonHtml, openContactSheet, initContact } from '../ui-contact.js';

const dom = installFakeDom();
const realGetById = dom.doc.getElementById;
function installSheet() {
  const ov = { html: '', mounted: false, removed: false, className: '', addEventListener() {}, remove() { ov.removed = true; },
    set innerHTML(v) { ov.html = v; }, get innerHTML() { return ov.html; }, querySelector: () => ({ focus() {} }) };
  dom.doc.createElement = () => ov; dom.doc.body.appendChild = () => { ov.mounted = true; };
  dom.doc.getElementById = id => (id === 'sheetOverlay' ? (ov.mounted && !ov.removed ? ov : null) : realGetById(id));
  return ov;
}

console.log('=== phone numbers ===');
test('waPhone turns a Dutch number into a wa.me number (31...), and leaves other international numbers alone', () => {
  assert.equal(waPhone('06 12 34 56 78'), '31612345678'); assert.equal(waPhone('+31 6 12345678'), '31612345678'); assert.equal(waPhone('0044 7911 123456'), '447911123456'); assert.equal(waPhone(''), '');
});
test('phoneText groups a Dutch mobile number and shows anything else as typed', () => {
  assert.equal(phoneText('0621436587'), '06 21 43 65 87'); assert.equal(phoneText('+31 6 21436587'), '06 21 43 65 87'); assert.equal(phoneText(' 020 1234567 '), '020 1234567'); assert.equal(phoneText(''), '');
});

console.log('\n=== the name button ===');
test('contactButtonHtml: a button with the family id; the optional WhatsApp text is escaped', () => {
  assert.equal(contactButtonHtml('f2', 'Piet'), '<button type="button" class="nameLink" data-contact="f2">Piet</button>');
  assert.match(contactButtonHtml('f2', 'Piet', 'Hi "Piet" <b>'), /data-contact-text="Hi &quot;Piet&quot; &lt;b&gt;"/);
  assert.match(contactButtonHtml('f2', 'Piet', '', 'carCard__driver'), /class="carCard__driver"/);
});

console.log('\n=== the sheet ===');
test('shows the name, "Ouder van <dochter>" and the number, with WhatsApp and Bellen buttons', () => {
  sampleParentState(); const ov = installSheet(); openContactSheet('f2');
  assert.equal(ov.mounted, true); assert.match(ov.html, /<h3 id="sheetTitle">Piet Pieters<\/h3>/); assert.match(ov.html, /Ouder van Jahaimy · 06 22 22 22 22/);
  assert.match(ov.html, /href="https:\/\/wa\.me\/31622222222"/); assert.match(ov.html, /href="tel:0622222222"/);
  assert.match(ov.html, /WhatsApp<\/a>/); assert.match(ov.html, /Bellen<\/a>/);
});
test('an asking text becomes the WhatsApp message', () => {
  sampleParentState(); const ov = installSheet(); openContactSheet('f2', 'Hi! Rijd je?');
  assert.match(ov.html, /href="https:\/\/wa\.me\/31622222222\?text=Hi!%20Rijd%20je%3F"/);
});
test('without a phone number there are no buttons, only a note', () => {
  sampleParentState(); S.families.f2.parentPhone1 = ''; const ov = installSheet(); openContactSheet('f2');
  assert.doesNotMatch(ov.html, /wa\.me|tel:/); assert.match(ov.html, /geen telefoonnummer bekend/);
});
test('a name with HTML in it is escaped', () => {
  sampleParentState(); S.families.f2.parentName = '<img onerror=x>'; const ov = installSheet(); openContactSheet('f2');
  assert.doesNotMatch(ov.html, /<img onerror/); assert.match(ov.html, /&lt;img onerror=x&gt;/);
});

console.log('\n=== the one click handler ===');
test('initContact opens the sheet for a [data-contact] button and ignores other clicks and unknown families', () => {
  sampleParentState(); const ov = installSheet(); let handler = null;
  dom.doc.addEventListener = (type, fn) => { if (type === 'click') handler = fn; };
  initContact();
  const button = { dataset: { contact: 'f2', contactText: 'Hi!' } };
  handler({ target: { closest: sel => (sel === '[data-contact]' ? button : null) } });
  assert.equal(ov.mounted, true); assert.match(ov.html, /Piet Pieters/);
  ov.mounted = false; handler({ target: { closest: () => null } }); assert.equal(ov.mounted, false);
  handler({ target: { closest: () => ({ dataset: { contact: 'nope' } }) } }); assert.equal(ov.mounted, false);
});

test('design v2: the contact sheet starts with an avatar circle (initials) next to the name', () => {
  sampleParentState(); const ov = installSheet(); openContactSheet('f2');
  assert.match(ov.html, /<span class="settingsAvatar contactAvatar">PP<\/span>/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
