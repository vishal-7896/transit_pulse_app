// sw.js — TransitPulse Service Worker
const CACHE_NAME = 'transitpulse-v1';

// Static assets to cache for offline/instant load
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/routes.html',
  '/stops.html',
  '/starred.html',
  '/style.css',
  '/hero-extras.css',
  '/favicon.svg',
  '/ui.js',
  '/storage.js',
  '/api.js',
  '/nav.js'
];

// 1. Install Event: Cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// 2. Activate Event: Cleanup older caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 3. Fetch Event: Network-first for dynamic API calls, Cache-first for static UI assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // If request is an API endpoint, let it hit the backend directly
  if (url.pathname.startsWith('/routes') || 
      url.pathname.startsWith('/eta') || 
      url.pathname.startsWith('/operators') || 
      url.pathname.startsWith('/sighting') ||
      url.pathname.startsWith('/register') ||
      url.pathname.startsWith('/admin')) {
    return;
  }

  // Otherwise, serve from cache if available, fallback to network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});