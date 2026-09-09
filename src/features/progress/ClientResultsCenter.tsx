import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { Workout } from '../../shared/domain'
import { ArrowUpIcon } from '../../shared/icons'
import { formatLocalDate, type LocalDate } from '../../shared/local-date'
import { completedWorkoutOrder, resultNumber, workoutResults, type ResultMetric, type WorkoutResult } from '../../shared/workout-results'
import { resultStateLabels } from './ClientProgressFacts'
import { volumeChangeDetails } from './results-analytics'

const metrics: Array<{ key: ResultMetric; label: string }> = [
  { key: 'weight', label: 'Максимальный вес' }, { key: 'fixed_reps', label: 'Повторы при фиксированном весе' },
  { key: 'volume', label: 'Объём' }, { key: 'reps', label: 'Повторы' }, { key: 'distance', label: 'Дистанция' }, { key: 'duration', label: 'Длительность' },
]
type Props = { workouts?: readonly Workout[]; periodStart: LocalDate; periodEnd: LocalDate; loading: boolean; error: Error | null; onRetry: () => void }

function useResultsParams() {
  const location = useLocation()
  const navigate = useNavigate()
  const latestLocation = useRef(location)
  useLayoutEffect(() => { latestLocation.current = location }, [location])
  const params = new URLSearchParams(location.search)
  const update = (change: (next: URLSearchParams) => void) => {
    const current = latestLocation.current
    const next = new URLSearchParams(current.search)
    change(next)
    const destination = { ...current, search: `?${next}`, hash: '#results-center' }
    latestLocation.current = destination
    void navigate(destination, { replace: true, preventScrollReset: true })
  }
  return { location, params, update }
}

function VolumeExplanation({ result }: { result: WorkoutResult }) {
  const change = volumeChangeDetails(result)
  if (!change) return null
  const arrow = <><span className="sr-only"> → </span><ArrowUpIcon className="result-change-arrow" /></>
  const weightRange = ({ minWeight, maxWeight }: { minWeight: number; maxWeight: number }) => minWeight === maxWeight ? resultNumber(minWeight) : `${resultNumber(minWeight)}–${resultNumber(maxWeight)}`
  return <details className="result-volume-explanation"><summary>Из чего сложился объём</summary>
    <p>{change.changed.length ? `Изменились: ${change.changed.join(', ')}.` : 'Записанные подходы, веса и повторы совпадают.'}</p>
    <dl><div><dt>Подходы</dt><dd>{change.before.count}{arrow}{change.after.count}</dd></div>
      <div><dt>Всего повторов</dt><dd>{change.before.reps}{arrow}{change.after.reps}</dd></div>
      <div><dt>Веса в подходах</dt><dd>{weightRange(change.before)}{arrow}{weightRange(change.after)} кг</dd></div></dl>
    <div className="volume-source-sets">{([{ label: 'Предыдущая запись', data: change.before }, { label: 'Эта запись', data: change.after }] as const).map(({ label, data }) => <div key={label}><strong>{label}</strong><ul>{data.sets.map((set, index) => <li key={index}>{resultNumber(set.weight)} кг × {set.reps} повт.</li>)}</ul><p>Итого: {resultNumber(data.volume)} кг</p></div>)}</div>
    <p className="muted">Объём — сумма веса × повторов подтверждённых подходов. Его изменение не равно изменению силы.</p>
  </details>
}

function ResultsContent({ workouts, periodStart, periodEnd, loading, error, onRetry }: Props) {
  const { location, params, update } = useResultsParams()
  const exerciseKey = params.get('resultExercise') ?? ''
  const metric = params.get('resultMetric') ?? ''
  const [limit, setLimit] = useState(10)
  useEffect(() => setLimit(10), [exerciseKey, metric, periodStart, periodEnd])
  const history = useMemo(() => workoutResults(workouts ?? []), [workouts])
  const names = new Map(history.map((row) => [row.exerciseKey, row.exerciseName]))
  const rows = history.filter((result) => result.workout.workoutDate >= periodStart && result.workout.workoutDate <= periodEnd)
  const exercises = [...new Map(rows.map((row) => [row.exerciseKey, names.get(row.exerciseKey)!])).entries()]
  const invalidExercise = Boolean(exerciseKey && !exercises.some(([key]) => key === exerciseKey))
  const invalidMetric = Boolean(metric && !metrics.some((item) => item.key === metric))
  const filtered = rows.filter((result) => (!exerciseKey || result.exerciseKey === exerciseKey) && (!metric || result.metric === metric))
    .sort((a, b) => completedWorkoutOrder(b.workout, a.workout) || metrics.findIndex((item) => item.key === a.metric) - metrics.findIndex((item) => item.key === b.metric) || a.key.localeCompare(b.key))
  const change = (key: string, value: string) => update((next) => { if (value) next.set(key, value); else next.delete(key) })
  const returnTo = location.pathname + location.search + '#results-center'
  return <>
    <p className="muted">{formatLocalDate(periodStart)} — {formatLocalDate(periodEnd)}. Сравнение учитывает и более раннюю историю.</p>
    <div className="results-center-filters"><label>Упражнение<select value={exerciseKey} onChange={(event) => change('resultExercise', event.target.value)}><option value="">Все упражнения</option>{invalidExercise && <option value={exerciseKey}>Недоступное упражнение</option>}{exercises.map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select></label>
      <label>Показатель<select value={metric} onChange={(event) => change('resultMetric', event.target.value)}><option value="">Все показатели</option>{invalidMetric && <option value={metric}>Неизвестный показатель</option>}{metrics.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label></div>
    {error ? <p role="alert">Не удалось загрузить историю результатов. <button type="button" className="link" onClick={onRetry}>Повторить</button></p> : loading && !workouts ? <p role="status">Загружаем результаты…</p> : invalidExercise || invalidMetric ? <p role="status">Выбранный фильтр больше недоступен за этот период. Выберите упражнение и показатель из списка.</p> : !filtered.length ? <p>Подтверждённых результатов с такими условиями пока нет.</p> : <>
      <p className="muted">Показано {Math.min(limit, filtered.length)} из {filtered.length} результатов.</p>
      {filtered.slice(0, limit).map((result) => <article className="center-result-row" key={`${result.workout.id}:${result.key}`}>
        <header><h4>{result.exerciseName}</h4><span>{resultStateLabels[result.state]}</span></header>
        <p>{result.label}: <strong>{resultNumber(result.value)} {result.unit}</strong></p>
        {result.previous ? <p>Ранее: {resultNumber(result.previous.value)} {result.unit}. Разница: {resultNumber(result.value - result.previous.value)} {result.unit}.</p> : <p className="muted">Первая сопоставимая запись — точка отсчёта.</p>}
        <div className="actions"><Link className="link" to={`/workouts/${result.workout.id}`} state={{ returnTo }}>{formatLocalDate(result.workout.workoutDate)}</Link>{result.previous && <Link className="link" to={`/workouts/${result.previous.workout.id}`} state={{ returnTo }}>Ранее · {formatLocalDate(result.previous.workout.workoutDate)}</Link>}</div>
        <VolumeExplanation result={result} />
      </article>)}
      {filtered.length > limit && <button className="secondary" type="button" onClick={() => setLimit((value) => value + 10)}>Показать ещё результаты</button>}
    </>}
  </>
}

export function ClientResultsCenter(props: Props) {
  const { params, update } = useResultsParams()
  const open = params.get('resultsOpen') === '1'
  return <details className="client-results-center card" id="results-center" open={open} onToggle={(event) => {
    const nextOpen = event.currentTarget.open
    if (nextOpen !== open) update((next) => { if (nextOpen) next.set('resultsOpen', '1'); else next.delete('resultsOpen') })
  }}><summary>Все результаты и рекорды</summary>{open && <ResultsContent {...props} />}</details>
}
