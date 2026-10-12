/* StockMarketLoop app service worker: offline shell + web push. API calls (/v1/) are never cached. */
const VERSION = 'sml-app-v1';
const SHELL = ['/app/', '/app/app.js', '/app/app.css', '/app/manifest.webmanifest', '/app/icon-192.png', '/app/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/app/') || url.pathname === '/app/sw.js') return;
  if (e.request.mode === 'navigate') { e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put('/app/', copy)); return r; }).catch(() => caches.match('/app/'))); return; }
  e.respondWith(caches.match(e.request).then((hit) => { const net = fetch(e.request).then((r) => { if (r.ok) caches.open(VERSION).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => hit); return hit || net; }));
});
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'StockMarketLoop', body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'StockMarketLoop';
  e.waitUntil(self.registration.showNotification(title, { body: d.body || '', icon: '/app/icon-192.png', badge: '/app/icon-192.png', tag: d.tag || d.collapseId || undefined, renotify: !!(d.tag || d.collapseId), data: { url: d.url || '/app/', ...(d.data || {}) } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/app/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const same = list.find((c) => c.url && new URL(c.url).pathname.startsWith('/app/'));
    if (same) { same.focus(); same.postMessage({ type: 'sml-open', url }); return; }
    return self.clients.openWindow(url);
  }));
});
