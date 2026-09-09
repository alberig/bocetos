/**
 * Bocetos - Service Worker (Offline Support)
 * Estrategia Network First: actualización instantánea de cambios con respaldo offline
 */

const CACHE_NAME = 'bocetos-cache-v4';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css?v=4',
  './manifest.json',
  './icons/icon.svg',
  './js/db.js?v=4',
  './js/canvas.js?v=4',
  './js/app.js?v=4'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Eliminando caché antigua:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Estrategia Network First: siempre busca el código más reciente del servidor.
  // Solo usa la caché si el usuario está sin conexión (en el taller o sin wifi).
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          return cached || caches.match('./index.html');
        });
      })
  );
});
