import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { chartUnitFor, copyWorkout, exerciseChartPoints, muscleGroupLabels, splitClientWorkouts, tonnageLabel, workoutDurationLabel, workoutTonnage, workoutsRepository } from '../../data/repositories/workouts.repository'
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
import { LoadMoreButton } from './LoadMoreButton'
import { workoutCountLabel } from './workout-count-label'

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

  const query = useInfiniteQuery({
    queryKey: ['workouts', selected],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => workoutsRepository.listPage(selected, selected, undefined, pageParam),
    getNextPageParam: (page) => page.nextOffset,
  })
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data])
  const totalCount = query.data?.pages[0]?.totalCount ?? 0
  const timed = items.filter((workout) => workout.startTime).sort((a, b) => minutesOf(a.startTime!) - minutesOf(b.startTime!))
  const untimed = items.filter((workout) => !workout.startTime)

  useEffect(() => {
    if (query.isLoading || !scrollRef.current) return
    const firstStart = timed[0] ? minutesOf(timed[0].startTime!.slice(0, 5)) : 7 * 60
    scrollRef.current.scrollTop = (Math.min(firstStart, 7 * 60) / 60) * HOUR_HEIGHT
  }, [query.isLoading, selected])

  return <Page className="schedule-page" title="Расписание" action={
     <div className="schedule-actions">
       <span className="schedule-count">{query.isLoading ? 'Загружаем…' : workoutCountLabel(totalCount)}</span>
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
          <Link key={workout.id} className="card" to={`/workouts/${workout.id}`}><div><strong>{workout.clientName}</strong><p>{muscleGroupLabels(workout).join(', ') || 'без времени'}</p></div><span className={`badge ${workout.status}`}>{statusLabel(workout.status)}</span></Link>
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
            const groups = muscleGroupLabels(workout).join(', ')
            return <Link key={workout.id} className={`day-grid-event ${workout.status}`} style={{ top, height }} to={`/workouts/${workout.id}`}>
              <span className="day-grid-event-time">{eventTime(workout)}</span>
              <span className="day-grid-event-name">{workout.clientName}</span>
              {groups && <span className="day-grid-event-groups">{groups}</span>}
            </Link>
          })}
         </div>
       </div>
       <LoadMoreButton hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onLoadMore={() => void query.fetchNextPage()} />
     </AsyncView>
  </Page>
}

function statusLabel(status: string) { return status === 'planned' ? 'План' : status === 'in_progress' ? 'Идёт' : 'Готово' }

export function ClientWorkoutsPage() {
  const { clientId = '' } = useParams()
  const query = useInfiniteQuery({
    queryKey: ['workouts', clientId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => workoutsRepository.listPage(undefined, undefined, clientId, pageParam),
    getNextPageParam: (page) => page.nextOffset,
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const history = splitClientWorkouts(items, todayLocalDate()).history
  return <Page title="История тренировок" back={`/clients/${clientId}`} action={<Link className="button" to={`/workouts/new?client=${clientId}`}>Добавить</Link>}><AsyncView loading={query.isLoading} error={query.error} empty={!history.length} onRetry={() => void query.refetch()}><div className="cards">{history.map((workout) => {
    const duration = workoutDurationLabel(workout.startedAt, workout.completedAt)
    const tonnage = workoutTonnage(workout)
    const meta = workout.status === 'done' ? [duration, tonnage > 0 ? tonnageLabel(tonnage) : null].filter(Boolean).join(' · ') : ''
    return <Link className="card" key={workout.id} to={`/workouts/${workout.id}`}><div><strong>{formatLocalDate(workout.workoutDate)}</strong><p>{muscleGroupLabels(workout).join(', ') || 'Без упражнений'}</p>{meta && <p className="card-meta">{meta}</p>}</div><span className={`badge ${workout.status}`}>{statusLabel(workout.status)}</span></Link>
  })}</div><LoadMoreButton hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onLoadMore={() => void query.fetchNextPage()} /></AsyncView></Page>
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
  return <Page title={workoutId ? 'Редактировать тренировку' : params.has('copy') ? 'Копия тренировки' : 'Новая тренировка'} back={-1}>
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
  const workout = query.data
  const done = workout?.status === 'done'
  const duration = workout ? workoutDurationLabel(workout.startedAt, workout.completedAt) : null
  const groups = workout ? muscleGroupLabels(workout) : []
  const tonnage = workout ? workoutTonnage(workout) : 0
  // Явный путь назад (история тренировок клиента), а не -1 по истории браузера:
  // -1 создавал петлю тренировка ↔ история упражнения после захода в аналитику.
  const backTo = workout ? `/clients/${workout.clientId}/workouts` : undefined
  return <Page title="Тренировка" back={backTo}>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>{workout && <>
      <section className="workout-title">
        <div><h2>{workout.clientName}</h2><p>{formatLocalDate(workout.workoutDate)} · {workout.startTime?.slice(0, 5) ?? 'без времени'}</p></div>
        <span className={`badge ${workout.status}`}>{statusLabel(workout.status)}</span>
      </section>
      {workout.status === 'planned' && <button className="wide" onClick={() => start.mutate()}>Начать тренировку</button>}
      {workout.status === 'in_progress' && <Link className="button wide" to={`/workouts/${workoutId}/live`}>Продолжить тренировку</Link>}
      {done && <section className="summary done-summary done-summary-3">
        <div><span>Время</span><strong>{duration ?? '—'}</strong></div>
        <div><span>Тоннаж</span><strong>{tonnageLabel(tonnage)}</strong></div>
        <div><span>Группы мышц</span><strong>{groups.length ? groups.join(', ') : '—'}</strong></div>
      </section>}
      <div className="cards">{workout.exercises.map((exercise) => <article className="exercise" key={exercise.id}>
        <Link className="exercise-name-link" to={`/workouts/${workout.id}/history/${encodeURIComponent(exercise.ref)}`}><strong>{exercise.name}</strong> <span className="exercise-name-hint">↗ история</span></Link>
        {exercise.sets.map((set) => <p key={set.id}>{done ? formatFactSet(set) : formatSet(set)}</p>)}
      </article>)}</div>
      {workout.notes && <p>{workout.notes}</p>}
      <div className="actions">
        {workout.status === 'planned' && <Link className="button secondary" to={`/workouts/${workoutId}/edit`}>Изменить</Link>}
        <Link className="button secondary" to={`/workouts/new?copy=${workoutId}`}>Копировать</Link>
      </div>
      <button className="danger secondary wide" onClick={() => remove.mutate()}>Удалить тренировку</button>
    </>}</AsyncView>
  </Page>
}

function formatSet(set: WorkoutSet) { const plan = [set.weightKg && `${set.weightKg} кг`, set.reps && `${set.reps} повт.`, set.distanceKm && `${set.distanceKm} км`, set.durationMin && `${set.durationMin} мин`].filter(Boolean).join(' × '); return plan || 'Подход без плана' }

// Actual result of a set (fact), falling back to the plan when a value wasn't
// recorded live — so completed workouts still show вес × повторы.
function formatFactSet(set: WorkoutSet) {
  const weight = set.fact.weightKg ?? set.weightKg
  const reps = set.fact.reps ?? set.reps
  const distance = set.fact.distanceKm ?? set.distanceKm
  const duration = set.fact.durationMin ?? set.durationMin
  const parts = [weight && `${weight} кг`, reps && `${reps} повт.`, distance && `${distance} км`, duration && `${duration} мин`].filter(Boolean)
  return parts.join(' × ') || 'Без результата'
}


function LiveSetFields({ inputKind, set }: { inputKind: ExerciseSnapshot['inputKind']; set: WorkoutSet }) {
  if (inputKind === 'strength') return <div className="set-row"><input aria-label="Фактический вес" name="weightKg" type="number" min="0" step="0.5" defaultValue={set.fact.weightKg} placeholder={set.weightKg === undefined ? 'кг' : `${set.weightKg} кг`} /><input aria-label="Фактические повторы" name="reps" type="number" min="0" defaultValue={set.fact.reps} placeholder={set.reps === undefined ? 'повт.' : `${set.reps} повт.`} /></div>
  if (inputKind === 'reps') return <div className="set-row"><input aria-label="Фактическое время" name="durationMin" type="number" min="0" step="0.5" defaultValue={set.fact.durationMin} placeholder={set.durationMin === undefined ? 'мин' : `${set.durationMin} мин`} /><input aria-label="Фактические повторы" name="reps" type="number" min="0" defaultValue={set.fact.reps} placeholder={set.reps === undefined ? 'повт.' : `${set.reps} повт.`} /></div>
  return <div className="set-row"><input aria-label="Фактическое время" name="durationMin" type="number" min="0" step="0.5" defaultValue={set.fact.durationMin} placeholder={set.durationMin === undefined ? 'мин' : `${set.durationMin} мин`} /><input aria-label="Фактическая дистанция" name="distanceKm" type="number" min="0" step="0.1" defaultValue={set.fact.distanceKm} placeholder={set.distanceKm === undefined ? 'км' : `${set.distanceKm} км`} /></div>
}

const REST_SECONDS = 90
const REST_STEP = 15

function formatRest(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// Live elapsed workout time counting up from the start timestamp, "42:07".
function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(secs).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

function WorkoutTimer({ startedAt }: { startedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  if (!startedAt) return <span className="live-timer">● LIVE</span>
  const elapsed = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000))
  return <span className="live-timer"><span className="live-dot-mark" aria-hidden="true" />{formatElapsed(elapsed)}</span>
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
  // Shift the running rest deadline by ±step, never below zero.
  function adjustRest(deltaSeconds: number) {
    if (restEndsAt.current === null) return
    const nextEnd = Math.max(Date.now(), restEndsAt.current + deltaSeconds * 1000)
    restEndsAt.current = nextEnd
    setRestRemaining(Math.max(0, Math.round((nextEnd - Date.now()) / 1000)))
  }
  const appendSet = useMutation({ mutationFn: (exerciseId: string) => workoutsRepository.appendLiveSet(query.data!, exerciseId), onSuccess: async () => { await query.refetch() } })
  const appendExercise = useMutation({ mutationFn: (exercise: ExerciseSnapshot) => workoutsRepository.appendLiveExercise(query.data!, exercise), onSuccess: async () => { await query.refetch() } })
  const finish = useMutation({ mutationFn: () => workoutsRepository.finish(query.data!), onSuccess: async () => {
    const clientId = query.data?.clientId
    // Освежаем не только саму тренировку, но и статистику клиента и списки
    // тренировок (карточка, история, расписание), иначе кол-во/% выполнения
    // на карточке клиента обновляются только после перезагрузки.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workout', workoutId] }),
      queryClient.invalidateQueries({ queryKey: ['workouts'] }),
      clientId ? queryClient.invalidateQueries({ queryKey: ['client-stats', clientId] }) : Promise.resolve(),
    ])
    navigate(`/workouts/${workoutId}`)
  } })
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
  return <Page title="Live-тренировка" action={<WorkoutTimer startedAt={query.data?.startedAt ?? null} />}>
    <AsyncView loading={query.isLoading} error={query.error}>{query.data && <>
      <p>{query.data.clientName}</p>
      {restRemaining !== null && <div className="rest-timer">
        <strong>Отдых {formatRest(restRemaining)}</strong>
        <div className="rest-controls">
          <button type="button" className="rest-step" aria-label="Минус 15 секунд" onClick={() => adjustRest(-REST_STEP)}>−15с</button>
          <button type="button" className="rest-step" aria-label="Плюс 15 секунд" onClick={() => adjustRest(REST_STEP)}>+15с</button>
          <button type="button" className="link" onClick={stopRest}>Пропустить</button>
        </div>
      </div>}
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
  return <Page title="История упражнения" back={`/workouts/${workoutId}`}>
    <AsyncView loading={current.isLoading || history.isLoading} error={current.error ?? history.error} empty={!history.data?.length}>
      {chart.length > 1 && <section className="chart"><h2>Динамика ({unit})</h2><ResponsiveContainer width="100%" height={220}><LineChart data={chart}><XAxis dataKey="date" /><YAxis domain={['dataMin - 2', 'dataMax + 2']} /><Tooltip /><Line type="monotone" dataKey="value" stroke="#735cff" strokeWidth={3} /></LineChart></ResponsiveContainer></section>}
      <div className="timeline">{[...(history.data ?? [])].sort((a, b) => (a.workoutDate < b.workoutDate ? 1 : -1)).map((workout) => { const exercise = workout.exercises.find((item) => item.ref === exerciseRef); return <article key={workout.id} className="card"><div><strong>{formatLocalDate(workout.workoutDate)}</strong><p>{exercise?.sets.map(formatSet).join(', ')}</p></div></article> })}</div>
    </AsyncView>
  </Page>
}
