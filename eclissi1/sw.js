const CACHE = 'eclissi-atlante-v2';
const ASSETS = ['./','./index.html','./style.css','./data.js','./app.js','./manifest.webmanifest','./assets/vista_suolo_modello.jpg','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', event => { event.respondWith(caches.match(event.request).then(r => r || fetch(event.request))); });
