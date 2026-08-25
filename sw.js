const CACHE = 'beisong-dungeon-v235';
const ASSETS = ['./', './index.html', './chinese-content.js', './politics-pdf-content.js', './politics-pdf-fourth.js', './classical-words-data.js', './hall-of-sages.css', './hall-of-sages-bundle.js', './manifest.webmanifest', './app-icon.svg', './player-character.png', './player-walk-transparent.webp', './player-walk-idle.png', './starwish-sky.jpg', './starwish-bottle-glass.png', './memory-stage-intro.mp4', './memory-stage-intro.webp', './pet-crispy.png', './pet-dream-fish.png', './pet-block-dog.png', './pet-sayo-cat.png', './sage-weber.jpg', './sage-nietzsche.jpg', './sage-freud.jpg', './sage-sartre.jpg', './sage-bauman.jpg', './sage-arendt.jpg', './sage-popper.jpg', './sage-hayek.jpg', './sage-berlin.jpg', './sage-marcuse.jpg'];
self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => Promise.all(ASSETS.map(asset => cache.add(asset).catch(() => null))))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  if (event.request.destination === 'video' || event.request.headers.has('range')) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(fetch(event.request).then(response => {
  const copy = response.clone();
  caches.open(CACHE).then(cache => cache.put(event.request, copy));
  return response;
}).catch(() => caches.match(event.request)));
});
