// Run with: node ui-ritbeurs.test.js
// The Ritbeurs screens: the segment in Wijzigen, open rides, own rides, "Ik kan inspringen", notifications, the badge and the Beheer switch.
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
import { installFakeDom, useFakeDb, withFakeNow, withFakeNowAsync, NOW, WEEK_KEY, sampleDbSeed, sampleParentState, sampleCoordinatorState, sampleGroups, expectSnapshot } from './test-support.js';
import { S } from '../state.js';
import { renderDeviationTab } from '../ui-deviation.js';
import { renderBeheer } from '../ui-beheer.js';
import { updatePeriodBadge } from '../ui-period.js';
import {
  ritbeursAvailable, visibleNotifications, ritbeursBadgeCount, ritbeursSegmentHtml, setRbView, ritbeursViewHtml, momentDraft, momentPreview,
  ritbeursCardHtml, wireRitbeursCard, offerRide, takeRide, saveMomentDraft,
} from '../ui-ritbeurs.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const toast = () => text(dom.doc.getElementById('toast').innerHTML);
const groups = () => ({ ...sampleGroups(), Do_heen_1: { day: 'Do', direction: 'heen', girlIds: ['f1', 'f4'], driverFamilyId: 'f2', reserveFamilyIds: [], departureTime: '16:15' } });
const offerBy = (by, extra = {}) => ({ weekKey: WEEK_KEY, day: 'Do', direction: 'heen', date: '2026-10-01', time: '16:15', offeredBy: by, message: '', status: 'open', createdAt: 1, ...extra });
// f3 looks at the app; f2 offers Thursday's ride.
const asF3 = (patch = {}, on = true) => sampleParentState({ me: 'p3', links: { p3: { familyId: 'f3' } }, groups: groups(), ritbeurs: on === null ? null : { on }, ...patch });
const asF2 = (patch = {}, on = true) => sampleParentState({ groups: groups(), ritbeurs: on === null ? null : { on }, ...patch });
const view = () => withFakeNow(NOW, () => ritbeursViewHtml(Date.now()));

console.log('=== the feature switch hides everything ===');
test('off or missing: no segment, no badge, the Wijzigen tab is the normal one', () => {
  for (const on of [false, null]) {
    asF3({ offers: { o1: offerBy('f2') } }, on);
    assert.equal(ritbeursAvailable(), false);
    assert.equal(ritbeursBadgeCount(), 0);
    S.rbView = 'ritbeurs';
    withFakeNow(NOW, () => renderDeviationTab());
    const html = dom.html('tab-deviation');
    assert.doesNotMatch(html, /data-rbview|Ritbeurs/);
    assert.match(html, /Eenmalige ritaanpassing/);
    assert.equal(S.rbView, 'wijzigen');
  }
});
test('on: the Wijzigen tab starts with the segment "Wijzigen | Ritbeurs (n)"', () => {
  asF3({ offers: { o1: offerBy('f2') } });
  withFakeNow(NOW, () => renderDeviationTab());
  const html = dom.html('tab-deviation');
  assert.match(html, /class="segmented"/);
  assert.match(text(html), /^Wijzigen Ritbeurs \(1\)/);
  assert.match(html, /data-rbview="wijzigen" aria-pressed="true"/);
  assert.match(text(html), /Eenmalige ritaanpassing/);
});
test('a user without a linked family does not get the Ritbeurs', () => {
  sampleParentState({ links: {}, ritbeurs: { on: true } });
  assert.equal(ritbeursAvailable(), false);
});

console.log('=== open rides ===');
test('the Ritbeurs view shows the open ride of another family with a Neem over button', () => {
  asF3({ offers: { o1: offerBy('f2', { message: 'Tandarts' }) } });
  const html = view(), s = text(html);
  assert.match(s, /Donderdag 16:15/);
  assert.match(s, /Heen · /);
  assert.match(s, /Aangeboden door Piet Pieters · “Tandarts”/);
  assert.match(s, /Neem over/);
  assert.match(html, /data-rbask="o1"/);
  assert.doesNotMatch(html, /Intrekken/);
});
test('the deadline chip: "Vóór 18:00 regelen" on the day before, "Deadline voorbij" after 18:00, "Ruime tijd" long before', () => {
  asF3({ offers: { o1: offerBy('f2') } });
  assert.match(withFakeNow('2026-09-30T10:00:00+02:00', () => text(ritbeursViewHtml(Date.now()))), /Vóór 18:00 regelen/);
  assert.match(withFakeNow('2026-09-30T20:00:00+02:00', () => text(ritbeursViewHtml(Date.now()))), /Deadline voorbij/);
  assert.match(withFakeNow('2026-09-28T09:00:00+02:00', () => text(ritbeursViewHtml(Date.now()))), /Ruime tijd/);
});
test('the own offer has Intrekken (trash icon) and no Neem over; rides that started are not listed', () => {
  asF2({ offers: { o1: offerBy('f2'), o2: offerBy('f4', { date: '2026-09-29' }) } });
  const html = view();
  assert.match(html, /data-rbwithdraw="o1"/); assert.match(text(html), /Jouw aanbod/);
  assert.doesNotMatch(html, /data-rbask|o2/);
});
test('tapping Neem over opens the confirmation: it is yours, also if you cannot later', () => {
  asF3({ offers: { o1: offerBy('f2') }, rbConfirm: 'o1' });
  const html = view(), s = text(html);
  assert.match(s, /Rit overnemen\?/);
  assert.match(s, /Overnemen is definitief: kun je later toch niet, dan bied je hem zelf opnieuw aan/);
  assert.doesNotMatch(s, /geef je hem terug/i);
  assert.match(html, /data-rbtake="o1"/);
});
test('a conflict only warns: the button says "Toch overnemen" and the confirmation is still possible', () => {
  // f3 already drives Thursday morning at 16:00 in a second car
  asF3({ offers: { o1: offerBy('f2') }, groups: { ...groups(), Do_heen_2: { day: 'Do', direction: 'heen', girlIds: ['f6'], driverFamilyId: 'f3', reserveFamilyIds: [], departureTime: '16:00' } } });
  assert.match(text(view()), /Toch overnemen/);
  S.rbConfirm = 'o1';
  const html = view();
  assert.match(text(html), /Let op: je rijdt al donderdag heen om 16:00/);
  assert.match(html, /data-rbtake="o1"/);
});

console.log('=== own rides and offering ===');
test('own rides this week with Aanbieden; an open offer shows "Aangeboden" instead', () => {
  asF2({});
  let html = view();
  assert.match(html, /data-rboffer-open="Do\|heen"/);
  asF2({ offers: { o1: offerBy('f2') } });
  html = view();
  assert.doesNotMatch(html, /data-rboffer-open="Do\|heen"/);
  assert.match(text(html), /Aangeboden/);
});
test('the offer form: optional message of at most 60 characters and the explanation, without "alle chauffeurs"', () => {
  asF2({ rbOffering: 'Do|heen' });
  const html = view();
  assert.match(html, /id="rbMessage" maxlength="60"/);
  assert.match(text(html), /Eerst horen back-ups die op dat tijdstip kunnen inspringen het/);
  assert.doesNotMatch(text(html), /alle chauffeurs/i);
  assert.match(html, /data-rboffergo="Do\|heen"/);
});
await testAsync('offerRide writes the offer and closes the form; takeRide takes it over', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'groups/Do_heen_1': groups().Do_heen_1, 'settings/ritbeurs': { on: true } });
  asF2({ rbOffering: 'Do|heen' });
  assert.equal(await withFakeNowAsync(NOW, () => offerRide('Do|heen')), true);
  assert.equal(S.rbOffering, null);
  const id = [...fake.store.keys()].find(k => k.startsWith('offers/')).slice(7);
  asF3({ offers: { [id]: fake.get('offers/' + id) } });
  assert.equal(await withFakeNowAsync(NOW, () => takeRide(id)), true);
  assert.equal(fake.get('deviations/Do_heen').cars[0].driverFamilyId, 'f3');
});

console.log('=== Ik kan inspringen ===');
test('the form defaults to the first day that is not over, 15:00-18:30, only if free', () => {
  asF3({});
  const d = withFakeNow(NOW, () => momentDraft());
  assert.deepEqual(d, { date: '2026-09-30', from: '15:00', to: '18:30', onlyIfFree: true });
});
test('own moments are listed with a trash icon; selected options are neutral (no red pill), days that are over are disabled', () => {
  asF3({ moments: { m1: { familyId: 'f3', date: '2026-10-01', from: '15:00', to: '18:30', onlyIfFree: true, createdAt: 1 }, m2: { familyId: 'f4', date: '2026-10-01', from: '08:00', to: '09:00', onlyIfFree: true, createdAt: 1 } } });
  const html = view(), s = text(html);
  assert.match(s, /Donderdag 15:00–18:30 · alleen als ik niet rijd/);
  assert.match(html, /data-rbmomentdel="m1"/); assert.doesNotMatch(html, /data-rbmomentdel="m2"/);
  assert.match(html, /data-rbmomentdel="m1"[^>]*><svg/);
  assert.match(html, /data-rbmday="2026-09-28" aria-pressed="false" disabled/);
  assert.match(html, /class="rbOpt active" data-rbmday="2026-09-30"/);
  assert.match(html, /id="rbmFree" checked|class="switch" id="rbmFree" checked/);
});
test('the preview says how many rides of other families the moment touches', () => {
  asF3({});
  assert.match(withFakeNow(NOW, () => momentPreview({ date: '2026-10-01', from: '15:00', to: '18:30' })), /raakt 1 ritten/);
  assert.match(withFakeNow(NOW, () => momentPreview({ date: '2026-10-01', from: '06:00', to: '07:00' })), /raakt nu geen ritten/);
});
await testAsync('saveMomentDraft stores the moment and resets the draft', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'groups/Do_heen_1': groups().Do_heen_1, 'settings/ritbeurs': { on: true } });
  asF3({ rbMomentDraft: { date: '2026-10-01', from: '15:00', to: '18:30', onlyIfFree: true } });
  assert.equal(await withFakeNowAsync(NOW, () => saveMomentDraft()), true);
  assert.equal([...fake.store.keys()].filter(k => k.startsWith('backupMoments/')).length, 1);
  assert.equal(S.rbMomentDraft, null);
});

console.log('=== notifications and the badge ===');
test('notifications read in plain Dutch and never claim to know where someone is', () => {
  asF2({ families: { ...sampleParentState().families }, notifications: {
    n1: { kind: 'taken', fromFamilyId: 'f3', weekKey: WEEK_KEY, day: 'Do', time: '16:15', date: '2026-10-01', createdAt: 5, deliverAt: 5, expiresAt: 9e12, read: false },
    n2: { kind: 'backupForRide', fromFamilyId: 'f3', weekKey: WEEK_KEY, date: '2026-10-01', momentFrom: '15:00', momentTo: '18:30', createdAt: 4, deliverAt: 4, expiresAt: 9e12, read: true },
    n3: { kind: 'uncovered', weekKey: WEEK_KEY, day: 'Do', time: '16:15', date: '2026-10-01', createdAt: 3, deliverAt: 3, expiresAt: 9e12, read: false },
  } });
  const s = text(view());
  assert.match(s, /Kees de Vries neemt je rit over donderdag 16:15 is geregeld\./);
  assert.match(s, /Er is een back-up voor je rit Kees de Vries kan donderdag tussen 15:00 en 18:30 inspringen/);
  assert.match(s, /Rit donderdag 16:15 nog niet gedekt Het is 18:00 en niemand heeft hem overgenomen/);
  assert.doesNotMatch(s, /in de buurt/i);
  assert.match(s, /Alles gelezen/);
});
test('a notification held back by quiet hours or expired is not shown or counted', () => {
  asF2({ notifications: { a: { kind: 'taken', createdAt: 1, deliverAt: Date.now() + 3600e3, expiresAt: 9e12, read: false }, b: { kind: 'taken', createdAt: 1, deliverAt: 1, expiresAt: 5, read: false }, c: { kind: 'taken', createdAt: 1, deliverAt: 1, expiresAt: 9e12, read: false } } });
  assert.deepEqual(Object.keys(visibleNotifications()), ['c']);
});
test('the number on the Wijzigen tab counts rides of others plus unread notifications, and is hidden when the switch is off', () => {
  asF3({ offers: { o1: offerBy('f2'), o2: offerBy('f3', { day: 'Vr' }) }, notifications: { c: { kind: 'taken', createdAt: 1, deliverAt: 1, expiresAt: 9e12, read: false } } });
  assert.equal(withFakeNow(NOW, () => ritbeursBadgeCount(Date.now())), 2);
  withFakeNow(NOW, () => updatePeriodBadge());
  assert.equal(dom.el('navDeviationBadge').textContent, '2');
  S.ritbeurs = { on: false };
  withFakeNow(NOW, () => updatePeriodBadge());
  assert.equal(dom.el('navDeviationBadge').textContent, '');
});
test('the quiet hours selects start at 22:00 – 06:00 and are instelbaar', () => {
  asF3({});
  const html = view();
  assert.match(html, /id="rbqFrom"[^>]*>.*<option value="22:00" selected>/);
  assert.match(html, /id="rbqTo"[^>]*>.*<option value="06:00" selected>/);
});
test('setRbView switches between the two views and closes open forms', () => {
  asF3({ rbConfirm: 'o1', rbOffering: 'Do|heen' });
  withFakeNow(NOW, () => setRbView('ritbeurs'));
  assert.equal(S.rbView, 'ritbeurs'); assert.equal(S.rbConfirm, null); assert.equal(S.rbOffering, null);
  assert.match(dom.html('tab-deviation'), /Ritten die nog een chauffeur zoeken/);
  withFakeNow(NOW, () => setRbView('wijzigen'));
  assert.equal(S.rbView, 'wijzigen');
});
test('snapshot: the Ritbeurs view', () => {
  asF3({ offers: { o1: offerBy('f2', { message: 'Tandarts' }) }, moments: { m1: { familyId: 'f3', date: '2026-10-01', from: '15:00', to: '18:30', onlyIfFree: true, createdAt: 1 } } });
  expectSnapshot('ui-ritbeurs', 'ritbeurs view', view());
});

console.log('=== Beheer: the switch ===');
test('the card is in Beheer for the coordinator, with a switch and a status chip', () => {
  sampleCoordinatorState({ ritbeurs: { on: false } });
  const html = ritbeursCardHtml();
  assert.match(html, /id="ritbeursOn"/); assert.doesNotMatch(html, /id="ritbeursOn" checked/);
  assert.match(text(html), /Uit: de Ritbeurs is verborgen en er worden geen meldingen gemaakt/);
  assert.match(text(html), /stopt direct alle meldingen/);
  withFakeNow(NOW, () => renderBeheer());
  assert.match(dom.html('tab-beheer'), /id="ritbeursCard"/);
  sampleCoordinatorState({ ritbeurs: { on: true }, offers: { o1: offerBy('f2') } });
  assert.match(withFakeNow(NOW, () => text(ritbeursCardHtml())), /Aan: 1 openstaande ritten, 0 gemelde tijdvakken/);
});
await testAsync('the switch saves at once (no Opslaan button) and turns the Ritbeurs off for the screen', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'settings/ritbeurs': { on: true } });
  sampleCoordinatorState({ ritbeurs: { on: true } });
  withFakeNow(NOW, () => renderBeheer());
  const sw = dom.el('ritbeursOn'); sw.checked = false;
  wireRitbeursCard();
  await sw.onchange();
  assert.equal(fake.get('settings/ritbeurs').on, false);
  assert.equal(ritbeursAvailable(), false);
  assert.doesNotMatch(dom.html('tab-beheer').match(/id="ritbeursCard"[\s\S]*?<\/div>\s*<\/div>/)[0], /Opslaan/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
