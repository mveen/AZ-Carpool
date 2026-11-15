// Firestore rules test for the shape checks on what any member writes: deviations, matchCarpools, settings/lastUpdateDeviation, settings/matchCache.
// Only the types of the core fields are checked (no list of allowed fields), so extra optional fields must keep working. The test data below has the
// shape the app really writes (taken from the writes in the app tests). Run: bash scripts/run-rules-tests.sh (needs Java 21 or newer).
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
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
  await setDoc(doc(d, 'deviations/Ma_heen'), { day: 'Ma', direction: 'heen', weekKey: '2026-W47', expiresAt: 4102444800000, cars: [] });
  await setDoc(doc(d, 'matchCarpools/m1'), { cars: [], startMs: 5 });
});
const as = u => env.authenticatedContext(u).firestore();
const dev = extra => ({ day: 'Di', direction: 'terug', weekKey: '2026-W47', expiresAt: 1790000000000, cars: [{ driverFamilyId: 'f1', girlIds: ['f1'] }], ...extra });

console.log('--- deviations');
await check('a member writes a deviation as the app does', setDoc(doc(as('u1'), 'deviations/Di_terug'), dev()));
await check('extra optional fields stay possible (times, selfBy, selfAt, ovFrom ...)', setDoc(doc(as('u1'), 'deviations/Wo_heen'), dev({ day: 'Wo', direction: 'heen', times: { f1: '07:15' }, selfBy: 'f1', selfAt: 5, selfKind: 'x', ovFrom: {}, ovGirlIds: [], overwrote: [], overwroteAt: 6 })));
await check('the coordinator writes a deviation', setDoc(doc(as('coord'), 'deviations/Do_heen'), dev({ day: 'Do', direction: 'heen' })));
await check('cars that is not a list is refused', setDoc(doc(as('u1'), 'deviations/Vr_heen'), dev({ cars: 'x' })), false);
await check('a missing expiry is refused', setDoc(doc(as('u1'), 'deviations/Vr_heen'), (({ expiresAt, ...r }) => r)(dev())), false);
await check('an expiry that is not a number is refused', setDoc(doc(as('u1'), 'deviations/Vr_heen'), dev({ expiresAt: 'morgen' })), false);
await check('a direction other than heen/terug is refused', setDoc(doc(as('u1'), 'deviations/Vr_heen'), dev({ direction: 'zij' })), false);
await check('a day that is not text is refused', setDoc(doc(as('u1'), 'deviations/Vr_heen'), dev({ day: 5 })), false);
await check('an existing deviation can be updated with a valid change', updateDoc(doc(as('u1'), 'deviations/Ma_heen'), { cars: [{ driverFamilyId: 'f1', girlIds: [] }] }));
await check('an update that turns cars into a string is refused', updateDoc(doc(as('u1'), 'deviations/Ma_heen'), { cars: 'x' }), false);
await check('a stranger (not linked) cannot write', setDoc(doc(as('stranger'), 'deviations/Vr_terug'), dev()), false);
await check('deleting is still refused before the expiry of the deviation', deleteDoc(doc(as('u1'), 'deviations/Ma_heen')), false);

console.log('--- matchCarpools');
await check('a member writes a carpool with a list of cars (and a log, bus fields ...)', setDoc(doc(as('u1'), 'matchCarpools/m2'), { cars: [{ driverFamilyId: 'f1', girlIds: ['f1'], departureTime: '07:15', fromId: 'busstation', fromText: '' }], log: [{ at: 1, act: 'add' }], bus: false, busDepart: '', startMs: 5, summary: 'A - B', location: 'x', extra: 'keep' }));
await check('a bus-only change that keeps cars a list works', updateDoc(doc(as('u1'), 'matchCarpools/m1'), { bus: true, busDepart: '08:45' }));
await check('cars that is not a list is refused', setDoc(doc(as('u1'), 'matchCarpools/m3'), { cars: 'x' }), false);
await check('a carpool without cars is refused', setDoc(doc(as('u1'), 'matchCarpools/m3'), { startMs: 5 }), false);
await check('a member can still delete a carpool', deleteDoc(doc(as('u1'), 'matchCarpools/m1')));
await check('a stranger cannot write', setDoc(doc(as('stranger'), 'matchCarpools/m4'), { cars: [] }), false);

console.log('--- settings/lastUpdateDeviation and settings/matchCache');
await check('a member writes the last update', setDoc(doc(as('u1'), 'settings/lastUpdateDeviation'), { at: 5, by: 'Jan' }));
await check('a last update without a number is refused', setDoc(doc(as('u1'), 'settings/lastUpdateDeviation'), { at: 'nu', by: 'Jan' }), false);
await check('a member writes the match cache', setDoc(doc(as('u1'), 'settings/matchCache'), { fetchedAt: 5, feedsSig: 'x', partial: false, matches: [{ calendarId: 'c', eventId: 'e' }] }));
await check('a match cache whose matches is not a list is refused', setDoc(doc(as('u1'), 'settings/matchCache'), { fetchedAt: 5, matches: 'x' }), false);
await check('a match cache without fetchedAt is refused', setDoc(doc(as('u1'), 'settings/matchCache'), { matches: [] }), false);
await check('the other settings stay coordinator-only to write', setDoc(doc(as('u1'), 'settings/something'), { a: 1 }), false);
await check('the coordinator still writes other settings', setDoc(doc(as('coord'), 'settings/something'), { a: 1 }));

console.log(`\n${ok} passed, ${bad} failed`);
await env.cleanup();
process.exit(bad ? 1 : 0);
