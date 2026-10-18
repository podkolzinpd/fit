import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useDataBackend } from '../../app/data-backend-context'
import { CHAT_MESSAGE_KIND, WORKOUT_REMINDER_KIND, WORKOUT_SCHEDULED_KIND } from '../../shared/notification-kinds'
import { InlineRequestError, Switch } from '../../shared/ui'
import { detectInstallPlatform, isAppInstalled } from '../install'
import {
  cancelAllNativeWorkoutInactivityReminders,
  isNativeWorkoutInactivityReminderSupported,
  requestWorkoutInactivityNotificationPermission,
  workoutInactivityNotificationPermission,
} from '../workouts/workout-inactivity-reminder'
import { getCurrentPushSubscription, isPushSupported } from './push-subscription'

type DisplayState = 'working' | 'needs-permission' | 'denied' | 'ios-not-installed' | 'loading' | 'error' | 'unsupported' | 'needs-connection'

const STATUS_COPY: Record<DisplayState, string> = {
  working: 'Уведомления настроены',
  'needs-permission': 'Нужно разрешение',
  denied: 'Уведомления запрещены в настройках телефона',
  'ios-not-installed': 'Сначала установите Fit',
  loading: 'Проверяем уведомления…',
  error: 'Не удалось проверить подключение',
  unsupported: 'Уведомления недоступны на этом устройстве',
  'needs-connection': 'Нужно восстановить подключение',
}

export function NotificationsSetting({ userId, role = 'client' }: { userId: string; role?: 'trainer' | 'client' }) {
  const { pushNotifications: repository } = useDataBackend()
  const queryClient = useQueryClient()
  const native = isNativeWorkoutInactivityReminderSupported()
  const supported = isPushSupported() || (native && role === 'client')
  const iosNotInstalled = !native && detectInstallPlatform() === 'ios' && !isAppInstalled()
  const statusKey = ['push-notifications-status', userId]
  const status = useQuery({ queryKey: statusKey, queryFn: () => repository.status(userId), enabled: supported && !iosNotInstalled, retry: false })
  const nativePermission = useQuery({ queryKey: ['local-notification-permission'], queryFn: workoutInactivityNotificationPermission, enabled: native && role === 'client', retry: false })

  const enable = useMutation({
    mutationFn: async () => {
      if (native) {
        if (!await requestWorkoutInactivityNotificationPermission()) throw new Error('Разрешите уведомления для Fit в настройках телефона')
      } else await repository.enable(userId)
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
      if (native && kind === WORKOUT_REMINDER_KIND && !enabled) await cancelAllNativeWorkoutInactivityReminders()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKey }),
  })
  const testPush = useMutation({
    mutationFn: async () => {
      const local = await getCurrentPushSubscription()
      if (!local) throw new Error('Подключение устройства потеряно. Восстановите уведомления на этом устройстве.')
      await repository.sendTestPush(local.endpoint)
    },
    onError: () => { void status.refetch() },
  })

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
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
  }, [queryClient, userId])

  const permission = native ? nativePermission.data : typeof Notification !== 'undefined' ? Notification.permission : undefined
  const state: DisplayState = iosNotInstalled ? 'ios-not-installed'
    : !supported ? 'unsupported'
      : status.isError || (native && nativePermission.isError) ? 'error'
        : status.isPending || (native && nativePermission.isPending) ? 'loading'
          : permission === 'denied' || (!native && status.data.state === 'denied') ? 'denied'
            : native ? permission === 'granted' ? 'working' : permission === 'unsupported' ? 'unsupported' : 'needs-permission'
              : status.data.state === 'working' ? 'working'
                : status.data.state === 'unsupported' ? 'unsupported'
                  : status.data.state === 'needs-connection' || permission === 'granted' ? 'needs-connection' : 'needs-permission'
  const working = state === 'working'
  const checking = status.isFetching || nativePermission.isFetching
  const busy = checking || enable.isPending || category.isPending || testPush.isPending
  const recheck = () => {
    enable.reset()
    testPush.reset()
    if (supported && !iosNotInstalled) void status.refetch()
    if (native) void nativePermission.refetch()
  }
  const error = status.error ?? nativePermission.error

  if (native && role === 'trainer') return <p className="notification-channel-note"><strong>Новые сообщения</strong><span>Пока только внутри Fit.</span></p>

  return <>
    <div className="push-status-row">
      <p className={`push-status-text ${working ? 'working' : 'warning'}`} aria-live="polite">{native && working ? status.data?.workoutReminderEnabled === false ? 'Напоминания выключены' : 'Напоминания настроены' : STATUS_COPY[state]}</p>
      {(state === 'needs-permission' || state === 'needs-connection') && <div className="push-status-actions"><button type="button" className="secondary" disabled={busy} aria-busy={enable.isPending} onClick={() => enable.mutate()}>{enable.isPending ? 'Подключаем…' : state === 'needs-connection' ? 'Восстановить' : 'Включить'}</button></div>}
      {state === 'denied' && <small>Разрешите уведомления для Fit в настройках телефона, затем вернитесь в приложение.</small>}
      {state === 'ios-not-installed' && <small>Добавьте Fit на экран «Домой», затем откройте приложение с его значка.</small>}
      {state === 'error' && error && <InlineRequestError error={error} message="Не удалось проверить разрешение и подключение. Проверьте интернет и повторите попытку." />}
      {(state === 'error' || state === 'denied' || (working && native)) && <button type="button" className="link" disabled={busy} onClick={recheck}>{checking ? 'Проверяем…' : 'Повторить'}</button>}
      {working && !native && <div className="push-status-actions"><button type="button" className="link" disabled={busy} aria-busy={testPush.isPending} onClick={() => testPush.mutate()}>{testPush.isPending ? 'Отправляем…' : 'Отправить тестовое уведомление'}</button></div>}
      {working && testPush.isSuccess && <small role="status">Тестовое уведомление отправлено в очередь. Дождитесь уведомления на телефоне.</small>}
      {testPush.error && <InlineRequestError error={testPush.error} />}
      {enable.error && <InlineRequestError error={enable.error} />}
    </div>
    {status.data && supported && !iosNotInstalled && <>
      {role === 'client' && <>
        <Switch label="Напоминания о тренировках" checked={status.data.workoutReminderEnabled} disabled={busy || !working} onChange={(next) => category.mutate({ kind: WORKOUT_REMINDER_KIND, enabled: next })} />
        <p className="notification-channel-note notification-reminder-note"><span>{native ? 'О незавершённой тренировке.' : 'О тренировке на сегодня и незавершённой тренировке.'}</span></p>
      </>}
      {!native && role === 'client' && <Switch label="Новые тренировки" checked={status.data.workoutScheduledEnabled} disabled={busy || !working} onChange={(next) => category.mutate({ kind: WORKOUT_SCHEDULED_KIND, enabled: next })} />}
      {!native && <Switch label="Новые сообщения" checked={status.data.chatMessageEnabled} disabled={busy || !working} onChange={(next) => category.mutate({ kind: CHAT_MESSAGE_KIND, enabled: next })} />}
    </>}
    {native && <p className="notification-channel-note"><strong>Новые сообщения</strong><span>Пока только внутри Fit.</span></p>}
    {category.error && <InlineRequestError error={category.error} />}
  </>
}
