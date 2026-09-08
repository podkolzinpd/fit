import { useMemo, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Workout } from './domain'
import { formatLocalDate } from './local-date'
import { latestWorkoutFact, resultNumber } from './workout-results'

const stateLabels = { baseline: 'Первая запись для сравнения', record: 'Личный рекорд по записям', increase: 'Больше, чем в прошлый раз', stable: 'Результат сохранился', decrease: 'Меньше, чем в прошлый раз' }

export function PersonalWorkoutResult({ workouts, workoutId, loading, error, onRetry, children }: {
  workouts?: readonly Workout[]; workoutId?: string; loading?: boolean; error?: Error | null; onRetry?: () => void; children?: ReactNode
}) {
  const location = useLocation()
  const { workout, result } = useMemo(() => latestWorkoutFact(workouts ?? [], workoutId), [workouts, workoutId])
  return <section className="card personal-workout-result" aria-label="После последней тренировки">
    <p className="eyebrow">ПОСЛЕ ПОСЛЕДНЕЙ ТРЕНИРОВКИ</p>
    {error ? <div role="alert"><p>Не удалось проверить свежий результат.</p><button className="secondary" onClick={onRetry}>Повторить</button></div>
      : loading && !workouts ? <p role="status">Проверяем записи…</p>
      : !workout ? <p>После первой завершённой тренировки здесь появится ваш результат.</p>
      : <><p>{formatLocalDate(workout.workoutDate)}</p>
        {result ? <><h2>{stateLabels[result.state]}</h2><strong>{result.exerciseName}</strong>
          <p>{result.label}: <b>{resultNumber(result.value)} {result.unit}</b></p>
          {result.previous ? <p>Ранее: {resultNumber(result.previous.value)} {result.unit} · {formatLocalDate(result.previous.workout.workoutDate)}. {result.state === 'stable' ? 'В этой метрике без изменений.' : `Разница: ${result.value > result.previous.value ? '+' : '−'}${resultNumber(Math.abs(result.value - result.previous.value))} ${result.unit}.`}</p>
            : <p>Предыдущего сопоставимого результата пока нет. Эта запись станет точкой отсчёта.</p>}
          {result.metric === 'volume' && <p>Объём — сумма веса × повторов подтверждённых подходов. Его изменение не равно изменению силы.</p>}
        </> : <><h2>Тренировка сохранена</h2><p>Подтверждённых значений для сравнения пока нет.</p></>}
        <div className="actions"><Link className="link" to={`/workouts/${workout.id}`} state={{ returnTo: location.pathname + location.search }}>Эта тренировка</Link>
        {result?.previous && <Link className="link" to={`/workouts/${result.previous.workout.id}`} state={{ returnTo: location.pathname + location.search }}>Предыдущий результат</Link>}</div>
        {children}
      </>}
  </section>
}
