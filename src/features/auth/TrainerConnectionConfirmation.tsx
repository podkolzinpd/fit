import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { TrainerConnectionOffer, TrainerConnectionsRepository } from '../../shared/trainer-connection'
import { RepositoryError } from '../../data/repositories/error'
import { StatePanel } from '../../shared/ui'

/** One consent view for chat, links, QR and legacy codes on the native backend. */
export function TrainerConnectionConfirmation({ repository, offer, eager = false, onSuccess, onPendingChange }: {
  repository: TrainerConnectionsRepository
  offer: TrainerConnectionOffer
  eager?: boolean
  onPendingChange?: (pending: boolean) => void
  onSuccess: (clientId: string) => void | Promise<void>
}) {
  const queryClient = useQueryClient()
  const [opened, setOpened] = useState(eager)
  const [operationId, setOperationId] = useState(() => crypto.randomUUID())
  const preview = useQuery({
    queryKey: ['trainer-connection-preview', offer.source, offer.locator],
    queryFn: () => repository.preview(offer),
    enabled: opened,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
    retry: false,
  })
  const confirm = useMutation({
    mutationFn: () => {
      if (!preview.data) throw new Error('Сначала проверьте приглашение.')
      return repository.confirm({ ...offer, expectedRelationshipId: preview.data.currentRelationshipId,
        offerVersion: preview.data.offerVersion, operationId })
    },
    onMutate: () => onPendingChange?.(true),
    onSettled: () => onPendingChange?.(false),
    onSuccess: async (clientId) => {
      await queryClient.invalidateQueries()
      await onSuccess(clientId)
    },
  })
  const changed = confirm.error instanceof RepositoryError && confirm.error.code === 'connection_changed'
  const unavailable = confirm.error instanceof RepositoryError && confirm.error.code === 'connection_offer_unavailable'
  async function refresh() {
    confirm.reset()
    setOperationId(crypto.randomUUID())
    await preview.refetch()
  }
  if (!opened) return <button type="button" className="primary" onClick={() => setOpened(true)}>Подключиться</button>
  if (confirm.isSuccess) return <p role="status">Тренер подключён</p>
  if (preview.isFetching) return <p role="status">Проверяем подключение…</p>
  if (preview.error || !preview.data) return <StatePanel compact tone="error" title="Не удалось проверить подключение"
    description={preview.error?.message ?? 'Повторите проверку приглашения.'}
    action={<button type="button" className="secondary" onClick={() => void refresh()}>Проверить снова</button>} />
  const { trainer, currentTrainer } = preview.data
  const switching = currentTrainer !== null && currentTrainer.id !== trainer.id
  return <section className="stack compact trainer-connection-confirmation" aria-label="Подтверждение подключения">
    <strong>{switching ? 'Сменить тренера?' : 'Подключить тренера?'}</strong>
    {switching && <p>Сейчас: <strong>{currentTrainer.name}</strong></p>}
    <p>{switching ? 'Новый тренер' : 'Ваш тренер'}: <strong>{trainer.name}</strong></p>
    <p className="muted">Тренер получит доступ к вашим тренировкам и прогрессу и сможет назначать занятия.</p>
    {switching && <p className="muted">Прежний тренер потеряет текущий доступ. Ваш аккаунт, тренировки, замеры и цели сохранятся. История переписки и прежние записи останутся.</p>}
    {confirm.error && <p className="error" role="alert">{confirm.error.message}</p>}
    {changed ? <button type="button" className="secondary" onClick={() => void refresh()}>Проверить снова</button>
      : !unavailable && <button type="button" className="primary" aria-busy={confirm.isPending} disabled={confirm.isPending}
        onClick={() => confirm.mutate()}>{confirm.isPending ? 'Подключаем…' : switching ? 'Сменить тренера' : 'Подключить тренера'}</button>}
  </section>
}
