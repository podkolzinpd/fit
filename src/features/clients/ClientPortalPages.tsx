import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useClientRealtime } from '../../app/use-client-realtime'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { progressRepository } from '../../data/repositories/progress.repository'
import { splitClientWorkouts, workoutsRepository } from '../../data/repositories/workouts.repository'
import { formatLocalDate, todayLocalDate } from '../../shared/local-date'
import { AsyncView, Page } from '../../shared/ui'
import { ProgressChart } from '../progress/ProgressChart'
import { ClientTrainingSummaryCard } from '../progress/TrainingSummaryCard'
import { WorkoutExercisesSummary } from '../workouts'

function useMine() {
  const query = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine() })
  useClientRealtime(query.data?.id)
  return query
}

export function MyWorkoutsPage() {
  const mine = useMine()
  const workouts = useQuery({
    queryKey: ['workouts', mine.data?.id],
    queryFn: () => workoutsRepository.list(undefined, undefined, mine.data!.id),
    enabled: Boolean(mine.data),
  })
  const items = workouts.data ? splitClientWorkouts(workouts.data, todayLocalDate()) : null
  return <Page title="Мои тренировки" back="/me"><AsyncView loading={mine.isLoading || workouts.isLoading} error={mine.error ?? workouts.error} onRetry={() => { void mine.refetch(); void workouts.refetch() }}>
    {items && <><section><h2>Предстоит</h2>{items.upcoming.length ? <div className="cards">{items.upcoming.map((workout) => <Link className="card" key={workout.id} to={`/workouts/${workout.id}`}><div><strong>{formatLocalDate(workout.workoutDate)}</strong><WorkoutExercisesSummary workout={workout} /></div><span className={`badge ${workout.status}`}>План</span></Link>)}</div> : <p className="muted">Нет запланированных тренировок</p>}</section>
    <section><h2>История</h2>{items.history.length ? <div className="cards">{items.history.map((workout) => <Link className="card" key={workout.id} to={`/workouts/${workout.id}`}><div><strong>{formatLocalDate(workout.workoutDate)}</strong><WorkoutExercisesSummary workout={workout} /></div><span className={`badge ${workout.status}`}>Готово</span></Link>)}</div> : <p className="muted">История пока пуста</p>}</section></>}
  </AsyncView></Page>
}

export function MyProgressPage() {
  const mine = useMine()
  const entries = useQuery({ queryKey: ['progress', mine.data?.id], queryFn: () => progressRepository.list(mine.data!.id), enabled: Boolean(mine.data) })
  return <Page title="Мой прогресс" back="/me"><AsyncView loading={mine.isLoading || entries.isLoading} error={mine.error ?? entries.error} empty={entries.data?.length === 0} onRetry={() => { void mine.refetch(); void entries.refetch() }}>
    {entries.data && mine.data && <>
      <ClientTrainingSummaryCard clientId={mine.data.id} />
      <ProgressChart entries={entries.data} metric="weightKg" label="Вес" unit="кг" windowEnd={null} onWindowChange={() => undefined} /><div className="cards">{entries.data.map((entry) => <article className="card" key={entry.id}><div><strong>{formatLocalDate(entry.recordedOn)}</strong><p>{entry.weightKg === undefined ? 'Вес не указан' : `${entry.weightKg} кг`}</p></div></article>)}</div>
    </>}
  </AsyncView></Page>
}
