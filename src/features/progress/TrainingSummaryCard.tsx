import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../app/auth-context'
import { goalsRepository } from '../../data/repositories/goals.repository'
import { trainingSummariesRepository } from '../../data/repositories/training-summaries.repository'
import type {
  ClientGoal,
  ClientTrainingSummary,
  PublishedTrainingSummary,
  TrainingSummary,
  TrainingSummaryMetrics,
  TrainingProgressFact,
} from '../../shared/domain'
import { formatLocalDate, normalizeTimeZone, todayInTimeZone, type LocalDate } from '../../shared/local-date'
import { AsyncView, Field } from '../../shared/ui'
import { trackGoal } from '../../shared/yandex-metrika'
import { ClientProgressGoalSection } from './ClientProgressGoalSection'
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

function ProgressFacts({ facts, fallback }: {
  facts: readonly TrainingProgressFact[]
  fallback: readonly string[]
}) {
  if (facts.length === 0) {
    return <ul>{fallback.map((point) => <li key={point}>{formatSummaryText(point)}</li>)}</ul>
  }
  return <div className="ai-progress-facts">
    {facts.map((fact) => <div className="ai-progress-fact" key={fact.exerciseName}>
      <strong>{fact.exerciseName}</strong>
      {fact.changes.map((change) => <span key={change.metric}>{progressFactChangeLabel(change)}</span>)}
    </div>)}
  </div>
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

function SummaryCore({ headline, metrics, progress, consistency }: {
  headline: string
  metrics: TrainingSummaryMetrics
  progress: readonly string[]
  consistency: string
}) {
  return <>
    <div className="ai-progress-hero"><span>Главное за период</span><strong>{formatSummaryText(headline)}</strong></div>
    <Metrics metrics={metrics} />
    <div className="ai-progress-section ai-progress-changes">
      <h3>Динамика упражнений</h3>
      <ProgressFacts facts={metrics.progressFacts} fallback={progress} />
    </div>
    <div className="ai-progress-section ai-progress-regularity">
      <div><span>Ритм тренировок</span><strong>{formatWorkoutsPerWeek(metrics.workoutsPerWeek)} в неделю</strong></div>
      <p>{formatSummaryText(consistency)}</p>
    </div>
  </>
}

export function TrainerTrainingSummaryCard({ clientId }: { clientId: string }) {
  const { actor } = useAuth()
  const today = todayInTimeZone(actor?.timezone)
  const timeZone = normalizeTimeZone(actor?.timezone)
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState<SummaryPeriod>('1m')
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
  const availablePeriods = availableSummaryPeriods(firstWorkout.data, today, query.data)
  useEffect(() => {
    if (!availablePeriods.includes(period)) setPeriod('1m')
  }, [availablePeriods, period])
  const summary = summaryPeriodMatch(query.data ?? [], period, today)
  const range = summaryPeriodRange(period, today)
  const generate = useMutation({
    mutationFn: () => trainingSummariesRepository.generate(
      clientId,
      range.start,
      range.end,
      Boolean(summary),
    ),
    onSuccess: async () => queryClient.invalidateQueries({
      queryKey: ['training-summaries', 'trainer', clientId],
    }),
  })

  return <section className="ai-progress-card" aria-label="ИИ-анализ тренировок" aria-busy={loading}>
    <SummaryHeader published={summary?.published} />
    {ready && <PeriodTabs value={period} available={availablePeriods} onChange={setPeriod} />}
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
      <span>{summary ? `Обновлено ${new Date(summary.generatedAt).toLocaleString('ru-RU', { timeZone })}` : 'Данные клиента не отправляются без действия тренера'}</span>
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

function TrainerSummaryContent({ summary, clientId, onChanged }: {
  summary: TrainingSummary
  clientId: string
  onChanged: () => Promise<unknown>
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  return <>
    <SummaryCore
      headline={summary.trainer.headline}
      metrics={summary.metrics}
      progress={summary.trainer.progress}
      consistency={summary.trainer.consistency}
    />
    {summary.trainer.attention.length > 0 && <div className="ai-progress-attention">
      <span aria-hidden="true">!</span>
      <div>
        <strong>На что обратить внимание</strong>
        {summary.trainer.attention.map((point) => <p key={point}>{formatSummaryText(point)}</p>)}
      </div>
    </div>}
    <div className="client-copy-toggle">
      <button type="button" className="link" onClick={() => setPreviewOpen((value) => !value)}>
        {previewOpen ? 'Скрыть версию для клиента' : 'Проверить версию для клиента'}
      </button>
    </div>
    {previewOpen && <ClientCopyEditor
      summary={summary}
      clientId={clientId}
      onChanged={onChanged}
    />}
  </>
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
    <div className="client-copy-heading">
      <div><strong>Версия для клиента</strong><p>Внутренние замечания сюда не попадут</p></div>
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

export function ClientTrainingSummaryCard({ clientId, profileGoal }: { clientId: string; profileGoal?: string | null }) {
  const { actor } = useAuth()
  const today = todayInTimeZone(actor?.timezone)
  const timeZone = normalizeTimeZone(actor?.timezone)
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState<SummaryPeriod>('1m')
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
  const availablePeriods = availableSummaryPeriods(firstWorkout.data, today, query.data)
  useEffect(() => {
    if (!availablePeriods.includes(period)) setPeriod('1m')
  }, [availablePeriods, period])
  const summary = summaryPeriodMatch(query.data ?? [], period, today)
  const goal = useQuery({
    queryKey: ['client-goal', clientId],
    queryFn: () => goalsRepository.get(clientId),
  })
  const generate = useMutation({
    mutationFn: () => {
      const range = summaryPeriodRange(period, today)
      return trainingSummariesRepository.generate(clientId, range.start, range.end, true)
    },
    onSuccess: async () => queryClient.invalidateQueries({
      queryKey: ['training-summaries', 'client', clientId],
    }),
  })

  return <section className="ai-progress-card client-progress-card" aria-label="Прогресс тренировок" aria-busy={loading}>
    <SummaryHeader client />
    {ready && <PeriodTabs value={period} available={availablePeriods} onChange={setPeriod} />}
    <AsyncView
      loading={loading}
      error={loadError}
      onRetry={() => void Promise.all([query.refetch(), firstWorkout.refetch()])}
    >
      {summary ? <ClientSummaryContent
        summary={summary}
        goal={goal.data}
        profileGoal={profileGoal}
        today={today}
        goalLoading={goal.isLoading}
        goalError={goal.error}
        onGoalRetry={() => void goal.refetch()}
      /> : <div className="ai-progress-empty">
        <strong>Анализ за этот период ещё не создан</strong>
        <p>Создай его по завершённым тренировкам.</p>
      </div>}
    </AsyncView>
    {ready && <footer className="ai-progress-footer">
      <span>{summary ? `Сводка сформирована ${new Date(summary.publishedAt).toLocaleDateString('ru-RU', { timeZone })}` : 'Можно запросить первый анализ'}</span>
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

function ClientSummaryContent({ summary, goal, profileGoal, today, goalLoading, goalError, onGoalRetry }: {
  summary: PublishedTrainingSummary
  goal: ClientGoal | null | undefined
  profileGoal?: string | null
  today: LocalDate
  goalLoading: boolean
  goalError: Error | null
  onGoalRetry: () => void
}) {
  return <>
    <SummaryCore
      headline={summary.summary.headline}
      metrics={summary.metrics}
      progress={summary.summary.achievements}
      consistency={summary.summary.consistency}
    />
    <ClientProgressGoalSection
      goal={goal}
      profileGoal={profileGoal}
      today={today}
      loading={goalLoading}
      error={goalError}
      alignment={summary.summary.goalAlignment}
      onRetry={onGoalRetry}
    />
    {summary.summary.nextSteps && summary.summary.nextSteps.length > 0 && <div className="ai-progress-section ai-progress-next-steps">
      <h3>Что делать дальше</h3>
      <ul>{summary.summary.nextSteps.map((point) => <li key={point}>{formatSummaryText(point)}</li>)}</ul>
    </div>}
    <div className="client-encouragement"><span aria-hidden="true">✦</span><p>{formatSummaryText(summary.summary.encouragement)}</p></div>
  </>
}
