// family-backup.js — back-up and restore of "Gezinnen beheren" as one CSV file (pure functions, no screen, no database).
// One row per family: parent, daughter, type, coordinator (j/n), car capacity, phone numbers and, per weekday, the arrival
// (heen) and pick-up (terug) times plus the availability for heen and terug (beschikbaar / back-up / empty).
// The file opens in Excel / LibreOffice (semicolon-separated, UTF-8 with BOM) and can be edited there before it is restored.
// Restoring OVERWRITES the listed families; families that are not in the file are left alone. Errors are message keys (texts-nl.js).
import { DAYS } from './constants.js';
import { normalizePhone } from './coordinator.js';

export const BACKUP_DELIMITER = ';';
export const BACKUP_MAX_CAPACITY = 9;
const BOM = '﻿';

export const COL_ID = 'id', COL_PARENT = 'Ouder', COL_GIRL = 'Dochter', COL_TYPE = 'Type gezin', COL_COORD = 'Coördinator',
  COL_CAP = 'Autocapaciteit', COL_PHONE1 = 'Telefoon 1', COL_PHONE2 = 'Telefoon 2';
const dayCols = k => ({ heen: `${k} heen`, terug: `${k} terug`, avHeen: `${k} rijden heen`, avTerug: `${k} rijden terug` });
export const BACKUP_HEADERS = [
  COL_ID, COL_PARENT, COL_GIRL, COL_TYPE, COL_COORD, COL_CAP, COL_PHONE1, COL_PHONE2,
  ...DAYS.flatMap(([k]) => Object.values(dayCols(k))),
];

const AV = { yes: 'beschikbaar', backup: 'back-up' };
// A cell that starts with = + - @ is read as a formula by Excel / LibreOffice, so a parent could name herself "=HYPERLINK(...)".
// Such text gets a ' in front (shown as plain text). Phone numbers like +31612345678 are left alone, and the restore removes the '.
const FORMULA_START = /^[=+\-@\t\r]/, PLAIN_NUMBER = /^[+-]?[\d\s().-]+$/;
const guardFormula = s => FORMULA_START.test(s) && !PLAIN_NUMBER.test(s) ? "'" + s : s;
const unguardFormula = s => /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
const cell = v => {
  const s = guardFormula(v == null ? '' : String(v));
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const avLabel = (on, backup) => on ? AV.yes : backup ? AV.backup : '';

// The whole back-up as text. `coordinatorFamilyId`: the family that is coordinator now (config/coordinator), if any.
export function buildBackupCsv(families, coordinatorFamilyId){
  const rows = Object.entries(families || {})
    .sort((a, b) => (a[1].parentName || '').localeCompare(b[1].parentName || '', 'nl') || a[0].localeCompare(b[0]))
    .map(([id, f]) => {
      const sch = f.schedule || {}, av = f.availability || {};
      return [
        id, f.parentName || '', f.girlName || '', f.familyType === 'flex' ? 'flex' : 'vast', id === coordinatorFamilyId ? 'j' : 'n',
        f.capacity || 4, f.parentPhone1 || '', f.parentPhone2 || '',
        ...DAYS.flatMap(([k]) => {
          const s = sch[k] || {}, a = av[k] || {};
          return [s.heen || '', s.terug || '', avLabel(a.heen, a.backupHeen), avLabel(a.terug, a.backupTerug)];
        }),
      ];
    });
  return BOM + [BACKUP_HEADERS, ...rows].map(r => r.map(cell).join(BACKUP_DELIMITER)).join('\r\n') + '\r\n';
}

export function backupFileName(date){
  const d = date || new Date();
  const p = n => String(n).padStart(2, '0');
  return `az-carpool-gezinnen-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.csv`;
}

// Text -> rows of cells. Handles quotes, doubled quotes, CRLF/LF, and picks ; , or tab from the first line.
export function parseCsv(text){
  let s = String(text || '');
  if(s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  const first = s.split(/\r\n|\n|\r/)[0] || '';
  const count = ch => (first.match(new RegExp(ch === '\t' ? '\t' : '\\' + ch, 'g')) || []).length;
  const delim = [';', ',', '\t'].reduce((best, ch) => count(ch) > count(best) ? ch : best, ';');
  const rows = []; let row = [], cur = '', quoted = false, any = false;
  const endRow = () => { row.push(cur); cur = ''; if(row.some(c => c !== '')) rows.push(row); row = []; any = false; };
  for(let i = 0; i < s.length; i++){
    const c = s[i];
    if(quoted){
      if(c === '"'){ if(s[i + 1] === '"'){ cur += '"'; i++; } else quoted = false; }
      else cur += c;
    } else if(c === '"' && cur === ''){ quoted = true; any = true; }
    else if(c === delim){ row.push(cur); cur = ''; any = true; }
    else if(c === '\r' || c === '\n'){ if(c === '\r' && s[i + 1] === '\n') i++; endRow(); }
    else { cur += c; any = true; }
  }
  if(any || cur !== '' || row.length) endRow();
  return rows;
}

const norm = v => String(v == null ? '' : v).trim();
const fold = v => norm(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const TIME_RE = /^(\d{1,2})[:.](\d{2})$/;
// "8:30", "08.30" -> "08:30"; '' stays ''; anything else -> null (invalid).
export function cleanTime(v){
  const s = norm(v);
  if(!s) return '';
  const m = TIME_RE.exec(s);
  if(!m || +m[1] > 23 || +m[2] > 59) return null;
  return String(+m[1]).padStart(2, '0') + ':' + m[2];
}
// Excel drops the leading zero of 0612345678; a 9-digit number starting with 6 gets it back.
export function cleanPhone(v){
  const s = norm(v);
  return /^6\d{8}$/.test(s) ? '0' + s : s;
}
function yesNo(v){
  const s = fold(v);
  if(['j', 'ja', 'y', 'yes', 'true', '1'].includes(s)) return true;
  if(['', 'n', 'nee', 'no', 'false', '0'].includes(s)) return false;
  return null;
}
function availability(v){
  const s = fold(v).replace(/[\s_]/g, '');
  if(s === '') return { on: false, backup: false };
  if(['beschikbaar', 'ja', 'j', 'x'].includes(s)) return { on: true, backup: false };
  if(['back-up', 'backup'].includes(s)) return { on: false, backup: true };
  return null;
}

// Text -> { ok, rows, errors }. `rows` = [{ line, id, data, coordinator }] where `data` is exactly what is stored on families/<id>.
// One error anywhere means nothing may be restored (ok:false). errors = [{ line, key, params }].
export function parseBackup(text){
  const table = parseCsv(text);
  const errors = [], rows = [];
  if(!table.length) return { ok: false, rows, errors: [{ line: 0, key: 'backup.err.empty', params: {} }] };
  const head = table[0].map(h => fold(h));
  const idx = {};
  const missing = [];
  BACKUP_HEADERS.forEach(h => { const i = head.indexOf(fold(h)); if(i < 0) { if(h !== COL_ID) missing.push(h); } else idx[h] = i; });
  if(missing.length) return { ok: false, rows, errors: [{ line: 1, key: 'backup.err.columns', params: { p1: missing.slice(0, 4).join(', ') + (missing.length > 4 ? ', …' : '') } }] };
  const seenIds = new Set();
  table.slice(1).forEach((r, n) => {
    const line = n + 2;
    const get = h => (h in idx ? unguardFormula(norm(r[idx[h]])) : '');
    const err = (key, params) => errors.push({ line, key, params: params || {} });
    const parentName = get(COL_PARENT), girlName = get(COL_GIRL);
    if(!parentName && !girlName) return err('backup.err.noName');
    const typeRaw = fold(get(COL_TYPE));
    if(typeRaw && typeRaw !== 'vast' && typeRaw !== 'flex') err('backup.err.type', { p1: get(COL_TYPE) });
    const coordinator = yesNo(get(COL_COORD));
    if(coordinator === null) err('backup.err.coordinator', { p1: get(COL_COORD) });
    const capRaw = get(COL_CAP);
    const capacity = capRaw === '' ? 4 : (/^\d+$/.test(capRaw) ? +capRaw : NaN);
    if(!(capacity >= 1 && capacity <= BACKUP_MAX_CAPACITY)) err('backup.err.capacity', { p1: capRaw });
    const schedule = {}, avail = {};
    DAYS.forEach(([k]) => {
      const c = dayCols(k);
      const heen = cleanTime(get(c.heen)), terug = cleanTime(get(c.terug));
      if(heen === null) err('backup.err.time', { p1: c.heen, p2: get(c.heen) });
      if(terug === null) err('backup.err.time', { p1: c.terug, p2: get(c.terug) });
      const ah = availability(get(c.avHeen)), at = availability(get(c.avTerug));
      if(!ah) err('backup.err.avail', { p1: c.avHeen, p2: get(c.avHeen) });
      if(!at) err('backup.err.avail', { p1: c.avTerug, p2: get(c.avTerug) });
      schedule[k] = { heen: heen || '', terug: terug || '' };
      avail[k] = { heen: !!(ah && ah.on), terug: !!(at && at.on), backupHeen: !!(ah && ah.backup), backupTerug: !!(at && at.backup) };
    });
    const id = get(COL_ID);
    if(id){
      if(id.includes('/')) err('backup.err.id', { p1: id });
      else if(seenIds.has(id)) err('backup.err.dupId', { p1: id });
      seenIds.add(id);
    }
    const phone1 = cleanPhone(get(COL_PHONE1)), phone2 = cleanPhone(get(COL_PHONE2));
    rows.push({
      line, id, coordinator: coordinator === true,
      data: {
        familyType: typeRaw === 'flex' ? 'flex' : 'vast',
        parentName, girlName, parentPhone1: phone1, parentPhone2: phone2,
        phoneKeys: [phone1, phone2].map(normalizePhone).filter(Boolean),
        capacity, schedule, availability: avail,
      },
    });
  });
  if(!rows.length && !errors.length) errors.push({ line: 0, key: 'backup.err.empty', params: {} });
  if(rows.filter(r => r.coordinator).length > 1) errors.push({ line: 0, key: 'backup.err.manyCoord', params: {} });
  return { ok: errors.length === 0, rows, errors };
}

// What a restore will do to the families that exist now. Match order: the id in the file, then a unique
// daughter+parent name match, otherwise it becomes a new family. `newId()` makes ids for new families.
// Returns { ok, errors, items:[{ id, isNew, data, line }], untouched:[id], coordinatorFamilyId|null }.
export function planRestore(rows, families, currentCoordinatorId, newId){
  const errors = [], items = [], used = new Set();
  const key = f => fold(f.girlName) + '|' + fold(f.parentName);
  const byName = {};
  Object.entries(families || {}).forEach(([id, f]) => { (byName[key(f)] = byName[key(f)] || []).push(id); });
  rows.forEach(r => {
    let id = r.id && r.id.length ? r.id : '';
    if(!id){
      const hit = byName[key(r.data)];
      if(hit && hit.length === 1) id = hit[0];
    }
    const isNew = !id || !(families && id in families);
    if(!id) id = newId(r.data);
    if(used.has(id)) errors.push({ line: r.line, key: 'backup.err.sameFamily', params: { p1: r.data.girlName || r.data.parentName } });
    used.add(id);
    items.push({ id, isNew, data: r.data, line: r.line, coordinator: r.coordinator });
  });
  const coord = items.find(i => i.coordinator);
  return {
    ok: errors.length === 0, errors, items,
    untouched: Object.keys(families || {}).filter(id => !used.has(id)),
    coordinatorFamilyId: coord && coord.id !== currentCoordinatorId ? coord.id : null,
  };
}
