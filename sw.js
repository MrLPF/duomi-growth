'use strict';

const CACHE_VERSION = 'v5';
const ASSET_VERSION = '20260714-4';
const SHELL_CACHE = `duomi-growth-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `duomi-growth-static-${CACHE_VERSION}`;
const APP_CACHE_PREFIX = 'duomi-growth-';

// Only public, version-controlled application assets are ever cached. User data
// remains in IndexedDB and is never requested by, or written to, this worker.
const NETWORK_FIRST_ASSETS = new Set([
  '/',
  '/index.html',
  '/manifest.json',
  '/sw.js',
  '/app.js',
  '/secure-vault.js',
  '/styles.css',
  '/secure-vault.css'
]);

const CACHE_FIRST_ASSETS = new Set([
  '/chart.umd.min.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
]);

const INSTALL_ASSETS = [
  `/index.html?v=${ASSET_VERSION}`,
  `/manifest.json?v=${ASSET_VERSION}`,
  `/sw.js?v=${ASSET_VERSION}`,
  `/app.js?v=${ASSET_VERSION}`,
  `/secure-vault.js?v=${ASSET_VERSION}`,
  `/styles.css?v=${ASSET_VERSION}`,
  `/secure-vault.css?v=${ASSET_VERSION}`,
  ...CACHE_FIRST_ASSETS
];

function isCacheableResponse(response) {
  return response && response.ok && response.type === 'basic';
}

async function fetchAndCache(request, cacheName) {
  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, fallbackPath) {
  try {
    return await fetchAndCache(request, SHELL_CACHE);
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }

    if (fallbackPath) {
      const fallback = await caches.match(fallbackPath);
      if (fallback) {
        return fallback;
      }
    }

    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  return fetchAndCache(request, STATIC_CACHE);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shellCache = await caches.open(SHELL_CACHE);
    const staticCache = await caches.open(STATIC_CACHE);

    await Promise.all(INSTALL_ASSETS.map(async (path) => {
      const request = new Request(path, { cache: 'reload' });
      const response = await fetch(request);
      if (!isCacheableResponse(response)) {
        throw new Error(`Unable to cache required application asset: ${path}`);
      }

      const pathname = new URL(path, self.location.origin).pathname;
      const targetCache = CACHE_FIRST_ASSETS.has(pathname) ? staticCache : shellCache;
      await targetCache.put(request, response);
    }));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const currentCaches = new Set([SHELL_CACHE, STATIC_CACHE]);
    const cacheNames = await caches.keys();

    await Promise.all(cacheNames.map((cacheName) => {
      if (cacheName.startsWith(APP_CACHE_PREFIX) && !currentCaches.has(cacheName)) {
        return caches.delete(cacheName);
      }
      return Promise.resolve(false);
    }));

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, `/index.html?v=${ASSET_VERSION}`));
    return;
  }

  if (NETWORK_FIRST_ASSETS.has(url.pathname) || url.pathname.endsWith('.css')) {
    event.respondWith(networkFirst(request, url.pathname));
    return;
  }

  if (CACHE_FIRST_ASSETS.has(url.pathname) || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request));
  }
});
