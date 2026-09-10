import { ProgressDetailsSummary } from './ProgressDetailsSummary'
import { useMemo, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { ClientGoal, ProgressEntry, Workout } from '../../shared/domain'
import { addDays, daysBetween, formatLocalDate, type LocalDate } from '../../shared/local-date'
import { completedWorkoutOrder, resultNumber, workoutResults, type WorkoutResult } from '../../shared/workout-results'
import { loadBodyMap, setCountLabel } from './body-progress-map'
import { goalStory } from './client-progress-presentation'
import { buildPeriodComparison } from './period-comparison'
import { mondayStart, regularityWorkoutLabel } from './workout-regularity-progress'

export function ClientGoalFacts({ goal, profileGoal, entries, workouts, periodStart, periodEnd, today, loading, error, onRetry }: {
  goal?: ClientGoal | null; profileGoal?: string | null; entries: readonly ProgressEntry[]; workouts: readonly Workout[]
  periodStart: LocalDate; periodEnd: LocalDate; today: LocalDate; loading: boolean; error: Error | null; onRetry: () => void
}) {
  const location = useLocation()
  const story = goalStory({ periodStart, periodEnd }, { goal, profileGoal, measurements: entries, currentWorkouts: workouts, today, role: 'client' })
  const criterionRow = (criterion: NonNullable<NonNullable<typeof story>['criteria']>[number]) => <article className="goal-criterion-progress-row" key={criterion.id}>
        <header><strong>{criterion.label}</strong><span>{criterion.status === "Движение к ориентиру" ? "В процессе" : criterion.status}</span></header>
        <dl><div><dt>Сейчас</dt><dd>{criterion.current}</dd></div><div><dt>Цель</dt><dd>{criterion.target.replace(/^(увеличить до|снизить до|уменьшить до) /u, "")}</dd></div></dl>
        <p>{criterion.dynamics === "недостаточно данных для динамики" ? "Пока нечего сравнивать" : criterion.dynamics.split(" · ")[0]}</p><details><summary>{criterion.dataOwner === "workout" ? "Дата тренировки" : "Дата замера"}</summary><p>{criterion.lastDate ?? 'Дата отсутствует'} · {criterion.freshness}</p></details>
        {criterion.action === 'measurement' && <Link className="link" to={{ pathname: location.pathname, search: location.search, hash: '#measurements' }}>Добавить замер</Link>}
        {criterion.action === 'workout' && <Link className="link" to="/workouts/new">Записать тренировку</Link>}
      </article>
  return <section className="client-progress-goal-story standalone" aria-label="Твоя цель">
    <header className="client-progress-goal-story-head"><span>Твоя цель</span><Link className="link" to="/me/goal">Изменить цель</Link></header>
    {loading ? <p role="status">Загружаем цель…</p> : error ? <p role="alert">Не удалось загрузить данные цели. <button type="button" className="link" onClick={onRetry}>Повторить</button></p> : !story ? <><h3>Цель пока не указана</h3><Link className="link" to="/me/goal">Добавить цель</Link></> : <>
      <h3>{story.title}</h3>

      {story.criteria?.length ? <div className="goal-criteria-progress-list">{story.criteria.slice(0, 2).map(criterionRow)}{story.criteria.length > 2 && <details><summary>Все показатели · {story.criteria.length - 2}</summary>{story.criteria.slice(2).map(criterionRow)}</details>}</div> : <><p>{story.state === 'needs_review' ? 'Цель изменилась. Проверь показатели.' : 'Выбери, что отслеживать.'}</p><Link className="link" to="/me/goal">{story.state === 'needs_review' ? 'Проверить показатели' : 'Настроить цель'}</Link></>}
    </>}
  </section>
}

export function ClientCurrentWeek({ workouts, today, loading, error, onRetry }: { workouts?: readonly Workout[]; today: LocalDate; loading: boolean; error: Error | null; onRetry: () => void }) {
  const start = mondayStart(today)
  const done = (workouts ?? []).filter((workout) => workout.status === 'done' && workout.workoutDate >= start && workout.workoutDate <= today)
  const load = loadBodyMap(done, start, today)
  return <section className="client-current-week card" aria-label="Текущая неделя">
    <h3>Эта неделя</h3><p className="muted">{formatLocalDate(start)} — {formatLocalDate(addDays(start, 6))}</p>
    {error ? <p role="alert">Не удалось загрузить неделю. <button type="button" className="link" onClick={onRetry}>Повторить</button></p>
      : loading && !workouts ? <p role="status">Загружаем неделю…</p>
      : <><strong>{done.length ? regularityWorkoutLabel(done.length) : 'Пока нет тренировок'}</strong><p>{setCountLabel(load.coverage.totalSets)}</p></>}
  </section>
}

export const resultStateLabels: Record<WorkoutResult['state'], string> = { baseline: 'Первый результат', record: 'Личный рекорд', increase: 'Результат вырос', stable: 'Без изменений', decrease: 'Результат снизился' }

const resultMetricRank: Record<WorkoutResult['metric'], number> = { weight: 0, fixed_reps: 1, reps: 2, volume: 3, distance: 4, duration: 5 }
const repetitionWord = (value: number) => {
  const integer = Math.abs(Math.trunc(value)), tail = integer % 100
  if (tail >= 11 && tail <= 14) return 'повторов'
  return integer % 10 === 1 ? 'повтор' : integer % 10 >= 2 && integer % 10 <= 4 ? 'повтора' : 'повторов'
}
const resultValue = (result: WorkoutResult) => result.metric === 'weight' && result.performedReps !== undefined
  ? `${resultNumber(result.value)} кг × ${resultNumber(result.performedReps)} ${repetitionWord(result.performedReps)}`
  : result.metric === 'fixed_reps' && result.fixedWeight !== undefined
    ? `${resultNumber(result.fixedWeight)} кг × ${resultNumber(result.value)} ${repetitionWord(result.value)}`
    : result.metric === 'reps' ? `${resultNumber(result.value)} ${repetitionWord(result.value)}`
      : `${resultNumber(result.value)} ${result.unit}`
const achievementLabel = (result: WorkoutResult) => result.metric === 'weight' ? 'Новый максимум веса'
  : result.metric === 'fixed_reps' ? `Рекорд повторов при ${resultNumber(result.fixedWeight ?? 0)} кг`
    : result.metric === 'reps' ? 'Новый максимум повторов' : 'Новый максимум объёма'
const recordDelta = (result: WorkoutResult) => {
  if (!result.previousBest) return null
  const delta = result.value - result.previousBest.value
  const unit = result.metric === 'fixed_reps' || result.metric === 'reps' ? repetitionWord(delta) : result.unit
  return `+${resultNumber(delta)} ${unit}`
}
const previousRecord = (result: WorkoutResult) => {
  if (!result.previousBest) return null
  const unit = result.metric === 'fixed_reps' || result.metric === 'reps' ? repetitionWord(result.previousBest.value) : result.unit
  return `${result.metric === 'volume' ? 'Прежний максимум' : 'Прежний рекорд'} — ${resultNumber(result.previousBest.value)} ${unit}`
}

export function PeriodExerciseResults({ workouts, periodStart, periodEnd, loading, error, onRetry, children }: {
  workouts?: readonly Workout[]; periodStart: LocalDate; periodEnd: LocalDate; loading: boolean; error: Error | null; onRetry: () => void; children?: ReactNode
}) {
  const location = useLocation()
  const achievements = useMemo(() => {
    const grouped = new Map<string, WorkoutResult[]>()
    for (const result of workoutResults(workouts ?? [])) {
      if (result.workout.workoutDate < periodStart || result.workout.workoutDate > periodEnd) continue
      if (result.state !== 'record') continue
      const rows = grouped.get(result.exerciseKey) ?? []
      rows.push(result)
      grouped.set(result.exerciseKey, rows)
    }
    return [...grouped.values()].map((rows) => [...rows].sort((a, b) => completedWorkoutOrder(b.workout, a.workout) || resultMetricRank[a.metric] - resultMetricRank[b.metric] || a.key.localeCompare(b.key))[0]!)
      .sort((a, b) => completedWorkoutOrder(b.workout, a.workout) || resultMetricRank[a.metric] - resultMetricRank[b.metric] || a.key.localeCompare(b.key))
  }, [workouts, periodStart, periodEnd])
  const row = (result: WorkoutResult) => <article className="period-exercise-result" key={result.key}>
    <h4>{result.exerciseName}</h4>
    <p className="period-result-value"><strong>{resultValue(result)}</strong></p>
    <p className="period-result-achievement">{achievementLabel(result)}{recordDelta(result) && ` · ${recordDelta(result)}`}</p>
    {previousRecord(result) && <p className="muted">{previousRecord(result)}</p>}
    <div className="actions"><span className="muted">{formatLocalDate(result.workout.workoutDate)}</span><Link className="link" to={`/workouts/${result.workout.id}`} state={{ returnTo: location.pathname + location.search + '#results' }}>Открыть тренировку</Link></div>
  </article>
  return <section className="period-exercise-results card" id="results" aria-label="Лучшие результаты за период">
    <h3>Лучшие результаты за период</h3>
    {error ? <p role="alert">Не удалось загрузить результаты. <button type="button" className="link" onClick={onRetry}>Повторить</button></p> : loading && !workouts ? <p role="status">Загружаем результаты…</p> : !achievements.length ? <p>За этот период новых достижений нет.</p> : <>
      {achievements.slice(0, 3).map(row)}{achievements.length > 3 && <details className="period-achievements-more"><ProgressDetailsSummary>Ещё достижения · {achievements.length - 3}</ProgressDetailsSummary>{achievements.slice(3).map(row)}</details>}
    </>}
    {children}
  </section>
}

export function ClientPeriodComparison({ workouts, entries, goal, periodStart, periodEnd, loading, error, onRetry }: {
  workouts?: readonly Workout[]; entries: readonly ProgressEntry[]; goal?: ClientGoal | null; periodStart: LocalDate; periodEnd: LocalDate
  loading: boolean; error: Error | null; onRetry: () => void
}) {
  const days = daysBetween(periodStart, periodEnd) + 1
  const previous = { start: addDays(periodStart, -days), end: addDays(periodStart, -1) }
  const inRange = (start: LocalDate, end: LocalDate) => (workouts ?? []).filter((workout) => workout.workoutDate >= start && workout.workoutDate <= end)
  const comparison = buildPeriodComparison({ currentPeriod: { start: periodStart, end: periodEnd }, previousPeriod: previous,
    currentWorkouts: inRange(periodStart, periodEnd), previousWorkouts: inRange(previous.start, previous.end), measurements: entries, goal })
  return <details className="client-progress-comparison card"><ProgressDetailsSummary>Сравнить периоды</ProgressDetailsSummary>
    <p>{formatLocalDate(previous.start)} — {formatLocalDate(previous.end)} → {formatLocalDate(periodStart)} — {formatLocalDate(periodEnd)}</p>
    {error ? <p role="alert">Не удалось загрузить сравнение. <button type="button" className="link" onClick={onRetry}>Повторить</button></p> : loading ? <p role="status">Сравниваем периоды…</p> : <>
      <dl className="period-comparison-facts">{comparison.facts.map((fact) => <div key={fact.factId} className={fact.tone}><dt>{fact.subject}<span>{fact.previousLabel} → {fact.currentLabel}</span></dt><dd>{fact.value}</dd></div>)}</dl>
      {!comparison.facts.length && <p>{comparison.emptyMessage}</p>}
    </>}
  </details>
}
