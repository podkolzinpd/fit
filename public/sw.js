// Минимальный Service Worker только для Web Push. Никакого кеширования
// ассетов/офлайн-режима — это отдельная задача, не нужная для push.
self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try {
    payload = event.data.json()
  } catch {
    return
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: payload.data ?? {},
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const url = data.url || (data.workout_id ? `/workouts/${data.workout_id}` : '/')
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => 'focus' in client)
      if (existing) {
        return existing.navigate(url).then(() => existing.focus())
      }
      return self.clients.openWindow(url)
    }),
  )
})
