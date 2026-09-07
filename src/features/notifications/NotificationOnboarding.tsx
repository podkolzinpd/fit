import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useDataBackend } from '../../app/data-backend-context'
import { WORKOUT_SCHEDULED_KIND } from '../../data/repositories/push-notifications.repository'
import { detectInstallPlatform, installPromptDismissed, isAppInstalled } from '../install'
import { trackGoal } from '../../shared/yandex-metrika'
import { markPushOnboardingSeen, pushOnboardingSeen } from './notification-onboarding-storage'
import { getCurrentPushSubscription, isPushSupported } from './push-subscription'

const TEST_PUSH_TIMEOUT_MS = 12_000

// Ждём postMessage от sw.js ПАРАЛЛЕЛЬНО с самой отправкой (слушатель вешается
// до вызова sendTestPush, не после) — иначе пуш, пришедший быстрее сетевого
// round-trip до вызывающего кода, будет пропущен.
function waitForTestPushConfirmation(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
      resolve(false)
      return
    }
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', onMessage)
      resolve(false)
    }, timeoutMs)
    function onMessage(event: MessageEvent) {
      if ((event.data as { type?: string } | undefined)?.type !== 'fit-test-push-received') return
      window.clearTimeout(timer)
      navigator.serviceWorker.removeEventListener('message', onMessage)
      resolve(true)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
  })
}

export function NotificationOnboarding({ userId }: { userId: string }) {
  const { pushNotifications: pushNotificationsRepository, source } = useDataBackend()
  const supported = isPushSupported()
  const [dismissed, setDismissed] = useState(() => pushOnboardingSeen(userId))
  const [phase, setPhase] = useState<'idle' | 'working' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const statusQuery = useQuery({
    queryKey: ['push-notifications-status', userId],
    queryFn: () => pushNotificationsRepository.status(userId),
    enabled: supported && !dismissed,
  })
  const alreadyWorking = statusQuery.data?.state === 'working'

  // Уже включено (сам добрался до Настроек раньше, или это не первый визит
  // после установки) — карточка не нужна, скрываем без явного действия
  // пользователя и запоминаем, чтобы не гонять статус зря на каждый заход.
  useEffect(() => {
    if (alreadyWorking) markPushOnboardingSeen(userId)
  }, [alreadyWorking, userId])

  const platform = detectInstallPlatform()
  const installed = isAppInstalled()

  if (dismissed || !supported || alreadyWorking) return null
  // Web Push на iOS работает только для установленного на «Домой» приложения
  // — до установки предлагать включить нечего, AppInstallPrompt уже ведёт
  // через этот шаг отдельной карточкой.
  if (platform === 'ios' && !installed) return null
  // Одна nudge-карточка на экране одновременно: пока не установлено (и не
  // отклонено) предложение установить — не показываем следом ещё одно.
  if (!installed && !installPromptDismissed(userId)) return null

  async function enable() {
    trackGoal('push_onboarding_opened')
    setPhase('working')
    setMessage(null)
    try {
      await pushNotificationsRepository.enable(userId)
      await pushNotificationsRepository.enableCategory(userId, WORKOUT_SCHEDULED_KIND)

      if (source === 'supabase') {
        const local = await getCurrentPushSubscription()
        if (local) {
          const confirmation = waitForTestPushConfirmation(TEST_PUSH_TIMEOUT_MS)
          await pushNotificationsRepository.sendTestPush(local.endpoint)
          const received = await confirmation
          trackGoal(received ? 'push_onboarding_confirmed' : 'push_onboarding_unconfirmed')
          setMessage(received
            ? 'Уведомления работают.'
            : 'Уведомления включены. Если тестовое не пришло — проверьте настройки уведомлений телефона.')
          setPhase('success')
          return
        }
      }
      setMessage('Уведомления включены.')
      setPhase('success')
    } catch (error) {
      trackGoal('push_onboarding_failed')
      setMessage(error instanceof Error ? error.message : 'Не удалось включить уведомления.')
      setPhase('error')
    } finally {
      markPushOnboardingSeen(userId)
    }
  }

  function dismiss() {
    markPushOnboardingSeen(userId)
    setDismissed(true)
    trackGoal('push_onboarding_dismissed')
  }

  return <section className="app-install-card compact" aria-labelledby="push-onboarding-title">
    <div>
      <p className="eyebrow">УВЕДОМЛЕНИЯ</p>
      <h2 id="push-onboarding-title">Включите уведомления</h2>
      <p>Получайте напоминания о тренировках и новые записи от тренера.</p>
    </div>
    {phase === 'success' && <p className="app-install-success" role="status">{message}</p>}
    {phase === 'error' && <small className="error">{message}</small>}
    {phase !== 'success' && <div className="app-install-actions">
      <button type="button" className="secondary" disabled={phase === 'working'} aria-busy={phase === 'working'} onClick={() => void enable()}>
        {phase === 'working' ? 'Включаем…' : 'Включить уведомления'}
      </button>
      <button type="button" className="link muted" onClick={dismiss} disabled={phase === 'working'}>Не сейчас</button>
    </div>}
  </section>
}
