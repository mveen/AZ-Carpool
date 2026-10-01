// Run with: node ui-notice.test.js
// The notice bar (everyone) and the Beheer card (coordinator): what is shown, what is saved, what is refused.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, useFakeDb, sampleDbSeed, sampleCoordinatorState, sampleParentState, withFakeNow, withFakeNowAsync, NOW } from './test-support.js';
import { S } from '../state.js';
import { renderNoticeBanner, noticeCardHtml, saveNotice, rememberNoticeDraft, readNoticeForm } from '../ui-notice.js';

const dom = installFakeDom();
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const toast = () => dom.doc.getElementById('toast').innerHTML;
const setForm = v => {
  dom.el('noticeOn').checked = !!v.on; dom.el('noticeText').value = v.text || '';
  dom.el('noticeOffDate').value = v.offDate || ''; dom.el('noticeOffTime').value = v.offTime || '';
};

console.log('=== the bar ===');
test('no notice: the bar is hidden and empty', () => {
  sampleParentState({ notice: null });
  withFakeNow(NOW, () => renderNoticeBanner());
  assert.equal(dom.el('noticeBanner').style.display, 'none'); assert.equal(dom.html('noticeBanner'), '');
});
test('notice on: every user sees the text in the bar', () => {
  sampleParentState({ notice: { on: true, text: 'Zaterdag geen training.', offDate: '', offTime: '' } });
  withFakeNow(NOW, () => renderNoticeBanner());
  assert.equal(dom.el('noticeBanner').style.display, 'flex');
  assert.match(text(dom.html('noticeBanner')), /Zaterdag geen training\./);
  assert.equal(dom.el('noticeBanner').getAttribute('role'), 'status');
});
test('the text is escaped: HTML typed by the coordinator never runs', () => {
  sampleParentState({ notice: { on: true, text: '<img src=x onerror=alert(1)>' } });
  withFakeNow(NOW, () => renderNoticeBanner());
  assert.ok(!dom.html('noticeBanner').includes('<img'));
  assert.ok(dom.html('noticeBanner').includes('&lt;img'));
});
test('notice off: the bar disappears again', () => {
  sampleParentState({ notice: { on: true, text: 'Hoi' } }); withFakeNow(NOW, () => renderNoticeBanner());
  S.notice = { on: false, text: 'Hoi' }; withFakeNow(NOW, () => renderNoticeBanner());
  assert.equal(dom.el('noticeBanner').style.display, 'none'); assert.equal(dom.html('noticeBanner'), '');
});
test('with an end moment: visible before it, gone after it (the same call, later clock)', () => {
  sampleParentState({ notice: { on: true, text: 'Hoi', offDate: '2026-09-30', offTime: '18:00' } });
  withFakeNow('2026-09-30T17:59:00+02:00', () => renderNoticeBanner()); assert.equal(dom.el('noticeBanner').style.display, 'flex');
  withFakeNow('2026-09-30T18:00:00+02:00', () => renderNoticeBanner()); assert.equal(dom.el('noticeBanner').style.display, 'none');
});

console.log('=== the card in Beheer ===');
test('the card shows the switch, the text (max 100), the end fields, the preview and the status', () => {
  sampleCoordinatorState({ notice: { on: true, text: 'Zaterdag geen training.', offDate: '2026-10-03', offTime: '09:00' } });
  const h = withFakeNow(NOW, () => noticeCardHtml()); const s = text(h);
  assert.match(s, /Melding voor iedereen/); assert.match(s, /Melding tonen/); assert.match(s, /23 \/ 100/);
  assert.match(s, /Automatisch uit op/); assert.match(s, /Zo ziet iedereen het/); assert.match(s, /Zichtbaar voor iedereen/);
  assert.match(h, /id="noticeOn"[^>]* checked/); assert.match(h, /maxlength="100"/);
  assert.match(h, /value="2026-10-03"/); assert.match(h, /value="09:00"/);
});
test('no notice yet: switch off, status "Uit"', () => {
  sampleCoordinatorState({ notice: null });
  const h = withFakeNow(NOW, () => noticeCardHtml());
  assert.ok(!/id="noticeOn"[^>]* checked/.test(h)); assert.match(text(h), /Uit, niet zichtbaar/); assert.match(text(h), /0 \/ 100/);
});
test('an end that has passed shows "Automatisch uitgegaan"', () => {
  sampleCoordinatorState({ notice: { on: true, text: 'Hoi', offDate: '2026-09-30', offTime: '09:00' } });
  assert.match(text(withFakeNow(NOW, () => noticeCardHtml())), /Automatisch uitgegaan/);
});
test('what is typed survives a redraw (draft), and the text in the card is escaped', () => {
  sampleCoordinatorState({ notice: null });
  setForm({ on: true, text: 'A "quote" <b>', offDate: '', offTime: '' }); rememberNoticeDraft();
  const h = withFakeNow(NOW, () => noticeCardHtml());
  assert.match(h, /value="A &quot;quote&quot; &lt;b&gt;"/); assert.match(h, /id="noticeOn"[^>]* checked/);
});

console.log('=== saving ===');
await testAsync('switch on + text: saved in settings/notice, state updated, bar visible, toast', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ notice: null, noticeDraft: null });
  setForm({ on: true, text: ' Zaterdag  geen training. ', offDate: '2026-10-03', offTime: '09:00' });
  const ok = await withFakeNowAsync(NOW, () => saveNotice());
  assert.equal(ok, true);
  const doc = fake.get('settings/notice');
  assert.equal(doc.on, true); assert.equal(doc.text, 'Zaterdag geen training.'); assert.equal(doc.offAt, new Date(2026, 9, 3, 9, 0).getTime());
  assert.equal(S.notice.on, true); assert.equal(S.noticeDraft, null);
  assert.equal(dom.el('noticeBanner').style.display, 'flex'); assert.match(toast(), /Melding staat aan/);
});
await testAsync('switch off: saved, text kept, bar gone', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ notice: { on: true, text: 'Hoi' } });
  setForm({ on: false, text: 'Hoi' });
  assert.equal(await withFakeNowAsync(NOW, () => saveNotice()), true);
  assert.equal(fake.get('settings/notice').on, false); assert.equal(fake.get('settings/notice').text, 'Hoi');
  assert.equal(dom.el('noticeBanner').style.display, 'none'); assert.match(toast(), /Melding staat uit/);
});
await testAsync('switch on without text: refused, nothing saved, the typed values are kept', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ notice: null, noticeDraft: null });
  setForm({ on: true, text: '  ' });
  assert.equal(await withFakeNowAsync(NOW, () => saveNotice()), false);
  assert.equal(fake.get('settings/notice'), undefined); assert.match(toast(), /Vul eerst een tekst in/); assert.equal(S.noticeDraft.on, true);
});
await testAsync('date without time, or an end in the past: refused with its own message', async () => {
  const fake = useFakeDb(sampleDbSeed()); sampleCoordinatorState({ notice: null });
  setForm({ on: true, text: 'Hoi', offDate: '2026-10-03', offTime: '' });
  assert.equal(await withFakeNowAsync(NOW, () => saveNotice()), false); assert.match(toast(), /datum als tijd/);
  setForm({ on: true, text: 'Hoi', offDate: '2026-09-29', offTime: '09:00' });
  assert.equal(await withFakeNowAsync(NOW, () => saveNotice()), false); assert.match(toast(), /verleden/);
  assert.equal(fake.get('settings/notice'), undefined);
});
test('readNoticeForm reads all four fields', () => {
  setForm({ on: true, text: 'Hoi', offDate: '2026-10-03', offTime: '09:00' });
  assert.deepEqual(readNoticeForm(), { on: true, text: 'Hoi', offDate: '2026-10-03', offTime: '09:00' });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
