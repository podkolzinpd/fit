import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useClientRealtime } from '../../app/use-client-realtime'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { progressRepository } from '../../data/repositories/progress.repository'
import { splitClientWorkouts, workoutsRepository } from '../../data/repositories/workouts.repository'
import { formatLocalDate, localDate, todayLocalDate } from '../../shared/local-date'
import { AsyncView, Field, Page } from '../../shared/ui'
import { ProgressChart } from '../progress/ProgressChart'
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
  const queryClient = useQueryClient()
  const entries = useQuery({ queryKey: ['progress', mine.data?.id], queryFn: () => progressRepository.list(mine.data!.id), enabled: Boolean(mine.data) })
  const save = useMutation({ mutationFn: (form: HTMLFormElement) => {
    const data = new FormData(form)
    return progressRepository.save({
      clientId: mine.data!.id,
      recordedOn: localDate(String(data.get('recordedOn'))),
      weightKg: numberValue(data.get('weightKg')),
      chestCm: numberValue(data.get('chestCm')),
      waistCm: numberValue(data.get('waistCm')),
      hipCm: numberValue(data.get('hipCm')),
      customMetrics: [],
    })
  }, onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['progress', mine.data?.id] }) })
  const remove = useMutation({ mutationFn: (entry: Parameters<typeof progressRepository.remove>[0]) => progressRepository.remove(entry), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['progress', mine.data?.id] }) })
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); save.mutate(event.currentTarget) }
  return <Page title="Мой прогресс" back="/me"><AsyncView loading={mine.isLoading || entries.isLoading} error={mine.error ?? entries.error} onRetry={() => { void mine.refetch(); void entries.refetch() }}>
    {entries.data && <><section><h2>Новый замер</h2><form className="stack compact" onSubmit={(event) => void submit(event)}>
      <Field label="Дата"><input name="recordedOn" type="date" defaultValue={todayLocalDate()} required /></Field>
      <div className="measure-grid"><Field label="Вес, кг"><input name="weightKg" type="number" step="0.1" /></Field><Field label="Грудь, см"><input name="chestCm" type="number" step="0.1" /></Field><Field label="Талия, см"><input name="waistCm" type="number" step="0.1" /></Field><Field label="Бёдра, см"><input name="hipCm" type="number" step="0.1" /></Field></div>
      {save.error && <p className="error">{save.error.message}</p>}<button disabled={save.isPending}>Сохранить замер</button>
    </form></section>
    {entries.data.length > 0 ? <><ProgressChart entries={entries.data} metric="weightKg" label="Вес" unit="кг" windowEnd={null} onWindowChange={() => undefined} /><div className="cards">{entries.data.map((entry) => <article className="card" key={entry.id}><div><strong>{formatLocalDate(entry.recordedOn)}</strong><p>{entry.weightKg === undefined ? 'Вес не указан' : `${entry.weightKg} кг`}</p></div><button className="link danger" disabled={remove.isPending} onClick={() => remove.mutate(entry)}>Удалить</button></article>)}</div></> : <p className="muted">Замеров пока нет</p>}</>}
  </AsyncView></Page>
}

function numberValue(value: FormDataEntryValue | null) {
  return value ? Number(value) : undefined
}
