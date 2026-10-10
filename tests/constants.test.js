// Run with: node constants.test.js
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
import fs from 'node:fs';
import { APP_VERSION, PH_PATHS, DAYS, DIR_TEXT, APP_URL, WA_ICON_SMALL, WHATSAPP_SVG, todayKey, todayKeyNow } from '../constants.js';

console.log('=== constants.js ===');
test('DAYS are Monday to Friday, with the stored key first and the Dutch name second', () => {
  assert.deepEqual(DAYS.map(d => d[0]), ['Ma', 'Di', 'Wo', 'Do', 'Vr']);
  assert.deepEqual(DAYS.map(d => d[1]), ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag']);
});
test('DIR_TEXT gives one wording per direction, from the translation file', () => {
  assert.equal(DIR_TEXT.heen, 'Heen · Aalsmeer → Alkmaar');
  assert.equal(DIR_TEXT.terug, 'Terug · Alkmaar → Aalsmeer');
});
test('APP_URL is the public GitHub Pages address, with a trailing slash (links append #myweek)', () => {
  assert.equal(APP_URL, 'https://mveen.github.io/AZ-Carpool/');
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
test('WhatsApp icon is an inline svg (no external image to load)', () => { assert.ok(WHATSAPP_SVG.startsWith('<svg')); });
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
  assert.match(APP_VERSION, /^v\d+$/); assert.ok(Number(APP_VERSION.slice(1)) >= 59);
});
test('the info icon exists', () => { assert.ok(PH_PATHS.info && PH_PATHS.info.startsWith('<path')); });
test('design v2: no hand-drawn icon is left (no <line>, <circle>, <rect>, <polyline>) and every icon is drawn in the text colour', () => {
  const hand = Object.entries(PH_PATHS).filter(([, v]) => /<(line|circle|rect|polyline|polygon)\b/.test(v)).map(([k]) => k);
  assert.deepEqual(hand, []);
  assert.match(WHATSAPP_SVG, /fill="currentColor"/); assert.match(WA_ICON_SMALL, /fill="currentColor"/);
});
test('the megaphone (notice bar) and the eye (test bar) exist', () => { assert.ok(PH_PATHS['megaphone-fill'] && PH_PATHS.eye); });

test('todayKeyNow follows the clock (a phone that stays open past midnight), todayKey is the value at start-up', () => {
  assert.equal(typeof todayKeyNow, 'function'); assert.ok(['Ma', 'Di', 'Wo', 'Do', 'Vr', null].includes(todayKeyNow())); assert.equal(todayKey, todayKeyNow());
  assert.ok(PH_PATHS['plus-circle']); assert.ok(PH_PATHS['minus-circle']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
