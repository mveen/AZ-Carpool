// ui-push-device.js — Instellingen > Push-meldingen: a parent switches the real pushes of Ritten ruilen on for THIS phone.
// The row only shows while the push switch on the Ritten-ruilen card (Beheer) is on and Ritten ruilen itself is on, for a browser that
// belongs to a family. A tap on the switch saves at once (no Opslaan button): it subscribes this browser to its push service and stores
// the address for the server (pushDevices/<id>, with the family), or removes it again. The data work is in push-data.js.
import { t } from './i18n.js';
import { S } from './state.js';
import { esc, hapticTap, closeSheet, showToast } from './ui-common.js';
import { pushLiveOn, quietOf, ritbeursOn } from './ritbeurs-data.js';
import { disableFamilyDevice, enableFamilyDevice, loadMyDevice, ownPushFamilyId, permissionState, pushSupport } from './push-data.js';

// Does this browser get the Push-meldingen row in Instellingen?
export function pushRowVisible(){ return pushLiveOn() && ritbeursOn() && !!ownPushFamilyId(); }

// Why switching on did nothing, said out loud (a tap that seems to do nothing is the worst answer). 'mislukt' already told itself.
const REFUSED = {
  geenSleutel: 'push.me.geenSleutel', geweigerd: 'push.hint.geweigerd', iosInstalleren: 'push.hint.ios', geenSupport: 'push.hint.geenSupport', ongeldig: 'push.err.ongeldig',
};

// The inside of the sheet. The sheet has its own title, so the text starts straight away.
export function pushMeInnerHtml(){
  const me = S.pushMe;
  if(me.status === 'idle' || me.status === 'loading') return `<div class="panel__sub">${t('push.me.laden')}</div>`;
  if(me.status === 'error') return `<div class="panel__sub">${t('push.me.laden_mislukt')}</div>`;
  const support = pushSupport(), perm = permissionState();
  const hasKey = !!(me.key && me.key.publicKey);
  let hint = '';
  if(!me.on){
    if(support === 'iosInstalleren') hint = t('push.hint.ios');
    else if(support === 'geenSupport') hint = t('push.hint.geenSupport');
    else if(perm === 'denied') hint = t('push.hint.geweigerd');
    else if(!hasKey) hint = t('push.me.geenSleutel');
  }
  const canSwitch = me.on || (support === 'ok' && perm !== 'denied' && hasKey);
  const quiet = quietOf(ownPushFamilyId());
  return `<div class="panel__sub">${t('push.me.uitleg')}</div>
    <label class="switchRow" for="pushMeOn"><span>${t('push.me.label')}</span>
      <input type="checkbox" role="switch" class="switch" id="pushMeOn"${me.on ? ' checked' : ''}${canSwitch ? '' : ' disabled'}></label>
    ${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
    <p class="muted">${esc(t('push.me.stille', { from: quiet.from, to: quiet.to }))}</p>
    <p class="muted">${t('push.me.dezeTelefoon')}</p>
    <p class="muted">${t('push.me.privacy')}</p>`;
}

export function openPushSheet(){
  if(!ownPushFamilyId()) return;
  closeSheet();
  S.pushMe.status = 'loading';
  const ov = document.createElement('div'); ov.className = 'sheetOverlay'; ov.id = 'sheetOverlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <div class="sheet__handle"></div>
    <h3 id="sheetTitle">${esc(t('push.me.title'))}</h3>
    <div id="pushMeCard">${pushMeInnerHtml()}</div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if(e.target === ov) closeSheet(); });
  loadMyDevice().then(redrawPushSheet);
}

function redrawPushSheet(){
  const el = typeof document !== 'undefined' && document.getElementById('pushMeCard');
  if(!el) return;   // the sheet was closed meanwhile
  el.innerHTML = pushMeInnerHtml();
  wirePushSheet();
}

// The switch: on = subscribe and store, off = remove. The switch is locked while it works and shows what really happened afterwards.
export async function togglePushMe(on){
  const res = on ? await enableFamilyDevice() : { ok: await disableFamilyDevice() };
  if(on && !res.ok && REFUSED[res.reason]) showToast(t(REFUSED[res.reason]));
  redrawPushSheet();
  return res;
}
export function wirePushSheet(){
  const sw = document.getElementById('pushMeOn');
  if(!sw) return;
  sw.onchange = () => { hapticTap(); sw.disabled = true; togglePushMe(!!sw.checked); };
}
