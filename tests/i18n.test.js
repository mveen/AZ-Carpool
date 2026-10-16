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
  assert.equal(t('wa.my.header', { name: 'Eline' }), 'Carpool deze week – Eline:');
});
test('a placeholder without a value is left visible, not replaced by "undefined"', () => {
  assert.equal(t('wa.my.header'), 'Carpool deze week – {name}:');
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
    assert.equal(t('wa.dir.heen'), 'heen', 'missing key falls back to Dutch');
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

test('the agenda texts exist and fill their placeholders (card in Profiel and the .ics file)', () => {
  assert.equal(t('agenda.kaart_titel'), 'Agenda'); assert.equal(t('agenda.toevoegen'), 'Zet in mijn agenda'); assert.equal(t('agenda.kopieer'), 'Kopieer link');
  assert.match(t('agenda.kaart_uitleg', { name: 'Noor' }), /ritten van Noor voor de komende 3 weken/);
  assert.equal(t('agenda.titel_rit', { dir: 'Heen', route: "Busstation → AFC '34" }), "Carpool Heen: Busstation → AFC '34");
  assert.equal(t('agenda.chauffeur', { name: 'Piet' }), 'Chauffeur: Piet'); assert.equal(t('agenda.aanwezig', { time: '08:30' }), 'Aanwezig om 08:30');
  assert.equal(t('agenda.klaar', { time: '17:00' }), 'Klaar om 17:00'); assert.equal(t('agenda.kalendernaam', { name: 'Noor' }), 'Carpool Noor');
  assert.equal(t('agenda.titel_wedstrijd', { match: 'A - B' }), 'Wedstrijd: A - B'); assert.equal(t('agenda.aftrap', { time: '14:30' }), 'Aftrap 14:30');
});
test('the texts of the shell, the contact sheet and the ride rows exist and fill their placeholders', () => {
  assert.equal(t('shell.theme_light'), 'Licht'); assert.equal(t('contact.parent_of', { name: 'Noor' }), 'Ouder van Noor');
  assert.equal(t('myweek.rijdt_niet_mee', { name: 'Noor' }), 'Noor rijdt niet mee'); assert.equal(t('myweek.daughter_heen'), 'Aanwezig om'); assert.equal(t('myweek.daughter_terug'), 'Aanwezig om');
  assert.equal(t('myweek.match_cars', { n: 2 }), "2 auto's gepland"); assert.equal(t('schedule.sub_heen', { name: 'Noor', time: '17:00' }), 'Noor aanwezig 17:00');
  assert.equal(t('schedule.sub_terug', { name: 'Noor', time: '19:15' }), 'Noor aanwezig 19:15'); assert.equal(t('schedule.reserve'), 'Back-up:');
});
test('the texts of the settings sheet and the Mijn gezin drill-down exist', () => {
  assert.equal(t('agenda.toevoegen_google'), 'Zet in Google Agenda'); assert.match(t('agenda.android_uitleg'), /Android.*ICSx⁵/); assert.equal(t('shell.view_as'), 'Bekijk als'); assert.equal(t('shell.view_parent'), 'Ouder'); assert.equal(t('shell.view_coord'), 'Coördinator');
  assert.equal(t('shell.parent_of', { name: 'Noor' }), 'Ouder van Noor'); assert.equal(t('shell.saved_instantly'), 'Wordt direct opgeslagen');
  assert.equal(t('profile.plekken_in_je_auto'), 'Plekken in je auto'); assert.equal(t('profile.kan_jij_deze_dag_rijden'), 'Kun je zelf rijden?');
});
test('the texts of the design-v2 audit exist: Dagbericht, passenger flow, toasts, Niet ingedeeld', () => {
  assert.equal(t('conclusie.title', { dayLabel: 'Woensdag' }), 'Dagbericht Woensdag'); assert.equal(t('conclusie.button'), 'Deel in de groep');
  assert.equal(t('deviation.passagier_toevoegen'), '+ Passagier toevoegen'); assert.equal(t('deviation.auto_is_vol'), 'Auto is vol');
  assert.equal(t('deviation.toast_vertrektijd'), 'Vertrektijd opgeslagen'); assert.equal(t('schedule.niet_ingedeeld_box'), 'Niet ingedeeld:'); assert.equal(t('flex.chip'), 'flex');
  assert.equal(t('profile.stop_testen'), 'Stoppen'); assert.equal(t('maint.banner'), 'Onderhoudsmodus staat aan. Ouders zien de app nu niet.');
});
test('the texts of the group-2 audit exist: share sheet, shift tools', () => {
  assert.equal(t('shell.share_title'), 'Mijn week delen'); assert.equal(t('shell.share_button'), 'Delen');
  assert.equal(t('schedule.opnieuw_indelen'), 'Opnieuw indelen'); assert.equal(t('schedule.ophalen'), 'Ophalen:');
  assert.equal(t('schedule.vaste_plek', { dir: 'heen', name: 'De Parel' }), 'Vaste plek heen: De Parel'); assert.equal(t('schedule.opnieuw_ingedeeld', { n: 2 }), "Opnieuw ingedeeld: 2 auto('s)");
});
test('navigation order is Mijn week, Rooster, Wijzigen, Wedstrijden, Beheer (+ the hidden Mijn gezin route), and Mijn week starts open', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const nav = html.slice(html.indexOf('<nav id="bottomnav"'), html.indexOf('</nav>'));
  assert.deepEqual([...nav.matchAll(/data-tab="(\w+)"/g)].map(m => m[1]), ['myweek', 'schedule', 'deviation', 'matches', 'beheer', 'profile']);
  assert.match(nav, /data-tab="profile" class="navtab" hidden/);   // Mijn gezin opens from the avatar, not from a tab
  assert.equal(t('nav.matches'), 'Wedstrijden'); assert.equal(t('nav.matches_short'), 'Wedstrijd');   // five tabs (coordinator): the short label
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
  assert.equal(t('period.err.overlap', { p1: 'Herfstvakantie' }), 'Deze periode overlapt met Herfstvakantie. Perioden mogen geen dag delen.');
  assert.equal(t('period.delete.confirmData', { p1: 9 }), 'Zeker? 9 gezinnen verliezen hun tijden'); assert.equal(t('period.list.edit', { p1: 'Toetsweek' }), 'Wijzig Toetsweek');
  assert.deepEqual(['add', 'list.roosterMade', 'form.addTitle', 'form.editTitle', 'view.pick', 'err.deleteRooster', 'err.firstDayLocked', 'firstDayLockedHint'].map(k => hasKey('period.' + k)), Array(8).fill(true));
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
  assert.equal(t('dist.unknown'), 'locatie onbekend');
  assert.equal(t('dist.km', { km: '42,3' }), '± 42,3 km enkele reis');
  assert.equal(t('ov.switchLabel', { p1: 'Heen', p2: 'Donderdag' }), 'Rijdt mee Heen Donderdag'); assert.equal(t('wa.my.ov'), 'rijdt niet mee');
  assert.ok(hasKey('loc.beheerTitle') && hasKey('geo.route') && hasKey('impact.beheerIntro'));
});

test('the texts of the Weekoverzicht and of the Wijzigen Back-up / Stem af exist', () => {
  assert.equal(t('overview.standaardrit', { km: '55', eur: '€11,-', km2: '110', eur2: '€22,-', ct: 20 }), 'Standaardrit = 55 km (€11,-); heen & weer = 110 km (€22,-) (20ct/km)');
  assert.equal(t('overview.vertrektijden', { heen: 'Busstation', terug: "AFC '34" }), "Vertrektijden heen: Busstation, terug: AFC '34");
  assert.equal(t('oneOnOne.button', { name: 'Kees' }), 'Stem af met chauffeur Kees');
  assert.equal(t('deviation.backup'), 'Back-up:');
  assert.ok(hasKey('overview.print') && hasKey('overview.reserve') && hasKey('overview.rijfrequentie'));
});

test('the notice texts exist and the WhatsApp intro texts are still there', () => {
  for (const k of ['notice.title', 'notice.save', 'notice.err.noText', 'profile.wa_intro_text', 'profile.tel_nr_1_wa', 'backup.title']) assert.ok(hasKey(k), k);
});

test('the period back-up texts exist and fill in their numbers', () => {
  assert.equal(t('period.backup.title', { p1: 3 }), 'Back-ups (3)');
  assert.equal(t('period.backup.restoreConfirmLost', { p1: 2 }), 'Zeker? 2 gezinnen verliezen wat ze sindsdien doorgaven');
  assert.equal(t('period.delete.confirmDataBackups', { p1: 4, p2: 2 }), 'Zeker? 4 gezinnen verliezen hun tijden en 2 back-ups gaan weg');
  ['made', 'deleted', 'restored', 'make', 'restore', 'delete', 'same', 'sincePeriod', 'err.full', 'err.broken'].forEach(k => assert.ok(hasKey('period.backup.' + k), k));
});


test('the Wijzigen ride card texts exist and the arrival names ATC', () => {
  assert.equal(t('app.route'), 'app.route'); assert.equal(t('shell.app_name'), 'AZ Carpool'); assert.equal(t('shell.context_gezin'), 'AZ Carpool');
  assert.equal(t('period.form.heen'), 'Heen: aankomsttijd'); assert.equal(t('profile.heen_aankomst_nodig'), 'Heen: aankomsttijd'); assert.equal(t('profile.sub_heen'), 'Aankomsttijd');
  assert.equal(t('wa.conclusie.place', { entries: 'heen Jan ATC' }), 'Andere aankomstplek: heen Jan ATC');
  assert.equal(t('dir.heen'), 'dir.heen'); assert.equal(t('dir.terug'), 'dir.terug');   // the fixed wordings are gone: the place comes from the rides
  assert.equal(t('schedule.aankomst_nodig', { city: 'Wijdewormer', p1: '08:30' }), 'Aankomst Wijdewormer nodig: 08:30');
  assert.equal(t('flex.timeHeen', { city: 'Alkmaar / Wijdewormer' }), 'Aankomst in Alkmaar / Wijdewormer');
  assert.equal(t('wa.day.carTo', { time: '13:30', driver: 'Jan', dest: 'ATC', girls: 'Saar' }), '• 13:30 – Jan (ATC): Saar');
  assert.equal(t('dir.heenTo', { city: 'Wijdewormer' }), 'Heen · Aalsmeer → Wijdewormer');
  assert.equal(t('dir.terugFrom', { city: 'Wijdewormer' }), 'Terug · Wijdewormer → Aalsmeer');
  assert.deepEqual(['wijzig', 'klaar', 'ophalen', 'aankomst', 'kinderen', 'opties', 'verwijder', 'ongedaan'].map(k => hasKey('deviation.' + k)), Array(8).fill(true));
  assert.equal(t('deviation.naar_auto', { name: 'Kees' }), 'Naar Kees');
  assert.equal(t('loc.freeOption'), 'Ander adres…');
});

test('the Selectievolgorde label for a back-up driver exists', () => { assert.equal(t('beheer.pl_back_up'), 'pl., back-up)'); assert.equal(t('beheer.pl'), 'pl.)'); });

test('the place texts of the standaardrooster speak of one car, not of a whole shift', () => {
  assert.equal(t('loc.shiftTitle'), 'Standaardplek van deze auto'); assert.equal(t('loc.arrivalItem', { name: 'ATC' }), 'Aankomst: ATC');
  assert.match(t('loc.shiftSub', { p1: 'Heen', p2: 'Maandag' }), /alleen voor deze auto/);
});

test('the Beheer chips, section titles and attention texts', () => {
  assert.deepEqual(['gezinnen', 'periodes', 'berichten', 'koppelingen'].map(k => t('beheer.chip_' + k)), ['Gezinnen', 'Planning', 'Berichten', 'Koppelingen']);
  assert.equal(t('beheer.sec_koppelingen'), 'Koppelingen'); assert.equal(t('beheer.sec_periodes'), 'Planning'); assert.equal(t('beheer.sec_gezinnen'), 'Gezinnen');   // design v2 names assert.equal(t('beheer.attn_titel', { p1: 3 }), 'Om te checken (3)');
  assert.equal(t('beheer.attn_dubbel', { p1: 'Sanne', p2: 2 }), 'Dubbel gezin: Sanne (2×)');
});

test('the Gereden shifts texts exist and fill their numbers', () => {
  assert.equal(t('ridelog.title'), 'Gereden shifts');
  assert.equal(t('ridelog.summary', { p1: 12, p2: '2,4', p3: 0, p4: 5 }), '12 shifts gereden · gemiddeld 2,4 per gezin · minst 0, meest 5');
  assert.equal(t('ridelog.export_year', { p1: 2026 }), 'Export 2026 (CSV)'); assert.equal(t('ridelog.idle', { p1: 3 }), '3 gezinnen nog niet gereden');
});

test('the texts of the Gereden shifts screens', () => {
  assert.equal(t('ridelog.family_summary', { p1: 5, p2: 2, p3: 3 }), '5 shifts · 2 heen · 3 terug');
  assert.match(t('ridelog.remove_text', { p1: 'Saar', p2: 5, p3: 4, p4: 'oktober 2026' }), /^Saar gaat daarna van 5 naar 4 shifts in oktober 2026\./);
  assert.equal(t('ridelog.removed_head', { p1: 1 }), 'Verwijderd (1)'); assert.equal(t('ridelog.girls', { p1: 3 }), '3 meiden');
});

test('the Ritbeurs texts exist and fill their placeholders (no place buttons any more)', () => {
  assert.equal(hasKey('ritbeurs.place.alkmaar'), false); assert.equal(hasKey('ritbeurs.moment.plaats'), false);
  assert.equal(t('ritbeurs.seg.ritbeurs'), 'Ritten ruilen'); assert.equal(t('ritbeurs.title'), 'Ritten ruilen'); assert.equal(t('ritbeurs.urg.soon'), 'Vóór 18:00 regelen'); assert.equal(t('ritbeurs.urg.late'), 'Deadline voorbij');
  assert.equal(t('ritbeurs.toast.aangebodenBackups', { n: 2 }), 'Rit aangeboden. 2 back-up(s) gewaarschuwd.');
  assert.equal(t('ritbeurs.warn.zitplaatsen', { need: 3, have: 2 }), 'Let op: er zitten 3 kinderen in deze auto en jij hebt 2 plaatsen.');
  assert.match(t('ritbeurs.confirm.regel3'), /Overnemen is definitief/);
  assert.match(t('ritbeurs.saved.off'), /Alle meldingen zijn gestopt/);
  assert.doesNotMatch(Object.entries({ a: t('ritbeurs.form.stappen'), b: t('ritbeurs.moment.intro'), c: t('ritbeurs.notif.offerBackupBody') }).map(x => x[1]).join(' '), /alle chauffeurs|in de buurt/i);
  assert.equal(t('loc.periodTitle'), 'Plek van deze auto in het tijdelijke rooster');
  assert.equal(t('period.view.depTime',{p1:2}), 'Vertrektijd auto 2');
  assert.equal(t('period.view.overruledClear'), 'Eenmalige wijziging verwijderen');
});

import { assertNoDuplicateKeys } from './test-support.js';
test('texts-nl.js defines every key once', () => assertNoDuplicateKeys('texts-nl.js'));

test('the push test texts exist and fill their placeholders', () => {
  assert.equal(t('push.title'), 'Meldingen testen'); assert.equal(t('push.ouderVan', { name: 'Saar' }), 'Ouder van Saar'); assert.equal(t('push.test.titel', { who: 'Ouder van Saar' }), 'Test · Ouder van Saar');
  assert.equal(t('push.server.detail', { ago: '2 min geleden', sent: 3, pending: 1 }), 'Laatste keer 2 min geleden · 3 verstuurd · 1 wachtend');
  assert.equal(t('push.preview.state.wacht', { time: '06:00' }), 'Wacht op stille uren, bezorgd om 06:00'); assert.equal(t('push.toestel.label', { browser: 'Chrome', os: 'Android' }), 'Chrome op Android');
  assert.equal(t('push.ago.min', { n: 5 }), '5 min geleden'); assert.equal(t('push.ago.uur', { n: 2 }), '2 uur geleden'); assert.equal(t('push.preview.title', { who: 'Ouder van Saar' }), 'Zo ziet Ouder van Saar het');
});
test('every state the push screen can be in has a text', () => {
  for (const k of ['push.server.ok', 'push.server.stil', 'push.server.onbekend', 'push.preview.state.bezorgd', 'push.preview.state.verlopen', 'push.preview.push.verstuurd', 'push.preview.push.wachtrij', 'push.preview.push.geen',
    'push.preview.bron.test', 'push.preview.bron.echt', 'push.wie.echt', 'push.wie.gekozen', 'push.wie.reden.ok', 'push.wie.reden.niet-gedekt', 'push.wie.reden.eigen-rit', 'push.wie.reden.bezig', 'push.wie.reden.dubbel',
    'push.hint.serverStil', 'push.err.geenSleutel', 'push.err.ongeldig', 'push.err.timeout', 'push.err.alleenCoordinator', 'push.err.kiesGezin', 'push.err.geenAnder', 'push.err.zetTestAan', 'push.err.meldingWeg', 'push.scen.rijVrij', 'push.scen.overgenomen', 'push.scen.backup', 'push.scen.nietGedekt', 'push.scen.dagcoordinator']) assert.ok(hasKey(k), k);
});

test('the home-screen sheet has all its texts (iOS steps, Firefox steps, buttons)', () => {
  for (const k of ['title', 'sub', 'sub_native', 'stap1', 'stap2', 'stap3', 'ff_stap1', 'ff_stap2', 'later', 'begrepen']) {
    assert.ok(hasKey('installprompt.' + k), k); assert.notEqual(t('installprompt.' + k), '');
  }
});

test('the Firefox menu step is short enough for one line', () => { assert.equal(t('installprompt.ff_stap1'), 'Tik op het menu (drie puntjes)'); });

test('the gate texts for a broken session, no connection and the reset button exist (and do not blame the phone number)', () => {
  assert.match(t('profile.sessie_probleem'), /Opnieuw beginnen/); assert.doesNotMatch(t('profile.sessie_probleem'), /telefoonnummer/);
  assert.match(t('profile.geen_verbinding_probeer_opnieuw'), /Geen verbinding/);
  assert.equal(t('profile.even_opnieuw_verbinden'), 'Even opnieuw verbinden…');
  assert.match(t('profile.probleem_met_inloggen_opnieuw_beginnen'), /Opnieuw beginnen/);
});
test('the Beheer texts for the error log exist and promise the 30 days', () => {
  assert.equal(t('beheer.fouten_titel'), 'Gemelde problemen'); assert.match(t('beheer.fouten_uitleg'), /30 dagen/);
  assert.equal(t('beheer.attn_problemen', { p1: 3 }), '3 problemen gemeld in de afgelopen 24 uur');
  assert.equal(t('beheer.fouten_meer', { p1: 4 }), 'En nog 4 oudere meldingen.');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
test('the removed shift map-button texts are gone', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(nl, 'loc.mapButton'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(nl, 'loc.mapLabel'), false);
});

test('the onderhoudsmodus texts exist', () => {
  for (const k of ['maint.title', 'maint.show', 'maint.autosave', 'maint.banner', 'maint.page.title', 'maint.page.default', 'maint.page.auto', 'maint.saved.on', 'maint.saved.off']) assert.ok(nl[k], k);
});

test('the daughter-picker texts are gone; the coordinator-without-family text exists', () => {
  for (const k of ['profile.welkom_selecteer_je_dochter_om', 'profile.mijn_dochter', 'profile.dit_is_mijn_dochter', 'profile.er_zijn_nog_geen_gezinnen', 'profile.gekoppeld', 'profile.koppelen_mislukt'])
    assert.equal(Object.prototype.hasOwnProperty.call(nl, k), false, k);
  assert.match(t('profile.coordinator_zonder_gezin'), /geen eigen gezin/);
});

test('the not-linked status line points to the gate (phone number + code), not to a picker', () => {
  assert.match(t('common.nog_niet_gekoppeld_ga_naar'), /telefoonnummer en code/);
  assert.doesNotMatch(t('common.nog_niet_gekoppeld_ga_naar'), /Mijn gezin/);
});

test('WhatsApp login intro texts start with "Hi!" and carry the app link', () => {
  assert.match(t('profile.wa_intro_text', { url: 'U', code: 'C' }), /^Hi! .*U[\s\S]*C/);
  assert.match(t('profile.wa_intro_text_nocode', { url: 'U' }), /^Hi! /);
  assert.equal(t('profile.tel_nr_1_wa'), 'Tel.nr. 1 (ontvangt WhatsApp-berichtjes)');
});

test('the period list texts: phase pills, who has handed in, and the capitalised rooster line', () => {
  assert.deepEqual(['waiting', 'open', 'closed', 'over'].map(k => t('period.pill.' + k)), ['Gepland', 'Open', 'Deadline voorbij', 'Afgelopen']);
  assert.equal(t('period.who.missing', { p1: 'Emma, Sanne' }), 'Nog niet: Emma, Sanne'); assert.equal(t('period.who.more', { p1: 3 }), '+3');
  assert.equal(t('period.who.todo', { p1: 2 }), 'Nog niet doorgegeven (2)'); assert.equal(t('period.who.done', { p1: 6 }), 'Doorgegeven (6)');
  assert.equal(t('period.list.roosterMade'), 'Tijdelijk rooster gemaakt'); assert.equal(t('period.form.groupFill'), 'Invullen door ouders');
});
test('Wedstrijden intro and quick-car texts follow the design', () => {
  assert.equal(t('matches.titel'), 'Wedstrijden van de komende 4 weken.');
  assert.equal(t('deviation.zet_een_carpool_op_voor'), 'Een carpool kun je in de komende 8 dagen regelen.');
  assert.equal(t('matches.ik_rij_ook'), 'Ik rij ook'); assert.equal(t('matches.auto_wijzigen', { driver: 'Jan' }), 'Carpool van Jan wijzigen');
});
test('the avatar texts exist, one label per library icon', () => {
  assert.equal(t('avatar.title'), 'Kies je avatar'); assert.equal(t('avatar.initials'), 'Initialen');
  for (const id of ['user','car','steering-wheel','road-horizon','soccer-ball','trophy','medal','megaphone','users-three','handshake']) assert.notEqual(t('avatar.l.' + id), 'avatar.l.' + id, id);
});
test('the family-type buttons use short labels', () => {
  assert.equal(t('profile.gezinstype.vast'), 'Vast (volgens schema)');
  assert.equal(t('profile.gezinstype.flex'), 'Flex (zelf plannen)');
});
test('the texts about one-off changes say they disappear on Friday at 19:00', () => {
  assert.match(t('deviation.eenmalige_ritaanpassing_voor_deze_week'), /elke vrijdag om 19:00/);
  assert.match(t('deviation.deze_week_en_verdwijnen_dit'), /vrijdag om 19:00/);
  assert.doesNotMatch(t('deviation.deze_week_en_verdwijnen_dit') + t('deviation.eenmalige_ritaanpassing_voor_deze_week'), /weekend/);
});
test('the agenda update text names Proton and points to Mijn week', () => {
  assert.match(t('agenda.bijwerken'), /Google of Proton/); assert.match(t('agenda.bijwerken'), /Mijn week/);
});
test('the connection error asks to check the internet and has a retry label, without developer talk about the Firebase config', () => {
  assert.match(t('common.kan_geen_verbinding_maken_met'), /internetverbinding/); assert.doesNotMatch(t('common.kan_geen_verbinding_maken_met'), /Firebase/);
  assert.equal(t('common.opnieuw_proberen'), 'Opnieuw proberen');
});
