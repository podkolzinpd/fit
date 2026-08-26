import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../../app/auth-context'
import { goalsRepository } from '../../data/repositories/goals.repository'
import { progressRepository } from '../../data/repositories/progress.repository'
import { trainingSummariesRepository } from '../../data/repositories/training-summaries.repository'
import { workoutsRepository } from '../../data/repositories/workouts.repository'
import type {
  ClientGoal,
  ClientTrainingSummary,
  Gender,
  PublishedTrainingSummary,
  TrainingSummary,
  TrainingSummaryMetrics,
  TrainingProgressFact,
} from '../../shared/domain'
import { CloseIcon } from '../../shared/icons'
import { addDays, daysBetween, formatLocalDate, normalizeTimeZone, todayInTimeZone, type LocalDate } from '../../shared/local-date'
import { AsyncView, Field } from '../../shared/ui'
import { trackGoal } from '../../shared/yandex-metrika'
import { TrainingBodyProgressMap } from './ClientBodyProgressMap'
import { clientProgressPresentation } from './client-progress-presentation'
import { progressFactChangeLabel } from './progress-facts'
import { formatSummaryText, formatWorkoutsPerWeek, progressMetricNoun } from './summary-format'
import { availableSummaryPeriods, SUMMARY_PERIODS, summaryPeriodMatch, summaryPeriodRange, type SummaryPeriod } from './summary-period'

function PeriodTabs({ value, available, onChange }: {
  value: SummaryPeriod
  available: readonly SummaryPeriod[]
  onChange: (period: SummaryPeriod) => void
}) {
  const periods = SUMMARY_PERIODS.filter((period) => available.includes(period.key))
  return <div className={`ai-progress-periods period-count-${periods.length}`} aria-label="Период анализа">
    {periods.map((period) => <button
      type="button"
      key={period.key}
      className={period.key === value ? 'active' : ''}
      onClick={() => onChange(period.key)}
    >{period.label}</button>)}
  </div>
}

function Metrics({ metrics }: {
  metrics: TrainingSummaryMetrics
}) {
  return <div className="ai-progress-stats">
    <div><strong>{metrics.completedWorkouts}</strong><span>{progressMetricNoun(metrics.completedWorkouts, 'workout')}</span></div>
    <div><strong>{formatWorkoutsPerWeek(metrics.workoutsPerWeek)}</strong><span>в неделю</span></div>
    <div>
      <strong>{metrics.activeWeeks}</strong>
      <span>{progressMetricNoun(metrics.activeWeeks, 'activeWeek')}</span>
    </div>
  </div>
}

function ProgressFacts({ facts, fallback, limit, onShowAll }: {
  facts: readonly TrainingProgressFact[]
  fallback: readonly string[]
  limit?: number
  onShowAll?: () => void
}) {
  const visibleFacts = limit ? facts.slice(0, limit) : facts
  const visibleFallback = limit ? fallback.slice(0, limit) : fallback
  const hiddenCount = facts.length > 0
    ? Math.max(0, facts.length - visibleFacts.length)
    : Math.max(0, fallback.length - visibleFallback.length)
  if (facts.length === 0) {
    return <><ul>{visibleFallback.map((point) => <li key={point}>{formatSummaryText(point)}</li>)}</ul>
      {hiddenCount > 0 && onShowAll && <button type="button" className="link ai-progress-more" onClick={onShowAll}>Ещё {hiddenCount}</button>}
    </>
  }
  return <><div className="ai-progress-facts">
    {visibleFacts.map((fact) => <div className="ai-progress-fact" key={fact.exerciseName}>
      <strong>{fact.exerciseName}</strong>
      {fact.changes.map((change) => <span key={change.metric}>{progressFactChangeLabel(change)}</span>)}
    </div>)}
  </div>{hiddenCount > 0 && onShowAll && <button type="button" className="link ai-progress-more" onClick={onShowAll}>Ещё {hiddenCount} {hiddenCount === 1 ? 'упражнение' : 'упражнения'}</button>}</>
}

function SummaryHeader({ client = false, published }: { client?: boolean; published?: boolean }) {
  return <header className="ai-progress-header">
    <div className="ai-progress-title">
      <span className="ai-progress-mark" aria-hidden="true">✦</span>
      <div>
        <h2>{client ? 'Твой прогресс' : 'Анализ прогресса'}</h2>
        <p>По завершённым тренировкам</p>
      </div>
    </div>
    {published !== undefined && <span className={`ai-progress-demo${published ? ' published' : ''}`}>
      {published ? 'Доступно клиенту' : 'Только тренеру'}
    </span>}
  </header>
}

function SummaryCore({ headline, metrics, progress, consistency, progressLimit, onShowAllProgress }: {
  headline: string
  metrics: TrainingSummaryMetrics
  progress: readonly string[]
  consistency: string
  progressLimit?: number
  onShowAllProgress?: () => void
}) {
  return <>
    <div className="ai-progress-hero"><span>Главное за период</span><strong>{formatSummaryText(headline)}</strong></div>
    <Metrics metrics={metrics} />
    <div className="ai-progress-section ai-progress-changes">
      <h3>Динамика упражнений</h3>
      <ProgressFacts facts={metrics.progressFacts} fallback={progress} limit={progressLimit} onShowAll={onShowAllProgress} />
    </div>
    <div className="ai-progress-section ai-progress-regularity">
      <div><span>Ритм тренировок</span><strong>{formatWorkoutsPerWeek(metrics.workoutsPerWeek)} в неделю</strong></div>
      <p>{formatSummaryText(consistency)}</p>
    </div>
  </>
}

export function TrainerTrainingSummaryCard({ clientId, gender = null }: { clientId: string; gender?: Gender | null }) {
  const { actor } = useAuth()
  const today = todayInTimeZone(actor?.timezone)
  const timeZone = normalizeTimeZone(actor?.timezone)
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState<SummaryPeriod>('1m')
  const [generationMessage, setGenerationMessage] = useState<string | null>(null)
  const firstWorkout = useQuery({
    queryKey: ['training-summary-first-workout', clientId],
    queryFn: () => trainingSummariesRepository.firstCompletedWorkoutDate(clientId),
  })
  const query = useQuery({
    queryKey: ['training-summaries', 'trainer', clientId],
    queryFn: () => trainingSummariesRepository.listForTrainer(clientId),
  })
  const loading = query.isLoading || firstWorkout.isLoading
  const loadError = query.error ?? firstWorkout.error
  const ready = !loading && !loadError
  const availablePeriods = availableSummaryPeriods(firstWorkout.data, today)
  useEffect(() => {
    if (!availablePeriods.includes(period)) setPeriod('1m')
  }, [availablePeriods, period])
  const summary = summaryPeriodMatch(query.data ?? [], period, today)
  const range = summaryPeriodRange(period, today)
  const workoutRange = summary
    ? { start: summary.periodStart, end: summary.periodEnd }
    : range
  const workouts = useQuery({
    queryKey: [
      'trainer-progress-body-map-workouts',
      clientId,
      workoutRange.start,
      workoutRange.end,
    ],
    queryFn: () => workoutsRepository.list(
      workoutRange.start,
      workoutRange.end,
      clientId,
    ),
    enabled: ready && Boolean(summary),
  })
  const generate = useMutation({
    mutationFn: async () => {
      const generation = await trainingSummariesRepository.generate(
        clientId,
        range.start,
        range.end,
        Boolean(summary),
      )
      const summaries = await trainingSummariesRepository.listForTrainer(clientId)
      return { generation, summaries }
    },
    onMutate: () => setGenerationMessage(null),
    onSuccess: ({ generation, summaries }) => {
      queryClient.setQueryData(['training-summaries', 'trainer', clientId], summaries)
      setGenerationMessage(generation.cached ? 'Анализ уже актуален' : 'Анализ обновлён')
    },
  })
  const changePeriod = (nextPeriod: SummaryPeriod) => {
    generate.reset()
    setGenerationMessage(null)
    setPeriod(nextPeriod)
  }

  return <section className="ai-progress-card" aria-label="ИИ-анализ тренировок" aria-busy={loading}>
    <SummaryHeader published={summary?.published} />
    {ready && <PeriodTabs value={period} available={availablePeriods} onChange={changePeriod} />}
    <AsyncView
      loading={loading}
      error={loadError}
      onRetry={() => void Promise.all([query.refetch(), firstWorkout.refetch()])}
    >
      {summary
        ? <TrainerSummaryContent
            key={summary.id}
            summary={summary}
            clientId={clientId}
            gender={gender}
            workouts={workouts.data ?? []}
            workoutsLoading={workouts.isLoading}
            workoutsError={workouts.error}
            onWorkoutsRetry={() => void workouts.refetch()}
            onChanged={() => queryClient.invalidateQueries({
              queryKey: ['training-summaries', 'trainer', clientId],
            })}
          />
        : <div className="ai-progress-empty">
            <strong>Анализ за этот период ещё не создан</strong>
            <p>{formatLocalDate(range.start)} — {formatLocalDate(range.end)}</p>
          </div>}
    </AsyncView>
    {ready && <footer className="ai-progress-footer">
      <span role={generationMessage ? 'status' : undefined}>
        {generate.isPending
          ? 'Формируем новый анализ — это может занять до минуты'
          : generationMessage ?? (summary
            ? `Обновлено ${new Date(summary.generatedAt).toLocaleString('ru-RU', { timeZone })}`
            : 'Данные клиента не отправляются без действия тренера')}
      </span>
      <button
        type="button"
        className="secondary"
        disabled={generate.isPending}
        onClick={() => {
          trackGoal(summary ? 'refresh_training_summary_click' : 'create_training_summary_click')
          generate.mutate()
        }}
      >
        {generate.isPending ? 'Обновляем…' : summary ? 'Обновить' : 'Создать анализ'}
      </button>
    </footer>}
    {generate.error && <p className="ai-progress-error error" role="alert">{generate.error.message}</p>}
  </section>
}

function TrainerSummaryContent({ summary, clientId, gender, workouts, workoutsLoading, workoutsError, onWorkoutsRetry, onChanged }: {
  summary: TrainingSummary
  clientId: string
  gender: Gender | null
  workouts: Awaited<ReturnType<typeof workoutsRepository.list>>
  workoutsLoading: boolean
  workoutsError: Error | null
  onWorkoutsRetry: () => void
  onChanged: () => Promise<unknown>
}) {
  const [clientCopyOpen, setClientCopyOpen] = useState(false)
  const [progressOpen, setProgressOpen] = useState(false)
  const [attentionOpen, setAttentionOpen] = useState(false)
  const hiddenAttentionCount = Math.max(0, summary.trainer.attention.length - 1)
  return <>
    <TrainingBodyProgressMap
      summary={summary}
      workouts={workouts}
      clientId={clientId}
      clientGender={gender}
      loadLoading={workoutsLoading}
      loadError={workoutsError}
      onLoadRetry={onWorkoutsRetry}
    />
    <SummaryCore
      headline={summary.trainer.headline}
      metrics={summary.metrics}
      progress={summary.trainer.progress}
      consistency={summary.trainer.consistency}
      progressLimit={3}
      onShowAllProgress={() => setProgressOpen(true)}
    />
    {summary.trainer.attention.length > 0 && <div className="ai-progress-attention">
      <span aria-hidden="true">!</span>
      <div>
        <strong>На что обратить внимание</strong>
        <p>{formatSummaryText(summary.trainer.attention[0]!)}</p>
        {hiddenAttentionCount > 0 && <button type="button" className="link ai-progress-more" onClick={() => setAttentionOpen(true)}>Ещё {hiddenAttentionCount} {hiddenAttentionCount === 1 ? 'сигнал' : 'сигнала'}</button>}
      </div>
    </div>}
    <div className="client-copy-toggle">
      <button type="button" className="link" onClick={() => setClientCopyOpen(true)}>Версия для спортсмена</button>
    </div>
    {progressOpen && <SummarySheet title="Динамика упражнений" onClose={() => setProgressOpen(false)}>
      <ProgressFacts facts={summary.metrics.progressFacts} fallback={summary.trainer.progress} />
    </SummarySheet>}
    {attentionOpen && <SummarySheet title="На что обратить внимание" onClose={() => setAttentionOpen(false)}>
      <div className="ai-progress-sheet-list">{summary.trainer.attention.map((point) => <p key={point}>{formatSummaryText(point)}</p>)}</div>
    </SummarySheet>}
    {clientCopyOpen && <SummarySheet title="Версия для спортсмена" onClose={() => setClientCopyOpen(false)}>
      <ClientCopyEditor summary={summary} clientId={clientId} onChanged={onChanged} />
    </SummarySheet>}
  </>
}

function SummarySheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="sheet-overlay" onClick={onClose}>
    <section className="ai-progress-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
      <header><h2>{title}</h2><button type="button" className="picker-close" aria-label="Закрыть" onClick={onClose}><CloseIcon /></button></header>
      <div className="ai-progress-sheet-content">{children}</div>
    </section>
  </div>
}

function ClientCopyEditor({ summary, clientId, onChanged }: {
  summary: TrainingSummary
  clientId: string
  onChanged: () => Promise<unknown>
}) {
  const [saved, setSaved] = useState(false)
  const publish = useMutation({
    mutationFn: (copy: ClientTrainingSummary) =>
      trainingSummariesRepository.publish(summary, copy),
    onSuccess: async () => { setSaved(true); await onChanged() },
  })
  const unpublish = useMutation({
    mutationFn: () => trainingSummariesRepository.unpublish(summary),
    onSuccess: onChanged,
  })
  useEffect(() => setSaved(false), [summary.id])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    publish.mutate({
      headline: String(values.get('headline') ?? '').trim(),
      achievements: String(values.get('achievements') ?? '')
        .split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 4),
      consistency: String(values.get('consistency') ?? '').trim(),
      encouragement: String(values.get('encouragement') ?? '').trim(),
      goalAlignment: String(values.get('goalAlignment') ?? '').trim() || undefined,
      nextSteps: String(values.get('nextSteps') ?? '')
        .split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 3),
    })
  }

  return <form className="client-copy-editor" onSubmit={(event) => void submit(event)}>
    <div className="client-copy-heading client-copy-status">
      <p>Внутренние замечания сюда не попадут</p>
      <span>{summary.published ? 'Клиент уже видит' : 'Клиент может запросить сам'}</span>
    </div>
    <Field label="Главный результат"><textarea name="headline" defaultValue={formatSummaryText(summary.client.headline)} required /></Field>
    <Field label="Достижения — по одному в строке"><textarea name="achievements" defaultValue={summary.client.achievements.map(formatSummaryText).join('\n')} required /></Field>
    <Field label="Регулярность"><textarea name="consistency" defaultValue={formatSummaryText(summary.client.consistency)} required /></Field>
    <Field label="Связь с целью"><textarea name="goalAlignment" defaultValue={summary.client.goalAlignment ? formatSummaryText(summary.client.goalAlignment) : ''} /></Field>
    <Field label="Следующие ориентиры — по одному в строке"><textarea name="nextSteps" defaultValue={summary.client.nextSteps?.map(formatSummaryText).join('\n') ?? ''} /></Field>
    <Field label="Поддерживающий итог"><textarea name="encouragement" defaultValue={formatSummaryText(summary.client.encouragement)} required /></Field>
    {(publish.error ?? unpublish.error) && <p className="error" role="alert">{(publish.error ?? unpublish.error)?.message}</p>}
    {saved && <p className="success">Версия опубликована для клиента</p>}
    <div className="actions">
      {summary.published && <button
        type="button"
        className="secondary danger"
        disabled={unpublish.isPending}
        onClick={() => unpublish.mutate()}
      >Скрыть</button>}
      <button disabled={publish.isPending || unpublish.isPending}>
        {summary.published ? 'Сохранить клиентскую версию' : 'Сохранить версию'}
      </button>
    </div>
    <input type="hidden" name="clientId" value={clientId} />
  </form>
}

export function ClientTrainingSummaryCard({ clientId, profileGoal, gender = null }: {
  clientId: string
  profileGoal?: string | null
  gender?: Gender | null
}) {
  const { actor } = useAuth()
  const today = todayInTimeZone(actor?.timezone)
  const timeZone = normalizeTimeZone(actor?.timezone)
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState<SummaryPeriod>('1m')
  const [generationMessage, setGenerationMessage] = useState<string | null>(null)
  const firstWorkout = useQuery({
    queryKey: ['training-summary-first-workout', clientId],
    queryFn: () => trainingSummariesRepository.firstCompletedWorkoutDate(clientId),
  })
  const query = useQuery({
    queryKey: ['training-summaries', 'client', clientId],
    queryFn: () => trainingSummariesRepository.listForClient(clientId),
  })
  const loading = query.isLoading || firstWorkout.isLoading
  const loadError = query.error ?? firstWorkout.error
  const ready = !loading && !loadError
  const availablePeriods = availableSummaryPeriods(firstWorkout.data, today)
  useEffect(() => {
    if (!availablePeriods.includes(period)) setPeriod('1m')
  }, [availablePeriods, period])
  const summary = summaryPeriodMatch(query.data ?? [], period, today)
  const workoutRange = summary
    ? { start: summary.periodStart, end: summary.periodEnd }
    : summaryPeriodRange(period, today)
  const periodDays = summary ? daysBetween(summary.periodStart, summary.periodEnd) + 1 : 0
  const previousRange = summary ? {
    start: addDays(summary.periodStart, -periodDays),
    end: addDays(summary.periodStart, -1),
  } : null
  const storyRange = {
    start: previousRange?.start ?? workoutRange.start,
    end: addDays(today, 45),
  }
  const workouts = useQuery({
    queryKey: ['client-progress-story-workouts', clientId, storyRange.start, storyRange.end],
    queryFn: () => workoutsRepository.list(storyRange.start, storyRange.end, clientId),
    enabled: ready && Boolean(summary),
  })
  const measurements = useQuery({
    queryKey: ['client-progress-story-measurements', clientId],
    queryFn: () => progressRepository.list(clientId),
    enabled: ready && Boolean(summary),
  })
  const goal = useQuery({
    queryKey: ['client-goal', clientId],
    queryFn: () => goalsRepository.get(clientId),
  })
  const generate = useMutation({
    mutationFn: async () => {
      const range = summaryPeriodRange(period, today)
      const generation = await trainingSummariesRepository.generate(clientId, range.start, range.end, true)
      const summaries = await trainingSummariesRepository.listForClient(clientId)
      return { generation, summaries }
    },
    onMutate: () => setGenerationMessage(null),
    onSuccess: ({ generation, summaries }) => {
      queryClient.setQueryData(['training-summaries', 'client', clientId], summaries)
      setGenerationMessage(generation.cached ? 'Анализ уже актуален' : 'Анализ обновлён')
    },
  })
  const changePeriod = (nextPeriod: SummaryPeriod) => {
    generate.reset()
    setGenerationMessage(null)
    setPeriod(nextPeriod)
  }
  const currentWorkouts = workouts.data?.filter((workout) =>
    workout.workoutDate >= workoutRange.start && workout.workoutDate <= workoutRange.end)
  const previousWorkouts = previousRange ? workouts.data?.filter((workout) =>
    workout.workoutDate >= previousRange.start && workout.workoutDate <= previousRange.end) : undefined
  const upcomingWorkouts = workouts.data?.filter((workout) =>
    workout.workoutDate >= today && workout.workoutDate <= storyRange.end)

  return <section className="ai-progress-card client-progress-card" aria-label="Прогресс тренировок" aria-busy={loading}>
    <SummaryHeader client />
    {ready && <PeriodTabs value={period} available={availablePeriods} onChange={changePeriod} />}
    <AsyncView
      loading={loading}
      error={loadError}
      onRetry={() => void Promise.all([query.refetch(), firstWorkout.refetch()])}
    >
      {summary ? <ClientSummaryContent
          summary={summary}
          goal={goal.data}
          profileGoal={profileGoal}
          gender={gender}
          today={today}
          goalLoading={goal.isLoading}
          goalError={goal.error}
          onGoalRetry={() => void goal.refetch()}
          currentWorkouts={currentWorkouts}
          previousWorkouts={previousWorkouts}
          upcomingWorkouts={upcomingWorkouts}
          measurements={measurements.data ?? []}
          workoutsLoading={workouts.isLoading}
          workoutsError={workouts.error}
          onWorkoutsRetry={() => void workouts.refetch()}
        /> : <div className="ai-progress-empty">
        <strong>Анализ за этот период ещё не создан</strong>
        <p>Создай его по завершённым тренировкам.</p>
      </div>}
    </AsyncView>
    {ready && <footer className="ai-progress-footer">
      <span role={generationMessage ? 'status' : undefined}>
        {generate.isPending
          ? 'Формируем новый анализ — это может занять до минуты'
          : generationMessage ?? (summary
            ? `Сводка сформирована ${new Date(summary.publishedAt).toLocaleDateString('ru-RU', { timeZone })}`
            : 'Можно запросить первый анализ')}
      </span>
      <button
        type="button"
        className="secondary"
        disabled={generate.isPending}
        onClick={() => generate.mutate()}
      >
        {generate.isPending ? 'Обновляем…' : summary ? 'Обновить' : 'Создать анализ'}
      </button>
    </footer>}
    {generate.error && <p className="ai-progress-error error" role="alert">{generate.error.message}</p>}
  </section>
}

function ClientSummaryContent({ summary, goal, profileGoal, gender, today, goalLoading, goalError, onGoalRetry, currentWorkouts, previousWorkouts, upcomingWorkouts, measurements, workoutsLoading, workoutsError, onWorkoutsRetry }: {
  summary: PublishedTrainingSummary
  goal: ClientGoal | null | undefined
  profileGoal?: string | null
  gender: Gender | null
  today: LocalDate
  goalLoading: boolean
  goalError: Error | null
  onGoalRetry: () => void
  currentWorkouts?: Awaited<ReturnType<typeof workoutsRepository.list>>
  previousWorkouts?: Awaited<ReturnType<typeof workoutsRepository.list>>
  upcomingWorkouts?: Awaited<ReturnType<typeof workoutsRepository.list>>
  measurements: Awaited<ReturnType<typeof progressRepository.list>>
  workoutsLoading: boolean
  workoutsError: Error | null
  onWorkoutsRetry: () => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const presentation = clientProgressPresentation(summary, {
    currentWorkouts,
    previousWorkouts,
    upcomingWorkouts,
    measurements,
    goal,
    profileGoal,
    today,
  })
  return <>
    <TrainingBodyProgressMap
      summary={summary}
      workouts={currentWorkouts ?? []}
      clientId={summary.clientId}
      clientGender={gender}
      loadLoading={workoutsLoading}
      loadError={workoutsError}
      onLoadRetry={onWorkoutsRetry}
    />
    <div className={`ai-progress-stats count-${presentation.stats.length}`}>
      {presentation.stats.map((stat) => <div key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></div>)}
    </div>
    {presentation.comparison && <section className="client-progress-comparison" aria-labelledby="client-progress-comparison-title">
      <h3 id="client-progress-comparison-title">{presentation.comparison.title}</h3>
      <div>{presentation.comparison.items.map((item) => <article key={item.label} className={item.tone}>
        <strong>{item.value}</strong><span>{item.label}</span>
      </article>)}</div>
    </section>}
    {goalLoading && <section className="client-progress-story-state" role="status">Проверяем данные цели…</section>}
    {goalError && <section className="client-progress-story-state" role="alert">Не удалось загрузить цель. <button type="button" className="link" onClick={onGoalRetry}>Повторить</button></section>}
    {!goalLoading && !goalError && presentation.goal && <section className="client-progress-goal-story" aria-labelledby="client-progress-goal-story-title">
      <span>Для твоей цели</span>
      <h3 id="client-progress-goal-story-title">{presentation.goal.title}</h3>
      {presentation.goal.evidence.length > 0
        ? <ul>{presentation.goal.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
        : <p>Цель сохранена. Первое измеримое изменение появится здесь после сопоставимых результатов.</p>}
    </section>}
    {!goalLoading && !goalError && !presentation.goal && <section className="client-progress-goal-story empty" aria-labelledby="client-progress-goal-story-title">
      <span>Для твоей цели</span><h3 id="client-progress-goal-story-title">Добавь свой ориентир</h3>
      <p>Тогда прогресс будет связан с тем результатом, ради которого ты тренируешься.</p>
      <a className="link" href="/me/edit">Добавить цель</a>
    </section>}
    {presentation.nextWorkout && <section className="client-progress-upcoming" aria-labelledby="client-progress-upcoming-title">
      <span>Ближайший план</span>
      <h3 id="client-progress-upcoming-title">{presentation.nextWorkout.date}</h3>
      {presentation.nextWorkout.title !== 'Ближайшая тренировка' && <p>{presentation.nextWorkout.title}</p>}
      <div>{presentation.nextWorkout.exercises.map((exercise) => <article key={exercise.name}>
        <strong>{exercise.name}</strong>{exercise.plan && <span>{exercise.plan}</span>}
      </article>)}</div>
    </section>}
    <div className="client-progress-details-toggle">
      <button type="button" className="link" onClick={() => setDetailsOpen(true)}>Подробный анализ</button>
    </div>
    {detailsOpen && <SummarySheet title="Подробный анализ" onClose={() => setDetailsOpen(false)}>
      <section className="client-progress-details-section">
        <h3>Динамика упражнений</h3>
        <ProgressFacts facts={summary.metrics.progressFacts} fallback={summary.summary.achievements} />
      </section>
      <section className="client-progress-details-section">
        <h3>Ритм тренировок</h3>
        <p>{formatSummaryText(summary.summary.consistency)}</p>
      </section>
      {summary.summary.nextSteps && summary.summary.nextSteps.length > 0 && <section className="client-progress-details-section">
        <h3>Ориентиры</h3>
        <ul>{summary.summary.nextSteps.map((point) => <li key={point}>{formatSummaryText(point)}</li>)}</ul>
      </section>}
    </SummarySheet>}
  </>
}
