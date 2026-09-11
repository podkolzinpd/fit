import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useDataBackend } from '../../app/data-backend-context'
import { CHAT_MESSAGE_KIND, WORKOUT_REMINDER_KIND, WORKOUT_SCHEDULED_KIND } from '../../data/repositories/push-notifications.repository'
import { detectInstallPlatform, installPromptDismissed, isAppInstalled } from '../install'
import { trackGoal } from '../../shared/yandex-metrika'
import { markPushOnboardingSeen, pushOnboardingSeen } from './notification-onboarding-storage'
import { getCurrentPushSubscription, isPushSupported } from './push-subscription'
import { waitForTestPushConfirmation } from './wait-for-test-push-confirmation'
import {
  isNativeWorkoutInactivityReminderSupported,
  requestWorkoutInactivityNotificationPermission,
  workoutInactivityNotificationPermission,
} from '../workouts/workout-inactivity-reminder'

const TEST_PUSH_TIMEOUT_MS = 12_000

export function NotificationOnboarding({ userId, role = 'client' }: { userId: string; role?: 'trainer' | 'client' }) {
  const { pushNotifications: pushNotificationsRepository, source } = useDataBackend()
  const queryClient = useQueryClient()
  const webSupported = isPushSupported()
  const nativeSupported = isNativeWorkoutInactivityReminderSupported()
  const supported = webSupported || nativeSupported
  const [dismissed, setDismissed] = useState(() => pushOnboardingSeen(userId))
  const [phase, setPhase] = useState<'idle' | 'working' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const statusQuery = useQuery({
    queryKey: ['push-notifications-status', userId],
    queryFn: () => pushNotificationsRepository.status(userId),
    enabled: supported && !dismissed,
  })
  const nativePermission = useQuery({
    queryKey: ['local-notification-permission'],
    queryFn: workoutInactivityNotificationPermission,
    enabled: nativeSupported && !dismissed,
  })
  const alreadyWorking = nativeSupported
    ? nativePermission.data === 'granted' && statusQuery.data?.workoutReminderEnabled !== false
    : statusQuery.data?.state === 'working'

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
  if (!nativeSupported && platform === 'ios' && !installed) return null
  // Одна nudge-карточка на экране одновременно: пока не установлено (и не
  // отклонено) предложение установить — не показываем следом ещё одно.
  if (!nativeSupported && !installed && !installPromptDismissed(userId)) return null

  async function enable() {
    trackGoal('push_onboarding_opened')
    setPhase('working')
    setMessage(null)
    try {
      if (nativeSupported) {
        if (!await requestWorkoutInactivityNotificationPermission()) throw new Error('Уведомления не разрешены в настройках телефона')
        await pushNotificationsRepository.setCategoryEnabled(userId, WORKOUT_REMINDER_KIND, true)
        await queryClient.invalidateQueries({ queryKey: ['push-notifications-status', userId] })
        setMessage('Напомним, если активная тренировка останется незавершённой.')
        setPhase('success')
        return
      }
      await pushNotificationsRepository.enable(userId)
      if (role === 'client') await pushNotificationsRepository.setCategoryEnabled(userId, WORKOUT_SCHEDULED_KIND, true)
      await pushNotificationsRepository.setCategoryEnabled(userId, CHAT_MESSAGE_KIND, true)

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
      <p>{nativeSupported
        ? 'Напомним о незавершённой тренировке.'
        : role === 'trainer' ? 'Сообщим о новых сообщениях.' : 'Сообщим о тренировках и новых сообщениях.'}</p>
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
