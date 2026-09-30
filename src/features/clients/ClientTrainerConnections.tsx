import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useDataBackend } from '../../app/data-backend-context'
import type { TrainerMembership } from '../../shared/domain'
import { SearchIcon } from '../../shared/icons'
import { OverflowMenu, useConfirm } from '../../shared/ui'
import { InvitationShareButton } from '../auth/InvitationShareActions'
import { ChatStartButton } from '../chat'

export function ClientTrainerConnections({ clientId }: { clientId: string }) {
  const { invitations: invitationsRepository } = useDataBackend()
  const queryClient = useQueryClient()
  const trainers = useQuery({ queryKey: ['client-trainers', clientId], queryFn: () => invitationsRepository.listTrainers(clientId) })
  const invitations = useQuery({ queryKey: ['client-invitations', clientId], queryFn: () => invitationsRepository.list(clientId) })
  const revoke = useMutation({ mutationFn: (invitationId: string) => invitationsRepository.revoke(invitationId), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['client-invitations', clientId] }) })
  const [disconnectMessage, setDisconnectMessage] = useState<string | null>(null)
  const disconnectTrainer = useMutation({
    mutationFn: (trainerId: string) => invitationsRepository.removeTrainer(clientId, trainerId),
    onMutate: () => setDisconnectMessage(null),
    onSuccess: async (_, trainerId) => {
      await queryClient.cancelQueries({ queryKey: ['client-trainers', clientId] })
      queryClient.setQueryData<TrainerMembership[]>(['client-trainers', clientId], (current) =>
        current?.filter((trainer) => trainer.trainerId !== trainerId))
      await queryClient.invalidateQueries({ queryKey: ['client-trainers', clientId] })
      setDisconnectMessage('Тренер отключён. Ваш аккаунт, тренировки, замеры и цели сохранены.')
    },
  })
  const [confirm, confirmDialog] = useConfirm()
  const hasTrainers = (trainers.data?.length ?? 0) > 0
  return <section className="client-home-connections" aria-label="Связь с тренером"><div className="client-home-section-head"><div><p className="eyebrow">{hasTrainers ? 'СВЯЗЬ С ТРЕНЕРОМ' : 'ТРЕНЕР'}</p><h2>{trainers.data ? (hasTrainers ? 'Мои тренеры' : 'Найдите своего тренера') : 'Тренеры'}</h2></div></div>
    {trainers.isLoading && <p className="muted">Загрузка тренеров…</p>}
    {trainers.error && <div><p className="error">{trainers.error.message}</p><button className="secondary" onClick={() => void trainers.refetch()}>Повторить</button></div>}
    {trainers.data?.length === 0 && <p className="client-trainer-empty-description">Посмотрите анкеты и напишите подходящему тренеру.</p>}
    {trainers.data?.map((trainer) => {
      const name = [trainer.firstName, trainer.lastName].filter(Boolean).join(' ') || 'Тренер'
      const initials = [trainer.firstName, trainer.lastName].filter(Boolean).map((part) => part?.[0] ?? '').join('').toUpperCase() || 'Т'
      return <article className="card client-trainer-connection-card" key={trainer.trainerId}>
        <span className="client-trainer-avatar" aria-hidden="true">{initials}</span>
        <div className="client-trainer-person"><strong>{name}</strong><p>{trainer.isRoot ? 'Основной тренер' : 'Подключённый тренер'}</p></div>
        <div className="client-trainer-actions"><ChatStartButton clientId={clientId} trainerId={trainer.trainerId} /><OverflowMenu label={`Действия с тренером ${name}`} items={[{
          label: disconnectTrainer.isPending ? 'Отключаем…' : 'Отключить',
          danger: true,
          disabled: disconnectTrainer.isPending,
          onClick: () => { void (async () => {
            if (await confirm({ message: 'Отключить тренера? Он потеряет доступ к вашим тренировкам и прогрессу. Ваш аккаунт, история тренировок, замеры и цели сохранятся.', confirmLabel: 'Отключить', danger: true })) disconnectTrainer.mutate(trainer.trainerId)
          })() },
        }]} /></div>
      </article>
    })}
    <Link className={`button client-trainer-search ${trainers.data?.length === 0 ? 'primary' : 'secondary'}`} to="/me/trainers"><SearchIcon />Найти тренера</Link>
    <div className="client-trainer-invite-actions"><p>{hasTrainers ? 'Пригласить другого тренера' : 'Уже договорились с тренером?'}</p><InvitationShareButton clientId={clientId} targetRole="trainer" label="Пригласить тренера" className="secondary client-trainer-invite-button" /><small>Отправьте ему ссылку или QR-код.</small></div>
    {invitations.isLoading && <p className="muted">Загрузка приглашений…</p>}
    {invitations.data && invitations.data.length > 0 && <div className="client-home-invitations"><h3>Активные приглашения</h3>{invitations.data.map((item) => <article className="card" key={item.id}><div><strong>Приглашение для тренера</strong><p>Действует до {new Date(item.expiresAt).toLocaleDateString('ru-RU')}</p></div><button className="link danger" disabled={revoke.isPending} onClick={async () => { if (await confirm({ message: 'Отозвать это приглашение? Ссылка и QR-код больше не будут работать.', confirmLabel: 'Отозвать', danger: true })) revoke.mutate(item.id) }}>Отозвать</button></article>)}</div>}
    {invitations.error && <div><p className="error">{invitations.error.message}</p><button className="secondary" onClick={() => void invitations.refetch()}>Повторить</button></div>}
    {disconnectMessage && <p className="client-trainer-disconnect-success" role="status">{disconnectMessage}</p>}
    {(disconnectTrainer.error || revoke.error) && <p className="error">{(disconnectTrainer.error ?? revoke.error)?.message}</p>}
    {confirmDialog}
  </section>
}
