// Firestore rules test for the error log (errorLog). Needs the Firestore emulator on port 8089 and: npm i @firebase/rules-unit-testing firebase.
// Start: firebase emulators:start --only firestore (rules = firebase/firestore.rules, port 8089), then: node errorlog-rules.test.mjs
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, deleteDoc, getDocs, collection } from 'firebase/firestore';
import fs from 'node:fs';
const env = await initializeTestEnvironment({ projectId: 'demo-test', firestore: { host: '127.0.0.1', port: 8089, rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
let ok = 0, bad = 0;
const check = async (name, p, expectOk = true) => { try { await (expectOk ? assertSucceeds(p) : assertFails(p)); ok++; console.log('  ✓', name); } catch (e) { bad++; console.log('  ✗', name, String(e.message).slice(0, 120)); } };
await env.clearFirestore();
await env.withSecurityRulesDisabled(async ctx => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'config/coordinator'), { uid: 'coord' });
  await setDoc(doc(d, 'errorLog/u1_0'), { at: 1, where: 'gate', code: 'x', msg: '', v: 'v88', ua: 'iOS Safari 17' });
});
const as = u => env.authenticatedContext(u).firestore();
const entry = (extra = {}) => ({ at: Date.now(), where: 'gate', code: 'link-denied', msg: 'phone digits 10', v: 'v88', ua: 'iOS Safari 17', ...extra });

console.log('--- writing (anyone with a session, only their own slots)');
await check('a browser writes its own slot u2_0', setDoc(doc(as('u2'), 'errorLog/u2_0'), entry()));
await check('a browser writes its slot 9', setDoc(doc(as('u2'), 'errorLog/u2_9'), entry()));
await check('a browser overwrites its own slot (the ring)', setDoc(doc(as('u2'), 'errorLog/u2_0'), entry({ code: 'other' })));
await check('slot 10 does not exist', setDoc(doc(as('u2'), 'errorLog/u2_10'), entry()), false);
await check('a slot of another browser is refused', setDoc(doc(as('u2'), 'errorLog/u1_1'), entry()), false);
await check('a free document id is refused (no unlimited entries)', setDoc(doc(as('u2'), 'errorLog/anything'), entry()), false);
await check('nobody without a session writes', setDoc(doc(env.unauthenticatedContext().firestore(), 'errorLog/u2_1'), entry()), false);

console.log('--- the content is checked');
await check('an extra field is refused', setDoc(doc(as('u3'), 'errorLog/u3_0'), entry({ phone: '0612345678' })), false);
await check('a missing field is refused', setDoc(doc(as('u3'), 'errorLog/u3_0'), { at: 1, where: 'gate', code: 'x', msg: '', v: 'v88' }), false);
await check('a text that is too long is refused (msg 201)', setDoc(doc(as('u3'), 'errorLog/u3_0'), entry({ msg: 'm'.repeat(201) })), false);
await check('the longest allowed texts are accepted', setDoc(doc(as('u3'), 'errorLog/u3_0'), entry({ where: 'w'.repeat(40), code: 'c'.repeat(60), msg: 'm'.repeat(200), v: 'v'.repeat(20), ua: 'u'.repeat(60) })));
await check('a time that is not a number is refused', setDoc(doc(as('u3'), 'errorLog/u3_1'), entry({ at: 'now' })), false);
await check('a text that is not a string is refused', setDoc(doc(as('u3'), 'errorLog/u3_1'), entry({ code: 5 })), false);

console.log('--- reading and deleting (coordinator only)');
await check('the coordinator reads an entry', getDoc(doc(as('coord'), 'errorLog/u1_0')));
await check('the coordinator lists the log', getDocs(collection(as('coord'), 'errorLog')));
await check('a parent cannot read an entry, not even their own', getDoc(doc(as('u2'), 'errorLog/u2_0')), false);
await check('a parent cannot list the log', getDocs(collection(as('u2'), 'errorLog')), false);
await check('a parent cannot delete an entry, not even their own', deleteDoc(doc(as('u2'), 'errorLog/u2_0')), false);
await check('the coordinator deletes an entry', deleteDoc(doc(as('coord'), 'errorLog/u1_0')));
await check('the coordinator cannot write an entry for someone else', setDoc(doc(as('coord'), 'errorLog/u1_2'), entry()), false);

console.log(`\n${ok} passed, ${bad} failed`);
await env.cleanup();
process.exit(bad ? 1 : 0);
