import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { goalsRepository } from '../../data/repositories/goals.repository'
import { workoutsRepository, type PreviousExerciseResult } from '../../data/repositories/workouts.repository'
import type { ExerciseSnapshot, Workout, WorkoutDraft, WorkoutSetDraft } from '../../shared/domain'
import { localDate, todayLocalDate } from '../../shared/local-date'
import { isValidRpe } from '../../shared/rpe'
import { trackGoal } from '../../shared/yandex-metrika'
import { Page } from '../../shared/ui'
import { ExercisePicker, recentExercisesForClient, useExerciseCatalog } from '../exercises'
import { ClientPicker, type ClientPickerSelection } from '../clients'
import { useAuth } from '../../app/auth-context'
import { useRpeDisplay } from '../../app/rpe-display'
import type { ParsedWorkoutExercise } from './quick-workout-entry'
import { parseWorkoutWithLlm } from './llm-workout-parser'
import type { WorkoutParseResponse } from '../../data/repositories/exercises.repository'
import { readTodayDraft, removeTodayDraft, todayDraftKey, writeTodayDraft } from './today-draft'
import { workoutDateForRecordMode, type WorkoutRecordMode } from './workout-entry-rules'
import { VoiceInputButton, type VoiceInputPhase } from '../voice-input'
import { AssistantIcon } from '../../shared/icons'
import { workoutParseErrorKind } from './WorkoutParseErrorNotice'
import { WearableHealthCard } from '../wearables'
import { isWearablesPilotEnabled } from '../../app/feature-flags'
import { currentStage } from '../../shared/goal-rules'
import { ChatThread } from './ChatThread'
import { TipCarousel } from './TipCarousel'
import { ChatComposerBar } from './ChatComposerBar'
import type { ChatMessage } from './chat-types'

type Screen = 'compose' | 'review' | 'save'
type RecordMode = WorkoutRecordMode
type UnmatchedView = { line: string; reason: 'not-found' | 'ambiguous'; candidates: ExerciseSnapshot[] }

interface TodayPageProps {
  clientMode?: boolean
}

function parsedLlmItems(response: WorkoutParseResponse, catalog: readonly ExerciseSnapshot[]): ParsedWorkoutExercise[] {
  const byRef = new Map(catalog.map((exercise) => [exercise.ref, exercise]))
  return response.items.flatMap((item) => {
    const exercise = byRef.get(item.exerciseRef)
    if (!exercise) return []
    const sets = item.sets.length ? item.sets.map((set, position) => ({
      position,
      weightKg: set.weightKg,
      reps: set.reps,
      ...(typeof set.durationMin === 'number' && set.durationMin > 0 ? { durationSec: Math.round(set.durationMin * 60) } : {}),
      ...(typeof set.distanceKm === 'number' && set.distanceKm > 0 ? { distanceKm: set.distanceKm } : {}),
    })) : [{ position: 0 }]
    return [{ id: crypto.randomUUID(), line: item.sourceText, exercise, sets, hasValues: sets.some((set) => Object.keys(set).some((key) => key !== 'position' && set[key as keyof typeof set] !== undefined)) }]
  })
}

function draftExercise(item: ParsedWorkoutExercise, position: number): WorkoutDraft['exercises'][number] {
  return {
    ...item.exercise,
    position,
    blockId: crypto.randomUUID(),
    blockType: 'single',
    blockRounds: 1,
    // Черновик мог быть создан до появления строгого ограничения RPE в БД.
    // Не даём старому значению сорвать сохранение всей тренировки.
    sets: (item.sets.length ? item.sets : [{ position: 0 }]).map((set) => ({
      ...set,
      ...(isValidRpe(set.rpe) ? {} : { rpe: undefined }),
    })),
  }
}

export function TodayPage({ clientMode = false }: TodayPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { actor } = useAuth()
  const mine = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine(), enabled: clientMode })
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false), enabled: !clientMode })
  const today = todayLocalDate()
  const todayWorkouts = useQuery({ queryKey: ['today-workouts', today, mine.data?.id], queryFn: () => workoutsRepository.list(today, today, clientMode ? mine.data!.id : undefined), enabled: !clientMode || Boolean(mine.data) })
  const workouts = useQuery({ queryKey: ['workouts', mine.data?.id], queryFn: () => workoutsRepository.list(undefined, undefined, clientMode ? mine.data!.id : undefined), enabled: !clientMode || Boolean(mine.data) })
  const goal = useQuery({ queryKey: ['client-goal', mine.data?.id], queryFn: () => goalsRepository.get(mine.data!.id), enabled: clientMode && Boolean(mine.data) })
  const catalog = useExerciseCatalog()
  const [text, setText] = useState('')
  const [choices, setChoices] = useState<Record<string, ExerciseSnapshot>>({})
  const [items, setItems] = useState<ParsedWorkoutExercise[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const showRpeByDefault = useRpeDisplay(actor?.userId)
  const [rpeOverrides, setRpeOverrides] = useState<Map<number, boolean>>(() => new Map())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  const [clientId, setClientId] = useState('')
  const clientWorkouts = useQuery({ queryKey: ['client-exercises-frequency', clientId], queryFn: () => workoutsRepository.list(undefined, undefined, clientId), enabled: Boolean(clientId) })
  const [recordMode, setRecordMode] = useState<RecordMode>('planned')
  const [workoutDate, setWorkoutDate] = useState(today)
  const [startTime, setStartTime] = useState('')
  const [prefillError, setPrefillError] = useState<string | null>(null)
  const [manualRefs, setManualRefs] = useState<string[]>([])
  const [removedRefs, setRemovedRefs] = useState<string[]>([])
  const [removedItem, setRemovedItem] = useState<{ item: ParsedWorkoutExercise; index: number } | null>(null)
  const [draftReady, setDraftReady] = useState(false)
  const [restoredDraftScreen, setRestoredDraftScreen] = useState<Screen | null>(null)
  const [textComposerOpen, setTextComposerOpen] = useState(false)
  const [voicePhase, setVoicePhase] = useState<VoiceInputPhase>('idle')
  const inputStarted = useRef(false)
  const openedTracked = useRef(false)
  const draftKey = todayDraftKey(actor!.userId)
  const todayPath = clientMode ? '/me' : '/today'
  const view = new URLSearchParams(location.search).get('view')
  const screen: Screen = view === 'review' || view === 'save' ? view : 'compose'

  function isRpeVisible(exerciseIndex: number) {
    return rpeOverrides.get(exerciseIndex) ?? showRpeByDefault
  }

  function toggleRpe(exerciseIndex: number) {
    setRpeOverrides((current) => new Map(current).set(exerciseIndex, !isRpeVisible(exerciseIndex)))
  }

  // Каждый шаг — отдельный маршрут. Так кнопка назад и системный жест iOS
  // последовательно возвращают к предыдущему шагу, а не к случайному табу.
  function setScreen(next: Screen) {
    if (next === screen) return
    if (next === 'compose') {
      setRestoredDraftScreen(null)
      setTextComposerOpen(true)
    }
    const previousScreen = (location.state as { fromTodayScreen?: Screen } | null)?.fromTodayScreen
    if ((next === 'compose' && screen === 'review' && previousScreen === 'compose') || (next === 'review' && screen === 'save' && previousScreen === 'review')) {
      navigate(-1)
      return
    }
    navigate(next === 'compose' ? todayPath : `${todayPath}?view=${next}`, { replace: next === 'compose', state: { fromTodayScreen: screen } })
  }

  // Экран «Проверьте тренировку» ушёл из основного потока — карточки теперь
  // живут прямо в чат-ленте. Роут остаётся валидным ради старых черновиков/
  // ссылок, но сразу возвращает на compose.
  useEffect(() => {
    if (screen === 'review') setScreen('compose')
  }, [screen])

  useEffect(() => {
    const draft = readTodayDraft(draftKey)
    if (draft) {
      setRestoredDraftScreen(screen === 'compose' ? draft.screen : null)
      setText(draft.text)
      setChoices(draft.choices)
      setItems(draft.items)
      setMessages(draft.messages ?? [])
      setClientId(draft.clientId)
      setRecordMode(draft.recordMode ?? 'planned')
      setWorkoutDate(workoutDateForRecordMode(draft.recordMode ?? 'planned', draft.workoutDate ? localDate(draft.workoutDate) : today, today))
      setStartTime(draft.startTime ?? '')
      setManualRefs(draft.manualRefs ?? [])
      setRemovedRefs(draft.removedRefs ?? [])
    }
    setDraftReady(true)
  }, [draftKey, today])

  useEffect(() => {
    if (clientMode && mine.data?.id) setClientId(mine.data.id)
  }, [clientMode, mine.data?.id])

  useEffect(() => {
    if (!draftReady) return
    if (!text.trim() && !items.length && !messages.length) {
      removeTodayDraft(draftKey)
      return
    }
    writeTodayDraft(draftKey, { screen, text, choices, items, messages, clientId, manualRefs, removedRefs, recordMode, workoutDate, startTime })
  }, [choices, clientId, draftKey, draftReady, items, messages, manualRefs, recordMode, removedRefs, screen, startTime, text, workoutDate])

  const clientRecentExercises = useMemo(() => recentExercisesForClient(catalog.exercises, clientWorkouts.data ?? []), [catalog.exercises, clientWorkouts.data])

  useEffect(() => {
    if (!openedTracked.current) {
      openedTracked.current = true
      trackGoal('today_opened')
    }
  }, [])

  useEffect(() => {
    if (text.trim() && !inputStarted.current) {
      inputStarted.current = true
      trackGoal('today_input_started')
      trackGoal('workout_input_started')
    }
  }, [text])

  const save = useMutation({
    mutationFn: async (mode: RecordMode) => {
      const draft = { clientId, workoutDate, startTime: mode === 'planned' ? startTime || undefined : undefined, exercises: items.map(draftExercise) }
      return mode === 'planned' ? workoutsRepository.save(draft) : workoutsRepository.saveCompleted(draft)
    },
    onMutate: (mode) => trackGoal(mode === 'planned' ? 'today_plan_save_started' : 'today_workout_save_started'),
    onSuccess: async (id, mode) => {
      trackGoal(mode === 'planned' ? 'today_plan_saved' : 'today_workout_saved')
      trackGoal('today_review_confirmed')
      setDraftReady(false)
      removeTodayDraft(draftKey)
      await queryClient.invalidateQueries({ queryKey: ['workouts'] })
      await queryClient.invalidateQueries({ queryKey: ['today-workouts'] })
      if (!clientMode) await queryClient.invalidateQueries({ queryKey: ['clients'] })
      navigate(`/workouts/${id}`, { state: { returnTo: clientMode ? '/me' : '/today' } })
    }, onError: () => trackGoal('today_workout_save_error'),
  })
  async function createQuickClient(fullName: string): Promise<ClientPickerSelection> {
    const id = await clientsRepository.createQuick(fullName)
    trackGoal('today_quick_client_created')
    await queryClient.invalidateQueries({ queryKey: ['clients'] })
    return { id, fullName }
  }

  // Единая точка входа для отправленного/продиктованного/переотправленного
  // (после правки) сообщения. Сам вызов LLM-разбора не меняется — меняется
  // только то, как результат раскладывается по ленте чата.
  async function submitText(rawText: string, replaceMessageId?: string) {
    const value = rawText.trim()
    if (!value) return
    trackGoal('workout_parse_submitted')
    const messageId = replaceMessageId ?? crypto.randomUUID()
    const thinkingId = crypto.randomUUID()
    setMessages((current) => [...current.filter((message) => message.id !== messageId), { id: messageId, kind: 'user', text: value, itemIds: [] }, { id: thinkingId, kind: 'thinking' }])
    setSending(true)
    try {
      const llm = await parseWorkoutWithLlm(value, catalog.exercises)
      const parsedItems = parsedLlmItems(llm, catalog.exercises)
      const unmatched: UnmatchedView[] = llm.unmatched.map((item) => ({ line: item.sourceText, reason: 'not-found', candidates: item.suggestedExerciseRefs.flatMap((ref) => catalog.exercises.find((exercise) => exercise.ref === ref) ?? []) }))
      if (!parsedItems.length && !unmatched.length) {
        trackGoal('workout_parse_failed')
        setMessages((current) => current.filter((message) => message.id !== thinkingId).concat({ id: crypto.randomUUID(), kind: 'error', error: 'unrecognized', sourceText: value }))
        return
      }
      setItems((current) => [...current, ...parsedItems])
      setMessages((current) => [
        ...current.filter((message) => message.id !== thinkingId).map((message) => message.kind === 'user' && message.id === messageId ? { ...message, itemIds: parsedItems.map((item) => item.id!) } : message),
        ...unmatched.map((item) => ({ id: crypto.randomUUID(), kind: 'clarification' as const, line: item.line, candidates: item.candidates })),
      ])
      trackGoal('workout_parse_completed')
    } catch (error) {
      trackGoal('workout_parse_failed')
      setMessages((current) => current.filter((message) => message.id !== thinkingId).concat({ id: crypto.randomUUID(), kind: 'error', error: workoutParseErrorKind(error), sourceText: value }))
    } finally {
      setSending(false)
    }
  }

  function sendChatMessage(value: string) {
    setTextComposerOpen(true)
    setText('')
    void submitText(value)
  }

  function editMessage(id: string, newText: string) {
    const message = messages.find((current) => current.id === id)
    if (!message || message.kind !== 'user') return
    const removedIds = new Set(message.itemIds)
    setItems((current) => current.filter((item) => !item.id || !removedIds.has(item.id)))
    void submitText(newText, id)
  }

  function retryMessage(id: string, sourceText: string) {
    void submitText(sourceText, id)
  }

  function chooseCandidate(line: string, exercise: ExerciseSnapshot) {
    trackGoal('today_parse_candidate_selected')
    setChoices((current) => ({ ...current, [line]: exercise }))
    setItems((current) => current.some((item) => item.line === line && item.exercise.ref === exercise.ref)
      ? current
      : [...current, { id: crypto.randomUUID(), line, exercise, sets: [{ position: 0 }], hasValues: false }])
  }

  async function previousResults(selected: ExerciseSnapshot[]): Promise<Map<string, PreviousExerciseResult>> {
    if (!clientId) return new Map()
    try {
      setPrefillError(null)
      return await workoutsRepository.latestExerciseResults(clientId, selected.map((exercise) => exercise.ref))
    } catch {
      setPrefillError('Не удалось подставить значения с прошлой тренировки')
      return new Map()
    }
  }

  async function addExercises(exercises: ExerciseSnapshot[]) {
    const results = await previousResults(exercises)
    setManualRefs((current) => [...new Set([...current, ...exercises.map((exercise) => exercise.ref)])])
    const newItems = exercises.map((exercise) => ({
      id: crypto.randomUUID(),
      line: exercise.name,
      exercise,
      sets: results.get(exercise.ref)?.sets ?? [{ position: 0 }],
      hasValues: Boolean(results.get(exercise.ref)),
    }))
    setItems((current) => [...current, ...newItems])
    setMessages((current) => [...current, { id: crypto.randomUUID(), kind: 'manual', itemIds: newItems.map((item) => item.id) }])
    setPickerOpen(false)
  }

  async function pickExercises(exercises: ExerciseSnapshot[]) {
    if (replaceIndex === null) { await addExercises(exercises); return }
    const exercise = exercises[0]
    if (!exercise) return
    const replacedRef = items[replaceIndex]?.exercise.ref
    setItems((current) => current.map((item, index) => index === replaceIndex ? {
      ...item,
      line: exercise.name,
      exercise,
      sets: item.exercise.inputKind === exercise.inputKind ? item.sets : [{ position: 0 }],
      hasValues: item.exercise.inputKind === exercise.inputKind && item.hasValues,
    } : item))
    setManualRefs((current) => [...new Set([...current, exercise.ref])])
    if (replacedRef) setRemovedRefs((current) => current.includes(replacedRef) ? current : [...current, replacedRef])
    setReplaceIndex(null)
    setPickerOpen(false)
  }

  function updateSet(itemIndex: number, setIndex: number, patch: Partial<WorkoutSetDraft>) {
    trackGoal('today_review_edited')
    const ref = items[itemIndex]?.exercise.ref
    if (ref) setManualRefs((current) => current.includes(ref) ? current : [...current, ref])
    const safePatch = patch.rpe === undefined || isValidRpe(patch.rpe) ? patch : { ...patch, rpe: undefined }
    setItems((current) => current.map((item, index) => index !== itemIndex ? item : {
      ...item,
      hasValues: true,
      sets: item.sets.map((set, currentSetIndex) => currentSetIndex === setIndex ? { ...set, ...safePatch } : set),
    }))
  }

  function addSet(itemIndex: number) {
    const ref = items[itemIndex]?.exercise.ref
    if (ref) setManualRefs((current) => current.includes(ref) ? current : [...current, ref])
    setItems((current) => current.map((item, index) => {
      if (index !== itemIndex) return item
      const previous = item.sets.at(-1)
      const nextSet = previous ? { ...previous, position: item.sets.length } : { position: item.sets.length }
      return { ...item, sets: [...item.sets, nextSet], hasValues: item.hasValues }
    }))
  }

  function removeSet(itemIndex: number, setIndex: number) {
    const ref = items[itemIndex]?.exercise.ref
    if (ref) setManualRefs((current) => current.includes(ref) ? current : [...current, ref])
    setItems((current) => current.map((item, index) => index !== itemIndex ? item : {
      ...item,
      sets: item.sets.filter((_, currentSetIndex) => currentSetIndex !== setIndex).map((set, position) => ({ ...set, position })),
    }))
  }

  function removeExercise(itemIndex: number) {
    const item = items[itemIndex]
    if (!item) return
    trackGoal('today_review_exercise_removed')
    setRemovedItem({ item, index: itemIndex })
    setRemovedRefs((current) => current.includes(item.exercise.ref) ? current : [...current, item.exercise.ref])
    setItems((current) => current.filter((_, index) => index !== itemIndex))
  }

  function undoRemoveExercise() {
    if (!removedItem) return
    trackGoal('today_review_exercise_remove_undone')
    const { item, index } = removedItem
    setItems((current) => {
      if (current.some((currentItem) => currentItem.exercise.ref === item.exercise.ref)) return current
      const next = [...current]
      next.splice(Math.min(index, next.length), 0, item)
      return next
    })
    setRemovedRefs((current) => current.filter((ref) => ref !== item.exercise.ref))
    setRemovedItem(null)
  }

  function clearDraftAndForm(openComposer = false) {
    removeTodayDraft(draftKey)
    setScreen('compose')
    setText('')
    setChoices({})
    setItems([])
    setMessages([])
    setClientId('')
    setRecordMode('planned')
    setWorkoutDate(today)
    setStartTime('')
    setManualRefs([])
    setRemovedRefs([])
    setRestoredDraftScreen(null)
    setTextComposerOpen(openComposer)
  }

  const currentWorkout = todayWorkouts.data?.find((workout) => workout.status === 'in_progress')
  const plannedWorkouts = todayWorkouts.data?.filter((workout) => workout.status === 'planned').sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '')) ?? []
  function workoutTime(workout: Workout) { return workout.startTime?.slice(0, 5) ?? 'Без времени' }

  const profileInitial = actor?.firstName?.trim().slice(0, 1).toUpperCase() || (clientMode ? 'К' : 'П')
  const latestWorkout = workouts.data?.filter((workout) => workout.status === 'done').sort((a, b) => `${b.workoutDate}${b.startTime ?? ''}`.localeCompare(`${a.workoutDate}${a.startTime ?? ''}`))[0]
  const contextWorkout = currentWorkout ?? plannedWorkouts[0] ?? latestWorkout
  const contextTitle = currentWorkout ? 'Текущая тренировка' : plannedWorkouts[0] ? 'Ближайшая тренировка' : latestWorkout ? 'Последняя тренировка' : null
  const contextCard = contextWorkout && contextTitle && <section className="today-context"><p>{contextTitle}</p><Link to={currentWorkout ? `/workouts/${contextWorkout.id}/live` : `/workouts/${contextWorkout.id}`}><span><strong>{clientMode ? 'Ваша тренировка' : contextWorkout.clientName}</strong><small>{contextWorkout.workoutDate === today ? `Сегодня, ${workoutTime(contextWorkout)}` : contextWorkout.workoutDate}</small></span><span><strong>{contextWorkout.exercises.length ? contextWorkout.exercises.map((exercise) => exercise.name).slice(0, 2).join(', ') : 'Тренировка'}</strong><small>{contextWorkout.exercises.length} упражнений</small></span><b>›</b></Link></section>
  const activeGoalStage = goal.data ? currentStage(goal.data, today) : null
  const goalCard = clientMode && goal.data && <section className="today-context today-goal-context"><p>ВАШ ФОКУС</p><Link to="/me/progress"><span><strong>{goal.data.title}</strong><small>{activeGoalStage ? `Текущий этап: ${activeGoalStage.title}` : 'Этап пока не задан'}</small></span><b>›</b></Link></section>
  return <Page title="Сегодня" className="today-page today-start-page" action={<Link className="today-profile-avatar" to={clientMode ? '/me/profile' : '/profile'} aria-label="Открыть профиль">{profileInitial}</Link>}>
    {screen === 'compose' ? <section className={`today-composer today-voice-home voice-phase-${voicePhase} ${textComposerOpen ? 'chat-open' : ''}`}>
      {!textComposerOpen && <>
        <VoiceInputButton variant="hero" source="today_workout" idleLabel="Надиктовать тренировку" idleHeading="Чем могу тебе помочь?" idleIcon={<AssistantIcon />} hideIdleLabel onStart={() => { if (restoredDraftScreen) clearDraftAndForm(false) }} onPhaseChange={setVoicePhase} onTranscript={(transcript) => { sendChatMessage(transcript); return undefined }} />
        <div className="today-spacer" aria-hidden="true" />
        {voicePhase === 'idle' && <TipCarousel />}
        {restoredDraftScreen && voicePhase === 'idle' && <section className="today-resume"><span><strong>Есть незавершённая тренировка</strong><small>Можно продолжить с того же места</small></span><div><button type="button" className="link" onClick={() => { const target = restoredDraftScreen; setRestoredDraftScreen(null); setTextComposerOpen(true); if (target !== 'compose') setScreen(target) }}>Продолжить</button><button type="button" className="link muted" onClick={() => clearDraftAndForm(false)}>Удалить</button></div></section>}
        {voicePhase === 'idle' && !restoredDraftScreen && contextCard}
        {voicePhase === 'idle' && !restoredDraftScreen && goalCard}
      </>}
      {textComposerOpen && <>
        <ChatThread
          messages={messages}
          items={items}
          choices={choices}
          isRpeVisible={isRpeVisible}
          onToggleRpe={toggleRpe}
          onReplace={(index) => { setReplaceIndex(index); setPickerOpen(true) }}
          onRemoveExercise={removeExercise}
          onUpdateSet={updateSet}
          onAddSet={addSet}
          onRemoveSet={removeSet}
          onEditMessage={editMessage}
          onChooseCandidate={chooseCandidate}
          onRetryError={retryMessage}
        />
        {removedItem && <div className="today-undo-remove" role="status"><span>Упражнение удалено</span><button type="button" className="link" onClick={undoRemoveExercise}>Отменить</button></div>}
        {prefillError && <p className="error">{prefillError}</p>}
      </>}
      {/* Панель ввода видна сразу, ещё до первого сообщения (как в Figma-макете) —
          набор текста или отправка неявно открывают ленту через sendChatMessage. */}
      {(!restoredDraftScreen || textComposerOpen) && <ChatComposerBar
        value={text}
        onChange={setText}
        onSend={sendChatMessage}
        onTranscript={sendChatMessage}
        disabled={sending}
        menuActions={[
          { label: 'Добавить подход', onClick: () => addSet(items.length - 1), disabled: !items.length },
          { label: 'Добавить упражнение', onClick: () => { trackGoal('exercise_picker_opened'); setReplaceIndex(null); setPickerOpen(true) } },
          { label: 'Завершить тренировку', onClick: () => { trackGoal('today_save_step_opened'); setScreen('save') }, disabled: !items.length },
        ]}
      />}
      {clientMode && actor && isWearablesPilotEnabled(actor.userId) && <WearableHealthCard />}
    </section> : <section className="today-review">
      <div className="today-review-head"><button type="button" className="link today-review-back" onClick={() => setScreen('compose')}>← Назад</button><div><h1>Сохраните тренировку</h1></div></div>
      <section className="today-assignment">
      {clientMode
        ? <p className="today-assignment-self">Тренировка будет сохранена в ваш кабинет</p>
        : <ClientPicker userId={actor?.userId} clients={clients.data ?? []} selectedId={clientId} onChange={setClientId} label="Для кого тренировка" loading={clients.isLoading} error={clients.error} onRetry={() => void clients.refetch()} onCreate={createQuickClient} />}
      {(prefillError || save.error) && <p className="error">{prefillError ?? save.error?.message}</p>}
      <section className="today-save-actions" aria-label="Тип записи">
        <div className="today-record-mode" role="group" aria-label="Тип тренировки"><button type="button" className={recordMode === 'planned' ? 'active' : ''} aria-pressed={recordMode === 'planned'} onClick={() => setRecordMode('planned')}>План</button><button type="button" className={recordMode === 'completed' ? 'active' : ''} aria-pressed={recordMode === 'completed'} onClick={() => { setRecordMode('completed'); setWorkoutDate((date) => workoutDateForRecordMode('completed', date, today)) }}>Завершённая</button></div>
        <div className="split"><label className="today-date-field"><span>Дата</span><input aria-label="Дата тренировки" type="date" value={workoutDate} max={recordMode === 'completed' ? today : undefined} onChange={(event) => setWorkoutDate(localDate(event.target.value))} required /></label>{recordMode === 'planned' && <label className="today-date-field"><span>Время</span><input aria-label="Время тренировки" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>}</div>
        <button type="button" className="wide" disabled={!items.length || !clientId || save.isPending} onClick={() => save.mutate(recordMode)}>{recordMode === 'planned' ? 'Запланировать' : 'Записать как завершённую'}</button>
      </section></section>
    </section>}
    {(catalog.error ?? todayWorkouts.error ?? mine.error) && <p className="error">{(catalog.error ?? todayWorkouts.error ?? mine.error)?.message}</p>}
    {pickerOpen && <ExercisePicker catalog={catalog} clientRecent={clientRecentExercises} onPick={(exercise) => pickExercises([exercise])} onPickMany={pickExercises} multiple={replaceIndex === null} onClose={() => { setPickerOpen(false); setReplaceIndex(null) }} />}
  </Page>
}
