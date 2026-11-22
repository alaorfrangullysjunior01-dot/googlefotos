// O Balitu Database na nuvem mudou para https://balitudatabase.github.io
// Este service worker antigo só leva quem ainda o tem para o endereço novo e se desliga.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  await self.clients.claim();
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
})()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  const u = new URL(e.request.url);
  const p = u.pathname.replace(/^\/googlefotos\/nuvem(\/app)?/, '') || '/';
  e.respondWith(Response.redirect('https://balitudatabase.github.io' + p + u.search, 302));
});
