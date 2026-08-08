import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useClientRealtime } from '../../app/use-client-realtime'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { invitationsRepository } from '../../data/repositories/invitations.repository'
import { progressRepository } from '../../data/repositories/progress.repository'
import { splitClientWorkouts, workoutsRepository } from '../../data/repositories/workouts.repository'
import { formatLocalDate, localDate, todayLocalDate } from '../../shared/local-date'
import { AsyncView, Field, Page } from '../../shared/ui'
import { ProgressChart } from '../progress/ProgressChart'
import { ClientTrainingSummaryCard } from '../progress/TrainingSummaryCard'
import { WorkoutExercisesSummary, WorkoutStatusBadge } from '../workouts'
import { clientWorkoutAuthorLabel } from './workout-author'

function useMine() {
  const query = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine() })
  useClientRealtime(query.data?.id)
  return query
}

export function MyWorkoutsPage() {
  const { actor } = useAuth()
  const mine = useMine()
  const trainers = useQuery({ queryKey: ['client-trainers', mine.data?.id], queryFn: () => invitationsRepository.listTrainers(mine.data!.id), enabled: Boolean(mine.data) })
  const workouts = useQuery({
    queryKey: ['workouts', mine.data?.id],
    queryFn: () => workoutsRepository.list(undefined, undefined, mine.data!.id),
    enabled: Boolean(mine.data),
  })
  const items = workouts.data ? splitClientWorkouts(workouts.data, todayLocalDate()) : null
  return <Page className="client-workouts-page" title="Мои тренировки" back="/me" action={mine.data && <Link className="button" to="/workouts/new">Добавить</Link>}><AsyncView loading={mine.isLoading || workouts.isLoading || trainers.isLoading} error={mine.error ?? workouts.error ?? trainers.error} onRetry={() => { void mine.refetch(); void workouts.refetch(); void trainers.refetch() }}>
    {items && <div className="client-workouts-stack"><section className="client-workout-section"><div className="client-workout-section-head"><p className="eyebrow">БЛИЖАЙШЕЕ</p><h2>Предстоит</h2></div>{items.upcoming.length ? <div className="cards client-workout-cards">{items.upcoming.map((workout) => <Link className="card client-workout-card" key={workout.id} to={`/workouts/${workout.id}`}><div><strong>{formatLocalDate(workout.workoutDate)}</strong><p className="muted">{clientWorkoutAuthorLabel(workout.createdBy, actor?.userId, trainers.data)}</p><WorkoutExercisesSummary workout={workout} /></div><WorkoutStatusBadge workout={workout} /></Link>)}</div> : <p className="client-section-empty">Нет запланированных тренировок</p>}</section>
    <section className="client-workout-section"><div className="client-workout-section-head"><p className="eyebrow">РЕЗУЛЬТАТЫ</p><h2>История</h2></div>{items.history.length ? <div className="cards client-workout-cards">{items.history.map((workout) => <Link className="card client-workout-card" key={workout.id} to={`/workouts/${workout.id}`}><div><strong>{formatLocalDate(workout.workoutDate)}</strong><p className="muted">{clientWorkoutAuthorLabel(workout.createdBy, actor?.userId, trainers.data)}</p><WorkoutExercisesSummary workout={workout} /></div><WorkoutStatusBadge workout={workout} /></Link>)}</div> : <p className="client-section-empty">История пока пуста</p>}</section></div>}
  </AsyncView></Page>
}

export function MyProgressPage() {
  const mine = useMine()
  const queryClient = useQueryClient()
  const entries = useQuery({ queryKey: ['progress', mine.data?.id], queryFn: () => progressRepository.list(mine.data!.id), enabled: Boolean(mine.data) })
  const save = useMutation({ mutationFn: (form: HTMLFormElement) => {
    const data = new FormData(form)
    const recordedOn = localDate(String(data.get('recordedOn')))
    if (recordedOn > todayLocalDate()) throw new Error('Нельзя добавить замер с будущей датой')
    return progressRepository.save({
      clientId: mine.data!.id,
      recordedOn,
      weightKg: numberValue(data.get('weightKg')),
      chestCm: numberValue(data.get('chestCm')),
      waistCm: numberValue(data.get('waistCm')),
      hipCm: numberValue(data.get('hipCm')),
      customMetrics: [],
    })
  }, onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['progress', mine.data?.id] }) })
  const remove = useMutation({ mutationFn: (entry: Parameters<typeof progressRepository.remove>[0]) => progressRepository.remove(entry), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['progress', mine.data?.id] }) })
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); save.mutate(event.currentTarget) }
  return <Page className="client-progress-page" title="Мой прогресс" back="/me"><AsyncView loading={mine.isLoading || entries.isLoading} error={mine.error ?? entries.error} onRetry={() => { void mine.refetch(); void entries.refetch() }}>
    {entries.data && mine.data && <div className="client-progress-stack"><ClientTrainingSummaryCard clientId={mine.data.id} /><section className="client-progress-form"><div className="client-progress-section-head"><p className="eyebrow">ЗАФИКСИРОВАТЬ РЕЗУЛЬТАТ</p><h2>Новый замер</h2></div><form className="stack compact" onSubmit={(event) => void submit(event)}>
      <Field label="Дата"><input name="recordedOn" type="date" max={todayLocalDate()} defaultValue={todayLocalDate()} required /></Field>
      <div className="measure-grid"><Field label="Вес, кг"><input name="weightKg" type="number" step="0.1" /></Field><Field label="Грудь, см"><input name="chestCm" type="number" step="0.1" /></Field><Field label="Талия, см"><input name="waistCm" type="number" step="0.1" /></Field><Field label="Бёдра, см"><input name="hipCm" type="number" step="0.1" /></Field></div>
      {save.error && <p className="error">{save.error.message}</p>}<button disabled={save.isPending}>Сохранить замер</button>
    </form></section>
    {entries.data.length > 0 ? <><ProgressChart entries={entries.data} metric="weightKg" label="Вес" unit="кг" windowEnd={null} onWindowChange={() => undefined} /><section className="client-progress-history"><div className="client-progress-section-head"><p className="eyebrow">ДИНАМИКА</p><h2>История замеров</h2></div><div className="cards">{entries.data.map((entry) => <article className="card" key={entry.id}><div><strong>{formatLocalDate(entry.recordedOn)}</strong><p>{entry.weightKg === undefined ? 'Вес не указан' : `${entry.weightKg} кг`}</p></div><button className="link danger" disabled={remove.isPending} onClick={() => remove.mutate(entry)}>Удалить</button></article>)}</div></section></> : <p className="client-section-empty">Замеров пока нет</p>}</div>}
  </AsyncView></Page>
}

function numberValue(value: FormDataEntryValue | null) {
  return value ? Number(value) : undefined
}
