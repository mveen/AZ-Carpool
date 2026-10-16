// Firestore rules test for the agenda links (calendarTokens = the daughter's calendar, driverCalendarTokens = the parents' calendar; same rules). Needs the Firestore emulator on port 8089 and: npm i @firebase/rules-unit-testing firebase.
// Start: firebase emulators:start --only firestore (rules = firebase/firestore.rules, port 8089), then: node agenda-rules.test.mjs
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, deleteDoc, getDocs, collection } from 'firebase/firestore';
import fs from 'node:fs';
const env = await initializeTestEnvironment({ projectId: 'demo-test', firestore: { host: '127.0.0.1', port: 8089, rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
let ok = 0, bad = 0;
const check = async (name, p, expectOk = true) => { try { await (expectOk ? assertSucceeds(p) : assertFails(p)); ok++; console.log('  ✓', name); } catch (e) { bad++; console.log('  ✗', name, String(e.message).slice(0, 120)); } };
const T = 'k8x2Q-_aB9zLm4TnW0pRs7VcYd3FgHjE';   // 32 characters
for (const C of ['calendarTokens', 'driverCalendarTokens']) {
await env.clearFirestore();
await env.withSecurityRulesDisabled(async ctx => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'config/coordinator'), { uid: 'coord' });
  for (const f of ['f1', 'f2']) await setDoc(doc(d, 'families/' + f), { parentName: f });
  for (const [u, f] of [['u1', 'f1'], ['u2', 'f2']]) await setDoc(doc(d, 'links/' + u), { familyId: f });
  await setDoc(doc(d, C + '/f2'), { token: 'B'.repeat(32), createdAt: 1 });
});
const as = u => env.authenticatedContext(u).firestore();

console.log('=== ' + C + ' ===');
console.log('--- reading');
await check('family reads its own secret', getDoc(doc(as('u2'), C + '/f2')));
await check('family cannot read another family\'s secret', getDoc(doc(as('u1'), C + '/f2')), false);
await check('coordinator reads any secret', getDoc(doc(as('coord'), C + '/f2')));
await check('nobody can list all secrets, not even the coordinator', getDocs(collection(as('coord'), C)), false);
await check('someone who is not linked reads nothing', getDoc(doc(as('stranger'), C + '/f2')), false);

console.log('--- making');
await check('family makes its own secret', setDoc(doc(as('u1'), C + '/f1'), { token: T, createdAt: 1 }));
await check('family cannot make a secret for another family', setDoc(doc(as('u1'), C + '/f2'), { token: T, createdAt: 1 }), false);
await env.clearFirestore();
await env.withSecurityRulesDisabled(async ctx => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'config/coordinator'), { uid: 'coord' });
  for (const f of ['f1', 'f2']) await setDoc(doc(d, 'families/' + f), { parentName: f });
  for (const [u, f] of [['u1', 'f1'], ['u2', 'f2']]) await setDoc(doc(d, 'links/' + u), { familyId: f });
});
await check('secret with a path trick refused', setDoc(doc(as('u1'), C + '/f1'), { token: '../../../../etc/passwd../../xx', createdAt: 1 }), false);
await check('secret that is too short refused', setDoc(doc(as('u1'), C + '/f1'), { token: 'abc', createdAt: 1 }), false);
await check('secret that is too long refused', setDoc(doc(as('u1'), C + '/f1'), { token: T + 'x', createdAt: 1 }), false);
await check('secret with a dot (an extension) refused', setDoc(doc(as('u1'), C + '/f1'), { token: T.slice(0, 28) + '.ics', createdAt: 1 }), false);
await check('secret that is not text refused', setDoc(doc(as('u1'), C + '/f1'), { token: 12345678901234567890123456789012, createdAt: 1 }), false);
await check('extra field refused', setDoc(doc(as('u1'), C + '/f1'), { token: T, createdAt: 1, extra: 1 }), false);
await check('missing createdAt refused', setDoc(doc(as('u1'), C + '/f1'), { token: T }), false);
await check('someone who is not linked cannot make one', setDoc(doc(as('stranger'), C + '/f1'), { token: T, createdAt: 1 }), false);
await check('the right secret is accepted', setDoc(doc(as('u1'), C + '/f1'), { token: T, createdAt: 1 }));

console.log('--- keeping');
await check('family cannot replace its secret (the link must stay the same)', setDoc(doc(as('u1'), C + '/f1'), { token: 'Z'.repeat(32), createdAt: 2 }), false);
await check('family cannot update its secret', updateDoc(doc(as('u1'), C + '/f1'), { token: 'Z'.repeat(32) }), false);
await check('coordinator cannot replace it either', setDoc(doc(as('coord'), C + '/f1'), { token: 'Z'.repeat(32), createdAt: 2 }), false);
await check('family cannot delete its secret', deleteDoc(doc(as('u1'), C + '/f1')), false);
await check('coordinator can delete a secret', deleteDoc(doc(as('coord'), C + '/f1')));
await check('after that the family can make a new one', setDoc(doc(as('u1'), C + '/f1'), { token: 'Y'.repeat(32), createdAt: 3 }));

}

await env.cleanup();
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
