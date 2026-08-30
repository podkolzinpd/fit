import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
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
  TrainingProgressFact,
} from '../../shared/domain'
import { CloseIcon } from '../../shared/icons'
import { addDays, daysBetween, formatLocalDate, normalizeTimeZone, todayInTimeZone, type LocalDate } from '../../shared/local-date'
import { AsyncView, Field } from '../../shared/ui'
import { trackGoal } from '../../shared/yandex-metrika'
import { TrainingBodyProgressMap } from './ClientBodyProgressMap'
import { progressStoryPresentation } from './client-progress-presentation'
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

function SummaryHeader({ published }: { published?: boolean }) {
  return <header className="ai-progress-header">
    <div className="ai-progress-title">
      <div>
        <h2>Период</h2>
        <p>По завершённым тренировкам</p>
      </div>
    </div>
    {published !== undefined && <span className={`ai-progress-demo${published ? ' published' : ''}`}>
      {published ? 'Доступно клиенту' : 'Только тренеру'}
    </span>}
  </header>
}

export function TrainerTrainingSummaryCard({ clientId, profileGoal, gender = null }: {
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
    queryKey: ['trainer-progress-story-workouts', clientId, storyRange.start, storyRange.end],
    queryFn: () => workoutsRepository.list(storyRange.start, storyRange.end, clientId),
    enabled: ready && Boolean(summary),
  })
  const measurements = useQuery({
    queryKey: ['trainer-progress-story-measurements', clientId],
    queryFn: () => progressRepository.list(clientId),
    enabled: ready && Boolean(summary),
  })
  const goal = useQuery({
    queryKey: ['client-goal', clientId],
    queryFn: () => goalsRepository.get(clientId),
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
  const currentWorkouts = workouts.data?.filter((workout) =>
    workout.workoutDate >= workoutRange.start && workout.workoutDate <= workoutRange.end)
  const previousWorkouts = previousRange ? workouts.data?.filter((workout) =>
    workout.workoutDate >= previousRange.start && workout.workoutDate <= previousRange.end) : undefined
  const upcomingWorkouts = workouts.data?.filter((workout) =>
    workout.workoutDate >= today && workout.workoutDate <= storyRange.end)

  return <section className="ai-progress-card client-progress-card progress-story-card trainer-progress-story-card" aria-label="ИИ-анализ тренировок" aria-busy={loading}>
    <section className="progress-story-period" aria-labelledby="trainer-progress-period-title">
      <SummaryHeader published={summary?.published} />
      <span className="sr-only" id="trainer-progress-period-title">Период анализа прогресса</span>
      {ready && <PeriodTabs value={period} available={availablePeriods} onChange={changePeriod} />}
    </section>
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
            today={today}
            goal={goal.data}
            profileGoal={profileGoal}
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

function TrainerSummaryContent({ summary, clientId, gender, today, goal, profileGoal, goalLoading, goalError, onGoalRetry, currentWorkouts, previousWorkouts, upcomingWorkouts, measurements, workoutsLoading, workoutsError, onWorkoutsRetry, onChanged }: {
  summary: TrainingSummary
  clientId: string
  gender: Gender | null
  today: LocalDate
  goal: ClientGoal | null | undefined
  profileGoal?: string | null
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
  onChanged: () => Promise<unknown>
}) {
  const [clientCopyOpen, setClientCopyOpen] = useState(false)
  return <>
    <ProgressStoryContent
      summary={summary}
      clientId={clientId}
      role="trainer"
      gender={gender}
      today={today}
      goal={goal}
      profileGoal={profileGoal}
      goalLoading={goalLoading}
      goalError={goalError}
      onGoalRetry={onGoalRetry}
      currentWorkouts={currentWorkouts}
      previousWorkouts={previousWorkouts}
      upcomingWorkouts={upcomingWorkouts}
      measurements={measurements}
      workoutsLoading={workoutsLoading}
      workoutsError={workoutsError}
      onWorkoutsRetry={onWorkoutsRetry}
    />
    <div className="client-copy-toggle">
      <button type="button" className="link" onClick={() => setClientCopyOpen(true)}>Версия для спортсмена</button>
    </div>
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

type ProgressStorySummary = TrainingSummary | PublishedTrainingSummary

function summaryFallbackProgress(summary: ProgressStorySummary): readonly string[] {
  return 'summary' in summary ? summary.summary.achievements : summary.trainer.progress
}

function summaryConsistency(summary: ProgressStorySummary): string {
  return 'summary' in summary ? summary.summary.consistency : summary.trainer.consistency
}

function ProgressStoryContent({ summary, clientId, role, gender, today, goal, profileGoal, goalLoading, goalError, onGoalRetry, currentWorkouts, previousWorkouts, upcomingWorkouts, measurements, workoutsLoading, workoutsError, onWorkoutsRetry }: {
  summary: ProgressStorySummary
  clientId: string
  role: 'client' | 'trainer'
  gender: Gender | null
  today: LocalDate
  goal: ClientGoal | null | undefined
  profileGoal?: string | null
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
  const [goalCriteriaOpen, setGoalCriteriaOpen] = useState(false)
  const personalRecordWorkout = [...(currentWorkouts ?? [])]
    .filter((workout) => workout.status === 'done' && workout.hasPr)
    .sort((left, right) => right.workoutDate.localeCompare(left.workoutDate))[0]
  const personalRecords = useQuery({
    queryKey: ['workout-personal-records', personalRecordWorkout?.id],
    queryFn: () => workoutsRepository.personalRecords(personalRecordWorkout!.id),
    enabled: Boolean(personalRecordWorkout),
  })
  const presentation = progressStoryPresentation(summary, {
    currentWorkouts,
    previousWorkouts,
    upcomingWorkouts,
    measurements,
    goal,
    profileGoal,
    today,
    role,
    personalRecords: personalRecords.data ?? [],
    personalRecordWorkout,
  })
  const heroIsMain = Boolean(presentation.hero && presentation.mainNow.subject === presentation.hero.exerciseName)
  const visibleStats = presentation.mainNow.kind === 'exercise'
    ? presentation.stats.filter((stat) => !stat.label.includes('улучш'))
    : presentation.stats
  const wins = presentation.wins
    .filter((item) => item.title !== presentation.hero?.exerciseName && item.title !== presentation.mainNow.subject)
    .slice(0, 2)
  const goalLink = role === 'client' ? '/me/goal' : `/clients/${clientId}/goal`
  const measurementLink = role === 'client' ? '/me/progress#measurements' : `/progress/${clientId}?view=measurements`
  const workoutLink = role === 'client' ? '/workouts/new' : `/workouts/new?client=${clientId}`
  const mainNowLink = presentation.mainNow.action === 'goal'
    ? goalLink
    : presentation.mainNow.action === 'measurement'
      ? measurementLink
      : presentation.mainNow.action === 'workout'
        ? workoutLink
        : null
  const mainNowActionLabel = presentation.mainNow.action === 'goal'
    ? 'Настроить цель'
    : presentation.mainNow.action === 'measurement'
      ? 'Добавить замер'
      : presentation.mainNow.action === 'workout'
        ? 'Запланировать тренировку'
        : null
  const attention = role === 'trainer' && 'trainer' in summary ? summary.trainer.attention : []
  const goalCriteria = presentation.goal?.criteria ?? []
  const visibleGoalCriteria = goalCriteriaOpen ? goalCriteria : goalCriteria.slice(0, 1)

  return <>
    <section
      className="client-progress-main-now"
      aria-labelledby={`${role}-progress-main-now-title`}
      data-fact-id={presentation.mainNow.factId}
      data-copy-source={presentation.mainNow.source}
    >
      <span>Главное сейчас</span>
      <h3 id={`${role}-progress-main-now-title`}>{presentation.mainNow.title}</h3>
      <p>{presentation.mainNow.explanation}</p>
      <strong>{presentation.mainNow.evidence}</strong>
      {mainNowLink && mainNowActionLabel && <Link className="link" to={mainNowLink}>{mainNowActionLabel}</Link>}
    </section>
    <section className={`progress-story-summary${heroIsMain ? ' main-fact-removed' : ''}`} aria-label="Результаты периода">
      {!heroIsMain && <div className={`progress-story-hero${presentation.hero ? '' : ' empty'}`}>
        <span>{presentation.hero ? 'Лучший результат периода' : 'Результаты периода'}</span>
        {presentation.hero
          ? <><strong>{presentation.hero.value}</strong><h3>{presentation.hero.exerciseName}</h3><p>{presentation.hero.detail}</p></>
          : <><h3>Собираем сопоставимые результаты</h3><p>Первые изменения появятся после повторного выполнения упражнений.</p></>}
      </div>}
      <div className={`ai-progress-stats count-${visibleStats.length}`}>
        {visibleStats.map((stat) => <div key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></div>)}
      </div>
    </section>
    <TrainingBodyProgressMap
      summary={summary}
      workouts={currentWorkouts ?? []}
      clientId={clientId}
      clientGender={gender}
      loadLoading={workoutsLoading}
      loadError={workoutsError}
      onLoadRetry={onWorkoutsRetry}
    />
    {wins.length > 0 && <section className="client-progress-wins" aria-labelledby={`${role}-progress-wins-title`}>
      <h3 id={`${role}-progress-wins-title`}>{role === 'client' ? 'Твои достижения' : 'Ключевые изменения'}</h3>
      <div>{wins.map((item) => <article key={item.title}><span aria-hidden="true" /><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}</div>
    </section>}
    <section className="client-progress-comparison" aria-labelledby={`${role}-progress-comparison-title`}>
      <h3 id={`${role}-progress-comparison-title`}>{presentation.comparison.title}</h3>
      {presentation.comparison.items.length > 0
        ? <div>{presentation.comparison.items.map((item) => <article key={item.label} className={item.tone}>
          <strong>{item.value}</strong><span>{item.label}</span>
        </article>)}</div>
        : <p>{presentation.comparison.emptyMessage}</p>}
    </section>
    {goalLoading && <section className="client-progress-story-state" role="status">Проверяем данные цели…</section>}
    {goalError && <section className="client-progress-story-state" role="alert">Не удалось загрузить цель. <button type="button" className="link" onClick={onGoalRetry}>Повторить</button></section>}
    {!goalLoading && !goalError && presentation.goal && <section className="client-progress-goal-story" aria-labelledby={`${role}-progress-goal-title`}>
      <div className="client-progress-goal-story-head"><span>{role === 'client' ? 'Для твоей цели' : 'Цель клиента'}</span>
        <div className="goal-story-actions"><strong className={`goal-foundation-status ${presentation.goal.state}`}>{presentation.goal.statusLabel}</strong><Link className="link" to={goalLink}>Изменить цель</Link></div></div>
      <h3 id={`${role}-progress-goal-title`}>{presentation.goal.title}</h3>
      {goalCriteria.length > 0 ? <><div className="goal-criteria-progress-list">{visibleGoalCriteria.map((criterion) => <article key={criterion.id} className="goal-criterion-progress-row">
        <header><strong>{criterion.label}</strong>{(presentation.goal?.totalCriteria ?? 0) > 1 ? <span>{criterion.status}</span> : null}</header>
        <dl><div><dt>Ориентир</dt><dd>{criterion.target}</dd></div><div><dt>Сейчас</dt><dd>{criterion.current}</dd></div><div><dt>Динамика</dt><dd>{criterion.dynamics}</dd></div><div><dt>Данные</dt><dd>{criterion.lastDate ? `${criterion.lastDate} · ` : ''}{criterion.freshness} · {criterion.sufficiency}</dd></div></dl>
        {criterion.action === 'measurement' && <Link className="link" to={measurementLink}>Добавить актуальный замер</Link>}
        {criterion.action === 'workout' && <Link className="link" to={workoutLink}>Записать тренировку</Link>}
      </article>)}</div>{goalCriteria.length > 1 && <button
        type="button"
        className="link goal-criteria-toggle"
        aria-expanded={goalCriteriaOpen}
        onClick={() => setGoalCriteriaOpen((open) => !open)}
      >{goalCriteriaOpen ? 'Показать только основной критерий' : `Показать все критерии · ${goalCriteria.length}`}</button>}</> : presentation.goal.criterionLabel && <dl className="goal-foundation-facts">
        <div><dt>Критерий</dt><dd>{presentation.goal.criterionLabel}</dd></div>
        <div><dt>Ориентир</dt><dd>{presentation.goal.targetLabel}</dd></div>
        {presentation.goal.currentLabel && <div><dt>Сейчас</dt><dd>{presentation.goal.currentLabel}</dd></div>}
        {presentation.goal.periodEndLabel && <div><dt>На конец периода</dt><dd>{presentation.goal.periodEndLabel}</dd></div>}
        {presentation.goal.baselineLabel && <div><dt>Отправная точка</dt><dd>{presentation.goal.baselineLabel}</dd></div>}
      </dl>}
      {presentation.goal.state === 'unconfigured' && <><p>Цель сохранена как текст. Автоматическая оценка не настроена.</p><Link className="link" to={goalLink}>Настроить оценку</Link></>}
      {presentation.goal.state === 'needs_review' && <><p>Формулировка цели изменилась. Проверь, подходит ли сохранённый критерий.</p><Link className="link" to={goalLink}>Проверить критерий</Link></>}
      {presentation.goal.state === 'needs_data' && <><p>Нет ни одного замера выбранного показателя.</p><Link className="link" to={measurementLink}>Добавить замер</Link></>}
      {presentation.goal.state === 'configured' && <>
        <p>{presentation.goal.message}</p>
      </>}
    </section>}
    {!goalLoading && !goalError && !presentation.goal && <section className="client-progress-goal-story empty" aria-labelledby={`${role}-progress-goal-title`}>
      <span>{role === 'client' ? 'Для твоей цели' : 'Цель клиента'}</span>
      <h3 id={`${role}-progress-goal-title`}>Цель пока не указана</h3>
      <p>{role === 'client' ? 'Добавь ориентир — тогда результаты можно будет оценивать в его контексте.' : 'Добавьте ориентир, чтобы оценивать результаты в контексте задачи клиента.'}</p>
      <Link className="link" to={goalLink}>{role === 'client' ? 'Добавить цель' : 'Указать цель'}</Link>
    </section>}
    {presentation.mainNow.kind !== 'plan' && <section className="client-progress-upcoming" aria-labelledby={`${role}-progress-upcoming-title`}>
      <span>Следующий шаг</span>
      {presentation.nextWorkout
        ? <><h3 id={`${role}-progress-upcoming-title`}>{presentation.nextWorkout.date}</h3>
          {presentation.nextWorkout.title !== 'Ближайшая тренировка' && <p>{presentation.nextWorkout.title}</p>}
          <div>{presentation.nextWorkout.exercises.map((exercise) => <article key={exercise.name}>
            <strong>{exercise.name}</strong>{exercise.plan && <span>{exercise.plan}</span>}
          </article>)}</div></>
        : <><h3 id={`${role}-progress-upcoming-title`}>Ближайшая тренировка не запланирована</h3>
          <Link className="link" to={workoutLink}>Запланировать тренировку</Link></>}
    </section>}
    {attention.length > 0 && <section className="progress-story-attention" aria-label="На что обратить внимание">
      <span aria-hidden="true">!</span><div><strong>На что обратить внимание</strong><p>{formatSummaryText(attention[0]!)}</p></div>
    </section>}
    <div className="client-progress-details-toggle">
      <button type="button" className="link" onClick={() => setDetailsOpen(true)}>Подробный анализ</button>
    </div>
    {detailsOpen && <SummarySheet title="Подробный анализ" onClose={() => setDetailsOpen(false)}>
      <section className="client-progress-details-section">
        <h3>Динамика упражнений</h3>
        <ProgressFacts facts={summary.metrics.progressFacts} fallback={summaryFallbackProgress(summary)} />
      </section>
      <section className="client-progress-details-section">
        <h3>Ритм тренировок</h3>
        <p>{formatSummaryText(summaryConsistency(summary))}</p>
        <p>
          В среднем: {formatWorkoutsPerWeek(summary.metrics.workoutsPerWeek)} тренировки в неделю
          {summary.metrics.longestGapDays !== null && <> · самая длинная пауза: {summary.metrics.longestGapDays} {progressMetricNoun(summary.metrics.longestGapDays, 'gapDay')}</>}
        </p>
      </section>
      {presentation.orientations.length > 0 && <section className="client-progress-details-section">
        <h3>Ориентиры</h3>
        <ul>{presentation.orientations.map((point) => <li key={point}>{formatSummaryText(point)}</li>)}</ul>
      </section>}
      {attention.length > 0 && <section className="client-progress-details-section">
        <h3>Сигналы тренеру</h3>
        <ul>{attention.map((point) => <li key={point}>{formatSummaryText(point)}</li>)}</ul>
      </section>}
    </SummarySheet>}
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
      <button className="primary" disabled={publish.isPending || unpublish.isPending}>
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

  return <section className="ai-progress-card client-progress-card progress-story-card" aria-label="Прогресс тренировок" aria-busy={loading}>
    <section className="progress-story-period" aria-labelledby="client-progress-period-title">
      <SummaryHeader />
      <span className="sr-only" id="client-progress-period-title">Период прогресса</span>
      {ready && <PeriodTabs value={period} available={availablePeriods} onChange={changePeriod} />}
    </section>
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
  return <ProgressStoryContent
      summary={summary}
      clientId={summary.clientId}
      role="client"
      gender={gender}
      today={today}
      goal={goal}
      profileGoal={profileGoal}
      goalLoading={goalLoading}
      goalError={goalError}
      onGoalRetry={onGoalRetry}
      currentWorkouts={currentWorkouts}
      previousWorkouts={previousWorkouts}
      upcomingWorkouts={upcomingWorkouts}
      measurements={measurements}
      workoutsLoading={workoutsLoading}
      workoutsError={workoutsError}
      onWorkoutsRetry={onWorkoutsRetry}
    />
}
