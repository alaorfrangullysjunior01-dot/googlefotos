// Balitu Database · modo nuvem
// Faz o papel do servidor quando o PC está desligado: entrega a "foto" do site
// guardada no Google Drive (privado) e toca os audiolivros direto do Drive.
'use strict';
const BASE = '/googlefotos/nuvem/app';
const MSG = 'O servidor não está ativo no momento! :( Volte mais tarde';
const DRIVE = 'https://www.googleapis.com/drive/v3/files/';
const STATE_URL = '/googlefotos/nuvem/__estado__';
let state = null; // {token, tokenExp, user, entries, blobs, books}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('message', e => {
  if (e.data?.type === 'estado') {
    state = e.data.state;
    e.waitUntil(caches.open('balitu-nuvem').then(c => c.put(STATE_URL, new Response(JSON.stringify(state)))).then(() => e.source?.postMessage({type: 'ok'})));
  }
  if (e.data?.type === 'token' && state) { state.token = e.data.token; state.tokenExp = e.data.tokenExp; caches.open('balitu-nuvem').then(c => c.put(STATE_URL, new Response(JSON.stringify(state)))); }
  if (e.data?.type === 'sair') { state = null; caches.delete('balitu-nuvem'); caches.delete('balitu-arquivos'); }
});
async function loadState() {
  if (state) return state;
  const r = await (await caches.open('balitu-nuvem')).match(STATE_URL);
  state = r ? await r.json() : null;
  return state;
}

// ---------- Reescrita: endereços "/x" do site passam a ficar dentro de /googlefotos/nuvem/app ----------
const ROOT_IN_QUOTES = /(["'`])\/(?=[A-Za-z0-9_.~%?#-])(?!googlefotos\/)/g;
const ROOT_IN_CSS = /(url\(\s*["']?)\/(?=[A-Za-z0-9_.~%?#-])(?!googlefotos\/)/g;
function rewrite(text, type) {
  if (/css/.test(type)) return text.replace(ROOT_IN_CSS, '$1' + BASE + '/');
  if (/html|javascript|json/.test(type)) text = text.replace(ROOT_IN_QUOTES, '$1' + BASE + '/');
  if (/html/.test(type)) {
    const inject = '<script src="/googlefotos/nuvem/offline.js"></script>';
    text = /<head[^>]*>/i.test(text) ? text.replace(/<head[^>]*>/i, m => m + inject) : inject + text;
  }
  return text;
}

// ---------- Respostas prontas ----------
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json; charset=utf-8', ...extra}});
const offline = (status = 503) => json({error: MSG}, status, {'X-Balitu-Nuvem': 'offline'});
const PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 680"><rect width="480" height="680" fill="#1b2140"/><text x="240" y="350" fill="#6f7aa8" font-family="sans-serif" font-size="28" text-anchor="middle">Balitu</text></svg>';
function offlinePage(path) {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Servidor desligado · Balitu Database</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(145deg,#0c1125,#191238);color:#fff;font:16px system-ui,sans-serif;text-align:center;padding:20px}.b{max-width:420px;background:#ffffff0f;border:1px solid #ffffff1f;border-radius:22px;padding:32px 24px}h1{font-size:23px;margin:10px 0}p{color:#c5c1dc}a{display:inline-block;margin-top:14px;color:#fff;background:linear-gradient(135deg,#ff4b62,#9c4dff);padding:11px 22px;border-radius:99px;text-decoration:none;font-weight:700}</style></head><body><div class="b"><div style="font-size:46px">😴</div><h1>${MSG}</h1><p>Esta parte do Balitu Database precisa do PC ligado.</p><a href="${BASE}/">Voltar ao início</a></div></body></html>`, {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8'}});
}

// ---------- Arquivos guardados no Drive ----------
async function driveFile(id, request, type) {
  const s = await loadState();
  if (!s || !s.token || Date.now() > s.tokenExp) return json({error: 'Sessão expirada'}, 401, {'X-Balitu-Nuvem': 'token'});
  const headers = {Authorization: 'Bearer ' + s.token};
  const range = request.headers.get('Range');
  if (range) headers.Range = range;
  else if (!/audio/.test(type || '')) { const hit = await (await caches.open('balitu-arquivos')).match(id); if (hit) return hit; }
  const r = await fetch(DRIVE + id + '?alt=media', {headers});
  if (r.status === 401) return json({error: 'Sessão expirada'}, 401, {'X-Balitu-Nuvem': 'token'});
  if (!r.ok && r.status !== 206) return null;
  const h = new Headers({'Content-Type': type || r.headers.get('Content-Type') || 'application/octet-stream', 'Accept-Ranges': 'bytes'});
  for (const k of ['Content-Length', 'Content-Range']) if (r.headers.get(k)) h.set(k, r.headers.get(k));
  const resp = new Response(r.body, {status: r.status, headers: h});
  if (!range && !/audio/.test(type || '') && r.status === 200) { const copy = resp.clone(); caches.open('balitu-arquivos').then(c => c.put(id, copy)).catch(() => {}); }
  return resp;
}

// ---------- Audiolivros (catálogo vindo do PC) ----------
function readerBook(s, id) {
  const lib = s.entries['/balito-leitor/api/library'];
  if (lib?.x) { try { const it = JSON.parse(lib.x).items.find(b => b.id === id); if (it) return it; } catch {} }
  const b = s.books?.find(x => x.id === id);
  if (!b) return null;
  return {id: b.id, title: b.title, author: b.author, synopsis: b.synopsis || '', series: b.series || '', coverUrl: '/balito-leitor/api/cover/' + b.id, shared: true, status: 'ready', readyPercent: Math.round(100 * b.parts.length / b.totalParts), preparing: b.parts.length < b.totalParts, message: 'Audiolivro · modo nuvem', parts: b.parts.map(p => ({index: p.index, status: 'ready', duration: p.duration, played: []}))};
}

async function handle(request) {
  const url = new URL(request.url);
  if (url.origin !== location.origin) return fetch(request);
  let path;
  if (url.pathname === BASE || url.pathname.startsWith(BASE + '/')) path = url.pathname.slice(BASE.length) || '/';
  else if (url.pathname.startsWith('/googlefotos/')) return fetch(request);
  else path = url.pathname;
  const s = await loadState();
  const isNav = request.mode === 'navigate';
  if (!s) return isNav ? Response.redirect('/googlefotos/nuvem/?volta=' + encodeURIComponent(path + url.search), 302) : offline(401);

  // Audiolivros: tocam direto do Drive.
  const audio = /^\/balito-leitor\/api\/audio\/([a-f0-9-]{36})$/.exec(path);
  if (audio) {
    const b = s.books?.find(x => x.id === audio[1]), part = b?.parts.find(p => p.index === Number(url.searchParams.get('part') || 0));
    if (part) return (await driveFile(part.file, request, 'audio/mpeg')) || offline();
    return offline();
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    // Progresso do Reader: aceita e devolve o livro (fica salvo no aparelho pelo próprio player).
    const prog = /^\/balito-leitor\/api\/progress\/([a-f0-9-]{36})$/.exec(path);
    if (prog) { const b = readerBook(s, prog[1]); if (b) return json(b); }
    return offline();
  }
  const key = path + url.search;
  let e = s.entries[key] || s.entries[path] || (path.endsWith('/') ? s.entries[path + 'index.html'] : null);
  if (!e && !url.search && !path.endsWith('/')) e = s.entries[path + '/'];
  if (e) {
    if (e.x != null) return new Response(rewrite(e.x, e.t), {headers: {'Content-Type': e.t + (/charset/.test(e.t) ? '' : '; charset=utf-8')}});
    const id = s.blobs[e.b];
    if (id) {
      const r = await driveFile(id, request, e.t);
      if (r && r.status < 300 && /text|javascript|json|svg/.test(e.t)) return new Response(rewrite(await r.text(), e.t), {headers: {'Content-Type': e.t}});
      if (r) return r;
    }
  }
  const book = /^\/balito-leitor\/api\/book\/([a-f0-9-]{36})$/.exec(path);
  if (book) { const b = readerBook(s, book[1]); return b ? json(b) : offline(404); }
  if (/^\/balito-leitor\/api\/cover\//.test(path) || request.destination === 'image' || /\.(png|jpe?g|webp|gif|svg)$/i.test(path)) return new Response(PLACEHOLDER, {headers: {'Content-Type': 'image/svg+xml'}});
  if (isNav || request.destination === 'document') return offlinePage(path);
  return offline();
}
self.addEventListener('fetch', e => e.respondWith(handle(e.request).catch(() => offline())));
