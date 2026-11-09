import { TrainerNutritionConsent } from '../nutrition'
import { TrainerHistoryConsent } from '../../shared/TrainerHistoryConsent'
import { ConnectionRequests } from '../auth/ConnectionPage'
import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useDataBackend } from '../../app/data-backend-context'
import type { TrainerMembership } from '../../shared/domain'
import { SearchIcon } from '../../shared/icons'
import { OverflowMenu, useConfirm } from '../../shared/ui'
import { InvitationShareButton } from '../auth/InvitationShareActions'
import { ChatStartButton } from '../chat'

export function ClientTrainerConnections({ clientId, finance }: { clientId: string; finance?: ReactNode }) {
  const { invitations: invitationsRepository, connectionDirectory } = useDataBackend()
  const queryClient = useQueryClient()
  const trainers = useQuery({ queryKey: ['client-trainers', clientId], queryFn: () => invitationsRepository.listTrainers(clientId), refetchOnMount: 'always' })
  const invitations = useQuery({ queryKey: ['client-invitations', clientId], queryFn: () => invitationsRepository.list(clientId) })
  const revoke = useMutation({ mutationFn: (invitationId: string) => invitationsRepository.revoke(invitationId), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['client-invitations', clientId] }) })
  const history = useQuery({ queryKey: ['trainer-history-access', clientId],
    queryFn: () => connectionDirectory!.historyAccess!(), enabled: !!connectionDirectory?.historyAccess })
  const historyChange = useMutation({
    mutationFn: ({ enabled, soloEnabled }: { enabled: boolean; soloEnabled: boolean }) => connectionDirectory!.setHistoryAccess!(history.data!.relationshipId, enabled, soloEnabled),
    onSuccess: async data => { queryClient.setQueryData(['trainer-history-access', clientId], data); await queryClient.invalidateQueries() },
    onError: () => { void history.refetch() },
  })
  const [disconnectMessage, setDisconnectMessage] = useState<string | null>(null)
  const disconnectTrainer = useMutation({
    mutationFn: (trainerId: string) => invitationsRepository.removeTrainer(clientId, trainerId),
    onMutate: () => setDisconnectMessage(null),
    onSuccess: async (_, trainerId) => {
      await queryClient.cancelQueries({ queryKey: ['client-trainers', clientId] })
      setDisconnectMessage('Тренер отключён. Ваш аккаунт, тренировки, замеры и цели сохранены.')
      queryClient.setQueryData<TrainerMembership[]>(['client-trainers', clientId], (current) =>
        current?.filter((trainer) => trainer.trainerId !== trainerId))
      await queryClient.invalidateQueries()
    },
  })
  const [confirm, confirmDialog] = useConfirm()
  const hasTrainers = (trainers.data?.length ?? 0) > 0
  return <section className="client-home-connections" aria-label="Связь с тренером"><div className="client-home-section-head"><div><p className="eyebrow">{hasTrainers ? 'СВЯЗЬ С ТРЕНЕРОМ' : 'ТРЕНЕР'}</p><h2>{trainers.data ? (hasTrainers ? 'Мой тренер' : 'Найдите своего тренера') : 'Мой тренер'}</h2></div></div>
    {trainers.isLoading && <p className="muted">Загрузка тренера…</p>}
    {trainers.error && <div><p className="error">{trainers.error.message}</p><button className="secondary" onClick={() => void trainers.refetch()}>Повторить</button></div>}
    {trainers.data?.length === 0 && <p className="client-trainer-empty-description">Посмотрите анкеты и напишите подходящему тренеру.</p>}
    {(trainers.data?.length ?? 0) > 1 && <div><p className="error" role="alert">Не удалось однозначно определить текущего тренера. Обновите страницу или обратитесь в поддержку. Ваши данные сохранены.</p><button className="secondary" onClick={() => void trainers.refetch()}>Повторить</button></div>}
    {trainers.data?.length === 1 && trainers.data.map((trainer) => {
      const name = trainer.displayName?.trim() || [trainer.firstName, trainer.lastName].filter(Boolean).join(' ') || 'Тренер'
      const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
      const person = <><span className="client-trainer-avatar" aria-hidden="true">{initials}</span>
        <div className="client-trainer-person"><strong>{name}</strong><p>{trainer.publicProfileId === null ? 'Анкета не опубликована' : 'Ваш тренер'}</p></div></>
      return <article className="card client-trainer-connection-card" key={trainer.trainerId}>
        {trainer.publicProfileId ? <Link className="client-trainer-profile-link" aria-label={`Анкета тренера ${name}`}
          to={`/trainers/${trainer.publicProfileId}`} state={{ from: '/me/profile' }}>{person}</Link> : person}
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
    {hasTrainers && connectionDirectory?.historyAccess && <div className="stack compact" aria-label="Доступ тренера к истории">
      {history.isLoading && <p role="status">Проверяем доступ к истории…</p>}
      {history.data && trainers.data?.length === 1 && history.data.trainerId === trainers.data[0]!.trainerId && <>
        <TrainerHistoryConsent checked={history.data.enabled} soloChecked={history.data.soloEnabled}
          disabled={historyChange.isPending || history.isFetching}
          onChange={enabled => historyChange.mutate({ enabled, soloEnabled: history.data!.soloEnabled })}
          onSoloChange={soloEnabled => historyChange.mutate({ enabled: history.data!.enabled, soloEnabled })} />
        <TrainerNutritionConsent clientId={clientId} trainerId={history.data.trainerId} />
        <p className="muted">Согласие действует только для текущего тренера. Его можно отозвать — сами тренировки сохранятся.</p>
      </>}
      {historyChange.isPending && <p role="status">Сохраняем доступ…</p>}
      {historyChange.isSuccess && <p role="status">{historyChange.data.enabled ? 'Доступ к истории открыт' : 'Доступ к истории закрыт'}</p>}
      {(history.error || historyChange.error) && <p className="error" role="alert">Не удалось обновить доступ к истории. <button className="link" onClick={() => { historyChange.reset(); void history.refetch() }}>Повторить проверку</button></p>}
    </div>}
    {finance}
    <ConnectionRequests />
    <Link className="button primary connection-entry" to="/connect">Добавить тренера</Link>
    <Link className={`button client-trainer-search ${trainers.data?.length === 0 ? 'primary' : 'secondary'}`} to="/me/trainers"><SearchIcon />Найти тренера</Link>
    {trainers.data?.length === 0 && <div className="client-trainer-invite-actions"><p>Уже договорились с тренером?</p><InvitationShareButton clientId={clientId} targetRole="trainer" label="Пригласить тренера" className="secondary client-trainer-invite-button" /><small>Отправьте ему ссылку или QR-код.</small></div>}
    {hasTrainers && <p className="muted">У вас может быть один активный тренер. Смену подтверждаете вы — история сохранится.</p>}
    {invitations.isLoading && <p className="muted">Загрузка приглашений…</p>}
    {invitations.data && invitations.data.length > 0 && <div className="client-home-invitations"><h3>Активные приглашения</h3>{invitations.data.map((item) => <article className="card" key={item.id}><div><strong>Приглашение для тренера</strong><p>Действует до {new Date(item.expiresAt).toLocaleDateString('ru-RU')}</p></div><button className="link danger" disabled={revoke.isPending} onClick={async () => { if (await confirm({ message: 'Отозвать это приглашение? Ссылка и QR-код больше не будут работать.', confirmLabel: 'Отозвать', danger: true })) revoke.mutate(item.id) }}>Отозвать</button></article>)}</div>}
    {invitations.error && <div><p className="error">{invitations.error.message}</p><button className="secondary" onClick={() => void invitations.refetch()}>Повторить</button></div>}
    {disconnectMessage && <p className="client-trainer-disconnect-success" role="status">{disconnectMessage}</p>}
    {(disconnectTrainer.error || revoke.error) && <p className="error">{(disconnectTrainer.error ?? revoke.error)?.message}</p>}
    {confirmDialog}
  </section>
}
