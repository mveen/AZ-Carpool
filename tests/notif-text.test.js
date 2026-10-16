// Run with: node notif-text.test.js
// notif-text.js: the words of a Ritten-ruilen notification. The inbox, the preview and the push server all use it.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { notificationText, whenText } from '../notif-text.js';

const names = { f1: 'Ouder Saar', f2: 'Ouder Noor', f3: 'Mark & Els <b>' };
const ctx = { nameOf: id => names[id] || '', currentWeekKey: '2026-W40' };
const n = (extra = {}) => ({ kind: 'taken', toFamilyId: 'f1', fromFamilyId: 'f2', weekKey: '2026-W40', day: 'Do', direction: 'heen', date: '2026-10-01', time: '16:15', momentFrom: '', momentTo: '', ...extra });

test('the five kinds each have a title and a body', () => {
  const line = (kind, extra) => notificationText(n({ kind, ...extra }), ctx);
  assert.deepEqual(line('offerBackup'), { title: 'Rit vrij: donderdag 16:15', body: 'Ouder Noor biedt een rit aan. Je hebt je voor dit tijdvak beschikbaar gemeld. Tik om over te nemen.' });
  assert.deepEqual(line('taken'), { title: 'Ouder Noor neemt je rit over', body: 'donderdag 16:15 is geregeld.' });
  assert.deepEqual(line('takenDayCoordinator'), { title: 'Wijziging donderdag 16:15', body: 'Jij bent dagcoördinator. Ouder Noor rijdt nu deze rit. Het rooster is bijgewerkt.' });
  assert.deepEqual(line('uncovered', { fromFamilyId: '' }), { title: 'Rit donderdag 16:15 nog niet gedekt', body: 'Het is 18:00 en niemand heeft hem overgenomen. Regel het of stuur de groep een appje.' });
  assert.deepEqual(line('backupForRide', { momentFrom: '15:00', momentTo: '17:00' }), { title: 'Er is een back-up voor je rit', body: 'Ouder Noor kan donderdag tussen 15:00 en 17:00 inspringen. Kun je zelf niet? Bied je rit dan aan.' });
});
test('a kind this version does not know, or no notification at all, gives null', () => {
  assert.equal(notificationText(n({ kind: 'toekomst' }), ctx), null); assert.equal(notificationText(null, ctx), null); assert.equal(notificationText({}, ctx), null);
});
test('names are plain text here (the screen escapes them once); an unknown family is "Een gezin"', () => {
  assert.equal(notificationText(n({ fromFamilyId: 'f3' }), ctx).title, 'Mark & Els <b> neemt je rit over');
  assert.equal(notificationText(n({ fromFamilyId: 'zz' }), ctx).title, 'Een gezin neemt je rit over');
  assert.equal(notificationText(n({ fromFamilyId: 'f2' }), {}).title, 'Een gezin neemt je rit over');
});
test('the day of a back-up moment comes from its date; without a week the current planning week is used', () => {
  assert.match(notificationText(n({ kind: 'backupForRide', date: '2026-09-30', momentFrom: '08:00', momentTo: '09:00' }), ctx).body, /woensdag tussen 08:00 en 09:00/);
  assert.match(notificationText(n({ kind: 'backupForRide', weekKey: '', date: '2026-10-02', momentFrom: '08:00', momentTo: '09:00' }), ctx).body, /vrijdag tussen/);
  assert.match(notificationText(n({ kind: 'backupForRide', weekKey: '', date: '2026-10-02', momentFrom: '08:00', momentTo: '09:00' }), { nameOf: ctx.nameOf }).body, /2026-10-02 tussen/);
});
test('"donderdag 16:15": the ride a notification is about', () => {
  assert.equal(whenText('Do', '16:15'), 'donderdag 16:15'); assert.equal(whenText('Ma', ''), 'maandag'); assert.equal(whenText('Xx', '08:00'), 'xx 08:00');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
