// i18n.js — the one place that turns message keys into on-screen / WhatsApp text.
//   t('wa.day.title', { dayLabel: 'Maandag', date: '28 sep' })   ->  "Aangepast schema Maandag 28 sep:"
// Texts live in one dictionary file per language (texts-nl.js is the source language).
// To add a language: copy texts-nl.js to texts-xx.js, translate the values (keep the {placeholders}),
// register it below and call setLanguage('xx'). A missing key falls back to Dutch, then to the key itself,
// so a half-translated file never shows a blank.
import nl from './texts-nl.js';

const dictionaries = { nl };
let current = 'nl';

export function registerLanguage(code, dict){ dictionaries[code] = dict; }
export function setLanguage(code){ if(!dictionaries[code]) throw new Error('Unknown language: '+code); current = code; }
export function getLanguage(){ return current; }

export function t(key, params){
  const dict = dictionaries[current] || nl;
  let s = key in dict ? dict[key] : (key in nl ? nl[key] : key);
  if(params) s = s.replace(/\{(\w+)\}/g, (m, name)=> (name in params && params[name]!=null) ? String(params[name]) : m);
  return s;
}
// BCP-47 locale used for dates ("nl-NL"), kept next to the texts so a translation can change both.
export function locale(){ return t('meta.locale'); }
export function hasKey(key){ return key in nl; }
export function allKeys(){ return Object.keys(nl); }
