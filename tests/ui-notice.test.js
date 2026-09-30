// Run with: node ui-notice.test.js
// The yellow bar (everyone) and the Beheer card for the notice.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { installFakeDom, useFakeDb, sampleCoordinatorState, withFakeNow, NOW } from './test-support.js';
import { S } from '../state.js';
import { renderNoticeBanner, noticeCardHtml, saveNotice } from '../ui-notice.js';

const dom = installFakeDom();
const toast = () => dom.doc.getElementById('toast').innerHTML;
const setField = (id, v) => { dom.doc.getElementById(id).value = v; };

await testAsync('the bar shows the text escaped while the notice is active, and hides when off or ended', async () => {
  useFakeDb({}); sampleCoordinatorState({ notice: { on: true, text: 'Geen <b>training</b>', offDate: '', offTime: '' } });
  dom.doc.getElementById('noticeBanner');
  withFakeNow(NOW, () => renderNoticeBanner());
  const el = dom.el('noticeBanner');
  assert.equal(el.style.display, 'flex'); assert.match(el.innerHTML, /Geen &lt;b&gt;training&lt;\/b&gt;/); assert.ok(!/<b>/.test(el.innerHTML));
  S.notice = { on: true, text: 'x', offDate: '2026-09-30', offTime: '09:00' };
  withFakeNow(NOW, () => renderNoticeBanner());
  assert.equal(el.style.display, 'none'); assert.equal(el.innerHTML, '');
});
await testAsync('the Beheer card shows the status and keeps unsaved typing', async () => {
  useFakeDb({}); sampleCoordinatorState({ notice: null });
  assert.match(noticeCardHtml(), /Uit, niet zichtbaar/);
  S.noticeDraft = { on: true, text: 'Concept', offDate: '', offTime: '' };
  assert.match(noticeCardHtml(), /value="Concept"/);
});
await testAsync('saveNotice stores a valid notice; an invalid one writes nothing', async () => {
  const fake = useFakeDb({}); sampleCoordinatorState({ notice: null });
  dom.doc.getElementById('noticeOn'); dom.doc.getElementById('noticeText'); dom.doc.getElementById('noticeOffDate'); dom.doc.getElementById('noticeOffTime');
  dom.doc.getElementById('noticeOn').checked = true; setField('noticeText', '  '); setField('noticeOffDate', ''); setField('noticeOffTime', '');
  assert.equal(await saveNotice(), false); assert.match(toast(), /Vul eerst een tekst in/); assert.equal(fake.get('settings/notice'), undefined);
  setField('noticeText', 'Zaterdag geen training');
  assert.equal(await saveNotice(), true);
  const d = fake.get('settings/notice');
  assert.equal(d.on, true); assert.equal(d.text, 'Zaterdag geen training'); assert.equal(S.notice.text, 'Zaterdag geen training');
  assert.equal(S.noticeDraft, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
