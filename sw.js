const CACHE_NAME = '4astore-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/products.html',
  '/cart.html',
  '/checkout.html',
  '/order-history.html',
  '/profile.html',
  '/login.html',
  '/product-details.html',
  '/assets/css/style.css',
  '/assets/js/app.js',
  '/data/products.json',
  '/data/categories.json',
  '/data/config.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
});
