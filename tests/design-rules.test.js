// Run with: node design-rules.test.js
// Guards the design system (DESIGN.md): the look lives in tokens.css and components.css, nowhere else.
// There is no legacy.css any more: tokens.css + components.css are the whole look (print.css is the fixed-colour PDF layout).
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
const html = read('index.html'), tokens = read('tokens.css'), components = read('components.css'), print = read('print.css');
const uiFiles = readdirSync(root).filter(f => /^(ui-.*|app)\.js$/.test(f));
const INLINE_STYLE_BASELINE = 220;   // the count today; it may only ever be lowered
const SCALE = new Set([10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24]);   // the px values behind the --type-* tokens, plus the 18/22 icon sizes
const sizes = css => [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => +m[1]);

console.log('=== the three stylesheets ===');
test('index.html loads tokens.css, components.css and print.css in that order, has no <style> block and no legacy.css', () => {
  const at = f => html.indexOf('href="./' + f + '"');
  assert.ok(at('tokens.css') > 0 && at('tokens.css') < at('components.css') && at('components.css') < at('print.css'));
  assert.doesNotMatch(html, /<style[\s>]|legacy\.css/);
});
test('the deprecated alias block is gone: tokens.css only has the design system names', () => {
  assert.doesNotMatch(tokens, /DEPRECATED|--bg:|--card:|--accent2:|--pill2:/);
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
test('font sizes in components.css stay on the type scale 10 / 11 / 12 / 13 / 14 / 15 / 16 / 17 / 18 / 20 / 22 / 24', () => {
  assert.deepEqual(sizes(components).filter(n => !SCALE.has(n)), []);
});
test('no radius literals in components.css except 50% and the small detail shapes (handle, app icon, switch, icon tile)', () => {
  const bad = [...components.matchAll(/border-radius:\s*([^;}]+)/g)].map(m => m[1].trim()).filter(v => !/^var\(--radius-[a-z]+\)( var\(--radius-[a-z]+\) 0 0)?$/.test(v) && !['50%', '3px', '5px', '6px', '9px', '11px', '15px', 'inherit', '0'].includes(v));
  assert.deepEqual(bad, []);
});
test('no control removes its focus outline, and one global ring exists', () => {
  assert.doesNotMatch(components, /outline:\s*(none|0)\b/);
  assert.match(components, /\n:focus-visible\{outline:2px solid var\(--info\)/);
});
test('every tap target rule uses the 44px minimum token', () => {
  assert.match(components, /\.roundBtn\{width:var\(--hit-min\);height:var\(--hit-min\)/);
  assert.match(components, /\.avatarBtn\{width:var\(--hit-min\);height:var\(--hit-min\)/);
});

console.log('\n=== the rest of the code ===');
test('no control removes its focus outline anywhere in the CSS', () => { assert.doesNotMatch(components + print, /outline:\s*(none|0)\b/); });
test('print.css is the only stylesheet with fixed colours, and it is only about the Weekoverzicht', () => {
  const heads = [...print.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map(m => m[2].trim()).filter(h => !/^\/\*/.test(h));
  assert.deepEqual(heads.filter(h => !/\.ov|\.noPrint|html,body|body>\*/.test(h)), []);
});

console.log('\n=== UI modules ===');
test('inline font sizes in the UI modules are at least 11px', () => {
  const bad = [];
  for (const f of uiFiles) for (const m of read(f).matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) if (+m[1] < 11) bad.push(f + ': ' + m[0]);
  assert.deepEqual(bad, []);
});
test('old variable names are gone from the UI modules: only tokens from tokens.css are used', () => {
  const old = ['bg', 'card', 'text', 'muted', 'border', 'accent2', 'accent-text', 'ok2', 'warn', 'warn2', 'warn-text', 'pill', 'pill2', 'danger', 'info2', 'match', 'match2'];
  const bad = [];
  for (const f of [...uiFiles, 'index.html']) for (const m of read(f).matchAll(/var\(--([\w-]+)\)/g)) if (old.includes(m[1])) bad.push(f + ': --' + m[1]);
  assert.deepEqual(bad, []);
  const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  const undefinedVars = [];
  for (const f of [...uiFiles, 'index.html', 'components.css']) for (const m of read(f).matchAll(/var\((--[\w-]+)/g)) if (!defined.has(m[1]) && !components.includes(m[1] + ':')) undefinedVars.push(f + ': ' + m[1]);
  assert.deepEqual(undefinedVars, []);
});
test('ratchet: inline style="..." attributes in the UI modules may only go down (new code uses classes)', () => {
  let n = 0; for (const f of uiFiles) n += (read(f).match(/style="/g) || []).length;
  assert.ok(n <= INLINE_STYLE_BASELINE, 'inline styles grew to ' + n + ' (baseline ' + INLINE_STYLE_BASELINE + '): use a class from components.css');
});
test('ui-shell.js (new code) has no colour literal and no inline font size: it uses classes from components.css', () => {
  const src = read('ui-shell.js');
  assert.deepEqual(src.match(/#[0-9a-fA-F]{6}\b/g) || [], []);
  assert.doesNotMatch(src, /font-size:/);
});

test('sheets slide up and the scrim fades in, except for people who asked for less motion', () => {
  assert.match(components, /@keyframes sheetUp/); assert.match(components, /\.sheet,\.helpPanel\{animation:sheetUp/); assert.match(components, /prefers-reduced-motion:reduce\)\{[^}]*animation:none/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
