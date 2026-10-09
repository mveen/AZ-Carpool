// ui-help.js — the help panel behind the "?" in the header. Search runs in the browser over help-nl.js:
// no server, no AI, no key, no personal data. The panel only shows fixed text.
import { t } from './i18n.js';
import { S } from './state.js';
import { esc, phIcon } from './ui-common.js';
import { searchHelp, findArticle } from './help.js';

const NAV_KEY = { myweek: 'nav.myweek', deviation: 'nav.deviation', schedule: 'nav.rooster', profile: 'nav.profile', matches: 'nav.matches', beheer: 'nav.beheer' };
let opener = null;

function paragraphHtml(p){
  const line = /^(•|\d+\.)\s/.test(p);
  return `<p class="helpP${line ? ' helpLine' : ''}">${esc(p)}</p>`;
}

// The list: all topics (empty search) or the results of a search.
export function helpListHtml(query){
  const q = String(query || '').trim();
  const list = searchHelp(q, { canEdit: !!S.canEdit });
  if(!list.length) return `<p class="muted helpEmpty">${esc(t('help.no_results'))}</p>`;
  const item = a => `<button type="button" class="helpItem" data-helpid="${esc(a.id)}"><span>${esc(a.title)}</span>${phIcon('arrow-right')}</button>`;
  if(q) return `<h3 class="helpHead">${esc(t('help.results'))}</h3>` + list.map(item).join('');
  // No search: the topics, then "Over deze app" as its own group at the bottom.
  const topics = list.filter(a => a.group !== 'over'), about = list.filter(a => a.group === 'over');
  return `<h3 class="helpHead">${esc(t('help.topics'))}</h3>` + topics.map(item).join('')
    + (about.length ? `<h3 class="helpHead">${esc(t('help.about'))}</h3>` + about.map(item).join('') : '');
}

export function helpArticleHtml(id){
  const a = findArticle(id, { canEdit: !!S.canEdit });
  if(!a) return '';
  const navBtn = document.querySelector('nav button[data-tab="' + a.tab + '"]');
  const go = (a.tab && NAV_KEY[a.tab] && navBtn && navBtn.style.display !== 'none')
    ? `<button type="button" class="btn helpGo" data-helpgo="${esc(a.tab)}">${esc(t('help.goto', { tab: t(NAV_KEY[a.tab]) }))}</button>` : '';
  return `<button type="button" class="helpBack" id="helpBack">${phIcon('arrow-left')} ${esc(t('help.back'))}</button>
    <h3 class="helpTitle">${esc(a.title)}</h3>${a.body.map(paragraphHtml).join('')}${go}
    <p class="muted helpContact">${esc(t('help.contact'))}</p>`;
}

export function closeHelp(){
  const ov = document.getElementById('helpOverlay');
  if(ov) ov.remove();
  const btn = opener; opener = null;
  if(btn && btn.focus) btn.focus();
}

export function openHelp(fromButton){
  closeHelp();
  opener = fromButton || document.getElementById('avatarBtn') || null;
  const ov = document.createElement('div');
  ov.className = 'helpOverlay'; ov.id = 'helpOverlay';
  ov.innerHTML = `<div class="helpPanel" role="dialog" aria-modal="true" aria-labelledby="helpTitle">
    <div class="helpTop"><h2 id="helpTitle">${esc(t('help.title'))}</h2><button type="button" class="iconbtn helpClose" id="helpClose" aria-label="${esc(t('help.close'))}" title="${esc(t('help.close'))}">${phIcon('x')}</button></div>
    <label class="helpSearchLabel" for="helpSearch">${esc(t('help.search_label'))}</label>
    <input type="search" id="helpSearch" class="helpSearch" autocomplete="off" placeholder="${esc(t('help.search_placeholder'))}" enterkeyhint="search">
    <div id="helpBody" class="helpBody" aria-live="polite"></div>
  </div>`;
  document.body.appendChild(ov);
  const input = ov.querySelector('#helpSearch');
  const body = ov.querySelector('#helpBody');
  const showList = () => { body.innerHTML = helpListHtml(input.value); body.scrollTop = 0; };
  const showArticle = id => { body.innerHTML = helpArticleHtml(id); body.scrollTop = 0; };
  showList();
  ov.addEventListener('click', e => { if(e.target === ov) closeHelp(); });
  ov.querySelector('#helpClose').onclick = closeHelp;
  input.addEventListener('input', showList);
  body.addEventListener('click', e => {
    const item = e.target.closest && e.target.closest('[data-helpid]');
    if(item){ showArticle(item.dataset.helpid); return; }
    if(e.target.closest && e.target.closest('#helpBack')){ showList(); input.focus(); return; }
    const go = e.target.closest && e.target.closest('[data-helpgo]');
    if(go){
      const tab = document.querySelector('nav button[data-tab="' + go.dataset.helpgo + '"]');
      closeHelp();
      if(tab) tab.click();
    }
  });
  input.focus();
}
