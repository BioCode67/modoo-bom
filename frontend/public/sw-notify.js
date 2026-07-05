// 모두봄 선제 알림 — 서비스워커 확장(workbox importScripts로 sw.js에 병합).
// 알림을 탭하면 이미 열린 모두봄 탭을 포커스하거나 새로 연다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
      return undefined
    })
  )
})
