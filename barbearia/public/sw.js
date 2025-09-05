self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch {}
  const title = data.title || 'Barbearia'
  const body = data.body || 'Atualização da fila'
  const options = {
    body,
    icon: '/vite.svg',
    vibrate: [200, 120, 200],
    tag: data.tag || 'queue',
    renotify: true,
    requireInteraction: true,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    if (list.length > 0) {
      return list[0].focus()
    } else {
      return clients.openWindow('/')
    }
  }))
})

