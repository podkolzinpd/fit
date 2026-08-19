import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { goalsRepository } from '../../data/repositories/goals.repository'
import { invitationsRepository } from '../../data/repositories/invitations.repository'
import { currentStage, orderedStages } from '../../shared/goal-rules'
import { exercisesRepository } from '../../data/repositories/exercises.repository'
import { AxisTick, computeYDomain, formatTooltipLabel, formatTooltipValue, renderChartDot } from '../progress/ProgressChart'
import { restoreRestDeadline, storeRestDeadline } from './rest-timer-storage'
import { blockLabel, chartUnitFor, compactCompletedSetSummary, compactPlannedSetSummary, completedWorkoutDraft, copyWorkout, createRunningFormatDrafts, durationLabel, durationSeconds, enteredFactLine, exerciseSummary, factLine, formatFactVsPlan, groupIntoBlocks, blockRoundsView, currentRoundIndex, muscleGroupLabels, previousResultLine, replaceExercise, restSecondsAfterSet, splitClientWorkouts, tonnageLabel, workoutStatusPresentation, workoutDurationLabel, workoutTonnage, workoutsRepository, type PreviousExerciseResult } from '../../data/repositories/workouts.repository'
import type { ExerciseProgressCursor, ExerciseSnapshot, LiveSetDraft, TrainerReaction, Workout, WorkoutDraft, WorkoutExercise as WorkoutExerciseModel, WorkoutFeedbackDraft, WorkoutSet, WorkoutTrainerResponseDraft, WorkoutWellbeing } from '../../shared/domain'
import { playGong } from '../../shared/gong'
import {
  addDays, dayOfMonth, formatLocalDate, localDate, startOfWeek, todayInTimeZone, weekdayShort,
  type LocalDate,
} from '../../shared/local-date'
import { AsyncView, Field, OverflowMenu, Page, SaveStatus, StatePanel, useConfirm } from '../../shared/ui'
import { ExercisePicker, recentExercisesForClient, useExerciseCatalog } from '../exercises'
import { clientWorkoutAuthorLabel, ClientPicker, type ClientPickerSelection } from '../clients'
import { VoiceNoteField } from '../voice-input'
import { QuickWorkoutEntry } from './QuickWorkoutEntry'
import { WorkoutExerciseEditor } from './WorkoutExerciseEditor'
import { RPE_OPTIONS } from '../../shared/rpe'
import type { RunningFormat } from '../../shared/running-formats'
import type { ParsedWorkoutExercise } from './quick-workout-entry'
import { createLiveSetCoordinator } from './live-set-coordinator'
import { applyLiveSetDraft, sameLiveSetDraft, setWithLocalDraft } from './live-set-cache'
import { clearPendingLiveSetDrafts, readPendingLiveSetDrafts, removePendingLiveSetDraft, writePendingLiveSetDraft } from './live-set-draft-storage'
import { createLiveWorkoutCoordinator, liveWorkoutRecoveryError } from './live-workout-coordinator'
import { setLiveScreenAwake } from './live-keep-awake'
import { LoadMoreButton } from './LoadMoreButton'
import { workoutCountLabel } from './workout-count-label'
import { useAuth } from '../../app/auth-context'
import { useRpeDisplay } from '../../app/rpe-display'
import { useClientRealtime } from '../../app/use-client-realtime'
import { readWorkoutFormDraft, removeWorkoutFormDraft, workoutFormDraftKey, writeWorkoutFormDraft } from './workout-form-draft'
import { workoutDateForRecordMode } from './workout-entry-rules'
import { WorkoutSetTable } from './WorkoutSetTable'
import { RunMetricsFields } from './RunMetricsFields'
import { parseRunDurationInput, runDistanceKmFromInput, runDistanceLabel, runPaceLabel, type RunDistanceUnit } from '../../shared/run-metrics'
import { WorkoutExerciseHeader } from './WorkoutExerciseHeader'
import { ExerciseProgressHistory, ExerciseProgressSummary } from './ExerciseProgressSummary'
import { AddIcon } from '../../shared/icons'
import { WorkoutCta, WorkoutExercise, WorkoutExerciseCompact, WorkoutHeader, WorkoutSetRow, WorkoutStatus, type WorkoutUiState } from './WorkoutSurface'
import { liveSessionProgress } from './live-session-progress'
import { chronicleExercisePreview } from './workout-chronicle'

const HOURS = Array.from({ length: 24 }, (_, index) => index)
const HOUR_HEIGHT = 56
export const WORKOUT_HISTORY_PAGE_SIZE = 20

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
  const { actor } = useAuth()
  const today = todayInTimeZone(actor?.timezone)
  const selected = params.get('date') ? localDate(params.get('date')!) : today
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
        <Link className="schedule-add" to={`/workouts/new?date=${selected}`} aria-label="Новая тренировка"><AddIcon /></Link>
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
          <Link key={workout.id} className="card" to={`/workouts/${workout.id}`}><div><strong>{workout.clientName}</strong><p>{exerciseSummary(workout).map((e) => e.name).join(', ') || 'без упражнений'}</p></div><WorkoutStatusBadge workout={workout} /></Link>
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

export function WorkoutStatusBadge({ workout }: { workout: Workout }) {
  const { actor } = useAuth()
  const status = workoutStatusPresentation(workout, todayInTimeZone(actor?.timezone))
  const state: WorkoutUiState = status.tone === 'done' ? 'completed'
    : status.tone === 'in_progress' ? 'current'
      : status.tone === 'partial' ? 'partial'
        : status.tone === 'skipped' ? 'skipped'
          : 'planned'
  return <WorkoutStatus state={state} label={status.label} />
}

// Список упражнений тренировки для карточки (история/предстоящие): каждое
// на своей строке, у упражнений с комментарием — сам комментарий ниже.
// Одинаково в плане и в истории.
function exerciseCountLabel(count: number): string {
  const lastTwo = count % 100
  const last = count % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 'упражнений'
  if (last === 1) return 'упражнение'
  if (last >= 2 && last <= 4) return 'упражнения'
  return 'упражнений'
}

export function WorkoutExercisesSummary({ workout, maxItems }: { workout: Workout; maxItems?: number }) {
  const items = exerciseSummary(workout)
  if (!items.length) return <p className="muted">Без упражнений</p>
  const visibleItems = maxItems === undefined ? items : items.slice(0, maxItems)
  return <ul className="workout-exercise-list">{visibleItems.map((item, index) => <li key={index}>
    <span className="workout-exercise-name">{item.name}{item.comment && ' 💬'}</span>
    {item.comment && <span className="workout-exercise-comment">💬 {item.comment}</span>}
  </li>)}{maxItems !== undefined && items.length > maxItems && <li className="workout-exercise-more">Ещё {items.length - maxItems} {exerciseCountLabel(items.length - maxItems)}</li>}</ul>
}

const chronicleWellbeingLabels: Record<WorkoutWellbeing, string> = {
  good: 'Хорошо',
  normal: 'Нормально',
  hard: 'Тяжело',
}

const chronicleReactionLabels: Record<TrainerReaction, string> = {
  thumbs_up: '👍',
  fire: '🔥',
  strong: '💪',
}

export function WorkoutChronicleCard({ workout, contextLabel }: { workout: Workout; contextLabel?: string | null }) {
  const done = workout.status === 'done'
  const duration = workoutDurationLabel(workout.startedAt, workout.completedAt)
  const tonnage = workoutTonnage(workout)
  const meta = done ? [duration, tonnage > 0 ? tonnageLabel(tonnage) : null].filter(Boolean) : []
  const hasFeedback = workout.sessionRpe !== undefined && workout.wellbeing !== undefined
  const exercisePreview = chronicleExercisePreview(workout.exercises)

  return <Link className="card workout-chronicle-card" to={`/workouts/${workout.id}`}>
    <div className="workout-chronicle-head">
      <strong>{formatLocalDate(workout.workoutDate)}</strong>
      <div className="workout-chronicle-head-badges">
        {workout.hasPr && <span className="workout-pr-badge">Новый рекорд</span>}
        <WorkoutStatusBadge workout={workout} />
      </div>
    </div>
    {contextLabel && <p className="card-author">{contextLabel}</p>}
    <div className="workout-chronicle-exercises">
      {exercisePreview.visible.length > 0 ? exercisePreview.visible.map((exercise) => {
        const result = done
          ? compactCompletedSetSummary(exercise.sets)
          : compactPlannedSetSummary(exercise.sets) ?? 'План без числовых значений'
        return <div className="workout-chronicle-exercise" key={exercise.id}>
          <span className="workout-chronicle-exercise-name">{exercise.name}
            {exercise.trainerComment && <small className="workout-exercise-comment">💬 {exercise.trainerComment}</small>}
          </span>
          <strong>{result}</strong>
        </div>
      }) : <p className="muted">Без упражнений</p>}
      {exercisePreview.hiddenCount > 0 && <p className="workout-chronicle-more">Ещё {exercisePreview.hiddenCount} {exerciseCountLabel(exercisePreview.hiddenCount)}</p>}
    </div>
    {(meta.length > 0 || hasFeedback || workout.discomfort) && <div className="card-meta workout-chronicle-facts">
      {meta.map((item) => <span key={item}>{item}</span>)}
      {hasFeedback && <span>RPE {workout.sessionRpe}/10</span>}
      {workout.wellbeing && <span>{chronicleWellbeingLabels[workout.wellbeing]}</span>}
      {workout.discomfort && <span className="attention">Дискомфорт</span>}
    </div>}
    {workout.clientComment && <p className="workout-chronicle-comment"><span className="workout-chronicle-note-label">Клиент</span><span className="workout-chronicle-note-text">{workout.clientComment}</span></p>}
    {workout.trainerReview && <p className="workout-chronicle-response">
      <span className="workout-chronicle-note-label">{workout.trainerReaction ? chronicleReactionLabels[workout.trainerReaction] : 'Тренер'}</span>
      <span className="workout-chronicle-note-text">{workout.trainerReview}</span>
    </p>}
  </Link>
}

export function ClientWorkoutsPage() {
  const { clientId = '' } = useParams()
  const { actor } = useAuth()
  const today = todayInTimeZone(actor?.timezone)
  useClientRealtime(clientId)
  const query = useInfiniteQuery({
    queryKey: ['workouts', clientId, 'history', today],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => workoutsRepository.listPage(undefined, today, clientId, pageParam, WORKOUT_HISTORY_PAGE_SIZE),
    getNextPageParam: (page) => page.nextOffset,
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const history = splitClientWorkouts(items, today).history
  return <Page title="История тренировок" back={`/clients/${clientId}`} action={<Link className="button" to={`/workouts/new?client=${clientId}`}>Добавить</Link>}><AsyncView loading={query.isLoading} error={query.error} empty={!history.length} onRetry={() => void query.refetch()}
    emptyTitle="История пока пуста"
    emptyDescription="Завершённые тренировки появятся здесь вместе с результатами."
    emptyAction={<Link className="button" to={`/workouts/new?client=${clientId}`}>Запланировать тренировку</Link>}><div className="cards workout-chronicle-list">{history.map((workout) => {
    const clientAuthored = Boolean(workout.createdBy && workout.createdBy !== actor?.userId)
    return <WorkoutChronicleCard key={workout.id} workout={workout} contextLabel={clientAuthored ? 'Создано клиентом' : null} />
  })}</div><LoadMoreButton hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onLoadMore={() => void query.fetchNextPage()} /></AsyncView></Page>
}

export function WorkoutFormPage() {
  const { workoutId } = useParams()
  const { actor } = useAuth()
  const today = todayInTimeZone(actor?.timezone)
  const showRpeByDefault = useRpeDisplay(actor?.userId)
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
  const [entryDate, setEntryDate] = useState<LocalDate>(() => localDate(params.get('date') ?? today))
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [notes, setNotes] = useState('')
  const [clientSelectionError, setClientSelectionError] = useState<string | null>(null)
  const [stageId, setStageId] = useState('')
  const [formDraftReady, setFormDraftReady] = useState(false)
  const [prefillError, setPrefillError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  // Индекс упражнения, которое заменяем через пикер; null — режим добавления.
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  const initial = source.data ? (workoutId ? { ...(source.data.status === 'done' ? completedWorkoutDraft(source.data) : copyWorkout(source.data)), id: source.data.id, version: source.data.version } : copyWorkout(source.data, today)) : undefined
  const exercises = draftExercises ?? initial?.exercises ?? []
  const draftKey = workoutFormDraftKey(actor?.userId ?? 'anonymous', sourceId ?? `new-${params.get('client') ?? ''}-${params.get('date') ?? ''}`)
  // Клиент, для которого выбираем этап (реактивно — при смене в селекте).
  const defaultClientId = clientMode ? (mine.data?.id ?? '') : (initial?.clientId ?? params.get('client') ?? '')
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const clientId = selectedClientId || defaultClientId
  const clientWorkouts = useQuery({ queryKey: ['client-exercises-frequency', clientId], queryFn: () => workoutsRepository.list(undefined, undefined, clientId), enabled: Boolean(clientId) })
  const clientRecentExercises = useMemo(() => recentExercisesForClient(catalog.exercises, clientWorkouts.data ?? []), [catalog.exercises, clientWorkouts.data])
  const goal = useQuery({ queryKey: ['client-goal', clientId], queryFn: () => goalsRepository.get(clientId), enabled: Boolean(clientId) })
  const stages = goal.data ? orderedStages(goal.data) : []
  // Этап по умолчанию: сохранённый у тренировки, иначе текущий по дате.
  const defaultStageId = source.data?.stageId ?? (goal.data ? currentStage(goal.data, today)?.id ?? '' : '')
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
      setStartTime(saved.startTime.slice(0, 5))
      setEndTime(saved.endTime.slice(0, 5))
      setNotes(saved.notes)
      setStageId(saved.stageId)
      setRecordCompleted(saved.recordCompleted)
      setDraftExercises(saved.exercises)
    } else if (initial) {
      setEntryDate(workoutDateForRecordMode(source.data?.status === 'done' ? 'completed' : 'planned', initial.workoutDate, today))
      // PostgreSQL возвращает time как HH:MM:SS, а нативный input[type=time]
      // без шага секунд принимает HH:MM. Иначе браузер молча блокирует submit.
      setStartTime(initial.startTime?.slice(0, 5) ?? '')
      setEndTime(initial.endTime?.slice(0, 5) ?? '')
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
    setEntryDate(workoutDateForRecordMode(source.data?.status === 'done' ? 'completed' : 'planned', initial.workoutDate, today))
  }, [formDraftReady, initial, source.data?.status])
  const mutation = useMutation({ mutationFn: (draft: WorkoutDraft) => completedMode ? workoutsRepository.saveCompleted(draft) : workoutsRepository.save(draft), onSuccess: async (id) => {
    if (!workoutId) removeWorkoutFormDraft(draftKey)
    // Перед переходом карточка должна получить новую optimistic-concurrency
    // version. Иначе пользователь успевает запустить только что изменённую
    // тренировку из устаревшего cache и получает ложный conflict.
    await queryClient.invalidateQueries({ queryKey: ['workout', id] })
    navigate(`/workouts/${id}`)
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workouts'] }),
      queryClient.invalidateQueries({ queryKey: ['today-workouts'] }),
      queryClient.invalidateQueries({ queryKey: ['today-recent-workouts'] }),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
    ])
  } })

  async function createQuickClient(fullName: string): Promise<ClientPickerSelection> {
    const id = await clientsRepository.createQuick(fullName)
    await queryClient.invalidateQueries({ queryKey: ['clients'] })
    return { id, fullName }
  }

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
  async function pickExercise(selected: ExerciseSnapshot, runningFormat?: RunningFormat) {
    if (runningFormat) {
      const selectedDrafts = createRunningFormatDrafts(selected, runningFormat, replaceIndex ?? exercises.length)
      if (selectedDrafts.length) {
        const next = replaceIndex === null
          ? [...exercises, ...selectedDrafts]
          : [
              ...exercises.slice(0, replaceIndex),
              ...selectedDrafts.map((draft) => source.data?.status === 'done' ? { ...draft, clearFact: true } : draft),
              ...exercises.slice(replaceIndex + 1),
            ]
        setDraftExercises(next.map((exercise, position) => ({ ...exercise, position })))
      }
      closePicker()
      return
    }
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
        return {
          ...fallback,
          ...item.structure,
          sets: item.hasValues ? item.sets : fallback.sets,
        }
      }),
    ])
  }
  function closePicker() { setPickerOpen(false); setReplaceIndex(null); setPickerSearch('') }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (exercises.length === 0) return
    const form = new FormData(event.currentTarget)
    const submitClientId = String(form.get('clientId'))
    if (!submitClientId) { setClientSelectionError('Выберите клиента для тренировки'); return }
    const date = workoutDateForRecordMode(completedMode ? 'completed' : 'planned', entryDate, today)
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
  const loading = source.isLoading || mine.isLoading
  const error = source.error ?? mine.error
  const pageTitle = workoutId ? 'Редактировать тренировку' : params.has('copy') ? 'Копия тренировки' : 'Новая тренировка'
  const documentTitle = workoutId ? 'Редактирование тренировки' : params.has('copy') ? 'Копирование тренировки' : 'Создание тренировки'
  return <Page title={documentTitle} hideTitle className="workout-form-page workout-focused-page" back={-1}>
    <WorkoutHeader eyebrow={completedMode ? 'РЕЗУЛЬТАТ' : 'ПЛАН ТРЕНИРОВКИ'} title={pageTitle} state={completedMode ? 'history' : 'planned'}
      meta={exercises.length > 0 ? `${exercises.length} ${exerciseCountLabel(exercises.length)}` : 'Сначала добавьте упражнения'} />
    <AsyncView loading={loading} error={error} onRetry={() => { void source.refetch(); void mine.refetch() }}>{editingDenied ? <StatePanel tone="info" title="Редактирование недоступно" description="Назначенную тренером тренировку может менять только тренер." action={<button type="button" className="secondary" onClick={() => navigate(-1)}>Вернуться</button>} /> : clientMode && !mine.data ? <StatePanel tone="info" title="Карточка ещё не подключена" description="Создайте личную карточку в кабинете — после этого можно будет добавлять самостоятельные тренировки." action={<Link className="button" to="/me">Создать карточку</Link>} /> : <form className="stack workout-form" onSubmit={(event) => void submit(event)}>
      <section className="workout-form-section">
        <div className="workout-form-section-head"><p className="eyebrow">ОСНОВНЫЕ ДАННЫЕ</p><h2>Тренировка</h2></div>
        {clientMode
          ? <input type="hidden" name="clientId" value={mine.data?.id ?? ''} />
          : <ClientPicker userId={actor?.userId} clients={availableClients ?? []} selectedId={clientId} onChange={(id) => { setClientSelectionError(null); setSelectedClientId(id) }} selectionError={clientSelectionError} loading={clients.isLoading} error={clients.error} onRetry={() => void clients.refetch()} onCreate={createQuickClient} />}
        <div className="split"><Field label="Дата"><input name="date" type="date" max={completedMode ? today : undefined} value={entryDate} onChange={(event) => setEntryDate(localDate(event.target.value))} required /></Field><Field label="Время"><input name="startTime" type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); (event.currentTarget.form?.elements.namedItem('endTime') as HTMLInputElement | null)?.setCustomValidity('') }} /></Field></div>
        <Field label="Окончание"><input name="endTime" type="time" value={endTime} onChange={(event) => { setEndTime(event.target.value); event.currentTarget.setCustomValidity('') }} /></Field>
        {!workoutId && <div className="workout-record-mode" role="group" aria-label="Тип тренировки"><button type="button" className={!recordCompleted ? 'active' : ''} aria-pressed={!recordCompleted} onClick={() => setRecordCompleted(false)}>План</button><button type="button" className={recordCompleted ? 'active' : ''} aria-pressed={recordCompleted} onClick={() => { setRecordCompleted(true); setEntryDate((date) => workoutDateForRecordMode('completed', date, today)) }}>Завершённая</button></div>}
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
        <div className="workout-form-section-head"><p className="eyebrow">УПРАЖНЕНИЯ</p><h2>{completedMode ? 'Что выполнено' : 'Что нужно выполнить'}</h2></div>
        <QuickWorkoutEntry catalog={catalog.exercises} preferredExerciseRefs={clientRecentExercises.map((exercise) => exercise.ref)} onAdd={(parsed) => void addQuickEntry(parsed)} onOpenCatalog={(search) => { setPickerSearch(search); setReplaceIndex(null); setPickerOpen(true) }} />
        {exercises.length === 0 && <p className="workout-empty-hint" role="status">Добавьте хотя бы одно упражнение — голосом, текстом или из каталога.</p>}
        <WorkoutExerciseEditor exercises={exercises} onChange={setDraftExercises} onOpenPicker={() => { setReplaceIndex(null); setPickerOpen(true) }} onReplaceExercise={(index) => { setReplaceIndex(index); setPickerOpen(true) }} showTrainerComments={!clientMode} entryMode={completedMode ? 'fact' : 'plan'} hideEmptyAddAction previousResults={previousResultReferences} showRpeByDefault={showRpeByDefault} />
      </section>
      {prefillError && <p className="error">{prefillError}</p>}
      {mutation.error && <p className="error">{mutation.error.message}</p>}
      <div className="actions"><button type="button" className="secondary" disabled={mutation.isPending} onClick={() => navigate(-1)}>Отмена</button><WorkoutCta pending={mutation.isPending} pendingLabel="Сохраняем…" disabled={exercises.length === 0}>{recordCompleted ? 'Записать тренировку' : completedMode ? 'Сохранить изменения' : 'Сохранить'}</WorkoutCta></div>
    </form>}</AsyncView>
    {pickerOpen && <ExercisePicker catalog={catalog} clientRecent={clientRecentExercises} initialSearch={pickerSearch} initialMode={replaceIndex === null && exercises.length === 0 ? 'choose' : 'all'} onPick={pickExercise} onPickMany={pickExercises} multiple={replaceIndex === null} onClose={closePicker} />}
  </Page>
}

export function WorkoutDetailPage() {
  const { workoutId = '' } = useParams(); const navigate = useNavigate(); const location = useLocation(); const queryClient = useQueryClient()
  const { actor } = useAuth()
  const showRpe = useRpeDisplay(actor?.userId)
  const [confirm, confirmDialog] = useConfirm()
  const [askActiveWorkoutRecovery, activeWorkoutRecoveryDialog] = useConfirm()
  const query = useQuery({ queryKey: ['workout', workoutId], queryFn: () => workoutsRepository.get(workoutId) })
  useClientRealtime(query.data?.clientId)
  // Этап тренировки: get() отдаёт stageId, название берём из цели клиента.
  const goal = useQuery({ queryKey: ['client-goal', query.data?.clientId], queryFn: () => goalsRepository.get(query.data!.clientId), enabled: Boolean(query.data?.stageId && query.data?.clientId) })
  const stageTitle = query.data?.stageId ? goal.data?.stages.find((stage) => stage.id === query.data!.stageId)?.title ?? null : null
  const start = useMutation({
    mutationFn: async () => {
      const active = await workoutsRepository.findActive(query.data!.clientId)
      if (active && active.id !== workoutId) return { kind: 'active' as const, workout: active }
      await workoutsRepository.start(query.data!)
      return { kind: 'started' as const, workoutId }
    },
    onSuccess: async (result) => {
      if (result.kind === 'active') {
        const shouldResume = await askActiveWorkoutRecovery({
          message: `У ${query.data!.clientName} уже есть незавершённая тренировка от ${formatLocalDate(result.workout.workoutDate)}. Откройте её, чтобы продолжить или завершить.`,
          confirmLabel: 'Открыть незавершённую',
          cancelLabel: 'Остаться в плане',
        })
        if (shouldResume) navigate(`/workouts/${result.workout.id}/live`)
        return
      }
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['workout', workoutId] }), queryClient.invalidateQueries({ queryKey: ['clients'] })])
      navigate(`/workouts/${result.workoutId}/live`)
    },
    onError: async (error) => {
      if (error instanceof Error && 'code' in error && error.code === 'active_workout_exists') {
        const active = await workoutsRepository.findActive(query.data!.clientId)
        if (active) {
          const shouldResume = await askActiveWorkoutRecovery({
            message: `У ${query.data!.clientName} уже есть незавершённая тренировка от ${formatLocalDate(active.workoutDate)}. Откройте её, чтобы продолжить или завершить.`,
            confirmLabel: 'Открыть незавершённую',
            cancelLabel: 'Остаться в плане',
          })
          if (shouldResume) navigate(`/workouts/${active.id}/live`)
        }
      }
    },
  })
  const remove = useMutation({ mutationFn: () => workoutsRepository.remove(query.data!), onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['workouts'] }), queryClient.invalidateQueries({ queryKey: ['clients'] })]); navigate(actor?.role === 'client' ? '/me/workouts' : '/schedule') } })
  const review = useMutation({ mutationFn: (value: WorkoutTrainerResponseDraft) => workoutsRepository.setWorkoutReview(query.data!, value), onSuccess: async () => {
    await Promise.all([
      query.refetch(),
      queryClient.invalidateQueries({ queryKey: ['workouts'] }),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
    ])
  } })
  const feedback = useMutation({ mutationFn: (value: WorkoutFeedbackDraft) => workoutsRepository.submitFeedback(query.data!, value), onSuccess: async () => {
    await Promise.all([
      query.refetch(),
      queryClient.invalidateQueries({ queryKey: ['workouts'] }),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
    ])
  } })
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
  const trainerOwned = !clientMode && Boolean(workout && (!workout.createdBy || workout.createdBy === actor?.userId))
  const canManage = clientMode ? clientOwned : trainerOwned
  const canExecute = clientMode || trainerOwned
  const clientAuthoredReadOnly = !clientMode && Boolean(workout && !trainerOwned)
  const canReview = !clientMode && Boolean(done && workout && (
    trainerOwned || (clientAuthoredReadOnly && workout.trainerId === actor?.userId)
  ))
  const trainers = useQuery({ queryKey: ['client-trainers', workout?.clientId], queryFn: () => invitationsRepository.listTrainers(workout!.clientId), enabled: clientMode && Boolean(workout?.clientId) })
  const authorLabel = workout ? clientWorkoutAuthorLabel(workout.createdBy, actor?.userId, trainers.data) : null
  const responseAuthor = trainers.data?.find((trainer) => trainer.trainerId === workout?.trainerReviewAuthorId)
  const responseAuthorName = responseAuthor ? [responseAuthor.firstName, responseAuthor.lastName].filter(Boolean).join(' ') : null
  // Карточка не должна угадывать источник открытия. Быстрый сценарий «Сегодня»
  // передаёт returnTo, остальные пути сохраняют прежний безопасный fallback.
  const backTo = navigationState?.returnTo ?? (clientMode ? '/me/workouts' : '/schedule')
  const detailState: WorkoutUiState = workout?.status === 'done' ? (completedSets < sets.length ? 'partial' : 'completed') : workout?.status === 'in_progress' ? 'current' : 'planned'
  return <Page title="Тренировка" hideTitle className="workout-detail-page" back={backTo}>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>{workout && <>
      {justCompleted && <section className="workout-completion" aria-labelledby="workout-completion-title">
        <span className="workout-completion-mark" aria-hidden="true">✓</span>
        <div>
          <span className="workout-completion-kicker">Результат сохранён</span>
          <h2 id="workout-completion-title">Тренировка завершена</h2>
          <p>{sets.length > 0 ? `Выполнено ${completedSets} из ${sets.length} подходов` : 'Результаты сохранены'}</p>
        </div>
      </section>}
      <WorkoutHeader eyebrow={clientMode ? 'ВАША ТРЕНИРОВКА' : 'ТРЕНИРОВКА КЛИЕНТА'} title={clientMode ? 'Ваша тренировка' : workout.clientName} state={detailState}
        statusLabel={workoutStatusPresentation(workout, todayInTimeZone(actor?.timezone)).label}
        meta={<><span>{formatLocalDate(workout.workoutDate)} · {workout.startTime?.slice(0, 5) ?? 'без времени'}</span>{clientMode && authorLabel && <span>{authorLabel}</span>}{clientAuthoredReadOnly && <span>Создано клиентом · только просмотр</span>}{stageTitle && <span>Цель: {stageTitle}</span>}</>} />
      {workout.status === 'planned' && canExecute && <WorkoutCta className="wide" pending={start.isPending} pendingLabel="Начинаем…" onClick={() => start.mutate()}>Начать тренировку</WorkoutCta>}
      {start.error && !(start.error instanceof Error && 'code' in start.error && start.error.code === 'active_workout_exists') && <p className="error">{start.error.message}</p>}
      {workout.status === 'in_progress' && canExecute && <Link className="button wide" to={`/workouts/${workoutId}/live`}>Продолжить тренировку</Link>}
      {done && <section className="workout-fact-summary" aria-label="Сводка тренировки">
        {duration && <p><span>Время</span><strong>{duration}</strong></p>}
        {tonnage > 0 && <p><span>Тоннаж</span><strong>{tonnageLabel(tonnage)}</strong></p>}
        {groups.length > 0 && <p className="workout-fact-summary-groups"><span>Группы мышц</span><strong>{groups.join(' · ')}</strong></p>}
      </section>}
      {done && <WorkoutClientFeedback workout={workout} canEdit={clientMode} saving={feedback.isPending} error={feedback.error} onSave={(value) => feedback.mutateAsync(value)} />}
      {done && <WorkoutTrainerReview workout={workout} canEdit={canReview} authorName={responseAuthorName} saving={review.isPending} error={review.error} onSave={(value) => review.mutateAsync(value)} />}
      {!clientMode && workout.clientComment && workout.sessionRpe === undefined && <WorkoutClientComment workout={workout} />}
      <div className={`cards ${done ? 'completed-exercise-list' : ''}`}>{groupIntoBlocks(workout.exercises).map((block) => {
        const articles = block.exercises.map((exercise) => {
          const compactPlan = workout.status === 'planned' ? compactPlannedSetSummary(exercise.sets, showRpe) : null
          return <WorkoutExercise state={done ? 'history' : 'planned'} className={`exercise ${done ? 'completed-exercise' : ''}`} key={exercise.id}>
          <Link className="exercise-name-link" to={`/workouts/${workout.id}/history/${encodeURIComponent(exercise.ref)}`}><strong>{exercise.name}</strong> <span className="exercise-name-hint">↗ история</span></Link>
          {done ? <details className="completed-exercise-details"><summary className="completed-set-summary">{compactCompletedSetSummary(exercise.sets, showRpe)}</summary><WorkoutSetTable variant="history" inputKind={exercise.inputKind} showRpe={false} columnLabels={['Результат']} className="workout-history-sets">
            {exercise.sets.map((set, index) => <WorkoutHistorySet key={set.id} set={set} index={index} done showRpe={showRpe} />)}
          </WorkoutSetTable></details> : compactPlan ? <p className="planned-set-summary"><span>План</span><strong>{compactPlan}</strong></p> : <WorkoutSetTable variant="history" inputKind={exercise.inputKind} showRpe={false} columnLabels={['Результат']} className="workout-history-sets">
            {exercise.sets.map((set, index) => <WorkoutHistorySet key={set.id} set={set} index={index} done={done} showRpe={showRpe} />)}
          </WorkoutSetTable>}
          {exercise.trainerComment && <p className="exercise-comment-note">💬 {exercise.trainerComment}</p>}
        </WorkoutExercise>
        })
        if (block.blockType === 'single' || block.exercises.length === 1) return articles
        return <div className={`exercise-block view${done ? ' completed-exercise-block' : ''}`} key={block.blockId}><span className="block-badge">{blockLabel(block.blockType, block.blockPreset)} · {block.blockRounds} кр.</span>{articles}</div>
      })}</div>
      {workout.notes && <section className="workout-review"><div className="workout-review-head"><div><p className="eyebrow">{clientMode && !clientOwned ? 'ОТ ТРЕНЕРА' : 'К ТРЕНИРОВКЕ'}</p><h2>{clientMode && !clientOwned ? 'Инструкции' : 'Заметка'}</h2></div></div><p className="workout-review-text">{workout.notes}</p></section>}
      {canManage && <><div className="actions">
        {(workout.status === 'planned' || done) && <Link className="button secondary" to={`/workouts/${workoutId}/edit`}>{done ? 'Изменить результат' : 'Изменить'}</Link>}
        <Link className="button secondary" to={`/workouts/new?copy=${workoutId}`}>Копировать</Link>
      </div>
      <button className="danger secondary wide" disabled={remove.isPending} aria-busy={remove.isPending} onClick={async () => { if (await confirm({ message: 'Удалить тренировку?', confirmLabel: 'Удалить', danger: true })) remove.mutate() }}>{remove.isPending ? 'Удаляем…' : 'Удалить тренировку'}</button></>}
      {clientAuthoredReadOnly && <div className="actions"><Link className="button secondary" to={`/workouts/new?copy=${workoutId}`}>Скопировать и отправить план</Link></div>}
      {clientMode && !clientOwned && <div className="actions"><Link className="button secondary" to={`/workouts/new?copy=${workoutId}`}>Создать свою копию</Link></div>}
      {remove.error && <p className="error">{remove.error.message}</p>}
      {confirmDialog}{activeWorkoutRecoveryDialog}
    </>}</AsyncView>
  </Page>
}

const wellbeingLabels: Record<WorkoutWellbeing, string> = {
  good: 'Хорошо',
  normal: 'Нормально',
  hard: 'Тяжело',
}

const trainerReactionLabels: Record<TrainerReaction, string> = {
  thumbs_up: '👍',
  fire: '🔥',
  strong: '💪',
}

function trainerResponseTime(value: string | undefined) {
  if (!value) return null
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function WorkoutClientFeedback({ workout, canEdit, saving, error, onSave }: {
  workout: Workout
  canEdit: boolean
  saving: boolean
  error: Error | null
  onSave: (value: WorkoutFeedbackDraft) => Promise<unknown>
}) {
  const hasFeedback = workout.sessionRpe !== undefined && workout.wellbeing !== undefined && workout.discomfort !== undefined
  const [editing, setEditing] = useState(canEdit && !hasFeedback)
  const [saved, setSaved] = useState(false)
  const [sessionRpe, setSessionRpe] = useState<number | undefined>(workout.sessionRpe)
  const [wellbeing, setWellbeing] = useState<WorkoutWellbeing | undefined>(workout.wellbeing)
  const [discomfort, setDiscomfort] = useState<boolean | undefined>(workout.discomfort ?? (workout.clientComment ? true : undefined))
  const [comment, setComment] = useState(workout.clientComment ?? '')

  useEffect(() => {
    if (editing) return
    setSessionRpe(workout.sessionRpe)
    setWellbeing(workout.wellbeing)
    setDiscomfort(workout.discomfort ?? (workout.clientComment ? true : undefined))
    setComment(workout.clientComment ?? '')
  }, [editing, workout.clientComment, workout.discomfort, workout.id, workout.sessionRpe, workout.wellbeing])

  if (!canEdit && !hasFeedback) return null
  const valid = sessionRpe !== undefined && wellbeing !== undefined && discomfort !== undefined
    && (!discomfort || comment.trim().length > 0)

  if (!editing) return <section className="workout-review workout-feedback" aria-labelledby="workout-feedback-title">
    <div className="workout-review-head">
      <div><p className="eyebrow">ОБРАТНАЯ СВЯЗЬ</p><h2 id="workout-feedback-title">{canEdit ? 'Ваш итог' : 'Самочувствие клиента'}</h2></div>
      {canEdit && <button type="button" className="secondary" onClick={() => { setSaved(false); setEditing(true) }}>Изменить</button>}
    </div>
    {saved && <p className="workout-feedback-confirmation" role="status">✓ Спасибо, тренер увидит ваш отзыв.</p>}
    <div className="workout-feedback-summary">
      <p><span>Общая тяжесть</span><strong>RPE {workout.sessionRpe}/10</strong></p>
      <p><span>Самочувствие</span><strong>{workout.wellbeing ? wellbeingLabels[workout.wellbeing] : '—'}</strong></p>
      <p><span>Дискомфорт</span><strong>{workout.discomfort ? 'Да' : 'Нет'}</strong></p>
    </div>
    {workout.discomfort && workout.clientComment && <p className="workout-review-text">{workout.clientComment}</p>}
  </section>

  return <form className="workout-review workout-feedback" aria-labelledby="workout-feedback-title" onSubmit={async (event) => {
    event.preventDefault()
    if (!valid || sessionRpe === undefined || wellbeing === undefined || discomfort === undefined) return
    try {
      await onSave({ sessionRpe, wellbeing, discomfort, comment: discomfort ? comment : '' })
      setSaved(true)
      setEditing(false)
    } catch {
      // Ошибка мутации остаётся рядом с формой; пользователь может повторить
      // тот же submit, а RPC безопасно дедуплицирует потерянный ответ.
    }
  }}>
    <div className="workout-review-head"><div><p className="eyebrow">ПОСЛЕ ТРЕНИРОВКИ</p><h2 id="workout-feedback-title">Как прошла тренировка?</h2></div></div>
    <fieldset className="workout-feedback-fieldset">
      <legend>Общая тяжесть</legend>
      <p className="muted">1 — очень легко, 10 — максимум</p>
      <div className="workout-feedback-options workout-feedback-rpe">
        {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <button key={value} type="button" className={`secondary workout-feedback-option ${sessionRpe === value ? 'selected' : ''}`} aria-pressed={sessionRpe === value} onClick={() => setSessionRpe(value)}>{value}</button>)}
      </div>
    </fieldset>
    <fieldset className="workout-feedback-fieldset">
      <legend>Самочувствие</legend>
      <div className="workout-feedback-options">
        {(Object.keys(wellbeingLabels) as WorkoutWellbeing[]).map((value) => <button key={value} type="button" className={`secondary workout-feedback-option ${wellbeing === value ? 'selected' : ''}`} aria-pressed={wellbeing === value} onClick={() => setWellbeing(value)}>{wellbeingLabels[value]}</button>)}
      </div>
    </fieldset>
    <fieldset className="workout-feedback-fieldset">
      <legend>Был дискомфорт?</legend>
      <div className="workout-feedback-options">
        <button type="button" className={`secondary workout-feedback-option ${discomfort === false ? 'selected' : ''}`} aria-pressed={discomfort === false} onClick={() => setDiscomfort(false)}>Нет</button>
        <button type="button" className={`secondary workout-feedback-option ${discomfort === true ? 'selected' : ''}`} aria-pressed={discomfort === true} onClick={() => setDiscomfort(true)}>Да</button>
      </div>
    </fieldset>
    {discomfort && <Field label="Что беспокоило?"><textarea aria-label="Пояснение о дискомфорте" rows={3} maxLength={500} placeholder="Где и на каком движении почувствовали дискомфорт" value={comment} onChange={(event) => setComment(event.target.value)} /></Field>}
    {error && <p className="error">{error.message}</p>}
    <div className="actions workout-review-actions">
      {hasFeedback && <button type="button" className="secondary" disabled={saving} onClick={() => setEditing(false)}>Отмена</button>}
      <button type="submit" disabled={saving || !valid}>{saving ? 'Сохраняем…' : hasFeedback ? 'Сохранить изменения' : 'Отправить отзыв'}</button>
    </div>
  </form>
}

function WorkoutTrainerReview({ workout, canEdit, authorName, saving, error, onSave }: {
  workout: Workout
  canEdit: boolean
  authorName: string | null
  saving: boolean
  error: Error | null
  onSave: (value: WorkoutTrainerResponseDraft) => Promise<unknown>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(workout.trainerReview ?? '')
  const [reaction, setReaction] = useState<TrainerReaction | undefined>(workout.trainerReaction)
  const hasReview = Boolean(workout.trainerReview)
  const valid = Boolean(reaction && value.trim().length > 0 && value.trim().length <= 500)

  useEffect(() => {
    if (!editing) {
      setValue(workout.trainerReview ?? '')
      setReaction(workout.trainerReaction)
    }
  }, [editing, workout.id, workout.trainerReaction, workout.trainerReview])

  if (!canEdit && !hasReview) return null

  return <section className="workout-review" aria-labelledby="workout-review-title">
    <div className="workout-review-head">
      <div><p className="eyebrow">ПОСЛЕ ТРЕНИРОВКИ</p><h2 id="workout-review-title">Отзыв тренера</h2></div>
      {canEdit && !editing && <button type="button" className="secondary" onClick={() => setEditing(true)}>{hasReview ? 'Изменить' : 'Добавить'}</button>}
    </div>
    {editing ? <>
      <fieldset className="workout-feedback-fieldset workout-trainer-reactions">
        <legend>Реакция</legend>
        <div className="workout-feedback-options">
          {(Object.keys(trainerReactionLabels) as TrainerReaction[]).map((item) => <button key={item} type="button" className={`secondary workout-feedback-option ${reaction === item ? 'selected' : ''}`} aria-label={trainerReactionLabels[item]} aria-pressed={reaction === item} onClick={() => setReaction(item)}>{trainerReactionLabels[item]}</button>)}
        </div>
      </fieldset>
      <VoiceNoteField name="trainerReview" source="workout_review" label="Отзыв тренера" placeholder="Что получилось и на что обратить внимание дальше" value={value} onValueChange={(next) => setValue(next.slice(0, 500))} autoResize />
      <p className="workout-response-limit muted">{value.length}/500</p>
      {error && <p className="error">{error.message}</p>}
      <div className="actions workout-review-actions">
        <button type="button" className="secondary" disabled={saving} onClick={() => { setValue(workout.trainerReview ?? ''); setReaction(workout.trainerReaction); setEditing(false) }}>Отмена</button>
        <button type="button" disabled={saving || !valid} onClick={async () => {
          if (!reaction) return
          try {
            await onSave({ reaction, review: value })
            setEditing(false)
          } catch {
            // Ошибку мутации показывает общий экранный state ниже поля.
          }
        }}>{saving ? 'Сохраняем…' : 'Отправить ответ'}</button>
      </div>
    </> : hasReview ? <>
      <div className="workout-response-body">
        {workout.trainerReaction && <span className="workout-response-reaction" aria-label={`Реакция ${trainerReactionLabels[workout.trainerReaction]}`}>{trainerReactionLabels[workout.trainerReaction]}</span>}
        <p className="workout-review-text">{workout.trainerReview}</p>
      </div>
      {(authorName || workout.trainerReviewedAt) && <p className="workout-response-meta">{[authorName || 'Тренер', trainerResponseTime(workout.trainerReviewedAt)].filter(Boolean).join(' · ')}</p>}
    </> : <p className="muted">Добавьте реакцию и короткий ответ, пока впечатления свежие.</p>}
  </section>
}

function WorkoutClientComment({ workout }: { workout: Workout }) {
  return <section className="workout-review" aria-labelledby="workout-client-comment-title">
    <div className="workout-review-head"><div><p className="eyebrow">ОБРАТНАЯ СВЯЗЬ</p><h2 id="workout-client-comment-title">Комментарий клиента</h2></div></div>
    <p className="workout-review-text">{workout.clientComment}</p>
  </section>
}

function formatSet(set: WorkoutSet, showRpe: boolean) {
  const duration = durationLabel(set.durationSec, set.durationMin)
  const distance = runDistanceLabel(set.distanceKm)
  const pace = runPaceLabel(durationSeconds(set.durationSec, set.durationMin), set.distanceKm)
  const plan = [set.weightKg && `${set.weightKg} кг`, set.reps && `${set.reps} повт.`, distance, duration, showRpe && set.rpe !== undefined && `RPE ${set.rpe}`].filter(Boolean).join(' × ')
  return pace && plan ? `${plan} · темп ${pace}` : plan || 'Подход без плана'
}

function WorkoutHistorySet({ set, index, done, showRpe }: { set: WorkoutSet; index: number; done: boolean; showRpe: boolean }) {
  const confirmed = Boolean(set.confirmedAt)
  const { fact, planNote } = formatFactVsPlan(set, showRpe)
  const result = done ? fact : formatSet(set, showRpe)
  return <WorkoutSetRow state={done ? (confirmed ? 'completed' : 'skipped') : 'planned'} className={`workout-history-set ${confirmed ? 'confirmed' : 'missed'}`}>
    <span className="workout-set-number workout-history-set-number" aria-label={`Подход ${index + 1}`}>{index + 1}</span>
    <span className="workout-history-set-result"><strong>{result}</strong>
      {done && !confirmed && <span className="plan-note">не выполнено</span>}
      {done && confirmed && planNote && <span className="plan-note">{planNote}</span>}
    </span>
    {done && <span className="workout-history-set-status" aria-label={confirmed ? 'Выполнен' : 'Не выполнен'}>{confirmed ? '✓' : '—'}</span>}
  </WorkoutSetRow>
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
    const distance = runDistanceLabel(set.distanceKm)
    if (distance) parts.push(distance)
  }
  if (set.rpe !== undefined) parts.push(`RPE ${set.rpe}`)
  const plan = parts.length ? parts.join(' × ') : null
  const pace = inputKind === 'distance' ? runPaceLabel(durationSeconds(set.durationSec, set.durationMin), set.distanceKm) : null
  return pace && plan ? `${plan} · темп ${pace}` : plan
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
  // В обычном вводе ответ автосохранения меняет version, но не должен
  // пересоздавать активный input: на iOS это закрывает клавиатуру и сдвигает
  // текущий подход. Версия нужна в key только для уже зафиксированного факта.
  const k = locked || editing ? `${mode}-${set.version}` : mode
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
    <RunMetricsFields
      idPrefix={`live-run-${set.id}-${k}`}
      durationSec={value(factDuration, planDuration)}
      distanceKm={value(set.fact.distanceKm, set.distanceKm)}
      inputClassName="live-set-input"
      disabled={locked}
      planDurationHint={isPlanHint(factDuration, planDuration)}
      planDistanceHint={isPlanHint(set.fact.distanceKm, set.distanceKm)}
      durationName="runDuration"
      distanceName="runDistance"
      distanceUnitName="runDistanceUnit"
      durationLabel="Фактическое время"
      distanceLabel="Фактическая дистанция"
      distanceUnitLabel="Единица фактической дистанции"
    />
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
  const showRpeByDefault = useRpeDisplay(actor?.userId)
  const clientMode = actor?.role === 'client'
  const navigate = useNavigate()
  const [askConfirm, confirmDialog] = useConfirm()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['workout', workoutId], queryFn: () => workoutsRepository.get(workoutId) })
  // Во время live и тренер, и клиент могут корректировать структуру: добавить
  // или заменить упражнение, подход и порядок. Серверные live-RPC используют
  // тот же authorisation путь с разрешённым выполнением для подключённого
  // клиента; экран не должен скрывать доступные действия по роли.
  const canManageLiveStructure = Boolean(query.data)
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
  const clientRecentExercises = useMemo(() => recentExercisesForClient(catalog.exercises, clientWorkouts.data ?? []), [catalog.exercises, clientWorkouts.data])
  const [liveSets] = useState(() => createLiveSetCoordinator(
    (id, draft, version) => workoutsRepository.saveLiveSet(id, draft, version),
    (id, version) => workoutsRepository.confirmLiveSet(id, version),
  ))
  const [liveWorkout] = useState(() => createLiveWorkoutCoordinator())
  const completedLocally = useRef(false)
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
  const [recoveredSetIds, setRecoveredSetIds] = useState<Set<string>>(() => new Set())
  const liveSetForms = useRef<Map<string, HTMLFormElement>>(new Map())
  const [savingSetId, setSavingSetId] = useState<string | null>(null)
  const [savedSetId, setSavedSetId] = useState<string | null>(null)
  const [saveErrorSetId, setSaveErrorSetId] = useState<string | null>(null)
  useEffect(() => {
    if (!actor?.userId || !query.data) return
    const serverSets = new Map(query.data.exercises.flatMap((exercise) => exercise.sets).map((set) => [set.id, set]))
    const pending = readPendingLiveSetDrafts(actor.userId, workoutId)
    for (const [setId, draft] of pending) {
      const serverSet = serverSets.get(setId)
      if (!serverSet || sameLiveSetDraft(serverSet.fact, draft)) {
        removePendingLiveSetDraft(actor.userId, workoutId, setId)
        pending.delete(setId)
      }
    }
    setRecoveredSetIds(new Set(pending.keys()))
    setLocalSetDrafts((current) => {
      const next = new Map(current)
      for (const [setId, draft] of pending) next.set(setId, draft)
      for (const [setId, draft] of next) {
        const serverSet = serverSets.get(setId)
        if (!serverSet || sameLiveSetDraft(serverSet.fact, draft)) next.delete(setId)
      }
      return next
    })
  }, [actor?.userId, query.data, workoutId])
  useEffect(() => {
    if (query.data?.status !== 'done') return
    if (actor?.userId) clearPendingLiveSetDrafts(actor.userId, workoutId)
    // При обычном успешном finish итоговый экран открывает onSuccess ниже с
    // justCompleted. Этот fallback нужен только когда ответ потерялся, но
    // refetch уже увидел завершённую тренировку, либо после reload live URL.
    if (completedLocally.current) return
    navigate(`/workouts/${workoutId}`, { replace: true })
  }, [actor?.userId, navigate, query.data?.status, workoutId])
  function rememberLiveDraft(setId: string, draft: LiveSetDraft) {
    setLocalSetDrafts((current) => new Map(current).set(setId, draft))
    if (actor?.userId) writePendingLiveSetDraft(actor.userId, workoutId, setId, draft)
  }
  function acknowledgeLiveDraft(setId: string) {
    if (actor?.userId) removePendingLiveSetDraft(actor.userId, workoutId, setId)
    setLocalSetDrafts((current) => {
      if (!current.has(setId)) return current
      const next = new Map(current)
      next.delete(setId)
      return next
    })
    setRecoveredSetIds((current) => {
      if (!current.has(setId)) return current
      const next = new Set(current)
      next.delete(setId)
      return next
    })
  }
  // Завершённые упражнения по умолчанию свёрнуты; id здесь — принудительно раскрытые
  // тренером (тап по свёрнутой карточке), чтобы поправить факт.
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(() => new Set())
  // Общая настройка не меняет RPE-данные; меню упражнения позволяет временно
  // показать или скрыть поле только для конкретного упражнения.
  const [rpeOverrides, setRpeOverrides] = useState<Map<string, boolean>>(() => new Map())
  function isRpeVisible(exerciseId: string) {
    return rpeOverrides.get(exerciseId) ?? showRpeByDefault
  }
  function toggleRpe(exerciseId: string) {
    setRpeOverrides((current) => new Map(current).set(exerciseId, !isRpeVisible(exerciseId)))
  }
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
  async function runLiveSetMutation(operation: () => Promise<number>) {
    try {
      return await operation()
    } catch (error) {
      const refreshed = await query.refetch()
      throw liveWorkoutRecoveryError(error, !refreshed.error)
    }
  }
  const save = useMutation({
    mutationFn: ({ set, draft }: { set: WorkoutSet; draft: LiveSetDraft }) => runLiveSetMutation(() => liveSets.save(set, draft)),
    onMutate: ({ set }) => { setSavingSetId(set.id); setSavedSetId(null); setSaveErrorSetId(null) },
    onSuccess: async (version, { set, draft }) => {
      setSavingSetId(null)
      setSavedSetId(set.id)
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
      // Сразу закрепляем факт и новую версию в кэше для любого подхода. Раньше
      // правка уже подтверждённого подхода ждала refetch и на iOS могла
      // отрисоваться старым значением до второй попытки сохранения.
      queryClient.setQueryData<Workout>(
        ['workout', workoutId],
        (workout) => workout ? applyLiveSetDraft(workout, set.id, draft, version) : workout,
      )
      acknowledgeLiveDraft(set.id)
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
    // Запоминаем ввод до RPC и на устройстве. Это не меняет факт на сервере,
    // но не даёт realtime-снимку или reload скрыть его при медленной сети.
    rememberLiveDraft(set.id, draft)
    save.mutate({ set, draft })
  }
  function liveFormChanged(form: HTMLFormElement) {
    return Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))
      .some((field) => field.value !== (field instanceof HTMLInputElement
        ? field.defaultValue
        : field.options[field.selectedIndex]?.defaultSelected ? field.value : ''))
  }
  function saveOpenLiveSet(exercise: WorkoutExerciseModel, targetSetId: string) {
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
  function openLiveSet(exercise: WorkoutExerciseModel, targetSetId: string) {
    saveOpenLiveSet(exercise, targetSetId)
    setExpandedSetId(targetSetId)
  }
  useEffect(() => {
    if (!savedSetId) return
    const timer = window.setTimeout(() => setSavedSetId(null), 2_500)
    return () => window.clearTimeout(timer)
  }, [savedSetId])
  const confirm = useMutation({
    mutationFn: ({ set, draft }: { set: WorkoutSet; draft: LiveSetDraft }) => runLiveSetMutation(() => liveSets.confirm(set, draft)),
    onMutate: ({ set, draft }) => { rememberLiveDraft(set.id, draft) },
    onSuccess: (_data, { set }) => {
      acknowledgeLiveDraft(set.id)
      setExpandedSetId(null)
      // Отдых берётся из настроек блока (Этап A), не хардкод:
      // - одиночное упражнение → отдых между подходами;
      // - группа: между упражнениями внутри круга → restBetweenExercisesSec;
      //   после последнего упражнения круга → restBetweenRoundsSec.
      const workout = query.data
      const exercise = workout?.exercises.find((item) => item.sets.some((s) => s.id === set.id))
      if (workout && exercise) {
        const sec = restSecondsAfterSet(workout, exercise, set)
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
  function runLiveWorkoutMutation(operationKey: string, operation: (workout: Workout) => Promise<number>) {
    const snapshot = query.data!
    return liveWorkout.run(snapshot, operationKey, async (expectedVersion) => {
      try {
        return await operation({ ...snapshot, version: expectedVersion })
      } catch (error) {
        const refreshed = await query.refetch()
        if (refreshed.data) liveWorkout.sync(refreshed.data)
        throw liveWorkoutRecoveryError(error, !refreshed.error)
      }
    })
  }
  const appendSet = useMutation({ mutationFn: (exerciseId: string) => runLiveWorkoutMutation(`append-set:${exerciseId}`, (workout) => workoutsRepository.appendLiveSet(workout, exerciseId)), onSuccess: async () => { await query.refetch() } })
  const removeSet = useMutation({ mutationFn: (setId: string) => runLiveWorkoutMutation(`remove-set:${setId}`, (workout) => workoutsRepository.removeLiveSet(workout, setId)), onSuccess: async () => { await query.refetch() } })
  const appendExercise = useMutation({ mutationFn: (exercise: ExerciseSnapshot) => runLiveWorkoutMutation(`append-exercise:${exercise.ref}`, (workout) => workoutsRepository.appendLiveExercise(workout, exercise)), onSuccess: async () => { await query.refetch() } })
  const reorderBlock = useMutation({ mutationFn: ({ blockId, direction }: { blockId: string; direction: -1 | 1 }) => runLiveWorkoutMutation(`reorder:${blockId}:${direction}`, (workout) => workoutsRepository.reorderLiveBlock(workout, blockId, direction)), onSuccess: async () => { await query.refetch() } })
  const replaceLive = useMutation({ mutationFn: ({ exerciseId, exercise }: { exerciseId: string; exercise: ExerciseSnapshot }) => runLiveWorkoutMutation(`replace:${exerciseId}`, (workout) => workoutsRepository.replaceLiveExercise(workout, exerciseId, exercise)), onSuccess: async () => { await query.refetch() } })
  const commentLive = useMutation({ mutationFn: ({ exerciseId, comment }: { exerciseId: string; comment: string }) => runLiveWorkoutMutation(`comment:${exerciseId}`, (workout) => workoutsRepository.setExerciseComment(workout, exerciseId, comment)), onSuccess: async () => { await query.refetch() } })
  function closePicker() { setPickerOpen(false); setReplaceExerciseId(null) }
  function pickLiveExercise(exercise: ExerciseSnapshot) {
    if (replaceExerciseId) replaceLive.mutate({ exerciseId: replaceExerciseId, exercise })
    else appendExercise.mutate(exercise)
    closePicker()
  }
  const finish = useMutation({ mutationFn: async () => {
    await liveSets.waitForIdle()
    const version = await runLiveWorkoutMutation('finish', (workout) => workoutsRepository.finish(workout))
    completedLocally.current = true
    return version
  }, onSuccess: async () => {
    const clientId = query.data?.clientId
    if (actor?.userId) clearPendingLiveSetDrafts(actor.userId, workoutId)
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
  const rootMutationPending = appendSet.isPending || removeSet.isPending || appendExercise.isPending
    || reorderBlock.isPending || replaceLive.isPending || commentLive.isPending || finish.isPending
  function draftFrom(form: HTMLFormElement): LiveSetDraft {
    const values = new FormData(form)
    const runDuration = values.get('runDuration')
    const runDistance = values.get('runDistance')
    const runUnit: RunDistanceUnit = values.get('runDistanceUnit') === 'm' ? 'm' : 'km'
    return {
      weightKg: numberValue(values.get('weightKg')),
      reps: numberValue(values.get('reps')),
      distanceKm: runDistance === null ? numberValue(values.get('distanceKm')) : runDistanceKmFromInput(String(runDistance), runUnit),
      durationSec: runDuration === null ? numberValue(values.get('durationSec')) : parseRunDurationInput(String(runDuration)),
      rpe: numberValue(values.get('rpe')),
    }
  }
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
  function liveCommentField(exercise: WorkoutExerciseModel) {
    if (clientMode) return null
    return <details className="live-exercise-note">
      <summary>Заметка тренера{exercise.trainerComment ? <span> · есть текст</span> : null}</summary>
      <textarea className="exercise-comment" aria-label={`Комментарий: ${exercise.name}`} placeholder="Комментарий к упражнению…" rows={1} defaultValue={exercise.trainerComment ?? ''} disabled={rootMutationPending}
        onBlur={(event) => { const next = event.target.value.trim(); if (next !== (exercise.trainerComment ?? '')) commentLive.mutate({ exerciseId: exercise.id, comment: next }) }} />
    </details>
  }
  // Меню упражнения в live (⋯): «Заменить» доступно, пока нет подтверждённых
  // подходов (начатое заменять нельзя — факт относился к старому упражнению).
  // В меню, чтобы редкое действие не конкурировало с подтверждением подхода.
  function exerciseMenu(exercise: WorkoutExerciseModel, canReorder = false, removableSet?: WorkoutSet) {
    if (!canManageLiveStructure) return null
    const canReplace = !exercise.sets.some((set) => set.confirmedAt)
    const showRpe = isRpeVisible(exercise.id)
    return <OverflowMenu items={[
      ...(canReorder && !reordering ? [{ label: 'Изменить порядок', onClick: () => setReordering(true) }] : []),
      { label: showRpe ? 'Скрыть RPE' : 'Указать RPE', onClick: () => toggleRpe(exercise.id) },
      ...(canReplace ? [{ label: 'Заменить', disabled: rootMutationPending, onClick: () => { setReplaceExerciseId(exercise.id); setPickerOpen(true) } }] : []),
      ...(removableSet ? [{ label: 'Удалить подход', danger: true, disabled: rootMutationPending, onClick: async () => { if (await askConfirm({ message: 'Удалить этот подход?', confirmLabel: 'Удалить', danger: true })) removeSet.mutate(removableSet.id) } }] : []),
    ]} />
  }
  // Стрелки ↑/↓ видны только во временном режиме перестановки.
  function liveReorder(blockId: string, isFirst: boolean, isLast: boolean) {
    if (!canManageLiveStructure || !reordering) return null
    return <span className="block-reorder">
      <button type="button" className="reorder-btn" aria-label="Вверх" disabled={isFirst || rootMutationPending} onClick={() => reorderBlock.mutate({ blockId, direction: -1 })}>↑</button>
      <button type="button" className="reorder-btn" aria-label="Вниз" disabled={isLast || rootMutationPending} onClick={() => reorderBlock.mutate({ blockId, direction: 1 })}>↓</button>
    </span>
  }
  // Форма одного подхода в live: подтверждение / правка / удаление / автосейв по blur.
  function renderLiveSet(exercise: WorkoutExerciseModel, set: WorkoutSet, label?: string, current = false) {
    const displayedSet = setWithLocalDraft(set, localSetDrafts.get(set.id))
    const isEditing = editingSets.has(set.id)
    const isExpanded = current || isEditing || expandedSetId === set.id
    // «Закрыто» (подтверждён) — зелёный; «в работе» (текущий) — серый.
    const stateClass = set.confirmedAt && !isEditing ? 'confirmed' : current && !isEditing ? 'current' : ''
    const saveStatus = savingSetId === set.id ? 'saving' : saveErrorSetId === set.id ? 'error' : savedSetId === set.id ? 'saved' : 'idle'
    const setNumber = label?.match(/\d+/)?.[0]
    const restSeconds = query.data ? restSecondsAfterSet(query.data, exercise, set) : 0
    const confirmLabel = set.confirmedAt
      ? 'Подтверждено'
      : exercise.blockPreset === 'interval' && restSeconds === 0
        ? 'Готово'
        : 'Готово, отдых'
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
    const showRpe = isRpeVisible(exercise.id)
    // Локальный draft меняется на каждом autosave. Он не должен быть частью
    // key активной формы: remount закрывал клавиатуру и менял scrollTop.
    // Однократный recovery-key нужен только после reload, чтобы применить
    // восстановленные defaultValue.
    const recoveryKey = recoveredSetIds.has(set.id) ? 'recovered' : 'stable'
    return <form data-live-set-id={set.id} ref={(node) => { if (node) liveSetForms.current.set(set.id, node); else liveSetForms.current.delete(set.id) }} className={`exercise live-set live-set-expanded ${stateClass} ${showRpe ? 'rpe-visible' : ''}`} key={`${set.id}:${recoveryKey}`} onBlur={(event) => {
      if (skipBlurForSet.current === set.id) { skipBlurForSet.current = null; return }
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
      persistLiveDraft(set, draftFrom(event.currentTarget))
    }}>
      <WorkoutSetRow state={set.confirmedAt && !isEditing ? 'completed' : 'current'} className="live-set-grid">
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
      </WorkoutSetRow>
    </form>
  }
  const sessionProgress = liveSessionProgress(query.data?.exercises ?? [])
  // «Назад» ведёт в карточку тренировки: таб-бар в live скрыт, поэтому нужен
  // явный выход наружу без завершения тренировки (тренер может вернуться позже).
  return <Page title="Live-тренировка" hideTitle className="live-workout-page workout-focused-page" back={`/workouts/${workoutId}`}>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>{query.data && <>
      <WorkoutHeader eyebrow="LIVE" title={query.data.clientName} state="current" className="live-session-header" meta={<div className="live-session-progress">
        <span className="live-session-progress-copy"><span>{sessionProgress.complete ? 'Все упражнения выполнены' : `Упражнение ${sessionProgress.activeExerciseNumber} из ${sessionProgress.exerciseCount} · подход ${sessionProgress.activeSetNumber} из ${sessionProgress.activeExerciseSetCount}`}</span><strong>Готово {sessionProgress.completedSetCount} из {sessionProgress.setCount}</strong></span>
        <span className="live-session-progress-track" role="progressbar" aria-label="Выполненные подходы" aria-valuemin={0} aria-valuemax={sessionProgress.setCount} aria-valuenow={sessionProgress.completedSetCount}><span style={{ width: `${sessionProgress.percent}%` }} /></span>
      </div>} />
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
            // В live рабочей остаётся только текущая карточка. Завершённые
            // упражнения сжимаются в итог (тап открывает их исключительно для
            // исправления факта), а будущие не показывают таблицу и RPE раньше
            // времени. Это presentation-only: порядок, факт и RPC не меняются.
            const collapsed = allDone && !expandedExercises.has(exercise.id)
            if (collapsed) {
              const doneCount = exercise.sets.length
              const best = exercise.sets.map((set) => factLine(set)).filter(Boolean).slice(-1)[0] ?? null
              return <WorkoutExerciseCompact key={exercise.id} state="completed" className="live-exercise-collapsed" title={exercise.name}
                meta={`${doneCount} ${doneCount === 1 ? 'подход' : doneCount < 5 ? 'подхода' : 'подходов'}${best ? ` · ${best}` : ''}`}
                onClick={() => setExpandedExercises((prev) => new Set(prev).add(exercise.id))} />
            }
            if (blockStatus === 'upcoming') {
              const firstPlan = exercise.sets.map((set) => planLine(exercise.inputKind, set)).find(Boolean)
              const countLabel = exercise.sets.length === 1 ? 'подход' : exercise.sets.length < 5 ? 'подхода' : 'подходов'
              return <WorkoutExercise key={exercise.id} state="upcoming" className="live-exercise-upcoming">
                <WorkoutExerciseHeader className="live-exercise-head" name={exercise.name} actions={<><WorkoutStatus state="upcoming" />{exerciseMenu(exercise, canReorder, currentSetIndex >= 0 && exercise.sets.length > 1 ? exercise.sets[currentSetIndex] : undefined)}{reorder}</>} />
                <p className="live-upcoming-summary"><span>{exercise.sets.length} {countLabel}</span>{firstPlan && <span>План: {firstPlan}</span>}</p>
              </WorkoutExercise>
            }
            return <WorkoutExercise key={exercise.id} state={blockStatus === 'done' ? 'completed' : blockStatus} className={`live-exercise ${blockStatus}`}>
              <WorkoutExerciseHeader className="live-exercise-head" name={exercise.name} actions={<><WorkoutStatus state={blockStatus === 'done' ? 'completed' : blockStatus} />{exerciseMenu(exercise, canReorder, currentSetIndex >= 0 && exercise.sets.length > 1 ? exercise.sets[currentSetIndex] : undefined)}{reorder}</>} />
              {(() => { const result = previousExerciseResults.data?.get(exercise.ref); const line = result && previousResultLine(result.sets); return line ? <p className="live-previous-result">В прошлый раз: {line}</p> : null })()}
              <WorkoutSetTable variant="live" inputKind={exercise.inputKind} showRpe={isRpeVisible(exercise.id)} trailingLabel="Статус">
                {exercise.sets.map((set, index) => renderLiveSet(exercise, set, `Подход ${index + 1}`, set.id === activeSetId))}
              </WorkoutSetTable>
              {canManageLiveStructure && <button type="button" className="secondary live-add-set" disabled={rootMutationPending} onClick={() => appendSet.mutate(exercise.id)}>＋ Подход</button>}
              {liveCommentField(exercise)}
            </WorkoutExercise>
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
            {canManageLiveStructure && canReorder && !reordering && <OverflowMenu items={[{ label: 'Изменить порядок', onClick: () => setReordering(true) }]} />}
            {reorder}
          </div>
          {rounds.map((round, roundIndex) => { const roundDone = round.items.every(({ set }) => set.confirmedAt); return <div className={`circuit-round ${roundDone ? 'done' : roundIndex === current ? 'current' : ''}`} key={round.round}>
            <div className="circuit-round-label">Круг {round.round}</div>
            {round.items.map(({ exercise, set }) => <section key={set.id}>
              <WorkoutExerciseHeader className="live-exercise-head" titleAs="h3" name={exercise.name} actions={roundIndex === 0 ? exerciseMenu(exercise) : undefined} />
              {renderLiveSet(exercise, set, undefined, roundIndex === current && !set.confirmedAt)}
              {roundIndex === 0 && liveCommentField(exercise)}
            </section>)}
          </div> })}
        </div>
      }) })()}
      {canManageLiveStructure && <button type="button" className="secondary wide" disabled={rootMutationPending} onClick={() => { setReplaceExerciseId(null); setPickerOpen(true) }}>＋ Ещё упражнение</button>}
      {recoveredSetIds.size > 0 && <p className="state" role="status">Восстановили несохранённые данные. Проверьте подходы и сохраните их повторно.</p>}
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
                <WorkoutCta pending={finish.isPending} pendingLabel="Завершаем…" disabled={rootMutationPending || save.isPending || confirm.isPending} onClick={() => { setConfirmFinish(false); finish.mutate() }}>Завершить</WorkoutCta>
              </div>
            </div>
          : <WorkoutCta className="secondary wide" pending={finish.isPending} pendingLabel="Завершаем…" disabled={rootMutationPending || save.isPending || confirm.isPending} onClick={() => { const incomplete = query.data!.exercises.some((exercise) => !exercise.sets.every((set) => set.confirmedAt)); if (incomplete) setConfirmFinish(true); else finish.mutate() }}>Завершить тренировку</WorkoutCta>}
      </div>
    </>}</AsyncView>
    {canManageLiveStructure && pickerOpen && <ExercisePicker catalog={catalog} clientRecent={clientRecentExercises} onPick={pickLiveExercise} onClose={closePicker} />}
    {confirmDialog}
  </Page>
}

function numberValue(value: FormDataEntryValue | null) { return value ? Number(value) : undefined }

type ExerciseCardTab = 'stats' | 'history' | 'how'

export function ExerciseHistoryPage() {
  const { workoutId = '', exerciseRef = '' } = useParams()
  const { actor } = useAuth()
  const showRpe = useRpeDisplay(actor?.userId)
  const [tab, setTab] = useState<ExerciseCardTab>('stats')
  const current = useQuery({ queryKey: ['workout', workoutId], queryFn: () => workoutsRepository.get(workoutId) })
  useClientRealtime(current.data?.clientId)
  const history = useInfiniteQuery({
    queryKey: ['exercise-history', current.data?.clientId, exerciseRef],
    initialPageParam: null as ExerciseProgressCursor | null,
    queryFn: ({ pageParam }) => workoutsRepository.exerciseProgressPage(current.data!.clientId, exerciseRef, pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(current.data),
  })
  const items = useMemo(() => history.data?.pages.flatMap((page) => page.items) ?? [], [history.data])
  const totalCount = history.data?.pages[0]?.totalCount ?? 0
  // Метаданные упражнения из каталога (картинка/оборудование/мышцы/инструкции).
  const meta = exercisesRepository.system.find((exercise) => exercise.ref === exerciseRef)
  const currentExercise = current.data?.exercises.find((exercise) => exercise.ref === exerciseRef)
  const inputKind = meta?.inputKind ?? currentExercise?.inputKind ?? items[0]?.inputKind ?? 'strength'
  const name = meta?.name ?? currentExercise?.name ?? items[0]?.exerciseName ?? 'Упражнение'
  const chart = useMemo(() => items
    .filter((item) => item.primaryValue !== null)
    .map((item) => ({ date: item.workoutDate, completedAt: item.completedAt, value: item.primaryValue! }))
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt)), [items])
  const unit = chartUnitFor(inputKind)
  const instructions = meta?.instructions ?? []
  return <Page title="Упражнение" back={`/workouts/${workoutId}`}>
    <AsyncView loading={current.isLoading || history.isLoading} error={current.error ?? history.error} onRetry={() => { void current.refetch(); void history.refetch() }}>
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

      {tab === 'stats' && <>
        <ExerciseProgressSummary latest={items[0]} totalCount={totalCount} />
        {chart.length > 1
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
            ? <p className="muted empty-hint">График динамики появится после второго подтверждённого результата.</p>
            : null}
      </>}

      {tab === 'history' && <ExerciseProgressHistory items={items} showRpe={showRpe} />}

      {tab === 'how' && (instructions.length
        ? <ol className="how-steps">{instructions.map((step, index) => <li key={index}>{step}</li>)}</ol>
        : <p className="muted empty-hint">Описание техники пока не добавлено.</p>)}
      {tab !== 'how' && <LoadMoreButton hasMore={history.hasNextPage} loading={history.isFetchingNextPage} onLoadMore={() => void history.fetchNextPage()} />}
    </AsyncView>
  </Page>
}
