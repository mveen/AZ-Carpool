// help.js — search over the help articles (pure functions: no DOM, no Firebase, no network, no keys).
// The whole help works in the browser on the fixed texts of help-nl.js. Nothing a user types leaves the device.
import articlesNl from './help-nl.js';

// Words that carry no meaning in a question ("hoe kan ik mijn ...").
const STOP = new Set(['de','het','een','ik','hoe','kan','waar','is','en','of','van','in','op','te','dat','wat','mijn','mij','me','je','jij','om','voor','met','naar','niet','ook','er','bij','aan','als','dan','wie','wil','moet','heb','ben','nog','zijn','wordt','dit','die','deze','maar','geen']);

export function normalize(s){
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
export function words(s){
  return normalize(s).split(/[^a-z0-9]+/).filter(Boolean);
}
export function queryTokens(q){
  const all = words(q).filter(w => w.length >= 2);
  const kept = all.filter(w => !STOP.has(w));
  return kept.length ? kept : all;
}
// A query word matches a text word when one starts with the other ("wijzigingen" ~ "wijziging", "ziek" ~ "ziekte").
// Very short text words (< 4 letters) only match exactly, so "de" or "of" never match everything.
function wordMatches(tok, w){
  if(tok === w) return true;
  if(w.length >= 4 && tok.startsWith(w)) return true;
  return tok.length >= 3 && w.startsWith(tok);
}

export function visibleArticles(canEdit, articles){
  return (articles || articlesNl).filter(a => !a.coordinatorOnly || canEdit);
}

function scoreArticle(a, tokens){
  const title = words(a.title), keys = words(a.keywords || ''), body = words((a.body || []).join(' '));
  let score = 0, hit = 0;
  for(const tok of tokens){
    let s = 0;
    if(title.some(w => wordMatches(tok, w))) s = Math.max(s, 6);
    if(keys.some(w => wordMatches(tok, w))) s = Math.max(s, 4);
    if(body.some(w => wordMatches(tok, w))) s = Math.max(s, 1);
    if(s){ score += s; hit++; }
  }
  // Articles that match more of the words in the question rank above articles that match one word strongly.
  return hit ? score + hit * 3 : 0;
}

// The best articles for a question, best first. Empty question: all visible articles in their own order.
export function searchHelp(query, opts){
  const o = opts || {};
  const list = visibleArticles(!!o.canEdit, o.articles);
  const tokens = queryTokens(query);
  if(!tokens.length) return list.slice();
  return list
    .map((a, i) => ({ a, i, s: scoreArticle(a, tokens) }))
    .filter(x => x.s > 0)
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .slice(0, o.limit || 6)
    .map(x => x.a);
}

export function findArticle(id, opts){
  const o = opts || {};
  return visibleArticles(!!o.canEdit, o.articles).find(a => a.id === id) || null;
}
