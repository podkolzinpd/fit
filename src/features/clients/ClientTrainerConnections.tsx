import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invitationsRepository } from '../../data/repositories/invitations.repository'
import { useConfirm } from '../../shared/ui'

export function ClientTrainerConnections({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient()
  const trainers = useQuery({ queryKey: ['client-trainers', clientId], queryFn: () => invitationsRepository.listTrainers(clientId) })
  const invitations = useQuery({ queryKey: ['client-invitations', clientId], queryFn: () => invitationsRepository.list(clientId) })
  const invite = useMutation({ mutationFn: () => invitationsRepository.create(clientId, 'trainer'), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['client-invitations', clientId] }) })
  const revoke = useMutation({ mutationFn: (invitationId: string) => invitationsRepository.revoke(invitationId), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['client-invitations', clientId] }) })
  const [disconnectMessage, setDisconnectMessage] = useState<string | null>(null)
  const disconnectTrainer = useMutation({
    mutationFn: () => invitationsRepository.disconnectTrainer(clientId),
    onMutate: () => setDisconnectMessage(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['client-trainers', clientId] })
      setDisconnectMessage('Тренер отключён. Ваш аккаунт, тренировки, замеры и цели сохранены.')
    },
  })
  const [confirm, confirmDialog] = useConfirm()
  return <section className="client-home-connections"><div className="client-home-section-head"><div><p className="eyebrow">СВЯЗЬ С ТРЕНЕРОМ</p><h2>Тренеры</h2></div><button className="secondary" disabled={invite.isPending} onClick={() => invite.mutate()}>Пригласить тренера</button></div>
    {invite.data && <div className="card"><div><strong>Код для тренера: {invite.data}</strong><p>Действует 7 дней и используется один раз.</p></div></div>}
    {invite.error && <p className="error">{invite.error.message}</p>}
    {trainers.isLoading && <p className="muted">Загрузка тренеров…</p>}
    {trainers.error && <div><p className="error">{trainers.error.message}</p><button className="secondary" onClick={() => void trainers.refetch()}>Повторить</button></div>}
    {trainers.data?.length === 0 && <p className="muted">Сейчас вы занимаетесь самостоятельно.</p>}
    {trainers.data?.map((trainer) => <article className="card" key={trainer.trainerId}><div><strong>{[trainer.firstName, trainer.lastName].filter(Boolean).join(' ') || 'Тренер'}</strong><p>{trainer.isRoot ? 'Основной тренер' : 'Подключённый тренер'}</p></div><button className="link danger" disabled={disconnectTrainer.isPending} onClick={async () => { if (await confirm({ message: 'Отключить тренера? Он потеряет доступ к вашим тренировкам и прогрессу. Ваш аккаунт, история тренировок, замеры и цели сохранятся.', confirmLabel: 'Отключить', danger: true })) disconnectTrainer.mutate() }}>{disconnectTrainer.isPending ? 'Отключаем…' : 'Отключить'}</button></article>)}
    {invitations.isLoading && <p className="muted">Загрузка приглашений…</p>}
    {invitations.data && invitations.data.length > 0 && <div className="client-home-invitations"><h3>Активные приглашения</h3>{invitations.data.map((item) => <article className="card" key={item.id}><div><strong>Приглашение для тренера</strong><p>Действует до {new Date(item.expiresAt).toLocaleDateString('ru-RU')}</p></div><button className="link danger" disabled={revoke.isPending} onClick={async () => { if (await confirm({ message: 'Отозвать это приглашение? Код больше нельзя будет использовать.', confirmLabel: 'Отозвать', danger: true })) revoke.mutate(item.id) }}>Отозвать</button></article>)}</div>}
    {invitations.error && <div><p className="error">{invitations.error.message}</p><button className="secondary" onClick={() => void invitations.refetch()}>Повторить</button></div>}
    {disconnectMessage && <p className="client-trainer-disconnect-success" role="status">{disconnectMessage}</p>}
    {(disconnectTrainer.error || revoke.error) && <p className="error">{(disconnectTrainer.error ?? revoke.error)?.message}</p>}
    {confirmDialog}
  </section>
}
