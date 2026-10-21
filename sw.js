// Bump when the list of files changes.
const CACHE = 'savings-v1';
const FILES = ['./', 'index.html', 'styles.css', 'script.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))));

self.addEventListener('activate', e => e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))));

// Serve from cache instantly (works offline), refresh the cache in the background so the next launch gets updates.
self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    e.respondWith(caches.open(CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        const fresh = fetch(e.request)
            .then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; })
            .catch(() => cached);
        e.waitUntil(fresh.catch(() => {}));
        return cached || fresh;
    }));
});
