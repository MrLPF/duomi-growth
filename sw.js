const CACHE = 'duomi-growth-original-archive-v9';
const VERSION = '20260713archive3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json?v=' + VERSION,
  './chart.umd.min.js?v=' + VERSION,
  './secure-vault.css?v=' + VERSION,
  './secure-vault.js?v=' + VERSION,
  './icons/icon-192.png',
  './icons/icon-512.png'
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
    }).then(function () {
      return self.clients.claim();
    })
  );
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
      fetch(request, { cache: 'no-store' }).then(function (response) {
        if (response.ok) {
          caches.open(CACHE).then(function (cache) {
            cache.put('./index.html', response.clone());
          });
        }
        return response;
      }).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      const network = fetch(request, { cache: 'no-store' }).then(function (response) {
        if (response.ok) {
          caches.open(CACHE).then(function (cache) {
            cache.put(request, response.clone());
          });
        }
        return response;
      });
      return cached || network;
    }).catch(function () {
      return caches.match(request);
    })
  );
});
