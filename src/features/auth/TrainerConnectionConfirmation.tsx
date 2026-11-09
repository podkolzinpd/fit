import { TrainerHistoryConsent } from '../../shared/TrainerHistoryConsent'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { TrainerConnectionOffer, TrainerConnectionsRepository } from '../../shared/trainer-connection'
import { RepositoryError } from '../../data/repositories/error'
import { StatePanel } from '../../shared/ui'
import './client-merge-choices.css'

/** One consent view for chat, links, QR and legacy codes on the native backend. */
export function TrainerConnectionConfirmation({ repository, offer, eager = false, onSuccess, onPendingChange }: {
  repository: TrainerConnectionsRepository
  offer: TrainerConnectionOffer
  eager?: boolean
  onPendingChange?: (pending: boolean) => void
  onSuccess: (clientId: string) => void | Promise<void>
}) {
  const queryClient = useQueryClient()
  const [shareSoloHistory, setShareSoloHistory] = useState(false)
  const [shareHistory, setShareHistory] = useState(false)
  const [mergeChoices, setMergeChoices] = useState<Record<string, 'account' | 'card'>>({})
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
        offerVersion: preview.data.offerVersion, operationId, shareHistory, shareSoloHistory,
        ...(preview.data.mergeVersion ? { mergeVersion: preview.data.mergeVersion, mergeChoices } : {}) })
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
    setShareHistory(false); setShareSoloHistory(false)
    setMergeChoices({})
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
  const conflicts = preview.data.mergeConflicts ?? []
  const unresolved = conflicts.some(conflict => !mergeChoices[conflict.key])
  return <section className="stack compact trainer-connection-confirmation" aria-label="Подтверждение подключения">
    <strong>{switching ? 'Сменить тренера?' : 'Подключить тренера?'}</strong>
    {switching && <p>Сейчас: <strong>{currentTrainer.name}</strong></p>}
    <p>{switching ? 'Новый тренер' : 'Ваш тренер'}: <strong>{trainer.name}</strong></p>
    <p className="muted">Тренер сможет назначать занятия и видеть ваши совместные тренировки и прогресс.</p>
    {switching && <p className="muted">Прежний тренер потеряет текущий доступ. Ваш аккаунт, тренировки, замеры и цели сохранятся. История переписки и прежние записи останутся.</p>}
    {conflicts.length > 0 && <section className="stack compact" aria-label="Расхождения данных">
      <h3>В карточках есть расхождения</h3>
      <p>Выберите, какие данные взять за основу. Данные без расхождений сохранятся автоматически.</p>
      {conflicts.map(conflict => <fieldset key={conflict.key} className="card stack compact client-merge-choice" disabled={confirm.isPending}>
        <legend>{conflict.label}</legend>
        {(['account', 'card'] as const).map(side => <label key={side} className="stack compact">
          <span><input type="radio" name={`merge-${conflict.key}`} value={side} checked={mergeChoices[conflict.key] === side}
            onChange={() => setMergeChoices(previous => ({ ...previous, [conflict.key]: side }))} /> {side === 'account' ? 'Из моего аккаунта' : 'Из карточки тренера'}</span>
          <span className="merge-conflict-value">{formatMergeValue(conflict[side])}</span>
        </label>)}
        {conflict.key.startsWith('workout:') && <small>Выбранная тренировка останется текущей. Вторая сохранится с результатами, её можно будет продолжить позже.</small>}
        {conflict.key.startsWith('goal:') && <small>Выбранная цель останется текущей. Вторая сохранится в архиве.</small>}
      </fieldset>)}
      {unresolved && <p role="status">Выберите вариант для каждого расхождения.</p>}
    </section>}
    <TrainerHistoryConsent checked={shareHistory} soloChecked={shareSoloHistory} onSoloChange={setShareSoloHistory} disabled={confirm.isPending} onChange={setShareHistory} />
    {confirm.error && <p className="error" role="alert">{confirm.error.message}</p>}
    {changed ? <button type="button" className="secondary" onClick={() => void refresh()}>Проверить снова</button>
      : !unavailable && <button type="button" className="primary" aria-busy={confirm.isPending} disabled={confirm.isPending || unresolved}
        onClick={() => confirm.mutate()}>{confirm.isPending ? 'Подключаем…' : switching ? 'Сменить тренера' : 'Подключить тренера'}</button>}
  </section>
}

function formatMergeValue(value: unknown): string {
  if (value === null || value === undefined) return 'Не указано'
  if (typeof value === 'string') {
    const terms: Record<string, string> = { male: 'Мужской', female: 'Женский', weight: 'Вес', waist: 'Талия',
      chest: 'Грудь', hips: 'Бёдра', decrease_to: 'Снизить до', increase_to: 'Увеличить до',
      maintain_range: 'Удерживать в диапазоне', change_by: 'Изменить на', track_only: 'Отслеживать' }
    return terms[value] ?? value
  }
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return value.map(formatMergeValue).join('\n')
  const labels: Record<string, string> = { date: 'Дата', startedAt: 'Начало', title: 'Название', headline: 'Итог',
    achievements: 'Результаты', consistency: 'Регулярность', encouragement: 'Комментарий', goalAlignment: 'Цель', nextSteps: 'Дальнейшие шаги' }
  return Object.entries(value).filter(([key, item]) => key !== 'revision' && item !== null).map(([key, item]) => `${labels[key] ?? key}: ${formatMergeValue(item)}`).join('\n')
}
