// AZ Carpool — service worker
// NETWORK-FIRST on purpose: an online user must always get the current deployed
// files. The cache exists only so the app still opens (to whatever was last seen)
// when there's genuinely no connection — it must never mask a real update.
// Bump CACHE_NAME whenever the asset list below changes, so old caches are dropped.
const CACHE_NAME = 'az-carpool-v7';
const ASSETS = [
  './',
  './index.html',
  './planning.js',
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
  './ui-myweek.js',
  './ui-deviation.js',
  './ui-matches.js',
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
