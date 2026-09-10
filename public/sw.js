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
    (async () => {
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        data: payload.data ?? {},
        icon: '/icon-192.png',
        badge: '/icon-192.png',
      })
      // Онбординг ждёт видимого подтверждения "сработало" сразу после
      // включения уведомлений — это подтверждает, что пуш дошёл до SW и
      // showNotification был вызван, не то, что ОС реально показала баннер
      // (Do Not Disturb и т.п. могут его проглотить беззвучно).
      if (payload.data && payload.data.test) {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        clients.forEach((client) => client.postMessage({ type: 'fit-test-push-received' }))
      }
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const inactivity = data.type === 'workout-inactivity' && data.workout_id
  const url = inactivity
    ? `/workouts/${data.workout_id}/live${event.action === 'finish' ? '?reminder=finish' : ''}`
    : data.url || (data.workout_id ? `/workouts/${data.workout_id}` : '/')
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
