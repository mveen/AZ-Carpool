// Run with: node cron-agenda.test.js
// cron/agenda.mjs: the job that writes one .ics file per family with a link. It must write exactly the rides the app shows, only for valid
// links of existing families, never rewrite an unchanged file, remove the file of a link that is gone, and never touch anything else.
// A family has two links: the daughter's calendar (calendarTokens) and the parents' calendar with the rides the family drives (driverCalendarTokens).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installFakeDom, resetState, sampleDbSeed } from './test-support.js';
import { encodeFields } from '../cron/lib/firestore-rest.mjs';
import { buildCron } from '../scripts/build-cron.mjs';
import { runAgenda, loadAgendaApp, HTACCESS, AGENDA_APP_MODULES, agendaSignature, needsFullRun, readAgendaSignature, readAgendaState, writeAgendaState, AGENDA_FULL_MAX_AGE_MS } from '../cron/agenda.mjs';
import { feedEvents, driverFeedEvents, buildIcs } from '../calendar-feed.js';
import { S } from '../state.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
installFakeDom();

const NOW = new Date('2026-09-30T10:00:00+02:00').getTime();
const T1 = 'A'.repeat(31) + '1', T2 = 'B'.repeat(31) + '2', T3 = 'C'.repeat(32);
const seed = (extra = {}) => ({ ...sampleDbSeed(), 'calendarTokens/f1': { token: T1, createdAt: 1 }, 'calendarTokens/f2': { token: T2, createdAt: 1 }, ...extra });

// A fake Firestore with the calls cron/lib/firestore-rest.mjs has.
function fakeFirestore(docs, { failList = false } = {}) {
  const data = new Map(Object.entries(docs).map(([k, v]) => [k, structuredClone(v)]));
  const root = 'projects/az-carpool/databases/(default)/documents';
  return { data,
    listDocuments: async c => { if (failList) throw new Error('Firestore GET failed: HTTP 503 down'); return [...data.keys()].filter(k => k.startsWith(c + '/') && k.split('/').length === 2).sort()
      .map(k => ({ name: `${root}/${k}`, fields: encodeFields(data.get(k)), createTime: 't', updateTime: 'v1' })); },
    getDocument: async p => data.has(p) ? { name: `${root}/${p}`, fields: encodeFields(data.get(p)), createTime: 't', updateTime: 'v1' } : null,
  };
}
const quiet = () => { const warnings = [], logs = []; return { log: l => logs.push(l), warn: w => warnings.push(w), warnings, logs }; };
const tmpOut = () => join(mkdtempSync(join(tmpdir(), 'az-agenda-')), 'agenda');
const calendars = out => readdirSync(out).filter(f => f.endsWith('.ics')).sort();
async function run(docs, out, extra = {}) { resetState(); return runAgenda({ firestore: fakeFirestore(docs, extra.fs), app: await loadAgendaApp(), outDir: out, now: NOW, ...quiet(), ...extra.q }); }
const cleanup = out => rmSync(join(out, '..'), { recursive: true, force: true });

console.log('=== writing the calendars ===');
await test('one file per family with a valid link, named by the secret, with that family\'s rides', async () => {
  const out = tmpOut();
  try {
    const res = await run(seed(), out);
    assert.deepEqual(calendars(out), [T1 + '.ics', T2 + '.ics']);
    assert.deepEqual([res.calendars, res.written, res.unchanged, res.removed], [2, 2, 0, 0]);
    const f1 = readFileSync(join(out, T1 + '.ics'), 'utf8');
    assert.ok(f1.startsWith('BEGIN:VCALENDAR\r\n')); assert.match(f1, /X-WR-CALNAME:Carpool Eline/);
    assert.ok(f1.includes('UID:2026-W41-Ma-heen-f1@azcarpool.nl')); assert.ok(!f1.includes('-f2@azcarpool.nl'), 'no ride of another family');
    assert.ok(readFileSync(join(out, T2 + '.ics'), 'utf8').includes('X-WR-CALNAME:Carpool Jahaimy'));
  } finally { cleanup(out); }
});
await test('the file has the same content as the app code builds (nothing of its own)', async () => {
  const out = tmpOut();
  try {
    await run(seed(), out);
    resetState();
    const fams = Object.fromEntries(Object.entries(sampleDbSeed()).filter(([k]) => k.startsWith('families/')).map(([k, v]) => [k.slice(9), v]));
    const groups = Object.fromEntries(Object.entries(sampleDbSeed()).filter(([k]) => k.startsWith('groups/')).map(([k, v]) => [k.slice(7), v]));
    const devs = Object.fromEntries(Object.entries(sampleDbSeed()).filter(([k]) => k.startsWith('deviations/')).map(([k, v]) => [k.slice(11), v]));
    Object.assign(S, { families: fams, groups, deviations: devs, periods: {}, periodEntries: {}, periodCars: {}, matchCarpools: {}, locationsDoc: null, currentWeekKey: '2026-W40' });
    const expected = buildIcs({ name: 'Carpool Eline', events: feedEvents('f1', S, NOW), nowMs: NOW });
    assert.equal(readFileSync(join(out, T1 + '.ics'), 'utf8'), expected);
  } finally { cleanup(out); }
});
await test('the folder gets an .htaccess: calendar type, no directory listing, every rule guarded', async () => {
  const out = tmpOut();
  try {
    await run(seed(), out);
    assert.equal(readFileSync(join(out, '.htaccess'), 'utf8'), HTACCESS);
    assert.match(HTACCESS, /Options -Indexes/); assert.match(HTACCESS, /AddType text\/calendar \.ics/);
    assert.match(HTACCESS, /<IfModule mod_headers\.c>[\s\S]*<\/IfModule>/); assert.match(HTACCESS, /<IfModule mod_mime\.c>[\s\S]*<\/IfModule>/);
  } finally { cleanup(out); }
});
await test('a changed .htaccess is put back', async () => {
  const out = tmpOut();
  try { await run(seed(), out); writeFileSync(join(out, '.htaccess'), 'broken'); await run(seed(), out); assert.equal(readFileSync(join(out, '.htaccess'), 'utf8'), HTACCESS); }
  finally { cleanup(out); }
});

console.log('=== running again ===');
await test('nothing changed: nothing is rewritten (the time stamp alone is no change)', async () => {
  const out = tmpOut();
  try {
    await run(seed(), out);
    const old = new Date('2026-01-01T00:00:00Z'); utimesSync(join(out, T1 + '.ics'), old, old);
    resetState();
    const res = await runAgenda({ firestore: fakeFirestore(seed()), app: await loadAgendaApp(), outDir: out, now: NOW + 30 * 60000, ...quiet() });
    assert.deepEqual([res.written, res.unchanged], [0, 2]);
    assert.equal(statSync(join(out, T1 + '.ics')).mtimeMs, old.getTime());
  } finally { cleanup(out); }
});
await test('a ride that changed: that calendar (and only that one) is rewritten', async () => {
  const out = tmpOut();
  try {
    await run(seed(), out);
    const s = seed(); s['groups/Ma_heen_1'] = { ...s['groups/Ma_heen_1'], departureTime: '07:45' };
    const res = await run(s, out);
    assert.equal(res.written, 2, 'f1 and f2 are both in that car');
    assert.match(readFileSync(join(out, T1 + '.ics'), 'utf8'), /DTSTART:20261005T054500Z/);
    const t = seed(); t['groups/Ma_heen_1'] = { ...t['groups/Ma_heen_1'], departureTime: '07:45' }; t['groups/Ma_terug_1'] = { ...t['groups/Ma_terug_1'], departureTime: '17:45' };
    delete t['calendarTokens/f2'];
    const res2 = await run(t, out);
    assert.deepEqual([res2.written, res2.removed], [1, 1]);
  } finally { cleanup(out); }
});

console.log('=== links that are gone or wrong ===');
await test('a link that was removed: its file is deleted, other files stay', async () => {
  const out = tmpOut();
  try {
    await run(seed(), out);
    writeFileSync(join(out, 'readme.txt'), 'x'); writeFileSync(join(out, 'short.ics'), 'x');
    const s = seed(); delete s['calendarTokens/f2'];
    const res = await run(s, out);
    assert.equal(res.removed, 1);
    assert.deepEqual(readdirSync(out).sort(), ['.htaccess', T1 + '.ics', 'readme.txt', 'short.ics'].sort());
  } finally { cleanup(out); }
});
await test('a family that no longer exists: no file, and an earlier file goes away', async () => {
  const out = tmpOut();
  try {
    await run(seed(), out);
    const s = seed(); delete s['families/f2'];
    await run(s, out);
    assert.deepEqual(calendars(out), [T1 + '.ics']);
  } finally { cleanup(out); }
});
await test('a secret that is not 32 URL-safe characters is ignored, with a warning (no path tricks)', async () => {
  const out = tmpOut();
  try {
    const q = quiet();
    await run(seed({ 'calendarTokens/f3': { token: '../../../etc/passwd' }, 'calendarTokens/f4': { token: 'x/' + 'y'.repeat(30) }, 'calendarTokens/f5': { token: 123 }, 'calendarTokens/f6': {} }), out, { q });
    assert.deepEqual(calendars(out), [T1 + '.ics', T2 + '.ics']);
    assert.equal(q.warnings.length, 4);
    assert.deepEqual(readdirSync(join(out, '..')), ['agenda'], 'nothing written outside the folder');
  } finally { cleanup(out); }
});
await test('two families with the same secret: both are ignored, with a warning', async () => {
  const out = tmpOut();
  try {
    const q = quiet();
    await run(seed({ 'calendarTokens/f3': { token: T1 } }), out, { q });
    assert.deepEqual(calendars(out), [T2 + '.ics']);
    assert.match(q.warnings.join(), /same secret/);
  } finally { cleanup(out); }
});
await test('no links yet: only the folder and its .htaccess', async () => {
  const out = tmpOut();
  try {
    const s = seed(); delete s['calendarTokens/f1']; delete s['calendarTokens/f2'];
    const res = await run(s, out);
    assert.equal(res.calendars, 0); assert.deepEqual(readdirSync(out), ['.htaccess']);
  } finally { cleanup(out); }
});

console.log('=== the parents\' links ===');
const T4 = 'D'.repeat(32), T5 = 'E'.repeat(32);
const withDrivers = (extra = {}) => seed({ 'driverCalendarTokens/f1': { token: T4, createdAt: 1 }, 'driverCalendarTokens/f2': { token: T5, createdAt: 1 }, ...extra });
await test('a parents\' link gets its own file with the rides that family drives, next to the daughter\'s file', async () => {
  const out = tmpOut();
  try {
    const res = await run(withDrivers(), out);
    assert.deepEqual(calendars(out), [T1 + '.ics', T2 + '.ics', T4 + '.ics', T5 + '.ics'].sort());
    assert.deepEqual([res.calendars, res.written], [4, 4]);
    const f1 = readFileSync(join(out, T4 + '.ics'), 'utf8'), f2 = readFileSync(join(out, T5 + '.ics'), 'utf8');
    assert.match(f1, /X-WR-CALNAME:Carpool rijden Jan Jansen/); assert.match(f2, /X-WR-CALNAME:Carpool rijden Piet Pieters/);
    assert.ok(f1.includes('UID:2026-W41-Ma-heen-drive-f1@azcarpool.nl')); assert.ok(!f1.includes('-terug-drive-'), 'Jan drives heen only');
    assert.ok(f2.includes('UID:2026-W41-Ma-terug-drive-f2@azcarpool.nl')); assert.ok(!f2.includes('-heen-drive-'));
    assert.match(f1, /Ophalen: Eline\\, Jahaimy/);
    assert.ok(!readFileSync(join(out, T1 + '.ics'), 'utf8').includes('-drive-'), 'the daughter\'s file is the daughter\'s file');
  } finally { cleanup(out); }
});
await test('the parents\' file has the same content as the app code builds (nothing of its own)', async () => {
  const out = tmpOut();
  try {
    await run(withDrivers(), out);
    resetState();
    const fams = Object.fromEntries(Object.entries(sampleDbSeed()).filter(([k]) => k.startsWith('families/')).map(([k, v]) => [k.slice(9), v]));
    const groups = Object.fromEntries(Object.entries(sampleDbSeed()).filter(([k]) => k.startsWith('groups/')).map(([k, v]) => [k.slice(7), v]));
    const devs = Object.fromEntries(Object.entries(sampleDbSeed()).filter(([k]) => k.startsWith('deviations/')).map(([k, v]) => [k.slice(11), v]));
    Object.assign(S, { families: fams, groups, deviations: devs, periods: {}, periodEntries: {}, periodCars: {}, matchCarpools: {}, locationsDoc: null, currentWeekKey: '2026-W40' });
    const expected = buildIcs({ name: 'Carpool rijden Jan Jansen', events: driverFeedEvents('f1', S, NOW), nowMs: NOW });
    assert.equal(readFileSync(join(out, T4 + '.ics'), 'utf8'), expected);
  } finally { cleanup(out); }
});
await test('a family with only the old link keeps working: no parents\' file is made until it has a parents\' link', async () => {
  const out = tmpOut();
  try { const res = await run(seed(), out); assert.deepEqual(calendars(out), [T1 + '.ics', T2 + '.ics']); assert.equal(res.calendars, 2); } finally { cleanup(out); }
});
await test('a ride that changes updates the parents\' file of the driver and the daughter\'s files of the girls in the car, nobody else\'s', async () => {
  const out = tmpOut();
  try {
    await run(withDrivers(), out);
    const s = withDrivers(); s['groups/Ma_heen_1'] = { ...s['groups/Ma_heen_1'], departureTime: '07:45' };
    const res = await run(s, out);
    assert.equal(res.written, 3, 'f1 and f2 daughters (both in that car) and Jan\'s drive file; Piet drives terug only');
    assert.match(readFileSync(join(out, T4 + '.ics'), 'utf8'), /DTSTART:20261005T054500Z/);
  } finally { cleanup(out); }
});
await test('a removed parents\' link: its file is deleted, the daughter\'s file stays', async () => {
  const out = tmpOut();
  try {
    await run(withDrivers(), out);
    const s = withDrivers(); delete s['driverCalendarTokens/f1'];
    const res = await run(s, out);
    assert.equal(res.removed, 1); assert.deepEqual(calendars(out), [T1 + '.ics', T2 + '.ics', T5 + '.ics'].sort());
  } finally { cleanup(out); }
});
await test('a family that no longer exists loses both of its files', async () => {
  const out = tmpOut();
  try {
    await run(withDrivers(), out);
    const s = withDrivers(); delete s['families/f2'];
    await run(s, out);
    assert.deepEqual(calendars(out), [T1 + '.ics', T4 + '.ics'].sort());
  } finally { cleanup(out); }
});
await test('the same secret in a daughter\'s and a parents\' link: both are ignored, with a warning (a secret is a file name)', async () => {
  const out = tmpOut();
  try {
    const q = quiet();
    await run(withDrivers({ 'driverCalendarTokens/f1': { token: T1, createdAt: 1 } }), out, { q });
    assert.deepEqual(calendars(out), [T2 + '.ics', T5 + '.ics'].sort());
    assert.match(q.warnings.join(), /same secret/);
  } finally { cleanup(out); }
});
await test('an invalid parents\' secret is ignored, with a warning (no path tricks)', async () => {
  const out = tmpOut();
  try {
    const q = quiet();
    await run(withDrivers({ 'driverCalendarTokens/f3': { token: '../../../etc/passwd' }, 'driverCalendarTokens/f4': { token: 5 } }), out, { q });
    assert.deepEqual(calendars(out), [T1 + '.ics', T2 + '.ics', T4 + '.ics', T5 + '.ics'].sort());
    assert.equal(q.warnings.length, 2); assert.match(q.warnings[0], /driver link of f3/);
    assert.deepEqual(readdirSync(join(out, '..')), ['agenda'], 'nothing written outside the folder');
  } finally { cleanup(out); }
});

console.log('=== when something is wrong ===');
await test('the database cannot be read: the job stops with the error and the existing calendars stay', async () => {
  const out = tmpOut();
  try {
    await run(seed(), out);
    const before = readFileSync(join(out, T1 + '.ics'), 'utf8');
    await assert.rejects(run(seed(), out, { fs: { failList: true } }), /HTTP 503/);
    assert.equal(readFileSync(join(out, T1 + '.ics'), 'utf8'), before); assert.deepEqual(calendars(out), [T1 + '.ics', T2 + '.ics']);
  } finally { cleanup(out); }
});
await test('an empty database (no families at all) deletes nothing: that looks like a read problem', async () => {
  const out = tmpOut();
  try {
    await run(seed(), out);
    await run({}, out);
    assert.deepEqual(calendars(out), [T1 + '.ics', T2 + '.ics']);
  } finally { cleanup(out); }
});
await test('no half-written file is left behind', async () => {
  const out = tmpOut();
  try { await run(seed(), out); assert.ok(!readdirSync(out).some(f => f.endsWith('.tmp'))); } finally { cleanup(out); }
});

console.log('=== the host ===');
await test('the copy that is uploaded to the host (cron folder + app/) writes the same calendars, also in another time zone', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'az-agenda-host-'));
  try {
    const built = buildCron({ out: join(tmp, 'dist-cron') });
    assert.ok(AGENDA_APP_MODULES.every(f => built.files.includes('app/' + f)), 'the app modules are in the upload');
    assert.ok(built.files.includes('agenda.mjs'));
    assert.ok(!built.files.some(f => /^app\/ui-|^app\/data\.js|^app\/app\.js/.test(f)), 'no screen code on the host: ' + built.files.join());
    const dist = join(tmp, 'dist-cron'), outHost = join(tmp, 'host-out');
    const driver = `import { runAgenda, loadAgendaApp } from ${JSON.stringify(join(dist, 'agenda.mjs'))};
      import { encodeFields } from ${JSON.stringify(join(dist, 'lib/firestore-rest.mjs'))};
      const docs = ${JSON.stringify(Object.fromEntries([...fakeFirestore(seed()).data]))};
      const fs = {
        listDocuments: async c => Object.keys(docs).filter(k => k.startsWith(c + '/') && k.split('/').length === 2).map(k => ({ name: 'x/' + k, fields: encodeFields(docs[k]), createTime: 't', updateTime: 'v1' })),
        getDocument: async p => docs[p] ? { name: 'x/' + p, fields: encodeFields(docs[p]), createTime: 't', updateTime: 'v1' } : null };
      console.log(JSON.stringify(await runAgenda({ firestore: fs, app: await loadAgendaApp(${JSON.stringify(dist)}), outDir: ${JSON.stringify(outHost)}, now: ${NOW}, log: () => {}, warn: () => {} })));`;
    const x = spawnSync(process.execPath, ['--input-type=module', '-e', driver], { encoding: 'utf8', env: { PATH: process.env.PATH, TZ: 'UTC' } });
    assert.equal(x.status, 0, x.stdout + x.stderr);
    assert.equal(JSON.parse(x.stdout.trim().split('\n').pop()).written, 2);
    const repoOut = join(tmp, 'repo-out'); await run(seed(), repoOut);
    for (const f of [T1 + '.ics', T2 + '.ics']) assert.equal(readFileSync(join(outHost, f), 'utf8'), readFileSync(join(repoOut, f), 'utf8'), 'same file as with the repo code');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
await test('run.sh knows the agenda job and the web deploy leaves the agenda folder alone', () => {
  assert.match(readFileSync(new URL('../cron/run.sh', import.meta.url), 'utf8'), /agenda\)\s+exec "\$best" "\$here\/agenda\.mjs"/);
  assert.match(readFileSync(new URL('../scripts/deploy-rsync.sh', import.meta.url), 'utf8'), /--exclude=\/agenda\//);
});

console.log('=== change check (quota) ===');
const sig = (o = {}) => agendaSignature({ rooster: 5, deviation: 7, tokens: [{ id: 'girl/f1', token: T1 }], nowMs: NOW, ...o });
await test('same data, same day: same signature; each kind of change gives another one', () => {
  assert.equal(sig(), sig());
  assert.notEqual(sig(), sig({ rooster: 6 })); assert.notEqual(sig(), sig({ deviation: 8 }));
  assert.notEqual(sig(), sig({ tokens: [{ id: 'girl/f1', token: T3 }] }));
  assert.notEqual(sig(), sig({ tokens: [] }));
  assert.notEqual(sig(), sig({ nowMs: NOW + 24 * 3600000 }), 'a new day moves the 3 weeks');
  assert.notEqual(sig(), sig({ weekEnded: true }), 'Friday 19:00 moves the first week');
  assert.equal(sig({ tokens: [{ id: 'b', token: T2 }, { id: 'a', token: T1 }] }), sig({ tokens: [{ id: 'a', token: T1 }, { id: 'b', token: T2 }] }), 'order does not matter');
});
await test('needsFullRun: no state, other signature, too old or from the future: yes; otherwise no', () => {
  const state = { signature: sig(), fullAt: NOW - 60000 };
  assert.equal(needsFullRun({ signature: sig(), state, nowMs: NOW }), false);
  assert.equal(needsFullRun({ signature: sig(), state: null, nowMs: NOW }), true);
  assert.equal(needsFullRun({ signature: sig(), state: { signature: 1, fullAt: 1 }, nowMs: NOW }), true);
  assert.equal(needsFullRun({ signature: sig({ rooster: 6 }), state, nowMs: NOW }), true);
  assert.equal(needsFullRun({ signature: sig(), state: { ...state, fullAt: NOW - AGENDA_FULL_MAX_AGE_MS }, nowMs: NOW }), true);
  assert.equal(needsFullRun({ signature: sig(), state: { ...state, fullAt: NOW + 1000 }, nowMs: NOW }), true);
});
await test('readAgendaSignature reads only 2 documents and the 2 link collections, and sees a changed stamp or a new link', async () => {
  const docs = seed({ 'settings/lastUpdateRooster': { by: 'x', at: 100 }, 'settings/lastUpdateDeviation': { by: 'x', at: 200 }, 'driverCalendarTokens/f1': { token: T3, createdAt: 1 } });
  const fs = fakeFirestore(docs); const reads = [];
  const lists = fs.listDocuments, gets = fs.getDocument;
  fs.listDocuments = async c => { reads.push('list ' + c); return lists(c); };
  fs.getDocument = async p => { reads.push('get ' + p); return gets(p); };
  const a = await readAgendaSignature({ firestore: fs, now: NOW });
  assert.deepEqual(reads.sort(), ['get settings/lastUpdateDeviation', 'get settings/lastUpdateRooster', 'list calendarTokens', 'list driverCalendarTokens']);
  assert.equal(a, await readAgendaSignature({ firestore: fs, now: NOW }), 'unchanged data: same signature');
  fs.data.set('settings/lastUpdateRooster', { by: 'x', at: 101 });
  assert.notEqual(a, await readAgendaSignature({ firestore: fs, now: NOW }), 'new stamp');
  const b = await readAgendaSignature({ firestore: fs, now: NOW }); fs.data.set('calendarTokens/f3', { token: T3 + 'x', createdAt: 2 });
  assert.notEqual(b, await readAgendaSignature({ firestore: fs, now: NOW }), 'new link');
  const none = await readAgendaSignature({ firestore: fakeFirestore({}), now: NOW });
  assert.equal(typeof none, 'string', 'an empty database is fine');
});
await test('the state file survives a round trip and a broken file means "do the full run"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'az-agenda-state-')); const f = join(dir, 'sub', 'agenda.state.json');
  try {
    assert.equal(readAgendaState(f), null);
    writeAgendaState(f, { signature: 'x', fullAt: 5 }); assert.deepEqual(readAgendaState(f), { signature: 'x', fullAt: 5 });
    writeFileSync(f, '{broken'); assert.equal(readAgendaState(f), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
