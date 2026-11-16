// Service worker mínimo: só existe para o site poder virar aplicativo.
// Não guarda nada em cache, para o conteúdo estar sempre atualizado.
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
self.addEventListener('fetch', () => {});
