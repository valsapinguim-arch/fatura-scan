const CACHE_NAME = 'invoice-scanner-v21-debug';
const ASSETS = [
    './',
    './index.html',
    './app_v73.js',
    './manifest.json',
    'https://cdn.tailwindcss.com',
    'https://unpkg.com/lucide@latest',
    'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            );
        }).then(() => clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    // Strategy: Network First, falling back to cache
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});
