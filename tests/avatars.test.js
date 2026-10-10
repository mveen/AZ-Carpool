// Run with: node avatars.test.js
// The avatar library: which icons can be chosen, and what goes inside an avatar circle.
import assert from 'node:assert/strict';
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); }
}
import { PH_PATHS } from '../constants.js';
import { AVATARS, validAvatar, avatarLabel, avatarOf, avatarInner, avatarClass } from '../avatars.js';

console.log('=== the library ===');
test('there are between 10 and 18 avatars, all different', () => {
  assert.ok(AVATARS.length >= 10 && AVATARS.length <= 18); assert.equal(new Set(AVATARS).size, AVATARS.length);
});
test('every avatar is a Phosphor icon that exists, and has a Dutch label', () => {
  for (const id of AVATARS) { assert.ok(PH_PATHS[id], id); assert.notEqual(avatarLabel(id), 'avatar.l.' + id, id); }
});
test('the stored ids are frozen: these exact ids may never be renamed (they live in Firestore)', () => {
  assert.deepEqual(AVATARS, ['user', 'car', 'steering-wheel', 'road-horizon', 'soccer-ball', 'trophy', 'medal', 'megaphone', 'users-three', 'handshake']);
});

console.log('\n=== reading the stored value ===');
test('validAvatar keeps known ids and turns everything else into "" (initials)', () => {
  assert.equal(validAvatar('car'), 'car'); assert.equal(validAvatar(''), ''); assert.equal(validAvatar(undefined), ''); assert.equal(validAvatar(null), '');
  assert.equal(validAvatar('rocket'), ''); assert.equal(validAvatar(5), ''); assert.equal(validAvatar('<svg>'), '');
});
test('avatarOf reads the field of a family document, also when the family or the field is missing', () => {
  assert.equal(avatarOf({ avatar: 'medal' }), 'medal'); assert.equal(avatarOf({}), ''); assert.equal(avatarOf(undefined), '');
});

console.log('\n=== the circle ===');
test('avatarInner gives the icon for an avatar, the escaped fallback text for none', () => {
  assert.match(avatarInner('car', 'PP'), /^<svg[^>]*>.*<\/svg>$/); assert.doesNotMatch(avatarInner('car', 'PP'), /PP/);
  assert.equal(avatarInner('', 'PP'), 'PP'); assert.equal(avatarInner('nope', '<b>'), '&lt;b&gt;'); assert.equal(avatarInner('', undefined), '');
});
test('avatarClass marks icon circles only', () => { assert.equal(avatarClass('car'), ' avatar--icon'); assert.equal(avatarClass(''), ''); assert.equal(avatarClass('nope'), ''); });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
