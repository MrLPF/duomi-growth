const CACHE = 'duomi-growth-secure-offline-v7';
const VERSION = '20260713secure2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest?v=' + VERSION,
  './app-design.css?v=' + VERSION,
  './secure-vault.css?v=' + VERSION,
  './app-design-01.js?v=' + VERSION,
  './app-design-02.js?v=' + VERSION,
  './app-design-03.js?v=' + VERSION,
  './app-design-04.js?v=' + VERSION,
  './app-design-05.js?v=' + VERSION,
  './offline-chart.js?v=' + VERSION,
  './app-design-06.js?v=' + VERSION,
  './app-design-07.js?v=' + VERSION,
  './secure-vault.js?v=' + VERSION,
  './app-design-08.js?v=' + VERSION,
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(APP_SHELL);
  }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== CACHE;
      }).map(function (key) {
        return caches.delete(key);
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/reset.html') || url.pathname.endsWith('/reset.js')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(function (response) {
          if (response.ok) {
            caches.open(CACHE).then(function (cache) {
              cache.put('./index.html', response.clone());
            });
          }
          return response;
        })
        .catch(function () {
          return caches.match('./index.html');
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response.ok) {
          caches.open(CACHE).then(function (cache) {
            cache.put(request, response.clone());
          });
        }
        return response;
      });
    })
  );
});
