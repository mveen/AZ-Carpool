// escape.js — HTML escaping, on its own (no imports) so that rides.js, and with it the server job (cron/purge.mjs), does not drag in the screen code.
// ui-common.js re-exports it, so every screen keeps importing esc from there.
export function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
