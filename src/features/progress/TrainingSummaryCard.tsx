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
  CustomMetric,
  Gender,
  PublishedTrainingSummary,
  TrainingSummary,
} from '../../shared/domain'
import { CloseIcon } from '../../shared/icons'
import { addDays, daysBetween, todayInTimeZone, type LocalDate } from '../../shared/local-date'
import { AsyncView, Field } from '../../shared/ui'
import { trackGoal } from '../../shared/yandex-metrika'
import { TrainingBodyProgressMap } from './ClientBodyProgressMap'
import { MeasurementProgressSection } from './MeasurementProgressSection'
import { ProgressDetailedAnalysis } from './ProgressDetailedAnalysis'
import { ProgressNextStepSection } from './ProgressNextStepSection'
import { TrainerProgressSignalsSection } from './TrainerProgressSignalsSection'
import { WorkoutRegularityProgressSection } from './WorkoutRegularityProgressSection'
import { progressStoryPresentation } from './client-progress-presentation'
import { buildProgressNextStep } from './next-step-recommendation'
import { buildProgressDetailedAnalysis } from './progress-detailed-analysis'
import { formatSummaryText } from './summary-format'
import { availableSummaryPeriods, SUMMARY_PERIODS, summaryPeriodMatch, summaryPeriodRange, type SummaryPeriod } from './summary-period'
import { buildTrainerProgressSignals } from './trainer-progress-signals'
import { buildWorkoutRegularityProgress } from './workout-regularity-progress'

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
    ><span>{period.label}</span></button>)}
  </div>
}

function SummaryHeader({ published }: { published?: boolean }) {
  return <header className="ai-progress-header">
    <div className="ai-progress-title">
      <div>
        <h2>Период</h2>
      </div>
    </div>
    {published !== undefined && <span className={`ai-progress-demo${published ? ' published' : ''}`}>
      {published ? 'Доступно клиенту' : 'Только тренеру'}
    </span>}
  </header>
}

function AutomaticSummaryError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return <p className="ai-progress-auto-error" role="alert">
    <span>{error.message}</span>
    <button type="button" className="link" onClick={onRetry}>Повторить</button>
  </p>
}

export function TrainerTrainingSummaryCard({ clientId, profileGoal, gender = null }: {
  clientId: string
  profileGoal?: string | null
  gender?: Gender | null
}) {
  const { actor } = useAuth()
  const today = todayInTimeZone(actor?.timezone)
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
  const customMetrics = useQuery({
    queryKey: ['progress-metrics', clientId],
    queryFn: () => progressRepository.listMetrics(clientId),
    enabled: ready && Boolean(summary),
  })
  const goal = useQuery({
    queryKey: ['client-goal', clientId],
    queryFn: () => goalsRepository.get(clientId),
  })
  const automaticGeneration = useQuery({
    queryKey: ['training-summary-generation', 'trainer', clientId, range.start, range.end],
    queryFn: async () => {
      const generation = await trainingSummariesRepository.generate(
        clientId,
        range.start,
        range.end,
        false,
      )
      const summaries = await trainingSummariesRepository.listForTrainer(clientId)
      return { generation, summaries }
    },
    enabled: ready && firstWorkout.data !== null,
  })
  useEffect(() => {
    if (automaticGeneration.data) {
      queryClient.setQueryData(
        ['training-summaries', 'trainer', clientId],
        automaticGeneration.data.summaries,
      )
    }
  }, [automaticGeneration.data, clientId, queryClient])
  const changePeriod = (nextPeriod: SummaryPeriod) => {
    setPeriod(nextPeriod)
  }
  const currentWorkouts = workouts.data?.filter((workout) =>
    workout.workoutDate >= workoutRange.start && workout.workoutDate <= workoutRange.end)
  const previousWorkouts = previousRange ? workouts.data?.filter((workout) =>
    workout.workoutDate >= previousRange.start && workout.workoutDate <= previousRange.end) : undefined
  const upcomingWorkouts = workouts.data?.filter((workout) =>
    workout.workoutDate >= today && workout.workoutDate <= storyRange.end)

  return <section className="ai-progress-card client-progress-card progress-story-card trainer-progress-story-card" aria-label="ИИ-анализ тренировок" aria-busy={loading || (!summary && automaticGeneration.isFetching)}>
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
            customMetrics={customMetrics.data ?? []}
            measurementsLoading={measurements.isLoading || customMetrics.isLoading}
            measurementsError={measurements.error ?? customMetrics.error}
            onMeasurementsRetry={() => void Promise.all([measurements.refetch(), customMetrics.refetch()])}
            workoutsLoading={workouts.isLoading}
            workoutsError={workouts.error}
            onWorkoutsRetry={() => void workouts.refetch()}
            onChanged={() => queryClient.invalidateQueries({
              queryKey: ['training-summaries', 'trainer', clientId],
            })}
          />
        : automaticGeneration.isFetching
          ? <div className="ai-progress-empty" role="status"><strong>Обновляем прогресс…</strong></div>
          : !automaticGeneration.error && <div className="ai-progress-empty"><strong>Пока нет анализа за этот период</strong></div>}
    </AsyncView>
    {automaticGeneration.error && <AutomaticSummaryError
      error={automaticGeneration.error}
      onRetry={() => {
        trackGoal(summary ? 'refresh_training_summary_retry' : 'create_training_summary_retry')
        void automaticGeneration.refetch()
      }}
    />}
  </section>
}

function TrainerSummaryContent({ summary, clientId, gender, today, goal, profileGoal, goalLoading, goalError, onGoalRetry, currentWorkouts, previousWorkouts, upcomingWorkouts, measurements, customMetrics, measurementsLoading, measurementsError, onMeasurementsRetry, workoutsLoading, workoutsError, onWorkoutsRetry, onChanged }: {
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
  customMetrics: CustomMetric[]
  measurementsLoading: boolean
  measurementsError: Error | null
  onMeasurementsRetry: () => void
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
      customMetrics={customMetrics}
      measurementsLoading={measurementsLoading}
      measurementsError={measurementsError}
      onMeasurementsRetry={onMeasurementsRetry}
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

function summaryNextSteps(summary: ProgressStorySummary): readonly string[] {
  return ('summary' in summary ? summary.summary.nextSteps : summary.client.nextSteps) ?? []
}

function measurementCopyCandidates(summary: ProgressStorySummary, role: 'client' | 'trainer'): string[] {
  if ('summary' in summary) {
    return [summary.summary.headline, ...summary.summary.achievements, summary.summary.goalAlignment ?? '']
  }
  return role === 'trainer'
    ? [summary.trainer.headline, ...summary.trainer.progress, summary.trainer.consistency]
    : [summary.client.headline, ...summary.client.achievements, summary.client.goalAlignment ?? '']
}

function russianCount(value: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(value) % 100
  const mod10 = Math.abs(value) % 10
  if (mod100 >= 11 && mod100 <= 14) return `${value} ${many}`
  if (mod10 === 1) return `${value} ${one}`
  if (mod10 >= 2 && mod10 <= 4) return `${value} ${few}`
  return `${value} ${many}`
}

function goalAwareMainTitle(title: string, role: 'client' | 'trainer'): string {
  if (title === 'Есть движение к ориентиру цели') {
    return role === 'client' ? 'Ты приближаешься к цели' : 'Клиент приближается к цели'
  }
  if (title === 'Текущий результат соответствует ориентиру') return 'Ориентир цели достигнут'
  return title
}

function ProgressStoryContent({ summary, clientId, role, gender, today, goal, profileGoal, goalLoading, goalError, onGoalRetry, currentWorkouts, previousWorkouts, upcomingWorkouts, measurements, customMetrics, measurementsLoading, measurementsError, onMeasurementsRetry, measurementManagement, workoutsLoading, workoutsError, onWorkoutsRetry }: {
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
  customMetrics: CustomMetric[]
  measurementsLoading: boolean
  measurementsError: Error | null
  onMeasurementsRetry: () => void
  measurementManagement?: ReactNode
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
  const goalCriteria = presentation.goal?.criteria ?? []
  const visibleGoalCriteria = goalCriteriaOpen ? goalCriteria : goalCriteria.slice(0, 2)
  const hiddenGoalCriteria = Math.max(0, goalCriteria.length - visibleGoalCriteria.length)
  const primaryGoalCriterion = goalCriteria[0]
  const mainTitle = goalAwareMainTitle(presentation.mainNow.title, role)
  const mainExplanation = presentation.mainNow.kind === 'goal' && primaryGoalCriterion
    ? primaryGoalCriterion.dynamics.replace('ориентиру', 'цели')
    : presentation.mainNow.explanation
  const mainEvidence = presentation.mainNow.kind === 'goal'
    ? null
    : presentation.mainNow.evidence
  const goalHandlesMainAction = presentation.mainNow.action === 'goal'
    || (presentation.mainNow.action === 'measurement' && goalCriteria.some((criterion) => criterion.action === 'measurement'))
  const visibleComparisonFacts = presentation.comparison.facts.slice(0, 3)
  const comparisonLimitation = presentation.comparison.conclusions.find((conclusion) => conclusion.kind === 'limitation')
  const periodDays = daysBetween(summary.periodStart, summary.periodEnd) + 1
  const previousPeriodStart = addDays(summary.periodStart, -periodDays)
  const previousPeriodEnd = addDays(summary.periodStart, -1)
  const regularity = buildWorkoutRegularityProgress({
    currentWorkouts: currentWorkouts ?? [],
    previousWorkouts,
    periodStart: summary.periodStart,
    periodEnd: summary.periodEnd,
    previousPeriodStart,
    previousPeriodEnd,
    today,
  })
  const nextStep = buildProgressNextStep({
    goal: presentation.goal,
    nextWorkout: presentation.nextWorkout,
    completedWorkouts: regularity.completedWorkouts,
    activeWeeks: regularity.activeWeeks,
    totalWeeks: Math.max(1, regularity.elapsedWeeks),
    llmSuggestions: summaryNextSteps(summary),
    role,
  })
  const trainerSignals = role === 'trainer' ? buildTrainerProgressSignals({
    goal: presentation.goal,
    regularity,
    currentWorkouts,
    summaryCompletedWorkouts: summary.metrics.completedWorkouts,
    today,
  }) : []
  const detailedAnalysis = buildProgressDetailedAnalysis({
    summary,
    role,
    goalTitle: presentation.goal?.title,
    visibleTexts: [
      presentation.mainNow.title,
      presentation.mainNow.explanation,
      presentation.mainNow.evidence,
      ...(presentation.hero ? [presentation.hero.exerciseName, presentation.hero.detail] : []),
      ...wins.flatMap((item) => [item.title, item.detail]),
      ...visibleComparisonFacts.flatMap((fact) => [fact.subject, fact.previousLabel, fact.currentLabel, fact.value]),
      ...presentation.comparison.conclusions.map((conclusion) => conclusion.text),
      ...(presentation.goal ? [
        presentation.goal.title,
        presentation.goal.statusLabel,
        presentation.goal.message ?? '',
        ...(presentation.goal.criteria ?? []).flatMap((criterion) => [
          criterion.label,
          criterion.target,
          criterion.current,
          criterion.dynamics,
          criterion.status,
        ]),
      ] : []),
      summaryConsistency(summary),
      nextStep.recommendation.title,
      nextStep.recommendation.explanation,
      nextStep.recommendation.evidence,
    ],
  })
  const nextStepLinks = {
    add_measurement: measurementLink,
    schedule_workout: workoutLink,
    continue_rhythm: role === 'client' ? '/me/workouts' : `/clients/${clientId}/workouts`,
    clarify_criterion: goalLink,
    check_metric: measurementLink,
    open_workout: (candidate: { targetId?: string }) => candidate.targetId ? `/workouts/${candidate.targetId}` : workoutLink,
  }
  const goalStory = <>
    {goalLoading && <section className="client-progress-story-state" role="status">Проверяем данные цели…</section>}
    {goalError && <section className="client-progress-story-state" role="alert">Не удалось загрузить цель. <button type="button" className="link" onClick={onGoalRetry}>Повторить</button></section>}
    {!goalLoading && !goalError && presentation.goal && <div className="client-progress-goal-story" aria-labelledby={`${role}-progress-goal-title`}>
      <div className="client-progress-goal-story-head"><span>{role === 'client' ? 'Для твоей цели' : 'Цель клиента'}</span>
        <div className="goal-story-actions"><strong className={`goal-foundation-status ${presentation.goal.state}`}>{goalCriteria.length > 1 ? russianCount(goalCriteria.length, 'показатель', 'показателя', 'показателей') : presentation.goal.statusLabel}</strong><Link className="link" to={goalLink}>Изменить цель</Link></div></div>
      <h3 id={`${role}-progress-goal-title`}>{presentation.goal.title}</h3>
      {goalCriteria.length > 0 ? <><div className="goal-criteria-progress-list">{visibleGoalCriteria.map((criterion) => <article key={criterion.id} className="goal-criterion-progress-row">
        <header><strong>{criterion.label}</strong>{(presentation.goal?.totalCriteria ?? 0) > 1 ? <span>{criterion.status}</span> : null}</header>
        <dl><div><dt>Сейчас</dt><dd>{criterion.current}</dd></div><div><dt>Ориентир</dt><dd>{criterion.target}</dd></div></dl>
        {criterion.action === 'measurement' && <Link className="link" to={measurementLink}>Добавить актуальный замер</Link>}
        {criterion.action === 'workout' && <Link className="link" to={workoutLink}>Записать тренировку</Link>}
      </article>)}</div>{goalCriteria.length > 2 && <button
        type="button"
        className="link goal-criteria-toggle"
        aria-expanded={goalCriteriaOpen}
        onClick={() => setGoalCriteriaOpen((open) => !open)}
      >{goalCriteriaOpen ? 'Скрыть дополнительные критерии' : `Ещё ${russianCount(hiddenGoalCriteria, 'критерий', 'критерия', 'критериев')}`}</button>}</> : presentation.goal.criterionLabel && <dl className="goal-foundation-facts">
        <div><dt>Критерий</dt><dd>{presentation.goal.criterionLabel}</dd></div>
        <div><dt>Ориентир</dt><dd>{presentation.goal.targetLabel}</dd></div>
        {presentation.goal.currentLabel && <div><dt>Сейчас</dt><dd>{presentation.goal.currentLabel}</dd></div>}
        {presentation.goal.periodEndLabel && <div><dt>На конец периода</dt><dd>{presentation.goal.periodEndLabel}</dd></div>}
        {presentation.goal.baselineLabel && <div><dt>Отправная точка</dt><dd>{presentation.goal.baselineLabel}</dd></div>}
      </dl>}
      {presentation.goal.state === 'unconfigured' && <Link className="link" to={goalLink}>Настроить оценку</Link>}
      {presentation.goal.state === 'needs_review' && <><p>Формулировка цели изменилась. Проверь, подходит ли сохранённый критерий.</p><Link className="link" to={goalLink}>Проверить критерий</Link></>}
      {presentation.goal.state === 'needs_data' && <><p>Нет ни одного замера выбранного показателя.</p><Link className="link" to={measurementLink}>Добавить замер</Link></>}
    </div>}
    {!goalLoading && !goalError && !presentation.goal && <div className="client-progress-goal-story empty" aria-labelledby={`${role}-progress-goal-title`}>
      <span>{role === 'client' ? 'Для твоей цели' : 'Цель клиента'}</span>
      <h3 id={`${role}-progress-goal-title`}>Цель пока не указана</h3>
      <p>{role === 'client' ? 'Добавь ориентир — тогда результаты можно будет оценивать в его контексте.' : 'Добавьте ориентир, чтобы оценивать результаты в контексте задачи клиента.'}</p>
      <Link className="link" to={goalLink}>{role === 'client' ? 'Добавить цель' : 'Указать цель'}</Link>
    </div>}
  </>

  return <>
    <section
      className="client-progress-overview"
      aria-labelledby={`${role}-progress-main-now-title`}
      data-fact-id={presentation.mainNow.factId}
      data-copy-source={presentation.mainNow.source}
    >
      <div className="client-progress-main-now">
        <div className="client-progress-main-now-head">
          <span>Главное сейчас</span>
          <button type="button" className="link client-progress-details-trigger" onClick={() => setDetailsOpen(true)}>Подробный анализ</button>
        </div>
        <h3 id={`${role}-progress-main-now-title`}>{mainTitle}</h3>
        <p>{mainExplanation}</p>
        {mainEvidence && <strong>{mainEvidence}</strong>}
        {!goalHandlesMainAction && mainNowLink && mainNowActionLabel && <Link className="link" to={mainNowLink}>{mainNowActionLabel}</Link>}
      </div>
      {goalStory}
    </section>
    {detailsOpen && <SummarySheet title="Подробный анализ" onClose={() => setDetailsOpen(false)}>
      <ProgressDetailedAnalysis sections={detailedAnalysis} />
    </SummarySheet>}
    <TrainingBodyProgressMap
      summary={summary}
      workouts={currentWorkouts ?? []}
      clientId={clientId}
      insightCandidates={summaryFallbackProgress(summary)}
      clientGender={gender}
      loadLoading={workoutsLoading}
      loadError={workoutsError}
      onLoadRetry={onWorkoutsRetry}
    />
    <section className="client-progress-comparison" aria-labelledby={`${role}-progress-comparison-title`}>
      <header>
        <div>
          <h3 id={`${role}-progress-comparison-title`}>{presentation.comparison.title}</h3>
          {visibleComparisonFacts.length > 0 && <p>{presentation.comparison.periodLabel}</p>}
        </div>
      </header>
      {workoutsLoading && currentWorkouts === undefined
        ? <p className="period-comparison-empty" role="status">Сравниваем периоды…</p>
        : visibleComparisonFacts.length > 0
        ? <>
          <dl className="period-comparison-facts">{visibleComparisonFacts.map((fact) => <div key={fact.factId} className={fact.tone} data-fact-id={fact.factId}>
            <dt>{fact.subject}<span>{fact.previousLabel} → {fact.currentLabel}</span></dt>
            <dd>{fact.value}</dd>
          </div>)}</dl>
          {comparisonLimitation && <p
            className="period-comparison-limitation"
            data-fact-ids={comparisonLimitation.factIds.join(',')}
            data-copy-source={comparisonLimitation.source}
          >{comparisonLimitation.text}</p>}
        </>
        : <p className="period-comparison-empty">{presentation.comparison.emptyMessage}</p>}
    </section>
    <MeasurementProgressSection
      clientId={clientId}
      entries={measurements}
      customMetrics={customMetrics}
      goal={goal}
      periodStart={summary.periodStart}
      periodEnd={summary.periodEnd}
      today={today}
      role={role}
      loading={measurementsLoading}
      error={measurementsError}
      onRetry={onMeasurementsRetry}
      llmCandidates={measurementCopyCandidates(summary, role)}
      management={measurementManagement}
    />
    <WorkoutRegularityProgressSection
      currentWorkouts={currentWorkouts}
      previousWorkouts={previousWorkouts}
      periodStart={summary.periodStart}
      periodEnd={summary.periodEnd}
      previousPeriodStart={previousPeriodStart}
      previousPeriodEnd={previousPeriodEnd}
      today={today}
      loading={workoutsLoading}
      error={workoutsError}
      onRetry={onWorkoutsRetry}
      llmCandidates={[summaryConsistency(summary)]}
    />
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
    {wins.length > 0 && <section className="client-progress-wins" aria-labelledby={`${role}-progress-wins-title`}>
      <h3 id={`${role}-progress-wins-title`}>{role === 'client' ? 'Твои достижения' : 'Ключевые изменения'}</h3>
      <div>{wins.map((item) => <article key={item.title}><span aria-hidden="true" /><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}</div>
    </section>}
    <ProgressNextStepSection
      result={nextStep}
      links={nextStepLinks}
      titleId={`${role}-progress-next-step-title`}
      loading={goalLoading || workoutsLoading || measurementsLoading}
      error={goalError ?? workoutsError ?? measurementsError}
      onRetry={() => {
        onGoalRetry()
        onWorkoutsRetry()
        onMeasurementsRetry()
      }}
    />
    {role === 'trainer' && <TrainerProgressSignalsSection
      signals={trainerSignals}
      loading={goalLoading || workoutsLoading || measurementsLoading}
      error={goalError ?? workoutsError ?? measurementsError}
      onRetry={() => {
        onGoalRetry()
        onWorkoutsRetry()
        onMeasurementsRetry()
      }}
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

export function ClientTrainingSummaryCard({ clientId, profileGoal, gender = null, measurementManagement }: {
  clientId: string
  profileGoal?: string | null
  gender?: Gender | null
  measurementManagement?: ReactNode
}) {
  const { actor } = useAuth()
  const today = todayInTimeZone(actor?.timezone)
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
    queryKey: ['client-progress-story-workouts', clientId, storyRange.start, storyRange.end],
    queryFn: () => workoutsRepository.list(storyRange.start, storyRange.end, clientId),
    enabled: ready && Boolean(summary),
  })
  const measurements = useQuery({
    queryKey: ['client-progress-story-measurements', clientId],
    queryFn: () => progressRepository.list(clientId),
    enabled: ready,
  })
  const customMetrics = useQuery({
    queryKey: ['progress-metrics', clientId],
    queryFn: () => progressRepository.listMetrics(clientId),
    enabled: ready,
  })
  const goal = useQuery({
    queryKey: ['client-goal', clientId],
    queryFn: () => goalsRepository.get(clientId),
  })
  const automaticGeneration = useQuery({
    queryKey: ['training-summary-generation', 'client', clientId, range.start, range.end],
    queryFn: async () => {
      const generation = await trainingSummariesRepository.generate(clientId, range.start, range.end, false)
      const summaries = await trainingSummariesRepository.listForClient(clientId)
      return { generation, summaries }
    },
    enabled: ready && firstWorkout.data !== null,
  })
  useEffect(() => {
    if (automaticGeneration.data) {
      queryClient.setQueryData(
        ['training-summaries', 'client', clientId],
        automaticGeneration.data.summaries,
      )
    }
  }, [automaticGeneration.data, clientId, queryClient])
  const changePeriod = (nextPeriod: SummaryPeriod) => {
    setPeriod(nextPeriod)
  }
  const currentWorkouts = workouts.data?.filter((workout) =>
    workout.workoutDate >= workoutRange.start && workout.workoutDate <= workoutRange.end)
  const previousWorkouts = previousRange ? workouts.data?.filter((workout) =>
    workout.workoutDate >= previousRange.start && workout.workoutDate <= previousRange.end) : undefined
  const upcomingWorkouts = workouts.data?.filter((workout) =>
    workout.workoutDate >= today && workout.workoutDate <= storyRange.end)

  return <section className="ai-progress-card client-progress-card progress-story-card" aria-label="Прогресс тренировок" aria-busy={loading || (!summary && automaticGeneration.isFetching)}>
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
          customMetrics={customMetrics.data ?? []}
          measurementsLoading={measurements.isLoading || customMetrics.isLoading}
          measurementsError={measurements.error ?? customMetrics.error}
          onMeasurementsRetry={() => void Promise.all([measurements.refetch(), customMetrics.refetch()])}
          measurementManagement={measurementManagement}
          workoutsLoading={workouts.isLoading}
          workoutsError={workouts.error}
          onWorkoutsRetry={() => void workouts.refetch()}
        /> : <>
          {automaticGeneration.isFetching
            ? <div className="ai-progress-empty" role="status"><strong>Обновляем прогресс…</strong></div>
            : !automaticGeneration.error && <div className="ai-progress-empty"><strong>Пока нет анализа за этот период</strong></div>}
          {measurementManagement && <MeasurementProgressSection
            clientId={clientId}
            entries={measurements.data ?? []}
            customMetrics={customMetrics.data ?? []}
            goal={goal.data}
            periodStart={workoutRange.start}
            periodEnd={workoutRange.end}
            today={today}
            role="client"
            loading={measurements.isLoading || customMetrics.isLoading}
            error={measurements.error ?? customMetrics.error}
            onRetry={() => void Promise.all([measurements.refetch(), customMetrics.refetch()])}
            management={measurementManagement}
          />}
        </>}
    </AsyncView>
    {automaticGeneration.error && <AutomaticSummaryError
      error={automaticGeneration.error}
      onRetry={() => void automaticGeneration.refetch()}
    />}
  </section>
}

function ClientSummaryContent({ summary, goal, profileGoal, gender, today, goalLoading, goalError, onGoalRetry, currentWorkouts, previousWorkouts, upcomingWorkouts, measurements, customMetrics, measurementsLoading, measurementsError, onMeasurementsRetry, measurementManagement, workoutsLoading, workoutsError, onWorkoutsRetry }: {
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
  customMetrics: CustomMetric[]
  measurementsLoading: boolean
  measurementsError: Error | null
  onMeasurementsRetry: () => void
  measurementManagement?: ReactNode
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
      customMetrics={customMetrics}
      measurementsLoading={measurementsLoading}
      measurementsError={measurementsError}
      onMeasurementsRetry={onMeasurementsRetry}
      measurementManagement={measurementManagement}
      workoutsLoading={workoutsLoading}
      workoutsError={workoutsError}
      onWorkoutsRetry={onWorkoutsRetry}
    />
}
