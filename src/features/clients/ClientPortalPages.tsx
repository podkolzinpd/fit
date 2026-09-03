import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useClientRealtime } from '../../app/use-client-realtime'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { invitationsRepository } from '../../data/repositories/invitations.repository'
import { progressRepository } from '../../data/repositories/progress.repository'
import { splitClientWorkouts, workoutsRepository } from '../../data/repositories/workouts.repository'
import type { CustomMetric, ProgressEntry } from '../../shared/domain'
import { ScheduleIcon } from '../../shared/icons'
import { formatLocalDate, localDate, todayInTimeZone, type LocalDate } from '../../shared/local-date'
import { AsyncView, EmptyState, Field, Page, useConfirm } from '../../shared/ui'
import { ClientTrainingSummaryCard, groupMetricRows, RunningProgressCard } from '../progress'
import { MetricsManager } from '../progress/MetricsManager'
import { measurementSummaryText } from '../progress/measurement-summary'
import { LoadMoreButton, PastWorkoutPlanCard, WorkoutChronicleCard, WorkoutExercisesSummary, WorkoutStatusBadge, WORKOUT_HISTORY_PAGE_SIZE } from '../workouts'
import { clientWorkoutAuthorLabel } from './workout-author'
import { ClientWorkoutHistoryCalendar } from './ClientWorkoutHistoryCalendar'
import { useWorkoutHistoryCalendar } from './use-workout-history-calendar'

function useMine() {
  const query = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine() })
  useClientRealtime(query.data?.id)
  return query
}

export function MyWorkoutsPage() {
  const { actor } = useAuth()
  const mine = useMine()
  const today = todayInTimeZone(actor?.timezone)
  const calendar = useWorkoutHistoryCalendar(today)
  const { state: calendarState, range: calendarRange } = calendar
  const trainers = useQuery({ queryKey: ['client-trainers', mine.data?.id], queryFn: () => invitationsRepository.listTrainers(mine.data!.id), enabled: Boolean(mine.data) })
  const upcoming = useQuery({
    queryKey: ['workouts', mine.data?.id, 'upcoming', today],
    queryFn: () => workoutsRepository.list(today, undefined, mine.data!.id),
    enabled: Boolean(mine.data),
  })
  const history = useInfiniteQuery({
    queryKey: ['workouts', mine.data?.id, 'history', today],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => workoutsRepository.listPage(undefined, today, mine.data!.id, pageParam, WORKOUT_HISTORY_PAGE_SIZE),
    getNextPageParam: (page) => page.nextOffset,
    enabled: Boolean(mine.data),
  })
  const calendarHistory = useQuery({
    queryKey: ['workouts', mine.data?.id, 'history-calendar', calendarRange.from, calendarRange.to],
    queryFn: () => workoutsRepository.list(calendarRange.from, calendarRange.to, mine.data!.id),
    enabled: Boolean(mine.data) && calendarState.view === 'calendar',
  })
  const upcomingItems = upcoming.data ? splitClientWorkouts(upcoming.data, today).upcoming : []
  const pastItems = splitClientWorkouts(history.data?.pages.flatMap((page) => page.items) ?? [], today)
  const historyItems = pastItems.history
  const calendarHistoryItems = splitClientWorkouts(calendarHistory.data ?? [], today).history
  const hasWorkouts = upcomingItems.length > 0 || pastItems.needsDecision.length > 0 || historyItems.length > 0
  const showHistorySection = historyItems.length > 0 || calendarState.view === 'calendar'

  const showHistoryList = calendar.showList
  const showHistoryCalendar = () => calendar.showCalendar(historyItems[0]?.workoutDate)
  const calendarReturnTo = `/me/workouts${calendar.search}`
  return <Page className="client-workouts-page" title="Мои тренировки" action={mine.data && hasWorkouts && <Link className="button" to="/workouts/new">Добавить</Link>}><AsyncView loading={mine.isLoading || upcoming.isLoading || history.isLoading || trainers.isLoading} error={mine.error ?? upcoming.error ?? history.error ?? trainers.error} empty={!mine.data} onRetry={() => { void mine.refetch(); void upcoming.refetch(); void history.refetch(); void trainers.refetch() }}
    emptyTitle="Заполните профиль спортсмена" emptyDescription="Он нужен, чтобы добавлять самостоятельные тренировки и получать назначения тренера." emptyAction={<Link className="button primary" to="/me/edit">Заполнить профиль</Link>}>
    {mine.data && (hasWorkouts || calendarState.view === 'calendar' ? <div className="client-workouts-stack">
      {upcomingItems.length > 0 && <section className="client-workout-section"><div className="client-workout-section-head"><p className="eyebrow">БЛИЖАЙШЕЕ</p><h2>Предстоит</h2></div><div className="cards client-workout-cards">{upcomingItems.map((workout) => <Link className="card client-workout-card" key={workout.id} to={`/workouts/${workout.id}`}><div><strong>{formatLocalDate(workout.workoutDate)}</strong><p className="muted">{clientWorkoutAuthorLabel(workout.createdBy, actor?.userId, trainers.data)}</p><WorkoutExercisesSummary workout={workout} maxItems={2} /></div><WorkoutStatusBadge workout={workout} /></Link>)}</div></section>}
      {pastItems.needsDecision.length > 0 && <section className="client-workout-section"><div className="client-workout-section-head"><p className="eyebrow">РАНЕЕ ЗАПЛАНИРОВАНО</p><h2>Выберите действие</h2></div><div className="cards client-workout-cards">{pastItems.needsDecision.map((workout) => <PastWorkoutPlanCard key={workout.id} workout={workout} contextLabel={clientWorkoutAuthorLabel(workout.createdBy, actor?.userId, trainers.data)} returnTo="/me/workouts" />)}</div></section>}
      {showHistorySection && <section className="client-workout-section client-history-section"><div className="client-workout-section-head client-history-section-head"><div><p className="eyebrow">РЕЗУЛЬТАТЫ</p><h2>История</h2></div><div className="client-history-view-toggle" role="group" aria-label="Вид истории тренировок"><button type="button" aria-pressed={calendarState.view === 'list'} onClick={showHistoryList}>Список</button><button type="button" aria-pressed={calendarState.view === 'calendar'} onClick={showHistoryCalendar}><ScheduleIcon />Календарь</button></div></div>{calendarState.view === 'list'
        ? <><div className="cards client-workout-cards workout-chronicle-list">{historyItems.map((workout) => <WorkoutChronicleCard key={workout.id} workout={workout} contextLabel={clientWorkoutAuthorLabel(workout.createdBy, actor?.userId, trainers.data)} />)}</div><LoadMoreButton hasMore={history.hasNextPage} loading={history.isFetchingNextPage} onLoadMore={() => void history.fetchNextPage()} /></>
        : <ClientWorkoutHistoryCalendar
            month={calendarState.month}
            today={today}
            workouts={calendarHistoryItems}
            selectedDate={calendarState.selectedDate}
            loading={calendarHistory.isLoading}
            error={calendarHistory.error}
            returnTo={calendarReturnTo}
            contextLabel={(workout) => clientWorkoutAuthorLabel(workout.createdBy, actor?.userId, trainers.data)}
            onRetry={() => void calendarHistory.refetch()}
            onMonthChange={calendar.shiftMonth}
            onDateSelect={calendar.selectDate}
          />}</section>}
    </div> : <EmptyState
      title="Новая тренировка"
      description="Добавьте упражнения голосом, текстом или из каталога."
      action={<Link className="button secondary" to="/workouts/new">Добавить тренировку</Link>}
    />)}
  </AsyncView></Page>
}

export function MyProgressPage() {
  const { actor } = useAuth()
  const today = todayInTimeZone(actor?.timezone)
  const mine = useMine()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ProgressEntry | null>(null)
  const [measurementFormOpen, setMeasurementFormOpen] = useState(false)
  const [measurementHistoryOpen, setMeasurementHistoryOpen] = useState(false)
  const [metricsOpen, setMetricsOpen] = useState(false)
  const entries = useQuery({ queryKey: ['progress', mine.data?.id], queryFn: () => progressRepository.list(mine.data!.id), enabled: Boolean(mine.data) })
  const metrics = useQuery({ queryKey: ['metrics', mine.data?.id], queryFn: () => progressRepository.listMetrics(mine.data!.id), enabled: Boolean(mine.data) })
  const [confirm, confirmDialog] = useConfirm()
  const save = useMutation({ mutationFn: ({ form, entry }: { form: HTMLFormElement; entry: ProgressEntry | null }) => {
    const data = new FormData(form)
    const recordedOn = localDate(String(data.get('recordedOn')))
    if (recordedOn > today) throw new Error('Нельзя добавить замер с будущей датой')
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
  }, onSuccess: async (_savedEntry, variables) => {
    setEditing(null)
    if (!variables.entry) setMeasurementFormOpen(false)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['progress', mine.data?.id] }),
      queryClient.invalidateQueries({ queryKey: ['client-progress-story-measurements', mine.data?.id] }),
      queryClient.invalidateQueries({ queryKey: ['client', mine.data?.id] }),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
    ])
  } })
  const remove = useMutation({ mutationFn: (entry: Parameters<typeof progressRepository.remove>[0]) => progressRepository.remove(entry), onSuccess: async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['progress', mine.data?.id] }),
    queryClient.invalidateQueries({ queryKey: ['client-progress-story-measurements', mine.data?.id] }),
  ]) })
  const createMetric = useMutation({ mutationFn: ({ name, unit }: { name: string; unit: string | null }) => progressRepository.createMetric(mine.data!.id, name, unit), onSuccess: async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['metrics', mine.data?.id] }),
    queryClient.invalidateQueries({ queryKey: ['progress-metrics', mine.data?.id] }),
  ]) })
  const archiveMetric = useMutation({ mutationFn: (metric: CustomMetric) => progressRepository.setMetricArchived(metric, !metric.archivedAt), onSuccess: async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['metrics', mine.data?.id] }),
    queryClient.invalidateQueries({ queryKey: ['progress-metrics', mine.data?.id] }),
  ]) })
  function submit(event: FormEvent<HTMLFormElement>, entry: ProgressEntry | null) { event.preventDefault(); save.mutate({ form: event.currentTarget, entry }) }
  async function confirmRemove(entry: ProgressEntry) {
    if (await confirm({ message: `Удалить замер за ${formatLocalDate(entry.recordedOn)}? Это действие нельзя отменить.`, confirmLabel: 'Удалить', danger: true })) remove.mutate(entry)
  }
  const measurementManagement = entries.data ? <div className="client-measurement-management">
    <nav className="measurement-actions" aria-label="Действия с замерами"><button type="button" className="secondary measurement-primary-action" aria-expanded={measurementFormOpen} onClick={() => setMeasurementFormOpen((open) => !open)}>{measurementFormOpen ? 'Закрыть форму' : 'Добавить замер'}</button>{entries.data.length > 0 && <button type="button" className="link" aria-expanded={measurementHistoryOpen} onClick={() => setMeasurementHistoryOpen((open) => !open)}>История · {entries.data.length}</button>}<button type="button" className="link" aria-expanded={metricsOpen} onClick={() => setMetricsOpen((open) => !open)}>{metricsOpen ? 'Закрыть показатели' : 'Настроить показатели'}</button></nav>
    {measurementFormOpen && <ClientProgressForm entry={null} metrics={metrics.data ?? []} today={today} busy={save.isPending} error={save.error} onSubmit={(event) => submit(event, null)} onCancel={() => setMeasurementFormOpen(false)} />}
    {measurementHistoryOpen && <section className="client-progress-history"><div className="client-progress-section-head"><p className="eyebrow">ИСТОРИЯ</p><h2>Все замеры</h2></div><div className="cards">{entries.data.map((entry) => editing?.id === entry.id
      ? <article className="card editing" key={entry.id}><ClientProgressForm entry={entry} metrics={metrics.data ?? []} today={today} busy={save.isPending} error={save.error} onSubmit={(event) => submit(event, entry)} onCancel={() => setEditing(null)} /></article>
      : <article className="card" key={entry.id}><div><strong>{formatLocalDate(entry.recordedOn)}</strong><p>{measurementSummaryText(entry, metrics.data ?? []) || 'Показатели не указаны'}</p>{entry.notes && <p className="muted">{entry.notes}</p>}</div><div className="row-actions"><button className="link" onClick={() => setEditing(entry)}>Изменить</button><button className="link danger" disabled={remove.isPending} onClick={() => void confirmRemove(entry)}>Удалить</button></div></article>)}</div></section>}
    {metricsOpen && <MetricsManager metrics={metrics.data ?? []} busy={createMetric.isPending || archiveMetric.isPending} error={createMetric.error ?? archiveMetric.error} onCreate={(name, unit) => createMetric.mutate({ name, unit })} onArchive={(metric) => archiveMetric.mutate(metric)} />}
  </div> : null
  return <Page className="client-progress-page" title="Мой прогресс"><AsyncView loading={mine.isLoading || entries.isLoading || metrics.isLoading} error={mine.error ?? entries.error ?? metrics.error} empty={!mine.data} onRetry={() => { void mine.refetch(); void entries.refetch(); void metrics.refetch() }}
    emptyTitle="Заполните профиль спортсмена" emptyDescription="Он связывает тренировки, замеры и анализ прогресса в одном месте." emptyAction={<Link className="button primary" to="/me/edit">Заполнить профиль</Link>}>
    {entries.data && mine.data && <div className="client-progress-stack"><ClientTrainingSummaryCard clientId={mine.data.id} profileGoal={mine.data.goal} gender={mine.data.gender} measurementManagement={measurementManagement} />
      <RunningProgressCard clientId={mine.data.id} />
    </div>}
    {confirmDialog}
  </AsyncView></Page>
}

function ClientProgressForm({ entry, metrics, today, busy, error, onSubmit, onCancel }: {
  entry: ProgressEntry | null
  metrics: CustomMetric[]
  today: LocalDate
  busy: boolean
  error: Error | null
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel?: () => void
}) {
  const activeMetrics = metrics.filter((metric) => !metric.archivedAt)
  return <section className="client-progress-form"><div className="client-progress-section-head"><p className="eyebrow">{entry ? 'ИСПРАВИТЬ РЕЗУЛЬТАТ' : 'ЗАФИКСИРОВАТЬ РЕЗУЛЬТАТ'}</p><h2>{entry ? 'Изменить замер' : 'Новый замер'}</h2></div><form className="stack compact" onSubmit={onSubmit}>
    <Field label="Дата"><input name="recordedOn" type="date" max={today} defaultValue={entry?.recordedOn ?? today} required /></Field>
    <div className="measure-grid"><Field label="Вес, кг"><input name="weightKg" type="number" step="0.1" defaultValue={entry?.weightKg} /></Field><Field label="Грудь, см"><input name="chestCm" type="number" step="0.1" defaultValue={entry?.chestCm} /></Field><Field label="Талия, см"><input name="waistCm" type="number" step="0.1" defaultValue={entry?.waistCm} /></Field><Field label="Бёдра, см"><input name="hipCm" type="number" step="0.1" defaultValue={entry?.hipCm} /></Field></div>
    {groupMetricRows(activeMetrics).map((row) => row.kind === 'single'
      ? <Field key={row.metric.id} label={`${row.metric.name}${row.metric.unit ? `, ${row.metric.unit}` : ''}`}><ClientMetricInput metric={row.metric} entry={entry} /></Field>
      : <Field key={row.base} label={`${row.base}${row.unit ? `, ${row.unit}` : ''}`}><div className="measure-pair">{row.left && <ClientMetricInput metric={row.left} entry={entry} placeholder="Л" />}{row.right && <ClientMetricInput metric={row.right} entry={entry} placeholder="П" />}</div></Field>)}
    <Field label="Заметка"><textarea name="notes" defaultValue={entry?.notes} /></Field>
    {error && <p className="error">{error.message}</p>}<div className="actions">{onCancel && <button type="button" className="secondary" onClick={onCancel}>Отмена</button>}<button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить замер'}</button></div>
  </form></section>
}

function ClientMetricInput({ metric, entry, placeholder }: { metric: CustomMetric; entry: ProgressEntry | null; placeholder?: string }) {
  return <input name={`metric-${metric.id}`} type="number" step="0.001" placeholder={placeholder} defaultValue={entry?.customMetrics.find((value) => value.metricId === metric.id)?.value} />
}


function numberValue(value: FormDataEntryValue | null) {
  return value ? Number(value) : undefined
}
