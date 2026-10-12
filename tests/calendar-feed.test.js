// Run with: node calendar-feed.test.js
// calendar-feed.js: the calendar subscription of one family. The rides must be exactly the ones Mijn week shows (same rooster code),
// for 3 weeks, in Amsterdam time whatever the computer's time zone is, and the .ics text must be valid.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, sampleCoordinatorState, sampleFamilies } from './test-support.js';
import { S } from '../state.js';
import {
  FEED_WEEKS, TOKEN_RE, amsterdamClock, amsterdamDate, amsterdamToMs, buildIcs, feedEvents, feedWeekKeys, newCalendarToken,
} from '../calendar-feed.js';

installFakeDom();
const NOW = new Date('2026-09-30T10:00:00+02:00').getTime();   // Wednesday of week 40: the weeks are 40, 41 and 42
const ids = evs => evs.map(e => e.uid.replace('@azcarpool.nl', ''));
const car = (driver, girls, time) => ({ driverFamilyId: driver, girlIds: girls, reserveFamilyIds: [], departureTime: time });
const stateWith = patch => sampleCoordinatorState(patch);

console.log('=== the secret in the link ===');
test('a secret is 32 URL-safe characters and matches the rule the database and the job use', () => {
  const t = newCalendarToken();
  assert.equal(t.length, 32); assert.match(t, TOKEN_RE);
});
test('secrets do not repeat', () => {
  assert.equal(new Set(Array.from({ length: 200 }, () => newCalendarToken())).size, 200);
});
test('only 32 URL-safe characters pass the check (no path tricks like ../ or an extension)', () => {
  for (const bad of ['', 'short', '../../etc/passwd../../../../xx', 'a'.repeat(31), 'a'.repeat(33), 'a'.repeat(31) + '/', 'a'.repeat(28) + '.ics', 'a'.repeat(31) + ' ']) assert.ok(!TOKEN_RE.test(bad), bad);
  assert.ok(TOKEN_RE.test('a'.repeat(30) + '-_'));
});

console.log('=== Amsterdam time ===');
test('winter and summer time: 07:05 is 06:05 or 05:05 in UTC', () => {
  assert.equal(new Date(amsterdamToMs('2026-10-12', '07:05')).toISOString(), '2026-10-12T05:05:00.000Z');
  assert.equal(new Date(amsterdamToMs('2026-11-02', '07:05')).toISOString(), '2026-11-02T06:05:00.000Z');
  assert.equal(new Date(amsterdamToMs('2026-03-30', '07:05')).toISOString(), '2026-03-30T05:05:00.000Z');
});
test('the days of the clock change give the right offset', () => {
  assert.equal(new Date(amsterdamToMs('2026-10-24', '23:30')).toISOString(), '2026-10-24T21:30:00.000Z');   // still summer time
  assert.equal(new Date(amsterdamToMs('2026-10-25', '12:00')).toISOString(), '2026-10-25T11:00:00.000Z');   // winter time
  assert.equal(new Date(amsterdamToMs('2026-03-29', '12:00')).toISOString(), '2026-03-29T10:00:00.000Z');   // summer time
});
test('date and clock of a moment are Amsterdam time, also just after midnight UTC', () => {
  const ms = Date.parse('2026-10-12T22:30:00Z');   // already Tuesday in Amsterdam
  assert.equal(amsterdamDate(ms), '2026-10-13'); assert.equal(amsterdamClock(ms), '00:30');
});
test('the result does not depend on the time zone of the computer', () => {
  const code = `const m = await import(${JSON.stringify(new URL('../calendar-feed.js', import.meta.url).href)});
    console.log(m.amsterdamToMs('2026-10-12', '07:05'), m.feedWeekKeys(Date.parse('2026-10-11T22:30:00Z')).join());`;
  const x = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { PATH: process.env.PATH, TZ: 'America/Los_Angeles' } });
  assert.equal(x.status, 0, x.stderr);
  assert.equal(x.stdout.trim(), `${Date.UTC(2026, 9, 12, 5, 5)} 2026-W42,2026-W43,2026-W44`);   // Sunday 23:30 UTC = Monday 00:30 in Amsterdam: week 42 is the planning week
});

console.log('=== which weeks ===');
test('the planning week and the two after it', () => {
  assert.equal(FEED_WEEKS, 3);
  assert.deepEqual(feedWeekKeys(NOW), ['2026-W40', '2026-W41', '2026-W42']);
});
test('from Saturday the coming week is the first (the week that ended is over)', () => {
  assert.deepEqual(feedWeekKeys(new Date('2026-10-03T00:05:00+02:00').getTime()), ['2026-W41', '2026-W42', '2026-W43']);
  assert.deepEqual(feedWeekKeys(new Date('2026-10-04T12:00:00+02:00').getTime()), ['2026-W41', '2026-W42', '2026-W43']);
  assert.deepEqual(feedWeekKeys(new Date('2026-10-05T00:00:00+02:00').getTime()), ['2026-W41', '2026-W42', '2026-W43']);
});
test('over the year change: 2026 has 53 weeks', () => {
  assert.deepEqual(feedWeekKeys(new Date('2026-12-28T09:00:00+01:00').getTime()), ['2026-W53', '2027-W01', '2027-W02']);
});

console.log('=== the rides ===');
test('Eline (f1): her rides of the 3 weeks, same times as Mijn week', () => {
  stateWith();
  const evs = feedEvents('f1', S, NOW);
  // week 40: Mon heen + terug (standard rooster), Tue heen (a one-off change); weeks 41 and 42: Mon heen + terug
  assert.deepEqual(ids(evs), ['2026-W40-Ma-heen-f1', '2026-W40-Ma-terug-f1', '2026-W40-Di-heen-f1', '2026-W41-Ma-heen-f1', '2026-W41-Ma-terug-f1', '2026-W42-Ma-heen-f1', '2026-W42-Ma-terug-f1']);   // in time order
  const monHeen = evs.find(e => e.uid.startsWith('2026-W40-Ma-heen'));
  assert.equal(new Date(monHeen.startMs).toISOString(), '2026-09-28T05:30:00.000Z');   // 07:30 leaves, summer time
  assert.equal(new Date(monHeen.endMs).toISOString(), '2026-09-28T06:30:00.000Z');     // 08:30: the time she has to be there
  assert.match(monHeen.description, /Chauffeur: jullie zelf/); assert.match(monHeen.description, /Aanwezig om 08:30/);
  assert.equal(monHeen.summary, "Carpool Heen: Busstation → AFC '34");
});
test('a one-off change counts in its own week only', () => {
  stateWith();
  const evs = feedEvents('f1', S, NOW);
  const tue = evs.find(e => e.uid.startsWith('2026-W40-Di-heen'));
  assert.equal(new Date(tue.startMs).toISOString(), '2026-09-29T07:15:00.000Z');   // 09:15, in the car of Kees (f3)
  assert.match(tue.description, /Chauffeur: Kees de Vries/);
  assert.ok(!evs.some(e => e.uid.startsWith('2026-W41-Di') || e.uid.startsWith('2026-W42-Di')), 'week 41 and 42 have no Tuesday ride');
});
test('terug lasts 45 minutes and says when she is done; the driver is named', () => {
  stateWith();
  const e = feedEvents('f1', S, NOW).find(x => x.uid.startsWith('2026-W41-Ma-terug'));
  assert.equal(e.endMs - e.startMs, 45 * 60000);
  assert.match(e.description, /Chauffeur: Piet Pieters/); assert.match(e.description, /Klaar om 17:00/);
});
test('"Rijdt niet mee" on a shift: no event for that shift, the next weeks keep theirs', () => {
  stateWith({ deviations: { Ma_heen: { day: 'Ma', direction: 'heen', weekKey: '2026-W40', expiresAt: 1, cars: [car('f2', ['f2'], '07:30')], ovGirlIds: ['f1'] } } });
  const evs = feedEvents('f1', S, NOW);
  assert.ok(!evs.some(e => e.uid.startsWith('2026-W40-Ma-heen')));
  assert.ok(evs.some(e => e.uid.startsWith('2026-W41-Ma-heen')));
});
test('not in any car: no event (the calendar shows rides, not gaps)', () => {
  stateWith({ groups: {}, deviations: {} });
  assert.deepEqual(feedEvents('f1', S, NOW), []);
});
test('a family that does not exist, or has no times, has no events and no error', () => {
  stateWith();
  assert.deepEqual(feedEvents('nobody', S, NOW), []);
  assert.deepEqual(feedEvents('f5', S, NOW), []);
});
test('the arrival place comes from the car (ATC) and a free pickup place from the change', () => {
  stateWith({ groups: { Ma_heen_1: { ...car('f1', ['f1'], '07:30'), day: 'Ma', direction: 'heen', destination: 'ATC' } }, deviations: {} });
  const e = feedEvents('f1', S, NOW).find(x => x.uid.startsWith('2026-W41-Ma-heen'));
  assert.equal(e.summary, 'Carpool Heen: Busstation → ATC');
  stateWith({ groups: { Ma_heen_1: { ...car('f1', ['f1'], '07:30'), day: 'Ma', direction: 'heen', locationText: 'Station Heemstede' } }, deviations: {} });
  const f = feedEvents('f1', S, NOW).find(x => x.uid.startsWith('2026-W41-Ma-heen'));
  assert.equal(f.summary, "Carpool Heen: Station Heemstede → AFC '34"); assert.equal(f.location, 'Station Heemstede');
});
test('a saved pickup place with an address is the location', () => {
  stateWith({ locationsDoc: { places: [{ id: 'busstation', name: 'Busstation', address: 'Aalsmeerderweg 1, Aalsmeer' }] }, deviations: {} });
  assert.equal(feedEvents('f1', S, NOW)[0].location, 'Busstation, Aalsmeerderweg 1, Aalsmeer');
});
test('the temporary rooster of a period: the made shift counts, a shift not made keeps the standard rooster', () => {
  const P = { name: 'Herfstvakantie', firstDay: '2026-10-26', lastDay: '2026-10-30', opensOn: '2026-10-14', deadlineDate: '2026-10-16', deadlineTime: '12:00' };
  const doc = (iso, direction, cars) => ({ periodFirstDay: '2026-10-26', date: iso, direction, cars, madeAt: 1, by: 'x' });
  const entry = { familyId: 'f1', periodFirstDay: '2026-10-26', days: { '2026-10-26': { heen: '10:00', terug: '15:00' } }, submittedAt: 1, by: 'x' };
  stateWith({ deviations: {}, periods: { [P.firstDay]: P }, periodEntries: { '2026-10-26_f1': entry },
    periodCars: { '2026-10-26_2026-10-26_heen': doc('2026-10-26', 'heen', [car('f3', ['f1'], '08:45')]) } });
  const evs = feedEvents('f1', S, new Date('2026-10-20T10:00:00+02:00').getTime());   // weeks 43, 44, 45
  const heen = evs.find(e => e.uid.startsWith('2026-W44-Ma-heen'));
  assert.equal(amsterdamClock(heen.startMs), '08:45'); assert.match(heen.description, /Chauffeur: Kees de Vries/); assert.match(heen.description, /Aanwezig om 10:00/);
  const terug = evs.find(e => e.uid.startsWith('2026-W44-Ma-terug'));
  assert.match(terug.description, /Chauffeur: Piet Pieters/, 'terug was not made for the period: the standard rooster applies, as in Mijn week');
  assert.ok(evs.some(e => e.uid.startsWith('2026-W43-Ma-heen')), 'the week before the period is standard');
});
test('Flex family: only the shifts she is in a car for', () => {
  const fams = sampleFamilies(); fams.f1 = { ...fams.f1, familyType: 'flex' };
  stateWith({ families: fams });
  const evs = feedEvents('f1', S, NOW);
  assert.ok(evs.length > 0 && evs.every(e => /Ma-|Di-/.test(e.uid)));
  assert.ok(evs.every(e => !/Aanwezig om|Klaar om/.test(e.description)), 'a Flex family has no times of her own');
});

console.log('=== matches ===');
const MATCH = (extra = {}) => ({ startMs: new Date('2026-10-04T14:30:00+02:00').getTime(), summary: 'AZ O15 - Ajax O15', location: 'AFAS Trainingscomplex, Wijdewormer', cars: [car('f2', ['f1', 'f3'], '12:30'), car('f4', ['f4'], '12:00')], ...extra });
test('a match carpool the daughter is in: one event, leaving at the car\'s time, until the kick-off', () => {
  stateWith({ matchCarpools: { 'az-ajax': MATCH() } });
  const m = feedEvents('f1', S, NOW).find(e => e.uid.startsWith('match-'));
  assert.equal(m.summary, 'Wedstrijd: AZ O15 - Ajax O15');
  assert.equal(new Date(m.startMs).toISOString(), '2026-10-04T10:30:00.000Z'); assert.equal(new Date(m.endMs).toISOString(), '2026-10-04T12:30:00.000Z');
  assert.match(m.description, /Chauffeur: Piet Pieters/); assert.match(m.description, /Aftrap 14:30/); assert.equal(m.location, 'AFAS Trainingscomplex, Wijdewormer');
});
test('a match she is in no car for, or only drives in, is not in her calendar', () => {
  stateWith({ matchCarpools: { 'az-ajax': MATCH({ cars: [car('f2', ['f3'], '12:30'), car('f1', ['f4'], '12:00')] }) } });
  assert.ok(!feedEvents('f1', S, NOW).some(e => e.uid.startsWith('match-')));
});
test('a match outside the 3 weeks is left out', () => {
  stateWith({ matchCarpools: { far: MATCH({ startMs: new Date('2026-11-14T14:30:00+01:00').getTime() }) } });
  assert.ok(!feedEvents('f1', S, NOW).some(e => e.uid.startsWith('match-')));
});

console.log('=== the .ics file ===');
const sample = () => { stateWith({ matchCarpools: { 'az-ajax': MATCH() } }); return buildIcs({ name: 'Carpool Eline', events: feedEvents('f1', S, NOW), nowMs: NOW }); };
test('a calendar with events: right frame, CRLF line ends, UTC times', () => {
  const ics = sample();
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'every line ends with CRLF');
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 8); assert.equal((ics.match(/END:VEVENT/g) || []).length, 8);
  assert.match(ics, /DTSTART:20260928T053000Z/); assert.match(ics, /DTSTAMP:20260930T080000Z/);
  assert.match(ics, /VERSION:2\.0/); assert.match(ics, /X-WR-TIMEZONE:Europe\/Amsterdam/); assert.match(ics, /REFRESH-INTERVAL;VALUE=DURATION:PT1H/);
});
test('no line is longer than 75 bytes, and folding never cuts a character in two', () => {
  const ics = sample();
  const lines = ics.split('\r\n');
  assert.ok(lines.every(l => Buffer.byteLength(l) <= 75), lines.find(l => Buffer.byteLength(l) > 75));
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes("SUMMARY:Carpool Heen: Busstation → AFC '34"), 'the arrow survives folding');
  assert.ok(!unfolded.includes('�'));
});
test('text is escaped: comma, semicolon, backslash and new lines cannot break the file', () => {
  const ics = buildIcs({ name: 'A;B,C\\D', events: [{ uid: 'x@y', startMs: NOW, endMs: NOW + 1000, summary: 'a;b,c', description: 'one\ntwo', location: 'x\\y' }], nowMs: NOW });
  assert.match(ics, /X-WR-CALNAME:A\\;B\\,C\\\\D/); assert.match(ics, /SUMMARY:a\\;b\\,c/); assert.match(ics, /DESCRIPTION:one\\ntwo/); assert.match(ics, /LOCATION:x\\\\y/);
});
test('a name cannot inject extra lines', () => {
  const ics = buildIcs({ name: 'Eline\r\nBEGIN:VEVENT', events: [], nowMs: NOW });
  assert.ok(!ics.split('\r\n').some(l => l.startsWith('BEGIN:VEVENT')), 'the text stays inside its own line');
  assert.match(ics, /X-WR-CALNAME:Eline\\nBEGIN:VEVENT/);
});
test('no events is still a valid, empty calendar', () => {
  const ics = buildIcs({ name: 'Carpool', events: [], nowMs: NOW });
  assert.ok(ics.includes('BEGIN:VCALENDAR') && !ics.includes('VEVENT'));
});
test('two runs give the same file apart from the time stamp (so a calendar does not see changes that are none)', () => {
  stateWith();
  const a = buildIcs({ name: 'C', events: feedEvents('f1', S, NOW), nowMs: NOW }), b = buildIcs({ name: 'C', events: feedEvents('f1', S, NOW), nowMs: NOW + 60000 });
  assert.equal(a.replace(/^DTSTAMP:.*\r\n/gm, ''), b.replace(/^DTSTAMP:.*\r\n/gm, ''));
});
test('every event has an end after its start and a stable, unique id', () => {
  stateWith({ matchCarpools: { 'az-ajax': MATCH() } });
  const evs = feedEvents('f1', S, NOW);
  assert.ok(evs.every(e => e.endMs > e.startMs));
  assert.equal(new Set(evs.map(e => e.uid)).size, evs.length);
  assert.ok(evs.every((e, i) => i === 0 || evs[i - 1].startMs <= e.startMs), 'in time order');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
