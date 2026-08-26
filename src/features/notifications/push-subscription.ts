export type BrowserPushSubscription = {
  endpoint: string
  p256dh: string
  authKey: string
}

export function isPushSupported(): boolean {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof window !== 'undefined'
    && 'PushManager' in window
}

// applicationServerKey нужен как Uint8Array, а VAPID public key приходит в
// urlsafe base64 — ручное декодирование без внешней зависимости.
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

function toBrowserSubscription(subscription: PushSubscription): BrowserPushSubscription {
  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!subscription.endpoint || !p256dh || !auth) {
    throw new Error('Браузер вернул неполную push-подписку')
  }
  return { endpoint: subscription.endpoint, p256dh, authKey: auth }
}

export async function subscribeToPush(vapidPublicKey: string): Promise<BrowserPushSubscription> {
  if (!isPushSupported()) throw new Error('Браузер не поддерживает push-уведомления')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Уведомления не разрешены в браузере')

  const registration = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  })
  return toBrowserSubscription(subscription)
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return
  const registration = await navigator.serviceWorker.getRegistration('/sw.js')
  const subscription = await registration?.pushManager.getSubscription()
  await subscription?.unsubscribe()
}
