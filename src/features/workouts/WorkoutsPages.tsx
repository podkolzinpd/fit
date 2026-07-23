import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { chartUnitFor, copyWorkout, exerciseChartPoints, splitClientWorkouts, workoutsRepository } from '../../data/repositories/workouts.repository'
import type { ExerciseSnapshot, LiveSetDraft, Workout, WorkoutDraft, WorkoutSet } from '../../shared/domain'
import { playGong } from '../../shared/gong'
import {
  addDays, dayOfMonth, formatLocalDate, localDate, startOfWeek, todayLocalDate, weekdayShort,
  type LocalDate,
} from '../../shared/local-date'
import { AsyncView, Field, Page } from '../../shared/ui'
import { ExercisePicker, useExerciseCatalog } from '../exercises'
import { VoiceNoteField } from '../voice-input'
import { WorkoutExerciseEditor } from './WorkoutExerciseEditor'
import { createLiveSetCoordinator } from './live-set-coordinator'

const HOURS = Array.from({ length: 24 }, (_, index) => index)
const HOUR_HEIGHT = 56

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function eventTime(workout: Workout): string {
  const start = workout.startTime?.slice(0, 5) ?? ''
  if (!workout.endTime) return start
  return `${start}–${workout.endTime.slice(0, 5)}`
}

export function SchedulePage() {
  const [params, setParams] = useSearchParams()
  const selected = params.get('date') ? localDate(params.get('date')!) : todayLocalDate()
  const today = todayLocalDate()
  const weekStart = startOfWeek(selected)
  const weekDays = useMemo(() => HOURS.slice(0, 7).map((offset) => addDays(weekStart, offset)), [weekStart])
  const scrollRef = useRef<HTMLDivElement>(null)

  function selectDate(date: LocalDate) { setParams({ date }) }
  function shiftWeek(direction: -1 | 1) { selectDate(addDays(selected, direction * 7)) }

  const query = useQuery({ queryKey: ['workouts', selected], queryFn: () => workoutsRepository.list(selected, selected) })
  const timed = (query.data ?? []).filter((workout) => workout.startTime).sort((a, b) => minutesOf(a.startTime!) - minutesOf(b.startTime!))
  const untimed = (query.data ?? []).filter((workout) => !workout.startTime)

  useEffect(() => {
    if (query.isLoading || !scrollRef.current) return
    const firstStart = timed[0] ? minutesOf(timed[0].startTime!.slice(0, 5)) : 7 * 60
    scrollRef.current.scrollTop = (Math.min(firstStart, 7 * 60) / 60) * HOUR_HEIGHT
  }, [query.isLoading, selected])

  return <Page className="schedule-page" title="Расписание" action={
    <div className="schedule-actions">
      <button type="button" className="secondary schedule-today" disabled={selected === today} onClick={() => selectDate(today)}>Сегодня</button>
      <label className="schedule-jump" aria-label="Выбрать дату">📅<input type="date" value={selected} onChange={(event) => event.target.value && selectDate(localDate(event.target.value))} /></label>
    </div>
  }>
    <div className="week-nav">
      <button type="button" className="secondary week-arrow" aria-label="Предыдущая неделя" onClick={() => shiftWeek(-1)}>‹</button>
      <div className="week-strip">
        {weekDays.map((day) => (
          <button key={day} type="button" className={day === selected ? 'week-day active' : 'week-day'} onClick={() => selectDate(day)}>
            <span className="day-label">{weekdayShort(day)}</span>
            <span className={day === today ? 'day-num today' : 'day-num'}>{dayOfMonth(day)}</span>
          </button>
        ))}
      </div>
      <button type="button" className="secondary week-arrow" aria-label="Следующая неделя" onClick={() => shiftWeek(1)}>›</button>
    </div>

    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      <div className="day-grid-scroll" ref={scrollRef}>
        {untimed.length > 0 && <div className="day-untimed">{untimed.map((workout) => (
          <Link key={workout.id} className="card" to={`/workouts/${workout.id}`}><div><strong>{workout.clientName}</strong><p>без времени</p></div><span className={`badge ${workout.status}`}>{statusLabel(workout.status)}</span></Link>
        ))}</div>}
        <div className="day-grid" style={{ height: HOURS.length * HOUR_HEIGHT }}>
          {HOURS.map((hour) => (
            <div key={hour} className="day-grid-hour" style={{ top: hour * HOUR_HEIGHT }}>
              <span className="day-grid-hour-label">{String(hour).padStart(2, '0')}:00</span>
              <div className="day-grid-hour-line" />
            </div>
          ))}
          {timed.map((workout) => {
            const startMin = minutesOf(workout.startTime!.slice(0, 5))
            const endMin = workout.endTime ? minutesOf(workout.endTime.slice(0, 5)) : startMin + 60
            const top = (startMin / 60) * HOUR_HEIGHT
            const height = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, 28)
            return <Link key={workout.id} className={`day-grid-event ${workout.status}`} style={{ top, height }} to={`/workouts/${workout.id}`}>
              <span className="day-grid-event-time">{eventTime(workout)}</span>
              <span className="day-grid-event-name">{workout.clientName}</span>
            </Link>
          })}
        </div>
      </div>
    </AsyncView>
  </Page>
}

function statusLabel(status: string) { return status === 'planned' ? 'План' : status === 'in_progress' ? 'Идёт' : 'Готово' }

export function ClientWorkoutsPage() {
  const { clientId = '' } = useParams()
  const query = useQuery({ queryKey: ['workouts', clientId], queryFn: () => workoutsRepository.list(undefined, undefined, clientId) })
  const history = query.data ? splitClientWorkouts(query.data, todayLocalDate()).history : []
  return <Page title="История тренировок" action={<Link className="button" to={`/workouts/new?client=${clientId}`}>Добавить</Link>}><AsyncView loading={query.isLoading} error={query.error} empty={!history.length} onRetry={() => void query.refetch()}><div className="cards">{history.map((workout) => <Link className="card" key={workout.id} to={`/workouts/${workout.id}`}><div><strong>{formatLocalDate(workout.workoutDate)}</strong><p>{workout.exercises.map((item) => item.name).join(', ') || 'Без упражнений'}</p></div><span className={`badge ${workout.status}`}>{statusLabel(workout.status)}</span></Link>)}</div></AsyncView></Page>
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
      <VoiceNoteField name="notes" defaultValue={initial?.notes ?? ''} />
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
  return <Page title="Тренировка"><AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>{query.data && <><section className="workout-title"><div><h2>{query.data.clientName}</h2><p>{formatLocalDate(query.data.workoutDate)} · {query.data.startTime?.slice(0, 5) ?? 'без времени'}</p></div><span className={`badge ${query.data.status}`}>{statusLabel(query.data.status)}</span></section><div className="cards">{query.data.exercises.map((exercise) => <article className="exercise" key={exercise.id}><Link className="exercise-name-link" to={`/workouts/${query.data!.id}/history/${encodeURIComponent(exercise.ref)}`}><strong>{exercise.name}</strong> <span className="exercise-name-hint">↗ история</span></Link>{exercise.sets.map((set) => <p key={set.id}>{formatSet(set)}</p>)}</article>)}</div>{query.data.notes && <p>{query.data.notes}</p>}<div className="actions">{query.data.status === 'planned' && <button onClick={() => start.mutate()}>Начать</button>}{query.data.status === 'in_progress' && <Link className="button" to={`/workouts/${workoutId}/live`}>Продолжить</Link>}{query.data.status === 'planned' && <Link className="button secondary" to={`/workouts/${workoutId}/edit`}>Изменить</Link>}<Link className="button secondary" to={`/workouts/new?copy=${workoutId}`}>Копировать</Link></div><button className="danger secondary wide" onClick={() => remove.mutate()}>Удалить тренировку</button></>}</AsyncView></Page>
}

function formatSet(set: WorkoutSet) { const plan = [set.weightKg && `${set.weightKg} кг`, set.reps && `${set.reps} повт.`, set.distanceKm && `${set.distanceKm} км`, set.durationMin && `${set.durationMin} мин`].filter(Boolean).join(' × '); return plan || 'Подход без плана' }

function LiveSetFields({ inputKind, set }: { inputKind: ExerciseSnapshot['inputKind']; set: WorkoutSet }) {
  if (inputKind === 'strength') return <div className="set-row"><input aria-label="Фактический вес" name="weightKg" type="number" min="0" step="0.5" defaultValue={set.fact.weightKg} placeholder={set.weightKg === undefined ? 'кг' : `${set.weightKg} кг`} /><input aria-label="Фактические повторы" name="reps" type="number" min="0" defaultValue={set.fact.reps} placeholder={set.reps === undefined ? 'повт.' : `${set.reps} повт.`} /></div>
  if (inputKind === 'reps') return <div className="set-row"><input aria-label="Фактическое время" name="durationMin" type="number" min="0" step="0.5" defaultValue={set.fact.durationMin} placeholder={set.durationMin === undefined ? 'мин' : `${set.durationMin} мин`} /><input aria-label="Фактические повторы" name="reps" type="number" min="0" defaultValue={set.fact.reps} placeholder={set.reps === undefined ? 'повт.' : `${set.reps} повт.`} /></div>
  return <div className="set-row"><input aria-label="Фактическое время" name="durationMin" type="number" min="0" step="0.5" defaultValue={set.fact.durationMin} placeholder={set.durationMin === undefined ? 'мин' : `${set.durationMin} мин`} /><input aria-label="Фактическая дистанция" name="distanceKm" type="number" min="0" step="0.1" defaultValue={set.fact.distanceKm} placeholder={set.distanceKm === undefined ? 'км' : `${set.distanceKm} км`} /></div>
}

const REST_SECONDS = 90

function formatRest(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function LiveWorkoutPage() {
  const { workoutId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['workout', workoutId], queryFn: () => workoutsRepository.get(workoutId) })
  const catalog = useExerciseCatalog()
  const [liveSets] = useState(() => createLiveSetCoordinator(
    (id, draft, version) => workoutsRepository.saveLiveSet(id, draft, version),
    (id, version) => workoutsRepository.confirmLiveSet(id, version),
  ))
  const skipBlurForSet = useRef<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [restRemaining, setRestRemaining] = useState<number | null>(null)
  const restEndsAt = useRef<number | null>(null)
  const save = useMutation({ mutationFn: ({ set, draft }: { set: WorkoutSet; draft: LiveSetDraft }) => liveSets.save(set, draft) })
  const confirm = useMutation({
    mutationFn: ({ set, draft }: { set: WorkoutSet; draft: LiveSetDraft }) => liveSets.confirm(set, draft),
    onSuccess: () => {
      startRest()
      void query.refetch()
    },
  })
  function startRest() {
    restEndsAt.current = Date.now() + REST_SECONDS * 1000
    setRestRemaining(REST_SECONDS)
  }
  function stopRest() {
    restEndsAt.current = null
    setRestRemaining(null)
  }
  const appendSet = useMutation({ mutationFn: (exerciseId: string) => workoutsRepository.appendLiveSet(query.data!, exerciseId), onSuccess: async () => { await query.refetch() } })
  const appendExercise = useMutation({ mutationFn: (exercise: ExerciseSnapshot) => workoutsRepository.appendLiveExercise(query.data!, exercise), onSuccess: async () => { await query.refetch() } })
  const finish = useMutation({ mutationFn: () => workoutsRepository.finish(query.data!), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['workout', workoutId] }); navigate(`/workouts/${workoutId}`) } })
  function draftFrom(form: HTMLFormElement): LiveSetDraft { const values = new FormData(form); return { weightKg: numberValue(values.get('weightKg')), reps: numberValue(values.get('reps')), distanceKm: numberValue(values.get('distanceKm')), durationMin: numberValue(values.get('durationMin')) } }
  // Derive the countdown from a wall-clock deadline so it stays correct even
  // when the tab is backgrounded and timers are throttled by the browser.
  const restActive = restRemaining !== null
  useEffect(() => {
    if (!restActive) return
    const timer = window.setInterval(() => {
      if (restEndsAt.current === null) return
      const left = Math.ceil((restEndsAt.current - Date.now()) / 1000)
      if (left <= 0) {
        restEndsAt.current = null
        setRestRemaining(null)
        playGong()
      } else {
        setRestRemaining(left)
      }
    }, 250)
    return () => window.clearInterval(timer)
  }, [restActive])
  const error = save.error ?? confirm.error ?? appendSet.error ?? appendExercise.error ?? finish.error
  return <Page title="Live-тренировка" action={<span className="live-dot">● LIVE</span>}>
    <AsyncView loading={query.isLoading} error={query.error}>{query.data && <>
      <p>{query.data.clientName} · черновик сохраняется отдельно от плана</p>
      {restRemaining !== null && <div className="rest-timer"><strong>Отдых {formatRest(restRemaining)}</strong><button type="button" className="link" onClick={stopRest}>Пропустить</button></div>}
      {query.data.exercises.map((exercise) => <section key={exercise.id}>
        <h2>{exercise.name}</h2>
        {exercise.sets.map((set, index) => <form className={`exercise ${set.confirmedAt ? 'confirmed' : ''}`} key={set.id} onBlur={(event) => {
          if (skipBlurForSet.current === set.id) { skipBlurForSet.current = null; return }
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
          save.mutate({ set, draft: draftFrom(event.currentTarget) })
        }}>
          <span className="muted">Подход {index + 1}</span>
          <LiveSetFields inputKind={exercise.inputKind} set={set} />
          <button type="button" className="secondary" disabled={Boolean(set.confirmedAt) || confirm.isPending}
            onPointerDown={() => { skipBlurForSet.current = set.id }}
            onClick={(event) => { const form = event.currentTarget.form; if (form) confirm.mutate({ set, draft: draftFrom(form) }); skipBlurForSet.current = null }}>{set.confirmedAt ? 'Подтверждено' : 'Готово, отдых'}</button>
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
  const inputKind = history.data?.[0]?.exercises.find((item) => item.ref === exerciseRef)?.inputKind ?? 'strength'
  const chart = useMemo(() => exerciseChartPoints(history.data ?? [], exerciseRef).map((point) => ({ date: point.date.slice(5), value: point.value })), [history.data, exerciseRef])
  const unit = chartUnitFor(inputKind)
  return <Page title="История упражнения" action={<Link className="button secondary" to={`/workouts/${workoutId}`}>← Назад</Link>}>
    <AsyncView loading={current.isLoading || history.isLoading} error={current.error ?? history.error} empty={!history.data?.length}>
      {chart.length > 1 && <section className="chart"><h2>Динамика ({unit})</h2><ResponsiveContainer width="100%" height={220}><LineChart data={chart}><XAxis dataKey="date" /><YAxis domain={['dataMin - 2', 'dataMax + 2']} /><Tooltip /><Line type="monotone" dataKey="value" stroke="#735cff" strokeWidth={3} /></LineChart></ResponsiveContainer></section>}
      <div className="timeline">{[...(history.data ?? [])].sort((a, b) => (a.workoutDate < b.workoutDate ? 1 : -1)).map((workout) => { const exercise = workout.exercises.find((item) => item.ref === exerciseRef); return <article key={workout.id} className="card"><div><strong>{formatLocalDate(workout.workoutDate)}</strong><p>{exercise?.sets.map(formatSet).join(', ')}</p></div></article> })}</div>
    </AsyncView>
  </Page>
}
