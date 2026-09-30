import { useMemo, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Workout } from './domain'
import { formatLocalDate } from './local-date'
import { completedWorkoutOrder, latestWorkoutFact, resultExerciseKey, resultNumber, workoutResults, type WorkoutResult } from './workout-results'

const stateLabels = { baseline: 'Первый результат', record: 'Личный рекорд', increase: 'Результат вырос', stable: 'Без изменений', decrease: 'Результат снизился' }
const recordMetricOrder: WorkoutResult['metric'][] = ['weight', 'fixed_reps', 'reps', 'volume', 'distance', 'duration']

function countWord(count: number, one: string, few: string, many: string): string {
  const lastTwo = count % 100
  if (lastTwo >= 11 && lastTwo <= 14) return many
  const last = count % 10
  return last === 1 ? one : last >= 2 && last <= 4 ? few : many
}

function confirmedSummary(workout: Workout): string | null {
  const exercises = workout.exercises.filter((exercise) => exercise.sets.some((set) => set.confirmedAt))
  const sets = exercises.reduce((count, exercise) => count + exercise.sets.filter((set) => set.confirmedAt).length, 0)
  if (!sets) return null
  return `${exercises.length} ${countWord(exercises.length, 'упражнение', 'упражнения', 'упражнений')} · ${sets} ${countWord(sets, 'выполненный подход', 'выполненных подхода', 'выполненных подходов')}`
}

function homeRecords(workouts: readonly Workout[], workout: Workout): WorkoutResult[] {
  const exerciseOrder = new Map<string, number>()
  for (const exercise of workout.exercises) {
    const key = resultExerciseKey(exercise)
    exerciseOrder.set(key, Math.min(exerciseOrder.get(key) ?? Infinity, exercise.position))
  }
  return workoutResults(workouts).filter((result) => result.workout.id === workout.id && result.state === 'record')
    .sort((left, right) => (exerciseOrder.get(left.exerciseKey) ?? Infinity) - (exerciseOrder.get(right.exerciseKey) ?? Infinity)
      || recordMetricOrder.indexOf(left.metric) - recordMetricOrder.indexOf(right.metric)
      || left.key.localeCompare(right.key))
}

export function PersonalWorkoutResult({ workouts, workoutId, loading, error, onRetry, children, home = false }: {
  workouts?: readonly Workout[]; workoutId?: string; loading?: boolean; error?: Error | null; onRetry?: () => void; children?: ReactNode; home?: boolean
}) {
  const location = useLocation()
  const { workout, result, records, firstWorkout } = useMemo(() => {
    const history = workouts ?? []
    if (!home) return { ...latestWorkoutFact(history, workoutId), records: [] as WorkoutResult[], firstWorkout: false }
    const completed = history.filter((item) => item.status === 'done').sort(completedWorkoutOrder)
    const workout = workoutId ? completed.find((item) => item.id === workoutId) : completed.at(-1)
    return { workout, result: undefined as WorkoutResult | undefined, records: workout ? homeRecords(history, workout) : [], firstWorkout: completed.length === 1 }
  }, [home, workoutId, workouts])
  const summary = home && workout ? confirmedSummary(workout) : null
  const homeRecord = records[0]
  return <section className="card personal-workout-result" aria-label="Последняя тренировка">
    <p className="eyebrow">ПОСЛЕДНЯЯ ТРЕНИРОВКА</p>
    {error ? <div role="alert"><p>Не удалось загрузить результат.</p><button className="secondary" onClick={onRetry}>Повторить</button></div>
      : loading && !workouts ? <p role="status">Загружаем результат…</p>
      : !workout ? <p>Здесь появится результат после первой тренировки.</p>
      : <><p>{formatLocalDate(workout.workoutDate)}</p>
        {home ? homeRecord ? <><h2>Личный рекорд</h2><strong>{homeRecord.exerciseName}</strong>
          <p>{homeRecord.label}: <b>{resultNumber(homeRecord.value)} {homeRecord.unit}</b></p>
          {homeRecord.previousBest && <p>Предыдущий максимум — {resultNumber(homeRecord.previousBest.value)} {homeRecord.unit}</p>}
          {records.length > 1 && <p>Ещё {records.length - 1} {countWord(records.length - 1, 'рекорд', 'рекорда', 'рекордов')}</p>}
        </> : summary ? <>{firstWorkout && <h2>Первая тренировка записана</h2>}<p className="personal-result-facts">{summary}</p></> : null
        : result ? <><h2>{stateLabels[result.state]}</h2><strong>{result.exerciseName}</strong>
          <p>{result.label}: <b>{resultNumber(result.value)} {result.unit}</b></p>
          {result.previous && <p>Было {resultNumber(result.previous.value)} {result.unit}{result.state !== 'stable' && ` · ${result.value > result.previous.value ? '+' : '−'}${resultNumber(Math.abs(result.value - result.previous.value))} ${result.unit}`}</p>}
        </> : <><h2>Тренировка сохранена</h2><p>Здесь пока нечего сравнивать.</p></>}
        <div className="actions"><Link className="link" to={`/workouts/${workout.id}`} state={{ returnTo: location.pathname + location.search }}>{home ? 'Открыть тренировку' : 'Открыть'}</Link>
        {!home && result?.previous && <Link className="link" to={`/workouts/${result.previous.workout.id}`} state={{ returnTo: location.pathname + location.search }}>Сравнить</Link>}</div>
        {children}
      </>}
  </section>
}
