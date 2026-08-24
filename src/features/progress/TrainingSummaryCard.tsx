import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
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
import { CloseIcon } from '../../shared/icons'
import { formatLocalDate, normalizeTimeZone, todayInTimeZone, type LocalDate } from '../../shared/local-date'
import { AsyncView, Coachmark, Field } from '../../shared/ui'
import { trackGoal } from '../../shared/yandex-metrika'
import { ClientProgressGoalSection } from './ClientProgressGoalSection'
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

export function TrainerTrainingSummaryCard({ clientId }: { clientId: string }) {
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

function TrainerSummaryContent({ summary, clientId, onChanged }: {
  summary: TrainingSummary
  clientId: string
  onChanged: () => Promise<unknown>
}) {
  const [clientCopyOpen, setClientCopyOpen] = useState(false)
  const [progressOpen, setProgressOpen] = useState(false)
  const [attentionOpen, setAttentionOpen] = useState(false)
  const hiddenAttentionCount = Math.max(0, summary.trainer.attention.length - 1)
  return <>
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

export function ClientTrainingSummaryCard({ clientId, profileGoal }: { clientId: string; profileGoal?: string | null }) {
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
          userId={actor?.userId}
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

function ClientSummaryContent({ summary, userId, goal, profileGoal, today, goalLoading, goalError, onGoalRetry }: {
  summary: PublishedTrainingSummary
  userId: string | undefined
  goal: ClientGoal | null | undefined
  profileGoal?: string | null
  today: LocalDate
  goalLoading: boolean
  goalError: Error | null
  onGoalRetry: () => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const presentation = clientProgressPresentation(summary)
  return <>
    <Coachmark
      id="client-progress-results-2026-08"
      userId={userId}
      title="Главное — сразу"
      description="Сначала показываем лучший результат и следующий ориентир, а подробности открываются отдельно."
    ><div className="client-progress-hero">
        <span>{presentation.hero.eyebrow}</span>
        {presentation.hero.value && <strong>{presentation.hero.value}</strong>}
        <h3>{presentation.hero.title}</h3>
        <p>{presentation.hero.detail}</p>
      </div></Coachmark>
    <div className={`ai-progress-stats count-${presentation.stats.length}`}>
      {presentation.stats.map((stat) => <div key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></div>)}
    </div>
    {presentation.wins.length > 0 && <section className="client-progress-wins" aria-labelledby="client-progress-wins-title">
      <h3 id="client-progress-wins-title">Твои достижения</h3>
      <div>{presentation.wins.map((win) => <article key={win.title}><span aria-hidden="true" /><div><strong>{win.title}</strong><p>{win.detail}</p></div></article>)}</div>
    </section>}
    <ClientProgressGoalSection
      goal={goal}
      profileGoal={profileGoal}
      today={today}
      loading={goalLoading}
      error={goalError}
      alignment={summary.summary.goalAlignment}
      onRetry={onGoalRetry}
    />
    {presentation.nextStep && <section className="client-progress-next" aria-labelledby="client-progress-next-title">
      <span>Следующий ориентир</span>
      <h3 id="client-progress-next-title">На следующей тренировке</h3>
      <p>{formatSummaryText(presentation.nextStep)}</p>
    </section>}
    {presentation.insight && <section className="client-progress-insight" aria-labelledby="client-progress-insight-title">
      <h3 id="client-progress-insight-title">Главное сейчас</h3>
      <p>{presentation.insight}</p>
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
