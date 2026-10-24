const CACHE_NAME = 'transitpulse-v2';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/routes.html',
  '/routes.js',
  '/stops.html',
  '/stops.js',
  '/starred.html',
  '/favorites.js',
  '/style.css',
  '/hero-extras.css',
  '/favicon.svg',
  '/ui.js',
  '/storage.js',
  '/api.js',
  '/nav.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname === '/routes' ||
      url.pathname.startsWith('/routes/') ||
      url.pathname.startsWith('/eta') || 
      url.pathname.startsWith('/operators') || 
      url.pathname.startsWith('/sighting') ||
      url.pathname.startsWith('/favorites') ||
      (url.pathname === '/register' && event.request.method === 'POST') ||
      url.pathname.startsWith('/admin')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
