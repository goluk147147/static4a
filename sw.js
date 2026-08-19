const CACHE_NAME = '4astore-v3';
const ASSETS = [
  '/',
  '/products',
  '/cart',
  '/checkout',
  '/order-history',
  '/profile',
  '/login',
  '/product-details',
  '/assets/css/style.css',
  '/assets/js/app.js',
  '/data/products.json',
  '/data/categories.json',
  '/data/config.json'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
