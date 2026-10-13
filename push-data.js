// push-data.js — push notifications, TEST PHASE: everything that reads or writes the database or the browser's push service.
// The rules are in push.js, the screens in ui-push.js, the server job in cron/push.mjs. Coordinator only (push-access.js).
//
// What happens here:
//  - the master switch settings/push (uit | test),
//  - this browser's device (pushDevices/<id>): subscribe to the push service and store the address for the server,
//  - the made-up scenarios: they store notifications in testNotifications/ and (switch on) put them in pushQueue/ for the server,
//  - the listeners that feed the screen.
// Nothing here writes to offers, backupMoments, deviations or a family's own notifications.
import { t } from './i18n.js';
import { S } from './state.js';
import { DAYS } from './constants.js';
import { weekKeyDayIso } from './dates.js';
import { dayCoordinatorFor, isRealCoordinator } from './coordinator.js';
import { db } from './data.js';
import { showToast } from './ui-common.js';
import { pushVisible } from './push-access.js';
import { quietOf, ridesOf } from './ritbeurs-data.js';
import { CONFLICT_MINUTES, toMin } from './ritbeurs.js';
import { notificationText } from './notif-text.js';
import {
  bufferToBase64Url, deviceDoc, deviceId, deviceLabelFromUA, normalizePush, previewState, pushSettingsDoc, queueDoc, queueKey, recipientLabel,
  urlBase64ToUint8Array,
} from './push.js';
import { buildScenario, scenarioMoment } from './push-scenarios.js';
import { refreshPushCard } from './ui-push.js';
import { renderDeviationTab } from './ui-deviation.js';

const PERSONA_KEY = 'az-push-persona';
const SUBSCRIBE_TIMEOUT_MS = 20000;   // a push service that does not answer must not leave the screen waiting for ever
const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(t('push.err.timeout'))), ms);
  promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
});
const busyAround = (familyId, date, time) => ridesOf(familyId).some(r => r.date === date && toMin(r.time) != null && toMin(time) != null && Math.abs(toMin(r.time) - toMin(time)) < CONFLICT_MINUTES);

export function pushMode(){ return normalizePush(S.pushSettings).mode; }
const allowed = () => !!db && pushVisible() && isRealCoordinator();

// ---------- the master switch ----------
export async function setPushMode(mode){
  if(!db){ showToast(t('data.geen_verbinding_met_opslag')); return false; }
  if(!allowed()){ showToast(t('push.err.alleenCoordinator')); return false; }
  const want = mode === 'test' ? 'test' : 'uit';
  try{
    await db.doc('settings/push').set(pushSettingsDoc(want, Date.now()));
    S.pushSettings = normalizePush({ mode: want });
    showToast(t(want === 'test' ? 'push.toast.testAan' : 'push.toast.uit'));
    return true;
  }catch(e){ showToast(t('data.mislukt') + (e && e.message || e)); return false; }
}

// ---------- what this browser can do ----------
// 'ok' | 'geenSupport' | 'iosInstalleren' (iPhone/iPad in Safari: push only works for the app on the home screen)
export function pushSupport(g = globalThis){
  const nav = g.navigator || {};
  const ios = /iPhone|iPad|iPod/.test(String(nav.userAgent || ''));
  const standalone = !!(nav.standalone || (g.matchMedia && g.matchMedia('(display-mode: standalone)').matches));
  if(ios && !standalone) return 'iosInstalleren';
  return ('serviceWorker' in nav) && !!g.PushManager && !!g.Notification ? 'ok' : 'geenSupport';
}
export const permissionState = (g = globalThis) => (g.Notification && g.Notification.permission) || 'unsupported';

// Subscribes this browser and stores its address for the server. Returns { ok:true, id } or { ok:false, reason }.
// reason: 'niet-toegestaan' | 'geenSupport' | 'iosInstalleren' | 'geenSleutel' | 'geweigerd' | 'ongeldig' | 'mislukt'
export async function enablePush(g = globalThis, { timeoutMs = SUBSCRIBE_TIMEOUT_MS } = {}){
  if(!allowed()) return { ok: false, reason: 'niet-toegestaan' };
  const support = pushSupport(g);
  if(support !== 'ok') return { ok: false, reason: support };
  const publicKey = S.push.key && S.push.key.publicKey;
  if(!publicKey) return { ok: false, reason: 'geenSleutel' };
  try{
    let perm = g.Notification.permission;
    if(perm === 'default') perm = await g.Notification.requestPermission();
    if(perm !== 'granted') return { ok: false, reason: 'geweigerd' };
    const reg = await withTimeout(g.navigator.serviceWorker.ready, timeoutMs);
    const options = { userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) };
    let sub = await reg.pushManager.getSubscription();
    if(!sub){ sub = await withTimeout(reg.pushManager.subscribe(options), timeoutMs); }
    const json = sub.toJSON ? sub.toJSON() : {};
    const keys = json.keys || { p256dh: bufferToBase64Url(sub.getKey && sub.getKey('p256dh')), auth: bufferToBase64Url(sub.getKey && sub.getKey('auth')) };
    const doc = deviceDoc({ endpoint: json.endpoint || sub.endpoint, p256dh: keys.p256dh, auth: keys.auth, label: deviceLabelFromUA(g.navigator.userAgent), uid: S.me, nowMs: Date.now() });
    if(!doc) return { ok: false, reason: 'ongeldig' };
    const id = deviceId(doc.endpoint);
    const ref = db.doc('pushDevices/' + id);
    const existing = await ref.get();
    if(existing.exists){ const { endpoint, p256dh, auth, label, uid } = doc; await ref.update({ endpoint, p256dh, auth, label, uid }); }
    else await ref.set(doc);
    S.push.thisDeviceId = id;
    showToast(t('push.toast.toestelAan'));
    return { ok: true, id };
  }catch(e){ showToast(t('data.mislukt') + (e && e.message || e)); return { ok: false, reason: 'mislukt' }; }
}

// The device document of this browser, if it is subscribed (so the card can say "dit toestel").
export async function findThisDevice(g = globalThis){
  try{
    if(pushSupport(g) !== 'ok') return '';
    const reg = await g.navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? deviceId(sub.endpoint) : '';
  }catch(e){ return ''; }
}

// Removes a device from the list; when it is this browser, the subscription itself is cancelled as well.
export async function removeDevice(id, g = globalThis){
  if(!allowed()) return false;
  try{
    if(id === S.push.thisDeviceId){
      try{ const reg = await g.navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if(sub) await sub.unsubscribe(); }catch(e){ /* the document goes anyway */ }
      S.push.thisDeviceId = '';
    }
    await db.doc('pushDevices/' + id).delete();
    showToast(t('push.toast.toestelWeg'));
    return true;
  }catch(e){ showToast(t('data.mislukt') + (e && e.message || e)); return false; }
}
export async function setDeviceCategory(id, category, on){
  if(!allowed() || !S.push.devices[id]) return false;
  try{
    await db.doc('pushDevices/' + id).update({ categories: { ...(S.push.devices[id].categories || {}), [category]: !!on } });
    return true;
  }catch(e){ showToast(t('data.mislukt') + (e && e.message || e)); return false; }
}

// ---------- the persona ("Ik ben Ouder van Saar") ----------
export function setPersona(id){
  S.push.personaId = id && S.families[id] ? id : '';
  try{ if(S.push.personaId) localStorage.setItem(PERSONA_KEY, S.push.personaId); else localStorage.removeItem(PERSONA_KEY); }catch(e){ /* a remembered choice is a convenience */ }
  syncPersonaListener();
  refreshPushCard(true);
}
export function rememberedPersona(){
  try{ const id = localStorage.getItem(PERSONA_KEY); return id && S.families[id] ? id : ''; }catch(e){ return ''; }
}
function syncPersonaListener(){
  const want = allowed() && S.push.personaId ? S.push.personaId : null;
  if(S.push.personaFor === want) return;
  if(S.push.personaUnsub){ try{ S.push.personaUnsub(); }catch(e){} S.push.personaUnsub = null; }
  S.push.personaNotifs = {}; S.push.personaFor = want;
  if(want){
    S.push.personaUnsub = db.collection(`families/${want}/notifications`).onSnapshot(snap => {
      S.push.personaNotifs = {}; snap.docs.forEach(d => S.push.personaNotifs[d.id] = d.data());
      refreshPushCard();
    }, err => {});
  }
}

// ---------- listeners (coordinator only) ----------
export function syncPushListeners(){
  const want = allowed() && !!S.me;
  if(want && !S.push.unsubs.length){
    const on = (path, fn) => S.push.unsubs.push(db.doc(path).onSnapshot(snap => { fn(snap); refreshPushCard(); }, err => {}));
    const onColl = (path, key) => S.push.unsubs.push(db.collection(path).onSnapshot(snap => {
      S.push[key] = {}; snap.docs.forEach(d => S.push[key][d.id] = d.data());
      refreshPushCard();
      if(key === 'tests' && S.impersonateFamilyId) renderDeviationTab();   // the made-up notifications of a family are part of its inbox in Testweergave
    }, err => {}));
    on('settings/pushKey', snap => { S.push.key = snap.exists ? snap.data() : null; });
    on('settings/pushStatus', snap => { S.push.status = snap.exists ? snap.data() : null; });
    onColl('pushDevices', 'devices');
    onColl('pushQueue', 'queue');
    onColl('testNotifications', 'tests');
    if(!S.push.personaId) S.push.personaId = rememberedPersona();
    findThisDevice().then(id => { S.push.thisDeviceId = id; refreshPushCard(); });
  }
  if(!want && S.push.unsubs.length) stopPushListeners();
  if(want) syncPersonaListener();
}
export function stopPushListeners(){
  S.push.unsubs.forEach(u => { try{ u(); }catch(e){} });
  S.push.unsubs = [];
  if(S.push.personaUnsub){ try{ S.push.personaUnsub(); }catch(e){} S.push.personaUnsub = null; }
  Object.assign(S.push, { key: null, status: null, devices: {}, queue: {}, tests: {}, personaNotifs: {}, personaFor: null, last: null, thisDeviceId: '' });
}

// ---------- scenarios ----------
// The data the scenario builder needs, from the current app state.
export function scenarioContext(personaId, choice, nowMs = Date.now()){
  const simMs = scenarioMoment(choice, nowMs, quietOf(personaId));
  const weekKey = S.currentWeekKey;
  const d = new Date(nowMs);
  const todayIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // The ride to use when nobody drives anything this week: the next working day of the planning week, 16:15 heen.
  const days = DAYS.map(([k]) => [k, weekKeyDayIso(weekKey, k)]);
  const [dayKey, iso] = days.find(([, date]) => date > todayIso) || days[0];
  return {
    personaId, families: S.families, nowMs, simMs, quietOf, ridesOf, moments: S.moments, busy: busyAround, weekKey,
    dayCoordinatorOf: day => { const dc = dayCoordinatorFor(S, day); return dc ? dc.familyId : ''; },
    fallbackRide: { day: dayKey, direction: 'heen', date: iso, time: '16:15' },
  };
}

// Plays a scenario: stores the made-up notifications and, with the switch on, queues the persona's own for the server.
export async function runScenario(id, choice){
  if(!allowed()){ showToast(t('push.err.alleenCoordinator')); return null; }
  const personaId = S.push.personaId;
  if(!personaId){ showToast(t('push.err.kiesGezin')); return null; }
  const choiceNow = choice === 'nacht' ? 'nacht' : 'nu';
  S.push.timeChoice = choiceNow;
  const nowMs = Date.now();
  const ctx = scenarioContext(personaId, choiceNow, nowMs);
  const res = buildScenario(id, ctx);
  if(res.error){ showToast(t(res.error === 'geenAnder' ? 'push.err.geenAnder' : 'push.err.kiesGezin')); return null; }
  try{
    const batch = db.batch();
    res.rows.forEach(r => batch.set('testNotifications/' + r.id, r.doc));
    const queued = [];
    if(pushMode() === 'test') res.rows.filter(r => r.persona).forEach(r => { const q = queueEntryFor(r, nowMs); batch.set('pushQueue/' + q.key, q.doc); queued.push(r.id); });
    await batch.commit();
    S.push.last = { id, rows: res.rows.map(r => ({ id: r.id, toFamilyId: r.toFamilyId, persona: r.persona, why: r.why })), explain: res.explain, ride: res.ride, simMs: ctx.simMs, nowMs };
    S.push.tests = { ...S.push.tests, ...Object.fromEntries(res.rows.map(r => [r.id, r.doc])) };
    showToast(t(queued.length ? 'push.toast.scenarioWachtrij' : 'push.toast.scenario'));
    refreshPushCard(true);
    return res;
  }catch(e){ showToast(t('data.opslaan_mislukt') + (e && e.message || e)); return null; }
}

function queueEntryFor(row, nowMs, { suffix, deliverNow } = {}){
  const path = 'testNotifications/' + row.id;
  return {
    key: queueKey(path, suffix),
    doc: queueDoc({ path, toFamilyId: row.toFamilyId, kind: row.doc.kind, deliverAt: deliverNow ? nowMs : row.doc.deliverAt, expiresAt: row.doc.expiresAt, nowMs, test: true }),
  };
}

// "Stuur naar mijn toestel": queue one notification (made-up or real) for the server right now, ignoring quiet hours.
export async function sendToMyDevice(path){
  if(!allowed()){ showToast(t('push.err.alleenCoordinator')); return false; }
  if(pushMode() !== 'test'){ showToast(t('push.err.zetTestAan')); return false; }
  const n = path.startsWith('testNotifications/') ? S.push.tests[path.slice(18)] : S.push.personaNotifs[path.split('/').pop()];
  if(!n){ showToast(t('push.err.meldingWeg')); return false; }
  const nowMs = Date.now();
  try{
    const entry = { path, toFamilyId: n.toFamilyId, kind: n.kind, deliverAt: nowMs, expiresAt: Math.max(n.expiresAt || 0, nowMs + 3600 * 1000), createdAt: nowMs, test: path.startsWith('testNotifications/') };
    await db.doc('pushQueue/' + queueKey(path, 'm' + nowMs)).set(entry);
    showToast(t('push.toast.verstuurd'));
    return true;
  }catch(e){ showToast(t('data.opslaan_mislukt') + (e && e.message || e)); return false; }
}

// Removes all made-up notifications and their queue entries.
export async function clearTests(){
  if(!allowed()) return false;
  try{
    const batch = db.batch();
    Object.keys(S.push.tests).forEach(id => batch.delete('testNotifications/' + id));
    Object.entries(S.push.queue).forEach(([key, q]) => { if(q && q.test) batch.delete('pushQueue/' + key); });
    await batch.commit();
    S.push.tests = {}; S.push.last = null;
    showToast(t('push.toast.opgeruimd'));
    refreshPushCard(true);
    return true;
  }catch(e){ showToast(t('data.mislukt') + (e && e.message || e)); return false; }
}

// ---------- the preview list ----------
// The notifications of the chosen family as that family would see them: made-up ones and real ones, newest first.
//   [{ path, source:'test'|'echt', id, n, text, state, push }]   push: 'verstuurd' | 'wachtrij' | 'geen' (what happened with the copy for this coordinator's device)
export function previewItems(nowMs = Date.now()){
  const p = S.push;
  if(!p.personaId) return [];
  const nameOf = id => (S.families[id] && (S.families[id].parentName || S.families[id].girlName)) || '';
  const list = [];
  Object.entries(p.tests || {}).forEach(([id, n]) => { if(n && n.toFamilyId === p.personaId) list.push({ path: 'testNotifications/' + id, source: 'test', id, n }); });
  Object.entries(p.personaNotifs || {}).forEach(([id, n]) => { if(n) list.push({ path: `families/${p.personaId}/notifications/${id}`, source: 'echt', id, n }); });
  const entries = Object.values(p.queue || {});
  return list
    .map(x => {
      const mine = entries.filter(q => q && q.path === x.path);
      const sent = mine.some(q => q.sentTo && Object.keys(q.sentTo).length);
      return { ...x, text: notificationText(x.n, { nameOf, currentWeekKey: S.currentWeekKey }), state: previewState(x.n, nowMs), push: sent ? 'verstuurd' : mine.length ? 'wachtrij' : 'geen' };
    })
    .filter(x => x.text)
    .sort((a, b) => (b.n.createdAt || 0) - (a.n.createdAt || 0))
    .slice(0, 12);
}

export function personaName(){ return S.push.personaId ? recipientLabel(S.families[S.push.personaId], S.push.personaId) : ''; }
