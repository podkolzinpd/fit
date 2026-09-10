import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useDataBackend } from '../../app/data-backend-context'
import { Switch } from '../../shared/ui'
import { CHAT_MESSAGE_KIND, WORKOUT_REMINDER_KIND, WORKOUT_SCHEDULED_KIND } from '../../data/repositories/push-notifications.repository'
import { detectInstallPlatform, isAppInstalled } from '../install'
import { getCurrentPushSubscription, isPushSupported } from './push-subscription'
import { waitForTestPushConfirmation } from './wait-for-test-push-confirmation'
import {
  cancelAllNativeWorkoutInactivityReminders,
  isNativeWorkoutInactivityReminderSupported,
  requestWorkoutInactivityNotificationPermission,
  workoutInactivityNotificationPermission,
} from '../workouts/workout-inactivity-reminder'

const TEST_PUSH_TIMEOUT_MS = 12_000

type DisplayState = 'working' | 'needs-permission' | 'denied' | 'ios-not-installed'

const STATUS_COPY: Record<DisplayState, string> = {
  'working': 'Уведомления работают',
  'needs-permission': 'Нужно разрешение',
  'denied': 'Отключены в настройках телефона',
  'ios-not-installed': 'Установите Fit на экран «Домой»',
}

export function NotificationsSetting({ userId }: { userId: string }) {
  const { pushNotifications: pushNotificationsRepository, source } = useDataBackend()
  const queryClient = useQueryClient()
  const webSupported = isPushSupported()
  const nativeSupported = isNativeWorkoutInactivityReminderSupported()
  const supported = webSupported || nativeSupported
  const statusKey = ['push-notifications-status', userId]

  // На iOS Web Push не работает вне установленного на «Домой» приложения —
  // это решается фактом установки, а не разрешением браузера, поэтому
  // считается отдельно от reconcile-состояния и раньше самого запроса статуса.
  const iosNotInstalled = !nativeSupported && detectInstallPlatform() === 'ios' && !isAppInstalled()

  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => pushNotificationsRepository.status(userId),
    enabled: supported && !iosNotInstalled,
  })
  const nativePermission = useQuery({
    queryKey: ['local-notification-permission'],
    queryFn: workoutInactivityNotificationPermission,
    enabled: nativeSupported,
  })

  const enableMutation = useMutation({
    mutationFn: async () => {
      if (nativeSupported) {
        if (!await requestWorkoutInactivityNotificationPermission()) throw new Error('Уведомления не разрешены в настройках телефона')
        await pushNotificationsRepository.setCategoryEnabled(userId, WORKOUT_REMINDER_KIND, true)
        return
      }
      await pushNotificationsRepository.enable(userId)
      await pushNotificationsRepository.setCategoryEnabled(userId, WORKOUT_SCHEDULED_KIND, true)
      await pushNotificationsRepository.setCategoryEnabled(userId, CHAT_MESSAGE_KIND, true)
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: statusKey }),
        queryClient.invalidateQueries({ queryKey: ['local-notification-permission'] }),
      ])
    },
  })

  const categoryMutation = useMutation({
    mutationFn: async ({ kind, enabled }: { kind: string; enabled: boolean }) => {
      await pushNotificationsRepository.setCategoryEnabled(userId, kind, enabled)
      if (nativeSupported && kind === WORKOUT_REMINDER_KIND && !enabled) await cancelAllNativeWorkoutInactivityReminders()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKey }),
  })

  const [testPhase, setTestPhase] = useState<'idle' | 'sending' | 'confirmed' | 'timeout' | 'error'>('idle')

  if (!supported) return null

  const state: DisplayState = iosNotInstalled
    ? 'ios-not-installed'
    : nativeSupported
      ? nativePermission.data === 'granted' ? 'working' : nativePermission.data === 'denied' ? 'denied' : 'needs-permission'
      : status.data?.state === 'working' ? 'working' : status.data?.state === 'denied' ? 'denied' : 'needs-permission'
  const working = state === 'working'

  async function sendTest() {
    setTestPhase('sending')
    const local = await getCurrentPushSubscription()
    if (!local) {
      setTestPhase('error')
      return
    }
    try {
      const confirmation = waitForTestPushConfirmation(TEST_PUSH_TIMEOUT_MS)
      await pushNotificationsRepository.sendTestPush(local.endpoint)
      setTestPhase((await confirmation) ? 'confirmed' : 'timeout')
    } catch {
      setTestPhase('error')
    }
  }

  return <>
    <div className="push-status-row">
      <p className={working ? 'push-status-text working' : 'push-status-text warning'} aria-live="polite">{STATUS_COPY[state]}</p>
      {state === 'needs-permission' && <div className="push-status-actions">
        <button type="button" className="secondary" disabled={enableMutation.isPending} aria-busy={enableMutation.isPending} onClick={() => enableMutation.mutate()}>
          {enableMutation.isPending ? 'Включаем…' : 'Включить уведомления'}
        </button>
      </div>}
      {state === 'denied' && <small className="push-test-result">Разрешите уведомления для Fit в настройках телефона, затем обновите страницу.</small>}
      {enableMutation.error && <small className="error">{enableMutation.error instanceof Error ? enableMutation.error.message : 'Не удалось включить уведомления.'}</small>}
      {working && !nativeSupported && source === 'supabase' && <div className="push-status-actions">
        <button type="button" className="link" disabled={testPhase === 'sending'} aria-busy={testPhase === 'sending'} onClick={() => void sendTest()}>
          {testPhase === 'sending' ? 'Отправляем…' : 'Отправить тестовое уведомление'}
        </button>
        {testPhase === 'confirmed' && <small className="push-test-result success">Пришло.</small>}
        {testPhase === 'timeout' && <small className="push-test-result muted">Не пришло за 12 секунд — проверьте настройки уведомлений телефона.</small>}
        {testPhase === 'error' && <small className="push-test-result error">Не удалось отправить.</small>}
      </div>}
    </div>
    <Switch
      label="Напоминания о тренировках"
      checked={status.data?.workoutReminderEnabled ?? true}
      disabled={status.isLoading || categoryMutation.isPending}
      onChange={(next) => categoryMutation.mutate({ kind: WORKOUT_REMINDER_KIND, enabled: next })}
    />
    {!nativeSupported && <Switch
      label="Новые тренировки от тренера"
      checked={status.data?.workoutScheduledEnabled ?? true}
      disabled={status.isLoading || categoryMutation.isPending}
      onChange={(next) => categoryMutation.mutate({ kind: WORKOUT_SCHEDULED_KIND, enabled: next })}
    />}
    <Switch
      label="Новые сообщения"
      checked={status.data?.chatMessageEnabled ?? true}
      disabled={status.isLoading || categoryMutation.isPending}
      onChange={(next) => categoryMutation.mutate({ kind: CHAT_MESSAGE_KIND, enabled: next })}
    />
    {categoryMutation.error && <small className="error">{categoryMutation.error instanceof Error ? categoryMutation.error.message : 'Не удалось изменить настройку.'}</small>}
  </>
}
