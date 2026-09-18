const CACHE_NAME = '4astore-v6';
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

// Only cache small, static assets. Everything else goes straight to network.
function shouldCache(url, method) {
  if (method !== 'GET') return false;                  // never cache POST/PUT
  if (url.includes('/api/')) return false;             // dynamic APIs
  if (url.includes('/data/')) return false;            // live JSON (settings/orders/users/products/announcement)
  if (url.includes('nocache=')) return false;
  // Cache only CSS / JS / HTML pages, not images/apk/pdf (those fill up storage)
  return /\.(css|js)(\?|$)/.test(url) || /\/$/.test(url) || /\.html?(\?|$)/.test(url);
}

self.addEventListener('fetch', e => {
  const url = e.request.url;

  if (!shouldCache(url, e.request.method)) {
    // Network-only (with cache as offline fallback for GET)
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Small static assets: network-first, update cache (ignore quota errors)
  e.respondWith(
    fetch(e.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME)
          .then(cache => cache.put(e.request, clone).catch(() => {}))  // ignore QuotaExceededError
          .catch(() => {});
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
