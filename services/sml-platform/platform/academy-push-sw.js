/* Academy push service worker (scope /academy-activity/). Shows the "new price target" notification when it arrives; if the member is looking at
 * the Academy right now the in-page card already shows it, so the system notification is skipped. Tapping the notification focuses an open
 * Academy window (and opens that alert) or opens a new one on that ticker. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch (_) { m = { title: 'Making Easy Money Academy', body: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const watching = wins.some((w) => w.visibilityState === 'visible' && w.focused);
    if (watching && m.kind === 'pt') { wins.forEach((w) => w.postMessage({ type: 'sml-pt-push', update: m.update || null })); return; }
    await self.registration.showNotification(m.title || 'Making Easy Money Academy', {
      body: m.body || '', tag: m.tag || 'sml-academy', renotify: true, requireInteraction: !!m.sticky,
      icon: '/academy-activity/push-icon-192.png', badge: '/academy-activity/push-icon-192.png',
      data: { url: m.url || '/academy-activity/', id: m.id || '', symbol: m.symbol || '' },
      actions: m.kind === 'pt' ? [{ action: 'open', title: 'Open alert' }] : []
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const main = wins.find((w) => new URL(w.url).pathname.startsWith('/academy-activity') && !new URL(w.url).searchParams.has('popout')) || wins[0];
    if (main) { await main.focus(); main.postMessage({ type: 'sml-pt-open', id: d.id, symbol: d.symbol }); return; }
    await self.clients.openWindow(d.url || '/academy-activity/');
  })());
});
