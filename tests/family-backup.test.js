// Run with: node family-backup.test.js
// Back-up and restore of the families as one CSV file (pure functions): building, reading, checking and planning the restore.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { sampleFamilies } from './test-support.js';
import { BACKUP_HEADERS, backupFileName, buildBackupCsv, cleanPhone, cleanTime, parseBackup, parseCsv, planRestore } from '../family-backup.js';

const newId = d => 'new-' + d.girlName;
// One valid row, as text, with the headers of a real back-up.
const row = (over = {}) => {
  const base = Object.fromEntries(BACKUP_HEADERS.map(h => [h, '']));
  Object.assign(base, { id: 'fx', Ouder: 'Ouder X', Dochter: 'Dochter X', 'Type gezin': 'vast', 'Coördinator': 'n', Autocapaciteit: '4', 'Telefoon 1': '0612345678' }, over);
  return BACKUP_HEADERS.map(h => base[h]).join(';');
};
const file = (...rows) => [BACKUP_HEADERS.join(';'), ...rows].join('\r\n');

console.log('=== building the back-up ===');
test('the header holds every requested field: names, type, coordinator, capacity, phone, times and availability per day', () => {
  for (const h of ['Ouder', 'Dochter', 'Type gezin', 'Coördinator', 'Autocapaciteit', 'Telefoon 1', 'Ma heen', 'Ma terug', 'Ma rijden heen', 'Ma rijden terug', 'Vr rijden terug']) assert.ok(BACKUP_HEADERS.includes(h), h);
});
test('one row per family, sorted by parent, coordinator j/n, availability beschikbaar / back-up / empty', () => {
  const fams = sampleFamilies();
  fams.f2.availability.Di = { heen: false, terug: false, backupHeen: true, backupTerug: false };
  fams.f2.familyType = 'flex';
  const lines = buildBackupCsv(fams, 'f1').replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines.length, 7);
  const f1 = lines.find(l => l.startsWith('f1;')).split(';'), f2 = lines.find(l => l.startsWith('f2;')).split(';');
  assert.deepEqual(f1.slice(0, 8), ['f1', 'Jan Jansen', 'Eline', 'vast', 'j', '4', '0611111111', '']);
  assert.equal(f2[3], 'flex'); assert.equal(f2[4], 'n');
  const col = h => BACKUP_HEADERS.indexOf(h);
  assert.equal(f1[col('Ma heen')], '08:30'); assert.equal(f1[col('Ma terug')], '17:00'); assert.equal(f1[col('Ma rijden heen')], 'beschikbaar');
  assert.equal(f2[col('Di rijden heen')], 'back-up'); assert.equal(f2[col('Di rijden terug')], '');
});
test('the file starts with a BOM (Excel reads UTF-8) and quotes cells with ; " or line breaks', () => {
  const csv = buildBackupCsv({ a: { parentName: 'Jan; "de" man', girlName: 'Ë', capacity: 4 } });
  assert.equal(csv.charCodeAt(0), 0xFEFF); assert.match(csv, /"Jan; ""de"" man"/);
});
test('the file name carries the date', () => { assert.equal(backupFileName(new Date(2026, 8, 5)), 'az-carpool-gezinnen-2026-09-05.csv'); });

console.log('=== reading CSV ===');
test('parseCsv: quotes, doubled quotes, line breaks inside quotes, CRLF and BOM', () => {
  assert.deepEqual(parseCsv('﻿a;b\r\n"x;1";"he said ""hi"""\r\n"l1\nl2";z\r\n'), [['a', 'b'], ['x;1', 'he said "hi"'], ['l1\nl2', 'z']]);
});
test('parseCsv picks the delimiter: comma and tab files (other spreadsheet programs) work too', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});
test('parseCsv skips empty lines', () => { assert.deepEqual(parseCsv('a;b\n;\n\n1;2\n'), [['a', 'b'], ['1', '2']]); });
test('cleanTime: 8:30 and 08.30 become 08:30, empty stays empty, nonsense is refused', () => {
  assert.equal(cleanTime('8:30'), '08:30'); assert.equal(cleanTime('08.30'), '08:30'); assert.equal(cleanTime(''), ''); assert.equal(cleanTime('25:00'), null); assert.equal(cleanTime('half negen'), null);
});
test("cleanPhone: Excel's dropped leading zero comes back, other numbers stay as typed", () => {
  assert.equal(cleanPhone('612345678'), '0612345678'); assert.equal(cleanPhone('06-12345678'), '06-12345678'); assert.equal(cleanPhone('+31612345678'), '+31612345678');
});

console.log('=== round trip ===');
test('a back-up of the sample families restores to exactly the same stored data', () => {
  const fams = sampleFamilies();
  fams.f3.familyType = 'flex'; fams.f3.parentPhone2 = '0688888888'; fams.f3.phoneKeys = ['0633333333', '0688888888'];
  fams.f4.availability.Do = { heen: false, terug: true, backupHeen: true, backupTerug: false };
  const res = parseBackup(buildBackupCsv(fams, 'f2'));
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.rows.length, 6);
  for (const r of res.rows) {
    const o = fams[r.id];
    assert.deepEqual(r.data, { familyType: o.familyType || 'vast', parentName: o.parentName, girlName: o.girlName, parentPhone1: o.parentPhone1, parentPhone2: o.parentPhone2, phoneKeys: o.phoneKeys, capacity: o.capacity, schedule: o.schedule, availability: o.availability }, r.id);
  }
  assert.deepEqual(res.rows.filter(r => r.coordinator).map(r => r.id), ['f2']);
});
test('Dutch-Excel style: extra spaces, capitals, "Ja" and "BackUp" are accepted', () => {
  const res = parseBackup(file(row({ 'Coördinator': ' Ja ', 'Type gezin': 'Flex', 'Ma rijden heen': 'BackUp', 'Ma heen': '8:30', 'Di rijden terug': 'Beschikbaar' })));
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  const r = res.rows[0];
  assert.equal(r.coordinator, true); assert.equal(r.data.familyType, 'flex'); assert.equal(r.data.availability.Ma.backupHeen, true); assert.equal(r.data.schedule.Ma.heen, '08:30'); assert.equal(r.data.availability.Di.terug, true);
});
test('an empty capacity becomes 4 and a file without id column still works (columns in any order)', () => {
  const heads = BACKUP_HEADERS.filter(h => h !== 'id').reverse();
  const vals = heads.map(h => ({ Ouder: 'O', Dochter: 'D' })[h] || '');
  const res = parseBackup(heads.join(';') + '\n' + vals.join(';'));
  assert.equal(res.ok, true, JSON.stringify(res.errors)); assert.equal(res.rows[0].data.capacity, 4); assert.equal(res.rows[0].id, '');
});

console.log('=== refusing a bad file ===');
const errKeys = text => parseBackup(text).errors.map(e => e.key);
test('an empty file, or only a header, is refused', () => { assert.deepEqual(errKeys(''), ['backup.err.empty']); assert.deepEqual(errKeys(file()), ['backup.err.empty']); });
test('missing columns are named', () => {
  const r = parseBackup('Ouder;Dochter\nA;B');
  assert.equal(r.ok, false); assert.equal(r.errors[0].key, 'backup.err.columns'); assert.match(r.errors[0].params.p1, /Autocapaciteit/);
});
test('every kind of wrong value is reported with its line, and nothing is partly accepted', () => {
  const res = parseBackup(file(
    row({ id: 'a' }),
    row({ id: 'b', 'Type gezin': 'half' }),
    row({ id: 'c', 'Coördinator': 'misschien' }),
    row({ id: 'd', Autocapaciteit: '12' }),
    row({ id: 'e', 'Di heen': '9 uur' }),
    row({ id: 'f', 'Wo rijden terug': 'soms' }),
    row({ id: 'g', Ouder: '', Dochter: '' }),
    row({ id: 'a' }),
    row({ id: 'h/i' }),
  ));
  assert.equal(res.ok, false);
  assert.deepEqual(res.errors.map(e => [e.line, e.key]), [[3, 'backup.err.type'], [4, 'backup.err.coordinator'], [5, 'backup.err.capacity'], [6, 'backup.err.time'], [7, 'backup.err.avail'], [8, 'backup.err.noName'], [9, 'backup.err.dupId'], [10, 'backup.err.id']]);
});
test('capacity 0, a negative number and a decimal are refused', () => { for (const c of ['0', '-2', '4.5', 'vier']) assert.deepEqual(errKeys(file(row({ Autocapaciteit: c }))), ['backup.err.capacity'], c); });
test('two coordinators in one file are refused', () => { assert.deepEqual(errKeys(file(row({ id: 'a', 'Coördinator': 'j' }), row({ id: 'b', 'Coördinator': 'j' }))), ['backup.err.manyCoord']); });

console.log('=== planning the restore ===');
const existing = () => sampleFamilies();
const rowsOf = (...r) => parseBackup(file(...r)).rows;
test('a known id overwrites that family; families not in the file are left alone', () => {
  const plan = planRestore(rowsOf(row({ id: 'f2', Ouder: 'Piet P.', Dochter: 'Jahaimy' })), existing(), 'f1', newId);
  assert.equal(plan.ok, true); assert.deepEqual(plan.items.map(i => [i.id, i.isNew]), [['f2', false]]);
  assert.deepEqual(plan.untouched, ['f1', 'f3', 'f4', 'f5', 'f6']);
});
test('an id that does not exist (family was deleted) is created again under the same id', () => {
  const plan = planRestore(rowsOf(row({ id: 'weg', Dochter: 'Nieuw' })), existing(), null, newId);
  assert.deepEqual(plan.items.map(i => [i.id, i.isNew]), [['weg', true]]);
});
test('without an id a unique daughter+parent match is used, otherwise a new family is made', () => {
  const plan = planRestore(rowsOf(row({ id: '', Ouder: 'piet pieters', Dochter: 'JAHAIMY' }), row({ id: '', Ouder: 'Iemand', Dochter: 'Anders' })), existing(), null, newId);
  assert.deepEqual(plan.items.map(i => [i.id, i.isNew]), [['f2', false], ['new-Anders', true]]);
});
test('two rows for the same family are refused', () => {
  const plan = planRestore(rowsOf(row({ id: 'f2' }), row({ id: '', Ouder: 'Piet Pieters', Dochter: 'Jahaimy' })), existing(), null, newId);
  assert.equal(plan.ok, false); assert.equal(plan.errors[0].key, 'backup.err.sameFamily');
});
test('the coordinator changes only when the file names another family than the current one', () => {
  const same = planRestore(rowsOf(row({ id: 'f1', 'Coördinator': 'j' })), existing(), 'f1', newId);
  assert.equal(same.coordinatorFamilyId, null);
  const other = planRestore(rowsOf(row({ id: 'f3', 'Coördinator': 'j' })), existing(), 'f1', newId);
  assert.equal(other.coordinatorFamilyId, 'f3');
  const none = planRestore(rowsOf(row({ id: 'f3', 'Coördinator': 'n' })), existing(), 'f1', newId);
  assert.equal(none.coordinatorFamilyId, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
