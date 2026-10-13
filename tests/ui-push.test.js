// Run with: node ui-push.test.js
// ui-push.js: the Beheer card "Meldingen testen" and the way a tapped test push opens the app as the right family. Coordinator only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, useFakeDb, withFakeNow, withFakeNowAsync, NOW, sampleCoordinatorState, sampleParentState, sampleDbSeed, expectSnapshot, assertNoUnusedImports } from './test-support.js';
import { S } from '../state.js';
import { renderBeheer } from '../ui-beheer.js';
import { agoText, applyPendingPushOpen, enableThisDevice, pickPersona, playScenario, pushCardHtml, queuePushOpen, queuePushOpenFromUrl, refreshPushCard, togglePushTest, wirePushCard } from '../ui-push.js';
import { setPersona } from '../push-data.js';
import { deviceDoc, deviceId } from '../push.js';
import { notificationDoc, normalizeQuiet } from '../ritbeurs.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const toast = () => text(dom.doc.getElementById('toast').innerHTML);
const tick = () => new Promise(r => setImmediate(r));
const NOWMS = new Date(NOW).getTime();
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/this-phone';
const KEYS = { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) };
const card = (patch) => { if (patch) Object.assign(S.push, patch); return withFakeNow(NOW, () => pushCardHtml(NOWMS)); };
const coordinator = (push = {}, seed = {}) => { const fake = useFakeDb({ ...sampleDbSeed(), ...seed }); sampleCoordinatorState(); Object.assign(S.push, push); return fake; };
// A browser that can do push, for the parts of the card that depend on it.
function withBrowser(over, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), hadN = globalThis.Notification, hadP = globalThis.PushManager;
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile Safari/537.36', standalone: true, serviceWorker: {}, ...over.navigator }, configurable: true, writable: true });
  globalThis.Notification = over.Notification || { permission: 'default' }; globalThis.PushManager = function PushManager() {};
  try { return fn(); } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had); else delete globalThis.navigator;
    if (hadN === undefined) delete globalThis.Notification; else globalThis.Notification = hadN;
    if (hadP === undefined) delete globalThis.PushManager; else globalThis.PushManager = hadP;
  }
}
const n = (extra = {}) => ({ ...notificationDoc({ kind: 'taken', to: 'f6', offer: { weekKey: '2026-W40', day: 'Do', direction: 'heen', date: '2026-10-01', time: '16:15' }, sourceId: 's', fromFamilyId: 'f2', nowMs: NOWMS, quiet: normalizeQuiet() }), ...extra });

console.log('=== who sees the card ===');
await test('the coordinator sees it in Beheer, in the Berichten section, as a foldable card with a bell', () => {
  useFakeDb(sampleDbSeed()); sampleCoordinatorState();
  withFakeNow(NOW, () => renderBeheer());
  const html = dom.html('tab-beheer');
  assert.match(html, /<div data-icon="bell" class="card" id="pushCard"><h2>Meldingen testen<\/h2><div id="pushBody">/);
  assert.ok(html.indexOf('id="ritbeursCard"') < html.indexOf('id="pushCard"') && html.indexOf('id="pushCard"') < html.indexOf('id="noticeCard"'));
});
await test('a parent gets no card, no heading and no text about it', () => {
  useFakeDb(sampleDbSeed()); sampleParentState();
  assert.equal(pushCardHtml(), '');
  withFakeNow(NOW, () => renderBeheer());
  assert.doesNotMatch(dom.html('tab-beheer'), /pushCard|Meldingen testen/);
});
await test('also a coordinator who looks at the app as a parent sees no Beheer, so no card', () => {
  useFakeDb(sampleDbSeed()); sampleCoordinatorState({ viewAsParent: true, links: { coord: { familyId: 'f1' } }, canEdit: false });
  withFakeNow(NOW, () => renderBeheer());
  assert.doesNotMatch(dom.html('tab-beheer'), /pushCard/);
});

console.log('\n=== the switch and the server ===');
await test('off: the switch is off, the chips say Uit and the server has not been seen', () => {
  coordinator();
  const h = card();
  assert.match(h, /id="pushTestOn"><\/label>/); assert.match(text(h), /Uit Server nog niet gezien/); assert.doesNotMatch(h, /id="pushTestOn" checked/);
});
await test('test: the switch is on; an alive server shows when it was last seen and what it did', () => {
  coordinator({ status: { lastRunAt: NOWMS - 120000, sent: 3, pending: 1 } }); S.pushSettings = { mode: 'test' };
  const h = card();
  assert.match(h, /id="pushTestOn" checked>/); assert.match(text(h), /Test aan Server actief Laatste keer 2 min geleden · 3 verstuurd · 1 wachtend/);
});
await test('a server that has not reported for a long time says so', () => {
  coordinator({ status: { lastRunAt: NOWMS - 3 * 3600000, sent: 0, pending: 0 } }); S.pushSettings = { mode: 'test' };
  assert.match(text(card()), /Server meldt zich niet Laatste keer 3 uur geleden/);
});
await test('times are told in words', () => {
  assert.equal(agoText(0, NOWMS), ''); assert.equal(agoText(NOWMS - 5000, NOWMS), 'zojuist'); assert.equal(agoText(NOWMS - 59 * 60000, NOWMS), '59 min geleden'); assert.equal(agoText(NOWMS - 150 * 60000, NOWMS), '2 uur geleden');
});
await test('switching on and off goes through the database and redraws', async () => {
  const fake = coordinator(); dom.reset();
  assert.equal(await togglePushTest(true), true); assert.equal(fake.get('settings/push').mode, 'test');
  assert.equal(await togglePushTest(false), true); assert.equal(fake.get('settings/push').mode, 'uit');
});

console.log('\n=== devices and permission ===');
const id = deviceId(ENDPOINT);
await test('the devices of the coordinator are listed, this one marked, with the Ritten-ruilen switch, the last time it was reached and a remove button', () => {
  const d = deviceDoc({ endpoint: ENDPOINT, ...KEYS, label: 'Chrome op Android', uid: 'coord', nowMs: 1 }); d.lastOkAt = NOWMS - 300000;
  const d2 = deviceDoc({ endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/laptop', ...KEYS, label: 'Firefox op Mac', uid: 'coord', nowMs: 2 }); d2.categories = { ritbeurs: false };
  coordinator({ devices: { [id]: d, dlaptop: d2 }, thisDeviceId: id });
  const h = card();
  assert.match(text(h), /Chrome op Android dit toestel laatst bereikt 5 min geleden/); assert.match(text(h), /Firefox op Mac nog niets ontvangen/);
  assert.match(h, new RegExp(`data-pushcat="${id}" checked`)); assert.doesNotMatch(h, /data-pushcat="dlaptop" checked/);
  assert.equal((h.match(/data-pushdevdel=/g) || []).length, 2); assert.doesNotMatch(h, /id="pushEnable"/);
});
await test('no device yet: a button to enable, and a hint to switch the test on first while the server has not made its key', () => {
  coordinator();
  withBrowser({ Notification: { permission: 'default' } }, () => { const h = card(); assert.match(text(h), /Nog geen toestel aangemeld/); assert.match(h, /id="pushEnable"/); assert.match(text(h), /Zet eerst de test aan en wacht een minuut/); });
  S.push.key = { publicKey: 'K' };
  withBrowser({ Notification: { permission: 'default' } }, () => { const h = card(); assert.match(h, /id="pushEnable"/); assert.doesNotMatch(text(h), /wacht een minuut/); });
});
await test('blocked notifications, an iPhone without the app on the home screen and a browser without push each get their own explanation, and no button', () => {
  coordinator({ key: { publicKey: 'K' } });
  withBrowser({ Notification: { permission: 'denied' } }, () => { const h = card(); assert.match(text(h), /blokkeert meldingen/); assert.doesNotMatch(h, /id="pushEnable"/); });
  withBrowser({ navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', standalone: false } }, () => { const h = card(); assert.match(text(h), /beginscherm/); assert.doesNotMatch(h, /id="pushEnable"/); });
  withBrowser({ navigator: { serviceWorker: undefined } }, () => { delete globalThis.navigator.serviceWorker; const h = card(); assert.match(text(h), /ondersteunt geen pushmeldingen/); assert.doesNotMatch(h, /id="pushEnable"/); });
});
await test('tapping the button subscribes (through push-data) and redraws', async () => {
  const fake = coordinator({ key: { publicKey: 'BAAA' + 'A'.repeat(83) } });
  const sub = { endpoint: ENDPOINT, toJSON: () => ({ endpoint: ENDPOINT, keys: KEYS }) };
  const g = { Notification: { permission: 'granted' } };
  await withBrowser({ Notification: g.Notification, navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null, subscribe: async () => sub } }) } } }, async () => {
    const r = await enableThisDevice();
    assert.equal(r.ok, true);
  });
  assert.equal(fake.collection('pushDevices').length, 1);
});

console.log('\n=== I am… and the situations ===');
await test('the families are listed as "Ouder van <dochter>", alphabetically; the chosen one is selected; the scenario buttons wait for a choice', () => {
  coordinator();
  let h = card();
  assert.match(h, /<option value="">Kies een gezin<\/option>/); assert.ok(h.indexOf('Ouder van Anouk') < h.indexOf('Ouder van Eline') && h.indexOf('Ouder van Eline') < h.indexOf('Ouder van Saar'));
  assert.equal((h.match(/data-pushscen="[a-zA-Z]+" disabled/g) || []).length, 5); assert.match(text(h), /Kies eerst een gezin/);
  h = card({ personaId: 'f6' });
  assert.match(h, /<option value="f6" selected>Ouder van Saar<\/option>/); assert.equal((h.match(/data-pushscen="[a-zA-Z]+"( |>)/g) || []).length, 5); assert.doesNotMatch(h, /data-pushscen="\w+" disabled/);
  assert.match(text(h), /Zo ziet Ouder van Saar het/);
});
await test('the five situations and the choice between now and the middle of the night are offered; the test-off hint shows while the switch is off', () => {
  coordinator({ personaId: 'f6' });
  let h = card();
  for (const s of ['Een rit komt vrij waar ik back-up voor ben', 'Iemand neemt mijn aangeboden rit over', 'Een back-up meldt zich voor mijn rit', 'Mijn aangeboden rit is niet gedekt (18:00)', 'Ik ben dagcoördinator en een rit is overgenomen']) assert.ok(text(h).includes(s), s);
  assert.match(h, /<option value="nu" selected>nu<\/option>/); assert.match(h, /<option value="nacht">midden in de nacht \(stille uren\)<\/option>/); assert.match(text(h), /Zet de test aan om meldingen naar je toestel te sturen/);
  S.pushSettings = { mode: 'test' }; S.push.timeChoice = 'nacht'; h = card();
  assert.match(h, /<option value="nacht" selected>/); assert.doesNotMatch(text(h), /Zet de test aan/);
});
await test('choosing a family and playing a situation fills the preview', async () => {
  const fake = coordinator();
  await pickPersona('f6'); assert.equal(S.push.personaId, 'f6');
  const res = await withFakeNowAsync(NOW, () => playScenario('overgenomen', 'nu'));
  assert.equal(res.rows.length, 1); assert.equal(fake.collection('testNotifications').length, 1);
  assert.match(text(card()), /Jan Jansen neemt je rit over/);
});

console.log('\n=== the preview ===');
await test('a delivered notification: title, text, "test" chip, state, what happened with the push, and a button to send it', () => {
  coordinator({ personaId: 'f6', tests: { t1: n() } }); S.pushSettings = { mode: 'test' };
  const h = card();
  assert.match(text(h), /AZ Carpool .* Piet Pieters neemt je rit over donderdag 16:15 is geregeld\. Bezorgd test Niet naar jouw toestel gestuurd/);
  assert.match(h, /data-pushsend="testNotifications\/t1"/); assert.match(h, /class="pushNotif"/);
});
await test('a notification held back by quiet hours says when it will be delivered and has a dashed look', () => {
  coordinator({ personaId: 'f6', tests: { t1: n({ deliverAt: new Date('2026-10-01T06:00:00+02:00').getTime() }) } });
  const h = card();
  assert.match(text(h), /Wacht op stille uren, bezorgd om 06:00/); assert.match(h, /pushNotif is-wait/); assert.doesNotMatch(h, /data-pushsend/, 'no send button while the switch is off');
});
await test('real notifications of the family are shown as "echt", with the push state from the queue', () => {
  coordinator({ personaId: 'f6', personaNotifs: { r1: n() }, queue: { q: { path: 'families/f6/notifications/r1' } } });
  const t = text(card());
  assert.match(t, /echt/); assert.match(t, /In de wachtrij voor jouw toestel/);
});
await test('what a name could do: names and texts are escaped, nothing is run', () => {
  coordinator({ personaId: 'f6', tests: { t1: n() } });
  S.families.f2 = { ...S.families.f2, parentName: '<img src=x onerror=alert(1)>' }; S.families.f6 = { ...S.families.f6, girlName: '"><script>x</script>' };
  const h = card();
  assert.doesNotMatch(h, /<img src=x|<script>x/); assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
await test('an empty preview says what to do; no chosen family says to choose one', () => {
  coordinator({ personaId: 'f6' }); assert.match(text(card()), /Nog geen meldingen\. Speel een situatie af\./);
  coordinator(); assert.match(text(card()), /Voorbeeld Kies eerst een gezin/);
});
await test('"Wie krijgt dit?" lists who gets the notification and why a back-up does or does not', () => {
  coordinator({ personaId: 'f6', tests: { t1: n() }, last: { id: 'rijVrij', rows: [{ id: 't1', toFamilyId: 'f6', persona: true, why: 'gekozen' }, { id: 'x', toFamilyId: 'f3', persona: false, why: 'echt' }],
    explain: [{ familyId: 'f3', receives: true, reason: 'ok' }, { familyId: 'f4', receives: false, reason: 'bezig' }, { familyId: 'f5', receives: false, reason: 'niet-gedekt' }], ride: null } });
  const t = text(card());
  assert.match(t, /Wie krijgt dit\? Ouder van Saar gekozen om te testen Ouder van Anouk krijgt het echt Back-ups voor deze rit: Ouder van Anouk krijgt het Ouder van Evi rijdt al rond die tijd Ouder van Lois tijdvak dekt de rit niet/);
});
await test('the button to clear the made-up notifications only shows when there are some', () => {
  coordinator({ personaId: 'f6' }); assert.doesNotMatch(card(), /id="pushClear"/);
  S.push.tests = { t1: n() }; assert.match(card(), /id="pushClear"/);
});
await test('the whole card as it looks (snapshot)', () => {
  coordinator({ personaId: 'f6', status: { lastRunAt: NOWMS - 60000, sent: 2, pending: 0 }, tests: { t1: n({ createdAt: NOWMS - 120000 }) } }); S.pushSettings = { mode: 'test' };
  S.push.devices = { [id]: { ...deviceDoc({ endpoint: ENDPOINT, ...KEYS, label: 'Chrome op Android', uid: 'coord', nowMs: 1 }), lastOkAt: NOWMS - 60000 } }; S.push.thisDeviceId = id;
  S.push.queue = { q: { path: 'testNotifications/t1', sentTo: { [id]: 1 } } };
  expectSnapshot('ui-push', 'card in test mode', withBrowser({ Notification: { permission: 'granted' } }, () => card()));
});

console.log('\n=== redrawing and wiring ===');
await test('a redraw replaces only the body (the heading stays outside)', () => {
  coordinator({ personaId: 'f6' });
  const body = dom.doc.getElementById('pushBody'); body.innerHTML = 'old';
  withFakeNow(NOW, () => refreshPushCard()); assert.match(body.innerHTML, /Alleen jij ziet dit/); assert.doesNotMatch(body.innerHTML, /<h2>/);
});
await test('a background redraw leaves an open list alone, but an action of the coordinator always redraws (the chosen list keeps the focus), and a switch never blocks it', () => {
  coordinator({ personaId: 'f6' });
  const body = dom.doc.getElementById('pushBody'); body.innerHTML = 'keep';
  const select = { tagName: 'SELECT' }; dom.doc.activeElement = select; body.contains = x => x === select;
  withFakeNow(NOW, () => refreshPushCard()); assert.equal(body.innerHTML, 'keep');
  withFakeNow(NOW, () => refreshPushCard(true)); assert.match(body.innerHTML, /Alleen jij ziet dit/);
  body.innerHTML = 'keep'; const box = { tagName: 'INPUT' }; dom.doc.activeElement = box; body.contains = x => x === box;
  withFakeNow(NOW, () => refreshPushCard()); assert.match(body.innerHTML, /Alleen jij ziet dit/, 'the key arriving after switching the test on must show');
  dom.doc.activeElement = null; delete body.contains;
});
await test('nothing is redrawn for a parent or when the card is not on screen', () => {
  useFakeDb(sampleDbSeed()); sampleParentState();
  const body = dom.doc.getElementById('pushBody'); body.innerHTML = 'keep';
  refreshPushCard(true); assert.equal(body.innerHTML, 'keep');
  coordinator({ personaId: 'f6' }); dom.reset(); assert.doesNotThrow(() => refreshPushCard());
});
await test('choosing a family while the list still has the focus shows the result at once (the scenario buttons switch on)', async () => {
  coordinator(); withFakeNow(NOW, () => refreshPushCard(true));
  const body = dom.doc.getElementById('pushBody'); const select = { tagName: 'SELECT' }; dom.doc.activeElement = select; body.contains = x => x === select;
  await pickPersona('f6');
  assert.doesNotMatch(body.innerHTML, /data-pushscen="\w+" disabled/); assert.match(body.innerHTML, /<option value="f6" selected>/);
  dom.doc.activeElement = null; delete body.contains;
});
await test('the controls are wired: switch, enable button, family, time and clear', async () => {
  const fake = coordinator({ personaId: 'f6', tests: { t1: n() } }); S.push.key = { publicKey: 'K' };
  withBrowser({ Notification: { permission: 'default' } }, () => { withFakeNow(NOW, () => refreshPushCard()); });
  const el = x => dom.doc.getElementById(x);
  for (const x of ['pushTestOn', 'pushPersona', 'pushTime', 'pushClear']) assert.equal(typeof (el(x).onchange || el(x).onclick), 'function', x);
  el('pushTestOn').checked = true; await el('pushTestOn').onchange(); await tick(); assert.equal(fake.get('settings/push').mode, 'test');
  el('pushTime').value = 'nacht'; el('pushTime').onchange(); assert.equal(S.push.timeChoice, 'nacht');
  el('pushTime').value = 'rommel'; el('pushTime').onchange(); assert.equal(S.push.timeChoice, 'nu');
  el('pushPersona').value = 'f3'; el('pushPersona').onchange(); assert.equal(S.push.personaId, 'f3');
  await el('pushClear').onclick(); await tick(); assert.deepEqual(fake.collection('testNotifications'), []);
});

console.log('\n=== a tapped push opens the app as that family ===');
const ready = (extra = {}) => { const f = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ linksLoaded: true, ...extra }); return f; };
await test('the coordinator lands in Testweergave as the family the push was for, on Ritten ruilen', () => {
  ready({ ritbeurs: { on: true } });
  assert.equal(queuePushOpen('f6'), true);
  assert.equal(S.impersonateFamilyId, 'f6'); assert.equal(S.rbView, 'ritbeurs'); assert.equal(S.push.pendingOpen, '');
});
await test('the notification a tapped push was about is scrolled into view', () => {
  ready({ ritbeurs: { on: true } });
  const card = dom.doc.getElementById('rbNotifCard'); const seen = []; card.scrollIntoView = o => seen.push(o);
  queuePushOpen('f6');
  assert.ok(seen.length >= 1); assert.deepEqual(seen[0], { block: 'start' });
  card.scrollIntoView = () => { throw new Error('refused'); };
  ready({ ritbeurs: { on: true } }); assert.doesNotThrow(() => queuePushOpen('f6'));
});
await test('with Ritten ruilen switched off the coordinator still lands in Testweergave, on the normal Wijzigen screen', () => {
  ready();
  assert.equal(queuePushOpen('f6'), true);
  assert.equal(S.impersonateFamilyId, 'f6'); assert.equal(S.rbView, 'wijzigen');
});
await test('a cold start: the families arrive before the Ritten-ruilen switch; the Ritten-ruilen screen is chosen as soon as the switch is known', () => {
  ready({ ritbeurs: null });
  assert.equal(queuePushOpen('f6'), true);
  assert.equal(S.impersonateFamilyId, 'f6'); assert.equal(S.rbView, 'wijzigen'); assert.equal(S.push.pendingView, true);
  applyPendingPushOpen(); assert.equal(S.rbView, 'wijzigen', 'still not known');
  S.ritbeurs = { on: true }; applyPendingPushOpen();
  assert.equal(S.rbView, 'ritbeurs'); assert.equal(S.push.pendingView, false);
});
await test('if the Testweergave is stopped before the switch arrives, the wish for the Ritten-ruilen screen is dropped', () => {
  ready({ ritbeurs: null });
  queuePushOpen('f6'); S.impersonateFamilyId = null; S.ritbeurs = { on: true }; applyPendingPushOpen();
  assert.equal(S.push.pendingView, false); assert.equal(S.rbView, 'wijzigen');
});
await test('while the app is not ready yet the request waits, and is carried out as soon as it can', () => {
  ready({ appReady: false });
  assert.equal(queuePushOpen('f6'), false); assert.equal(S.push.pendingOpen, 'f6'); assert.equal(S.impersonateFamilyId, null);
  S.appReady = true; assert.equal(applyPendingPushOpen(), true); assert.equal(S.impersonateFamilyId, 'f6');
  ready({ linksLoaded: false });
  assert.equal(queuePushOpen('f6'), false); assert.equal(S.push.pendingOpen, 'f6');
  ready(); S.families = {}; assert.equal(queuePushOpen('f6'), false); assert.equal(S.push.pendingOpen, 'f6', 'families not loaded yet: wait');
});
await test('a family that does not exist (any more) is dropped once the families are known', () => {
  ready(); assert.equal(queuePushOpen('f99'), false); assert.equal(S.push.pendingOpen, ''); assert.equal(S.impersonateFamilyId, null);
});
await test('nobody but the coordinator can be sent into a Testweergave this way', () => {
  useFakeDb(sampleDbSeed()); sampleParentState({ linksLoaded: true });
  assert.equal(queuePushOpen('f6'), false); assert.equal(S.push.pendingOpen, ''); assert.equal(S.impersonateFamilyId, null);
});
await test('an id that is not a plain id is ignored', () => {
  ready();
  for (const bad of ['', null, undefined, 'a/b', '<x>', 'x'.repeat(80)]) { assert.equal(queuePushOpen(bad), false); assert.equal(S.push.pendingOpen, ''); }
});
await test('from the address (?pushas=…): picked up, and the address is cleaned', () => {
  ready();
  const calls = []; const had = globalThis.history; globalThis.history = { replaceState: (...a) => calls.push(a) }; globalThis.location = { pathname: '/', hash: '#myweek', search: '' };
  try {
    assert.equal(queuePushOpenFromUrl('?pushas=f6'), true); assert.equal(S.impersonateFamilyId, 'f6'); assert.deepEqual(calls, [[null, '', '/#myweek']]);
    calls.length = 0; assert.equal(queuePushOpenFromUrl('?pushas=<x>'), false); assert.equal(calls.length, 0);
  } finally { globalThis.history = had; }
});
await test('already in that Testweergave: nothing is started again', () => {
  ready({ impersonateFamilyId: 'f6' });
  assert.equal(queuePushOpen('f6'), true); assert.equal(S.impersonateFamilyId, 'f6');
});

await test('the screen module has no inline styles, no stray text and no unused imports', () => {
  const src = readFileSync(new URL('../ui-push.js', import.meta.url), 'utf8');
  assert.equal((src.match(/style="/g) || []).length, 0);
  assertNoUnusedImports('ui-push.js');
  assert.equal(typeof wirePushCard, 'function'); assert.equal(typeof setPersona, 'function');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
