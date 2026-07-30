import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { goalsRepository } from '../../data/repositories/goals.repository'
import { currentStage, orderedStages } from '../../shared/goal-rules'
import { exercisesRepository } from '../../data/repositories/exercises.repository'
import { AxisTick, computeYDomain, formatTooltipLabel, formatTooltipValue, renderChartDot } from '../progress/ProgressChart'
import { blockLabel, chartUnitFor, copyWorkout, exerciseChartPoints, exerciseSummary, factLine, groupIntoBlocks, blockRoundsView, currentRoundIndex, muscleGroupLabels, replaceExercise, splitClientWorkouts, tonnageLabel, workoutDurationLabel, workoutTonnage, workoutsRepository } from '../../data/repositories/workouts.repository'
import type { ExerciseSnapshot, LiveSetDraft, Workout, WorkoutDraft, WorkoutExercise, WorkoutSet } from '../../shared/domain'
import { playGong } from '../../shared/gong'
import {
  addDays, dayOfMonth, formatLocalDate, localDate, startOfWeek, todayLocalDate, weekdayShort,
  type LocalDate,
} from '../../shared/local-date'
import { AsyncView, Field, OverflowMenu, Page, StatusBadge, useConfirm } from '../../shared/ui'
import { ExercisePicker, useExerciseCatalog } from '../exercises'
import { VoiceNoteField } from '../voice-input'
import { WorkoutExerciseEditor } from './WorkoutExerciseEditor'
import { createLiveSetCoordinator } from './live-set-coordinator'
import { LoadMoreButton } from './LoadMoreButton'
import { workoutCountLabel } from './workout-count-label'
import { useAuth } from '../../app/auth-context'
import { useClientRealtime } from '../../app/use-client-realtime'

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

  return <Page className="schedule-page" title="Расписание" hideTitle action={
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
  const [pickerOpen, setPickerOpen] = useState(false)
  // Индекс упражнения, которое заменяем через пикер; null — режим добавления.
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  const initial = source.data ? (workoutId ? { ...copyWorkout(source.data), id: source.data.id, version: source.data.version } : copyWorkout(source.data, todayLocalDate())) : undefined
  const exercises = draftExercises ?? initial?.exercises ?? []
  // Клиент, для которого выбираем этап (реактивно — при смене в селекте).
  const defaultClientId = clientMode ? (mine.data?.id ?? '') : (initial?.clientId ?? params.get('client') ?? '')
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const clientId = selectedClientId || defaultClientId
  const goal = useQuery({ queryKey: ['client-goal', clientId], queryFn: () => goalsRepository.get(clientId), enabled: Boolean(clientId) })
  const stages = goal.data ? orderedStages(goal.data) : []
  // Этап по умолчанию: сохранённый у тренировки, иначе текущий по дате.
  const defaultStageId = source.data?.stageId ?? (goal.data ? currentStage(goal.data, todayLocalDate())?.id ?? '' : '')
  const mutation = useMutation({ mutationFn: (draft: WorkoutDraft) => workoutsRepository.save(draft), onSuccess: async (id) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workout', id] }),
      queryClient.invalidateQueries({ queryKey: ['workouts'] }),
    ])
    navigate(`/workouts/${id}`)
  } })

  function pickExercise(selected: ExerciseSnapshot) {
    if (replaceIndex !== null) setDraftExercises(replaceExercise(exercises, replaceIndex, selected))
    else setDraftExercises([...exercises, { ...selected, position: exercises.length, blockId: crypto.randomUUID(), blockType: 'single', blockRounds: 1, sets: [{ position: 0 }] }])
    closePicker()
  }
  function closePicker() { setPickerOpen(false); setReplaceIndex(null) }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    const submitClientId = String(form.get('clientId')); const date = localDate(String(form.get('date')))
    const stageId = String(form.get('stageId') || '') || null
    mutation.mutate({ id: workoutId, clientId: submitClientId, workoutDate: date, startTime: String(form.get('startTime') || '') || undefined,
      notes: String(form.get('notes') || '') || undefined, stageId, exercises, version: source.data?.version })
  }
  const availableClients = clientMode ? (mine.data ? [mine.data] : []) : clients.data
  const editingDenied = Boolean(clientMode && workoutId && source.data && source.data.createdBy !== actor?.userId)
  const loading = source.isLoading || clients.isLoading || mine.isLoading
  const error = source.error ?? clients.error ?? mine.error
  return <Page title={workoutId ? 'Редактировать тренировку' : params.has('copy') ? 'Копия тренировки' : 'Новая тренировка'} back={-1}>
    <AsyncView loading={loading} error={error}>{editingDenied ? <div className="state"><h2>Редактирование недоступно</h2><p>Назначенную тренером тренировку может менять только тренер.</p></div> : clientMode && !mine.data ? <div className="state"><h2>Карточка ещё не подключена</h2><p>Создать тренировку можно после подключения клиентской карточки.</p></div> : <form className="stack" onSubmit={(event) => void submit(event)}>
      {clientMode
        ? <><input type="hidden" name="clientId" value={mine.data?.id ?? ''} /><Field label="Клиент"><input value={mine.data?.fullName ?? ''} disabled /></Field></>
        : <Field label="Клиент"><select name="clientId" defaultValue={initial?.clientId ?? params.get('client') ?? ''} onChange={(event) => setSelectedClientId(event.target.value)} required><option value="">Выберите</option>{availableClients?.map((client) => <option key={client.id} value={client.id}>{client.fullName}</option>)}</select></Field>}
      <div className="split"><Field label="Дата"><input name="date" type="date" defaultValue={initial?.workoutDate ?? params.get('date') ?? todayLocalDate()} required /></Field><Field label="Время"><input name="startTime" type="time" defaultValue={initial?.startTime ?? ''} /></Field></div>
      {stages.length > 0 && <Field label="Этап цели">
        {/* key — чтобы defaultValue пересчитался при смене клиента/загрузке цели */}
        <select name="stageId" key={`${clientId}-${defaultStageId}`} defaultValue={defaultStageId}>
          <option value="">Без этапа</option>
          {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.title}</option>)}
        </select>
      </Field>}
      <VoiceNoteField name="notes" source="workout_form" defaultValue={initial?.notes ?? ''} />
      <WorkoutExerciseEditor exercises={exercises} onChange={setDraftExercises} onOpenPicker={() => { setReplaceIndex(null); setPickerOpen(true) }} onReplaceExercise={(index) => { setReplaceIndex(index); setPickerOpen(true) }} showTrainerComments={!clientMode} />
      {mutation.error && <p className="error">{mutation.error.message}</p>}
      <div className="actions"><button type="button" className="secondary" onClick={() => navigate(-1)}>Отмена</button><button disabled={mutation.isPending}>Сохранить</button></div>
    </form>}</AsyncView>
    {pickerOpen && <ExercisePicker catalog={catalog} onPick={pickExercise} onClose={closePicker} />}
  </Page>
}

export function WorkoutDetailPage() {
  const { workoutId = '' } = useParams(); const navigate = useNavigate(); const queryClient = useQueryClient()
  const { actor } = useAuth()
  const [confirm, confirmDialog] = useConfirm()
  const query = useQuery({ queryKey: ['workout', workoutId], queryFn: () => workoutsRepository.get(workoutId) })
  useClientRealtime(query.data?.clientId)
  // Этап тренировки: get() отдаёт stageId, название берём из цели клиента.
  const goal = useQuery({ queryKey: ['client-goal', query.data?.clientId], queryFn: () => goalsRepository.get(query.data!.clientId), enabled: Boolean(query.data?.stageId && query.data?.clientId) })
  const stageTitle = query.data?.stageId ? goal.data?.stages.find((stage) => stage.id === query.data!.stageId)?.title ?? null : null
  const start = useMutation({ mutationFn: () => workoutsRepository.start(query.data!), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['workout', workoutId] }); navigate(`/workouts/${workoutId}/live`) } })
  const remove = useMutation({ mutationFn: () => workoutsRepository.remove(query.data!), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['workouts'] }); navigate(actor?.role === 'client' ? '/me/workouts' : '/schedule') } })
  const workout = query.data
  const done = workout?.status === 'done'
  const duration = workout ? workoutDurationLabel(workout.startedAt, workout.completedAt) : null
  const groups = workout ? muscleGroupLabels(workout) : []
  const tonnage = workout ? workoutTonnage(workout) : 0
  // «Назад» ведёт в расписание (все запланированные), а не -1 по истории
  // браузера: -1 создавал петлю тренировка ↔ история упражнения после захода
  // в аналитику.
  const clientMode = actor?.role === 'client'
  const clientOwned = clientMode && workout?.createdBy === actor.userId
  const backTo = clientMode ? '/me/workouts' : '/schedule'
  return <Page title="Тренировка" back={backTo}>
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>{workout && <>
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
      <div className="cards">{groupIntoBlocks(workout.exercises).map((block) => {
        const articles = block.exercises.map((exercise) => <article className="exercise" key={exercise.id}>
          <Link className="exercise-name-link" to={`/workouts/${workout.id}/history/${encodeURIComponent(exercise.ref)}`}><strong>{exercise.name}</strong> <span className="exercise-name-hint">↗ история</span></Link>
          {exercise.sets.map((set) => <p key={set.id}>{done ? <FactVsPlan set={set} /> : formatSet(set)}</p>)}
          {exercise.trainerComment && <p className="exercise-comment-note">💬 {exercise.trainerComment}</p>}
        </article>)
        if (block.blockType === 'single' || block.exercises.length === 1) return articles
        return <div className="exercise-block view" key={block.blockId}><span className="block-badge">{blockLabel(block.blockType, block.blockPreset)} · {block.blockRounds} кр.</span>{articles}</div>
      })}</div>
      {workout.notes && <p>{workout.notes}</p>}
      {(!clientMode || clientOwned) && <><div className="actions">
        {workout.status === 'planned' && <Link className="button secondary" to={`/workouts/${workoutId}/edit`}>Изменить</Link>}
        <Link className="button secondary" to={`/workouts/new?copy=${workoutId}`}>Копировать</Link>
      </div>
      <button className="danger secondary wide" disabled={remove.isPending} onClick={async () => { if (await confirm({ message: 'Удалить тренировку?', confirmLabel: 'Удалить', danger: true })) remove.mutate() }}>Удалить тренировку</button></>}
      {clientMode && !clientOwned && <div className="actions"><Link className="button secondary" to={`/workouts/new?copy=${workoutId}`}>Создать свою копию</Link></div>}
      {remove.error && <p className="error">{remove.error.message}</p>}
      {confirmDialog}
    </>}</AsyncView>
  </Page>
}

function formatSet(set: WorkoutSet) { const plan = [set.weightKg && `${set.weightKg} кг`, set.reps && `${set.reps} повт.`, set.distanceKm && `${set.distanceKm} км`, set.durationMin && `${set.durationMin} мин`].filter(Boolean).join(' × '); return plan || 'Подход без плана' }

// Результат подхода в завершённой тренировке: подтверждённый — только факт;
// неподтверждённый — план с пометкой «не выполнено» (план за факт не выдаём).
function FactVsPlan({ set }: { set: WorkoutSet }) {
  const fact = factLine(set)
  if (fact) return <>{fact}</>
  return <>{formatSet(set)}<span className="plan-note"> · не выполнено</span></>
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
    if (set.durationMin !== undefined) parts.push(`${set.durationMin} мин`)
    if (set.reps !== undefined) parts.push(`${set.reps} повт.`)
  } else {
    if (set.durationMin !== undefined) parts.push(`${set.durationMin} мин`)
    if (set.distanceKm !== undefined) parts.push(`${set.distanceKm} км`)
  }
  return parts.length ? parts.join(' × ') : null
}

// Отклонение факта от плана — показываем ТОЛЬКО при разнице (по ключевой метрике:
// вес для силовых, иначе время). Знак и величина, тёплым (warning) цветом.
function deviationNote(inputKind: ExerciseSnapshot['inputKind'], set: WorkoutSet): string | null {
  if (!set.confirmedAt) return null
  const pick = inputKind === 'strength'
    ? { fact: set.fact.weightKg, plan: set.weightKg, unit: 'кг' }
    : { fact: set.fact.durationMin, plan: set.durationMin, unit: 'мин' }
  if (pick.fact === undefined || pick.plan === undefined) return null
  const diff = Math.round((pick.fact - pick.plan) * 10) / 10
  if (diff === 0) return null
  return `${diff > 0 ? '+' : ''}${diff} ${pick.unit} к плану`
}

// Поле факта с крупными кнопками −/+ (быстрое изменение между подходами одной
// рукой). Внутри — тот же <input> (aria-label/name/placeholder/defaultValue
// сохранены, e2e и автосейв по blur работают как раньше). Кнопки не забирают
// фокус (preventDefault на pointerdown) и меняют value через нативное событие
// input, чтобы неконтролируемое поле и последующее сохранение увидели новое
// значение. В locked-режиме кнопки скрыты (поле disabled).
function LiveStepperInput({ name, label, shortLabel, placeholder, defaultValue, step, disabled, inputKey }: {
  name: string; label: string; shortLabel: string; placeholder: string; defaultValue: number | undefined
  step: number; disabled: boolean; inputKey: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  function nudge(delta: number) {
    const el = ref.current
    if (!el) return
    const current = el.value === '' ? 0 : Number(el.value)
    const next = Math.max(0, Math.round((current + delta) / step) * step)
    // toFixed убирает флоат-шум (0.1+0.2); затем в число обратно строкой.
    setNativeInputValue(el, String(Number(next.toFixed(3))))
  }
  if (disabled) return <input ref={ref} key={inputKey} aria-label={label} name={name} type="number" min="0" step={step} disabled defaultValue={defaultValue} placeholder={placeholder} />
  // Метки кнопок НЕ содержат точную подпись поля («Фактический вес»), иначе
  // getByLabel в e2e/тестах ловил бы и кнопку, и инпут (substring-match).
  return <div className="stepper">
    <button type="button" className="stepper-btn" aria-label={`Убавить ${shortLabel}`} onPointerDown={(e) => e.preventDefault()} onClick={() => nudge(-step)}>−</button>
    <input ref={ref} key={inputKey} aria-label={label} name={name} type="number" min="0" step={step} defaultValue={defaultValue} placeholder={placeholder} />
    <button type="button" className="stepper-btn" aria-label={`Добавить ${shortLabel}`} onPointerDown={(e) => e.preventDefault()} onClick={() => nudge(step)}>＋</button>
  </div>
}

// Проставляет значение неконтролируемому input (defaultValue) и шлёт событие
// input, чтобы автосейв по blur/подтверждение прочитали новое значение из
// FormData. Поля неконтролируемые, поэтому обычного el.value достаточно.
function setNativeInputValue(el: HTMLInputElement, value: string) {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

// Перенос плана в факт: заполняет поля формы плановыми значениями подхода по типу
// упражнения через нативное событие input (неконтролируемые поля + автосейв).
function fillFactFromPlan(form: HTMLFormElement | null, inputKind: ExerciseSnapshot['inputKind'], set: WorkoutSet) {
  if (!form) return
  const put = (name: string, plan: number | undefined) => {
    if (plan === undefined) return
    const el = form.elements.namedItem(name)
    if (el instanceof HTMLInputElement) setNativeInputValue(el, String(plan))
  }
  if (inputKind === 'strength') { put('weightKg', set.weightKg); put('reps', set.reps) }
  else if (inputKind === 'reps') { put('durationMin', set.durationMin); put('reps', set.reps) }
  else { put('durationMin', set.durationMin); put('distanceKm', set.distanceKm) }
}

function LiveSetFields({ inputKind, set, editing = false }: { inputKind: ExerciseSnapshot['inputKind']; set: WorkoutSet; editing?: boolean }) {
  // После подтверждения показываем зафиксированный результат (факт, иначе план)
  // как обычное яркое значение в заблокированном поле, а не тусклый placeholder.
  // Правка по карандашику временно разблокирует поля (editing).
  const locked = Boolean(set.confirmedAt) && !editing
  const rowClass = locked ? 'set-row locked' : 'set-row'
  // Ключ ремоунтит поля при смене режима (подтверждён / правка / ввод), чтобы
  // неконтролируемый defaultValue пересчитался и показал нужное значение.
  // В key добавлена version: после правки подтверждённого подхода факт меняется
  // и версия бампится — иначе стабильный key оставил бы старое значение в поле.
  const mode = locked ? 'locked' : editing ? 'editing' : 'edit'
  const k = `${mode}-${set.version}`
  // Для подтверждённого подхода (в т.ч. при правке) показываем факт, иначе план.
  const confirmed = Boolean(set.confirmedAt)
  const value = (fact: number | undefined, plan: number | undefined) => (confirmed ? (fact ?? plan) : fact)
  if (inputKind === 'strength') return <div className={rowClass}>
    <LiveStepperInput name="weightKg" label="Фактический вес" shortLabel="вес" placeholder={set.weightKg === undefined ? 'кг' : `${set.weightKg} кг`} defaultValue={value(set.fact.weightKg, set.weightKg)} step={2.5} disabled={locked} inputKey={`w-${k}`} />
    <LiveStepperInput name="reps" label="Фактические повторы" shortLabel="повторы" placeholder={set.reps === undefined ? 'повт.' : `${set.reps} повт.`} defaultValue={value(set.fact.reps, set.reps)} step={1} disabled={locked} inputKey={`r-${k}`} />
  </div>
  if (inputKind === 'reps') return <div className={rowClass}>
    <LiveStepperInput name="durationMin" label="Фактическое время" shortLabel="время" placeholder={set.durationMin === undefined ? 'мин' : `${set.durationMin} мин`} defaultValue={value(set.fact.durationMin, set.durationMin)} step={0.5} disabled={locked} inputKey={`d-${k}`} />
    <LiveStepperInput name="reps" label="Фактические повторы" shortLabel="повторы" placeholder={set.reps === undefined ? 'повт.' : `${set.reps} повт.`} defaultValue={value(set.fact.reps, set.reps)} step={1} disabled={locked} inputKey={`r-${k}`} />
  </div>
  return <div className={rowClass}>
    <LiveStepperInput name="durationMin" label="Фактическое время" shortLabel="время" placeholder={set.durationMin === undefined ? 'мин' : `${set.durationMin} мин`} defaultValue={value(set.fact.durationMin, set.durationMin)} step={0.5} disabled={locked} inputKey={`d-${k}`} />
    <LiveStepperInput name="distanceKm" label="Фактическая дистанция" shortLabel="дистанция" placeholder={set.distanceKm === undefined ? 'км' : `${set.distanceKm} км`} defaultValue={value(set.fact.distanceKm, set.distanceKm)} step={0.1} disabled={locked} inputKey={`dist-${k}`} />
  </div>
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

function WorkoutTimer({ startedAt, variant = 'chip' }: { startedAt: string | null; variant?: 'chip' | 'big' }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const className = variant === 'big' ? 'live-timer-big' : 'live-timer'
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
  useClientRealtime(query.data?.clientId)
  const catalog = useExerciseCatalog()
  const [liveSets] = useState(() => createLiveSetCoordinator(
    (id, draft, version) => workoutsRepository.saveLiveSet(id, draft, version),
    (id, version) => workoutsRepository.confirmLiveSet(id, version),
  ))
  const skipBlurForSet = useRef<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  // Упражнение, которое заменяем через пикер; null — режим добавления.
  const [replaceExerciseId, setReplaceExerciseId] = useState<string | null>(null)
  // Подтверждённые подходы, временно разблокированные для правки (по карандашику).
  const [editingSets, setEditingSets] = useState<Set<string>>(() => new Set())
  // Завершённые упражнения по умолчанию свёрнуты; id здесь — принудительно раскрытые
  // тренером (тап по свёрнутой карточке), чтобы поправить факт.
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(() => new Set())
  // Inline-подтверждение частичного завершения. window.confirm в нативной обёртке
  // (Capacitor/WKWebView) не показывается и блокировал выход из тренировки —
  // используем встроенный диалог в панели вместо нативного confirm.
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [restRemaining, setRestRemaining] = useState<number | null>(null)
  const restEndsAt = useRef<number | null>(null)
  // При правке ПОДТВЕРЖДЁННОГО подхода (карандаш → «Сохранить») значение пишется
  // в БД, но без refetch локальный set остаётся старым и поле возвращает прежнее
  // число. Освежаем только для подтверждённых (в обычном вводе по blur refetch не
  // нужен и мешал бы: ремоунт полей по key сбросил бы текущий ввод).
  const save = useMutation({ mutationFn: ({ set, draft }: { set: WorkoutSet; draft: LiveSetDraft }) => liveSets.save(set, draft), onSuccess: async (_v, { set }) => { if (set.confirmedAt) await query.refetch() } })
  const confirm = useMutation({
    mutationFn: ({ set, draft }: { set: WorkoutSet; draft: LiveSetDraft }) => liveSets.confirm(set, draft),
    onSuccess: (_data, { set }) => {
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
          : !multi ? exercise.restBetweenSetsSec
          : lastExerciseOfRound ? block!.restBetweenRoundsSec
          : block?.restBetweenExercisesSec ?? 0
        startRestUntil(restDeadline(sec), sec)
      }
      void query.refetch()
    },
  })
  // Запускает отдых до абсолютного момента endsAt (мс). null — отдыха нет
  // (напр. между упражнениями суперсета, seconds=0): таймер не показываем.
  function startRestUntil(endsAt: number | null, seconds: number) {
    restEndsAt.current = endsAt
    setRestRemaining(endsAt === null ? null : seconds)
  }
  // Отдых на seconds секунд от текущего момента (вызывается из обработчика).
  function restDeadline(seconds: number): number | null {
    return seconds > 0 ? Date.now() + seconds * 1000 : null
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
    // Один тик отсчёта. iOS Safari замораживает setInterval при блокировке
    // экрана/фоне — на возврате пересчитываем от абсолютного дедлайна, иначе
    // таймер «пропадает» (застыл и тут же гонг), а не тикает как надо.
    const tick = () => {
      if (restEndsAt.current === null) return
      const left = Math.ceil((restEndsAt.current - Date.now()) / 1000)
      if (left <= 0) {
        restEndsAt.current = null
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
    return <textarea className="exercise-comment" aria-label={`Комментарий: ${exercise.name}`} placeholder="Комментарий к упражнению…" rows={1} defaultValue={exercise.trainerComment ?? ''} disabled={commentLive.isPending}
      onBlur={(event) => { const next = event.target.value.trim(); if (next !== (exercise.trainerComment ?? '')) commentLive.mutate({ exerciseId: exercise.id, comment: next }) }} />
  }
  // Меню упражнения в live (⋯): «Заменить» доступно, пока нет подтверждённых
  // подходов (начатое заменять нельзя — факт относился к старому упражнению).
  // В меню, чтобы редкое действие не конкурировало с подтверждением подхода.
  function exerciseMenu(exercise: WorkoutExercise) {
    if (clientMode) return null
    if (exercise.sets.some((set) => set.confirmedAt)) return null
    return <OverflowMenu items={[
      { label: 'Заменить', disabled: replaceLive.isPending, onClick: () => { setReplaceExerciseId(exercise.id); setPickerOpen(true) } },
    ]} />
  }
  // Стрелки ↑/↓ для перестановки блока в live (задизейблены на границах).
  function liveReorder(blockId: string, isFirst: boolean, isLast: boolean) {
    if (clientMode) return null
    return <span className="block-reorder">
      <button type="button" className="reorder-btn" aria-label="Вверх" disabled={isFirst || reorderBlock.isPending} onClick={() => reorderBlock.mutate({ blockId, direction: -1 })}>↑</button>
      <button type="button" className="reorder-btn" aria-label="Вниз" disabled={isLast || reorderBlock.isPending} onClick={() => reorderBlock.mutate({ blockId, direction: 1 })}>↓</button>
    </span>
  }
  // Форма одного подхода в live: подтверждение / правка / удаление / автосейв по blur.
  // canRemove — у упражнения больше одного подхода (последний убрать нельзя).
  function renderLiveSet(exercise: WorkoutExercise, set: WorkoutSet, label?: string, current = false, canRemove = false) {
    const isEditing = editingSets.has(set.id)
    // «Закрыто» (подтверждён) — зелёный; «в работе» (текущий) — серый.
    const stateClass = set.confirmedAt && !isEditing ? 'confirmed' : current && !isEditing ? 'current' : ''
    // Действия в шапке подхода: карандаш (правка подтверждённого) + крестик (удалить).
    const headActions = <span className="set-head-actions">
      {set.confirmedAt && !isEditing && <button type="button" className="link set-edit" aria-label="Редактировать подход" onClick={() => setEditingSets((prev) => new Set(prev).add(set.id))}>✎</button>}
      {!clientMode && canRemove && !isEditing && <button type="button" className="link set-remove" aria-label="Удалить подход" disabled={removeSet.isPending} onClick={async () => { if (await askConfirm({ message: 'Удалить этот подход?', confirmLabel: 'Удалить', danger: true })) removeSet.mutate(set.id) }}>✕</button>}
    </span>
    return <form className={`exercise ${stateClass}`} key={set.id} onBlur={(event) => {
      if (skipBlurForSet.current === set.id) { skipBlurForSet.current = null; return }
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
      save.mutate({ set, draft: draftFrom(event.currentTarget) })
    }}>
      <div className="set-head"><span className="muted">{label}{planLine(exercise.inputKind, set) ? <span className="set-plan"> · план {planLine(exercise.inputKind, set)}</span> : null}</span>{headActions}</div>
      <LiveSetFields inputKind={exercise.inputKind} set={set} editing={isEditing} />
      {/* «= план»: перенести плановые значения в поля факта одним тапом (когда
          подход ещё не подтверждён и план задан). Не забирает фокус. */}
      {!set.confirmedAt && planLine(exercise.inputKind, set) && <button type="button" className="link set-fill-plan"
        onPointerDown={(e) => e.preventDefault()}
        onClick={(event) => fillFactFromPlan(event.currentTarget.form, exercise.inputKind, set)}>= план</button>}
      {deviationNote(exercise.inputKind, set) && <p className="set-deviation">{deviationNote(exercise.inputKind, set)}</p>}
      {set.confirmedAt && isEditing
        ? <button type="button" className="secondary" disabled={save.isPending}
            onPointerDown={() => { skipBlurForSet.current = set.id }}
            onClick={(event) => { const form = event.currentTarget.form; if (form) save.mutate({ set, draft: draftFrom(form) }); setEditingSets((prev) => { const next = new Set(prev); next.delete(set.id); return next }); skipBlurForSet.current = null }}>Сохранить</button>
        : <button type="button" className={set.confirmedAt ? 'secondary live-confirm' : 'live-confirm'} disabled={Boolean(set.confirmedAt) || confirm.isPending}
            onPointerDown={() => { skipBlurForSet.current = set.id }}
            onClick={(event) => { const form = event.currentTarget.form; if (form) confirm.mutate({ set, draft: draftFrom(form) }); skipBlurForSet.current = null }}>{set.confirmedAt ? 'Подтверждено' : 'Готово, отдых'}</button>}
    </form>
  }
  // «Назад» ведёт в карточку тренировки: таб-бар в live скрыт, поэтому нужен
  // явный выход наружу без завершения тренировки (тренер может вернуться позже).
  return <Page title="Live-тренировка" back={`/workouts/${workoutId}`}>
    <AsyncView loading={query.isLoading} error={query.error}>{query.data && <>
      <p>{query.data.clientName}</p>
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
          <WorkoutTimer startedAt={query.data.startedAt ?? null} variant="big" />
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
      {(() => { const liveBlocks = groupIntoBlocks(query.data.exercises);
        // Индекс первого блока с незавершёнными подходами = «текущий» блок.
        // До него — завершённые, после — предстоящие. Даёт статус за секунду.
        const currentBlockIndex = liveBlocks.findIndex((b) => b.exercises.some((ex) => ex.sets.some((s) => !s.confirmedAt)))
        return liveBlocks.map((block, blockIndex) => {
        // ↑/↓ показываем только когда блоков больше одного; двигать можно любые
        // блоки (в т.ч. с завершёнными подходами), кроме упора в границу.
        const reorder = liveBlocks.length > 1 ? liveReorder(block.blockId, blockIndex === 0, blockIndex === liveBlocks.length - 1) : null
        const blockStatus = currentBlockIndex === -1 ? 'done' : blockIndex < currentBlockIndex ? 'done' : blockIndex === currentBlockIndex ? 'current' : 'upcoming'
        // Одиночное упражнение (или блок из одного) — как раньше, по подходам.
        // Текущий подход (первый неподтверждённый) подсвечивается серым.
        if (block.blockType === 'single' || block.exercises.length === 1) {
          return block.exercises.map((exercise) => {
            const currentSetIndex = exercise.sets.findIndex((set) => !set.confirmedAt)
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
              <div className="live-exercise-head"><h2>{exercise.name}</h2><span className="exercise-head-actions"><StatusBadge status={blockStatus} />{exerciseMenu(exercise)}{reorder}</span></div>
              {exercise.sets.map((set, index) => renderLiveSet(exercise, set, `Подход ${index + 1}`, index === currentSetIndex, exercise.sets.length > 1))}
              {!clientMode && <button type="button" className="secondary" disabled={appendSet.isPending} onClick={() => appendSet.mutate(exercise.id)}>＋ Подход</button>}
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
    {!clientMode && pickerOpen && <ExercisePicker catalog={catalog} onPick={pickLiveExercise} onClose={closePicker} />}
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

      <div className="tabs" role="tablist">
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
