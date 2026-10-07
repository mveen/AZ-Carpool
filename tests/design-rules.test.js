// Run with: node design-rules.test.js
// Guards the design rules from the design critique (October 2026): one global keyboard focus ring,
// amber colours only through tokens, and no screen text under 12px. The print overview (.ov*) is exempt.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const uiFiles = readdirSync(root).filter(f => /^(ui-.*|app)\.js$/.test(f));

test('one global :focus-visible ring exists, with a white ring on the red header', () => {
  assert.match(css, /\n:focus-visible\{outline:2px solid var\(--info\)/);
  assert.match(css, /header :focus-visible\{outline-color:#fff\}/);
});

test('no control removes its focus outline', () => {
  assert.doesNotMatch(css, /outline:\s*(none|0)\b/);
});

test('amber colours are tokens (light and dark), not hard-coded hex', () => {
  for (const tok of ['--warn-line', '--warn-edge', '--warn-bar']) {
    assert.equal(css.split(tok + ':').length - 1, 2, tok + ' must be defined once for light and once for dark');
  }
  const rules = css.split('\n').filter(l => /^\.(devRide|devAlert)\b/.test(l));
  rules.forEach(l => assert.doesNotMatch(l, /#[0-9a-fA-F]{3,6}\b/, 'hard-coded colour in: ' + l.slice(0, 60)));
});

test('screen CSS has no font-size under 12px (print overview .ov* exempt)', () => {
  const bad = css.split('\n').filter(l => !/\.ov(Head|Table|Note|Link)/.test(l) && !/^\s+\.ovTable/.test(l))
    .filter(l => [...l.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].some(m => +m[1] < 12));
  assert.deepEqual(bad.map(l => l.slice(0, 70)), []);
});

test('screen CSS uses only the type scale 12 / 14 / 16 / 18 / 20 / 22 / 24 (nav icon 19 and print .ov* exempt)', () => {
  const ok = new Set([12, 14, 16, 18, 20, 22, 24]);
  const bad = css.split('\n').filter(l => !/\.ov(Head|Table|Note|Link)/.test(l) && !/^\s+\.ovTable/.test(l) && !/\.navicon\{/.test(l))
    .filter(l => [...l.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].some(m => !ok.has(+m[1])));
  assert.deepEqual(bad.map(l => l.slice(0, 70)), []);
});

test('inline font sizes in the UI modules are at least 12px', () => {
  const bad = [];
  for (const f of uiFiles) {
    const src = readFileSync(path.join(root, f), 'utf8');
    for (const m of src.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) if (+m[1] < 12) bad.push(f + ': ' + m[0]);
  }
  assert.deepEqual(bad, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
