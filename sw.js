const CACHE = 'beisong-dungeon-v124';
const ASSETS = ['./', './index.html', './chinese-content.js', './politics-pdf-content.js', './politics-pdf-fourth.js', './manifest.webmanifest', './app-icon.svg'];
self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => event.respondWith(fetch(event.request).then(response => {
  const copy = response.clone();
  caches.open(CACHE).then(cache => cache.put(event.request, copy));
  return response;
}).catch(() => caches.match(event.request))));
