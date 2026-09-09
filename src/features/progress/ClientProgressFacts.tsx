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

export function PeriodExerciseResults({ workouts, periodStart, periodEnd, loading, error, onRetry, children }: {
  workouts?: readonly Workout[]; periodStart: LocalDate; periodEnd: LocalDate; loading: boolean; error: Error | null; onRetry: () => void; children?: ReactNode
}) {
  const location = useLocation()
  const latest = useMemo(() => {
    const grouped = new Map<string, WorkoutResult[]>()
    for (const result of workoutResults(workouts ?? [])) {
      if (result.workout.workoutDate < periodStart || result.workout.workoutDate > periodEnd) continue
      const rows = grouped.get(result.exerciseKey) ?? []
      rows.push(result)
      grouped.set(result.exerciseKey, rows)
    }
    const rank = (result: WorkoutResult) => result.state === 'record' ? 0 : result.state === 'increase' ? 1 : 2
    return [...grouped.values()].map((rows) => [...rows].sort((a, b) => rank(a) - rank(b) || completedWorkoutOrder(b.workout, a.workout) || Number(b.metric === 'weight') - Number(a.metric === 'weight'))[0]!)
      .sort((a, b) => rank(a) - rank(b) || completedWorkoutOrder(b.workout, a.workout) || a.key.localeCompare(b.key))
  }, [workouts, periodStart, periodEnd])
  const row = (result: WorkoutResult) => <article className="period-exercise-result" key={result.key}>
    <header><h4>{result.exerciseName}</h4><span>{resultStateLabels[result.state]}</span></header>
    <p>{result.label}: <strong>{resultNumber(result.value)} {result.unit}</strong></p>
    {result.previous ? <p className="muted">Было {resultNumber(result.previous.value)} {result.unit} · {result.value > result.previous.value ? '+' : ''}{resultNumber(result.value - result.previous.value)} {result.unit}</p> : null}
    <div className="actions"><Link className="link" to={`/workouts/${result.workout.id}`} state={{ returnTo: location.pathname + location.search + '#results' }}>{formatLocalDate(result.workout.workoutDate)}</Link>
      {result.previous && <Link className="link" to={`/workouts/${result.previous.workout.id}`} state={{ returnTo: location.pathname + location.search + '#results' }}>Ранее · {formatLocalDate(result.previous.workout.workoutDate)}</Link>}</div>
  </article>
  return <section className="period-exercise-results card" id="results" aria-label="Результаты и рекорды">
    <h3>Результаты и рекорды</h3>
    {error ? <p role="alert">Не удалось загрузить результаты. <button type="button" className="link" onClick={onRetry}>Повторить</button></p> : loading && !workouts ? <p role="status">Загружаем результаты…</p> : !latest.length ? <p>За этот период пока нет результатов.</p> : <>
      {latest.slice(0, 3).map(row)}{!children && (latest.length > 3 && <details><summary>Все упражнения · {latest.length}</summary>{latest.slice(3).map(row)}</details>)}
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
