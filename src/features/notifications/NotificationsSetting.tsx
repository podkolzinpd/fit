import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useDataBackend } from '../../app/data-backend-context'
import { CHAT_MESSAGE_KIND, WORKOUT_REMINDER_KIND, WORKOUT_SCHEDULED_KIND } from '../../data/repositories/push-notifications.repository'
import { Switch } from '../../shared/ui'
import { detectInstallPlatform, isAppInstalled } from '../install'
import {
  cancelAllNativeWorkoutInactivityReminders,
  isNativeWorkoutInactivityReminderSupported,
  requestWorkoutInactivityNotificationPermission,
  workoutInactivityNotificationPermission,
} from '../workouts/workout-inactivity-reminder'
import { getCurrentPushSubscription, isPushSupported } from './push-subscription'
import { waitForTestPushConfirmation } from './wait-for-test-push-confirmation'

const TEST_PUSH_TIMEOUT_MS = 12_000

type DisplayState = 'working' | 'needs-permission' | 'denied' | 'ios-not-installed' | 'loading' | 'error' | 'unsupported' | 'needs-connection'

const STATUS_COPY: Record<DisplayState, string> = {
  working: 'Уведомления включены',
  'needs-permission': 'Нужно разрешение',
  denied: 'Уведомления выключены',
  'ios-not-installed': 'Сначала установите Fit',
  loading: 'Проверяем уведомления…',
  error: 'Не удалось проверить подключение',
  unsupported: 'Уведомления недоступны на этом устройстве',
  'needs-connection': 'Разрешение есть, подключение не готово',
}

export function NotificationsSetting({ userId, role = 'client', detailed = false }: { userId: string; role?: 'trainer' | 'client'; detailed?: boolean }) {
  const { pushNotifications: repository, source } = useDataBackend()
  const queryClient = useQueryClient()
  const webSupported = isPushSupported()
  const nativeLocalSupported = isNativeWorkoutInactivityReminderSupported()
  const supported = webSupported || nativeLocalSupported
  const statusKey = ['push-notifications-status', userId]
  const iosNotInstalled = !nativeLocalSupported && detectInstallPlatform() === 'ios' && !isAppInstalled()

  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => repository.status(userId),
    enabled: supported && !iosNotInstalled,
  })
  const nativePermission = useQuery({
    queryKey: ['local-notification-permission'],
    queryFn: workoutInactivityNotificationPermission,
    enabled: nativeLocalSupported,
  })
  const enable = useMutation({
    mutationFn: async () => {
      if (nativeLocalSupported) {
        if (!await requestWorkoutInactivityNotificationPermission()) throw new Error('Разрешите уведомления для Fit в настройках телефона')
        await repository.setCategoryEnabled(userId, WORKOUT_REMINDER_KIND, true)
        return
      }
      await repository.enable(userId)
      await repository.setCategoryEnabled(userId, CHAT_MESSAGE_KIND, true)
      if (role === 'client') await repository.setCategoryEnabled(userId, WORKOUT_SCHEDULED_KIND, true)
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: statusKey }),
        queryClient.invalidateQueries({ queryKey: ['local-notification-permission'] }),
      ])
    },
  })
  const category = useMutation({
    mutationFn: async ({ kind, enabled }: { kind: string; enabled: boolean }) => {
      await repository.setCategoryEnabled(userId, kind, enabled)
      if (nativeLocalSupported && kind === WORKOUT_REMINDER_KIND && !enabled) await cancelAllNativeWorkoutInactivityReminders()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKey }),
  })
  const [testPhase, setTestPhase] = useState<'idle' | 'sending' | 'confirmed' | 'timeout' | 'error'>('idle')
  const [, refreshDevice] = useState(0)
  useEffect(() => {
    if (!detailed) return
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      refreshDevice((value) => value + 1)
      void queryClient.invalidateQueries({ queryKey: ['push-notifications-status', userId] })
      void queryClient.invalidateQueries({ queryKey: ['local-notification-permission'] })
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('appinstalled', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('appinstalled', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [detailed, queryClient, userId])

  if (!supported && (!detailed || !iosNotInstalled)) return <p className="push-unavailable">Уведомления недоступны на этом устройстве.</p>

  const baseState: DisplayState = iosNotInstalled
    ? 'ios-not-installed'
    : nativeLocalSupported
      ? nativePermission.data === 'granted' ? 'working' : nativePermission.data === 'denied' ? 'denied' : 'needs-permission'
      : status.data?.state === 'working' ? 'working' : status.data?.state === 'denied' ? 'denied' : 'needs-permission'
  const permission = nativeLocalSupported ? nativePermission.data : typeof Notification !== 'undefined' ? Notification.permission : undefined
  const state: DisplayState = !detailed || iosNotInstalled ? baseState
    : status.isError || (nativeLocalSupported && nativePermission.isError) ? 'error'
      : status.isPending || status.isFetching || (nativeLocalSupported && (nativePermission.isPending || nativePermission.isFetching)) ? 'loading'
        : !nativeLocalSupported && status.data?.state === 'unsupported' ? 'unsupported'
          : !nativeLocalSupported && baseState === 'needs-permission' && permission === 'granted' ? 'needs-connection' : baseState
  const working = state === 'working'
  const checking = status.isFetching || nativePermission.isFetching
  const categoryDisabled = status.isLoading || category.isPending || (detailed && (!working || checking || enable.isPending))
  const recheck = () => {
    refreshDevice((value) => value + 1)
    if (supported && !iosNotInstalled) void status.refetch()
    if (nativeLocalSupported) void nativePermission.refetch()
  }

  async function sendTest() {
    setTestPhase('sending')
    const local = await getCurrentPushSubscription()
    if (!local) { setTestPhase('error'); return }
    try {
      const confirmation = waitForTestPushConfirmation(TEST_PUSH_TIMEOUT_MS)
      await repository.sendTestPush(local.endpoint)
      setTestPhase((await confirmation) ? 'confirmed' : 'timeout')
    } catch {
      setTestPhase('error')
    }
  }

  return <>
    {detailed && <p className="notification-channel-note"><strong>Разрешение на этом устройстве</strong><span>{permission === 'granted' ? 'Разрешено' : permission === 'denied' ? 'Запрещено в настройках устройства или браузера' : permission === 'default' || permission === 'prompt' ? 'Ещё не запрошено' : 'Пока не определено'}</span></p>}
    <div className="push-status-row">
      <p className={working ? 'push-status-text working' : 'push-status-text warning'} aria-live="polite">{nativeLocalSupported && working ? detailed && status.data?.workoutReminderEnabled === false ? 'Напоминания выключены' : 'Напоминания включены' : STATUS_COPY[state]}</p>
      {state === 'needs-permission' && <div className="push-status-actions"><button type="button" className="secondary" disabled={enable.isPending} aria-busy={enable.isPending} onClick={() => enable.mutate()}>{enable.isPending ? 'Включаем…' : 'Включить'}</button></div>}
      {state === 'denied' && <small className="push-test-result">Разрешите уведомления для Fit в настройках телефона.</small>}
      {state === 'ios-not-installed' && <small className="push-test-result">Добавьте Fit на экран «Домой», затем включите уведомления.</small>}
      {detailed && state === 'loading' && <small role="status">Проверяем разрешение и подключение этого устройства.</small>}
      {detailed && state === 'error' && <small role="alert">Не удалось получить настройки или подтвердить подписку устройства. Проверьте интернет и повторите проверку.</small>}
      {detailed && state === 'needs-connection' && <small role="alert">Подписка устройства не подключена. Повторите проверку; если это не поможет, обратитесь в поддержку.</small>}
      {detailed && working && !nativeLocalSupported && <small>Подписка этого устройства подтверждена. Доставка зависит также от настроек телефона.</small>}
      {detailed && <button type="button" className="link" disabled={checking || enable.isPending || category.isPending} onClick={recheck}>{checking ? 'Проверяем…' : 'Повторить проверку'}</button>}
      {enable.error && <small className="error">{enable.error instanceof Error ? enable.error.message : 'Не удалось включить уведомления.'}</small>}
      {working && !nativeLocalSupported && source === 'supabase' && <div className="push-status-actions">
        <button type="button" className="link" disabled={testPhase === 'sending'} aria-busy={testPhase === 'sending'} onClick={() => void sendTest()}>{testPhase === 'sending' ? 'Отправляем…' : 'Проверить уведомления'}</button>
        {testPhase === 'confirmed' && <small className="push-test-result success">Пришло.</small>}
        {testPhase === 'timeout' && <small className="push-test-result muted">Не пришло. Проверьте настройки телефона.</small>}
        {testPhase === 'error' && <small className="push-test-result error">Не удалось отправить.</small>}
      </div>}
    </div>
    {(!detailed || status.data) && <>
    <Switch label="Напоминать о незавершённой тренировке" checked={status.data?.workoutReminderEnabled ?? true} disabled={categoryDisabled} onChange={(next) => category.mutate({ kind: WORKOUT_REMINDER_KIND, enabled: next })} />
    {!nativeLocalSupported && role === 'client' && <Switch label="Новые тренировки" checked={status.data?.workoutScheduledEnabled ?? true} disabled={categoryDisabled} onChange={(next) => category.mutate({ kind: WORKOUT_SCHEDULED_KIND, enabled: next })} />}
    {!nativeLocalSupported && <Switch label="Новые сообщения" checked={status.data?.chatMessageEnabled ?? true} disabled={categoryDisabled} onChange={(next) => category.mutate({ kind: CHAT_MESSAGE_KIND, enabled: next })} />}
    </>}
    {nativeLocalSupported && <p className="notification-channel-note"><strong>Новые сообщения</strong><span>Пока только внутри Fit.</span></p>}
    {category.error && <small className="error notification-settings-error">{category.error instanceof Error ? category.error.message : 'Не удалось изменить настройку.'}</small>}
  </>
}
