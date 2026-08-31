import type { Workout } from '../../shared/domain'
import type { LocalDate } from '../../shared/local-date'
import {
  buildWorkoutRegularityProgress,
  formatRegularityNumber,
  regularityWeekLabel,
  regularityWorkoutLabel,
  type RegularityWeek,
} from './workout-regularity-progress'

function weekStatusLabel(week: RegularityWeek): string {
  if (week.status === 'active') return `${regularityWorkoutLabel(week.workoutCount)} · ${regularityWeekLabel(week)}`
  if (week.status === 'missed') return `Без тренировок · ${regularityWeekLabel(week)}`
  return `Текущая неделя, пока без тренировок · ${regularityWeekLabel(week)}`
}

function intervalLabel(value: number | null): string {
  return value === null ? '—' : `${formatRegularityNumber(value)} дн.`
}

export function WorkoutRegularityProgressSection({
  currentWorkouts = [],
  previousWorkouts,
  periodStart,
  periodEnd,
  previousPeriodStart,
  previousPeriodEnd,
  today,
  loading,
  error,
  onRetry,
  llmCandidates = [],
}: {
  currentWorkouts?: readonly Workout[]
  previousWorkouts?: readonly Workout[]
  periodStart: LocalDate
  periodEnd: LocalDate
  previousPeriodStart?: LocalDate
  previousPeriodEnd?: LocalDate
  today: LocalDate
  loading: boolean
  error: Error | null
  onRetry: () => void
  llmCandidates?: readonly string[]
}) {
  const progress = buildWorkoutRegularityProgress({
    currentWorkouts,
    previousWorkouts,
    periodStart,
    periodEnd,
    previousPeriodStart,
    previousPeriodEnd,
    today,
    llmCandidates,
  })

  return <section className="client-progress-regularity-story" aria-labelledby="progress-regularity-title">
    <header>
      <h3 id="progress-regularity-title">Тренировочный ритм</h3>
      {!loading && !error && <strong data-fact-id={progress.factId}>{regularityWorkoutLabel(progress.completedWorkouts)}</strong>}
    </header>
    {loading ? <p className="regularity-story-state" role="status">Собираем завершённые тренировки…</p>
      : error ? <p className="regularity-story-state" role="alert">Не удалось загрузить тренировки. <button type="button" className="link" onClick={onRetry}>Повторить</button></p>
      : <>
        <div className="regularity-weekly-strip">
          <div className="regularity-weekly-strip-head"><span>По неделям</span><small>Активные: {progress.activeWeeks} из {progress.elapsedWeeks}</small></div>
          <ol className={progress.weeks.length > 12 ? 'dense' : undefined} aria-label="Завершённые тренировки по неделям">
            {progress.weeks.map((week) => <li
              key={week.start}
              className={week.status}
              aria-label={weekStatusLabel(week)}
              title={weekStatusLabel(week)}
            ><span aria-hidden="true">{week.workoutCount}</span></li>)}
          </ol>
        </div>
        <dl className="regularity-story-facts">
          <div><dt>Серия</dt><dd>{progress.currentStreakWeeks > 0 ? `${progress.currentStreakWeeks} нед.` : '—'}</dd></div>
          <div><dt>Интервал</dt><dd>{intervalLabel(progress.averageIntervalDays)}</dd></div>
          <div><dt>Макс. перерыв</dt><dd>{intervalLabel(progress.longestGapDays)}</dd></div>
        </dl>
      </>}
  </section>
}
