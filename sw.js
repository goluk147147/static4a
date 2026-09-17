const CACHE_NAME = '4astore-v4';
// Relative paths (no leading "/") so the SW works both at the domain root
// (live) and inside a subfolder (e.g. localhost/static4a/).
const ASSETS = [
  './',
  'assets/css/style.css',
  'assets/js/app.js',
  'data/products.json',
  'data/categories.json',
  'data/config.json'
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
