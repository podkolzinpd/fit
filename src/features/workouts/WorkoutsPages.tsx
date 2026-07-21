import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { exercisesRepository } from '../../data/repositories/exercises.repository'
import { copyWorkout, workoutsRepository } from '../../data/repositories/workouts.repository'
import type { ExerciseSnapshot, LiveSetDraft, WorkoutDraft, WorkoutExerciseDraft, WorkoutSet } from '../../shared/domain'
import { formatLocalDate, localDate, todayLocalDate } from '../../shared/local-date'
import { AsyncView, Field, Page } from '../../shared/ui'

export function SchedulePage() {
  const query = useQuery({ queryKey: ['workouts'], queryFn: () => workoutsRepository.list() })
  const byDate = useMemo(() => (query.data ?? []).reduce<Record<string, typeof query.data>>((groups, item) => {
    groups[item.workoutDate] = [...(groups[item.workoutDate] ?? []), item]
    return groups
  }, {}), [query.data])
  return <Page title="Расписание" action={<Link className="button" to="/workouts/new">Добавить</Link>}>
    <AsyncView loading={query.isLoading} error={query.error} empty={!query.data?.length} onRetry={() => void query.refetch()}>
      <div className="timeline">{Object.entries(byDate).map(([date, workouts]) => <section key={date}><h2>{formatLocalDate(localDate(date))}</h2>{workouts?.map((workout) => <Link className="card" to={`/workouts/${workout.id}`} key={workout.id}><div><strong>{workout.startTime?.slice(0, 5) ?? 'Без времени'} · {workout.clientName}</strong><p>{workout.exercises.length} упражнений</p></div><span className={`badge ${workout.status}`}>{statusLabel(workout.status)}</span></Link>)}</section>)}</div>
    </AsyncView>
  </Page>
}

function statusLabel(status: string) { return status === 'planned' ? 'План' : status === 'in_progress' ? 'Идёт' : 'Готово' }

export function ClientWorkoutsPage() {
  const { clientId = '' } = useParams()
  const query = useQuery({ queryKey: ['workouts', clientId], queryFn: () => workoutsRepository.list(undefined, undefined, clientId) })
  return <Page title="Тренировки" action={<Link className="button" to={`/workouts/new?client=${clientId}`}>Добавить</Link>}><AsyncView loading={query.isLoading} error={query.error} empty={!query.data?.length} onRetry={() => void query.refetch()}><div className="cards">{query.data?.map((workout) => <Link className="card" key={workout.id} to={`/workouts/${workout.id}`}><div><strong>{formatLocalDate(workout.workoutDate)}</strong><p>{workout.exercises.map((item) => item.name).join(', ') || 'Без упражнений'}</p></div><span className={`badge ${workout.status}`}>{statusLabel(workout.status)}</span></Link>)}</div></AsyncView></Page>
}

export function WorkoutFormPage() {
  const { workoutId } = useParams(); const [params] = useSearchParams(); const navigate = useNavigate(); const queryClient = useQueryClient()
  const sourceId = workoutId ?? params.get('copy') ?? undefined
  const source = useQuery({ queryKey: ['workout', sourceId], queryFn: () => workoutsRepository.get(sourceId ?? ''), enabled: Boolean(sourceId) })
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false) })
  const custom = useQuery({ queryKey: ['exercises'], queryFn: () => exercisesRepository.list() })
  const [draftExercises, setDraftExercises] = useState<WorkoutExerciseDraft[] | null>(null)
  const initial = source.data ? (workoutId ? { ...copyWorkout(source.data), id: source.data.id, version: source.data.version } : copyWorkout(source.data, todayLocalDate())) : undefined
  const exercises = draftExercises ?? initial?.exercises ?? []
  const allExercises: readonly ExerciseSnapshot[] = [...exercisesRepository.system, ...(custom.data?.filter((item) => !item.archivedAt) ?? [])]
  const mutation = useMutation({ mutationFn: (draft: WorkoutDraft) => workoutsRepository.save(draft), onSuccess: async (id) => { await queryClient.invalidateQueries({ queryKey: ['workouts'] }); navigate(`/workouts/${id}`) } })

  function addExercise(ref: string) {
    const selected = allExercises.find((item) => item.ref === ref); if (!selected) return
    setDraftExercises([...exercises, { ...selected, position: exercises.length, sets: [{ position: 0 }] }])
  }
  function updateSet(index: number, value: Partial<WorkoutSet>) {
    setDraftExercises(exercises.map((exercise, current) => current === index ? { ...exercise, sets: [{ ...exercise.sets[0], position: 0, ...value }] } : exercise))
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    const clientId = String(form.get('clientId')); const date = localDate(String(form.get('date')))
    mutation.mutate({ id: workoutId, clientId, workoutDate: date, startTime: String(form.get('startTime') || '') || undefined,
      notes: String(form.get('notes') || '') || undefined, exercises, version: source.data?.version })
  }
  const loading = source.isLoading || clients.isLoading || custom.isLoading
  const error = source.error ?? clients.error ?? custom.error
  return <Page title={workoutId ? 'Редактировать тренировку' : params.has('copy') ? 'Копия тренировки' : 'Новая тренировка'}><AsyncView loading={loading} error={error}><form className="stack" onSubmit={(event) => void submit(event)}>
    <Field label="Клиент"><select name="clientId" defaultValue={initial?.clientId ?? params.get('client') ?? ''} required><option value="">Выберите</option>{clients.data?.map((client) => <option key={client.id} value={client.id}>{client.fullName}</option>)}</select></Field>
    <div className="split"><Field label="Дата"><input name="date" type="date" defaultValue={initial?.workoutDate ?? todayLocalDate()} required /></Field><Field label="Время"><input name="startTime" type="time" defaultValue={initial?.startTime ?? ''} /></Field></div>
    <Field label="Заметка"><textarea name="notes" defaultValue={initial?.notes ?? ''} /></Field>
    <section><h2>Упражнения</h2>{exercises.map((exercise, index) => <article className="exercise" key={`${exercise.ref}-${index}`}><header><strong>{exercise.name}</strong><button type="button" className="link danger" onClick={() => setDraftExercises(exercises.filter((_, position) => position !== index).map((item, position) => ({ ...item, position })))}>Удалить</button></header><div className="set-row">{exercise.inputKind === 'strength' && <><input aria-label="Вес" type="number" step="0.5" placeholder="кг" defaultValue={exercise.sets[0]?.weightKg} onBlur={(e) => updateSet(index, { weightKg: e.target.value ? Number(e.target.value) : undefined })} /><input aria-label="Повторы" type="number" placeholder="повт." defaultValue={exercise.sets[0]?.reps} onBlur={(e) => updateSet(index, { reps: e.target.value ? Number(e.target.value) : undefined })} /></>}{exercise.inputKind === 'reps' && <input aria-label="Повторы" type="number" placeholder="повт." defaultValue={exercise.sets[0]?.reps} onBlur={(e) => updateSet(index, { reps: e.target.value ? Number(e.target.value) : undefined })} />}{exercise.inputKind === 'distance' && <><input aria-label="Расстояние" type="number" step="0.1" placeholder="км" defaultValue={exercise.sets[0]?.distanceKm} onBlur={(e) => updateSet(index, { distanceKm: e.target.value ? Number(e.target.value) : undefined })} /><input aria-label="Время" type="number" step="0.5" placeholder="мин" defaultValue={exercise.sets[0]?.durationMin} onBlur={(e) => updateSet(index, { durationMin: e.target.value ? Number(e.target.value) : undefined })} /></>}</div></article>)}<select aria-label="Добавить упражнение" value="" onChange={(event) => addExercise(event.target.value)}><option value="">＋ Добавить упражнение</option>{allExercises.map((exercise) => <option key={exercise.ref} value={exercise.ref}>{exercise.name}</option>)}</select></section>
    {mutation.error && <p className="error">{mutation.error.message}</p>}<div className="actions"><button type="button" className="secondary" onClick={() => navigate(-1)}>Отмена</button><button disabled={mutation.isPending}>Сохранить</button></div>
  </form></AsyncView></Page>
}

export function WorkoutDetailPage() {
  const { workoutId = '' } = useParams(); const navigate = useNavigate(); const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['workout', workoutId], queryFn: () => workoutsRepository.get(workoutId) })
  const start = useMutation({ mutationFn: () => workoutsRepository.start(query.data!), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['workout', workoutId] }); navigate(`/workouts/${workoutId}/live`) } })
  const remove = useMutation({ mutationFn: () => workoutsRepository.remove(query.data!), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['workouts'] }); navigate('/schedule') } })
  return <Page title="Тренировка"><AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>{query.data && <><section className="workout-title"><div><h2>{query.data.clientName}</h2><p>{formatLocalDate(query.data.workoutDate)} · {query.data.startTime?.slice(0, 5) ?? 'без времени'}</p></div><span className={`badge ${query.data.status}`}>{statusLabel(query.data.status)}</span></section><div className="cards">{query.data.exercises.map((exercise) => <article className="exercise" key={exercise.id}><strong>{exercise.name}</strong>{exercise.sets.map((set) => <p key={set.id}>{formatSet(set)}</p>)}<Link to={`/workouts/${query.data!.id}/history/${encodeURIComponent(exercise.ref)}`}>История упражнения</Link></article>)}</div>{query.data.notes && <p>{query.data.notes}</p>}<div className="actions">{query.data.status === 'planned' && <button onClick={() => start.mutate()}>Начать</button>}{query.data.status === 'in_progress' && <Link className="button" to={`/workouts/${workoutId}/live`}>Продолжить</Link>}{query.data.status === 'planned' && <Link className="button secondary" to={`/workouts/${workoutId}/edit`}>Изменить</Link>}<Link className="button secondary" to={`/workouts/new?copy=${workoutId}`}>Копировать</Link></div><button className="danger secondary" onClick={() => remove.mutate()}>Удалить</button></>}</AsyncView></Page>
}

function formatSet(set: WorkoutSet) { const plan = [set.weightKg && `${set.weightKg} кг`, set.reps && `${set.reps} повт.`, set.distanceKm && `${set.distanceKm} км`, set.durationMin && `${set.durationMin} мин`].filter(Boolean).join(' × '); return plan || 'Подход без плана' }

export function LiveWorkoutPage() {
  const { workoutId = '' } = useParams(); const navigate = useNavigate(); const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['workout', workoutId], queryFn: () => workoutsRepository.get(workoutId) })
  const [versions, setVersions] = useState<Record<string, number>>({})
  const save = useMutation({ mutationFn: ({ set, draft }: { set: WorkoutSet; draft: LiveSetDraft }) => workoutsRepository.saveLiveSet(set.id, draft, versions[set.id] ?? set.version), onSuccess: (version, variables) => setVersions((current) => ({ ...current, [variables.set.id]: version })) })
  const confirm = useMutation({ mutationFn: (set: WorkoutSet) => workoutsRepository.confirmLiveSet(set.id, versions[set.id] ?? set.version), onSuccess: (version, set) => { setVersions((current) => ({ ...current, [set.id]: version })); void query.refetch() } })
  const finish = useMutation({ mutationFn: () => workoutsRepository.finish(query.data!), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['workout', workoutId] }); navigate(`/workouts/${workoutId}`) } })
  function draftFrom(form: HTMLFormElement): LiveSetDraft { const values = new FormData(form); return { weightKg: numberValue(values.get('weightKg')), reps: numberValue(values.get('reps')), distanceKm: numberValue(values.get('distanceKm')), durationMin: numberValue(values.get('durationMin')) } }
  return <Page title="Live-тренировка" action={<span className="live-dot">● LIVE</span>}><AsyncView loading={query.isLoading} error={query.error}>{query.data && <><p>{query.data.clientName} · черновик сохраняется отдельно от плана</p>{query.data.exercises.map((exercise) => <section key={exercise.id}><h2>{exercise.name}</h2>{exercise.sets.map((set) => <form className={`exercise ${set.confirmedAt ? 'confirmed' : ''}`} key={set.id} onBlur={(event) => void save.mutate({ set, draft: draftFrom(event.currentTarget) })}><div className="set-row"><input name="weightKg" type="number" step="0.5" defaultValue={set.fact.weightKg} placeholder={set.weightKg ? `${set.weightKg} кг` : 'кг'} /><input name="reps" type="number" defaultValue={set.fact.reps} placeholder={set.reps ? `${set.reps} повт.` : 'повт.'} /><input name="distanceKm" type="number" step="0.1" defaultValue={set.fact.distanceKm} placeholder="км" /><input name="durationMin" type="number" step="0.5" defaultValue={set.fact.durationMin} placeholder="мин" /></div><button type="button" className="secondary" disabled={Boolean(set.confirmedAt)} onClick={() => confirm.mutate(set)}>{set.confirmedAt ? 'Подтверждено' : 'Подтвердить подход'}</button></form>)}</section>)}{(save.error ?? confirm.error ?? finish.error) && <p className="error">{(save.error ?? confirm.error ?? finish.error)?.message}</p>}<button className="wide" onClick={() => { const incomplete = query.data!.exercises.some((exercise) => exercise.sets.some((set) => !set.confirmedAt)); if (!incomplete || window.confirm('Есть незавершённые подходы. Завершить тренировку частично?')) finish.mutate() }}>Завершить тренировку</button></>}</AsyncView></Page>
}

function numberValue(value: FormDataEntryValue | null) { return value ? Number(value) : undefined }

export function ExerciseHistoryPage() {
  const { workoutId = '', exerciseRef = '' } = useParams()
  const current = useQuery({ queryKey: ['workout', workoutId], queryFn: () => workoutsRepository.get(workoutId) })
  const history = useQuery({ queryKey: ['exercise-history', current.data?.clientId, exerciseRef], queryFn: async () => (await workoutsRepository.list(undefined, undefined, current.data!.clientId)).filter((workout) => workout.status === 'done' && workout.exercises.some((exercise) => exercise.ref === exerciseRef)), enabled: Boolean(current.data) })
  return <Page title="История упражнения"><AsyncView loading={current.isLoading || history.isLoading} error={current.error ?? history.error} empty={!history.data?.length}><div className="timeline">{history.data?.map((workout) => { const exercise = workout.exercises.find((item) => item.ref === exerciseRef); return <article key={workout.id} className="card"><div><strong>{formatLocalDate(workout.workoutDate)}</strong><p>{exercise?.sets.map(formatSet).join(', ')}</p></div></article> })}</div></AsyncView></Page>
}
