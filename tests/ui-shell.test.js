// Run with: node ui-shell.test.js
// The frame around every screen: header (title, week line, share button, avatar letters) and the Instellingen sheet.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, resetState, sampleParentState, sampleCoordinatorState, useFakeDb } from './test-support.js';
import { S } from '../state.js';
import fs from 'node:fs';
import { APP_VERSION } from '../constants.js';
import { initials, updateHeader, openSettings, openAvatarPicker, initShell, setViewAs, shareWeek, TAB_TITLE_KEY } from '../ui-shell.js';

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
  assert.equal(dom.el('shareToggle').hidden, false); assert.equal(dom.el('avatarInitials').innerHTML, 'PP');
});
test('design v2 context lines: Rooster "Week N · iedereen", Wijzigen "Eenmalig, deze week", Wedstrijden "<team> · komende 4 weken", Beheer "Alleen voor de coördinator"', () => {
  sampleParentState(); updateHeader('schedule'); assert.equal(dom.el('shareToggle').hidden, true); assert.equal(dom.el('headerContext').textContent, 'Week 40 · iedereen');
  updateHeader('deviation'); assert.equal(dom.el('headerContext').textContent, 'Eenmalig, deze week');
  updateHeader('matches'); assert.equal(dom.el('headerTitle').textContent, 'Wedstrijden'); assert.equal(dom.el('headerContext').textContent, 'Komende 4 weken');
  S.matchFeeds = [{ calendarId: 'c', label: 'AZ O15-1' }]; updateHeader('matches'); assert.equal(dom.el('headerContext').textContent, 'O15-1 · komende 4 weken');
  updateHeader('beheer'); assert.equal(dom.el('headerContext').textContent, 'Alleen voor de coördinator');
  updateHeader('profile'); assert.equal(dom.el('headerContext').textContent, 'Aalsmeer – Alkmaar');
});
test('an unknown screen falls back to Mijn week', () => { sampleParentState(); updateHeader('nope'); assert.equal(dom.el('headerTitle').textContent, 'Mijn week'); });
test('a coordinator without a family gets a C; an unlinked visitor gets a ?', () => {
  sampleCoordinatorState({ coordinatorConfig: { uid: 'coord' } }); updateHeader('myweek'); assert.equal(dom.el('avatarInitials').innerHTML, 'C');
  resetState({ me: 'x' }); updateHeader('myweek'); assert.equal(dom.el('avatarInitials').innerHTML, '?');
});

console.log('\n=== Instellingen sheet ===');
const realGetById = dom.doc.getElementById;
function installSheet() {
  const els = {};
  const mk = id => (els[id] = { id, onclick: null, focus() {}, addEventListener() {}, classList: { add() {}, remove() {} }, setAttribute() {} });
  const ov = { html: '', mounted: false, removed: false, addEventListener() {}, remove() { ov.removed = true; },
    set innerHTML(v) { ov.html = v; }, get innerHTML() { return ov.html; },
    querySelector: sel => els[sel.slice(1)] || mk(sel.slice(1)) };
  dom.doc.createElement = () => ov; dom.doc.body.appendChild = () => { ov.mounted = true; };
  dom.doc.getElementById = id => (id === 'sheetOverlay' ? (ov.mounted && !ov.removed ? ov : null) : realGetById(id));
  return { ov, els };
}
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
test('the sheet shows avatar, name and role, then Mijn gezin (with hint), Thema, Help and the app version', () => {
  sampleParentState(); const { ov } = installSheet(); openSettings(() => {});
  const s = text(ov.html);
  assert.equal(ov.mounted, true);
  assert.match(s, /^PP Piet Pieters Ouder van Jahaimy Mijn gezin tijden, auto, beschikbaar Thema Licht Donker Help AZ Carpool Aalsmeer – Alkmaar v\d+$/);
  assert.match(ov.html, /id="themeLight"/); assert.match(ov.html, /id="setHelp"/);
  assert.doesNotMatch(ov.html, /viewParent/, 'a parent has no "Bekijk als"');
});
test('the app version in the sheet is the same as the cache name of the service worker', () => {
  const sw = fs.readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.equal(APP_VERSION, /CACHE_NAME = 'az-carpool-(v\d+)'/.exec(sw)[1]);
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

console.log('\n=== Bekijk als: Ouder | Coördinator ===');
const coordWithFamily = () => sampleCoordinatorState({ links: { coord: { familyId: 'f1' } } });
test('a coordinator with a family gets the switch, a coordinator without one does not', () => {
  coordWithFamily(); let { ov } = installSheet(); openSettings(() => {});
  assert.match(ov.html, /id="viewParent"/); assert.match(ov.html, /id="viewCoord"/); assert.match(text(ov.html), /Bekijk als Ouder Coördinator/);
  sampleCoordinatorState({ coordinatorConfig: { uid: 'coord' } }); ({ ov } = installSheet()); openSettings(() => {});
  assert.doesNotMatch(ov.html, /viewParent/);
});
test('Ouder hides the coordinator rights and remembers the choice; Coördinator brings them back', () => {
  coordWithFamily(); const { els } = installSheet(); let changed = 0; openSettings(() => {}, () => { changed++; });
  assert.equal(S.canEdit, true);
  els.viewParent.onclick(); assert.equal(S.viewAsParent, true); assert.equal(S.canEdit, false); assert.equal(localStorage.getItem('view-as'), 'parent'); assert.equal(changed, 1);
  els.viewCoord.onclick(); assert.equal(S.viewAsParent, false); assert.equal(S.canEdit, true); assert.equal(localStorage.getItem('view-as'), 'coordinator'); assert.equal(changed, 2);
});
test('setViewAs without a callback does not break', () => { coordWithFamily(); setViewAs('parent'); assert.equal(S.canEdit, false); setViewAs('coordinator'); assert.equal(S.canEdit, true); });
test('initShell wires the avatar, the share button, the contact handler and the "back to Instellingen" links', () => {
  sampleParentState(); const { ov } = installSheet(); const handlers = []; dom.doc.addEventListener = (type, fn) => { if (type === 'click') handlers.push(fn); };
  initShell(() => {});
  assert.equal(handlers.length, 2);   // contact names + [data-opensettings] and the Vast|Flex switch
  dom.el('avatarBtn').onclick(); assert.equal(ov.mounted, true);
  ov.mounted = false; ov.removed = false;
  handlers[1]({ target: { closest: sel => (sel === '[data-opensettings]' ? {} : null) } }); assert.equal(ov.mounted, true);
  // Vast | Flex switch: sets the hidden select and moves the active mark.
  const sel = { value: 'vast' }; const flexBtn = { dataset: { famtype: 'flex', famtypefor: 'coord_familyType' }, classList: { toggle() {} } };
  dom.el('coord_familyType'); dom.doc.getElementById = id => (id === 'coord_familyType' ? sel : dom.el(id)); dom.doc.querySelectorAll = () => [flexBtn];
  handlers[1]({ target: { closest: s => (s === '[data-famtype]' ? flexBtn : null) } }); assert.equal(sel.value, 'flex');
});

console.log('\n=== Mijn week delen (share sheet) ===');
const hadNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const setNav = v => Object.defineProperty(globalThis, 'navigator', { value: v, configurable: true, writable: true });
const restoreNav = () => { if (hadNav) Object.defineProperty(globalThis, 'navigator', hadNav); else delete globalThis.navigator; };
test('the share button opens a sheet with the text and a Delen button; Delen uses the phone share menu when there is one', async () => {
  sampleParentState(); const { ov, els } = installSheet(); initShell(() => {});
  assert.equal(typeof dom.el('shareToggle').onclick, 'function'); dom.el('shareToggle').onclick();
  assert.equal(ov.mounted, true); assert.match(text(ov.html), /^Mijn week delen Je kiest zelf met wie, in WhatsApp of een andere app\. .+ Delen$/); assert.match(ov.html, /class="sharePreview"/);
  const shared = []; setNav({ share: async d => { shared.push(d); } });
  await els.doShare.onclick(); assert.equal(shared.length, 1); assert.ok(shared[0].text.length > 10); assert.equal(ov.removed, true); restoreNav();
});
test('without a share menu (or when it fails) WhatsApp opens with the text; cancelling the menu does nothing', async () => {
  sampleParentState(); dom.opened.length = 0;
  setNav({}); assert.equal(await shareWeek('Hallo'), true); assert.match(dom.opened[0][0], /^https:\/\/wa\.me\/\?text=Hallo/);
  setNav({ share: async () => { throw new Error('boom'); } }); dom.opened.length = 0; await shareWeek('Hoi'); assert.match(dom.opened[0][0], /text=Hoi/);
  setNav({ share: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; } }); dom.opened.length = 0;
  assert.equal(await shareWeek('Nee'), false); assert.equal(dom.opened.length, 0);
  restoreNav();
});
test('the sheet names the team when the app has exactly one match calendar', () => {
  sampleParentState({ matchFeeds: [{ calendarId: 'c', label: 'AZ O15-1' }] }); const { ov } = installSheet(); openSettings(() => {});
  assert.match(text(ov.html), /Ouder van Jahaimy · O15-1/);
  sampleParentState({ matchFeeds: [{ calendarId: 'a', label: 'A' }, { calendarId: 'b', label: 'B' }] }); const o2 = installSheet(); openSettings(() => {});
  assert.doesNotMatch(text(o2.ov.html), /· A|· B/);
});

console.log('\n=== avatar choice ===');
const tick = () => new Promise(r => setImmediate(r));
function pickerSheet() {
  const sheet = installSheet(); sheet.ov.click = null; sheet.ov.addEventListener = (type, fn) => { if (type === 'click') sheet.ov.click = fn; };
  return sheet;
}
const tap = (ov, avatar) => ov.click({ target: { closest: sel => (sel === '[data-avatar]' ? { dataset: { avatar } } : null) } });
test('default: no avatar field shows the initials in the header', () => {
  sampleParentState(); updateHeader('myweek');
  assert.equal(dom.el('avatarInitials').innerHTML, 'PP'); assert.doesNotMatch(dom.el('avatarInitials').innerHTML, /<svg/);
});
test('a family with an avatar shows the icon in the header, and the button gets the red-tint class', () => {
  sampleParentState(); S.families.f2.avatar = 'trophy'; updateHeader('myweek');
  assert.match(dom.el('avatarInitials').innerHTML, /<svg/); assert.doesNotMatch(dom.el('avatarInitials').innerHTML, /PP/);
});
test('an unknown stored avatar falls back to the initials', () => {
  sampleParentState(); S.families.f2.avatar = 'does-not-exist'; updateHeader('myweek');
  assert.equal(dom.el('avatarInitials').innerHTML, 'PP');
});
test('the Instellingen sheet has a tappable avatar for a linked parent, a plain one for a visitor without family', () => {
  sampleParentState(); let { ov } = installSheet(); openSettings(() => {});
  assert.match(ov.html, /id="setAvatar"/); assert.match(ov.html, /aria-label="Avatar wijzigen"/);
  resetState({ me: 'x' }); ({ ov } = installSheet()); openSettings(() => {});
  assert.doesNotMatch(ov.html, /id="setAvatar"/);
  sampleCoordinatorState({ coordinatorConfig: { uid: 'coord' } }); ({ ov } = installSheet()); openSettings(() => {});
  assert.doesNotMatch(ov.html, /id="setAvatar"/, 'the bare coordinator has no family to put an avatar on');
});
test('the avatar button in the sheet opens the picker', () => {
  sampleParentState(); const { ov, els } = installSheet(); openSettings(() => {});
  els.setAvatar.onclick(); assert.match(ov.html, /Kies je avatar/);
});
test('the picker shows the initials first, then the 10 icons, with the current one pressed', () => {
  sampleParentState(); S.families.f2.avatar = 'car'; const { ov } = pickerSheet(); openAvatarPicker(() => {});
  assert.equal((ov.html.match(/data-avatar=/g) || []).length, 11);
  assert.match(ov.html, /data-avatar="" aria-pressed="false"><span class="avatarTile__disc">PP<\/span><span class="avatarTile__label">Initialen/);
  assert.match(ov.html, /data-avatar="car" aria-pressed="true"/); assert.match(ov.html, /data-avatar="trophy" aria-pressed="false"/);
});
test('the picker is not offered without a family', () => {
  resetState({ me: 'x' }); const { ov } = pickerSheet(); openAvatarPicker(() => { }); assert.equal(ov.mounted, false);
});
await (async () => {
  const run = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); } };
  await run('a tap saves the avatar on the family document, updates the header and shows a toast with Ongedaan', async () => {
    const fake = useFakeDb({ 'families/f2': { parentName: 'Piet Pieters', girlName: 'Jahaimy', capacity: 4 } });
    sampleParentState(); const { ov } = pickerSheet(); openAvatarPicker(() => {});
    tap(ov, 'soccer-ball'); await tick(); await tick();
    assert.equal(fake.get('families/f2').avatar, 'soccer-ball'); assert.equal(fake.get('families/f2').parentName, 'Piet Pieters', 'other fields stay');
    assert.equal(S.families.f2.avatar, 'soccer-ball'); assert.match(dom.el('avatarInitials').innerHTML, /<svg/);
    assert.match(dom.doc.getElementById('toast').innerHTML, /Avatar opgeslagen/); assert.match(dom.doc.getElementById('toast').innerHTML, /Ongedaan/);
  });
  await run('Ongedaan puts the previous avatar back', async () => {
    const fake = useFakeDb({ 'families/f2': { parentName: 'Piet Pieters', avatar: 'car' } });
    sampleParentState(); S.families.f2.avatar = 'car'; const { ov } = pickerSheet(); openAvatarPicker(() => {});
    tap(ov, 'medal'); await tick(); await tick(); assert.equal(fake.get('families/f2').avatar, 'medal');
    dom.doc.getElementById('toast').onclick({ target: { id: 'toastAction' } }); await tick(); await tick();
    assert.equal(fake.get('families/f2').avatar, 'car'); assert.match(dom.doc.getElementById('toast').innerHTML, /Avatar hersteld/);
  });
  await run('choosing Initialen stores an empty avatar (the field is never deleted)', async () => {
    const fake = useFakeDb({ 'families/f2': { parentName: 'Piet Pieters', avatar: 'car' } });
    sampleParentState(); S.families.f2.avatar = 'car'; const { ov } = pickerSheet(); openAvatarPicker(() => {});
    tap(ov, ''); await tick(); await tick();
    assert.equal(fake.get('families/f2').avatar, ''); updateHeader('myweek'); assert.equal(dom.el('avatarInitials').innerHTML, 'PP');
  });
  await run('tapping the current avatar writes nothing', async () => {
    const fake = useFakeDb({ 'families/f2': { parentName: 'Piet Pieters', avatar: 'car' } });
    sampleParentState(); S.families.f2.avatar = 'car'; const { ov } = pickerSheet(); openAvatarPicker(() => {});
    dom.doc.getElementById('toast').innerHTML = ''; tap(ov, 'car'); await tick(); await tick();
    assert.equal(fake.get('families/f2').avatar, 'car'); assert.doesNotMatch(dom.doc.getElementById('toast').innerHTML || '', /Avatar opgeslagen/);
  });
})();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
