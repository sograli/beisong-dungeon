const CACHE = 'beisong-dungeon-v243';
const ASSETS = ['./', './index.html', './chinese-content.js', './politics-pdf-content.js', './politics-pdf-fourth.js', './classical-words-data.js', './hall-of-sages.css', './hall-of-sages-bundle.js', './manifest.webmanifest', './app-icon.svg', './player-character.png', './player-character-v238.png', './player-walk-transparent.webp', './player-walk-idle.png', './starwish-sky.jpg', './starwish-bottle-glass.png', './memory-stage-intro-mobile.mp4', './memory-stage-intro.webp', './sage-summon-intro-mobile.mp4', './battle-loop-mobile.mp4', './pet-crispy.png', './pet-dream-fish.png', './pet-block-dog.png', './pet-sayo-cat.png', './sage-weber.jpg', './sage-nietzsche.jpg', './sage-freud.jpg', './sage-sartre.jpg', './sage-bauman.jpg', './sage-arendt.jpg', './sage-popper.jpg', './sage-hayek.jpg', './sage-berlin.jpg', './sage-marcuse.jpg'];
self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => Promise.all(ASSETS.map(asset => cache.add(asset).catch(() => null))))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  if (event.request.destination === 'video' || event.request.headers.has('range')) {
    event.respondWith((async () => {
      const cached = await caches.match(event.request.url);
      if (!cached) return fetch(event.request);
      const range = event.request.headers.get('range');
      if (!range) return cached;
      const bytes = await cached.arrayBuffer();
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      if (!match) return cached;
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), bytes.byteLength - 1) : bytes.byteLength - 1;
      if (start > end || start >= bytes.byteLength) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.byteLength}` } });
      return new Response(bytes.slice(start, end + 1), { status: 206, headers: { 'Content-Type': cached.headers.get('Content-Type') || 'video/mp4', 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}`, 'Accept-Ranges': 'bytes' } });
    })());
    return;
  }
  event.respondWith(fetch(event.request).then(response => {
  const copy = response.clone();
  caches.open(CACHE).then(cache => cache.put(event.request, copy));
  return response;
}).catch(() => caches.match(event.request)));
});
