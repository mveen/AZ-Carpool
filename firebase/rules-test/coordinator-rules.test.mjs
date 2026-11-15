// Firestore rules test for config/coordinator: only members read who the coordinator is; a stranger may look only while nobody has claimed it yet. Needs the Firestore emulator (scripts/run-rules-tests.sh).
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, deleteDoc } from 'firebase/firestore';
import fs from 'node:fs';
const env = await initializeTestEnvironment({ projectId: 'demo-test', firestore: { host: '127.0.0.1', port: 8089, rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
let ok = 0, bad = 0;
const check = async (name, p, expectOk = true) => { try { await (expectOk ? assertSucceeds(p) : assertFails(p)); ok++; console.log('  ✓', name); } catch (e) { bad++; console.log('  ✗', name, String(e.message).slice(0, 120)); } };
const as = u => env.authenticatedContext(u).firestore();
const seed = async cfg => { await env.clearFirestore(); await env.withSecurityRulesDisabled(async ctx => {
  const d = ctx.firestore();
  if (cfg) await setDoc(doc(d, 'config/coordinator'), cfg);
  for (const f of ['f1', 'f2']) await setDoc(doc(d, 'families/' + f), { parentName: f, girlName: 'Meisje ' + f });
  for (const [u, f] of [['u1', 'f1'], ['u2', 'f2']]) await setDoc(doc(d, 'links/' + u), { familyId: f });
}); };

console.log('=== a coordinator tied to a family ===');
await seed({ familyId: 'f1' });
await check('a linked parent reads it', getDoc(doc(as('u2'), 'config/coordinator')));
await check('the coordinator family reads it', getDoc(doc(as('u1'), 'config/coordinator')));
await check('someone who is not linked is refused', getDoc(doc(as('stranger'), 'config/coordinator')), false);
await check('someone who is not signed in is refused', getDoc(doc(env.unauthenticatedContext().firestore(), 'config/coordinator')), false);
await check('a stranger cannot claim it again', setDoc(doc(as('stranger'), 'config/coordinator'), { uid: 'stranger' }), false);
await check('a parent cannot change it', setDoc(doc(as('u2'), 'config/coordinator'), { familyId: 'f2' }), false);
await check('the coordinator family can hand it over', setDoc(doc(as('u1'), 'config/coordinator'), { familyId: 'f2' }));

console.log('=== a coordinator tied to a browser ===');
await seed({ uid: 'coord', claimedAt: 1 });
await check('that browser reads it before it is linked', getDoc(doc(as('coord'), 'config/coordinator')));
await check('a linked parent reads it', getDoc(doc(as('u1'), 'config/coordinator')));
await check('a stranger is refused', getDoc(doc(as('stranger'), 'config/coordinator')), false);
await check('it can never be deleted', deleteDoc(doc(as('coord'), 'config/coordinator')), false);

console.log('=== nobody has claimed it yet ===');
await seed(null);
await check('a stranger may look (the claim screen needs it)', getDoc(doc(as('stranger'), 'config/coordinator')));
await check('someone who is not signed in is still refused', getDoc(doc(env.unauthenticatedContext().firestore(), 'config/coordinator')), false);
await check('the first one to ask becomes coordinator', setDoc(doc(as('stranger'), 'config/coordinator'), { uid: 'stranger', claimedAt: 1 }));
await check('after that another stranger is refused', getDoc(doc(as('other'), 'config/coordinator')), false);

await env.cleanup();
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
