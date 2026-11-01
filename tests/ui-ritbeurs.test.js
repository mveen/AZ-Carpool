// Run with: node ui-ritbeurs.test.js
// The Ritbeurs screens: the segment in Wijzigen, open rides, own rides, "Ik kan inspringen", notifications, the badge and the Beheer switches
// (Ritten ruilen, and the push switch for the parents, off by default).
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
import { installFakeDom, useFakeDb, withFakeNow, withFakeNowAsync, NOW, WEEK_KEY, sampleDbSeed, sampleFlexParentState, sampleParentState, sampleCoordinatorState, sampleGroups, expectSnapshot } from './test-support.js';
import { S } from '../state.js';
import { createOffer } from '../ritbeurs-data.js';
import { renderDeviationTab } from '../ui-deviation.js';
import { renderBeheer } from '../ui-beheer.js';
import { updatePeriodBadge } from '../ui-period.js';
import {
  ritbeursAvailable, visibleNotifications, ritbeursBadgeCount, syncVervangerNav, setRbView, ritbeursViewHtml, momentDraft, momentPreview,
  ritbeursCardHtml, wireRitbeursCard, takeRide, saveMomentDraft, testNotificationsForView,
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
test('off or missing: no Vervanger, no badge, the tab is the normal day editor', () => {
  for (const on of [false, null]) {
    asF3({ offers: { o1: offerBy('f2') } }, on);
    assert.equal(ritbeursAvailable(), false);
    assert.equal(ritbeursBadgeCount(), 0);
    S.rbView = 'ritbeurs';
    withFakeNow(NOW, () => renderDeviationTab());
    const html = dom.html('tab-deviation');
    assert.doesNotMatch(html, /data-rbview|Ritbeurs|Ritten ruilen|Zoekt een vervanger/);
    assert.match(html, /data-devday=|id="wrOpenFlow"/);   // legacy day editor, or (weekrooster family) the pointer to Tijden wijzigen
  }
});
test('on: the tab is Ruilen, with no segment: Zoekt een vervanger, Ik kan inspringen; no "Jouw ritten", no Meldingen card while there are none', () => {
  asF3({ offers: { o1: offerBy('f2') } });
  withFakeNow(NOW, () => renderDeviationTab());
  const html = dom.html('tab-deviation'), s = text(html);
  assert.doesNotMatch(html, /class="segmented"|data-rbview|id="wrForm"/);
  assert.match(s, /Neem een rit over als het schikt\. Je eigen rit aanbieden doe je in Mijn week bij de rit\./);
  const at = ['Zoekt een vervanger', 'Ik kan inspringen'].map(x => s.indexOf(x));
  assert.ok(at.every(i => i >= 0) && at[1] > at[0], 'the two sections, in this order: ' + at.join(','));
  assert.equal((html.match(/class="sectionHead"/g) || []).length, 2);
  assert.doesNotMatch(html, /Jouw ritten|data-rboffer-open|id="rbNotifCard"|Meldingen|id="rbReadAll"|Stille uren|rbmFree/);
});
test('syncVervangerNav: on = name Vervanger, the teal class and the new icon; off for a family with a weekrooster = the tab is hidden; off for others = Wijzigen as it was', () => {
  const classes = new Set(), attrs = {}, label = { textContent: 'Wijzigen', setAttribute: (k, v) => { attrs[k] = v; } }, icon = { innerHTML: 'OLD' };
  const btn = { dataset: {}, style: {}, classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) }, querySelector: sel => (sel === '.navicon' ? icon : label) };
  const keep = document.querySelector; document.querySelector = () => btn;
  try {
    asF3({}, true); syncVervangerNav();
    assert.equal(label.textContent, 'Ruilen'); assert.equal(attrs['data-i18n'], 'nav.vervanger'); assert.ok(classes.has('navtab--ruil')); assert.match(icon.innerHTML, /ph-regular[\s\S]*ph-fill/); assert.equal(btn.style.display, '');
    asF3({}, false); syncVervangerNav();
    assert.equal(label.textContent, 'Wijzigen'); assert.ok(!classes.has('navtab--ruil')); assert.equal(icon.innerHTML, 'OLD'); assert.equal(btn.style.display, 'none', 'Tijden wijzigen opens from Mijn week: this family has no use for the old tab');
    sampleFlexParentState({ ritbeurs: { on: false } }); syncVervangerNav(); assert.equal(btn.style.display, '', 'a Flex family still has the day editor here');
  } finally { document.querySelector = keep; }
});
test('a user without a linked family does not get the Ritbeurs', () => {
  sampleParentState({ links: {}, ritbeurs: { on: true } });
  assert.equal(ritbeursAvailable(), false);
});

console.log('=== open rides ===');
test('the Ritbeurs view shows the open ride of another family: tag Open, when, time + route, by, note, chips, "Ik neem deze rit over"', () => {
  asF3({ offers: { o1: offerBy('f2', { message: 'Tandarts' }) } });
  const html = view(), s = text(html);
  assert.match(s, /Zoekt een vervanger Open Donderdag · heen .*16:15 Busstation → AFC (&#39;|')34 Piet Pieters · “Tandarts”/);
  assert.match(s, /Ik neem deze rit over/);
  assert.match(html, /<i>“Tandarts”<\/i>/);
  assert.match(html, /data-rbask="o1"/);
  assert.doesNotMatch(html, /Intrekken/);
});
test('the deadline in the "when" line: "Vóór 18:00 regelen" on the day before, "Deadline voorbij" after 18:00, nothing long before', () => {
  asF3({ offers: { o1: offerBy('f2') } });
  assert.match(withFakeNow('2026-09-30T10:00:00+02:00', () => text(ritbeursViewHtml(Date.now()))), /Vóór 18:00 regelen/);
  assert.match(withFakeNow('2026-09-30T20:00:00+02:00', () => text(ritbeursViewHtml(Date.now()))), /Deadline voorbij/);
  assert.doesNotMatch(withFakeNow('2026-09-28T09:00:00+02:00', () => text(ritbeursViewHtml(Date.now()))), /Ruime tijd|Deadline voorbij|Vóór 18:00/);
});
test('the own offer has Intrekken (trash icon) and no Neem over; rides that started are not listed', () => {
  asF2({ offers: { o1: offerBy('f2'), o2: offerBy('f4', { date: '2026-09-29' }) } });
  const html = view();
  assert.match(html, /data-rbwithdraw="o1"/); assert.match(text(html), /Jouw aanbod/);
  assert.doesNotMatch(html, /data-rbask|o2/);
});
test('tapping "Ik neem deze rit over" opens the confirmation: "Jij rijdt dan <dag> <richting> om <tijd>", only problems are shown, Bevestig / Annuleer', () => {
  asF3({ offers: { o1: offerBy('f2') }, rbConfirm: 'o1' });
  const html = view(), s = text(html);
  assert.match(s, /Jij rijdt dan donderdag heen om 16:15 Bevestig Annuleer/); assert.doesNotMatch(s, /✓|Geen andere rit|plekken/);
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

console.log('=== offering is no longer in this tab ===');
test('the tab has no own-rides list and no offer form (that happens in Mijn week)', () => {
  asF2({}); const html = view();
  assert.doesNotMatch(html, /data-rboffer-open|data-rboffergo|id="rbMessage"|Jouw ritten/);
});
await testAsync('a ride offered from Mijn week can be taken over in this tab', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'groups/Do_heen_1': groups().Do_heen_1, 'settings/ritbeurs': { on: true } });
  asF2({});
  assert.equal(await withFakeNowAsync(NOW, () => createOffer('Do', 'heen', 'Tandarts')), true);
  const id = [...fake.store.keys()].find(k => k.startsWith('offers/')).slice(7);
  asF3({ offers: { [id]: fake.get('offers/' + id) } });
  assert.match(view(), new RegExp('data-rbask="' + id + '"'));
  assert.equal(await withFakeNowAsync(NOW, () => takeRide(id)), true);
  assert.equal(fake.get('deviations/Do_heen').cars[0].driverFamilyId, 'f3');
});

console.log('=== Ik kan inspringen ===');
test('the form defaults to the first day that is not over, 15:00-18:30, only if free', () => {
  asF3({});
  const d = withFakeNow(NOW, () => momentDraft());
  assert.deepEqual(d, { date: '2026-09-30', from: '15:00', to: '18:30', onlyIfFree: true });
});
test('own moments are listed with a trash icon; the days are the same buttons as in Mijn week (selected = on, days that are over are disabled); Van/Tot sit side by side; no toggle', () => {
  asF3({ rbMomentOpen: true, moments: { m1: { familyId: 'f3', date: '2026-10-01', from: '15:00', to: '18:30', onlyIfFree: true, createdAt: 1 }, m2: { familyId: 'f4', date: '2026-10-01', from: '08:00', to: '09:00', onlyIfFree: true, createdAt: 1 } } });
  const html = view(), s = text(html);
  assert.match(s, /Donderdag 15:00–18:30/);
  assert.match(html, /data-rbmomentdel="m1"/); assert.doesNotMatch(html, /data-rbmomentdel="m2"/);
  assert.match(html, /data-rbmomentdel="m1"[^>]*><svg/);
  assert.match(html, /data-rbmday="2026-09-28" aria-pressed="false" aria-label="Maandag" disabled/);
  assert.match(html, /class="dayPill on" data-rbmday="2026-09-30"/);
  assert.equal((html.match(/class="dayPill[ "]/g) || []).length, 5);
  assert.match(html, /class="rbTimes">\s*<label for="rbmFrom"><span>Van<\/span>[\s\S]*<label for="rbmTo"><span>Tot<\/span>/);
  assert.doesNotMatch(html, /rbmFree|Alleen als ik niet al rijd|rbOpt/);
});
test('v213: closed, "Ik kan inspringen" is only the button (no form, no empty-text, no intro); a tap opens the form with the intro, the preview next to the save button', () => {
  asF3({}); let html = view();
  assert.match(html, /id="rbmOpen"[^>]*>[\s\S]*Tijdvak toevoegen/); assert.doesNotMatch(html, /id="rbmFrom"|id="rbmSave"|Je hebt geen tijdvak|Heb je tijd/);
  S.rbMomentOpen = true; html = view();
  assert.doesNotMatch(html, /id="rbmOpen"/); assert.match(html, /Heb je tijd en kun je een rit kunnen overnemen\?/);
  assert.match(html, /class="rbSaveRow"><span class="muted" id="rbmPreview">[^<]*<\/span>\s*<button type="button" class="btn" id="rbmSave"/);
  S.rbMomentOpen = false; S.rbMomentDraft = { date: '2026-10-01', from: '15:00', to: '18:30', onlyIfFree: true };
  assert.match(view(), /id="rbmFrom"/, 'a draft that is being typed keeps the form open');
});
test('v213: the offer card has one line with who offers it and the note (no separate "Aangeboden door" line)', () => {
  asF3({ offers: { o1: offerBy('f2', { message: 'Tandarts' }) } });
  const html = view(); assert.match(html, /class="rbBy"><b>[^<]+<\/b> · <i>“Tandarts”<\/i><\/div>/); assert.doesNotMatch(html, /Aangeboden door|rbNote/);
});
test('the preview says how many rides of other families the moment touches', () => {
  asF3({});
  assert.match(withFakeNow(NOW, () => momentPreview({ date: '2026-10-01', from: '15:00', to: '18:30' })), /raakt 1 rit\./);
  assert.match(withFakeNow(NOW, () => momentPreview({ date: '2026-10-01', from: '06:00', to: '07:00' })), /raakt nu geen ritten/);
});
await testAsync('saveMomentDraft stores the moment and resets the draft', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'groups/Do_heen_1': groups().Do_heen_1, 'settings/ritbeurs': { on: true } });
  asF3({ rbMomentOpen: true, rbMomentDraft: { date: '2026-10-01', from: '15:00', to: '18:30', onlyIfFree: true } });
  assert.equal(await withFakeNowAsync(NOW, () => saveMomentDraft()), true); assert.equal(S.rbMomentOpen, false, 'the form closes after saving');
  assert.equal([...fake.store.keys()].filter(k => k.startsWith('backupMoments/')).length, 1);
  assert.equal(S.rbMomentDraft, null);
});

console.log('=== notifications and the badge ===');
test('Testweergave (coordinator): the made-up notifications of that family are in the inbox, marked "test", held back by quiet hours, never in the badge', () => {
  const mine = { kind: 'taken', toFamilyId: 'f2', fromFamilyId: 'f3', weekKey: WEEK_KEY, day: 'Do', time: '16:15', date: '2026-10-01', createdAt: 5, deliverAt: 5, expiresAt: 9e12, read: false };
  sampleCoordinatorState({ impersonateFamilyId: 'f2', ritbeurs: { on: true }, groups: groups(), links: { coord: { familyId: 'f1' } },
    push: { ...S.push, tests: { t1: mine, later: { ...mine, createdAt: 9, deliverAt: Date.now() + 3600e3 }, old: { ...mine, expiresAt: 5 }, other: { ...mine, toFamilyId: 'f3' } } } });
  const html = view();
  assert.match(html, /Kees de Vries neemt je rit over <span class="noticeChip off">test<\/span>/);
  assert.equal((html.match(/noticeChip off">test/g) || []).length, 1, 'only the delivered, unexpired one of this family');
  assert.doesNotMatch(html, /rbNotif unread/); assert.doesNotMatch(html, /id="rbReadAll"/);
  assert.equal(ritbeursBadgeCount(), 0); assert.deepEqual(Object.keys(testNotificationsForView(Date.now())), ['t1']);
  S.impersonateFamilyId = null; assert.deepEqual(testNotificationsForView(Date.now()), {}); assert.doesNotMatch(view(), /noticeChip off">test/);
});
test('a parent never sees made-up notifications, even if they were somehow in the state', () => {
  asF2({ push: { ...S.push, tests: { t1: { kind: 'taken', toFamilyId: 'f2', fromFamilyId: 'f3', createdAt: 5, deliverAt: 5, expiresAt: 9e12, read: false } } }, impersonateFamilyId: 'f2' });
  assert.doesNotMatch(view(), /noticeChip off">test|neemt je rit over/);
});

test('a name with special characters is escaped once in the inbox, not twice, and its HTML is never run', () => {
  const families = { ...sampleParentState().families };
  families.f3 = { ...families.f3, parentName: 'Mark & Els' }; families.f4 = { ...families.f4, parentName: '<img src=x onerror=alert(1)>' };
  asF2({ families, notifications: {
    a: { kind: 'taken', fromFamilyId: 'f3', weekKey: WEEK_KEY, day: 'Do', time: '16:15', date: '2026-10-01', createdAt: 2, deliverAt: 1, expiresAt: 9e12, read: false },
    b: { kind: 'taken', fromFamilyId: 'f4', weekKey: WEEK_KEY, day: 'Do', time: '16:15', date: '2026-10-01', createdAt: 1, deliverAt: 1, expiresAt: 9e12, read: false } } });
  const html = view();
  assert.match(html, /<b>Mark &amp; Els neemt je rit over<\/b>/); assert.doesNotMatch(html, /&amp;amp;/);
  assert.doesNotMatch(html, /<img src=x/); assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; neemt je rit over/);
});

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
  assert.doesNotMatch(s, /Alles gelezen/);
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
test('notifications: no card at all when there are none; otherwise the latest five, no "Alles gelezen" button, no quiet-hours selects', () => {
  asF3({}); assert.doesNotMatch(view(), /rbNotifCard|Meldingen/);
  const notifications = {}; for(let i = 0; i < 7; i++) notifications['n' + i] = { kind: 'taken', fromFamilyId: 'f2', weekKey: WEEK_KEY, day: 'Do', time: '16:15', date: '2026-10-01', createdAt: i + 1, deliverAt: 1, expiresAt: 9e12, read: false };
  asF3({ notifications }); const html = view();
  assert.match(html, /id="rbNotifCard"/); assert.equal((html.match(/class="entryCard entryCard--stack rbNotifCard/g) || []).length, 5);
  assert.ok(html.indexOf('id="rbNotifCard"') < html.indexOf('class="infoLine"'), 'the notifications are on top, above the intro');
  assert.doesNotMatch(html, /rbReadAll|Alles gelezen|rbqFrom|rbqTo|Stille uren/);
});
test('setRbView switches between the two views and closes open forms', () => {
  asF3({ rbConfirm: 'o1' });
  withFakeNow(NOW, () => setRbView('ritbeurs'));
  assert.equal(S.rbView, 'ritbeurs'); assert.equal(S.rbConfirm, null);
  assert.match(dom.html('tab-deviation'), /Zoekt een vervanger/);
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
  assert.match(text(html), /Uit: Ruilen is verborgen en er worden geen meldingen gemaakt/);
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

console.log('=== Beheer: the push switch (default off) ===');
test('the push switch sits on the Ritten-ruilen card, below the Ritten-ruilen switch, and is off by default', () => {
  sampleCoordinatorState({ ritbeurs: { on: true } });
  const html = ritbeursCardHtml(), s = text(html);
  assert.ok(html.indexOf('id="ritbeursOn"') < html.indexOf('id="pushLiveOn"'));
  assert.match(html, /<input type="checkbox" role="switch" class="switch" id="pushLiveOn">/); assert.doesNotMatch(html, /id="pushLiveOn" checked/);
  assert.match(s, /Push-meldingen Aan: ouders kunnen in Instellingen push-meldingen aanzetten/); assert.match(s, /Testen kan altijd bij Push-meldingen testen/);
  assert.match(s, /Uit: er gaat niets naar ouders/); assert.doesNotMatch(s, /gezinnen hebben een telefoon aangemeld/);
  for (const bad of [null, { live: 'true' }, { mode: 'test' }]) { S.pushSettings = bad; assert.doesNotMatch(ritbeursCardHtml(), /id="pushLiveOn" checked/); }
});
test('on: the switch is on and the card says how many families have a phone switched on (each family once; test devices do not count)', () => {
  sampleCoordinatorState({ ritbeurs: { on: true }, pushSettings: { mode: 'uit', live: true, liveSince: 1 } });
  S.push.devices = { a: { familyId: 'f2' }, b: { familyId: 'f2' }, c: { familyId: 'f3' }, d: { owner: 'coordinator' } };
  const html = ritbeursCardHtml(); const n = Object.keys(S.families).length;
  assert.match(html, /id="pushLiveOn" checked>/); assert.match(text(html), new RegExp(`Aan: 2 van ${n} gezinnen hebben een telefoon aangemeld`));
});
test('on, but the server does not report itself: a warning; with a fresh report no warning', () => {
  sampleCoordinatorState({ ritbeurs: { on: true }, pushSettings: { mode: 'uit', live: true, liveSince: 1 } });
  const now = new Date(NOW).getTime();
  S.push.status = null; assert.match(text(ritbeursCardHtml(now)), /De server meldt zich niet/);
  S.push.status = { lastRunAt: now - 2 * 3600 * 1000 }; assert.match(text(ritbeursCardHtml(now)), /De server meldt zich niet/);
  S.push.status = { lastRunAt: now - 60000 }; assert.doesNotMatch(text(ritbeursCardHtml(now)), /De server meldt zich niet/);
  sampleCoordinatorState({ ritbeurs: { on: true } }); assert.doesNotMatch(text(ritbeursCardHtml(now)), /De server meldt zich niet/, 'off: no warning');
});
await testAsync('the push switch saves at once (no Opslaan button), keeps the test switch and does not touch Ritten ruilen', async () => {
  const fake = useFakeDb({ ...sampleDbSeed(), 'settings/ritbeurs': { on: true }, 'settings/push': { mode: 'test', live: false, liveSince: 0, updatedAt: 1 } });
  sampleCoordinatorState({ ritbeurs: { on: true }, pushSettings: { mode: 'test', live: false, liveSince: 0 } });
  withFakeNow(NOW, () => renderBeheer());
  const sw = dom.el('pushLiveOn'); sw.checked = true; wireRitbeursCard();
  await withFakeNowAsync(NOW, () => sw.onchange());
  const d = fake.get('settings/push'); assert.equal(d.live, true); assert.equal(d.mode, 'test'); assert.ok(d.liveSince > 0);
  assert.equal(fake.get('settings/ritbeurs').on, true); assert.match(dom.html('tab-beheer'), /id="pushLiveOn" checked/);
  assert.doesNotMatch(dom.html('tab-beheer').match(/id="ritbeursCard"[\s\S]*?<\/div>\s*<\/div>/)[0], /Opslaan/);
});
await testAsync('a refused save puts the switch back and says why', async () => {
  const fake = useFakeDb({ ...sampleDbSeed() }); sampleCoordinatorState({ ritbeurs: { on: true } });
  withFakeNow(NOW, () => renderBeheer());
  const sw = dom.el('pushLiveOn'); sw.checked = true; wireRitbeursCard(); fake.failWrites('settings/push', 'permission-denied');
  await sw.onchange(); assert.equal(sw.checked, false); assert.match(toast(), /permission-denied/); assert.equal(S.pushSettings, null);
});

test('the offered ride shows its passengers as chips (your own daughter in red), no old pill markup', () => {
  asF3({ offers: { o1: offerBy('f2') } });
  const html = ritbeursViewHtml(); assert.doesNotMatch(html, /class="pill rbPill"/); assert.match(html, /class="chips rbPills"/);
});
test('the intro is an info line and the sections are labels, not amber boxes', () => {
  const html = ritbeursViewHtml(); assert.match(html, /<div class="infoLine">/); assert.match(html, /<div class="sectionHead"><span class="sectionHead__title">Zoekt een vervanger<\/span>/); assert.doesNotMatch(html, /devAlert/);
});

test('a time list of "Nieuw tijdvak" that is open is not redrawn under the finger; after it is left it is', () => {
  asF3({ rbMomentOpen: true, offers: { o1: offerBy('f2') } }); S.rbView = 'ritbeurs';
  withFakeNow(NOW, () => renderDeviationTab());
  dom.el('tab-deviation').innerHTML = 'MARK';
  document.activeElement = { classList: { contains: c => c === 'rbSel' } };
  withFakeNow(NOW, () => renderDeviationTab()); assert.equal(dom.html('tab-deviation'), 'MARK');
  document.activeElement = null;
  withFakeNow(NOW, () => renderDeviationTab()); assert.match(dom.html('tab-deviation'), /id="rbmFrom"/);
});
test('v214: a back-up notification has the button "Bied mijn rit aan" for the own ride inside the back-up\'s slot; not for rides outside it or already on offer', () => {
  const n = { kind: 'backupForRide', fromFamilyId: 'f3', momentFrom: '15:00', momentTo: '18:30', date: '2026-10-01', weekKey: WEEK_KEY, createdAt: 5, deliverAt: 1, expiresAt: 9e12, read: false };
  asF2({ notifications: { a: n } });   // f2 drives Thursday 16:15 (heen)
  let html = view();
  assert.match(html, /data-rboffernow="Do\|heen">Bied mijn rit aan</);
  asF2({ notifications: { a: { ...n, momentFrom: '07:00', momentTo: '08:00' } } });
  assert.doesNotMatch(view(), /data-rboffernow/);
  asF2({ notifications: { a: n }, offers: { o1: offerBy('f2') } });
  assert.doesNotMatch(view(), /data-rboffernow/, 'already on offer: no button');
});
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
