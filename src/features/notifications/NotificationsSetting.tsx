import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { pushNotificationsRepository } from '../../data/repositories/push-notifications.repository'
import { Switch } from '../../shared/ui'
import { isPushSupported } from './push-subscription'

export function NotificationsSetting({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const statusKey = ['push-notifications-status', userId]
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => pushNotificationsRepository.status(userId),
    enabled: isPushSupported(),
  })
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => (enabled ? pushNotificationsRepository.enable(userId) : pushNotificationsRepository.disable(userId)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKey }),
  })

  if (!isPushSupported()) return null

  const checked = status.data?.subscribed && status.data.workoutReminderEnabled

  return <>
    <Switch
      label="Напоминания о тренировках"
      checked={Boolean(checked)}
      disabled={status.isLoading || toggle.isPending}
      onChange={(next) => toggle.mutate(next)}
    />
    {toggle.error && <small className="error">{toggle.error instanceof Error ? toggle.error.message : 'Не удалось изменить настройку.'}</small>}
  </>
}
