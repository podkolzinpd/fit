import { type BrowserPushSubscription, getCurrentPushSubscription, isPushSupported, subscribeToPush } from './push-subscription'

export type PushSubscriptionState = 'working' | 'needs-permission' | 'denied' | 'unsupported'

export type PushSubscriptionServerAdapter = {
  hasServerSubscription: (endpoint: string) => Promise<boolean>
  saveSubscription: (subscription: BrowserPushSubscription) => Promise<void>
}

// Раньше статус в профиле смотрел только на факт существования подписки на
// сервере — если пользователь отозвал разрешение в настройках телефона (или
// браузер тихо сбросил PushManager-подписку), переключатель продолжал
// показывать «включено» до первого проваленного напоминания. Здесь сверяются
// все три источника правды: Notification.permission, локальная подписка
// браузера и серверная запись — и, где это возможно без участия пользователя,
// расхождение чинится само, без переключения тумблера туда-обратно.
//
// Backend-специфичные операции (есть ли у сервера эта подписка, сохранить её)
// приходят параметром — Supabase и Yandex-пилот реализуют их по-разному, а
// сама логика сверки одна и та же для обоих.
export async function reconcilePushSubscription(
  vapidPublicKey: string | undefined,
  adapter: PushSubscriptionServerAdapter,
): Promise<PushSubscriptionState> {
  if (!isPushSupported()) return 'unsupported'

  const permission = Notification.permission
  if (permission === 'denied') return 'denied'
  if (permission === 'default') return 'needs-permission'

  // permission === 'granted' отсюда и до конца.
  let local = await getCurrentPushSubscription()
  if (local === null) {
    // Разрешение уже есть, но браузер потерял PushManager-подписку (сброс
    // хранилища сайта, переустановка и т.п.) — subscribeToPush не переспросит
    // разрешение повторно (оно уже решено), поэтому безопасно вызывать из
    // useEffect на mount, а не только по явному тапу пользователя.
    if (!vapidPublicKey) return 'needs-permission'
    local = await subscribeToPush(vapidPublicKey)
    await adapter.saveSubscription(local)
    return 'working'
  }

  const hasServerRow = await adapter.hasServerSubscription(local.endpoint)
  if (!hasServerRow) {
    // Локальная подписка есть, серверная запись потерялась (неудачное
    // сохранение в прошлый раз, новый профиль браузера и т.п.) — тихая
    // пересинхронизация.
    await adapter.saveSubscription(local)
  }
  return 'working'
}
