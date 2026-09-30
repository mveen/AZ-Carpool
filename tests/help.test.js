// Run with: node help.test.js
// The help articles (help-nl.js) and the search over them (help.js). The article rules matter because help-nl.js is public:
// no secret, no link, no e-mail address, no phone number, no invite code may ever end up in it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import './test-support.js';
import articles from '../help-nl.js';
import { normalize, words, queryTokens, visibleArticles, searchHelp, findArticle } from '../help.js';

const ids = q => searchHelp(q, { canEdit: false }).map(a => a.id);
const allText = a => [a.title, a.keywords || '', ...a.body].join('\n');

console.log('=== the articles (help-nl.js) ===');
test('every article has a unique id, a title, keywords and at least one paragraph', () => {
  assert.ok(articles.length >= 10);
  const seen = new Set();
  articles.forEach(a => {
    assert.match(a.id, /^[a-z0-9-]+$/, a.id); assert.ok(!seen.has(a.id), 'duplicate id ' + a.id); seen.add(a.id);
    assert.ok(a.title && a.title.length >= 8, a.id + ' title'); assert.ok(a.keywords && a.keywords.length >= 8, a.id + ' keywords');
    assert.ok(Array.isArray(a.body) && a.body.length >= 1 && a.body.every(p => typeof p === 'string' && p.trim()), a.id + ' body');
  });
});
test('the tab of an article is a real tab of the app', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const nav = html.slice(html.indexOf('<nav id="bottomnav"'), html.indexOf('</nav>'));
  const tabs = new Set([...nav.matchAll(/data-tab="(\w+)"/g)].map(m => m[1]));
  articles.filter(a => a.tab).forEach(a => assert.ok(tabs.has(a.tab), a.id + ' points to unknown tab ' + a.tab));
});
test('pages of the Beheer tab are only for the coordinator', () => {
  articles.filter(a => a.tab === 'beheer').forEach(a => assert.equal(a.coordinatorOnly, true, a.id));
});
test('no article contains a link, e-mail address, phone number, long key-like code or password', () => {
  articles.forEach(a => {
    const s = allText(a);
    assert.doesNotMatch(s, /https?:\/\/|www\./i, a.id + ' has a link');
    assert.doesNotMatch(s, /\S+@\S+\.\S+/, a.id + ' has an e-mail address');
    assert.doesNotMatch(s, /(\+31|0031|\b06)[\s-]?\d[\d\s-]{6,}/, a.id + ' has a phone number');
    assert.doesNotMatch(s, /\b[A-Za-z0-9_-]{24,}\b/, a.id + ' has a long key-like code');
    assert.doesNotMatch(s, /wachtwoord\s*(is|:)|password\s*(is|:)/i, a.id + ' has a password');
  });
});
test('the article about the periode explains the fields of the Beheer card', () => {
  const a = findArticle('beheer-periode', { canEdit: true });
  assert.ok(a); const s = allText(a);
  ['Naam', 'Eerste dag', 'Laatste dag', 'Invullen open vanaf', 'Deadline', 'Opslaan', 'Annuleren'].forEach(w => assert.ok(s.includes(w), w));
});

console.log('\n=== search helpers ===');
test('normalize removes accents and case; words splits on anything else', () => {
  assert.equal(normalize('Dagcoördinator'), 'dagcoordinator'); assert.equal(normalize(null), '');
  assert.deepEqual(words('Heen/terug, café!'), ['heen', 'terug', 'cafe']);
});
test('queryTokens drops filler words but keeps a question made only of filler words', () => {
  assert.deepEqual(queryTokens('Hoe kan ik mijn dochter koppelen?'), ['dochter', 'koppelen']);
  assert.deepEqual(queryTokens('hoe kan ik'), ['hoe', 'kan', 'ik']);
  assert.deepEqual(queryTokens('a'), []);
});

console.log('\n=== search ===');
test('an empty question lists every article the user may see, in order', () => {
  assert.deepEqual(ids(''), articles.filter(a => !a.coordinatorOnly).map(a => a.id));
  assert.deepEqual(searchHelp('  ', { canEdit: true }).map(a => a.id), articles.map(a => a.id));
});
test('coordinator articles are hidden for parents and shown for the coordinator', () => {
  assert.equal(visibleArticles(false).some(a => a.coordinatorOnly), false);
  assert.equal(visibleArticles(true).length, articles.length);
  assert.deepEqual(searchHelp('beheer periode vakantie', { canEdit: false }).filter(a => a.coordinatorOnly), []);
  assert.equal(searchHelp('periode vakantie proefwerkweek', { canEdit: false }).some(a => a.id === 'beheer-periode'), false);
  assert.equal(searchHelp('periode vakantie proefwerkweek', { canEdit: true })[0].id, 'beheer-periode');
  assert.equal(findArticle('beheer-periode', { canEdit: false }), null);
});
test('a natural question finds the right article first', () => {
  assert.equal(ids('mijn dochter is ziek')[0], 'wijzigen');
  assert.equal(ids('hoe installeer ik de app')[0], 'installeren');
  assert.equal(ids('donker thema')[0], 'donker');
  assert.equal(ids('terug met ov')[0], 'terug-met-ov');
});
test('a parent finds how to hand in the times for a holiday or exam week, the coordinator also finds how to set it up', () => {
  assert.equal(ids('tijden doorgeven vakantie')[0], 'periode-tijden');
  assert.equal(ids('proefwerkweek')[0], 'periode-tijden');
  assert.equal(searchHelp('periode instellen vakantie deadline', { canEdit: true }).some(a => a.id === 'beheer-periode'), true);
  const s = allText(findArticle('periode-tijden'));
  ['Tijden doorgeven', 'Rijdt niet mee', 'Doorgeven', 'Tijden aanpassen', 'Actie nodig'].forEach(w => assert.ok(s.includes(w), w));
});
test('the coordinator articles explain the overview per family and that the coordinator can still fill in after the deadline', () => {
  const s = allText(findArticle('beheer-periode', { canEdit: true }));
  ['Namens een ouder invullen', 'Invullen', 'Bekijk', 'Tijden aanpassen', 'Na de deadline'].forEach(w => assert.ok(s.includes(w), w));
  assert.equal(searchHelp('namens een ouder invullen', { canEdit: true })[0].id, 'beheer-periode');
  assert.equal(searchHelp('namens een ouder invullen', { canEdit: false }).some(a => a.coordinatorOnly), false);
});
test('the coordinator finds how to make the temporary rooster; parents are told what it is and that Wijzigen goes first', () => {
  const c = allText(findArticle('periode-rooster', { canEdit: true }));
  ['Tijdelijk rooster maken', 'Opnieuw indelen', 'Alles opnieuw indelen', 'Niet ingedeeld', 'prullenbak', 'Wijzigen gaan altijd voor'].forEach(w => assert.ok(c.includes(w), w));
  assert.equal(searchHelp('tijdelijk rooster maken', { canEdit: true }).some(a => a.id === 'periode-rooster'), true);
  assert.equal(findArticle('periode-rooster', { canEdit: false }), null);
  assert.match(allText(findArticle('periode-tijden')), /tijdelijk rooster voor de periode/); assert.match(allText(findArticle('rooster')), /derde knop met de naam van de periode/);
  assert.equal(searchHelp('tijdelijk rooster', { canEdit: false }).some(a => a.coordinatorOnly), false);
});
test('the help explains several periods at once: the list, overlap, deleting with the times, the field to choose a period', () => {
  const b = allText(findArticle('beheer-periode', { canEdit: true }));
  ['Perioden met andere tijden', '+ Periode toevoegen', 'meerdere perioden tegelijk', 'geen dag delen', 'ook verwijderd', 'verwijder dat dan eerst bij Rooster'].forEach(w => assert.ok(b.includes(w), w));
  assert.match(allText(findArticle('periode-tijden')), /twee perioden tegelijk.*twee kaarten.*een 2/);
  const r = allText(findArticle('periode-rooster', { canEdit: true })); assert.match(r, /kaart per periode/); assert.match(r, /veld Periode/); assert.match(r, /alleen het tijdelijke rooster van die periode/);
  assert.equal(searchHelp('twee perioden toetsweek herfstvakantie overlap', { canEdit: true })[0].id, 'beheer-periode');
});
test('accents, capitals and word endings do not matter', () => {
  assert.equal(ids('DAGCOORDINATOR')[0], 'dagcoordinator');
  assert.equal(ids('dagcoördinator')[0], 'dagcoordinator');
  assert.ok(ids('wijzigingen').includes('wijzigen'));
});
test('nothing found gives an empty list; results are limited to 6 unless asked otherwise', () => {
  assert.deepEqual(ids('xyzzyqq'), []);
  assert.ok(ids('rit').length <= 6);
  assert.ok(searchHelp('rit', { canEdit: true, limit: 2 }).length <= 2);
});
test('a very short word does not match the start of longer words', () => {
  assert.deepEqual(ids('ok'), []);   // would otherwise match "oktober", "ontvangen", ...
});
test('findArticle returns null for an unknown id', () => { assert.equal(findArticle('bestaat-niet'), null); assert.equal(findArticle('wat-is').id, 'wat-is'); });

console.log('\n=== button and tab names in the help match the app ===');
import nl from '../texts-nl.js';
// Names of buttons and cards that the help quotes. If a text in the app is renamed, this test fails and the help must follow.
const QUOTED = ['Tijden doorgeven', 'Doorgeven', 'Tijden aanpassen', 'Rijdt niet mee', 'Namens een ouder invullen', 'Actie nodig', '+ Periode toevoegen',
  'Tijdelijk rooster maken', 'Alles opnieuw indelen', 'Opnieuw indelen', 'Bevestigen: voor elke week', 'Eenmalig wijzigen', 'Vrije invoer', 'Plek toevoegen',
  'Terug met OV', 'Toch met de auto', 'Weekoverzicht', 'Afdrukken / PDF', 'Stem af met chauffeur', 'Deel update via WhatsApp', '+ Auto toevoegen', 'Terug naar standaard rooster', 'Ontkoppelen van deze dochter', 'Dit is mijn dochter', 'Toegang aanvragen', 'Nu verversen'];
const helpText = () => articles.flatMap(a => [a.title, ...a.body]).join('\n');
const appValues = Object.values(nl).join('\n').replace(/&amp;/g, '&');
test('every quoted name exists in the app texts', () => {
  QUOTED.forEach(q => assert.ok(appValues.toLowerCase().includes(q.toLowerCase()), 'not in the app: ' + q));
});
test('every quoted name is really used in the help (so the list stays honest)', () => {
  QUOTED.forEach(q => assert.ok(helpText().includes(q), 'not in the help: ' + q));
});

test('the help finds the Weekoverzicht (also by "pdf" or "afdrukken") and explains Back-up in Wijzigen', () => {
  assert.ok(ids('weekoverzicht').includes('rooster'));
  assert.ok(ids('pdf afdrukken').includes('rooster'));
  assert.ok(articles.find(a => a.id === 'rooster').body.join(' ').includes('Weekoverzicht'));
  assert.ok(ids('back-up invallen').some(id => articles.find(a => a.id === id).body.join(' ').includes('Back-up:')));
});

test('the back-up / terugzetten help is found by the coordinator and hidden from parents', () => {
  assert.equal(searchHelp('back-up terugzetten csv', { canEdit: true })[0].id, 'beheer-gezinnen');
  assert.equal(searchHelp('terugzetten csv excel', { canEdit: false }).some(a => a.id === 'beheer-gezinnen'), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
