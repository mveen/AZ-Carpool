// Firestore rules test for the Afwijkend weekrooster. Needs the Firestore emulator on port 8089 and: npm i @firebase/rules-unit-testing firebase.
// Start: firebase emulators:start --only firestore (rules = firebase/firestore.rules, port 8089), then: node weekrooster-rules.test.mjs
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, deleteDoc, getDocs, collection, query, where } from 'firebase/firestore';
import fs from 'node:fs';
const env = await initializeTestEnvironment({ projectId: 'demo-test', firestore: { host: '127.0.0.1', port: 8089, rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
let ok = 0, bad = 0;
const check = async (name, p, expectOk = true) => { try { await (expectOk ? assertSucceeds(p) : assertFails(p)); ok++; console.log('  ✓', name); } catch (e) { bad++; console.log('  ✗', name, String(e.message).slice(0, 120)); } };
// f1 = coordinator's family (uid 'coord'); f2 = day coordinator of Do; f3, f4 = ordinary families. Do is coordinated by f2, Vr by f3.
const reset = async (mode) => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'config/coordinator'), { uid: 'coord' });
    for (const f of ['f1', 'f2', 'f3', 'f4']) await setDoc(doc(d, 'families/' + f), { parentName: f });
    for (const [u, f] of [['u1', 'f1'], ['u2', 'f2'], ['u3', 'f3'], ['u4', 'f4']]) await setDoc(doc(d, 'links/' + u), { familyId: f });
    await setDoc(doc(d, 'settings/dayCoordinators'), { Do: 'f2', Vr: 'f3' });
    if (mode !== null) await setDoc(doc(d, 'settings/weekrooster'), typeof mode === 'string' ? { mode } : mode);
  });
};
const as = u => env.authenticatedContext(u).firestore();
const WK = '2026-W41';
const id = (day, fam) => `${WK}_${day}_${fam}`;
const req = (day, fam, extra = {}) => ({ weekKey: WK, day, familyId: fam, rides: true, heen: '16:30', terug: '17:45', status: 'pending', createdAt: 1, updatedAt: 1, ...extra });
const seed = async (day, fam, extra) => env.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), 'weekRequests/' + id(day, fam)), req(day, fam, extra)));
const accept = (u, day, fam, by = 'f2') => updateDoc(doc(as(u), 'weekRequests/' + id(day, fam)), { status: 'accepted', decidedAt: 9, decidedBy: by, updatedAt: 9 });

console.log('--- mode aan');
await reset('aan');
await check('coordinator can set the switch', setDoc(doc(as('coord'), 'settings/weekrooster'), { mode: 'aan', updatedAt: 1 }));
await check('parent cannot set the switch', setDoc(doc(as('u4'), 'settings/weekrooster'), { mode: 'uit' }), false);
await check('family creates its own pending request', setDoc(doc(as('u4'), 'weekRequests/' + id('Do', 'f4')), req('Do', 'f4')));
await check('family cannot write for another family', setDoc(doc(as('u4'), 'weekRequests/' + id('Do', 'f3')), req('Do', 'f3')), false);
await check('document id must match week_day_family', setDoc(doc(as('u4'), 'weekRequests/other'), req('Di', 'f4')), false);
for (const k of ['reason', 'reden', 'note', 'text', 'message']) await check(`a "${k}" field is refused (no reason or free text)`, setDoc(doc(as('u4'), 'weekRequests/' + id('Di', 'f4')), req('Di', 'f4', { [k]: 'ziek' })), false);
await check('extra unknown field refused', setDoc(doc(as('u4'), 'weekRequests/' + id('Di', 'f4')), req('Di', 'f4', { extra: 1 })), false);
await check('bad time refused', setDoc(doc(as('u4'), 'weekRequests/' + id('Di', 'f4')), req('Di', 'f4', { heen: '25:00' })), false);
await check('bad day refused', setDoc(doc(as('u4'), 'weekRequests/' + `${WK}_Za_f4`), req('Za', 'f4')), false);
await check('"rijdt niet mee" with times refused', setDoc(doc(as('u4'), 'weekRequests/' + id('Di', 'f4')), req('Di', 'f4', { rides: false, status: 'direct' })), false);
await check('"rijdt niet mee" is direct without times', setDoc(doc(as('u4'), 'weekRequests/' + id('Di', 'f4')), req('Di', 'f4', { rides: false, heen: '', terug: '', status: 'direct' })));
await check('one direction only is fine (the other stays empty)', setDoc(doc(as('u4'), 'weekRequests/' + id('Ma', 'f4')), req('Ma', 'f4', { heen: '', terug: '17:45' })));
await check('both directions empty is refused', setDoc(doc(as('u4'), 'weekRequests/' + id('Ma', 'f4')), req('Ma', 'f4', { heen: '', terug: '' })), false);
await check('a "rijdt niet mee" that is put back is replaced by a withdrawn document', setDoc(doc(as('u4'), 'weekRequests/' + id('Di', 'f4')), req('Di', 'f4', { rides: false, heen: '', terug: '', status: 'withdrawn' })));
await check('the day coordinator withdraws an own-day direct document (decidedBy kept)', (async () => { await setDoc(doc(as('u2'), 'weekRequests/' + id('Do', 'f2')), req('Do', 'f2', { status: 'direct', decidedAt: 1, decidedBy: 'f2' })); return setDoc(doc(as('u2'), 'weekRequests/' + id('Do', 'f2')), req('Do', 'f2', { status: 'withdrawn', decidedAt: 1, decidedBy: 'f2', updatedAt: 5 })); })());
await check('a family cannot make new times direct on a day it does not coordinate', setDoc(doc(as('u4'), 'weekRequests/' + id('Wo', 'f4')), req('Wo', 'f4', { status: 'direct' })), false);
await check('a family cannot write accepted', setDoc(doc(as('u4'), 'weekRequests/' + id('Wo', 'f4')), req('Wo', 'f4', { status: 'accepted', decidedAt: 1, decidedBy: 'f4' })), false);
await check('the day coordinator makes new times direct on the own day (own daughter)', setDoc(doc(as('u2'), 'weekRequests/' + id('Do', 'f2')), req('Do', 'f2', { status: 'direct', decidedAt: 1, decidedBy: 'f2' })));
await check('the day coordinator cannot make times direct on another coordinator\'s day', setDoc(doc(as('u2'), 'weekRequests/' + id('Vr', 'f2')), req('Vr', 'f2', { status: 'direct', decidedAt: 1, decidedBy: 'f2' })), false);
await check('decidedBy naming someone else refused', setDoc(doc(as('u2'), 'weekRequests/' + id('Do', 'f2')), req('Do', 'f2', { status: 'direct', decidedAt: 1, decidedBy: 'f9' })), false);
await check('family changes its own pending request (createdAt kept)', updateDoc(doc(as('u4'), 'weekRequests/' + id('Do', 'f4')), { heen: '16:45', updatedAt: 2 }));
await check('createdAt cannot change', updateDoc(doc(as('u4'), 'weekRequests/' + id('Do', 'f4')), { createdAt: 5 }), false);
await check('another family cannot change it', updateDoc(doc(as('u3'), 'weekRequests/' + id('Do', 'f4')), { heen: '10:00', updatedAt: 2 }), false);
await check('family withdraws its own request', updateDoc(doc(as('u4'), 'weekRequests/' + id('Do', 'f4')), { status: 'withdrawn', updatedAt: 3 }));
await check('another family cannot delete it', deleteDoc(doc(as('u3'), 'weekRequests/' + id('Do', 'f4'))), false);
await check('family deletes its own withdrawn request', deleteDoc(doc(as('u4'), 'weekRequests/' + id('Do', 'f4'))));

console.log('--- deciding');
await seed('Do', 'f4');
await check('another family cannot accept', accept('u3', 'Do', 'f4', 'f3'), false);
await check('the owner cannot accept its own request', accept('u4', 'Do', 'f4', 'f4'), false);
await check('the day coordinator of ANOTHER day cannot accept', accept('u3', 'Do', 'f4', 'f3'), false);
await check('accepting while changing other fields refused', updateDoc(doc(as('u2'), 'weekRequests/' + id('Do', 'f4')), { status: 'accepted', decidedAt: 9, decidedBy: 'f2', updatedAt: 9, heen: '01:00' }), false);
await check('the day coordinator of that day accepts', accept('u2', 'Do', 'f4'));
await check('an accepted request cannot be accepted again', accept('u2', 'Do', 'f4'), false);
await check('the owner replaces an accepted request by a new pending one', setDoc(doc(as('u4'), 'weekRequests/' + id('Do', 'f4')), req('Do', 'f4', { heen: '17:00', updatedAt: 20 })));
await seed('Vr', 'f4');
await check('the real coordinator can accept any day', accept('coord', 'Vr', 'f4', 'f1'));
await seed('Wo', 'f4');
await check('with no day coordinator for a day, the real coordinator still decides', accept('coord', 'Wo', 'f4', 'f1'));
await check('with no day coordinator for a day, a parent cannot', (async () => { await seed('Ma', 'f4'); return accept('u2', 'Ma', 'f4'); })(), false);

console.log('--- reading');
await reset('aan'); await seed('Do', 'f4'); await seed('Vr', 'f4'); await seed('Do', 'f3');
await check('a family reads its own request', getDoc(doc(as('u4'), 'weekRequests/' + id('Do', 'f4'))));
await check('a family cannot read another family\'s request', getDoc(doc(as('u3'), 'weekRequests/' + id('Do', 'f4'))), false);
await check('the day coordinator reads the requests of his day', getDocs(query(collection(as('u2'), 'weekRequests'), where('day', '==', 'Do'))));
await check('the day coordinator cannot read another day', getDocs(query(collection(as('u2'), 'weekRequests'), where('day', '==', 'Vr'))), false);
await check('a family lists its own requests', getDocs(query(collection(as('u4'), 'weekRequests'), where('familyId', '==', 'f4'))));
await check('a family cannot list everything', getDocs(collection(as('u4'), 'weekRequests')), false);
await check('the coordinator reads everything', getDocs(collection(as('coord'), 'weekRequests')));
await check('a stranger without a link reads nothing', getDoc(doc(env.authenticatedContext('nobody').firestore(), 'weekRequests/' + id('Do', 'f4'))), false);

console.log('--- mode test: only the real coordinator');
await reset('test');
await check('test: a parent cannot create', setDoc(doc(as('u4'), 'weekRequests/' + id('Do', 'f4')), req('Do', 'f4')), false);
await check('test: the coordinator can create (also for a family, Testweergave)', setDoc(doc(as('coord'), 'weekRequests/' + id('Do', 'f4')), req('Do', 'f4', { test: true })));
await check('test: the day coordinator parent cannot accept', accept('u2', 'Do', 'f4'), false);
await check('test: the coordinator accepts', accept('coord', 'Do', 'f4', 'f1'));
await check('test: a parent can still delete its own withdrawn request', (async () => { await seed('Di', 'f4', { status: 'withdrawn' }); return deleteDoc(doc(as('u4'), 'weekRequests/' + id('Di', 'f4'))); })());
await check('test: a parent can still read its own request', (async () => { await seed('Wo', 'f4'); return getDoc(doc(as('u4'), 'weekRequests/' + id('Wo', 'f4'))); })());

console.log('--- mode uit / missing / unknown: everything stops at once');
for (const mode of ['uit', null, {}, { mode: 'AAN' }, { mode: true }, { mode: 'aan ' }]) {
  await reset(mode); await seed('Do', 'f4'); await seed('Vr', 'f4', { status: 'withdrawn' });
  const L = mode === null ? 'missing' : JSON.stringify(mode);
  await check(`${L}: no new request by a parent`, setDoc(doc(as('u4'), 'weekRequests/' + id('Di', 'f4')), req('Di', 'f4')), false);
  await check(`${L}: no new request by the coordinator`, setDoc(doc(as('coord'), 'weekRequests/' + id('Di', 'f4')), req('Di', 'f4')), false);
  await check(`${L}: no change`, updateDoc(doc(as('u4'), 'weekRequests/' + id('Do', 'f4')), { heen: '16:45', updatedAt: 2 }), false);
  await check(`${L}: no accepting`, accept('u2', 'Do', 'f4'), false);
  await check(`${L}: no accepting by the coordinator`, accept('coord', 'Do', 'f4', 'f1'), false);
  await check(`${L}: reading still works`, getDoc(doc(as('u4'), 'weekRequests/' + id('Do', 'f4'))));
  await check(`${L}: deleting still works`, deleteDoc(doc(as('u4'), 'weekRequests/' + id('Vr', 'f4'))));
}

console.log('--- existing rules untouched');
await reset('uit');
await check('deviations: a member can still write', setDoc(doc(as('u4'), 'deviations/Do_heen'), { day: 'Do', cars: [], weekKey: WK }));
await check('settings: a parent still cannot write', setDoc(doc(as('u4'), 'settings/other'), { a: 1 }), false);
await check('settings: the coordinator still can', setDoc(doc(as('coord'), 'settings/other'), { a: 1 }));
await check('families: a family still updates its own', updateDoc(doc(as('u4'), 'families/f4'), { parentName: 'x' }));
await check('families: not another one', updateDoc(doc(as('u4'), 'families/f3'), { parentName: 'x' }), false);

console.log(`\n${ok} passed, ${bad} failed`);
await env.cleanup();
process.exit(bad ? 1 : 0);
