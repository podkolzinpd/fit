import type { Workout } from '../../shared/domain'
import type { LocalDate } from '../../shared/local-date'
import {
  buildWorkoutRegularityProgress,
  formatRegularityNumber,
  regularityWeekCountLabel,
  regularityWeekLabel,
  regularityWorkoutLabel,
  type RegularityPattern,
  type RegularityWeek,
} from './workout-regularity-progress'

const PATTERN_LABELS: Record<RegularityPattern, string> = {
  stability: 'Стабильность',
  return: 'Возвращение в ритм',
  frequency_decline: 'Снижение частоты',
  activity_concentration: 'Активность сконцентрирована',
  insufficient_data: 'Недостаточно данных',
}

function weekStatusLabel(week: RegularityWeek): string {
  if (week.status === 'active') return `${regularityWorkoutLabel(week.workoutCount)} · ${regularityWeekLabel(week)}`
  if (week.status === 'missed') return `Без тренировок · ${regularityWeekLabel(week)}`
  return `Текущая неделя, пока без тренировок · ${regularityWeekLabel(week)}`
}

function intervalLabel(value: number | null): string {
  return value === null ? 'Нужно хотя бы 2 даты' : `${formatRegularityNumber(value)} дн.`
}

function frequencyChangeLabel(current: number, previous: number | null, delta: number | null): string {
  if (previous === null || delta === null) return `${formatRegularityNumber(current)} трен./нед. · отправная точка`
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : ''
  return `${formatRegularityNumber(previous)} → ${formatRegularityNumber(current)} трен./нед. · ${sign}${formatRegularityNumber(Math.abs(delta))}`
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
    <header><div><span>Регулярность</span><h3 id="progress-regularity-title">Тренировочный ритм</h3></div></header>
    {loading ? <p className="regularity-story-state" role="status">Собираем завершённые тренировки…</p>
      : error ? <p className="regularity-story-state" role="alert">Не удалось загрузить тренировки. <button type="button" className="link" onClick={onRetry}>Повторить</button></p>
      : <>
        <div className="regularity-story-summary" data-fact-id={progress.factId}>
          <div><span>За период</span><strong>{regularityWorkoutLabel(progress.completedWorkouts)}</strong></div>
          <div><span>Активные недели</span><strong>{progress.activeWeeks} из {progress.elapsedWeeks}</strong></div>
        </div>
        <div className="regularity-weekly-strip">
          <div className="regularity-weekly-strip-head"><span>Ритм по неделям</span><small>{progress.missedWeeks > 0 ? `Без тренировок: ${progress.missedWeeks}` : 'Без пропущенных недель'}</small></div>
          <ol className={progress.weeks.length > 12 ? 'dense' : undefined} aria-label="Завершённые тренировки по неделям">
            {progress.weeks.map((week) => <li
              key={week.start}
              className={week.status}
              aria-label={weekStatusLabel(week)}
              title={weekStatusLabel(week)}
            ><span aria-hidden="true">{week.workoutCount > 0 ? week.workoutCount : '—'}</span></li>)}
          </ol>
          <div className="regularity-weekly-legend" aria-hidden="true">
            <span className="active">Тренировались</span><span className="missed">Без тренировок</span>
            {progress.weeks.some((week) => week.status === 'current') && <span className="current">Текущая</span>}
          </div>
        </div>
        <dl className="regularity-story-facts">
          <div><dt>Средний / длинный интервал</dt><dd>{intervalLabel(progress.averageIntervalDays)} / {intervalLabel(progress.longestGapDays)}</dd></div>
          <div><dt>Текущая серия</dt><dd>{progress.currentStreakWeeks > 0 ? regularityWeekCountLabel(progress.currentStreakWeeks) : 'Серии пока нет'}</dd></div>
          <div><dt>Частота к прошлому периоду</dt><dd>{frequencyChangeLabel(progress.workoutsPerWeek, progress.previousWorkoutsPerWeek, progress.frequencyChange)}</dd></div>
        </dl>
        <div className="regularity-story-explanation" data-copy-source={progress.explanation.source} data-fact-ids={progress.explanation.factIds.join(',')}>
          <span>{PATTERN_LABELS[progress.pattern]}</span><p>{progress.explanation.text}</p>
        </div>
      </>}
  </section>
}
