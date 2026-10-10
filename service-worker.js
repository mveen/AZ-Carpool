// AZ Carpool — service worker
// NETWORK-FIRST on purpose: an online user must always get the current deployed
// files. The cache exists only so the app still opens (to whatever was last seen)
// when there's genuinely no connection — it must never mask a real update.
// Bump CACHE_NAME on EVERY deploy (not only when the asset list changes): a changed service-worker.js is the
// signal that makes open apps pick up the new version and reload (see bootstrap() in app.js).
const CACHE_NAME = 'az-carpool-v50';
const ASSETS = [
  './',
  './index.html',
  './tokens.css',
  './components.css',
  './print.css',
  './ui-shell.js',
  './ui-contact.js',
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
  './rides.js',
  './day-changes.js',
  './flex.js',
  './locations.js',
  './ov.js',
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

// Only the app's own files and the Firebase SDK are worth keeping for offline use. Everything else (Firestore, Google Calendar,
// OpenRouteService: URLs with API keys, addresses and family data) goes straight to the network and is never stored here.
function isCacheable(url){
  return url.origin === self.location.origin
    || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!isCacheable(new URL(event.request.url))) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Never keep an error page: it would be served as the app when offline.
        if (response.ok && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
