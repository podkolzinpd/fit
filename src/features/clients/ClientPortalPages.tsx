import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useClientRealtime } from '../../app/use-client-realtime'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { invitationsRepository } from '../../data/repositories/invitations.repository'
import { progressRepository } from '../../data/repositories/progress.repository'
import { splitClientWorkouts, workoutsRepository } from '../../data/repositories/workouts.repository'
import type { CustomMetric, ProgressEntry } from '../../shared/domain'
import { formatLocalDate, localDate, todayLocalDate } from '../../shared/local-date'
import { AsyncView, Field, Page, useConfirm } from '../../shared/ui'
import { ClientTrainingSummaryCard, groupMetricRows, ProgressChart } from '../progress'
import { WorkoutExercisesSummary, WorkoutStatusBadge } from '../workouts'
import { clientWorkoutAuthorLabel } from './workout-author'

function useMine() {
  const query = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine() })
  useClientRealtime(query.data?.id)
  return query
}

export function MyWorkoutsPage() {
  const { actor } = useAuth()
  const mine = useMine()
  const trainers = useQuery({ queryKey: ['client-trainers', mine.data?.id], queryFn: () => invitationsRepository.listTrainers(mine.data!.id), enabled: Boolean(mine.data) })
  const workouts = useQuery({
    queryKey: ['workouts', mine.data?.id],
    queryFn: () => workoutsRepository.list(undefined, undefined, mine.data!.id),
    enabled: Boolean(mine.data),
  })
  const items = workouts.data ? splitClientWorkouts(workouts.data, todayLocalDate()) : null
  return <Page className="client-workouts-page" title="Мои тренировки" action={mine.data && <Link className="button" to="/workouts/new">Добавить</Link>}><AsyncView loading={mine.isLoading || workouts.isLoading || trainers.isLoading} error={mine.error ?? workouts.error ?? trainers.error} onRetry={() => { void mine.refetch(); void workouts.refetch(); void trainers.refetch() }}>
    {items && <div className="client-workouts-stack"><section className="client-workout-section"><div className="client-workout-section-head"><p className="eyebrow">БЛИЖАЙШЕЕ</p><h2>Предстоит</h2></div>{items.upcoming.length ? <div className="cards client-workout-cards">{items.upcoming.map((workout) => <Link className="card client-workout-card" key={workout.id} to={`/workouts/${workout.id}`}><div><strong>{formatLocalDate(workout.workoutDate)}</strong><p className="muted">{clientWorkoutAuthorLabel(workout.createdBy, actor?.userId, trainers.data)}</p><WorkoutExercisesSummary workout={workout} maxItems={2} /></div><WorkoutStatusBadge workout={workout} /></Link>)}</div> : <p className="client-section-empty">Нет запланированных тренировок</p>}</section>
    <section className="client-workout-section"><div className="client-workout-section-head"><p className="eyebrow">РЕЗУЛЬТАТЫ</p><h2>История</h2></div>{items.history.length ? <div className="cards client-workout-cards">{items.history.map((workout) => <Link className="card client-workout-card" key={workout.id} to={`/workouts/${workout.id}`}><div><strong>{formatLocalDate(workout.workoutDate)}</strong><p className="muted">{clientWorkoutAuthorLabel(workout.createdBy, actor?.userId, trainers.data)}</p><WorkoutExercisesSummary workout={workout} maxItems={2} /></div><WorkoutStatusBadge workout={workout} /></Link>)}</div> : <p className="client-section-empty">История пока пуста</p>}</section></div>}
  </AsyncView></Page>
}

export function MyProgressPage() {
  const mine = useMine()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ProgressEntry | null>(null)
  const entries = useQuery({ queryKey: ['progress', mine.data?.id], queryFn: () => progressRepository.list(mine.data!.id), enabled: Boolean(mine.data) })
  const metrics = useQuery({ queryKey: ['metrics', mine.data?.id], queryFn: () => progressRepository.listMetrics(mine.data!.id), enabled: Boolean(mine.data) })
  const [confirm, confirmDialog] = useConfirm()
  const save = useMutation({ mutationFn: ({ form, entry }: { form: HTMLFormElement; entry: ProgressEntry | null }) => {
    const data = new FormData(form)
    const recordedOn = localDate(String(data.get('recordedOn')))
    if (recordedOn > todayLocalDate()) throw new Error('Нельзя добавить замер с будущей датой')
    return progressRepository.save({
      id: entry?.id,
      clientId: mine.data!.id,
      version: entry?.version,
      recordedOn,
      weightKg: numberValue(data.get('weightKg')),
      chestCm: numberValue(data.get('chestCm')),
      waistCm: numberValue(data.get('waistCm')),
      hipCm: numberValue(data.get('hipCm')),
      notes: String(data.get('notes') || '') || undefined,
      customMetrics: (metrics.data ?? []).filter((metric) => !metric.archivedAt).flatMap((metric) => {
        const value = numberValue(data.get(`metric-${metric.id}`))
        return value === undefined ? [] : [{ metricId: metric.id, value }]
      }),
    })
  }, onSuccess: async () => {
    setEditing(null)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['progress', mine.data?.id] }),
      queryClient.invalidateQueries({ queryKey: ['client', mine.data?.id] }),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
    ])
  } })
  const remove = useMutation({ mutationFn: (entry: Parameters<typeof progressRepository.remove>[0]) => progressRepository.remove(entry), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['progress', mine.data?.id] }) })
  function submit(event: FormEvent<HTMLFormElement>, entry: ProgressEntry | null) { event.preventDefault(); save.mutate({ form: event.currentTarget, entry }) }
  async function confirmRemove(entry: ProgressEntry) {
    if (await confirm({ message: `Удалить замер за ${formatLocalDate(entry.recordedOn)}? Это действие нельзя отменить.`, confirmLabel: 'Удалить', danger: true })) remove.mutate(entry)
  }
  return <Page className="client-progress-page" title="Мой прогресс"><AsyncView loading={mine.isLoading || entries.isLoading || metrics.isLoading} error={mine.error ?? entries.error ?? metrics.error} onRetry={() => { void mine.refetch(); void entries.refetch(); void metrics.refetch() }}>
    {entries.data && mine.data && <div className="client-progress-stack"><ClientTrainingSummaryCard clientId={mine.data.id} />
      <ClientProgressForm entry={null} metrics={metrics.data ?? []} busy={save.isPending} error={save.error} onSubmit={(event) => submit(event, null)} />
      {entries.data.length > 0 ? <><ProgressChart entries={entries.data} metric="weightKg" label="Вес" unit="кг" windowEnd={null} onWindowChange={() => undefined} /><section className="client-progress-history"><div className="client-progress-section-head"><p className="eyebrow">ДИНАМИКА</p><h2>История замеров</h2></div><div className="cards">{entries.data.map((entry) => editing?.id === entry.id
        ? <article className="card editing" key={entry.id}><ClientProgressForm entry={entry} metrics={metrics.data ?? []} busy={save.isPending} error={save.error} onSubmit={(event) => submit(event, entry)} onCancel={() => setEditing(null)} /></article>
        : <article className="card" key={entry.id}><div><strong>{formatLocalDate(entry.recordedOn)}</strong><p>{progressSummary(entry, metrics.data ?? []).join(' · ') || 'Показатели не указаны'}</p>{entry.notes && <p className="muted">{entry.notes}</p>}</div><div className="row-actions"><button className="link" onClick={() => setEditing(entry)}>Изменить</button><button className="link danger" disabled={remove.isPending} onClick={() => void confirmRemove(entry)}>Удалить</button></div></article>)}</div></section></> : <p className="client-section-empty">Замеров пока нет</p>}
    </div>}
    {confirmDialog}
  </AsyncView></Page>
}

function ClientProgressForm({ entry, metrics, busy, error, onSubmit, onCancel }: {
  entry: ProgressEntry | null
  metrics: CustomMetric[]
  busy: boolean
  error: Error | null
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel?: () => void
}) {
  const activeMetrics = metrics.filter((metric) => !metric.archivedAt)
  return <section className="client-progress-form"><div className="client-progress-section-head"><p className="eyebrow">{entry ? 'ИСПРАВИТЬ РЕЗУЛЬТАТ' : 'ЗАФИКСИРОВАТЬ РЕЗУЛЬТАТ'}</p><h2>{entry ? 'Изменить замер' : 'Новый замер'}</h2></div><form className="stack compact" onSubmit={onSubmit}>
    <Field label="Дата"><input name="recordedOn" type="date" max={todayLocalDate()} defaultValue={entry?.recordedOn ?? todayLocalDate()} required /></Field>
    <div className="measure-grid"><Field label="Вес, кг"><input name="weightKg" type="number" step="0.1" defaultValue={entry?.weightKg} /></Field><Field label="Грудь, см"><input name="chestCm" type="number" step="0.1" defaultValue={entry?.chestCm} /></Field><Field label="Талия, см"><input name="waistCm" type="number" step="0.1" defaultValue={entry?.waistCm} /></Field><Field label="Бёдра, см"><input name="hipCm" type="number" step="0.1" defaultValue={entry?.hipCm} /></Field></div>
    {groupMetricRows(activeMetrics).map((row) => row.kind === 'single'
      ? <Field key={row.metric.id} label={`${row.metric.name}${row.metric.unit ? `, ${row.metric.unit}` : ''}`}><ClientMetricInput metric={row.metric} entry={entry} /></Field>
      : <Field key={row.base} label={`${row.base}${row.unit ? `, ${row.unit}` : ''}`}><div className="measure-pair">{row.left && <ClientMetricInput metric={row.left} entry={entry} placeholder="Л" />}{row.right && <ClientMetricInput metric={row.right} entry={entry} placeholder="П" />}</div></Field>)}
    <Field label="Заметка"><textarea name="notes" defaultValue={entry?.notes} /></Field>
    {error && <p className="error">{error.message}</p>}<div className="actions">{onCancel && <button type="button" className="secondary" onClick={onCancel}>Отмена</button>}<button disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить замер'}</button></div>
  </form></section>
}

function ClientMetricInput({ metric, entry, placeholder }: { metric: CustomMetric; entry: ProgressEntry | null; placeholder?: string }) {
  return <input name={`metric-${metric.id}`} type="number" step="0.001" placeholder={placeholder} defaultValue={entry?.customMetrics.find((value) => value.metricId === metric.id)?.value} />
}

function progressSummary(entry: ProgressEntry, metrics: CustomMetric[]) {
  return [
    entry.weightKg !== undefined && `${entry.weightKg} кг`,
    entry.chestCm !== undefined && `грудь ${entry.chestCm} см`,
    entry.waistCm !== undefined && `талия ${entry.waistCm} см`,
    entry.hipCm !== undefined && `бёдра ${entry.hipCm} см`,
    ...entry.customMetrics.map(({ metricId, value }) => {
      const metric = metrics.find((item) => item.id === metricId)
      return metric ? `${metric.name} ${value}${metric.unit ? ` ${metric.unit}` : ''}` : String(value)
    }),
  ].filter((part): part is string => Boolean(part))
}

function numberValue(value: FormDataEntryValue | null) {
  return value ? Number(value) : undefined
}
