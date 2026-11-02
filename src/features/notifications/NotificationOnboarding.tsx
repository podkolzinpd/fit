import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useDataBackend } from '../../app/data-backend-context'
import { detectInstallPlatform, installPromptDismissed, isAppInstalled } from '../install'
import { trackGoal } from '../../shared/yandex-metrika'
import { markPushOnboardingSeen, pushOnboardingSeen } from './notification-onboarding-storage'
import { isPushSupported } from './push-subscription'
import {
  isNativeWorkoutInactivityReminderSupported,
  requestWorkoutInactivityNotificationPermission,
  workoutInactivityNotificationPermission,
} from '../workouts/workout-inactivity-reminder'

export function NotificationOnboarding({ userId, role = 'client' }: { userId: string; role?: 'trainer' | 'client' }) {
  const { pushNotifications: pushNotificationsRepository } = useDataBackend()
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
    ? nativePermission.data === 'granted'
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
        await queryClient.invalidateQueries({ queryKey: ['push-notifications-status', userId] })
        setMessage('Разрешение на уведомления получено. Настройки напоминаний сохранены.')
        setPhase('success')
        return
      }
      await pushNotificationsRepository.enable(userId)

      setMessage('Уведомления настроены.')
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
