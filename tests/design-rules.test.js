// Run with: node design-rules.test.js
// Guards the design system (DESIGN.md): the look lives in tokens.css and components.css, nowhere else.
// legacy.css is the old CSS that is still being migrated; it only gets the old guards and may only shrink.
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
const read = f => readFileSync(path.join(root, f), 'utf8');
const html = read('index.html'), tokens = read('tokens.css'), components = read('components.css'), legacy = read('legacy.css');
const uiFiles = readdirSync(root).filter(f => /^(ui-.*|app)\.js$/.test(f));
const SCALE = new Set([10, 11, 12, 13, 14, 15, 17, 18, 20, 22, 24]);   // the px values behind the --type-* tokens, plus the 18/22 icon sizes
const sizes = css => [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => +m[1]);

console.log('=== the three stylesheets ===');
test('index.html loads tokens.css, legacy.css and components.css in that order, and has no <style> block', () => {
  const at = f => html.indexOf('href="./' + f + '"');
  assert.ok(at('tokens.css') > 0 && at('tokens.css') < at('legacy.css') && at('legacy.css') < at('components.css'));
  assert.doesNotMatch(html, /<style[\s>]/);
});
test('every design token role used by DESIGN.md exists in light and dark where it differs', () => {
  for (const v of ['--surface-page', '--surface-card', '--surface-soft', '--line', '--text-1', '--text-muted', '--action-bg', '--action-ink', '--accent', '--accent-soft', '--accent-ink',
    '--ok', '--ok-soft', '--ok-ink', '--warn-soft', '--warn-icon', '--warn-ink', '--warn-edge', '--match-soft', '--match-ink', '--info', '--scrim', '--toast-bg']) {
    assert.match(tokens, new RegExp(v + ':'), v + ' missing in tokens.css');
  }
  const dark = tokens.slice(tokens.indexOf('[data-theme="dark"]{'), tokens.indexOf('/* ---------- DEPRECATED'));
  for (const v of ['--surface-page', '--surface-card', '--text-1', '--action-bg', '--accent-ink', '--ok-ink', '--warn-ink', '--warn-edge', '--match-ink']) assert.match(dark, new RegExp(v + ':'), v + ' has no dark value');
});
test('primary buttons are ink, never red', () => {
  assert.match(components, /button\.btn,\.btn\{[^}]*background:var\(--action-bg\)/);
  assert.match(tokens, /--action-bg:var\(--ink-900\)/);
});

console.log('\n=== components.css speaks only in tokens ===');
test('no colour literals (hex, rgb, hsl) in components.css', () => {
  assert.deepEqual(components.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) || [], []);
});
test('font sizes in components.css stay on the type scale 10 / 11 / 12 / 13 / 14 / 15 / 17 / 18 / 20 / 22 / 24', () => {
  assert.deepEqual(sizes(components).filter(n => !SCALE.has(n)), []);
});
test('no radius literals in components.css except 50% and the small detail shapes (handle, app icon, switch, icon tile)', () => {
  const bad = [...components.matchAll(/border-radius:\s*([^;}]+)/g)].map(m => m[1].trim()).filter(v => !/^var\(--radius-[a-z]+\)( var\(--radius-[a-z]+\) 0 0)?$/.test(v) && !['50%', '3px', '9px', '11px', '15px', '0'].includes(v));
  assert.deepEqual(bad, []);
});
test('no control removes its focus outline, and one global ring exists', () => {
  assert.doesNotMatch(components + legacy, /outline:\s*(none|0)\b/);
  assert.match(components, /\n:focus-visible\{outline:2px solid var\(--info\)/);
});
test('every tap target rule uses the 44px minimum token', () => {
  assert.match(components, /\.roundBtn\{width:var\(--hit-min\);height:var\(--hit-min\)/);
  assert.match(components, /\.avatarBtn\{width:var\(--hit-min\);height:var\(--hit-min\)/);
});

console.log('\n=== legacy.css may only shrink ===');
test('legacy.css has no font-size under 12px and keeps the old scale 12 / 14 / 16 / 18 / 20 / 22 / 24 (print overview .ov* exempt)', () => {
  const ok = new Set([12, 14, 16, 18, 20, 22, 24]);
  const lines = legacy.split('\n').filter(l => !/\.ov(Head|Table|Note|Link)/.test(l) && !/^\s+\.ovTable/.test(l));
  assert.deepEqual(lines.filter(l => sizes(l).some(n => !ok.has(n))).map(l => l.slice(0, 70)), []);
});
test('legacy.css no longer defines the shell (header, tab bar, main): that is components.css now', () => {
  assert.doesNotMatch(legacy, /\n(header|#bottomnav|\.navtab|main|body)\s*[{,.]/);
});
test('amber stays a token in legacy.css (no hex on the dev alert rules)', () => {
  const rules = legacy.split('\n').filter(l => /^\.(devRide|devAlert)\b/.test(l));
  rules.forEach(l => assert.doesNotMatch(l, /#[0-9a-fA-F]{3,6}\b/, 'hard-coded colour in: ' + l.slice(0, 60)));
});

console.log('\n=== UI modules ===');
test('inline font sizes in the UI modules are at least 11px', () => {
  const bad = [];
  for (const f of uiFiles) for (const m of read(f).matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) if (+m[1] < 11) bad.push(f + ': ' + m[0]);
  assert.deepEqual(bad, []);
});
test('ui-shell.js (new code) has no colour literal and no inline font size: it uses classes from components.css', () => {
  const src = read('ui-shell.js');
  assert.deepEqual(src.match(/#[0-9a-fA-F]{6}\b/g) || [], []);
  assert.doesNotMatch(src, /font-size:/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
