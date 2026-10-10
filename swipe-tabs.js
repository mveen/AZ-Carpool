// swipe-tabs.js — swipe left/right on a phone to move to the next/previous tab.
// The decision is a pure function (easy to test); initSwipeTabs wires it to the touch events.

const MIN_DISTANCE = 60;   // px the finger must travel sideways
const MAX_DURATION = 600;  // ms; a slow drag is not a swipe
const DOMINANCE = 1.5;     // sideways travel must clearly beat vertical travel (so scrolling never switches tab)

// Which tab to go to, or null. dx/dy: finger movement in px, ms: duration, tabs: visible tab names in order.
export function swipeTarget(dx, dy, ms, tabs, current){
  if(Math.abs(dx) < MIN_DISTANCE || ms > MAX_DURATION) return null;
  if(Math.abs(dx) < Math.abs(dy) * DOMINANCE) return null;
  const i = tabs.indexOf(current);
  if(i < 0) return null;
  const next = i + (dx < 0 ? 1 : -1);   // swipe left = next tab
  return tabs[next] || null;
}

// Swipes that start here belong to something else: text fields, scrollable chip rows, open sheets/dialogs.
const IGNORE = 'input,textarea,select,[contenteditable],.sheetOverlay,.begChips,.dayPills,[data-noswipe]';

export function initSwipeTabs(activate){
  const main = document.querySelector('main');
  if(!main) return;
  let start = null;
  main.addEventListener('touchstart', e => {
    const p = e.touches && e.touches[0];
    start = (p && e.touches.length === 1 && !(e.target.closest && e.target.closest(IGNORE))) ? { x: p.clientX, y: p.clientY, t: Date.now() } : null;
  }, { passive: true });
  main.addEventListener('touchend', e => {
    const s = start; start = null;
    const p = e.changedTouches && e.changedTouches[0];
    if(!s || !p || document.querySelector('.sheetOverlay')) return;
    const tabs = [...document.querySelectorAll('nav button[data-tab]')].filter(b => !b.hidden && b.style.display !== 'none').map(b => b.dataset.tab);
    const on = document.querySelector('nav button.active');
    const to = swipeTarget(p.clientX - s.x, p.clientY - s.y, Date.now() - s.t, tabs, on && on.dataset.tab);
    if(to) activate(to);
  }, { passive: true });
  main.addEventListener('touchcancel', () => { start = null; }, { passive: true });
}
