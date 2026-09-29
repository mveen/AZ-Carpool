// Run with: node i18n.test.js
// Every text the app shows comes from texts-nl.js through t(); these tests keep that dictionary honest.
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
import { t, setLanguage, getLanguage, registerLanguage, hasKey, allKeys, locale } from './i18n.js';
import nl from './texts-nl.js';

console.log('=== t() ===');
test('returns the Dutch text for a key', () => { assert.equal(t('driver.none'), 'nog geen chauffeur'); });
test('fills {placeholders}', () => {
  assert.equal(t('wa.day.title', { dayLabel: 'Maandag', date: '28 sep' }), 'Aangepast schema Maandag 28 sep:');
});
test('a placeholder without a value is left visible, not replaced by "undefined"', () => {
  assert.equal(t('wa.day.title', { dayLabel: 'Maandag' }), 'Aangepast schema Maandag {date}:');
});
test('a value of 0 is kept (not treated as missing)', () => {
  assert.equal(t('deviation.gekozen', { n: 0 }), '0 gekozen');
});
test('unknown key falls back to the key itself', () => { assert.equal(t('nope.nothing'), 'nope.nothing'); });
test('locale() comes from the dictionary', () => { assert.equal(locale(), 'nl-NL'); });

console.log('\n=== languages ===');
test('another language can be registered and selected, and falls back to Dutch for missing keys', () => {
  registerLanguage('xx', { 'driver.none': 'nobody yet', 'meta.locale': 'en-GB' });
  setLanguage('xx');
  try {
    assert.equal(getLanguage(), 'xx');
    assert.equal(t('driver.none'), 'nobody yet');
    assert.equal(locale(), 'en-GB');
    assert.equal(t('wa.thisWeek'), 'deze week', 'missing key falls back to Dutch');
  } finally { setLanguage('nl'); }
  assert.equal(t('driver.none'), 'nog geen chauffeur');
});
test('selecting an unknown language throws', () => { assert.throws(() => setLanguage('zz'), /Unknown language/); });

console.log('\n=== dictionary ===');
const sources = fs.readdirSync(new URL('./', import.meta.url)).filter(f => f.endsWith('.js') && !f.includes('.test.') && !['texts-nl.js', 'fake-db.js', 'test-support.js', 'run-tests.js'].includes(f));
const used = new Map();
sources.forEach(f => {
  const code = fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8');
  for (const m of code.matchAll(/\bt\('([^']+)'/g)) { if (!used.has(m[1])) used.set(m[1], f); }
});
test('every key used in the code exists in texts-nl.js', () => {
  const missing = [...used].filter(([k]) => !hasKey(k)).map(([k, f]) => k + ' (' + f + ')');
  assert.deepEqual(missing, []);
});
test('no dictionary value is empty', () => {
  assert.deepEqual(allKeys().filter(k => nl[k] === ''), []);
});
test('placeholders are written as {p1}, {name}, ... only', () => {
  const bad = allKeys().filter(k => /\{[^}]*[^\w}][^}]*\}/.test(nl[k]));
  assert.deepEqual(bad, []);
});
test('static page texts (data-i18n in index.html) all exist', () => {
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)].map(m => m[1]);
  assert.ok(keys.length >= 8);
  assert.deepEqual(keys.filter(k => !hasKey(k)), []);
});

test('navigation order is Mijn week, Wijzigen, Rooster, Mijn gezin, Beheer, and Mijn week starts open', () => {
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const nav = html.slice(html.indexOf('<nav id="bottomnav"'), html.indexOf('</nav>'));
  assert.deepEqual([...nav.matchAll(/data-tab="(\w+)"/g)].map(m => m[1]), ['myweek', 'deviation', 'schedule', 'profile', 'beheer']);
  assert.match(nav, /data-tab="myweek" class="navtab active"/);
  assert.equal((nav.match(/navtab active/g) || []).length, 1);
  assert.match(html, /<div id="tab-myweek"><\/div>/); assert.match(html, /<div id="tab-schedule" style="display:none">/);
});
test('the Weekschema warning texts exist', () => {
  assert.ok(hasKey('profile.weekschema_waarschuwing_titel') && hasKey('profile.weekschema_waarschuwing_tekst') && hasKey('profile.weekschema_naar_wijzigen'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
