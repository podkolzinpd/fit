import { attachRequestDiagnostics, type RequestDiagnosticStage } from '../../shared/request-diagnostics'
import { detectInstallPlatform, isAppInstalled } from '../install'

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
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return bytes
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

function pushSetupError(cause: unknown, stage: RequestDiagnosticStage): Error {
  const name = cause !== null && typeof cause === 'object' && 'name' in cause && typeof cause.name === 'string'
    ? cause.name : 'UnknownError'
  const safeName = /^[A-Za-z][A-Za-z0-9]{0,49}$/.test(name) ? name : 'UnknownError'
  const category = cause !== null && typeof cause === 'object' && 'message' in cause && cause.message === 'Push service initialization failed'
    ? 'push_service_initialization_failed'
    : 'browser_error'
  return attachRequestDiagnostics(
    new Error('Не удалось подключить уведомления на этом устройстве. Повторите попытку или скопируйте диагностику для поддержки.'),
    {
      requestId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      backend: 'browser',
      operation: 'push.enable',
      stage,
      errorCode: safeName,
      errorCategory: category,
      platform: detectInstallPlatform(),
      appInstalled: isAppInstalled(),
      ...(typeof Notification !== 'undefined' && ['granted', 'denied', 'default'].includes(Notification.permission)
        ? { notificationPermission: Notification.permission }
        : {}),
    },
  )
}

export async function subscribeToPush(vapidPublicKey: string): Promise<BrowserPushSubscription> {
  if (!isPushSupported()) throw new Error('Браузер не поддерживает push-уведомления')
  let permission: NotificationPermission
  try {
    permission = await Notification.requestPermission()
  } catch (error) {
    throw pushSetupError(error, 'permission')
  }
  if (permission !== 'granted') throw new Error('Уведомления не разрешены в браузере')

  let registration: ServiceWorkerRegistration
  try {
    registration = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
  } catch (error) {
    throw pushSetupError(error, 'service-worker')
  }
  let existing: PushSubscription | null
  try {
    existing = await registration.pushManager.getSubscription()
  } catch (error) {
    throw pushSetupError(error, 'subscription-read')
  }
  let subscription = existing
  if (subscription === null) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      })
    } catch (error) {
      throw pushSetupError(error, 'subscription-create')
    }
  }
  return toBrowserSubscription(subscription)
}

export async function unsubscribeFromPush(): Promise<{ endpoint: string } | null> {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration('/sw.js')
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return null
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  return { endpoint }
}

export async function getCurrentPushSubscription(): Promise<BrowserPushSubscription | null> {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration('/sw.js')
  const subscription = await registration?.pushManager.getSubscription()
  return subscription ? toBrowserSubscription(subscription) : null
}
