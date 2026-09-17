const CACHE_NAME = '4astore-v5';
// Relative paths (no leading "/") so the SW works both at the domain root
// (live) and inside a subfolder (e.g. localhost/static4a/).
// NOTE: dynamic JSON (products/settings/orders/users) is intentionally NOT
// pre-cached so it always loads fresh from the server.
const ASSETS = [
  './',
  'assets/css/style.css',
  'assets/js/app.js',
  'data/categories.json'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  // Cache each asset individually so one missing file doesn't fail the whole install.
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS.map(url =>
        cache.add(url).catch(() => { /* ignore assets that 404 */ })
      ))
    )
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Never cache dynamic content (APIs, live JSON data). Always go to network
  // so settings (UPI ID, delivery fee), orders, users, products stay fresh.
  const isDynamic = url.includes('/api/') ||
                    url.includes('settings.json') ||
                    url.includes('orders.json') ||
                    url.includes('users.json') ||
                    url.includes('products.json') ||
                    url.includes('nocache=');

  if (isDynamic) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Static assets: network-first, fall back to cache when offline
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
