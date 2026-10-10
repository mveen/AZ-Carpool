// avatars.js — the avatar library: a parent picks an icon instead of the initials. The choice is stored on the family
// document as the optional field `avatar` (the Phosphor icon name); no field = initials, the default. Pure helpers only.
import { t } from './i18n.js';
import { esc, phIcon } from './ui-common.js';

// The choosable icons, in picker order. The id is the icon name and is what Firestore holds, so never rename one.
export const AVATARS = ['user', 'car', 'steering-wheel', 'road-horizon', 'soccer-ball', 'trophy', 'medal', 'megaphone', 'users-three', 'handshake'];

// The stored value if it is a known avatar, otherwise '' (initials). Unknown values (older or newer app) fall back quietly.
export function validAvatar(id){ return AVATARS.includes(id) ? id : ''; }

// The Dutch name under each icon in the picker (explicit keys, so the texts check can see every one).
const LABELS = {
  'user': () => t('avatar.l.user'), 'car': () => t('avatar.l.car'), 'steering-wheel': () => t('avatar.l.steering-wheel'),
  'road-horizon': () => t('avatar.l.road-horizon'), 'soccer-ball': () => t('avatar.l.soccer-ball'), 'trophy': () => t('avatar.l.trophy'),
  'medal': () => t('avatar.l.medal'), 'megaphone': () => t('avatar.l.megaphone'), 'users-three': () => t('avatar.l.users-three'), 'handshake': () => t('avatar.l.handshake'),
};
export function avatarLabel(id){ return LABELS[id] ? LABELS[id]() : ''; }

// The avatar of a family document (or undefined) -> id or ''.
export function avatarOf(family){ return validAvatar(family && family.avatar); }

// What goes inside an avatar circle: the icon, or the fallback text (the initials) escaped.
export function avatarInner(id, fallbackText){
  const a = validAvatar(id);
  return a ? phIcon(a) : esc(fallbackText || '');
}

// Extra class for a circle that shows an icon (red tint, see components.css); '' for initials.
export function avatarClass(id){ return validAvatar(id) ? ' avatar--icon' : ''; }
