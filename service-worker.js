// AZ Carpool — service worker
// NETWORK-FIRST on purpose: an online user must always get the current deployed
// files. The cache exists only so the app still opens (to whatever was last seen)
// when there's genuinely no connection — it must never mask a real update.
// Bump CACHE_NAME on EVERY deploy (not only when the asset list changes): a changed service-worker.js is the
// signal that makes open apps pick up the new version and reload (see bootstrap() in app.js).
const CACHE_NAME = 'az-carpool-v16';
const ASSETS = [
  './',
  './index.html',
  './planning.js',
  './period.js',
  './family-backup.js',
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
  './fonts/plus-jakarta-sans-v12-latin-regular.woff2',
  './fonts/plus-jakarta-sans-v12-latin-500.woff2',
  './fonts/plus-jakarta-sans-v12-latin-600.woff2',
  './fonts/plus-jakarta-sans-v12-latin-700.woff2',
  './fonts/plus-jakarta-sans-v12-latin-800.woff2',
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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
