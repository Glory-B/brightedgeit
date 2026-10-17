// service-worker.js
// Retired. The site no longer registers a service worker.
// Browsers that installed an earlier version will fetch this file on their
// next update check; it clears the old caches and unregisters itself so
// visitors always get fresh pages and a fresh /api/config response.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('brightedgeit-')).map(key => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => client.navigate(client.url));
  })());
});
