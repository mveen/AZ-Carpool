// Firestore rules test for the OpenRouteService key (settings/apiKeys), the stored distances (settings/matchDistances) and new invite codes (invites). Needs the Firestore emulator on port 8089 and: npm i @firebase/rules-unit-testing firebase.
// Start: firebase emulators:start --only firestore (rules = firebase/firestore.rules, port 8089), then: node secrets-rules.test.mjs
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import fs from 'node:fs';
const env = await initializeTestEnvironment({ projectId: 'demo-test', firestore: { host: '127.0.0.1', port: 8089, rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
let ok = 0, bad = 0;
const check = async (name, p, expectOk = true) => { try { await (expectOk ? assertSucceeds(p) : assertFails(p)); ok++; console.log('  ✓', name); } catch (e) { bad++; console.log('  ✗', name, String(e.message).slice(0, 120)); } };
await env.clearFirestore();
await env.withSecurityRulesDisabled(async ctx => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'config/coordinator'), { uid: 'coord' });
  await setDoc(doc(d, 'families/f1'), { parentName: 'f1', phoneKeys: ['0612345678'] });
  await setDoc(doc(d, 'links/u1'), { familyId: 'f1' });
  await setDoc(doc(d, 'settings/apiKeys'), { ors: 'SECRET' });
  await setDoc(doc(d, 'settings/matchDistances'), { m1: { loc: 'x', km: 5 } });
  await setDoc(doc(d, 'invites/OLD1'), { familyId: 'f1' });
});
const as = u => env.authenticatedContext(u).firestore();

console.log('--- the API key');
await check('a linked parent cannot read the key', getDoc(doc(as('u1'), 'settings/apiKeys')), false);
await check('a stranger cannot read the key', getDoc(doc(as('stranger'), 'settings/apiKeys')), false);
await check('a parent cannot write the key', setDoc(doc(as('u1'), 'settings/apiKeys'), { ors: 'X' }), false);
await check('the coordinator reads the key', getDoc(doc(as('coord'), 'settings/apiKeys')));
await check('the coordinator writes the key', setDoc(doc(as('coord'), 'settings/apiKeys'), { ors: 'NEW' }));

console.log('--- stored distances');
await check('a parent reads the stored distances', getDoc(doc(as('u1'), 'settings/matchDistances')));
await check('a parent cannot write a distance', setDoc(doc(as('u1'), 'settings/matchDistances'), { m2: { loc: 'y', km: 1 } }, { merge: true }), false);
await check('a stranger cannot read the distances', getDoc(doc(as('stranger'), 'settings/matchDistances')), false);
await check('the coordinator writes a distance', setDoc(doc(as('coord'), 'settings/matchDistances'), { m2: { loc: 'y', km: 1 } }, { merge: true }));

console.log('--- invite codes');
await check('the coordinator creates a code of 10 digits', setDoc(doc(as('coord'), 'invites/4829105736'), { familyId: 'f1' }));
await check('the coordinator creates a code of exactly 8 characters', setDoc(doc(as('coord'), 'invites/abcd1234'), { familyId: 'f1' }));
await check('the coordinator cannot create a new code of 7 characters', setDoc(doc(as('coord'), 'invites/abcd123'), { familyId: 'f1' }), false);
await check('the coordinator cannot create a new code of 4 characters', setDoc(doc(as('coord'), 'invites/ABCD'), { familyId: 'f1' }), false);
await check('an old short code can still be updated to the same family', updateDoc(doc(as('coord'), 'invites/OLD1'), { familyId: 'f1' }));
await check('an old short code can still be removed', deleteDoc(doc(as('coord'), 'invites/OLD1')));
await check('a parent cannot create a code', setDoc(doc(as('u1'), 'invites/zzzzzzzz9'), { familyId: 'f1' }), false);

console.log(`\n${ok} passed, ${bad} failed`);
await env.cleanup();
process.exit(bad ? 1 : 0);
