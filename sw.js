const CACHE = 'duomi-growth-exact-design-v7';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest?v=20260713',
  './app-design.css?v=20260713',
  './app-design-01.js?v=20260713',
  './app-design-02.js?v=20260713',
  './app-design-03.js?v=20260713',
  './app-design-04.js?v=20260713',
  './app-design-05.js?v=20260713',
  './app-design-06.js?v=20260713',
  './app-design-07.js?v=20260713',
  './app-design-08.js?v=20260713',
  './chart-guard.js?v=20260713',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isChartCdn = url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('/chart.js@4.4.7/');
  if (!isSameOrigin && !isChartCdn) return;

  if (isSameOrigin && (url.pathname.endsWith('/reset.html') || url.pathname.endsWith('/reset.js'))) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE).then((cache) => cache.put('./index.html', response.clone()));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok || response.type === 'opaque') {
          caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      }).catch(() => cached || Response.error());
      return cached || network;
    })
  );
});
