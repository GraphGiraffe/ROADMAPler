const REVISION = '__BUILD_REVISION__';
const PREFIX = 'roadmapler-shell:' + self.registration.scope + ':';
const CACHE = PREFIX + REVISION;
const FILES = ['./', './index.html', './pwa.js', './manifest.webmanifest', './assets/brand.svg', './assets/icon-192-board.png', './assets/icon-512-board.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' })))));
});
self.addEventListener('message', event => {
  if (event.data === 'ACTIVATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (!['', 'index.html', 'pwa.js', 'manifest.webmanifest', 'assets/brand.svg', 'assets/icon-192-board.png', 'assets/icon-512-board.png'].includes(path)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = new URL(!path || path === 'index.html' ? './index.html' : './' + path, self.registration.scope);
    return await cache.match(key) || fetch(event.request);
  })());
});
