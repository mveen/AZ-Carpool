// Run with: node seed-test-data.test.js
// scripts/seed-test-data.mjs: the copy of the live data for the test database keeps everything that makes the app behave the same,
// replaces phone numbers and codes, leaves out history and secrets, and can only ever write to the test project.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeFields } from '../cron/lib/firestore-rest.mjs';
import { transformBackup, findLeaks, codesCsv, assertTestProject, seed, randomCode, TEST_PHONE, TEST_PROJECT, LIVE_PROJECT } from '../scripts/seed-test-data.mjs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const row = (path, data) => ({ path, name: 'projects/az-carpool/databases/(default)/documents/' + path, fields: encodeFields(data) });

const OLD1 = '1111111111', OLD2 = '2222222222';
const fixture = () => [
  row('config/coordinator', { familyId: 'eline' }),
  row('families/eline', { girlName: 'Eline', parentName: 'Merel of Michiel', parentPhone1: '06 12 34 56 78', parentPhone2: '+31 6 87654321', phoneKeys: ['0612345678', '0687654321'], capacity: 4, schedule: { Ma_heen: { a: 1 } }, availability: { Di_heen: 'beschikbaar' } }),
  row('families/anouk', { girlName: 'Anouk', parentName: 'Ouder van Anouk', parentPhone1: '0611111111', parentPhone2: '', phoneKeys: ['0611111111'], capacity: 3 }),
  row('families/anouk/notifications/n1', { kind: 'backupForRide', day: 'Di' }),
  row('invites/' + OLD1, { familyId: 'eline' }),
  row('invites/' + OLD2, { familyId: 'anouk' }),
  row('links/uid-abc', { familyId: 'eline', code: OLD1, phoneKey: '0612345678', linkedAt: 5 }),
  row('sessions/uid-abc', { familyId: 'eline', at: 7 }),
  row('calendarTokens/eline', { token: 'TOKENTOKENTOKENTOKEN12345678', createdAt: 1 }),
  row('driverCalendarTokens/eline', { token: 'DRIVERTOKENTOKENTOKEN123456', createdAt: 1 }),
  row('pushDevices/d1', { endpoint: 'https://push.example/abcdefghij', auth: 'AUTHAUTHAUTH', p256dh: 'P256DHP256DH', uid: 'uid-abc' }),
  row('pushQueue/q1', { kind: 'x' }),
  row('rideLog/2026-09-28_heen', { day: 'Ma', cars: [] }),
  row('settings/apiKeys', { ors: 'ORS-SECRET-KEY-1234567890' }),
  row('settings/pushKey', { publicKey: 'PUBKEY' }), row('settings/pushStatus', { sent: 1 }), row('settings/push', { mode: 'test' }),
  row('settings/maintenance', { on: true, text: 'bezig' }), row('settings/notice', { on: true, text: 'melding' }),
  row('settings/priority', { Ma_heen: ['eline', 'anouk'] }),
  row('settings/dayCoordinators', { Ma: 'eline' }),
  row('groups/Ma_heen_1', { day: 'Ma', driverFamilyId: 'eline', girlIds: ['anouk'], departureTime: '07:00' }),
  row('deviations/Di_heen', { day: 'Di', weekKey: '2026-W43', cars: [] }),
  row('periods/2026-10-12', { name: 'Herfst', firstDay: '2026-10-12' }),
  row('periodBackups/b1', { by: 'Merel', cars: [] }),
];
const byPath = (res, p) => res.docs.find(d => d.path === p);
let n = 0; const seq = () => String(3000000000 + n++);
const res = transformBackup(fixture(), { makeCode: seq });

console.log('=== phone numbers ===');
await test('every phone number becomes the test number, an empty second number stays empty, phoneKeys follow', () => {
  assert.equal(byPath(res, 'families/eline').data.parentPhone1, TEST_PHONE);
  assert.equal(byPath(res, 'families/eline').data.parentPhone2, TEST_PHONE);
  assert.deepEqual(byPath(res, 'families/eline').data.phoneKeys, [TEST_PHONE, TEST_PHONE]);
  assert.equal(byPath(res, 'families/anouk').data.parentPhone2, '');
  assert.deepEqual(byPath(res, 'families/anouk').data.phoneKeys, [TEST_PHONE]);
});
await test('everything else of a family stays exactly the same (names, capacity, schedule, availability)', () => {
  const f = byPath(res, 'families/eline').data;
  assert.equal(f.girlName, 'Eline'); assert.equal(f.parentName, 'Merel of Michiel'); assert.equal(f.capacity, 4);
  assert.deepEqual(f.schedule, { Ma_heen: { a: 1 } }); assert.deepEqual(f.availability, { Di_heen: 'beschikbaar' });
});

console.log('=== invite codes ===');
await test('each family gets a new code of its own; the old codes are gone', () => {
  assert.equal(res.codes.length, 2);
  assert.deepEqual(res.codes.map(c => c.familyId).sort(), ['anouk', 'eline']);
  for (const c of res.codes) { assert.ok(![OLD1, OLD2].includes(c.code)); assert.deepEqual(byPath(res, 'invites/' + c.code).data, { familyId: c.familyId }); }
  assert.equal(new Set(res.codes.map(c => c.code)).size, 2);
  assert.ok(!res.docs.some(d => d.path === 'invites/' + OLD1 || d.path === 'invites/' + OLD2));
});
await test('a new code is never an old one, even when the generator offers it (and has 10 digits, not starting with 0)', () => {
  const offers = [OLD1, OLD2, '4444444444', '5555555555']; let i = 0;
  const r = transformBackup(fixture(), { makeCode: () => offers[i++] });
  assert.deepEqual(r.codes.map(c => c.code), ['4444444444', '5555555555']);
  for (let k = 0; k < 500; k++) assert.match(randomCode(), /^[1-9]\d{9}$/);
});

console.log('=== what is left out ===');
await test('history, links, sessions, calendar links, push data, API key, notice and maintenance are not copied', () => {
  const paths = res.docs.map(d => d.path);
  for (const gone of ['links/uid-abc', 'sessions/uid-abc', 'calendarTokens/eline', 'driverCalendarTokens/eline', 'pushDevices/d1', 'pushQueue/q1', 'rideLog/2026-09-28_heen',
    'settings/apiKeys', 'settings/pushKey', 'settings/pushStatus', 'settings/push', 'settings/maintenance', 'settings/notice', 'families/anouk/notifications/n1']) assert.ok(!paths.includes(gone), gone);
});
await test('everything that makes the app behave the same is copied unchanged (coordinator, priority, day coordinators, groups, deviations, periods)', () => {
  const orig = Object.fromEntries(fixture().map(r => [r.path, r.fields]));
  for (const p of ['config/coordinator', 'settings/priority', 'settings/dayCoordinators', 'groups/Ma_heen_1', 'deviations/Di_heen', 'periods/2026-10-12', 'periodBackups/b1']) {
    assert.ok(byPath(res, p), p); assert.deepEqual(encodeFields(byPath(res, p).data), orig[p], p);
  }
});
await test('the report says what was left out and how many documents are copied', () => {
  assert.equal(res.docs.length, 11);
  assert.ok(Object.keys(res.dropped).length >= 8);
});

console.log('=== nothing secret is left ===');
await test('the clean copy has no leaks', () => { assert.deepEqual(res.leaks, []); });
await test('an old code, a token, the API key or another phone number in a copied document is found (and its value is not repeated in full)', () => {
  const mk = text => transformBackup([...fixture(), row('periodBackups/b2', { note: text })], { makeCode: seq }).leaks;
  assert.equal(mk('code ' + OLD1).length, 1);
  assert.equal(mk('token TOKENTOKENTOKENTOKEN12345678').length, 1);
  assert.equal(mk('key ORS-SECRET-KEY-1234567890').length, 1);
  assert.equal(mk('bel 06-98765432').length, 1);
  assert.equal(mk('bel +31 6 98765432').length, 1);
  assert.equal(mk('bel 0641434197').length, 0);
  assert.equal(mk('bel +31641434197').length, 0);
  assert.ok(!mk('code ' + OLD1)[0].includes(OLD1));
  assert.equal(mk('week 2026-W43 tijd 07:00 id manual-gezin-muohcbe0').length, 0);
});
await test('findLeaks works on its own too', () => {
  assert.equal(findLeaks([{ path: 'x/y', data: { a: '0612345678' } }], { secrets: new Set(), testKey: TEST_PHONE }).length, 1);
});

console.log('=== the list of codes ===');
await test('gives one line per family with girl, parent, new code and the test number', () => {
  const csv = codesCsv(res.docs, res.codes).trim().split('\n');
  assert.equal(csv.length, 3); assert.match(csv[0], /toegangscode/);
  const eline = csv.find(l => l.startsWith('"eline"'));
  assert.ok(eline.includes('"Eline"') && eline.includes('Merel of Michiel') && eline.includes(res.codes.find(c => c.familyId === 'eline').code) && eline.includes(TEST_PHONE));
});

console.log('=== safety ===');
await test('only a key of the test project is accepted: not the live project, not another one, not nothing', () => {
  assertTestProject({ project_id: TEST_PROJECT });
  for (const bad of [{ project_id: LIVE_PROJECT }, { project_id: 'something-else' }, {}, null]) assert.throws(() => assertTestProject(bad), /Refusing to write/);
});
await test('the target project is fixed in the script and never taken from the command line', () => {
  const src = readFileSync(repo + 'scripts/seed-test-data.mjs', 'utf8');
  assert.match(src, /createFirestore\(\{ projectId: TEST_PROJECT,/);
  assert.doesNotMatch(src, /arg\('--project'\)/);
});
await test('seed empties the test database first, then writes the copy, and checks the result', async () => {
  const store = new Map([['old/doc1', {}], ['families/old', {}], ['families/old/notifications/x', {}]]);
  const fs = {
    async *walk() { for (const p of [...store.keys()]) yield { path: p, missing: false }; yield { path: 'parentOnly', missing: true }; },
    async deleteDocument(p) { store.delete(p); },
    async setDocument(p, d) { store.set(p, d); },
  };
  const r = await seed({ fs, docs: res.docs });
  assert.equal(r.deleted, 3); assert.equal(r.written, res.docs.length);
  assert.deepEqual([...store.keys()].sort(), res.docs.map(d => d.path).sort());
});
await test('seed fails loudly when the database does not hold what was written', async () => {
  const store = new Map();
  const fs = { async *walk() { for (const p of store.keys()) yield { path: p, missing: false }; }, async deleteDocument() {}, async setDocument(p, d) { if (!p.startsWith('groups/')) store.set(p, d); } };
  await assert.rejects(seed({ fs, docs: res.docs }), /does not hold exactly/);
});

console.log('=== the command ===');
await test('npm run seed:test exists, and the README explains how to use it', () => {
  assert.match(JSON.parse(readFileSync(repo + 'package.json', 'utf8')).scripts['seed:test'], /seed-test-data\.mjs/);
  assert.match(readFileSync(repo + 'README.md', 'utf8'), /seed:test/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
