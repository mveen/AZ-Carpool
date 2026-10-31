// AZ Carpool — service worker
// STALE-WHILE-REVALIDATE: a file in the cache is served at once and refreshed from the network in the background, so the app
// opens fast and offline. A new deploy still reaches everybody: the bumped CACHE_NAME below makes this file change, the new
// worker installs a fresh copy of every ASSET, and bootstrap() in app.js reloads the open app. Not in the cache yet: network.
// Bump CACHE_NAME on EVERY deploy (not only when the asset list changes): a changed service-worker.js is the
// signal that makes open apps pick up the new version and reload (see bootstrap() in app.js).
const CACHE_NAME = 'az-carpool-v165';
const ASSETS = [
  './',
  './index.html',
  './tokens.css',
  './components.css',
  './print.css',
  './ui-shell.js',
  './swipe-tabs.js',
  './ui-contact.js',
  './avatars.js',
  './planning.js',
  './period.js',
  './period-backup.js',
  './family-backup.js',
  './ride-log.js',
  './app.js',
  './state.js',
  './constants.js',
  './i18n.js',
  './texts-nl.js',
  './dates.js',
  './escape.js',
  './rides.js',
  './day-changes.js',
  './flex.js',
  './locations.js',
  './ov.js',
  './driver-car.js',
  './driver-car-data.js',
  './ui-driver-car.js',
  './distance.js',
  './impact.js',
  './coordinator.js',
  './matches.js',
  './data.js',
  './message-texts.js',
  './ui-common.js',
  './ui-schedule.js',
  './ui-overview.js',
  './ui-myweek.js',
  './ui-deviation.js',
  './ui-period.js',
  './notice.js',
  './ui-notice.js',
  './ritbeurs.js',
  './ritbeurs-data.js',
  './ui-ritbeurs.js',
  './weekrooster.js',
  './weekrooster-data.js',
  './ui-weekrooster-form.js',
  './ui-weekrooster-rooster.js',
  './ui-weekrooster-advice.js',
  './ui-weekrooster-edit.js',
  './weekrooster-impact.js',
  './weekrooster-plan.js',
  './notif-text.js',
  './push.js',
  './push-access.js',
  './push-scenarios.js',
  './push-data.js',
  './ui-push.js',
  './ui-push-device.js',
  './maintenance.js',
  './ui-maintenance.js',
  './ui-ride-log.js',
  './ui-period-rooster.js',
  './ui-matches.js',
  './ui-help.js',
  './help.js',
  './help-nl.js',
  './test-count.js',
  './ui-beheer.js',
  './ui-profile.js',
  './ui-agenda.js',
  './ui-install-prompt.js',
  './error-log.js',
  './session-reset.js',
  './calendar-feed.js',
  './schedule-changes.js',
  './firebase-config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
  './icon.svg',
  './fonts/onest-latin-400.woff2',
  './fonts/onest-latin-500.woff2',
  './fonts/onest-latin-600.woff2',
  './fonts/onest-latin-700.woff2',
  './fonts/onest-latin-800.woff2',
  './fonts/jetbrains-mono-v24-latin-600.woff2',
  './fonts/jetbrains-mono-v24-latin-700.woff2',
  './fonts/jetbrains-mono-v24-latin-800.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ---------- Push (real pushes to the parents' own phones while the push switch of Ritten ruilen is on, test copies to the coordinator; see push.js) ----------
// Every push is shown as a system notification (browsers, iPhone especially, take back the permission when a push shows nothing).
// A broken or empty message still shows a plain "AZ Carpool" notification instead of failing.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  if (!data || typeof data !== 'object') data = {};
  const text = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
  const title = text(data.title, 120) || 'AZ Carpool';
  const options = {
    body: text(data.body, 500), icon: './icon-192.png', badge: './icon-192.png',
    tag: text(data.tag, 200) || undefined,
    data: { url: text(data.url, 300) || './', forFamilyId: text(data.forFamilyId, 64), open: text(data.open, 20) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// A tap opens the app (or brings the open one forward). A test push carries the family it was meant for: the app opens in Testweergave as that family.
// A real push carries open: 'ritbeurs': the app opens on Ritten ruilen.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const scope = self.registration.scope;
  let target = scope;
  try { const u = new URL(typeof data.url === 'string' ? data.url : './', scope); if (u.origin === new URL(scope).origin) target = u.href; } catch (e) { /* the start page it is */ }
  // Firefox (Gecko) only lets a worker open a window in the first moments after the tap, and an installed web app there is not a window
  // the worker can bring forward. So there the app is opened at once, as the very first thing, without looking for open windows first
  // (the new page reads ?pushas= and ?open= by itself). Elsewhere (Chrome, Safari) an open window is brought forward instead.
  const firefox = /Firefox\//.test((self.navigator && self.navigator.userAgent) || '');
  if (firefox) { event.waitUntil(self.clients.openWindow(target).catch(() => {})); return; }
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = open.find((c) => c.url && c.url.startsWith(scope));
    if (mine) {
      let shown = null;
      try { shown = await mine.focus(); } catch (e) { /* focus can be refused; the fallback below opens the app */ }
      mine.postMessage({ type: 'push-open', forFamilyId: typeof data.forFamilyId === 'string' ? data.forFamilyId : '', open: typeof data.open === 'string' ? data.open : '' });
      // Chrome brings the open tab forward. Firefox on Android only brings the BROWSER forward, on whatever tab was last used (the tap then
      // seems to open "just the browser"). Only when the app really is in front is the job done; otherwise open the app itself.
      if (shown && (shown.focused === true || shown.visibilityState === 'visible')) return;
    }
    await self.clients.openWindow(target);
  })());
});

// Only the app's own files and the Firebase SDK are worth keeping for offline use. Everything else (Firestore, Google Calendar,
// OpenRouteService: URLs with API keys, addresses and family data) goes straight to the network and is never stored here.
function isCacheable(url){
  return url.origin === self.location.origin
    || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!isCacheable(new URL(event.request.url))) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    const network = fetch(event.request).then((response) => {
      // Never keep an error page: it would be served as the app when offline.
      if (response.ok && response.status === 200) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
      }
      return response;
    });
    if (!cached) return network;
    const refresh = network.catch(() => {});
    if (typeof event.waitUntil === 'function') event.waitUntil(refresh);
    return cached;
  })());
});
