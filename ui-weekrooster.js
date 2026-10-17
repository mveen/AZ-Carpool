// ui-weekrooster.js — Afwijkend weekrooster, the screens. Phase 1: only the switch card in Beheer (Berichten).
// The card is for the real coordinator and saves at once (no Opslaan button next to a switch).
import { t } from './i18n.js';
import { esc, hapticTap } from './ui-common.js';
import { renderBeheer } from './ui-beheer.js';
import { WEEKROOSTER_MODES } from './weekrooster.js';
import { setWeekrooster, weekroosterMode } from './weekrooster-data.js';

// One literal text key per mode (no key is built from pieces, so the key checks can see every one).
const modeLabel = m => (m === 'aan' ? t('weekrooster.beheer.mode.aan') : m === 'test' ? t('weekrooster.beheer.mode.test') : t('weekrooster.beheer.mode.uit'));
const modeStatus = m => (m === 'aan' ? t('weekrooster.beheer.status.aan') : m === 'test' ? t('weekrooster.beheer.status.test') : t('weekrooster.beheer.status.uit'));

export function weekroosterCardHtml() {
  const mode = weekroosterMode();
  const buttons = WEEKROOSTER_MODES.map(m =>
    `<button type="button" class="${m === mode ? 'active' : ''}" data-wrmode="${m}" aria-pressed="${m === mode}">${modeLabel(m)}</button>`).join('');
  return `<div class="card" id="weekroosterCard">
      <h2>${t('weekrooster.beheer.title')}</h2>
      <p class="muted">${t('weekrooster.beheer.intro')}</p>
      <p class="muted">${t('weekrooster.beheer.autosave')}</p>
      <div class="segmented" role="group" aria-label="${esc(t('weekrooster.beheer.aria'))}">${buttons}</div>
      <div class="rowflex"><span class="noticeChip ${mode === 'uit' ? 'off' : 'ok'}">${modeLabel(mode)}</span>
      <span class="muted">${modeStatus(mode)}</span></div>
    </div>`;
}

export function wireWeekroosterCard() {
  document.querySelectorAll('[data-wrmode]').forEach(b => {
    b.onclick = async () => {
      if (b.dataset.wrmode === weekroosterMode()) return;
      hapticTap();
      await setWeekrooster(b.dataset.wrmode);
      renderBeheer();
    };
  });
}
