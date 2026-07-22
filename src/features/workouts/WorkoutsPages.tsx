import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { copyWorkout, workoutsRepository } from '../../data/repositories/workouts.repository'
import type { ExerciseSnapshot, LiveSetDraft, WorkoutDraft, WorkoutSet } from '../../shared/domain'
import { playGong } from '../../shared/gong'
import { formatLocalDate, localDate, todayLocalDate } from '../../shared/local-date'
import { AsyncView, Field, Page } from '../../shared/ui'
import { ExercisePicker, useExerciseCatalog } from '../exercises'
import { WorkoutExerciseEditor } from './WorkoutExerciseEditor'

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
  const { workoutId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const sourceId = workoutId ?? params.get('copy') ?? undefined
  const source = useQuery({ queryKey: ['workout', sourceId], queryFn: () => workoutsRepository.get(sourceId ?? ''), enabled: Boolean(sourceId) })
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false) })
  const catalog = useExerciseCatalog()
  const [draftExercises, setDraftExercises] = useState<WorkoutDraft['exercises'] | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const initial = source.data ? (workoutId ? { ...copyWorkout(source.data), id: source.data.id, version: source.data.version } : copyWorkout(source.data, todayLocalDate())) : undefined
  const exercises = draftExercises ?? initial?.exercises ?? []
  const mutation = useMutation({ mutationFn: (draft: WorkoutDraft) => workoutsRepository.save(draft), onSuccess: async (id) => { await queryClient.invalidateQueries({ queryKey: ['workouts'] }); navigate(`/workouts/${id}`) } })

  function addExercise(selected: ExerciseSnapshot) {
    setDraftExercises([...exercises, { ...selected, position: exercises.length, sets: [{ position: 0 }] }])
    setPickerOpen(false)
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    const clientId = String(form.get('clientId')); const date = localDate(String(form.get('date')))
    mutation.mutate({ id: workoutId, clientId, workoutDate: date, startTime: String(form.get('startTime') || '') || undefined,
      notes: String(form.get('notes') || '') || undefined, exercises, version: source.data?.version })
  }
  const loading = source.isLoading || clients.isLoading
  const error = source.error ?? clients.error
  return <Page title={workoutId ? 'Редактировать тренировку' : params.has('copy') ? 'Копия тренировки' : 'Новая тренировка'}>
    <AsyncView loading={loading} error={error}><form className="stack" onSubmit={(event) => void submit(event)}>
      <Field label="Клиент"><select name="clientId" defaultValue={initial?.clientId ?? params.get('client') ?? ''} required><option value="">Выберите</option>{clients.data?.map((client) => <option key={client.id} value={client.id}>{client.fullName}</option>)}</select></Field>
      <div className="split"><Field label="Дата"><input name="date" type="date" defaultValue={initial?.workoutDate ?? todayLocalDate()} required /></Field><Field label="Время"><input name="startTime" type="time" defaultValue={initial?.startTime ?? ''} /></Field></div>
      <Field label="Заметка"><textarea name="notes" defaultValue={initial?.notes ?? ''} /></Field>
      <WorkoutExerciseEditor exercises={exercises} onChange={setDraftExercises} onOpenPicker={() => setPickerOpen(true)} />
      {mutation.error && <p className="error">{mutation.error.message}</p>}
      <div className="actions"><button type="button" className="secondary" onClick={() => navigate(-1)}>Отмена</button><button disabled={mutation.isPending}>Сохранить</button></div>
    </form></AsyncView>
    {pickerOpen && <ExercisePicker catalog={catalog} onPick={addExercise} onClose={() => setPickerOpen(false)} />}
  </Page>
}

export function WorkoutDetailPage() {
  const { workoutId = '' } = useParams(); const navigate = useNavigate(); const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['workout', workoutId], queryFn: () => workoutsRepository.get(workoutId) })
  const start = useMutation({ mutationFn: () => workoutsRepository.start(query.data!), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['workout', workoutId] }); navigate(`/workouts/${workoutId}/live`) } })
  const remove = useMutation({ mutationFn: () => workoutsRepository.remove(query.data!), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['workouts'] }); navigate('/schedule') } })
  return <Page title="Тренировка"><AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>{query.data && <><section className="workout-title"><div><h2>{query.data.clientName}</h2><p>{formatLocalDate(query.data.workoutDate)} · {query.data.startTime?.slice(0, 5) ?? 'без времени'}</p></div><span className={`badge ${query.data.status}`}>{statusLabel(query.data.status)}</span></section><div className="cards">{query.data.exercises.map((exercise) => <article className="exercise" key={exercise.id}><strong>{exercise.name}</strong>{exercise.sets.map((set) => <p key={set.id}>{formatSet(set)}</p>)}<Link to={`/workouts/${query.data!.id}/history/${encodeURIComponent(exercise.ref)}`}>История упражнения</Link></article>)}</div>{query.data.notes && <p>{query.data.notes}</p>}<div className="actions">{query.data.status === 'planned' && <button onClick={() => start.mutate()}>Начать</button>}{query.data.status === 'in_progress' && <Link className="button" to={`/workouts/${workoutId}/live`}>Продолжить</Link>}{query.data.status === 'planned' && <Link className="button secondary" to={`/workouts/${workoutId}/edit`}>Изменить</Link>}<Link className="button secondary" to={`/workouts/new?copy=${workoutId}`}>Копировать</Link></div><button className="danger secondary wide" onClick={() => remove.mutate()}>Удалить тренировку</button></>}</AsyncView></Page>
}

function formatSet(set: WorkoutSet) { const plan = [set.weightKg && `${set.weightKg} кг`, set.reps && `${set.reps} повт.`, set.distanceKm && `${set.distanceKm} км`, set.durationMin && `${set.durationMin} мин`].filter(Boolean).join(' × '); return plan || 'Подход без плана' }

function LiveSetFields({ inputKind, set }: { inputKind: ExerciseSnapshot['inputKind']; set: WorkoutSet }) {
  if (inputKind === 'strength') return <div className="set-row"><input aria-label="Фактический вес" name="weightKg" type="number" min="0" step="0.5" defaultValue={set.fact.weightKg} placeholder={set.weightKg === undefined ? 'кг' : `${set.weightKg} кг`} /><input aria-label="Фактические повторы" name="reps" type="number" min="0" defaultValue={set.fact.reps} placeholder={set.reps === undefined ? 'повт.' : `${set.reps} повт.`} /></div>
  if (inputKind === 'reps') return <div className="set-row"><input aria-label="Фактическое время" name="durationMin" type="number" min="0" step="0.5" defaultValue={set.fact.durationMin} placeholder={set.durationMin === undefined ? 'мин' : `${set.durationMin} мин`} /><input aria-label="Фактические повторы" name="reps" type="number" min="0" defaultValue={set.fact.reps} placeholder={set.reps === undefined ? 'повт.' : `${set.reps} повт.`} /></div>
  return <div className="set-row"><input aria-label="Фактическое время" name="durationMin" type="number" min="0" step="0.5" defaultValue={set.fact.durationMin} placeholder={set.durationMin === undefined ? 'мин' : `${set.durationMin} мин`} /><input aria-label="Фактическая дистанция" name="distanceKm" type="number" min="0" step="0.1" defaultValue={set.fact.distanceKm} placeholder={set.distanceKm === undefined ? 'км' : `${set.distanceKm} км`} /></div>
}

function formatRest(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function LiveWorkoutPage() {
  const { workoutId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['workout', workoutId], queryFn: () => workoutsRepository.get(workoutId) })
  const catalog = useExerciseCatalog()
  const [versions, setVersions] = useState<Record<string, number>>({})
  const [pickerOpen, setPickerOpen] = useState(false)
  const [restRemaining, setRestRemaining] = useState<number | null>(null)
  const save = useMutation({ mutationFn: ({ set, draft }: { set: WorkoutSet; draft: LiveSetDraft }) => workoutsRepository.saveLiveSet(set.id, draft, versions[set.id] ?? set.version), onSuccess: (version, variables) => setVersions((current) => ({ ...current, [variables.set.id]: version })) })
  const confirm = useMutation({
    mutationFn: async ({ set, draft }: { set: WorkoutSet; draft: LiveSetDraft }) => {
      const savedVersion = await workoutsRepository.saveLiveSet(set.id, draft, versions[set.id] ?? set.version)
      return workoutsRepository.confirmLiveSet(set.id, savedVersion)
    },
    onSuccess: (version, variables) => {
      setVersions((current) => ({ ...current, [variables.set.id]: version }))
      setRestRemaining(90)
      void query.refetch()
    },
  })
  const appendSet = useMutation({ mutationFn: (exerciseId: string) => workoutsRepository.appendLiveSet(query.data!, exerciseId), onSuccess: async () => { await query.refetch() } })
  const appendExercise = useMutation({ mutationFn: (exercise: ExerciseSnapshot) => workoutsRepository.appendLiveExercise(query.data!, exercise), onSuccess: async () => { await query.refetch() } })
  const finish = useMutation({ mutationFn: () => workoutsRepository.finish(query.data!), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['workout', workoutId] }); navigate(`/workouts/${workoutId}`) } })
  function draftFrom(form: HTMLFormElement): LiveSetDraft { const values = new FormData(form); return { weightKg: numberValue(values.get('weightKg')), reps: numberValue(values.get('reps')), distanceKm: numberValue(values.get('distanceKm')), durationMin: numberValue(values.get('durationMin')) } }
  useEffect(() => {
    if (restRemaining === null) return
    if (restRemaining === 0) { playGong(); setRestRemaining(null); return }
    const timer = window.setTimeout(() => setRestRemaining((current) => current === null ? null : current - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [restRemaining])
  const error = save.error ?? confirm.error ?? appendSet.error ?? appendExercise.error ?? finish.error
  return <Page title="Live-тренировка" action={<span className="live-dot">● LIVE</span>}>
    <AsyncView loading={query.isLoading} error={query.error}>{query.data && <>
      <p>{query.data.clientName} · черновик сохраняется отдельно от плана</p>
      {restRemaining !== null && <div className="rest-timer"><strong>Отдых {formatRest(restRemaining)}</strong><button type="button" className="link" onClick={() => setRestRemaining(null)}>Пропустить</button></div>}
      {query.data.exercises.map((exercise) => <section key={exercise.id}>
        <h2>{exercise.name}</h2>
        {exercise.sets.map((set, index) => <form className={`exercise ${set.confirmedAt ? 'confirmed' : ''}`} key={set.id} onBlur={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
          save.mutate({ set, draft: draftFrom(event.currentTarget) })
        }}>
          <span className="muted">Подход {index + 1}</span>
          <LiveSetFields inputKind={exercise.inputKind} set={set} />
          <button type="button" className="secondary" disabled={Boolean(set.confirmedAt) || confirm.isPending} onClick={(event) => { const form = event.currentTarget.form; if (form) confirm.mutate({ set, draft: draftFrom(form) }) }}>{set.confirmedAt ? 'Подтверждено' : 'Готово, отдых'}</button>
        </form>)}
        <button type="button" className="secondary" disabled={appendSet.isPending} onClick={() => appendSet.mutate(exercise.id)}>＋ Подход</button>
      </section>)}
      <button type="button" className="secondary wide" onClick={() => setPickerOpen(true)}>＋ Ещё упражнение</button>
      {error && <p className="error">{error.message}</p>}
      <button className="wide" disabled={finish.isPending} onClick={() => { const incomplete = query.data!.exercises.some((exercise) => exercise.sets.some((set) => !set.confirmedAt)); if (!incomplete || window.confirm('Есть незавершённые подходы. Завершить тренировку частично?')) finish.mutate() }}>Завершить тренировку</button>
    </>}</AsyncView>
    {pickerOpen && <ExercisePicker catalog={catalog} onPick={(exercise) => { setPickerOpen(false); appendExercise.mutate(exercise) }} onClose={() => setPickerOpen(false)} />}
  </Page>
}

function numberValue(value: FormDataEntryValue | null) { return value ? Number(value) : undefined }

export function ExerciseHistoryPage() {
  const { workoutId = '', exerciseRef = '' } = useParams()
  const current = useQuery({ queryKey: ['workout', workoutId], queryFn: () => workoutsRepository.get(workoutId) })
  const history = useQuery({ queryKey: ['exercise-history', current.data?.clientId, exerciseRef], queryFn: async () => (await workoutsRepository.list(undefined, undefined, current.data!.clientId)).filter((workout) => workout.status === 'done' && workout.exercises.some((exercise) => exercise.ref === exerciseRef)), enabled: Boolean(current.data) })
  return <Page title="История упражнения" action={<Link className="button secondary" to={`/workouts/${workoutId}`}>← Назад</Link>}><AsyncView loading={current.isLoading || history.isLoading} error={current.error ?? history.error} empty={!history.data?.length}><div className="timeline">{history.data?.map((workout) => { const exercise = workout.exercises.find((item) => item.ref === exerciseRef); return <article key={workout.id} className="card"><div><strong>{formatLocalDate(workout.workoutDate)}</strong><p>{exercise?.sets.map(formatSet).join(', ')}</p></div></article> })}</div></AsyncView></Page>
}
