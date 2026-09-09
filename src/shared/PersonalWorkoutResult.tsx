import { useMemo, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Workout } from './domain'
import { formatLocalDate } from './local-date'
import { latestWorkoutFact, resultNumber } from './workout-results'

const stateLabels = { baseline: 'Первый результат', record: 'Личный рекорд', increase: 'Результат вырос', stable: 'Без изменений', decrease: 'Результат снизился' }

export function PersonalWorkoutResult({ workouts, workoutId, loading, error, onRetry, children }: {
  workouts?: readonly Workout[]; workoutId?: string; loading?: boolean; error?: Error | null; onRetry?: () => void; children?: ReactNode
}) {
  const location = useLocation()
  const { workout, result } = useMemo(() => latestWorkoutFact(workouts ?? [], workoutId), [workouts, workoutId])
  return <section className="card personal-workout-result" aria-label="Последняя тренировка">
    <p className="eyebrow">ПОСЛЕДНЯЯ ТРЕНИРОВКА</p>
    {error ? <div role="alert"><p>Не удалось загрузить результат.</p><button className="secondary" onClick={onRetry}>Повторить</button></div>
      : loading && !workouts ? <p role="status">Загружаем результат…</p>
      : !workout ? <p>Здесь появится результат после первой тренировки.</p>
      : <><p>{formatLocalDate(workout.workoutDate)}</p>
        {result ? <><h2>{stateLabels[result.state]}</h2><strong>{result.exerciseName}</strong>
          <p>{result.label}: <b>{resultNumber(result.value)} {result.unit}</b></p>
          {result.previous && <p>Было {resultNumber(result.previous.value)} {result.unit}{result.state !== 'stable' && ` · ${result.value > result.previous.value ? '+' : '−'}${resultNumber(Math.abs(result.value - result.previous.value))} ${result.unit}`}</p>}
        </> : <><h2>Тренировка сохранена</h2><p>Здесь пока нечего сравнивать.</p></>}
        <div className="actions"><Link className="link" to={`/workouts/${workout.id}`} state={{ returnTo: location.pathname + location.search }}>Открыть</Link>
        {result?.previous && <Link className="link" to={`/workouts/${result.previous.workout.id}`} state={{ returnTo: location.pathname + location.search }}>Сравнить</Link>}</div>
        {children}
      </>}
  </section>
}
