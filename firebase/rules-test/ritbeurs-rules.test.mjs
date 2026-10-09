// Firestore rules test for the Ritbeurs. Needs the Firestore emulator on port 8089 and: npm i @firebase/rules-unit-testing firebase.
// Start: firebase emulators:start --only firestore (rules = firebase/firestore.rules, port 8089), then: node ritbeurs-rules.test.mjs
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, deleteDoc, writeBatch, collection, getDocs } from 'firebase/firestore';
import fs from 'node:fs';
const env = await initializeTestEnvironment({ projectId: 'demo-test', firestore: { host: '127.0.0.1', port: 8089, rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
let ok = 0, bad = 0;
const check = async (name, p, expectOk = true) => { try { await (expectOk ? assertSucceeds(p) : assertFails(p)); ok++; console.log('  ✓', name); } catch (e) { bad++; console.log('  ✗', name, String(e.message).slice(0, 120)); } };
const reset = async (on) => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'config/coordinator'), { uid: 'coord' });
    for (const f of ['f1', 'f2', 'f3']) await setDoc(doc(d, 'families/' + f), { parentName: f });
    for (const [u, f] of [['u1', 'f1'], ['u2', 'f2'], ['u3', 'f3']]) await setDoc(doc(d, 'links/' + u), { familyId: f });
    if (on !== null) await setDoc(doc(d, 'settings/ritbeurs'), { on });
  });
};
const as = u => env.authenticatedContext(u).firestore();
const offer = (by = 'f1') => ({ weekKey: '2026-W41', day: 'Do', direction: 'heen', date: '2026-10-15', time: '16:15', offeredBy: by, message: '', status: 'open', createdAt: 1 });
const notif = to => ({ kind: 'taken', toFamilyId: to, sourceId: 'o1', fromFamilyId: 'f2', weekKey: '', day: '', direction: '', date: '', time: '', momentFrom: '', momentTo: '', createdAt: 1, deliverAt: 1, expiresAt: 9e12, read: false });

console.log('--- switch ON');
await reset(true);
await check('coordinator can switch (settings)', setDoc(doc(as('coord'), 'settings/ritbeurs'), { on: true, updatedAt: 1 }));
await check('parent cannot switch', setDoc(doc(as('u1'), 'settings/ritbeurs'), { on: false }), false);
await check('family creates own offer', setDoc(doc(as('u1'), 'offers/o1'), offer('f1')));
await check('family cannot offer for another family', setDoc(doc(as('u1'), 'offers/o2'), offer('f2')), false);
await check('offer with extra field refused', setDoc(doc(as('u1'), 'offers/o3'), { ...offer('f1'), extra: 1 }), false);
await check('offer created already taken refused', setDoc(doc(as('u1'), 'offers/o4'), { ...offer('f1'), status: 'taken' }), false);
// first yes wins: two batches
const take = (u, f) => { const d = as(u); const b = writeBatch(d); b.update(doc(d, 'offers/o1'), { status: 'taken', takenBy: f, takenAt: 5 }); b.set(doc(d, 'deviations/Do_heen'), { day: 'Do', cars: [] }); b.set(doc(d, `families/f1/notifications/taken_o1_f1`), notif('f1')); return b.commit(); };
await check('offerer cannot take own ride', take('u1', 'f1'), false);
await check('taking as someone else refused (takenBy mismatch)', take('u3', 'f2'), false);
await check('first taker wins (batch)', take('u2', 'f2'));
await check('second taker fails as a whole', take('u3', 'f3'), false);
await check('second taker left no deviation change (still first)', getDoc(doc(as('u3'), 'offers/o1')).then(s => { if (s.data().takenBy !== 'f2') throw new Error('wrong'); }));
await check('taken offer cannot be withdrawn', updateDoc(doc(as('u1'), 'offers/o1'), { status: 'withdrawn', withdrawnAt: 6 }), false);
await setDoc(doc(as('u1'), 'offers/o5'), offer('f1'));
await check('other family cannot withdraw', updateDoc(doc(as('u2'), 'offers/o5'), { status: 'withdrawn', withdrawnAt: 6 }), false);
await check('offerer withdraws', updateDoc(doc(as('u1'), 'offers/o5'), { status: 'withdrawn', withdrawnAt: 6 }));
await setDoc(doc(as('u1'), 'offers/o6'), offer('f1'));
await check('any member marks uncovered once', updateDoc(doc(as('u3'), 'offers/o6'), { uncoveredAt: 7 }));
await check('uncovered cannot be marked twice', updateDoc(doc(as('u2'), 'offers/o6'), { uncoveredAt: 8 }), false);
await check('other changes to an offer refused', updateDoc(doc(as('u3'), 'offers/o6'), { time: '09:00' }), false);
await check('non-coordinator cannot delete offer', deleteDoc(doc(as('u1'), 'offers/o6')), false);
await check('coordinator deletes offer', deleteDoc(doc(as('coord'), 'offers/o6')));

console.log('--- moments');
await check('family creates own moment', setDoc(doc(as('u2'), 'backupMoments/m1'), { familyId: 'f2', date: '2026-10-15', from: '15:00', to: '18:00', place: 'alkmaar', onlyIfFree: true, createdAt: 1 }));
await check('moment for another family refused', setDoc(doc(as('u2'), 'backupMoments/m2'), { familyId: 'f1', date: '2026-10-15', from: '15:00', to: '18:00', place: 'alkmaar', onlyIfFree: true, createdAt: 1 }), false);
await check('others cannot delete my moment', deleteDoc(doc(as('u3'), 'backupMoments/m1')), false);
await check('owner deletes moment', deleteDoc(doc(as('u2'), 'backupMoments/m1')));

console.log('--- notifications');
await check('member leaves notification for another family', setDoc(doc(as('u2'), 'families/f1/notifications/n1'), notif('f1')));
await check('notification with wrong toFamilyId refused', setDoc(doc(as('u2'), 'families/f1/notifications/n2'), notif('f3')), false);
await check('receiver reads own notifications', getDocs(collection(as('u1'), 'families/f1/notifications')));
await check('other family cannot read them', getDocs(collection(as('u3'), 'families/f1/notifications')), false);
await check('receiver marks read', updateDoc(doc(as('u1'), 'families/f1/notifications/n1'), { read: true }));
await check('receiver cannot change other fields', updateDoc(doc(as('u1'), 'families/f1/notifications/n1'), { kind: 'x' }), false);
await check('other family cannot mark read', updateDoc(doc(as('u3'), 'families/f1/notifications/n1'), { read: true }), false);
await check('receiver deletes own', deleteDoc(doc(as('u1'), 'families/f1/notifications/n1')));

console.log('--- switch OFF: everything stops at once');
for (const on of [false, null]) {
  await reset(on);
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'offers/o9'), offer('f1')); await setDoc(doc(ctx.firestore(), 'families/f1/notifications/n9'), notif('f1')); });
  const L = on === false ? 'off' : 'missing';
  await check(`${L}: no new offer`, setDoc(doc(as('u1'), 'offers/o1'), offer('f1')), false);
  await check(`${L}: no take-over`, take('u2', 'f2').catch(e => { throw e; }), false);
  await check(`${L}: no withdraw`, updateDoc(doc(as('u1'), 'offers/o9'), { status: 'withdrawn', withdrawnAt: 1 }), false);
  await check(`${L}: no uncovered mark`, updateDoc(doc(as('u1'), 'offers/o9'), { uncoveredAt: 1 }), false);
  await check(`${L}: no moment`, setDoc(doc(as('u2'), 'backupMoments/m1'), { familyId: 'f2', date: '2026-10-15', from: '15:00', to: '18:00', place: 'alkmaar', onlyIfFree: true, createdAt: 1 }), false);
  await check(`${L}: no notification written`, setDoc(doc(as('u2'), 'families/f1/notifications/n1'), notif('f1')), false);
  await check(`${L}: cleanup delete still works`, deleteDoc(doc(as('u1'), 'families/f1/notifications/n9')));
}
console.log(`\n${ok} passed, ${bad} failed`);
await env.cleanup();
process.exit(bad ? 1 : 0);
