// test-support.js — shared helpers for the *.test.js files. Not a test itself.
// Gives tests: a fixed timezone/clock, a tiny fake DOM, a fake database wired into data.js, and a
// resettable copy of the app state (S) with the same sample families the app was verified against.
import './test-clock.js';
import { S } from '../state.js';
import { initDb, createFirestoreDb } from '../data.js';
import { createFakeFirestore } from './fake-db.js';

// ---------- clock ----------
const RealDate = globalThis.__RealDate;
function fakeDateClass(iso) {
  const fixed = new RealDate(iso).getTime();
  return class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(fixed); else super(...a); }
    static now() { return fixed; }
  };
}
export function withFakeNow(iso, fn) {
  const before = globalThis.Date;
  globalThis.Date = fakeDateClass(iso);
  try { return fn(); } finally { globalThis.Date = before; }
}
export async function withFakeNowAsync(iso, fn) {
  const before = globalThis.Date;
  globalThis.Date = fakeDateClass(iso);
  try { return await fn(); } finally { globalThis.Date = before; }
}
// Wednesday 30 September 2026, 10:00 Amsterdam time — the same "now" the browser regression harness uses.
export const NOW = '2026-09-30T10:00:00+02:00';
export const WEEK_KEY = '2026-W40';

// ---------- fake DOM ----------
function makeElement(id) {
  const classes = new Set();
  const attrs = {};
  const el = {
    id, innerHTML: '', textContent: '', value: '', checked: false, disabled: false, hidden: false,
    style: {}, dataset: {}, children: [], onclick: null, onchange: null, oninput: null,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle: c => (classes.has(c) ? (classes.delete(c), false) : (classes.add(c), true)) },
    setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: k => (k in attrs ? attrs[k] : null), removeAttribute: k => { delete attrs[k]; },
    addEventListener() {}, removeEventListener() {}, appendChild(c) { el.children.push(c); return c; }, remove() {},
    querySelector: () => makeElement(''), querySelectorAll: () => [], focus() {}, scrollIntoView() {}, click() { if (el.onclick) el.onclick(); },
  };
  return el;
}
export function installFakeDom() {
  const byId = new Map();
  const doc = {
    getElementById: id => { if (!byId.has(id)) byId.set(id, makeElement(id)); return byId.get(id); },
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => makeElement(''), addEventListener() {}, removeEventListener() {},
    documentElement: makeElement('html'), body: makeElement('body'), hidden: false,
  };
  const store = new Map();
  const opened = [];
  // Timers made by the app (toast hide, confirm reset) must not keep the test process alive.
  if (!globalThis.__timersUnrefd) {
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...a) => { const h = realSetTimeout(fn, ms, ...a); if (h && h.unref) h.unref(); return h; };
    globalThis.__timersUnrefd = true;
  }
  globalThis.document = doc;
  globalThis.window = globalThis;
  globalThis.window.open = (...a) => { opened.push(a); return null; };
  globalThis.window.addEventListener = () => {};
  globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  globalThis.location = { hash: '', href: 'https://mveen.github.io/AZ-Carpool/' };
  globalThis.matchMedia = () => ({ matches: false });
  return { doc, opened, el: id => doc.getElementById(id), html: id => doc.getElementById(id).innerHTML, reset: () => { byId.clear(); opened.length = 0; store.clear(); } };
}

// ---------- fake database wired into data.js ----------
export function useFakeDb(seed = {}, opts) {
  const fake = createFakeFirestore(seed, opts);
  initDb(createFirestoreDb({ sdk: fake.sdk, firestoreDb: fake.firestoreDb, auth: fake.auth, calendarApiKey: 'test-key' }));
  return fake;
}

// ---------- app state ----------
const INITIAL = structuredClone(S);
export function resetState(patch = {}) {
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, structuredClone(INITIAL), { currentWeekKey: WEEK_KEY, scheduleDay: 'Wo' }, patch);
  return S;
}

// ---------- sample data (same people as the browser regression harness) ----------
const DAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr'];
function family(parentName, girlName, capacity, times, availDays, phone) {
  const schedule = {}, availability = {};
  DAYS.forEach(d => {
    const t = times[d] || ['', ''];
    schedule[d] = { heen: t[0], terug: t[1] };
    const on = availDays.includes(d);
    availability[d] = { heen: on, terug: on, backupHeen: false, backupTerug: false };
  });
  return { parentName, girlName, parentPhone1: phone, parentPhone2: '', phoneKeys: [phone], capacity, schedule, availability };
}
export function sampleFamilies() {
  const T1 = { Ma: ['08:30', '17:00'], Di: ['10:15', '17:30'], Wo: ['', '16:00'], Do: ['08:30', '17:00'], Vr: ['11:00', ''] };
  const T2 = { Ma: ['08:30', '17:30'], Di: ['10:15', '17:30'], Do: ['10:15', '18:00'], Vr: ['11:00', '17:00'] };
  const T3 = { Ma: ['10:15', '17:00'], Wo: ['11:00', '16:00'], Do: ['08:30', '17:00'] };
  const T4 = { Ma: ['11:00', '18:00'], Di: ['11:00', '17:30'], Do: ['10:15', '17:00'] };
  return {
    f1: family('Jan Jansen', 'Eline', 4, T1, ['Ma', 'Do'], '0611111111'),
    f2: family('Piet Pieters', 'Jahaimy', 5, T2, ['Ma', 'Di', 'Do'], '0622222222'),
    f3: family('Kees de Vries', 'Anouk', 6, T3, ['Ma', 'Wo'], '0633333333'),
    f4: family('Mo Bakker', 'Evi', 4, T4, ['Di', 'Do'], '0644444444'),
    f5: family('Sanne Smit', 'Lois', 4, T1, [], '0655555555'),
    f6: family('Tom Visser', 'Saar', 4, T2, ['Ma'], '0666666666'),
  };
}
export function sampleGroups() {
  return {
    Ma_heen_1: { day: 'Ma', direction: 'heen', girlIds: ['f1', 'f2'], driverFamilyId: 'f1', reserveFamilyIds: ['f3'], departureTime: '07:30' },
    Ma_terug_1: { day: 'Ma', direction: 'terug', girlIds: ['f1', 'f2', 'f6'], driverFamilyId: 'f2', reserveFamilyIds: [], departureTime: '17:30' },
  };
}
export function sampleDeviations() {
  return { Di_heen: { day: 'Di', direction: 'heen', weekKey: WEEK_KEY, expiresAt: 1791500000000, cars: [{ driverFamilyId: 'f3', girlIds: ['f1', 'f4'], reserveFamilyIds: [], departureTime: '09:15' }] } };
}
// A full "parent p1 (family f2) is looking at the app" state.
export function sampleParentState(patch = {}) {
  return resetState({ me: 'p1', appReady: true, links: { p1: { familyId: 'f2' } }, families: sampleFamilies(), groups: sampleGroups(), deviations: sampleDeviations(), ...patch });
}
export function sampleCoordinatorState(patch = {}) {
  return resetState({ me: 'coord', appReady: true, coordinatorExists: true, coordinatorConfig: { uid: 'coord', familyId: 'f1' }, canEdit: true, links: {}, families: sampleFamilies(), groups: sampleGroups(), deviations: sampleDeviations(), ...patch });
}
// Seed for the fake database: same documents as the state samples.
export function sampleDbSeed() {
  const seed = { 'config/coordinator': { uid: 'coord', familyId: 'f1' } };
  Object.entries(sampleFamilies()).forEach(([id, f]) => { seed['families/' + id] = f; });
  Object.entries(sampleGroups()).forEach(([id, g]) => { seed['groups/' + id] = g; });
  Object.entries(sampleDeviations()).forEach(([id, d]) => { seed['deviations/' + id] = d; });
  return seed;
}

// ---------- snapshots for the render tests ----------
// expectSnapshot('ui-myweek', 'parent view', html): first run writes the snapshot, later runs compare.
// Refresh deliberately with:  UPDATE_SNAPSHOTS=1 npm test
import fs from 'node:fs';
import assert from 'node:assert/strict';
export function expectSnapshot(file, name, actual) {
  const dir = new URL('./__snapshots__/', import.meta.url);
  fs.mkdirSync(dir, { recursive: true });
  const path = new URL(file + '.snap.json', dir);
  const snaps = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : {};
  if (process.env.UPDATE_SNAPSHOTS || !(name in snaps)) {
    snaps[name] = actual;
    fs.writeFileSync(path, JSON.stringify(Object.fromEntries(Object.entries(snaps).sort()), null, 1) + '\n');
    return;
  }
  assert.equal(actual, snaps[name], `Snapshot "${name}" in ${file}.snap.json changed. If the change is intended, run: UPDATE_SNAPSHOTS=1 npm test`);
}
