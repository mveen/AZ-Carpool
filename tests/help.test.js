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
test('the Dagbericht article says the place of Heen and Terug follows the arrival of the cars (AFC \'34 or ATC)', () => {
  const art = articles.find(x => /Dagbericht/.test(allText(x)) && /Deel in de groep/.test(allText(x)));
  assert.ok(art, 'no article about the Dagbericht');
  assert.match(allText(art), /Wijdewormer/); assert.match(allText(art), /AFC '34 of ATC/);
});
test('the agenda article: how to add the calendar, how fast it updates, who may have the link, and no "new link"', () => {
  const art = articles.find(a => a.id === 'agenda');
  assert.ok(art, 'no agenda article'); assert.match(allText(art), /rechtsboven op je avatar en kies Agenda/);
  const all = allText(art);
  assert.match(all, /komende 3 weken/); assert.match(all, /alleen om te lezen/); assert.match(all, /Zet in mijn agenda/); assert.match(all, /Kopieer link/);
  assert.match(all, /Zet in Google Agenda/); assert.match(all, /ICSx⁵/); assert.match(all, /Via URL/); assert.match(all, /één keer in/); assert.match(all, /tot een dag/); assert.match(all, /Proton Calendar/); assert.match(all, /4 tot 16 uur/); assert.match(all, /Mijn week/); assert.match(all, /alleen met wie de ritten mag zien/);
  assert.match(all, /Er is geen knop om een nieuwe link te maken/);
  assert.match(all, /twee agenda's: Mijn agenda met alleen de ritten die jullie zelf rijden/); assert.match(all, /Deel met \(je dochter\)/); assert.match(all, /in Mijn agenda alleen als jullie in die carpool rijden/); assert.match(all, /In Mijn agenda staan ook de voornamen van de meisjes die jullie rijden/); assert.match(all, /alleen in als je dochter in de carpool van die wedstrijd is ingedeeld/);
  assert.ok(searchHelp('agenda', { canEdit: false }).some(a => a.id === 'agenda'));
  assert.ok(searchHelp('kalender iphone', { canEdit: false }).some(a => a.id === 'agenda'));
});
test('privacy and services say what the agenda link shows and where the file is', () => {
  const privacy = allText(articles.find(a => a.id === 'over-privacy')), services = allText(articles.find(a => a.id === 'over-diensten'));
  assert.match(privacy, /Agenda-link:.*voornaam van de dochter, tijden, plekken en naam van de chauffeur/); assert.match(privacy, /in Mijn agenda de voornamen van de meisjes die het gezin rijdt/); assert.match(privacy, /mijn\.host in Nederland/);
  assert.match(services, /Agenda van je dochter en Mijn agenda: twee agenda-bestanden per gezin/);
});
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
test('the onderhoudsmodus article is for the coordinator only and explains the steps', () => {
  assert.equal(findArticle('beheer-onderhoud', { canEdit: false }), null);
  const a = findArticle('beheer-onderhoud', { canEdit: true });
  assert.ok(a); const s = allText(a);
  ['Onderhoudsmodus', 'geen Opslaan-knop', 'niet beschikbaar'].forEach(w => assert.ok(s.includes(w), w));
  assert.ok(searchHelp('onderhoud', { canEdit: true }).some(x => x.id === 'beheer-onderhoud'));
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
  'Tijdelijk rooster maken', 'Alles opnieuw indelen', 'Opnieuw indelen', 'Bevestigen: voor elke week', 'Eenmalig wijzigen', 'Ander adres…', 'Plek toevoegen',
  'Rijdt niet mee', 'Weekoverzicht', 'Afdrukken / PDF', 'Deel in de groep', 'Ik neem deze rit over', 'Jouw rijbeurten', 'Stoppen', 'Auto toevoegen', 'Oefenwedstrijd', 'Terug naar standaard rooster', 'Ontkoppelen van deze dochter', 'Toegang aanvragen', 'Nu verversen'];
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

console.log('\n=== Over deze app ===');
const top = q => ids(q)[0];
const OVER = ['over-achtergrond', 'over-privacy', 'over-diensten', 'over-beheer'];
test('the four "Over deze app" articles exist, are for everyone, and form their own group', () => {
  OVER.forEach(id => { const a = findArticle(id); assert.ok(a, id); assert.equal(a.group, 'over'); assert.ok(!a.coordinatorOnly); });
  assert.deepEqual(articles.filter(a => a.group === 'over').map(a => a.id), OVER);
});
test('questions about privacy, who built the app, services and upkeep find the right article', () => {
  assert.equal(top('cookies'), 'over-privacy'); assert.equal(top('tracking'), 'over-privacy'); assert.equal(top('wie heeft de app gemaakt'), 'over-achtergrond');
  assert.equal(top('openrouteservice'), 'over-diensten'); assert.equal(top('waze navigatie'), 'over-diensten'); assert.equal(top('contributor'), 'over-beheer');
  assert.ok(ids('tests kwaliteit').includes('over-achtergrond')); assert.ok(ids('whatsapp').includes('over-diensten'));
});
test('the privacy text says what the app stores and what it does not do', () => {
  const s = allText(findArticle('over-privacy'));
  assert.match(s, /geen cookies/); assert.match(s, /geen tracking/); assert.match(s, /IP-adres/); assert.match(s, /Ouders: het telefoonnummer.*en de naam die je zelf invult/);
});
test('the privacy text covers the AVG/GDPR: controller, data, visibility, basis, location, retention, rights, reaction time, complaint', () => {
  const s = allText(findArticle('over-privacy'));
  [/AVG, in het Engels GDPR/, /Verantwoordelijk.*Michiel Veen.*coördinator/, /initiatief van ouders voor ouders.*geen onderdeel van de club/, /Dochters: alleen de voornaam, tenzij de ouder die zelf aanpast/, /rijtijden en beschikbaarheid/,
   /geen woonadressen, geboortedata of e-mailadressen/, /zichtbaar voor alle gebruikers/, /toestemming.*altijd intrekken/, /servers in de Europese Unie/, /gehost bij mijn\.host/,
   /Sentry of Hotjar/, /geen cookiebanner/, /OpenRouteService ontvangt alleen de adressen van de voetbalvelden/, /Google Agenda alleen het agenda-ID/,
   /security- en privacy-risico/, /tot je de carpool verlaat of om verwijdering vraagt/, /einde van het seizoen/, /inzien, laten aanpassen of laten verwijderen/,
   /gegevens van je dochter\(s\) verwijderd/, /binnen 3 dagen.*uiterlijk binnen een maand/, /Autoriteit Persoonsgegevens/].forEach(re => assert.match(s, re, String(re)));
  assert.ok(!/Er worden geen adressen/.test(s), 'the venues are stored, so only "geen woonadressen" is true');
});
test('searching AVG, GDPR, verwijderen or bewaartermijn finds the privacy article', () => {
  ['avg', 'gdpr', 'verwijderen', 'bewaartermijn', 'klacht autoriteit persoonsgegevens'].forEach(q => assert.ok(ids(q).includes('over-privacy'), q));
  assert.equal(top('avg'), 'over-privacy'); assert.equal(top('gdpr'), 'over-privacy');
});
test('the services article names every service the app loads (mijn.host, Google, OpenRouteService, WhatsApp)', () => {
  const s = allText(findArticle('over-diensten')); ['mijn.host', 'Google Firebase', 'OpenRouteService', 'WhatsApp'].forEach(x => assert.ok(s.includes(x), x));
});
test('the number of tests in "Over deze app" is the exact count from test-count.js (written by npm run lock)', async () => {
  const { TEST_COUNT } = await import('../test-count.js');
  assert.ok(Number.isInteger(TEST_COUNT) && TEST_COUNT > 0);
  assert.ok(allText(findArticle('over-achtergrond')).includes('Het gaat om ' + TEST_COUNT.toLocaleString('nl-NL') + ' automatische tests.'));
  assert.ok(!/meer dan \d+ automatische/.test(allText(findArticle('over-achtergrond'))), 'the count is exact, not "meer dan"');
});
test('test-count.js is cached by the service worker (the help imports it, so it must work offline too)', () => {
  assert.match(fs.readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8'), /'\.\/test-count\.js'/);
});
test('the privacy text does not claim fonts come from Google (they are served from the app itself)', () => {
  assert.ok(!/lettertype/i.test(allText(findArticle('over-privacy'))));
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(html));
});

test('help explains the notice bar to everyone and the switch to the coordinator only', () => {
  assert.ok(searchHelp('gele balk', { canEdit: false }).some(a => a.id === 'melding-balk'));
  assert.ok(!searchHelp('melding aan uit zetten', { canEdit: false }).some(a => a.id === 'beheer-melding'));
  assert.ok(searchHelp('melding aan uit zetten', { canEdit: true }).some(a => a.id === 'beheer-melding'));
});

test('help explains the period back-up to the coordinator only', () => {
  assert.ok(searchHelp('back-up periode terugzetten testen', { canEdit: true }).some(a => a.id === 'periode-backup'));
  assert.ok(!searchHelp('back-up periode terugzetten testen', { canEdit: false }).some(a => a.id === 'periode-backup'));
  const a = findArticle('periode-backup', { canEdit: true });
  assert.match(a.body.join(' '), /Back-up maken/); assert.match(a.body.join(' '), /gaat dat verloren/); assert.match(a.body.join(' '), /Automatisch/);
});

test('help tells the coordinator about the progress bar and the "Wie heeft ingevuld?" list', () => {
  const a = articles.find(x => x.body.some(l => l.includes('Wie heeft ingevuld?')));
  assert.ok(a && a.coordinatorOnly, 'in a coordinator-only article');
  assert.ok(a.body.some(l => l.includes('voortgangsbalk')));
});

test('the Beheer article explains the planning order: back-ups last, then cars, rank, wait, wishes', () => {
  const a = articles.find(x => x.id === 'beheer-instellingen');
  const s = a.body.join(' ');
  assert.ok(/back-up/.test(s) && /Selectievolgorde/.test(s) && /Een grotere auto krijgt nooit voorrang op tijd/.test(s));
});

test('the pickup-place article explains that every car has its own place and arrival in the Vast rooster', () => {
  const a = articles.find(x => x.id === 'ophaalplek');
  assert.match(a.body.join(' '), /elke auto[\s\S]*alleen die auto/);
});

test('the Ritbeurs has a parent article and a coordinator article that explains the switch stops all notifications', () => {
  const a = articles.find(x => x.id === 'ritbeurs'), b = articles.find(x => x.id === 'beheer-ritbeurs');
  assert.ok(a && !a.coordinatorOnly); assert.match(a.body.join(' '), /Ik neem deze rit over[\s\S]*eerste bevestigt[\s\S]*18:00/);
  assert.ok(b && b.coordinatorOnly); assert.match(b.body.join(' '), /direct geen meldingen meer/);
  assert.match(a.title + b.title, /Ritten ruilen/); assert.doesNotMatch([a, b].map(x => x.title + x.body.join(' ')).join(' '), /Ritbeurs/, 'the screen name is Ritten ruilen everywhere');
});

test('the Afwijkend weekrooster has a coordinator-only Beheer article that explains uit, test and aan', () => {
  const b = articles.find(x => x.id === 'beheer-weekrooster');
  assert.ok(b && b.coordinatorOnly && b.tab === 'beheer'); const s = b.body.join(' ');
  assert.match(s, /Uit[\s\S]*precies als voorheen[\s\S]*Test[\s\S]*alleen jij[\s\S]*Aan[\s\S]*iedereen/); assert.match(s, /database-regels/); assert.match(s, /Bestaande gegevens blijven ongemoeid/);
  assert.doesNotMatch(s, /reden/i, 'no reason is ever asked or stored');
});

test('the push messages: a parent article (how to switch on, per phone, iPhone, quiet hours), the Beheer article (default off, count, testing always works) and the privacy and services articles', () => {
  const a = findArticle('push-meldingen'), ritb = allText(findArticle('ritbeurs')), beheer = allText(findArticle('beheer-ritbeurs', { canEdit: true }));
  assert.ok(a && !a.coordinatorOnly); const t = allText(a);
  assert.match(t, /rechtsboven op je avatar, kies Push-meldingen en zet Meldingen op deze telefoon aan/); assert.match(t, /per telefoon/); assert.match(t, /beginscherm/); assert.match(t, /22:00 tot 06:00/); assert.match(t, /Zie je Push-meldingen niet in Instellingen\? Dan staan ze uit/);
  assert.ok(top('push meldingen telefoon') === 'push-meldingen' || ids('push meldingen telefoon').includes('push-meldingen')); assert.ok(ids('pushmelding').includes('push-meldingen'));
  assert.match(ritb, /Heb je Push-meldingen aangezet \(zie Instellingen\)/);
  assert.match(beheer, /twee schakelaars/); assert.match(beheer, /Push-meldingen aan, staat standaard uit/); assert.match(beheer, /hoeveel gezinnen een telefoon hebben aangemeld/); assert.match(beheer, /Testen kan altijd, ook als Push-meldingen uit staan/);
  const privacy = allText(findArticle('over-privacy')), services = allText(findArticle('over-diensten'));
  assert.match(privacy, /Push-meldingen: alleen als je die zelf aanzet, bewaart de app het push-adres van jouw telefoon/); assert.match(privacy, /Google \(Chrome en Android\), Mozilla \(Firefox\) of Apple \(Safari op iPhone\)/); assert.match(privacy, /inhoud is versleuteld/); assert.match(privacy, /verwijdert de app het adres/);
  assert.match(privacy, /op één uitzondering na: het push-adres/); assert.match(services, /Push-meldingen: alleen bij Ritten ruilen en alleen als je ze zelf aanzet/);
  assert.doesNotMatch([a, findArticle('ritbeurs'), findArticle('beheer-ritbeurs', { canEdit: true })].map(x => allText(x)).join(' '), /Ritbeurs/, 'the screen name is Ritten ruilen everywhere');
});
test('help explains the avatar choice, Ik rij ook, Gereden shifts and the impact preview', () => {
  assert.equal(top('avatar kiezen'), 'avatar'); assert.ok(!findArticle('avatar').coordinatorOnly);
  assert.match(allText(findArticle('wedstrijden')), /Ik rij ook[\s\S]*Mijn auto weghalen/);
  ['Alle shifts bekijken', 'Verwijder shift', 'Terugzetten', 'Export'].forEach(w => assert.ok(allText(findArticle('beheer-gereden-shifts', { canEdit: true })).includes(w), w));
  assert.equal(findArticle('beheer-gereden-shifts', { canEdit: false }), null); assert.equal(findArticle('beheer-impact', { canEdit: false }), null);
  assert.match(allText(findArticle('beheer-impact', { canEdit: true })), /Impact-preview \(pilot\)/);
  assert.match(allText(findArticle('wat-is')), /Instellingen/);
});
test('the avatar article quotes names that exist in the app', () => {
  ['Initialen', 'Ongedaan', 'Avatar wijzigen'].forEach(q => assert.ok(Object.values(nl).includes(q), q));
});

test('help reflects the server jobs, the new host and the "Aanwezig om" texts', () => {
  assert.match(allText(findArticle('mijn-week')), /gele pil "Gewijzigd"/); assert.match(allText(findArticle('mijn-week')), /telefoon-icoon/); assert.match(allText(articles.find(x => x.id === 'beheer-weekrooster')), /standaard dicht/);
  assert.match(allText(findArticle('mijn-week')), /aanwezig om/); assert.ok(Object.values(nl).includes('{name} aanwezig om'));
  assert.match(allText(findArticle('over-privacy')), /mijn\.host[\s\S]*Back-ups[\s\S]*30 dagen/);
  assert.match(allText(findArticle('over-diensten')), /Opschonen[\s\S]*vrijdag kort na 19:00/);
  assert.match(allText(findArticle('wijzigen')), /Op vrijdag om 19:00 zijn alle wijzigingen vanzelf weer weg/);
  assert.match(allText(findArticle('beheer-kalenders', { canEdit: true })), /elke ochtend vroeg/);
  assert.doesNotMatch(allText(findArticle('over-privacy')) + allText(findArticle('over-diensten')), /GitHub/);
});

test('help explains how to add a practice match and where a car leaves from', () => {
  assert.equal(top('oefenwedstrijd toevoegen'), 'oefenwedstrijd'); assert.equal(top('hoe voeg ik een oefenwedstrijd toe'), 'oefenwedstrijd');
  const o = allText(findArticle('oefenwedstrijd'));
  assert.match(o, /Iedereen kan dat/); assert.match(o, /Thuis of Uit/); assert.match(o, /Ongedaan/); assert.match(o, /geen melding/);
  assert.equal(findArticle('oefenwedstrijd').tab, 'matches'); assert.ok(!findArticle('oefenwedstrijd').coordinatorOnly);
  assert.match(allText(findArticle('wedstrijden')), /Vertrek vanaf staat standaard op het busstation/);
});
test('Help explains "Eigen ouder rijdt mee" (terug, hard rule, only when the parent drives) and that it goes before the wishes', () => {
  const a = articles.find(x => x.id === 'beheer-instellingen');
  assert.ok(a.coordinatorOnly);
  const s = allText(a);
  assert.match(s, /Eigen ouder rijdt mee kies je een gezin waarvan de dochter bij de terugrit altijd in de auto van haar eigen ouder zit als die ouder rijdt/);
  assert.match(s, /Rijdt die ouder niet, dan plant de app gewoon vrij/);
  assert.match(s, /geen wens maar een vaste regel en gaat voor al het andere/);
  assert.match(s, /zelf een andere auto kiezen kan altijd[\s\S]*maar houdt je niet tegen/);
  assert.match(a.keywords, /eigen ouder/);
});

test('the Afwijkend weekrooster article explains what Test shows and that day-by-day changing is hidden while it is on', () => {
  const a = articles.find(x => x.id === 'beheer-weekrooster'); assert.ok(a);
  const s = JSON.stringify(a.body || a);
  assert.match(s, /Tijden wijzigen/); assert.match(s, /Volgende week/); assert.match(s, /verborgen/);
});

test('the Afwijkend weekrooster article tells a day coordinator what he sees (action card, Recente wijzigingen, dot, number)', () => {
  const s = JSON.stringify(articles.find(x => x.id === 'beheer-weekrooster'));
  assert.match(s, /Actie nodig/); assert.match(s, /Recente wijzigingen/); assert.match(s, /stip/);
});

test('the Afwijkend weekrooster article explains the advice: variants, the reason, Overnemen, Ongedaan, Dagbericht', () => {
  const s = JSON.stringify(articles.find(x => x.id === 'beheer-weekrooster'));
  assert.match(s, /Zuinigst/); assert.match(s, /Minste gedoe/); assert.match(s, /Overnemen/); assert.match(s, /Ongedaan/); assert.match(s, /Dagbericht/);
  assert.doesNotMatch(s, /Overnemen volgt/);
});

test('the Afwijkend weekrooster article explains Zelf indelen, Toch zelf wijzigen with the warning and Zelf gewijzigd', () => {
  const s = JSON.stringify(articles.find(x => x.id === 'beheer-weekrooster'));
  assert.match(s, /Zelf indelen/); assert.match(s, /Toch zelf wijzigen/); assert.match(s, /waarschuwing/); assert.match(s, /Zelf gewijzigd/);
});

test('the privacy item tells that the phone keeps a copy of the carpool data for speed, and that Opnieuw beginnen wipes it', () => {
  const s = JSON.stringify(articles.find(x => /privacy/.test(x.id)) || {});
  assert.match(s, /een kopie van de carpoolgegevens, zodat de app sneller opent/); assert.match(s, /Opnieuw beginnen.{1,6} wist die kopie/); assert.match(s, /geen cookiebanner/);
});
console.log('\n=== Tijd en plek van de chauffeur ===');
test('there is an article for drivers, found by the words a driver would use, and Mijn week points to the button', () => {
  const a = articles.find(x => x.id === 'chauffeur-tijd-plek');
  assert.ok(a); assert.equal(a.tab, 'myweek'); assert.ok(!a.coordinatorOnly);
  assert.match(a.body.join(' '), /Tijd en plek/); assert.match(a.body.join(' '), /Ongedaan/); assert.match(a.body.join(' '), /Weer automatisch berekenen/);
  assert.equal(searchHelp('ik wil later vertrekken met mijn auto', { canEdit: false })[0].id, 'chauffeur-tijd-plek');
  assert.match(articles.find(x => x.id === 'mijn-week').body.join(' '), /knop Tijd en plek/);
});
test('the Help tells where an open request shows in Mijn week: in the card of its day, with Intrekken',() => { const all = JSON.stringify(articles); assert.match(all, /gestippeld geel blok/); assert.match(all, /klaar om/); });
test('the Help explains the child time and the trash in Wijzigen', () => {
  const all = JSON.stringify(articles);
  assert.ok(all.includes('aanwezig om') && all.includes('klaar om') && all.includes('prullenbak'));
});

test('Rooster help explains the time per girl, "was", the warning and the one fold for Rijdt niet mee and Back-up', () => {
  const r = allText(findArticle('rooster'));
  assert.ok(r.includes('eigen tijd') && r.includes('"was"') && r.includes('gele waarschuwing'));
  assert.ok(r.includes('knop Zelf indelen') && r.includes('regel Dagcoördinator')); assert.ok(r.includes('Rijdt niet mee en Back-up') && r.includes('Tik erop om de namen te zien'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
