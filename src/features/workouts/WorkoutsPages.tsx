import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { goalsRepository } from '../../data/repositories/goals.repository'
import { currentStage, orderedStages } from '../../shared/goal-rules'
import { exercisesRepository } from '../../data/repositories/exercises.repository'
import { AxisTick, computeYDomain, formatTooltipLabel, formatTooltipValue, renderChartDot } from '../progress/ProgressChart'
import { restoreRestDeadline, storeRestDeadline } from './rest-timer-storage'
import { blockLabel, chartUnitFor, completedWorkoutDraft, copyWorkout, DEFAULT_REST_BETWEEN_SETS, durationLabel, durationSeconds, enteredFactLine, exerciseChartPoints, exerciseSummary, factLine, formatFactVsPlan, groupIntoBlocks, blockRoundsView, currentRoundIndex, muscleGroupLabels, previousResultLine, replaceExercise, splitClientWorkouts, tonnageLabel, workoutDurationLabel, workoutTonnage, workoutsRepository, type PreviousExerciseResult } from '../../data/repositories/workouts.repository'
import type { ExerciseSnapshot, LiveSetDraft, Workout, WorkoutDraft, WorkoutExercise, WorkoutSet } from '../../shared/domain'
import { playGong } from '../../shared/gong'
import {
  addDays, dayOfMonth, formatLocalDate, localDate, startOfWeek, todayLocalDate, weekdayShort,
  type LocalDate,
} from '../../shared/local-date'
import { AsyncView, Field, OverflowMenu, Page, SaveStatus, StatusBadge, useConfirm } from '../../shared/ui'
import { ExercisePicker, frequentExercisesForClient, useExerciseCatalog } from '../exercises'
import { VoiceNoteField } from '../voice-input'
import { QuickWorkoutEntry } from './QuickWorkoutEntry'
import { WorkoutExerciseEditor } from './WorkoutExerciseEditor'
import { RPE_OPTIONS } from '../../shared/rpe'
import type { ParsedWorkoutExercise } from './quick-workout-entry'
import { createLiveSetCoordinator } from './live-set-coordinator'
import { applyLiveSetDraft, setWithLocalDraft } from './live-set-cache'
import { setLiveScreenAwake } from './live-keep-awake'
import { LoadMoreButton } from './LoadMoreButton'
import { workoutCountLabel } from './workout-count-label'
import { useAuth } from '../../app/auth-context'
import { useClientRealtime } from '../../app/use-client-realtime'
import { readWorkoutFormDraft, removeWorkoutFormDraft, workoutFormDraftKey, writeWorkoutFormDraft } from './workout-form-draft'
import { workoutDateForRecordMode } from './workout-entry-rules'

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
       <div className="schedule-actions-right">
        {/* ＋ первой и с увеличенным зазором: на iOS нативный input[type=date]
            под 📅 раздувает свою tap-зону за CSS-границы и перехватывает соседний
            тап — из-за этого по ＋ открывался календарь. Разводим и убираем
            inset:0 у инпута (см. .schedule-jump input в styles.css). */}
        <Link className="schedule-add" to={`/workouts/new?date=${selected}`} aria-label="Новая тренировка">＋</Link>
        <label className="schedule-jump" aria-label="Выбрать дату">📅<input type="date" value={selected} onChange={(event) => event.target.value && selectDate(localDate(event.target.value))} /></label>
       </div>
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
          <Link key={workout.id} className="card" to={`/workouts/${workout.id}`}><div><strong>{workout.clientName}</strong><p>{exerciseSummary(workout).map((e) => e.name).join(', ') || 'без упражнений'}</p></div><span className={`badge ${workout.status}`}>{statusLabel(workout.status)}</span></Link>
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
            // Плашка: время и имя клиента в одну строку, ниже — упражнения
            // столбиком (до двух, дальше «…»).
            const names = exerciseSummary(workout).map((e) => e.name)
            return <Link key={workout.id} className={`day-grid-event ${workout.status}`} style={{ top, height }} to={`/workouts/${workout.id}`}>
              <span className="day-grid-event-top">
                <span className="day-grid-event-time">{eventTime(workout)}</span>
                <span className="day-grid-event-name">{workout.clientName}</span>
              </span>
              {names.length > 0 && <span className="day-grid-event-groups">
                {names.slice(0, 2).map((name, i) => <span key={i} className="day-grid-event-exercise">{name}</span>)}
                {names.length > 2 && <span className="day-grid-event-exercise">…</span>}
              </span>}
            </Link>
          })}
         </div>
       </div>
       <LoadMoreButton hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onLoadMore={() => void query.fetchNextPage()} />
     </AsyncView>
  </Page>
}

function statusLabel(status: string) { return status === 'planned' ? 'План' : status === 'in_progress' ? 'Идёт' : 'Готово' }

// Список упражнений тренировки для карточки (история/предстоящие): каждое
// на своей строке, у упражнений с комментарием — сам комментарий ниже.
// Одинаково в плане и в истории.
export function WorkoutExercisesSummary({ workout }: { workout: Workout }) {
  const items = exerciseSummary(workout)
  if (!items.length) return <p className="muted">Без упражнений</p>
  return <ul className="workout-exercise-list">{items.map((item, index) => <li key={index}>
    <span className="workout-exercise-name">{item.name}{item.comment && ' 💬'}</span>
    {item.comment && <span className="workout-exercise-comment">💬 {item.comment}</span>}
  </li>)}</ul>
}

export function ClientWorkoutsPage() {
  const { clientId = '' } = useParams()
  useClientRealtime(clientId)
  const query = useInfiniteQuery({
    queryKey: ['workouts', clientId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => workoutsRepository.listPage(undefined, undefined, clientId, pageParam),
    getNextPageParam: (page) => page.nextOffset,
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const history = splitClientWorkouts(items, todayLocalDate()).history
  return <Page title="История тренировок" back={`/clients/${clientId}`} action={<Link className="button" to={`/workouts/new?client=${clientId}`}>Добавить</Link>}><AsyncView loading={query.isLoading} error={query.error} empty={!history.length} onRetry={() => void query.refetch()}
    emptyTitle="История пока пуста"
    emptyDescription="Завершённые тренировки появятся здесь вместе с результатами."
    emptyAction={<Link className="button" to={`/workouts/new?client=${clientId}`}>Запланировать тренировку</Link>}><div className="cards">{history.map((workout) => {
    const duration = workoutDurationLabel(workout.startedAt, workout.completedAt)
    const tonnage = workoutTonnage(workout)
    const meta = workout.status === 'done' ? [duration, tonnage > 0 ? tonnageLabel(tonnage) : null].filter(Boolean).join(' · ') : ''
    return <Link className="card" key={workout.id} to={`/workouts/${workout.id}`}><div><strong>{formatLocalDate(workout.workoutDate)}</strong><WorkoutExercisesSummary workout={workout} />{meta && <p className="card-meta">{meta}</p>}</div><span className={`badge ${workout.status}`}>{statusLabel(workout.status)}</span></Link>
  })}</div><LoadMoreButton hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onLoadMore={() => void query.fetchNextPage()} /></AsyncView></Page>
}

export function WorkoutFormPage() {
  const { workoutId } = useParams()
  const { actor } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const sourceId = workoutId ?? params.get('copy') ?? undefined
  const source = useQuery({ queryKey: ['workout', sourceId], queryFn: () => workoutsRepository.get(sourceId ?? ''), enabled: Boolean(sourceId) })
  const clientMode = actor?.role === 'client'
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false), enabled: !clientMode })
  const mine = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine(), enabled: clientMode })
  useClientRealtime(source.data?.clientId ?? (clientMode ? mine.data?.id : params.get('client') ?? undefined))
  const catalog = useExerciseCatalog()
  const [draftExercises, setDraftExercises] = useState<WorkoutDraft['exercises'] | null>(null)
  const [previousResultReferences, setPreviousResultReferences] = useState<ReadonlyMap<string, PreviousExerciseResult>>(() => new Map())
  const createRequestId = useRef(crypto.randomUUID())
  const [recordCompleted, setRecordCompleted] = useState(false)
  const [entryDate, setEntryDate] = useState<LocalDate>(() => localDate(params.get('date') ?? todayLocalDate()))
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [notes, setNotes] = useState('')
  const [stageId, setStageId] = useState('')
  const [formDraftReady, setFormDraftReady] = useState(false)
  const [prefillError, setPrefillError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  // Индекс упражнения, которое заменяем через пикер; null — режим добавления.
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  const initial = source.data ? (workoutId ? { ...(source.data.status === 'done' ? completedWorkoutDraft(source.data) : copyWorkout(source.data)), id: source.data.id, version: source.data.version } : copyWorkout(source.data, todayLocalDate())) : undefined
  const exercises = draftExercises ?? initial?.exercises ?? []
  const draftKey = workoutFormDraftKey(actor?.userId ?? 'anonymous', sourceId ?? `new-${params.get('client') ?? ''}-${params.get('date') ?? ''}`)
  // Клиент, для которого выбираем этап (реактивно — при смене в селекте).
  const defaultClientId = clientMode ? (mine.data?.id ?? '') : (initial?.clientId ?? params.get('client') ?? '')
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const clientId = selectedClientId || defaultClientId
  const clientWorkouts = useQuery({ queryKey: ['client-exercises-frequency', clientId], queryFn: () => workoutsRepository.list(undefined, undefined, clientId), enabled: Boolean(clientId) })
  const frequentExercises = useMemo(() => frequentExercisesForClient(catalog.exercises, clientWorkouts.data ?? []), [catalog.exercises, clientWorkouts.data])
  const goal = useQuery({ queryKey: ['client-goal', clientId], queryFn: () => goalsRepository.get(clientId), enabled: Boolean(clientId) })
  const stages = goal.data ? orderedStages(goal.data) : []
  // Этап по умолчанию: сохранённый у тренировки, иначе текущий по дате.
  const defaultStageId = source.data?.stageId ?? (goal.data ? currentStage(goal.data, todayLocalDate())?.id ?? '' : '')
  // Завершённой остаётся только редактируемая запись. Копия завершённой
  // тренировки — это новый план, который тренер при необходимости может
  // переключить в «Завершённую».
  const completedMode = recordCompleted || Boolean(workoutId && source.data?.status === 'done')
  useEffect(() => {
    if (!actor || source.isLoading || (clientMode && mine.isLoading) || formDraftReady) return
    const saved = readWorkoutFormDraft(draftKey)
    if (saved) {
      setSelectedClientId(saved.clientId)
      setEntryDate(saved.workoutDate)
      setStartTime(saved.startTime)
      setEndTime(saved.endTime)
      setNotes(saved.notes)
      setStageId(saved.stageId)
      setRecordCompleted(saved.recordCompleted)
      setDraftExercises(saved.exercises)
    } else if (initial) {
      setEntryDate(workoutDateForRecordMode(source.data?.status === 'done' ? 'completed' : 'planned', initial.workoutDate, todayLocalDate()))
      setStartTime(initial.startTime ?? '')
      setEndTime(initial.endTime ?? '')
      setNotes(initial.notes ?? '')
      setStageId(initial.stageId ?? '')
    }
    setFormDraftReady(true)
  }, [actor, clientMode, draftKey, formDraftReady, initial, mine.isLoading, source.data?.status, source.isLoading])

  useEffect(() => {
    if (!formDraftReady || workoutId) return
    writeWorkoutFormDraft(draftKey, { clientId, workoutDate: entryDate, startTime, endTime, notes, stageId, recordCompleted, exercises })
  }, [clientId, draftKey, endTime, entryDate, exercises, formDraftReady, notes, recordCompleted, stageId, startTime, workoutId])

  useEffect(() => {
    if (!initial || formDraftReady) return
    setEntryDate(workoutDateForRecordMode(source.data?.status === 'done' ? 'completed' : 'planned', initial.workoutDate, todayLocalDate()))
  }, [formDraftReady, initial, source.data?.status])
  const mutation = useMutation({ mutationFn: (draft: WorkoutDraft) => completedMode ? workoutsRepository.saveCompleted(draft) : workoutsRepository.save(draft), onSuccess: async (id) => {
    if (!workoutId) removeWorkoutFormDraft(draftKey)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workout', id] }),
      queryClient.invalidateQueries({ queryKey: ['workouts'] }),
      queryClient.invalidateQueries({ queryKey: ['today-workouts'] }),
      queryClient.invalidateQueries({ queryKey: ['today-recent-workouts'] }),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
    ])
    navigate(`/workouts/${id}`)
  } })

  async function previousResults(selected: ExerciseSnapshot[]): Promise<Map<string, PreviousExerciseResult>> {
    if (!clientId) return new Map<string, PreviousExerciseResult>()
    try {
      setPrefillError(null)
      return await workoutsRepository.latestExerciseResults(clientId, selected.map((exercise) => exercise.ref))
    } catch {
      // Добавление тренировки не должно блокироваться, если история временно недоступна.
      setPrefillError('Не удалось подставить значения с прошлой тренировки')
      return new Map<string, PreviousExerciseResult>()
    }
  }
  function rememberPreviousResults(results: ReadonlyMap<string, PreviousExerciseResult>) {
    if (!results.size) return
    setPreviousResultReferences((current) => new Map([...current, ...results]))
  }
  function exerciseDraft(selected: ExerciseSnapshot, position: number, result: PreviousExerciseResult | undefined) {
    return {
      ...selected, position, blockId: crypto.randomUUID(), blockType: 'single' as const, blockRounds: 1,
      prefilledFromDate: result?.workoutDate,
      sets: result?.sets.length ? result.sets : [{ position: 0 }],
    }
  }
  async function pickExercise(selected: ExerciseSnapshot) {
    const results = await previousResults([selected])
    rememberPreviousResults(results)
    const previous = results.get(selected.ref)
    if (replaceIndex !== null) {
      const clearFact = source.data?.status === 'done'
      // Если в истории этого упражнения ещё нет, сохраняем привычное поведение
      // замены: при одинаковом типе остаются уже набранные значения формы.
      // В завершённой тренировке значения нельзя приписать новому упражнению:
      // замена всегда начинается без факта.
      const draft = !clearFact && previous ? exerciseDraft(selected, replaceIndex, previous) : undefined
      setDraftExercises(replaceExercise(exercises, replaceIndex, selected, draft, { clearFact }))
    }
    else setDraftExercises([...exercises, exerciseDraft(selected, exercises.length, previous)])
    closePicker()
  }
  async function pickExercises(selected: ExerciseSnapshot[]) {
    const results = await previousResults(selected)
    rememberPreviousResults(results)
    setDraftExercises([
      ...exercises,
      ...selected.map((exercise, index) => exerciseDraft(exercise, exercises.length + index, results.get(exercise.ref))),
    ])
    closePicker()
  }
  async function addQuickEntry(parsed: ParsedWorkoutExercise[]) {
    const results = await previousResults(parsed.map((item) => item.exercise))
    rememberPreviousResults(results)
    setDraftExercises([
      ...exercises,
      ...parsed.map((item, index) => {
        const fallback = exerciseDraft(item.exercise, exercises.length + index, results.get(item.exercise.ref))
        return { ...fallback, sets: item.hasValues ? item.sets : fallback.sets }
      }),
    ])
  }
  function closePicker() { setPickerOpen(false); setReplaceIndex(null); setPickerSearch('') }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    const submitClientId = String(form.get('clientId')); const date = workoutDateForRecordMode(completedMode ? 'completed' : 'planned', entryDate, todayLocalDate())
    const submittedStartTime = startTime
    const submittedEndTime = endTime
    const endTimeInput = event.currentTarget.elements.namedItem('endTime') as HTMLInputElement
    const timeError = submittedEndTime && !submittedStartTime
      ? 'Укажите время начала тренировки'
      : submittedEndTime && submittedEndTime <= submittedStartTime
        ? 'Окончание должно быть позже начала'
        : ''
    endTimeInput.setCustomValidity(timeError)
    if (timeError) { endTimeInput.reportValidity(); return }
    const stageId = String(form.get('stageId') || '') || null
    mutation.mutate({ id: workoutId, requestId: workoutId ? undefined : createRequestId.current, clientId: submitClientId, workoutDate: date, startTime: submittedStartTime || undefined,
      endTime: submittedEndTime || undefined,
      notes: notes || undefined, stageId: stageId || null, exercises, version: source.data?.version })
  }
  const availableClients = clientMode ? (mine.data ? [mine.data] : []) : clients.data
  const editingDenied = Boolean(clientMode && workoutId && source.data && source.data.createdBy !== actor?.userId)
  const loading = source.isLoading || clients.isLoading || mine.isLoading
  const error = source.error ?? clients.error ?? mine.error
  return <Page title={workoutId ? 'Редактировать тренировку' : params.has('copy') ? 'Копия тренировки' : 'Новая тренировка'} back={-1}>
    <AsyncView loading={loading} error={error}>{editingDenied ? <div className="state"><h2>Редактирование недоступно</h2><p>Назначенную тренером тренировку может менять только тренер.</p></div> : clientMode && !mine.data ? <div className="state"><h2>Карточка ещё не подключена</h2><p>Создать тренировку можно после подключения клиентской карточки.</p></div> : <form className="stack workout-form" onSubmit={(event) => void submit(event)}>
      <section className="workout-form-section">
        <div className="workout-form-section-head"><p className="eyebrow">ОСНОВНЫЕ ДАННЫЕ</p><h2>Тренировка</h2></div>
        {clientMode
          ? <><input type="hidden" name="clientId" value={mine.data?.id ?? ''} /><Field label="Клиент"><input value={mine.data?.fullName ?? ''} disabled /></Field></>
          : <Field label="Клиент"><select name="clientId" value={clientId} onChange={(event) => setSelectedClientId(event.target.value)} required><option value="">Выберите</option>{availableClients?.map((client) => <option key={client.id} value={client.id}>{client.fullName}</option>)}</select></Field>}
        <div className="split"><Field label="Дата"><input name="date" type="date" max={completedMode ? todayLocalDate() : undefined} value={entryDate} onChange={(event) => setEntryDate(localDate(event.target.value))} required /></Field><Field label="Время"><input name="startTime" type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); (event.currentTarget.form?.elements.namedItem('endTime') as HTMLInputElement | null)?.setCustomValidity('') }} /></Field></div>
        <Field label="Окончание"><input name="endTime" type="time" value={endTime} onChange={(event) => { setEndTime(event.target.value); event.currentTarget.setCustomValidity('') }} /></Field>
        {!workoutId && <div className="workout-record-mode" role="group" aria-label="Тип тренировки"><button type="button" className={!recordCompleted ? 'active' : ''} aria-pressed={!recordCompleted} onClick={() => setRecordCompleted(false)}>План</button><button type="button" className={recordCompleted ? 'active' : ''} aria-pressed={recordCompleted} onClick={() => { setRecordCompleted(true); setEntryDate((date) => workoutDateForRecordMode('completed', date, todayLocalDate())) }}>Завершённая</button></div>}
        {stages.length > 0 && <Field label="Этап цели">
          {/* key — чтобы defaultValue пересчитался при смене клиента/загрузке цели */}
          <select name="stageId" key={`${clientId}-${defaultStageId}`} value={stageId || defaultStageId} onChange={(event) => setStageId(event.target.value)}>
            <option value="">Без этапа</option>
            {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}
          </select>
        </Field>}
        <details className="workout-notes" open={Boolean(initial?.notes)}>
          <summary>Заметка <span>Необязательно</span></summary>
          <VoiceNoteField name="notes" source="workout_form" value={notes} onValueChange={setNotes} hideLabel />
        </details>
      </section>
      <section className="workout-form-section workout-form-exercises">
        <div className="workout-form-section-head"><p className="eyebrow">УПРАЖНЕНИЯ</p><h2>План и факт</h2></div>
        <QuickWorkoutEntry catalog={catalog.exercises} preferredExerciseRefs={frequentExercises.map((exercise) => exercise.ref)} onAdd={(parsed) => void addQuickEntry(parsed)} onOpenCatalog={(search) => { setPickerSearch(search); setReplaceIndex(null); setPickerOpen(true) }} />
        <WorkoutExerciseEditor exercises={exercises} onChange={setDraftExercises} onOpenPicker={() => { setReplaceIndex(null); setPickerOpen(true) }} onReplaceExercise={(index) => { setReplaceIndex(index); setPickerOpen(true) }} showTrainerComments={!clientMode} entryMode={completedMode ? 'fact' : 'plan'} hideEmptyAddAction previousResults={previousResultReferences} />
      </section>
      {prefillError && <p className="error">{prefillError}</p>}
      {mutation.error && <p className="error">{mutation.error.message}</p>}
      <div className="actions"><button type="button" className="secondary" onClick={() => navigate(-1)}>Отмена</button><button disabled={mutation.isPending}>{recordCompleted ? 'Записать тренировку' : completedMode ? 'Сохранить изменения' : 'Сохранить'}</button></div>
    </form>}</AsyncView>
    {pickerOpen && <ExercisePicker catalog={catalog} frequent={frequentExercises} initialSearch={pickerSearch} onPick={pickExercise} onPickMany={pickExercises} multiple={replaceIndex === null} onClose={closePicker} />}
  </Page>
}

export function WorkoutDetailPage() {
  const { workoutId = '' } = useParams(); const navigate = useNavigate(); const location = useLocation(); const queryClient = useQueryClient()
  const { actor } = useAuth()
  const [confirm, confirmDialog] = useConfirm()
  const query = useQuery({ queryKey: ['workout', workoutId], queryFn: () => workoutsRepository.get(workoutId) })
  useClientRealtime(query.data?.clientId)
  // Этап тренировки: get() отдаёт stageId, название берём из цели клиента.
  const goal = useQuery({ queryKey: ['client-goal', query.data?.clientId], queryFn: () => goalsRepository.get(query.data!.clientId), enabled: Boolean(query.data?.stageId && query.data?.clientId) })
  const stageTitle = query.data?.stageId ? goal.data?.stages.find((stage) => stage.id === query.data!.stageId)?.title ?? null : null
  const start = useMutation({ mutationFn: () => workoutsRepository.start(query.data!), onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['workout', workoutId] }), queryClient.invalidateQueries({ queryKey: ['clients'] })]); navigate(`/workouts/${workoutId}/live`) } })
  const remove = useMutation({ mutationFn: () => workoutsRepository.remove(query.data!), onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['workouts'] }), queryClient.invalidateQueries({ queryKey: ['clients'] })]); navigate(actor?.role === 'client' ? '/me/workouts' : '/schedule') } })
  const workout = query.data
  const done = workout?.status === 'done'
  const duration = workout ? workoutDurationLabel(workout.startedAt, workout.completedAt) : null
  const groups = workout ? muscleGroupLabels(workout) : []
  const tonnage = workout ? workoutTonnage(workout) : 0
  const sets = workout?.exercises.flatMap((exercise) => exercise.sets) ?? []
  const completedSets = sets.filter((set) => set.confirmedAt).length
  const navigationState = location.state as { justCompleted?: boolean; returnTo?: string } | null
  const justCompleted = done && navigationState?.justCompleted === true
  const clientMode = actor?.role === 'client'
  const clientOwned = clientMode && workout?.createdBy === actor.userId
  // Карточка не должна угадывать источник открытия. Быстрый сценарий «Сегодня»
  // передаёт returnTo, остальные пути сохраняют прежний безопасный fallback.
  const backTo = navigationState?.returnTo ?? (clientMode ? '/me/workouts' : '/schedule')
  return <Page title="Тренировка" className="workout-detail-page" back={backTo}>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>{workout && <>
      {justCompleted && <section className="workout-completion" aria-labelledby="workout-completion-title">
        <span className="workout-completion-mark" aria-hidden="true">✓</span>
        <div>
          <span className="workout-completion-kicker">Результат сохранён</span>
          <h2 id="workout-completion-title">Тренировка завершена</h2>
          <p>{sets.length > 0 ? `Выполнено ${completedSets} из ${sets.length} подходов` : 'Результаты сохранены'}</p>
        </div>
      </section>}
      <section className="workout-title">
        <div><h2>{workout.clientName}</h2><p>{formatLocalDate(workout.workoutDate)} · {workout.startTime?.slice(0, 5) ?? 'без времени'}</p>{stageTitle && <p className="stage-tag">🎯 {stageTitle}</p>}</div>
        <span className={`badge ${workout.status}`}>{statusLabel(workout.status)}</span>
      </section>
      {workout.status === 'planned' && <button className="wide" onClick={() => start.mutate()}>Начать тренировку</button>}
      {start.error && <p className="error">{start.error.message}</p>}
      {workout.status === 'in_progress' && <Link className="button wide" to={`/workouts/${workoutId}/live`}>Продолжить тренировку</Link>}
      {done && <section className="summary done-summary done-summary-3">
        <div><span>Время</span><strong>{duration ?? '—'}</strong></div>
        <div><span>Тоннаж</span><strong>{tonnageLabel(tonnage)}</strong></div>
        <div><span>Группы мышц</span><strong>{groups.length ? groups.join(', ') : '—'}</strong></div>
      </section>}
      <div className={`cards ${done ? 'completed-exercise-list' : ''}`}>{groupIntoBlocks(workout.exercises).map((block) => {
        const articles = block.exercises.map((exercise) => <article className={`exercise ${done ? 'completed-exercise' : ''}`} key={exercise.id}>
          <Link className="exercise-name-link" to={`/workouts/${workout.id}/history/${encodeURIComponent(exercise.ref)}`}><strong>{exercise.name}</strong> <span className="exercise-name-hint">↗ история</span></Link>
          <div className="workout-set-table workout-history-sets">{exercise.sets.map((set, index) => <WorkoutHistorySet key={set.id} set={set} index={index} done={done} />)}</div>
          {exercise.trainerComment && <p className="exercise-comment-note">💬 {exercise.trainerComment}</p>}
        </article>)
        if (block.blockType === 'single' || block.exercises.length === 1) return articles
        return <div className={`exercise-block view${done ? ' completed-exercise-block' : ''}`} key={block.blockId}><span className="block-badge">{blockLabel(block.blockType, block.blockPreset)} · {block.blockRounds} кр.</span>{articles}</div>
      })}</div>
      {workout.notes && <p>{workout.notes}</p>}
      {(!clientMode || clientOwned) && <><div className="actions">
        {(workout.status === 'planned' || done) && <Link className="button secondary" to={`/workouts/${workoutId}/edit`}>{done ? 'Изменить результат' : 'Изменить'}</Link>}
        <Link className="button secondary" to={`/workouts/new?copy=${workoutId}`}>Копировать</Link>
      </div>
      <button className="danger secondary wide" disabled={remove.isPending} onClick={async () => { if (await confirm({ message: 'Удалить тренировку?', confirmLabel: 'Удалить', danger: true })) remove.mutate() }}>Удалить тренировку</button></>}
      {clientMode && !clientOwned && <div className="actions"><Link className="button secondary" to={`/workouts/new?copy=${workoutId}`}>Создать свою копию</Link></div>}
      {remove.error && <p className="error">{remove.error.message}</p>}
      {confirmDialog}
    </>}</AsyncView>
  </Page>
}

function formatSet(set: WorkoutSet) { const plan = [set.weightKg && `${set.weightKg} кг`, set.reps && `${set.reps} повт.`, set.distanceKm && `${set.distanceKm} км`, durationLabel(set.durationSec, set.durationMin), set.rpe !== undefined && `RPE ${set.rpe}`].filter(Boolean).join(' × '); return plan || 'Подход без плана' }

function WorkoutHistorySet({ set, index, done }: { set: WorkoutSet; index: number; done: boolean }) {
  const confirmed = Boolean(set.confirmedAt)
  const { fact, planNote } = formatFactVsPlan(set)
  const result = done ? fact : formatSet(set)
  return <div className={`workout-set-row workout-history-set ${confirmed ? 'confirmed' : 'missed'}`}>
    <span className="workout-set-number workout-history-set-number" aria-label={`Подход ${index + 1}`}>{index + 1}</span>
    <span className="workout-history-set-result"><strong>{result}</strong>
      {done && !confirmed && <span className="plan-note">не выполнено</span>}
      {done && confirmed && planNote && <span className="plan-note">{planNote}</span>}
    </span>
    {done && <span className="workout-history-set-status" aria-label={confirmed ? 'Выполнен' : 'Не выполнен'}>{confirmed ? '✓' : '—'}</span>}
  </div>
}


// Плановое значение подхода вторичной строкой («План: 100 кг × 10») по типу
// упражнения. Факт остаётся основным редактируемым полем, план — явно виден
// (раньше был только тусклым placeholder). null — если план не задан.
function planLine(inputKind: ExerciseSnapshot['inputKind'], set: WorkoutSet): string | null {
  const parts: string[] = []
  if (inputKind === 'strength') {
    if (set.weightKg !== undefined) parts.push(`${set.weightKg} кг`)
    if (set.reps !== undefined) parts.push(`${set.reps} повт.`)
  } else if (inputKind === 'reps') {
    const duration = durationLabel(set.durationSec, set.durationMin)
    if (duration) parts.push(duration)
    if (set.reps !== undefined) parts.push(`${set.reps} повт.`)
  } else if (inputKind === 'duration') {
    const duration = durationLabel(set.durationSec, set.durationMin)
    if (duration) parts.push(duration)
  } else {
    const duration = durationLabel(set.durationSec, set.durationMin)
    if (duration) parts.push(duration)
    if (set.distanceKm !== undefined) parts.push(`${set.distanceKm} км`)
  }
  if (set.rpe !== undefined) parts.push(`RPE ${set.rpe}`)
  return parts.length ? parts.join(' × ') : null
}

// Одна ячейка факта в таблице подходов. В live основной сценарий — прямой
// ввод: компактное число открывает цифровую клавиатуру и не разворачивает
// строку в набор крупных степперов.
function LiveSetInput({ name, label, placeholder, defaultValue, step, disabled, inputKey, decimal = false, planHint = false }: {
  name: string; label: string; placeholder: string; defaultValue: number | undefined
  step: number; disabled: boolean; inputKey: string; decimal?: boolean; planHint?: boolean
}) {
  return <input
    key={inputKey}
    className={`live-set-input${planHint ? ' plan-hint' : ''}`}
    aria-label={label}
    name={name}
    type="number"
    inputMode={decimal ? 'decimal' : 'numeric'}
    min="0"
    step={step}
    disabled={disabled}
    defaultValue={defaultValue}
    placeholder={placeholder}
    onInput={(event) => event.currentTarget.classList.remove('plan-hint')}
  />
}

function LiveSetFields({ inputKind, set, editing = false, showRpe = false }: { inputKind: ExerciseSnapshot['inputKind']; set: WorkoutSet; editing?: boolean; showRpe?: boolean }) {
  // После подтверждения показываем зафиксированный результат (факт, иначе план)
  // как обычное яркое значение в заблокированном поле, а не тусклый placeholder.
  // Правка по карандашику временно разблокирует поля (editing).
  const locked = Boolean(set.confirmedAt) && !editing
  // Ключ ремоунтит поля при смене режима (подтверждён / правка / ввод), чтобы
  // неконтролируемый defaultValue пересчитался и показал нужное значение.
  // В key добавлена version: после правки подтверждённого подхода факт меняется
  // и версия бампится — иначе стабильный key оставил бы старое значение в поле.
  const mode = locked ? 'locked' : editing ? 'editing' : 'edit'
  const k = `${mode}-${set.version}`
  // Факт при первом открытии начинается с плана: тренер видит готовые значения
  // и меняет только нужное. После выполнения приоритет остаётся у факта.
  const value = (fact: number | undefined, plan: number | undefined) => fact ?? plan
  const isPlanHint = (fact: number | undefined, plan: number | undefined) => !locked && fact === undefined && plan !== undefined
  const factDuration = durationSeconds(set.fact.durationSec, set.fact.durationMin)
  const planDuration = durationSeconds(set.durationSec, set.durationMin)
  const rpeField = showRpe ? <select className="live-set-rpe" name="rpe" aria-label="Фактический RPE" defaultValue={set.fact.rpe ?? set.rpe ?? ''} disabled={locked}>
    <option value="">—</option>
    {RPE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
  </select> : null
  if (inputKind === 'strength') return <>
    <LiveSetInput name="weightKg" label="Фактический вес" placeholder="кг" defaultValue={value(set.fact.weightKg, set.weightKg)} planHint={isPlanHint(set.fact.weightKg, set.weightKg)} step={2.5} disabled={locked} inputKey={`w-${k}`} decimal />
    <LiveSetInput name="reps" label="Фактические повторы" placeholder="повт." defaultValue={value(set.fact.reps, set.reps)} planHint={isPlanHint(set.fact.reps, set.reps)} step={1} disabled={locked} inputKey={`r-${k}`} />
    {rpeField}
  </>
  if (inputKind === 'reps') return <>
    <LiveSetInput name="durationSec" label="Фактическое время, сек" placeholder="сек" defaultValue={value(factDuration, planDuration)} planHint={isPlanHint(factDuration, planDuration)} step={15} disabled={locked} inputKey={`d-${k}`} />
    <LiveSetInput name="reps" label="Фактические повторы" placeholder="повт." defaultValue={value(set.fact.reps, set.reps)} planHint={isPlanHint(set.fact.reps, set.reps)} step={1} disabled={locked} inputKey={`r-${k}`} />
    {rpeField}
  </>
  if (inputKind === 'duration') return <>
    <LiveSetInput name="durationSec" label="Фактическое время, сек" placeholder="сек" defaultValue={value(factDuration, planDuration)} planHint={isPlanHint(factDuration, planDuration)} step={15} disabled={locked} inputKey={`d-${k}`} />
    <span className="live-set-empty" aria-hidden="true" />
    {rpeField}
  </>
  return <>
    <LiveSetInput name="durationSec" label="Фактическое время, сек" placeholder="сек" defaultValue={value(factDuration, planDuration)} planHint={isPlanHint(factDuration, planDuration)} step={15} disabled={locked} inputKey={`d-${k}`} />
    <LiveSetInput name="distanceKm" label="Фактическая дистанция" placeholder="км" defaultValue={value(set.fact.distanceKm, set.distanceKm)} planHint={isPlanHint(set.fact.distanceKm, set.distanceKm)} step={0.1} disabled={locked} inputKey={`dist-${k}`} decimal />
    {rpeField}
  </>
}

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
  const className = 'live-timer'
  if (!startedAt) return <span className={className}><span className="live-dot-mark" aria-hidden="true" />LIVE</span>
  const elapsed = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000))
  return <span className={className}><span className="live-dot-mark" aria-hidden="true" />{formatElapsed(elapsed)}</span>
}

export function LiveWorkoutPage() {
  const { workoutId = '' } = useParams()
  const { actor } = useAuth()
  const clientMode = actor?.role === 'client'
  const navigate = useNavigate()
  const [askConfirm, confirmDialog] = useConfirm()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['workout', workoutId], queryFn: () => workoutsRepository.get(workoutId) })
  useEffect(() => {
    // Этот маршрут доступен только после старта тренировки. Включаем нативный
    // keep-awake сразу при входе, не дожидаясь ответа БД со статусом: иначе
    // медленный запрос оставлял экран без защиты от гашения.
    void setLiveScreenAwake(true)
    return () => { void setLiveScreenAwake(false) }
  }, [])
  useClientRealtime(query.data?.clientId)
  const catalog = useExerciseCatalog()
  const clientWorkouts = useQuery({ queryKey: ['client-exercises-frequency', query.data?.clientId], queryFn: () => workoutsRepository.list(undefined, undefined, query.data!.clientId), enabled: Boolean(query.data?.clientId) })
  const previousExerciseResults = useQuery({ queryKey: ['latest-exercise-results', query.data?.clientId, query.data?.exercises.map((exercise) => exercise.ref).join('|')], queryFn: () => workoutsRepository.latestExerciseResults(query.data!.clientId, query.data!.exercises.map((exercise) => exercise.ref)), enabled: Boolean(query.data?.clientId && query.data?.exercises.length) })
  const frequentExercises = useMemo(() => frequentExercisesForClient(catalog.exercises, clientWorkouts.data ?? []), [catalog.exercises, clientWorkouts.data])
  const [liveSets] = useState(() => createLiveSetCoordinator(
    (id, draft, version) => workoutsRepository.saveLiveSet(id, draft, version),
    (id, version) => workoutsRepository.confirmLiveSet(id, version),
  ))
  const skipBlurForSet = useRef<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  // В обычной тренировке перестановка не нужна постоянно: включается из меню
  // и только тогда показывает стрелки у блоков.
  const [reordering, setReordering] = useState(false)
  // Упражнение, которое заменяем через пикер; null — режим добавления.
  const [replaceExerciseId, setReplaceExerciseId] = useState<string | null>(null)
  // Подтверждённые подходы, временно разблокированные для правки (по карандашику).
  const [editingSets, setEditingSets] = useState<Set<string>>(() => new Set())
  // В обычном live разворачиваем только текущий подход. Тап по другой строке
  // временно открывает её для ввода без превращения всей тренировки в форму.
  const [expandedSetId, setExpandedSetId] = useState<string | null>(null)
  // Realtime может принести устаревший снимок между вводом и ответом RPC.
  // Держим конкретный введённый факт до тех пор, пока серверная копия не станет
  // такой же — иначе при переходе к следующему подходу строка мигнёт пустой.
  const [localSetDrafts, setLocalSetDrafts] = useState<Map<string, LiveSetDraft>>(() => new Map())
  const liveSetForms = useRef<Map<string, HTMLFormElement>>(new Map())
  const [savingSetId, setSavingSetId] = useState<string | null>(null)
  const [savedSetId, setSavedSetId] = useState<string | null>(null)
  const [saveErrorSetId, setSaveErrorSetId] = useState<string | null>(null)
  // Завершённые упражнения по умолчанию свёрнуты; id здесь — принудительно раскрытые
  // тренером (тап по свёрнутой карточке), чтобы поправить факт.
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(() => new Set())
  const [rpeExercises, setRpeExercises] = useState<Set<string>>(() => new Set())
  // Inline-подтверждение частичного завершения. window.confirm в нативной обёртке
  // (Capacitor/WKWebView) не показывается и блокировал выход из тренировки —
  // используем встроенный диалог в панели вместо нативного confirm.
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [restRemaining, setRestRemaining] = useState<number | null>(null)
  const restEndsAt = useRef<number | null>(null)
  useEffect(() => {
    const deadline = restoreRestDeadline(workoutId)
    restEndsAt.current = deadline
    setRestRemaining(deadline === null ? null : Math.ceil((deadline - Date.now()) / 1000))
  }, [workoutId])
  // При правке ПОДТВЕРЖДЁННОГО подхода (карандаш → «Сохранить») значение пишется
  // в БД, но без refetch локальный set остаётся старым и поле возвращает прежнее
  // число. Освежаем только для подтверждённых (в обычном вводе по blur refetch не
  // нужен и мешал бы: ремоунт полей по key сбросил бы текущий ввод).
  const save = useMutation({
    mutationFn: ({ set, draft }: { set: WorkoutSet; draft: LiveSetDraft }) => liveSets.save(set, draft),
    onMutate: ({ set }) => { setSavingSetId(set.id); setSavedSetId(null); setSaveErrorSetId(null) },
    onSuccess: async (version, { set, draft }) => {
      setSavingSetId(null)
      setSavedSetId(set.id)
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
      // Автосейв незавершённой строки не делает refetch: он перемонтировал бы
      // поля во время ввода. Вместо этого обновляем только сохранённый подход
      // в кэше — при переходе дальше он сразу остаётся с введёнными цифрами.
      if (!set.confirmedAt) queryClient.setQueryData<Workout>(
        ['workout', workoutId],
        (workout) => workout ? applyLiveSetDraft(workout, set.id, draft, version) : workout,
      )
      if (set.confirmedAt) {
        const exercise = query.data?.exercises.find((item) => item.sets.some((itemSet) => itemSet.id === set.id))
        if (exercise) setExpandedExercises((previous) => {
          if (!previous.has(exercise.id)) return previous
          const next = new Set(previous)
          next.delete(exercise.id)
          return next
        })
        await query.refetch()
      }
    },
    onError: (_error, { set }) => { setSavingSetId(null); setSaveErrorSetId(set.id) },
  })
  function persistLiveDraft(set: WorkoutSet, draft: LiveSetDraft) {
    // Запоминаем ввод до RPC. Это не меняет факт на сервере, но не даёт
    // realtime-снимку с прежними данными скрыть его при переходе к другой строке.
    setLocalSetDrafts((current) => {
      const next = new Map(current)
      next.set(set.id, draft)
      return next
    })
    save.mutate({ set, draft })
  }
  function liveFormChanged(form: HTMLFormElement) {
    return Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))
      .some((field) => field.value !== (field instanceof HTMLInputElement
        ? field.defaultValue
        : field.options[field.selectedIndex]?.defaultSelected ? field.value : ''))
  }
  function saveOpenLiveSet(exercise: WorkoutExercise, targetSetId: string) {
    // PointerDown происходит до blur: это единственный надёжный момент на iOS
    // для чтения числа из строки, когда тренер тапаeт «Ввести» у следующей.
    // При клавиатурной активации fallback берёт единственную открытую форму.
    const focused = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLFormElement>('form[data-live-set-id]')
      : null
    const fallback = [...liveSetForms.current.entries()].find(([setId]) => setId !== targetSetId)
    const form = focused ?? fallback?.[1]
    const currentSetId = form?.dataset.liveSetId ?? fallback?.[0]
    const currentSet = currentSetId ? exercise.sets.find((set) => set.id === currentSetId) : undefined
    if (currentSet && form && currentSet.id !== targetSetId && liveFormChanged(form)) {
      persistLiveDraft(currentSet, draftFrom(form))
    }
  }
  function openLiveSet(exercise: WorkoutExercise, targetSetId: string) {
    saveOpenLiveSet(exercise, targetSetId)
    setExpandedSetId(targetSetId)
  }
  useEffect(() => {
    if (!savedSetId) return
    const timer = window.setTimeout(() => setSavedSetId(null), 2_500)
    return () => window.clearTimeout(timer)
  }, [savedSetId])
  const confirm = useMutation({
    mutationFn: ({ set, draft }: { set: WorkoutSet; draft: LiveSetDraft }) => liveSets.confirm(set, draft),
    onSuccess: (_data, { set }) => {
      setExpandedSetId(null)
      // Отдых берётся из настроек блока (Этап A), не хардкод:
      // - одиночное упражнение → отдых между подходами;
      // - группа: между упражнениями внутри круга → restBetweenExercisesSec;
      //   после последнего упражнения круга → restBetweenRoundsSec.
      const workout = query.data
      const exercise = workout?.exercises.find((item) => item.sets.some((s) => s.id === set.id))
      if (workout && exercise) {
        const block = groupIntoBlocks(workout.exercises).find((b) => b.blockId === exercise.blockId)
        const multi = Boolean(block && block.exercises.length > 1)
        const lastExerciseOfRound = block && block.exercises[block.exercises.length - 1]?.id === exercise.id
        const lastSetOfExercise = [...exercise.sets].sort((a, b) => a.position - b.position).at(-1)?.id === set.id
        // Блок/упражнение полностью завершены этим подходом → отдыха не нужно
        // (для группы: последнее упражнение последнего круга; для одиночного:
        // последний подход). Иначе — отдых по правилам блока.
        const blockFinished = multi
          ? lastExerciseOfRound && lastSetOfExercise && block!.exercises.every((ex) => ex.sets.every((s) => s.id === set.id || s.confirmedAt))
          : lastSetOfExercise
        const sec = blockFinished ? 0
          : !multi ? exercise.restBetweenSetsSec ?? DEFAULT_REST_BETWEEN_SETS
          : lastExerciseOfRound ? block!.restBetweenRoundsSec
          : block?.restBetweenExercisesSec ?? 0
        startRestUntil(restDeadline(sec), sec)
      }
      void query.refetch()
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
  })
  // Запускает отдых до абсолютного момента endsAt (мс). null — отдыха нет
  // (напр. между упражнениями суперсета, seconds=0): таймер не показываем.
  function startRestUntil(endsAt: number | null, seconds: number) {
    restEndsAt.current = endsAt
    storeRestDeadline(workoutId, endsAt)
    setRestRemaining(endsAt === null ? null : seconds)
  }
  // Отдых на seconds секунд от текущего момента (вызывается из обработчика).
  function restDeadline(seconds: number): number | null {
    return seconds > 0 ? Date.now() + seconds * 1000 : null
  }
  function stopRest() {
    restEndsAt.current = null
    storeRestDeadline(workoutId, null)
    setRestRemaining(null)
  }
  // Shift the running rest deadline by ±step, never below zero.
  function adjustRest(deltaSeconds: number) {
    if (restEndsAt.current === null) return
    const nextEnd = Math.max(Date.now(), restEndsAt.current + deltaSeconds * 1000)
    restEndsAt.current = nextEnd
    storeRestDeadline(workoutId, nextEnd)
    setRestRemaining(Math.max(0, Math.round((nextEnd - Date.now()) / 1000)))
  }
  const appendSet = useMutation({ mutationFn: (exerciseId: string) => workoutsRepository.appendLiveSet(query.data!, exerciseId), onSuccess: async () => { await query.refetch() } })
  const removeSet = useMutation({ mutationFn: (setId: string) => workoutsRepository.removeLiveSet(query.data!, setId), onSuccess: async () => { await query.refetch() } })
  const appendExercise = useMutation({ mutationFn: (exercise: ExerciseSnapshot) => workoutsRepository.appendLiveExercise(query.data!, exercise), onSuccess: async () => { await query.refetch() } })
  const reorderBlock = useMutation({ mutationFn: ({ blockId, direction }: { blockId: string; direction: -1 | 1 }) => workoutsRepository.reorderLiveBlock(query.data!, blockId, direction), onSuccess: async () => { await query.refetch() } })
  const replaceLive = useMutation({ mutationFn: ({ exerciseId, exercise }: { exerciseId: string; exercise: ExerciseSnapshot }) => workoutsRepository.replaceLiveExercise(query.data!, exerciseId, exercise), onSuccess: async () => { await query.refetch() } })
  const commentLive = useMutation({ mutationFn: ({ exerciseId, comment }: { exerciseId: string; comment: string }) => workoutsRepository.setExerciseComment(query.data!, exerciseId, comment), onSuccess: async () => { await query.refetch() } })
  function closePicker() { setPickerOpen(false); setReplaceExerciseId(null) }
  function pickLiveExercise(exercise: ExerciseSnapshot) {
    if (replaceExerciseId) replaceLive.mutate({ exerciseId: replaceExerciseId, exercise })
    else appendExercise.mutate(exercise)
    closePicker()
  }
  const finish = useMutation({ mutationFn: () => workoutsRepository.finish(query.data!), onSuccess: async () => {
    const clientId = query.data?.clientId
    // Освежаем не только саму тренировку, но и статистику клиента и списки
    // тренировок (карточка, история, расписание), иначе кол-во/% выполнения
    // на карточке клиента обновляются только после перезагрузки.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workout', workoutId] }),
      queryClient.invalidateQueries({ queryKey: ['workouts'] }),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
      clientId ? queryClient.invalidateQueries({ queryKey: ['client-stats', clientId] }) : Promise.resolve(),
    ])
    navigate(`/workouts/${workoutId}`, { state: { justCompleted: true } })
  } })
  function draftFrom(form: HTMLFormElement): LiveSetDraft { const values = new FormData(form); return { weightKg: numberValue(values.get('weightKg')), reps: numberValue(values.get('reps')), distanceKm: numberValue(values.get('distanceKm')), durationSec: numberValue(values.get('durationSec')), rpe: numberValue(values.get('rpe')) } }
  // Derive the countdown from a wall-clock deadline so it stays correct even
  // when the tab is backgrounded and timers are throttled by the browser.
  const restActive = restRemaining !== null
  useEffect(() => {
    if (!restActive) return
    // Один тик отсчёта. iOS Safari замораживает setInterval при блокировке
    // экрана/фоне — на возврате пересчитываем от абсолютного дедлайна, иначе
    // таймер «пропадает» (застыл и тут же гонг), а не тикает как надо.
    const tick = () => {
      if (restEndsAt.current === null) return
      const left = Math.ceil((restEndsAt.current - Date.now()) / 1000)
      if (left <= 0) {
        restEndsAt.current = null
        storeRestDeadline(workoutId, null)
        setRestRemaining(null)
        playGong()
      } else {
        setRestRemaining(left)
      }
    }
    const timer = window.setInterval(tick, 250)
    // pageshow — возврат из bfcache (iOS), visibilitychange — разблокировка/фокус.
    const onWake = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('pageshow', onWake)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('pageshow', onWake)
    }
  }, [restActive])
  const error = save.error ?? confirm.error ?? appendSet.error ?? removeSet.error ?? appendExercise.error ?? reorderBlock.error ?? replaceLive.error ?? commentLive.error ?? finish.error
  // Комментарий тренера к упражнению в live — сохраняется по blur, если изменился.
  function liveCommentField(exercise: WorkoutExercise) {
    if (clientMode) return null
    return <details className="live-exercise-note">
      <summary>Заметка тренера{exercise.trainerComment ? <span> · есть текст</span> : null}</summary>
      <textarea className="exercise-comment" aria-label={`Комментарий: ${exercise.name}`} placeholder="Комментарий к упражнению…" rows={1} defaultValue={exercise.trainerComment ?? ''} disabled={commentLive.isPending}
        onBlur={(event) => { const next = event.target.value.trim(); if (next !== (exercise.trainerComment ?? '')) commentLive.mutate({ exerciseId: exercise.id, comment: next }) }} />
    </details>
  }
  // Меню упражнения в live (⋯): «Заменить» доступно, пока нет подтверждённых
  // подходов (начатое заменять нельзя — факт относился к старому упражнению).
  // В меню, чтобы редкое действие не конкурировало с подтверждением подхода.
  function exerciseMenu(exercise: WorkoutExercise, canReorder = false, removableSet?: WorkoutSet) {
    if (clientMode) return null
    const canReplace = !exercise.sets.some((set) => set.confirmedAt)
    const showRpe = rpeExercises.has(exercise.id)
    return <OverflowMenu items={[
      ...(canReorder && !reordering ? [{ label: 'Изменить порядок', onClick: () => setReordering(true) }] : []),
      { label: showRpe ? 'Скрыть RPE' : 'Указать RPE', onClick: () => setRpeExercises((current) => { const next = new Set(current); if (showRpe) next.delete(exercise.id); else next.add(exercise.id); return next }) },
      ...(canReplace ? [{ label: 'Заменить', disabled: replaceLive.isPending, onClick: () => { setReplaceExerciseId(exercise.id); setPickerOpen(true) } }] : []),
      ...(removableSet ? [{ label: 'Удалить подход', danger: true, disabled: removeSet.isPending, onClick: async () => { if (await askConfirm({ message: 'Удалить этот подход?', confirmLabel: 'Удалить', danger: true })) removeSet.mutate(removableSet.id) } }] : []),
    ]} />
  }
  // Стрелки ↑/↓ видны только во временном режиме перестановки.
  function liveReorder(blockId: string, isFirst: boolean, isLast: boolean) {
    if (clientMode || !reordering) return null
    return <span className="block-reorder">
      <button type="button" className="reorder-btn" aria-label="Вверх" disabled={isFirst || reorderBlock.isPending} onClick={() => reorderBlock.mutate({ blockId, direction: -1 })}>↑</button>
      <button type="button" className="reorder-btn" aria-label="Вниз" disabled={isLast || reorderBlock.isPending} onClick={() => reorderBlock.mutate({ blockId, direction: 1 })}>↓</button>
    </span>
  }
  // Форма одного подхода в live: подтверждение / правка / удаление / автосейв по blur.
  function renderLiveSet(exercise: WorkoutExercise, set: WorkoutSet, label?: string, current = false) {
    const displayedSet = setWithLocalDraft(set, localSetDrafts.get(set.id))
    const isEditing = editingSets.has(set.id)
    const isExpanded = current || isEditing || expandedSetId === set.id
    // «Закрыто» (подтверждён) — зелёный; «в работе» (текущий) — серый.
    const stateClass = set.confirmedAt && !isEditing ? 'confirmed' : current && !isEditing ? 'current' : ''
    const saveStatus = savingSetId === set.id ? 'saving' : saveErrorSetId === set.id ? 'error' : savedSetId === set.id ? 'saved' : 'idle'
    const setNumber = label?.match(/\d+/)?.[0]
    const confirmLabel = set.confirmedAt ? 'Подтверждено' : 'Готово, отдых'
    if (!isExpanded) {
      const plan = planLine(exercise.inputKind, set)
      const fact = set.confirmedAt ? factLine(displayedSet) : enteredFactLine(displayedSet)
      return <div className={`live-set-compact ${set.confirmedAt ? 'confirmed' : 'upcoming'}`} key={set.id}>
        <span className="live-set-number" aria-label={label}>{setNumber ?? '•'}</span>
        <span className="live-set-compact-values"><strong>{fact ? `${set.confirmedAt ? 'Факт' : 'Введено'} ${fact}` : plan ? `План ${plan}` : 'Без значений'}</strong>{fact && plan && <small>План {plan}</small>}</span>
        {set.confirmedAt
          ? <button type="button" className="link live-set-compact-action" aria-label="Редактировать подход" onClick={() => setEditingSets((prev) => new Set(prev).add(set.id))}>✎</button>
          : <button type="button" className="link live-set-compact-action" aria-label={`Ввести подход ${setNumber ?? ''}`} onPointerDown={() => saveOpenLiveSet(exercise, set.id)} onClick={() => openLiveSet(exercise, set.id)}>Ввести</button>}
      </div>
    }
    const showRpe = rpeExercises.has(exercise.id)
    return <form data-live-set-id={set.id} ref={(node) => { if (node) liveSetForms.current.set(set.id, node); else liveSetForms.current.delete(set.id) }} className={`exercise live-set live-set-expanded ${stateClass} ${showRpe ? 'rpe-visible' : ''}`} key={set.id} onBlur={(event) => {
      if (skipBlurForSet.current === set.id) { skipBlurForSet.current = null; return }
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
      persistLiveDraft(set, draftFrom(event.currentTarget))
    }}>
      <div className="workout-set-row live-set-grid">
        <span className="workout-set-number live-set-number" aria-label={label}>{setNumber ?? '•'}</span>
        <LiveSetFields inputKind={exercise.inputKind} set={displayedSet} editing={isEditing} showRpe={showRpe} />
        <div className="live-set-confirm">
          {set.confirmedAt && isEditing
            ? <button type="button" className="secondary live-set-save" aria-label="Сохранить" disabled={save.isPending}
                onPointerDown={() => { skipBlurForSet.current = set.id }}
                onClick={(event) => { const form = event.currentTarget.form; if (form) persistLiveDraft(set, draftFrom(form)); setEditingSets((prev) => { const next = new Set(prev); next.delete(set.id); return next }); skipBlurForSet.current = null }}>✓</button>
            : <button type="button" className={set.confirmedAt ? 'secondary live-set-check done' : 'live-set-check'} aria-label={confirmLabel} disabled={Boolean(set.confirmedAt) || confirm.isPending}
                onPointerDown={() => { skipBlurForSet.current = set.id }}
                onClick={(event) => { const form = event.currentTarget.form; if (form) confirm.mutate({ set, draft: draftFrom(form) }); skipBlurForSet.current = null }}>✓</button>}
          <div className="live-set-save-feedback"><SaveStatus status={saveStatus} error={saveStatus === 'error' ? save.error?.message : undefined} /></div>
        </div>
      </div>
    </form>
  }
  // «Назад» ведёт в карточку тренировки: таб-бар в live скрыт, поэтому нужен
  // явный выход наружу без завершения тренировки (тренер может вернуться позже).
  return <Page title="Live-тренировка" className="live-workout-page" back={`/workouts/${workoutId}`}>
    <AsyncView loading={query.isLoading} error={query.error}>{query.data && <>
      <p className="live-client-name"><span>Тренируется</span>{query.data.clientName}</p>
      {(() => {
        // Активная круговая (многоэлементный блок с незавершёнными подходами) —
        // её счётчик «Круг N из M» + точки закрепляем вместе с таймером, чтобы при
        // скролле по кругам всегда было видно, на каком круге сейчас.
        const liveBlocks = groupIntoBlocks(query.data.exercises)
        const activeCircuit = liveBlocks.find((b) => b.exercises.length > 1 && b.exercises.some((ex) => ex.sets.some((s) => !s.confirmedAt)))
        const circuitRounds = activeCircuit ? blockRoundsView(activeCircuit) : null
        const circuitCurrent = circuitRounds ? currentRoundIndex(circuitRounds) : 0
        return (
        /* Закреплённый блок: таймер + отдых + прогресс активной круговой. */
        <div className="live-pinned">
          <WorkoutTimer startedAt={query.data.startedAt ?? null} />
          {restRemaining !== null && <div className="rest-timer">
            <strong>Отдых {formatRest(restRemaining)}</strong>
            <div className="rest-controls">
              <button type="button" className="rest-step" aria-label="Минус 15 секунд" onClick={() => adjustRest(-REST_STEP)}>−15с</button>
              <button type="button" className="rest-step" aria-label="Плюс 15 секунд" onClick={() => adjustRest(REST_STEP)}>+15с</button>
              <button type="button" className="link" onClick={stopRest}>Пропустить</button>
            </div>
          </div>}
          {activeCircuit && circuitRounds && <div className="circuit-head pinned">
            <span className="block-badge">{blockLabel(activeCircuit.blockType, activeCircuit.blockPreset)}</span>
            <span className="circuit-counter">Круг {circuitRounds[circuitCurrent]?.round ?? 1} из {circuitRounds.length}</span>
            <span className="circuit-dots" aria-hidden="true">{circuitRounds.map((r, i) => <span key={r.round} className={`circuit-dot ${r.items.every(({ set }) => set.confirmedAt) ? 'done' : i === circuitCurrent ? 'current' : ''}`} />)}</span>
          </div>}
        </div>)
      })()}
      {reordering && <div className="live-reorder-mode" role="status"><span>Изменение порядка</span><button type="button" className="secondary" onClick={() => setReordering(false)}>Готово</button></div>}
      {(() => { const liveBlocks = groupIntoBlocks(query.data.exercises);
        // Индекс первого блока с незавершёнными подходами = «текущий» блок.
        // До него — завершённые, после — предстоящие. Даёт статус за секунду.
        const currentBlockIndex = liveBlocks.findIndex((b) => b.exercises.some((ex) => ex.sets.some((s) => !s.confirmedAt)))
        return liveBlocks.map((block, blockIndex) => {
        // ↑/↓ показываем только когда блоков больше одного; двигать можно любые
        // блоки (в т.ч. с завершёнными подходами), кроме упора в границу.
        const canReorder = liveBlocks.length > 1
        const reorder = canReorder ? liveReorder(block.blockId, blockIndex === 0, blockIndex === liveBlocks.length - 1) : null
        const blockStatus = currentBlockIndex === -1 ? 'done' : blockIndex < currentBlockIndex ? 'done' : blockIndex === currentBlockIndex ? 'current' : 'upcoming'
        // Одиночное упражнение (или блок из одного) — как раньше, по подходам.
        // Текущий подход (первый неподтверждённый) подсвечивается серым.
        if (block.blockType === 'single' || block.exercises.length === 1) {
          return block.exercises.map((exercise) => {
            const currentSetIndex = exercise.sets.findIndex((set) => !set.confirmedAt)
            // Открыта одна строка: по умолчанию первая незавершённая, после тапа
            // — выбранная тренером. При уходе с предыдущей строки её черновик
            // уже сохранён локально в persistLiveDraft.
            const activeSetId = expandedSetId ?? exercise.sets[currentSetIndex]?.id
            const allDone = exercise.sets.every((set) => set.confirmedAt)
            // Завершённое упражнение сворачиваем в компактный итог, ТОЛЬКО пока
            // впереди есть незавершённый блок (тренер перешёл дальше). Когда всё
            // готово (currentBlockIndex === -1), последнее упражнение оставляем
            // раскрытым — это последнее действие, «сворачивать за» нечего, и там
            // же остаются подтверждение/правка факта. Тап по свёрнутой — раскрыть.
            const collapsed = allDone && !clientMode && currentBlockIndex !== -1 && !expandedExercises.has(exercise.id)
            if (collapsed) {
              const doneCount = exercise.sets.length
              const best = exercise.sets.map((set) => factLine(set)).filter(Boolean).slice(-1)[0] ?? null
              return <button type="button" key={exercise.id} className="live-exercise-collapsed"
                onClick={() => setExpandedExercises((prev) => new Set(prev).add(exercise.id))}>
                <span className="live-collapsed-check" aria-hidden="true">✓</span>
                <span className="live-collapsed-body"><strong>{exercise.name}</strong><span className="muted">{doneCount} {doneCount === 1 ? 'подход' : doneCount < 5 ? 'подхода' : 'подходов'}{best ? ` · ${best}` : ''}</span></span>
                <StatusBadge status="done" />
              </button>
            }
            return <section key={exercise.id} className={`live-exercise ${blockStatus}`}>
              <div className="live-exercise-head"><h2>{exercise.name}</h2><span className="exercise-head-actions"><StatusBadge status={blockStatus} />{exerciseMenu(exercise, canReorder, currentSetIndex >= 0 && exercise.sets.length > 1 ? exercise.sets[currentSetIndex] : undefined)}{reorder}</span></div>
              {(() => { const result = previousExerciseResults.data?.get(exercise.ref); const line = result && previousResultLine(result.sets); return line ? <p className="live-previous-result">В прошлый раз: {line}</p> : null })()}
              <div className="workout-set-table live-set-table">
              <div className={`workout-set-table-head live-set-table-head ${rpeExercises.has(exercise.id) ? 'rpe-visible' : ''}`} aria-hidden="true"><span>№</span><span>Кг</span><span>Повт.</span>{rpeExercises.has(exercise.id) && <span>RPE</span>}<span>Статус</span></div>
                {exercise.sets.map((set, index) => renderLiveSet(exercise, set, `Подход ${index + 1}`, set.id === activeSetId))}
              </div>
              {!clientMode && <button type="button" className="secondary live-add-set" disabled={appendSet.isPending} onClick={() => appendSet.mutate(exercise.id)}>＋ Подход</button>}
              {liveCommentField(exercise)}
            </section>
          })
        }
        // Многоэлементный блок — по кругам, со счётчиком «Круг R из N».
        const rounds = blockRoundsView(block)
        const current = currentRoundIndex(rounds)
        // Счётчик «Круг N из M» + точки закреплены сверху (.live-pinned) для
        // активной круговой; здесь в шапке блока — бейдж, счётчик и стрелки.
        // Точки не дублируем (они в закрепе), но счётчик оставляем как заголовок
        // блока (актуален и для неактивных/завершённых круговых при скролле).
        return <div className="exercise-block live" key={block.blockId}>
          <div className="circuit-head">
            <span className="block-badge">{blockLabel(block.blockType, block.blockPreset)}</span>
            <span className="circuit-counter">Круг {rounds[current]?.round ?? 1} из {rounds.length}</span>
            {!clientMode && canReorder && !reordering && <OverflowMenu items={[{ label: 'Изменить порядок', onClick: () => setReordering(true) }]} />}
            {reorder}
          </div>
          {rounds.map((round, roundIndex) => { const roundDone = round.items.every(({ set }) => set.confirmedAt); return <div className={`circuit-round ${roundDone ? 'done' : roundIndex === current ? 'current' : ''}`} key={round.round}>
            <div className="circuit-round-label">Круг {round.round}</div>
            {round.items.map(({ exercise, set }) => <section key={set.id}>
              <div className="live-exercise-head"><h3>{exercise.name}</h3>{roundIndex === 0 && <span className="exercise-head-actions">{exerciseMenu(exercise)}</span>}</div>
              {renderLiveSet(exercise, set, undefined, roundIndex === current && !set.confirmedAt)}
              {roundIndex === 0 && liveCommentField(exercise)}
            </section>)}
          </div> })}
        </div>
      }) })()}
      {!clientMode && <button type="button" className="secondary wide" onClick={() => { setReplaceExerciseId(null); setPickerOpen(true) }}>＋ Ещё упражнение</button>}
      {error && <p className="error">{error.message}</p>}
      {/* Закреплённая нижняя панель: «Завершить» — вторичная, чтобы не
          конкурировать с primary-подтверждением подхода в карточке.
          Подтверждение частичного завершения — inline (не нативный confirm,
          который не работает в WKWebView и блокировал выход). */}
      <div className="live-bottom-bar">
        {confirmFinish
          ? <div className="finish-confirm">
              <p>Есть незавершённые подходы. Завершить частично?</p>
              <div className="actions">
                <button type="button" className="secondary" onClick={() => setConfirmFinish(false)}>Отмена</button>
                <button type="button" disabled={finish.isPending} onClick={() => { setConfirmFinish(false); finish.mutate() }}>Завершить</button>
              </div>
            </div>
          : <button type="button" className="secondary wide" disabled={finish.isPending} onClick={() => { const incomplete = query.data!.exercises.some((exercise) => exercise.sets.some((set) => !set.confirmedAt)); if (incomplete) setConfirmFinish(true); else finish.mutate() }}>Завершить тренировку</button>}
      </div>
    </>}</AsyncView>
    {!clientMode && pickerOpen && <ExercisePicker catalog={catalog} frequent={frequentExercises} onPick={pickLiveExercise} onClose={closePicker} />}
    {confirmDialog}
  </Page>
}

function numberValue(value: FormDataEntryValue | null) { return value ? Number(value) : undefined }

type ExerciseCardTab = 'stats' | 'history' | 'how'

export function ExerciseHistoryPage() {
  const { workoutId = '', exerciseRef = '' } = useParams()
  const [tab, setTab] = useState<ExerciseCardTab>('stats')
  const current = useQuery({ queryKey: ['workout', workoutId], queryFn: () => workoutsRepository.get(workoutId) })
  useClientRealtime(current.data?.clientId)
  const history = useQuery({ queryKey: ['exercise-history', current.data?.clientId, exerciseRef], queryFn: async () => (await workoutsRepository.list(undefined, undefined, current.data!.clientId)).filter((workout) => workout.status === 'done' && workout.exercises.some((exercise) => exercise.ref === exerciseRef)), enabled: Boolean(current.data) })
  // Метаданные упражнения из каталога (картинка/оборудование/мышцы/инструкции).
  const meta = exercisesRepository.system.find((exercise) => exercise.ref === exerciseRef)
  const inputKind = meta?.inputKind ?? history.data?.[0]?.exercises.find((item) => item.ref === exerciseRef)?.inputKind ?? 'strength'
  const name = meta?.name ?? history.data?.[0]?.exercises.find((item) => item.ref === exerciseRef)?.name ?? 'Упражнение'
  // Полная дата (YYYY-MM-DD) — нужна для AxisTick/тултипа как на вкладке замеров.
  const chart = useMemo(() => exerciseChartPoints(history.data ?? [], exerciseRef), [history.data, exerciseRef])
  const unit = chartUnitFor(inputKind)
  const instructions = meta?.instructions ?? []
  return <Page title="Упражнение" back={`/workouts/${workoutId}`}>
    <AsyncView loading={current.isLoading || history.isLoading} error={current.error ?? history.error}>
      <section className="exercise-card-head card">
        {meta?.imageUrl && <img className="exercise-card-image" src={meta.imageUrl} alt={name} />}
        <div className="exercise-card-meta">
          <h2>{name}</h2>
          {meta?.equipment && <p><span className="muted">Оборудование:</span> {meta.equipment}</p>}
          {meta?.primaryMuscleDetail && <p><span className="muted">Основная группа мышц:</span> {meta.primaryMuscleDetail}</p>}
          {meta?.secondaryMuscles?.length ? <p><span className="muted">Вторичная группа мышц:</span> {meta.secondaryMuscles.join(', ')}</p> : null}
        </div>
      </section>

      <div className="tabs exercise-card-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'stats'} className={tab === 'stats' ? 'tab active' : 'tab'} onClick={() => setTab('stats')}>Статистика</button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'tab active' : 'tab'} onClick={() => setTab('history')}>История</button>
        <button type="button" role="tab" aria-selected={tab === 'how'} className={tab === 'how' ? 'tab active' : 'tab'} onClick={() => setTab('how')}>Техника</button>
      </div>

      {tab === 'stats' && (chart.length > 1
        ? (() => {
            // Оформление как на вкладке замеров: пунктирная сетка, подписи дат
            // «01 / июль», подписи значений у мин/макс точек, форматированный тултип.
            const values = chart.map((point) => point.value)
            const minValue = Math.min(...values); const maxValue = Math.max(...values)
            const minIndex = values.indexOf(minValue); const maxIndex = values.indexOf(maxValue)
            return <section className="chart"><h2>Динамика ({unit})</h2><ResponsiveContainer width="100%" height={260}><LineChart data={chart} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" stroke="var(--muted)" height={40} tick={AxisTick} interval={Math.max(0, Math.ceil(chart.length / 5) - 1)} />
              <YAxis stroke="var(--muted)" style={{ fontSize: '12px' }} domain={computeYDomain(values)} allowDecimals />
              <Tooltip contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 12 }} labelStyle={{ color: '#e9e4ed', fontWeight: 700 }} itemStyle={{ color: '#e9e4ed' }}
                formatter={(value) => formatTooltipValue(Number(value), unit, name)} labelFormatter={(date) => formatTooltipLabel(String(date))} />
              <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={3}
                dot={(dotProps: { cx?: number; cy?: number; index?: number }) => renderChartDot(dotProps, minIndex, maxIndex, chart.length)}
                activeDot={{ r: 7 }} isAnimationActive={false} />
            </LineChart></ResponsiveContainer></section>
          })()
        : chart.length === 1
        ? <section className="stat-single card"><span className="muted">Текущий результат</span><strong>{chart[0]!.value} {unit}</strong><p className="muted">График динамики появится после второй проведённой тренировки.</p></section>
        : <p className="muted empty-hint">Пока нет данных. График появится после проведённых тренировок с фактом.</p>)}

      {tab === 'history' && (() => {
        // История строго по факту: показываем только подтверждённые подходы.
        // Тренировку показываем, если есть факт ИЛИ комментарий тренера.
        const rows = [...(history.data ?? [])]
          .sort((a, b) => (a.workoutDate < b.workoutDate ? 1 : -1))
          .map((workout) => {
            const exercise = workout.exercises.find((item) => item.ref === exerciseRef)
            const facts = (exercise?.sets ?? []).map((set) => factLine(set)).filter((line): line is string => line !== null)
            return { workout, facts, comment: exercise?.trainerComment }
          })
          .filter((row) => row.facts.length > 0 || row.comment)
        return rows.length
          ? <div className="timeline">{rows.map(({ workout, facts, comment }) => <article key={workout.id} className="card"><div><strong>{formatLocalDate(workout.workoutDate)}</strong>{facts.length > 0 && <p>{facts.join(', ')}</p>}{comment && <p className="exercise-comment-note">💬 {comment}</p>}</div></article>)}</div>
          : <p className="muted empty-hint">Ещё нет выполненных подходов по этому упражнению.</p>
      })()}

      {tab === 'how' && (instructions.length
        ? <ol className="how-steps">{instructions.map((step, index) => <li key={index}>{step}</li>)}</ol>
        : <p className="muted empty-hint">Описание техники пока не добавлено.</p>)}
    </AsyncView>
  </Page>
}
