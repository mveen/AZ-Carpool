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
import { t, setLanguage, getLanguage, registerLanguage, hasKey, allKeys, locale } from '../i18n.js';
import nl from '../texts-nl.js';

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
const sources = fs.readdirSync(new URL('../', import.meta.url)).filter(f => f.endsWith('.js') && !f.includes('.test.') && !['texts-nl.js', 'fake-db.js', 'test-support.js', 'run-tests.js'].includes(f));
const used = new Map();
sources.forEach(f => {
  const code = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
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
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)].map(m => m[1]);
  assert.ok(keys.length >= 8);
  assert.deepEqual(keys.filter(k => !hasKey(k)), []);
});

test('navigation order is Mijn week, Wijzigen, Rooster, Mijn gezin, Wedstrijden, Beheer, and Mijn week starts open', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const nav = html.slice(html.indexOf('<nav id="bottomnav"'), html.indexOf('</nav>'));
  assert.deepEqual([...nav.matchAll(/data-tab="(\w+)"/g)].map(m => m[1]), ['myweek', 'deviation', 'schedule', 'profile', 'matches', 'beheer']);
  assert.match(nav, /data-tab="myweek" class="navtab active"/);
  assert.equal((nav.match(/navtab active/g) || []).length, 1);
  assert.match(html, /<div id="tab-myweek"><\/div>/); assert.match(html, /<div id="tab-schedule" style="display:none">/);
});
test('the Wijzigen tab has a badge for the period task, and the period texts fill their placeholders', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-tab="deviation"[\s\S]*?<span id="navDeviationBadge" class="navbadge" style="display:none" aria-live="polite"><\/span><\/button>/);
  assert.equal(t('period.task.body', { p1: 'Herfstvakantie', p2: '26 – 30 okt', p3: 'Jahaimy' }), 'Herfstvakantie · 26 – 30 okt. Geef door hoe laat Jahaimy heen en terug moet, of dat ze niet meerijdt.');
  assert.equal(t('period.entry.err.order', { p1: 'dinsdag 27 okt' }), 'dinsdag 27 okt: Terug moet later zijn dan Heen.');
  assert.equal(t('period.done.heen', { p1: '10:30' }), 'heen 10:30');
  assert.equal(t('dayCoord.waText', { when: 'morgen' }), 'Hi! Een vraag over de carpool van morgen: ');   // no name in the text
  assert.equal(t('period.ov.deadlineOpen', { p1: 'vr 16 okt 12:00', p2: 'Lois, Saar' }), 'Deadline vr 16 okt 12:00 · nog niet: Lois, Saar');
  assert.equal(t('period.ov.handedValue', { p1: 9, p2: 14 }), '9 van 14'); assert.equal(t('period.ov.dayChanges', { p1: 2 }), '2 wijz.');
  assert.equal(t('period.view.moveTo', { p1: 1, p2: 'Kees de Vries' }), 'Auto 1 · Kees de Vries'); assert.equal(t('period.rooster.err.full', { p1: 4, p2: 3 }), 'Auto vol: 4 van 3 plekken.');
  assert.equal(t('period.coord.progress', { p1: 9, p2: 14, p3: 5 }), '9 van 14 doorgegeven. Nog 5 te gaan.');
  assert.equal(t('period.coord.allDone', { p2: 14 }), 'Alle 14 gezinnen hebben doorgegeven.');
  assert.equal(t('period.form.onBehalf', { p1: 'Piet Pieters', p2: 'Jahaimy' }), 'Je vult in namens Piet Pieters (Jahaimy).');
  assert.equal(t('period.status.value', { p1: 9, p2: 14 }), '9 van 14 gezinnen');
  assert.deepEqual(['notYet', 'done', 'fill', 'view', 'hide'].map(k => t('period.coord.' + k)), ['Nog niet', 'Doorgegeven', 'Invullen', 'Bekijk', 'Sluiten']);
});
test('the Weekschema warning texts exist', () => {
  assert.ok(hasKey('profile.weekschema_waarschuwing_titel') && hasKey('profile.weekschema_waarschuwing_tekst') && hasKey('profile.weekschema_naar_wijzigen'));
});



console.log('\n=== US-02..05 texts ===');
test('the wording from the user stories is exact', () => {
  assert.equal(t('dayCoord.label', { when: 'morgen', name: 'Merel' }), 'Dagcoördinator morgen: Merel');
  assert.equal(t('dayCoord.label', { when: t('dayCoord.monday'), name: 'Merel' }), 'Dagcoördinator maandag: Merel');
  assert.equal(t('oneOnOne.label'), 'Stem 1-op-1 af, de dagcoördinator deelt het besluit.');
  assert.equal(t('wa.conclusie.onSchedule', { dayLabel: 'Donderdag', url: 'U' }), 'Donderdag: volgens schema. Zie Mijn week: U');
  assert.equal(t('flex.speelsterChauffeur'), 'speelster-chauffeur');
});

test('the texts of the five new stories exist and fill their placeholders', () => {
  assert.equal(t('impact.needSeat', { name: 'Kees' }), 'Extra plek nodig → voorstel: Kees');
  assert.equal(t('wa.conclusie.ov', { names: 'Anouk' }), 'Anouk terug met OV');
  assert.equal(t('dist.unknown'), 'locatie onbekend');
  assert.equal(t('dist.km', { km: '42,3' }), '± 42,3 km enkele reis');
  assert.equal(t('ov.button'), 'Terug met OV');
  assert.ok(hasKey('loc.beheerTitle') && hasKey('geo.route') && hasKey('impact.beheerIntro'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
test('the removed shift map-button texts are gone', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(nl, 'loc.mapButton'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(nl, 'loc.mapLabel'), false);
});
