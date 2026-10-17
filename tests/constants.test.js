// Run with: node constants.test.js
import assert from 'node:assert/strict';
import * as constantsModule from '../constants.js';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import fs from 'node:fs';
import { APP_VERSION, PH_PATHS, DAYS, APP_URL, WA_ICON_SMALL, todayKey, todayKeyNow, WEEK_END_HOUR, weekHasEnded } from '../constants.js';

console.log('=== constants.js ===');
test('DAYS are Monday to Friday, with the stored key first and the Dutch name second', () => {
  assert.deepEqual(DAYS.map(d => d[0]), ['Ma', 'Di', 'Wo', 'Do', 'Vr']);
  assert.deepEqual(DAYS.map(d => d[1]), ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag']);
});
test('there is no fixed wording per direction any more: the place comes from the rides (see locations.js and the texts dir.heenTo / dir.terugFrom)', () => {
  assert.equal('DIR_TEXT' in constantsModule, false);
});
test('APP_URL is the public address of the app, with a trailing slash', () => {
  assert.equal(APP_URL, 'https://azcarpool.nl/');
});
test('todayKey is a weekday key, or null on the weekend', () => {
  assert.ok([null, 'Ma', 'Di', 'Wo', 'Do', 'Vr'].includes(todayKey));
});
test('every icon the code asks for with phIcon(\'name\') exists in PH_PATHS', () => {
  const missing = new Set();
  fs.readdirSync(new URL('../', import.meta.url)).filter(f => f.endsWith('.js') && !f.includes('.test.')).forEach(f => {
    const code = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    for (const m of code.matchAll(/phIcon\('([\w-]+)'/g)) if (!(m[1] in PH_PATHS)) missing.add(m[1] + ' (' + f + ')');
  });
  assert.deepEqual([...missing], []);
});
test('WhatsApp icon is an inline svg (no external image to load)', () => { assert.ok(WA_ICON_SMALL.startsWith('<svg')); });
test('the Beheer section icons exist and are Phosphor paths', () => {
  for (const k of ['list','heart','map-pin','bell','key','download','chart','wrench','clock','chevron-right','chevron-left','users','user','gear','info','soccer','calendar']) assert.ok(PH_PATHS[k] && PH_PATHS[k].startsWith('<path'), k);
});

test('the Phosphor icons of the design system v2 exist, regular and -fill (tab bar and header)', () => {
  for (const n of ['house','calendar-blank','arrows-left-right','soccer-ball','gear-six','share-fat','steering-wheel','warning-circle','whatsapp-logo','phone','megaphone']) for (const k of [n, n + '-fill']) assert.ok(PH_PATHS[k] && PH_PATHS[k].startsWith('<path') && !PH_PATHS[k].includes('<script'), k);
});
test('the other Phosphor icons of the ride rows exist (regular or bold, as used)', () => {
  for (const k of ['caret-right','caret-down','car-profile','car-profile-bold','x-bold','user-circle-gear','shuffle','table','printer']) assert.ok(PH_PATHS[k] && PH_PATHS[k].startsWith('<path'), k);
});
test('the icons of the settings sheet and Mijn gezin exist, and the app version looks like a cache name', () => {
  for (const k of ['lifebuoy','user-switch','caret-left','users','moon','question','info']) assert.ok(PH_PATHS[k], k);
  assert.match(APP_VERSION, /^v\d+$/); assert.ok(Number(APP_VERSION.slice(1)) >= 70);
});
test('the info icon exists', () => { assert.ok(PH_PATHS.info && PH_PATHS.info.startsWith('<path')); });
test('design v2: no hand-drawn icon is left (no <line>, <circle>, <rect>, <polyline>) and every icon is drawn in the text colour', () => {
  const hand = Object.entries(PH_PATHS).filter(([, v]) => /<(line|circle|rect|polyline|polygon)\b/.test(v)).map(([k]) => k);
  assert.deepEqual(hand, []);
  assert.match(WA_ICON_SMALL, /fill="currentColor"/);
});
test('the megaphone (notice bar) and the eye (test bar) exist', () => { assert.ok(PH_PATHS['megaphone-fill'] && PH_PATHS.eye); });

test('todayKeyNow follows the clock (a phone that stays open past midnight), todayKey is the value at start-up', () => {
  assert.equal(typeof todayKeyNow, 'function'); assert.ok(['Ma', 'Di', 'Wo', 'Do', 'Vr', null].includes(todayKeyNow())); assert.equal(todayKey, todayKeyNow());
  assert.ok(PH_PATHS['plus-circle']); assert.ok(PH_PATHS['minus-circle']);
});
// A local clock on purpose: test-support.js would fix the clock for the whole file, and the todayKey test above needs the real one.
function withFakeNow(iso, fn) {
  const Real = Date, fixed = new Real(iso).getTime();
  globalThis.Date = class extends Real { constructor(...a) { if (a.length === 0) super(fixed); else super(...a); } static now() { return fixed; } };
  try { return fn(); } finally { globalThis.Date = Real; }
}
test('the week is over on Friday at 19:00 (not at midnight), and then nothing is "today" any more', () => {
  assert.equal(WEEK_END_HOUR, 19);
  const at = iso => new Date(iso);
  assert.equal(weekHasEnded(at('2026-10-01T23:30:00+02:00')), false);   // Thursday night
  assert.equal(weekHasEnded(at('2026-10-02T18:59:00+02:00')), false);
  assert.equal(weekHasEnded(at('2026-10-02T19:00:00+02:00')), true);
  assert.equal(weekHasEnded(at('2026-10-03T00:00:00+02:00')), true);    // Saturday
  assert.equal(weekHasEnded(at('2026-10-04T23:59:00+02:00')), true);    // Sunday
  assert.equal(weekHasEnded(at('2026-10-05T00:00:00+02:00')), false);   // Monday
  withFakeNow('2026-10-02T18:59:00+02:00', () => assert.equal(todayKeyNow(), 'Vr'));
  withFakeNow('2026-10-02T19:00:00+02:00', () => assert.equal(todayKeyNow(), null));
});
test('the avatar library icons all exist in PH_PATHS', () => {
  for (const k of ['user','car','steering-wheel','road-horizon','soccer-ball','trophy','medal','megaphone','users-three','handshake']) assert.ok(PH_PATHS[k] && PH_PATHS[k].startsWith('<path'), k);
});
test('APP_VERSION looks like v<number>', () => { assert.match(APP_VERSION, /^v\d+$/); assert.ok(Number(APP_VERSION.slice(1)) >= 122); });


test('the menu icon used by the Firefox explanation exists (Phosphor dots-three-vertical)', () => { assert.match(PH_PATHS['dots-three-vertical'], /^<path d="M140,128/); });


test('APP_VERSION always equals the cache name of the service worker', () => {
  const sw = fs.readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.equal(sw.match(/const CACHE_NAME = 'az-carpool-(v\d+)'/)[1], APP_VERSION);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
