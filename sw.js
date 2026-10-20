// 학습 알림(웹 푸시) 전용 서비스 워커.
// 오프라인 캐시는 일부러 하지 않는다 — 매일 새로 올라오는 강좌가 항상 바로 보이도록.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Aerospace Daily', {
    body: d.body || '오늘의 강좌가 기다리고 있어요!',
    icon: 'icons/icon-192.png',
    tag: d.tag || 'daily-reminder',
    renotify: true,
    data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
        return c.focus().then(w => (w && 'navigate' in w ? w.navigate(url) : w));
      }
    }
    return self.clients.openWindow(url);
  }));
});
