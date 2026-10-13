// Run with: node ui-agenda.test.js
// Instellingen > Agenda: the link to the calendar of the family's daughter. The secret is made once per family and never replaced,
// the sheet is only for the family's own link, and it offers "Zet in mijn agenda" and "Kopieer link" but no "new link".
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
import { installFakeDom, sampleCoordinatorState, sampleParentState, useFakeDb, sampleDbSeed, withFakeNow, NOW } from './test-support.js';
import { S } from '../state.js';
import { TOKEN_RE } from '../calendar-feed.js';
import { googleSubscribeUrl, hasAgenda, openAgendaSheet, agendaCardInnerHtml, calendarUrl, loadCalendarLink, webcalUrl, wireAgendaCard } from '../ui-agenda.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const SECRET = 'k8x2Q-_aB9zLm4TnW0pRs7VcYd3FgHjE';   // 32 characters
const tokenDocs = fake => [...fake.store.keys()].filter(k => k.startsWith('calendarTokens/'));
const mount = () => { dom.el('agendaCard').innerHTML = agendaCardInnerHtml('f2'); wireAgendaCard(); return dom.html('agendaCard'); };

console.log('=== the link ===');
test('the https link and the webcal link of a secret', () => {
  assert.equal(calendarUrl(SECRET), `https://azcarpool.nl/agenda/${SECRET}.ics`);
  assert.equal(webcalUrl(SECRET), `webcal://azcarpool.nl/agenda/${SECRET}.ics`);
});

console.log('=== making and reading the secret ===');
await testAsync('the first time a secret is made and stored for the family; the card then shows the link', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState();
  await loadCalendarLink();
  const docs = tokenDocs(fake);
  assert.deepEqual(docs, ['calendarTokens/f2']);
  const d = fake.store.get('calendarTokens/f2');
  assert.match(d.token, TOKEN_RE); assert.equal(typeof d.createdAt, 'number'); assert.deepEqual(Object.keys(d).sort(), ['createdAt', 'token']);
  assert.deepEqual(S.calendarLink, { familyId: 'f2', token: d.token, status: 'ready' });
  const html = agendaCardInnerHtml('f2');
  assert.ok(html.includes(`href="webcal://azcarpool.nl/agenda/${d.token}.ics"`));
});
await testAsync('the second time (or on another phone of the family) the same secret is read, nothing is written', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'calendarTokens/f2': { token: SECRET, createdAt: 1 } }); sampleParentState();
  await loadCalendarLink();
  assert.equal(S.calendarLink.token, SECRET); assert.deepEqual(fake.writes, []);
  const w = fake.writes.length; await loadCalendarLink();
  assert.equal(fake.writes.length, w, 'asked only once per session');
});
await testAsync('another family\'s secret is never read', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'calendarTokens/f1': { token: SECRET, createdAt: 1 } }); sampleParentState();
  await loadCalendarLink();
  assert.notEqual(S.calendarLink.token, SECRET); assert.equal(S.calendarLink.familyId, 'f2');
  assert.equal(fake.store.get('calendarTokens/f1').token, SECRET, 'the other family keeps its own');
});
await testAsync('a secret that is not valid is not shown as a link', async () => {
  useFakeDb({ ...sampleDbSeed(), 'calendarTokens/f2': { token: '../../x', createdAt: 1 } }); sampleParentState();
  await loadCalendarLink();
  assert.notEqual(S.calendarLink.token, '../../x');
  assert.doesNotMatch(agendaCardInnerHtml('f2'), /\.\.\/\.\./);
});
await testAsync('when the database refuses, the card says so and does not show a link; a later visit tries again', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState();
  fake.failWrites('calendarTokens', 'permission-denied');
  await loadCalendarLink();
  assert.equal(S.calendarLink.status, 'error');
  assert.match(text(agendaCardInnerHtml('f2')), /kon niet geladen worden/); assert.doesNotMatch(agendaCardInnerHtml('f2'), /webcal:/);
  await loadCalendarLink();
  assert.equal(S.calendarLink.status, 'ready');
});
test('while loading, the card says so and shows no link', () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: '', status: 'loading' } });
  const s = text(agendaCardInnerHtml('f2'));
  assert.match(s, /klaargezet/); assert.doesNotMatch(agendaCardInnerHtml('f2'), /webcal:|agendaCopy/);
});

console.log('=== the card ===');
test('what the card says: the daughter, 3 weeks, read only, one time, how to add it, how fast, who may have the link', () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, status: 'ready' } });
  const html = agendaCardInnerHtml('f2'), s = text(html);
  assert.match(s, /ritten van Jahaimy voor de komende 3 weken/); assert.match(s, /alleen lezen/); assert.match(s, /één keer in/);
  assert.match(s, /Zet in mijn agenda/); assert.match(s, /Kopieer link/); assert.match(s, /Google Agenda/); assert.match(s, /tot een dag/); assert.match(s, /alleen met wie de ritten mag zien/);
});
test('no way to make a new link', () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, status: 'ready' } });
  const html = agendaCardInnerHtml('f2');
  assert.doesNotMatch(html, /nieuwe link maken|agendaNew|agendaReset|Opnieuw/i);
  assert.deepEqual([...html.matchAll(/<(?:button|a)\b[^>]*id="([^"]+)"/g)].map(m => m[1]), ['agendaAdd', 'agendaCopy']);
});
test('the Agenda sheet opens for a linked parent, with its own title and the card inside', () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, status: 'ready' } });
  assert.equal(hasAgenda(), true);
  let mounted = null; const created = { innerHTML: '', addEventListener() {} };
  const had = dom.doc.createElement, hadAppend = dom.doc.body.appendChild;
  dom.doc.createElement = () => created; dom.doc.body.appendChild = el => { mounted = el; };
  try { openAgendaSheet(); } finally { dom.doc.createElement = had; dom.doc.body.appendChild = hadAppend; }
  assert.equal(mounted, created);
  assert.match(text(created.innerHTML), /^Agenda Zie de ritten van Jahaimy/); assert.match(created.innerHTML, /id="agendaCard"/); assert.match(created.innerHTML, /id="agendaAdd"/);
});
test('no Agenda for the coordinator\'s test view as another parent, and not for a coordinator without a family', () => {
  useFakeDb(sampleDbSeed()); sampleCoordinatorState({ impersonateFamilyId: 'f3' });
  assert.equal(hasAgenda(), false);
  sampleCoordinatorState(); S.links = {};
  assert.equal(hasAgenda(), false);
});
await testAsync('in the test view as another parent nothing is read or made', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ impersonateFamilyId: 'f3' });
  await loadCalendarLink();
  assert.deepEqual(tokenDocs(fake), []); assert.deepEqual(fake.writes, []); assert.equal(S.calendarLink, null);
});

console.log('=== Android ===');
const withUA = (ua, fn) => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua }, configurable: true, writable: true });
  try { fn(); } finally { if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator; }
};
test('on Android the button opens Google Agenda\'s add-by-link page with the webcal link, not a webcal:// link that does nothing', () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, status: 'ready' } });
  withUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) Firefox/130.0', () => {
    const html = agendaCardInnerHtml('f2');
    assert.ok(html.includes(`href="${googleSubscribeUrl(SECRET)}"`)); assert.doesNotMatch(html, /href="webcal:/);
    assert.match(html, /target="_blank" rel="noopener"/); assert.match(text(html), /Zet in Google Agenda/); assert.match(text(html), /ICSx⁵/);
    assert.deepEqual([...html.matchAll(/<(?:button|a)\b[^>]*id="([^"]+)"/g)].map(m => m[1]), ['agendaAdd', 'agendaCopy']);
  });
  assert.equal(googleSubscribeUrl(SECRET), `https://calendar.google.com/calendar/r?cid=${encodeURIComponent('webcal://azcarpool.nl/agenda/' + SECRET + '.ics')}`);
});
test('on an iPhone and without a known device the button stays the webcal link', () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, status: 'ready' } });
  withUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', () => { assert.match(agendaCardInnerHtml('f2'), /href="webcal:\/\/azcarpool\.nl/); });
  assert.match(agendaCardInnerHtml('f2'), /href="webcal:\/\/azcarpool\.nl/);
});

console.log('=== copying ===');
const withClipboard = async (clip, fn) => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: clip, userAgent: '' }, configurable: true, writable: true });
  try { await fn(); } finally { if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator; }
};
await testAsync('"Kopieer link" puts the https link on the clipboard and confirms', async () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, status: 'ready' } });
  let copied = null;
  await withClipboard({ writeText: async x => { copied = x; } }, async () => { mount(); dom.el('agendaCopy').click(); await new Promise(r => setImmediate(r)); });
  assert.equal(copied, `https://azcarpool.nl/agenda/${SECRET}.ics`);
  assert.match(dom.el('toast').innerHTML, /Link gekopieerd/);
});
await testAsync('when the device does not allow copying, the user is told instead of nothing happening', async () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, status: 'ready' } });
  await withClipboard(undefined, async () => { mount(); dom.el('agendaCopy').click(); await new Promise(r => setImmediate(r)); });
  assert.match(dom.el('toast').innerHTML, /Kopiëren lukt niet/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
