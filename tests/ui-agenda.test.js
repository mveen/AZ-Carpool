// Run with: node ui-agenda.test.js
// Instellingen > Agenda: two links per family, one for the parents (the rides the family drives) and one for the daughter (the rides she sits in).
// Each secret is made once per family and never replaced, the sheet is only for the family's own links, and it offers "Zet in mijn agenda",
// "Deel met ..." and "Kopieer link" but no "new link".
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
import { googleSubscribeUrl, isIos, hasAgenda, openAgendaSheet, agendaCardInnerHtml, calendarUrl, loadCalendarLink, webcalUrl, wireAgendaCard } from '../ui-agenda.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const SECRET = 'k8x2Q-_aB9zLm4TnW0pRs7VcYd3FgHjE';   // 32 characters: the daughter's calendar
const SECRET2 = 'q7Zr-_Xw1Nn5MmB2vC8dKs3Hj6LpTg0y';  // 32 characters: the parents' calendar
const tokenDocs = fake => [...fake.store.keys()].filter(k => k.startsWith('calendarTokens/') || k.startsWith('driverCalendarTokens/')).sort();
const bothTokens = (extra = {}) => ({ ...sampleDbSeed(), 'calendarTokens/f2': { token: SECRET, createdAt: 1 }, 'driverCalendarTokens/f2': { token: SECRET2, createdAt: 1 }, ...extra });
const mount = () => { dom.el('agendaCard').innerHTML = agendaCardInnerHtml('f2'); wireAgendaCard(); return dom.html('agendaCard'); };

console.log('=== the link ===');
test('the secrets in these tests are valid', () => { assert.match(SECRET, TOKEN_RE); assert.match(SECRET2, TOKEN_RE); });
test('the https link and the webcal link of a secret', () => {
  assert.equal(calendarUrl(SECRET), `https://azcarpool.nl/agenda/${SECRET}.ics`);
  assert.equal(webcalUrl(SECRET), `webcal://azcarpool.nl/agenda/${SECRET}.ics`);
});

console.log('=== making and reading the secret ===');
await testAsync('the first time a secret is made and stored for the family; the card then shows the link', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleParentState();
  await loadCalendarLink();
  const docs = tokenDocs(fake);
  assert.deepEqual(docs, ['calendarTokens/f2', 'driverCalendarTokens/f2']);
  const d = fake.store.get('calendarTokens/f2'), dd = fake.store.get('driverCalendarTokens/f2');
  for (const x of [d, dd]) { assert.match(x.token, TOKEN_RE); assert.equal(typeof x.createdAt, 'number'); assert.deepEqual(Object.keys(x).sort(), ['createdAt', 'token']); }
  assert.notEqual(d.token, dd.token, 'the two calendars never share a secret');
  assert.deepEqual(S.calendarLink, { familyId: 'f2', token: d.token, driverToken: dd.token, status: 'ready' });
  const html = agendaCardInnerHtml('f2');
  assert.ok(html.includes(`href="webcal://azcarpool.nl/agenda/${dd.token}.ics"`), 'the button is the parents\' calendar');
  assert.ok(!html.includes(d.token), 'the daughter\'s secret is not shown in the card (it is only copied or shared)');
});
await testAsync('a family that had a link before keeps it: only the parents\' secret is made, the daughter\'s link stays the same', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'calendarTokens/f2': { token: SECRET, createdAt: 1 } }); sampleParentState();
  await loadCalendarLink();
  assert.equal(S.calendarLink.token, SECRET); assert.equal(fake.store.get('calendarTokens/f2').token, SECRET);
  assert.match(S.calendarLink.driverToken, TOKEN_RE); assert.equal(fake.store.get('driverCalendarTokens/f2').token, S.calendarLink.driverToken);
  assert.equal(S.calendarLink.status, 'ready');
});
await testAsync('the second time (or on another phone of the family) the same secrets are read, nothing is written', async () => {
  const fake = useFakeDb(bothTokens()); sampleParentState();
  await loadCalendarLink();
  assert.equal(S.calendarLink.token, SECRET); assert.equal(S.calendarLink.driverToken, SECRET2); assert.deepEqual(fake.writes, []);
  const w = fake.writes.length; await loadCalendarLink();
  assert.equal(fake.writes.length, w, 'asked only once per session');
});
await testAsync('another family\'s secret is never read', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'calendarTokens/f1': { token: SECRET, createdAt: 1 }, 'driverCalendarTokens/f1': { token: SECRET2, createdAt: 1 } }); sampleParentState();
  await loadCalendarLink();
  assert.notEqual(S.calendarLink.token, SECRET); assert.notEqual(S.calendarLink.driverToken, SECRET2); assert.equal(S.calendarLink.familyId, 'f2');
  assert.equal(fake.store.get('calendarTokens/f1').token, SECRET, 'the other family keeps its own');
  assert.equal(fake.store.get('driverCalendarTokens/f1').token, SECRET2);
});
await testAsync('a secret that is not valid is not shown as a link', async () => {
  useFakeDb({ ...sampleDbSeed(), 'calendarTokens/f2': { token: '../../x', createdAt: 1 }, 'driverCalendarTokens/f2': { token: '../../y', createdAt: 1 } }); sampleParentState();
  await loadCalendarLink();
  assert.notEqual(S.calendarLink.token, '../../x'); assert.notEqual(S.calendarLink.driverToken, '../../y');
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
await testAsync('when only the parents\' secret cannot be made, the card says so too (never one working link and one dead one)', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'calendarTokens/f2': { token: SECRET, createdAt: 1 } }); sampleParentState();
  fake.failWrites('driverCalendarTokens', 'permission-denied');
  await loadCalendarLink();
  assert.equal(S.calendarLink.status, 'error');
  assert.match(text(agendaCardInnerHtml('f2')), /kon niet geladen worden/); assert.doesNotMatch(agendaCardInnerHtml('f2'), /webcal:|agendaCopy/);
});
test('while loading, the card says so and shows no link', () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: '', driverToken: '', status: 'loading' } });
  const s = text(agendaCardInnerHtml('f2'));
  assert.match(s, /klaargezet/); assert.doesNotMatch(agendaCardInnerHtml('f2'), /webcal:|agendaCopy/);
});

console.log('=== the card ===');
test('what the card says: two blocks (parents, daughter), 3 weeks, read only, one time, how to add it, how fast, who may have the link', () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, driverToken: SECRET2, status: 'ready' } });
  const html = agendaCardInnerHtml('f2'), s = text(html);
  assert.match(s, /Mijn agenda/); assert.match(s, /Alleen de ritten die jullie rijden, de komende 3 weken/);
  assert.match(s, /Agenda van Jahaimy/); assert.match(s, /De ritten waar Jahaimy in zit, de komende 3 weken\. Deel deze link met haar/);
  assert.ok(s.indexOf('Mijn agenda') < s.indexOf('Agenda van Jahaimy'), 'the parents\' block comes first');
  assert.match(s, /alleen lezen/); assert.match(s, /één keer in/);
  assert.match(s, /Zet in mijn agenda/); assert.match(s, /Kopieer link/); assert.match(s, /Google Agenda/); assert.match(s, /tot een dag/); assert.match(s, /Proton/); assert.match(s, /alleen met wie de ritten mag zien/);
});
test('no way to make a new link', () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, driverToken: SECRET2, status: 'ready' } });
  const html = agendaCardInnerHtml('f2');
  assert.doesNotMatch(html, /nieuwe link maken|agendaNew|agendaReset|Opnieuw/i);
  assert.deepEqual([...html.matchAll(/<(?:button|a)\b[^>]*id="([^"]+)"/g)].map(m => m[1]), ['agendaAddDriver', 'agendaCopyDriver', 'agendaCopy']);
});
test('the daughter\'s block offers "Deel met ..." only on a phone that can share; the parents\' block never does', () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, driverToken: SECRET2, status: 'ready' } });
  assert.doesNotMatch(agendaCardInnerHtml('f2'), /agendaShare|Deel met/);
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: '', share: async () => {} }, configurable: true, writable: true });
  try {
    const html = agendaCardInnerHtml('f2');
    assert.deepEqual([...html.matchAll(/<(?:button|a)\b[^>]*id="([^"]+)"/g)].map(m => m[1]), ['agendaAddDriver', 'agendaCopyDriver', 'agendaShare', 'agendaCopy']);
    assert.match(text(html), /Deel met Jahaimy/);
  } finally { if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator; }
});
test('the Agenda sheet opens for a linked parent, with its own title and the card inside', () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, driverToken: SECRET2, status: 'ready' } });
  assert.equal(hasAgenda(), true);
  let mounted = null; const created = { innerHTML: '', addEventListener() {} };
  const had = dom.doc.createElement, hadAppend = dom.doc.body.appendChild;
  dom.doc.createElement = () => created; dom.doc.body.appendChild = el => { mounted = el; };
  try { openAgendaSheet(); } finally { dom.doc.createElement = had; dom.doc.body.appendChild = hadAppend; }
  assert.equal(mounted, created);
  assert.match(text(created.innerHTML), /^Agenda Zet de ritten in je eigen agenda/); assert.match(created.innerHTML, /id="agendaCard"/); assert.match(created.innerHTML, /id="agendaAddDriver"/);
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

console.log('=== Android, iPhone and iPad ===');
const withUA = (ua, fn) => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua }, configurable: true, writable: true });
  try { fn(); } finally { if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator; }
};
test('on Android the button opens Google Agenda\'s add-by-link page with the webcal link, not a webcal:// link that does nothing', () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, driverToken: SECRET2, status: 'ready' } });
  withUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) Firefox/130.0', () => {
    const html = agendaCardInnerHtml('f2');
    assert.ok(html.includes(`href="${googleSubscribeUrl(SECRET2)}"`)); assert.doesNotMatch(html, /href="webcal:/);
    assert.match(html, /target="_blank" rel="noopener"/); assert.match(text(html), /Zet in Google Agenda/); assert.match(text(html), /ICSx⁵/);
    assert.deepEqual([...html.matchAll(/<(?:button|a)\b[^>]*id="([^"]+)"/g)].map(m => m[1]), ['agendaAddDriver', 'agendaCopyDriver', 'agendaCopy']);
  });
  assert.equal(googleSubscribeUrl(SECRET), `https://calendar.google.com/calendar/r?cid=${encodeURIComponent('webcal://azcarpool.nl/agenda/' + SECRET + '.ics')}`);
});
test('on an iPhone and an iPad the button opens Google Agenda too (the webcal:// button made Apple Agenda warn and fail)', () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, driverToken: SECRET2, status: 'ready' } });
  withUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', () => {
    const html = agendaCardInnerHtml('f2');
    assert.equal(isIos(), true);
    assert.ok(html.includes(`href="${googleSubscribeUrl(SECRET2)}"`), 'the parents\' calendar'); assert.doesNotMatch(html, /href="webcal:/);
    assert.match(text(html), /Zet in Google Agenda/); assert.match(text(html), /Op iPhone en iPad.*Desktopversie.*Via URL/); assert.doesNotMatch(text(html), /ICSx/);
    assert.deepEqual([...html.matchAll(/<(?:button|a)\b[^>]*id="([^"]+)"/g)].map(m => m[1]), ['agendaAddDriver', 'agendaCopyDriver', 'agendaCopy']);
  });
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', maxTouchPoints: 5 }, configurable: true, writable: true });
  try { assert.equal(isIos(), true, 'an iPad that reports itself as a Mac'); } finally { if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator; }
});
test('on a Mac (no touch screen) and without a known device the button stays the webcal link', () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, driverToken: SECRET2, status: 'ready' } });
  withUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', () => { assert.equal(isIos(), false); assert.ok(agendaCardInnerHtml('f2').includes(`href="webcal://azcarpool.nl/agenda/${SECRET2}.ics"`)); });
  assert.ok(agendaCardInnerHtml('f2').includes(`href="webcal://azcarpool.nl/agenda/${SECRET2}.ics"`));
});

console.log('=== copying ===');
const withClipboard = async (clip, fn) => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: clip, userAgent: '' }, configurable: true, writable: true });
  try { await fn(); } finally { if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator; }
};
await testAsync('the parents\' "Kopieer link" puts the PARENTS\' https link on the clipboard', async () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, driverToken: SECRET2, status: 'ready' } });
  let copied = null;
  await withClipboard({ writeText: async x => { copied = x; } }, async () => { mount(); dom.el('agendaCopyDriver').click(); await new Promise(r => setImmediate(r)); });
  assert.equal(copied, `https://azcarpool.nl/agenda/${SECRET2}.ics`);
});
await testAsync('"Deel met ..." shares the daughter\'s https link with a short text, and a closed share sheet is no error', async () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, driverToken: SECRET2, status: 'ready' } });
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let shared = null, fail = false;
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: '', share: async x => { shared = x; if (fail) throw new Error('AbortError'); } }, configurable: true, writable: true });
  try {
    mount(); dom.el('agendaShare').click(); await new Promise(r => setImmediate(r));
    assert.equal(shared.url, `https://azcarpool.nl/agenda/${SECRET}.ics`); assert.match(shared.text, /carpoolritten van Jahaimy/); assert.ok(!JSON.stringify(shared).includes(SECRET2));
    fail = true; dom.el('agendaShare').click(); await new Promise(r => setImmediate(r));   // user closed the share sheet: nothing breaks
  } finally { if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator; }
});
await testAsync('the daughter\'s "Kopieer link" puts the https link on the clipboard and confirms', async () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, driverToken: SECRET2, status: 'ready' } });
  let copied = null;
  await withClipboard({ writeText: async x => { copied = x; } }, async () => { mount(); dom.el('agendaCopy').click(); await new Promise(r => setImmediate(r)); });
  assert.equal(copied, `https://azcarpool.nl/agenda/${SECRET}.ics`);
  assert.match(dom.el('toast').innerHTML, /Link gekopieerd/);
});
await testAsync('when the device does not allow copying, the user is told instead of nothing happening', async () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ calendarLink: { familyId: 'f2', token: SECRET, driverToken: SECRET2, status: 'ready' } });
  await withClipboard(undefined, async () => { mount(); dom.el('agendaCopy').click(); await new Promise(r => setImmediate(r)); });
  assert.match(dom.el('toast').innerHTML, /Kopiëren lukt niet/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
