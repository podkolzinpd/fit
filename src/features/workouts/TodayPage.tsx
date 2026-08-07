import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { workoutsRepository, type PreviousExerciseResult } from '../../data/repositories/workouts.repository'
import type { ExerciseSnapshot, Workout, WorkoutDraft, WorkoutSetDraft } from '../../shared/domain'
import { localDate, todayLocalDate } from '../../shared/local-date'
import { isValidRpe } from '../../shared/rpe'
import { trackGoal } from '../../shared/yandex-metrika'
import { Page } from '../../shared/ui'
import { ExercisePicker, frequentExercisesForClient, useExerciseCatalog } from '../exercises'
import { ClientPicker, type ClientPickerSelection } from '../clients'
import { useAuth } from '../../app/auth-context'
import { useRpeDisplay } from '../../app/rpe-display'
import type { ParsedWorkoutExercise } from './quick-workout-entry'
import { formatLlmWorkoutText, parseWorkoutWithLlm } from './llm-workout-parser'
import type { WorkoutParseResponse } from '../../data/repositories/exercises.repository'
import { readTodayDraft, removeTodayDraft, todayDraftKey, writeTodayDraft } from './today-draft'
import { workoutDateForRecordMode, type WorkoutRecordMode } from './workout-entry-rules'
import { WorkoutComposer } from './WorkoutComposer'
import { WorkoutSetTable } from './WorkoutSetTable'

type Screen = 'compose' | 'review' | 'save'
type RecordMode = WorkoutRecordMode
type UnmatchedView = { line: string; reason: 'not-found' | 'ambiguous'; candidates: ExerciseSnapshot[] }
type VoiceRefinement = { state: 'loading' | 'success' | 'error'; message: string } | null

function setSummary(item: ParsedWorkoutExercise): string {
  const first = item.sets[0]
  if (!item.hasValues || !first) return 'без значений'
  if (first.durationSec !== undefined) return `${item.sets.length} × ${first.durationSec} сек`
  if (first.distanceKm !== undefined) return `${item.sets.length} × ${first.distanceKm} км`
  const value = [first.weightKg !== undefined ? `${first.weightKg} кг` : '', first.reps !== undefined ? `${first.reps} повт.` : ''].filter(Boolean).join(' × ')
  return `${item.sets.length} × ${value || 'значения'}`
}

function appendVoiceText(previous: string, addition: string): string {
  const prefix = previous.trimEnd()
  return prefix ? `${prefix}\n${addition}` : addition
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
    return [{ line: item.sourceText, exercise, sets, hasValues: sets.some((set) => Object.keys(set).some((key) => key !== 'position' && set[key as keyof typeof set] !== undefined)) }]
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

export function TodayPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { actor } = useAuth()
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false) })
  const today = todayLocalDate()
  const todayWorkouts = useQuery({ queryKey: ['today-workouts', today], queryFn: () => workoutsRepository.list(today, today) })
  const catalog = useExerciseCatalog()
  const [text, setText] = useState('')
  const [choices, setChoices] = useState<Record<string, ExerciseSnapshot>>({})
  const [items, setItems] = useState<ParsedWorkoutExercise[]>([])
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
  const [draftRestored, setDraftRestored] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [llmUnmatched, setLlmUnmatched] = useState<UnmatchedView[]>([])
  const [recognized, setRecognized] = useState<ParsedWorkoutExercise[]>([])
  const [voiceRefinement, setVoiceRefinement] = useState<VoiceRefinement>(null)
  const [lastLlmText, setLastLlmText] = useState<string | null>(null)
  const voiceParseVersion = useRef(0)
  const inputStarted = useRef(false)
  const openedTracked = useRef(false)
  const lastEmptyText = useRef('')
  const reviewRequest = useRef(0)
  const draftKey = todayDraftKey(actor!.userId)
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
    const previousScreen = (location.state as { fromTodayScreen?: Screen } | null)?.fromTodayScreen
    if ((next === 'compose' && screen === 'review' && previousScreen === 'compose') || (next === 'review' && screen === 'save' && previousScreen === 'review')) {
      navigate(-1)
      return
    }
    navigate(next === 'compose' ? '/today' : `/today?view=${next}`, { replace: next === 'compose', state: { fromTodayScreen: screen } })
  }

  useEffect(() => {
    const draft = readTodayDraft(draftKey)
    if (draft) {
      setScreen(draft.screen)
      setText(draft.text)
      setLastLlmText(draft.lastLlmText ?? null)
      setChoices(draft.choices)
      setItems(draft.items)
      setClientId(draft.clientId)
      setRecordMode(draft.recordMode ?? 'planned')
      setWorkoutDate(workoutDateForRecordMode(draft.recordMode ?? 'planned', draft.workoutDate ? localDate(draft.workoutDate) : today, today))
      setStartTime(draft.startTime ?? '')
      setManualRefs(draft.manualRefs ?? [])
      setRemovedRefs(draft.removedRefs ?? [])
      setDraftRestored(true)
    }
    setDraftReady(true)
  }, [draftKey, today])

  useEffect(() => {
    if (!draftReady) return
    if (!text.trim() && !items.length) {
      removeTodayDraft(draftKey)
      return
    }
    writeTodayDraft(draftKey, { screen, text, lastLlmText: lastLlmText ?? undefined, choices, items, clientId, manualRefs, removedRefs, recordMode, workoutDate, startTime })
  }, [choices, clientId, draftKey, draftReady, items, lastLlmText, manualRefs, recordMode, removedRefs, screen, startTime, text, workoutDate])

  const displayedUnparsed = llmUnmatched
  const resolved = recognized
  const unresolved = displayedUnparsed.filter((item) => !choices[item.line])
  const clarification = useMemo(() => {
    const hasAmbiguous = unresolved.some((item) => item.reason === 'ambiguous')
    const hasNotFound = unresolved.some((item) => item.reason === 'not-found')
    if (hasAmbiguous && hasNotFound) return { title: 'Уточните упражнения', text: 'Выберите вариант ниже или дополните название.' }
    if (hasAmbiguous) return { title: 'Уточните упражнение', text: 'Выберите вариант ниже или допишите деталь: положение, тренажёр или оборудование.' }
    if (hasNotFound) return { title: 'Не нашли упражнение', text: 'Допишите название точнее или выберите его из каталога.' }
    return null
  }, [unresolved])
  const noMatches = Boolean(text.trim() && !resolved.length && displayedUnparsed.length)
  const frequentExercises = useMemo(() => frequentExercisesForClient(catalog.exercises, clientWorkouts.data ?? []), [catalog.exercises, clientWorkouts.data])

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
    if (noMatches && lastEmptyText.current !== text) {
      lastEmptyText.current = text
      trackGoal('today_parse_empty')
    }
  }, [noMatches, text])
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
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
      navigate(`/workouts/${id}`, { state: { returnTo: '/today' } })
    }, onError: () => trackGoal('today_workout_save_error'),
  })
  async function createQuickClient(fullName: string): Promise<ClientPickerSelection> {
    const id = await clientsRepository.createQuick(fullName)
    trackGoal('today_quick_client_created')
    await queryClient.invalidateQueries({ queryKey: ['clients'] })
    return { id, fullName }
  }

  async function review() {
    const request = ++reviewRequest.current
    trackGoal('workout_parse_submitted')
    setParsing(true)
    try {
      const llm = await parseWorkoutWithLlm(text, catalog.exercises)
      if (request !== reviewRequest.current) return
      const parsedItems = parsedLlmItems(llm, catalog.exercises)
      const unmatched = llm.unmatched.map((item) => ({ line: item.sourceText, reason: 'not-found' as const, candidates: item.suggestedExerciseRefs.flatMap((ref) => catalog.exercises.find((exercise) => exercise.ref === ref) ?? []) }))
      setLlmUnmatched(unmatched)
      setRecognized(parsedItems)
      const manualOnly = items.filter((item) => manualRefs.includes(item.exercise.ref))
      const chosen = unmatched.flatMap((item) => choices[item.line] ? [{ line: item.line, exercise: choices[item.line]!, sets: [{ position: 0 }], hasValues: false }] : [])
      if (!parsedItems.length && !manualOnly.length && !chosen.length) {
        trackGoal('workout_parse_failed')
        return
      }
      setItems([...manualOnly, ...parsedItems, ...chosen])
      setScreen('review')
      trackGoal('workout_parse_completed')
      trackGoal('workout_review_opened')
    } catch {
      if (request === reviewRequest.current) trackGoal('workout_parse_failed')
    } finally {
      if (request === reviewRequest.current) setParsing(false)
    }
  }

  async function refineVoiceTranscript(previousValue: string, value: string, transcript: string) {
    const version = ++voiceParseVersion.current
    setVoiceRefinement({ state: 'loading', message: 'Разбираю диктовку по упражнениям…' })
    trackGoal('voice_workout_parse_started')
    try {
      const llm = await parseWorkoutWithLlm(transcript, catalog.exercises)
      if (version !== voiceParseVersion.current) return
      const parsedItems = parsedLlmItems(llm, catalog.exercises)
      const unmatched = llm.unmatched.map((item) => ({ line: item.sourceText, reason: 'not-found' as const, candidates: item.suggestedExerciseRefs.flatMap((ref) => catalog.exercises.find((exercise) => exercise.ref === ref) ?? []) }))
      setLlmUnmatched((current) => [...current, ...unmatched.filter((item) => !current.some((existing) => existing.line === item.line))])
      setRecognized((current) => [...current, ...parsedItems.filter((item) => !current.some((existing) => existing.line === item.line && existing.exercise.ref === item.exercise.ref))])
      const formatted = formatLlmWorkoutText(llm, catalog.exercises)
      if (!formatted) {
        setVoiceRefinement({ state: 'error', message: 'Не удалось получить структурированный разбор диктовки.' })
        trackGoal('voice_workout_parse_failed')
        return
      }
      const normalizedText = appendVoiceText(previousValue, formatted)
      setText((current) => current === value ? normalizedText : current)
      setLastLlmText(normalizedText)
      if (unmatched.length) {
        setVoiceRefinement({ state: 'error', message: 'Распознанные упражнения отформатированы; одно или несколько нужно уточнить.' })
        trackGoal('voice_workout_parse_partial')
      } else {
        setVoiceRefinement({ state: 'success', message: 'Диктовка разобрана и отформатирована.' })
        trackGoal('voice_workout_parse_completed')
      }
    } catch {
      if (version !== voiceParseVersion.current) return
      setVoiceRefinement({ state: 'error', message: 'Не удалось обработать диктовку. Исходный текст сохранён.' })
      trackGoal('voice_workout_parse_failed')
    }
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
    setItems((current) => [...current, ...exercises.map((exercise) => ({
      line: exercise.name,
      exercise,
      sets: results.get(exercise.ref)?.sets ?? [{ position: 0 }],
      hasValues: Boolean(results.get(exercise.ref)),
    }))])
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

  function discardDraft() {
    removeTodayDraft(draftKey)
    setScreen('compose')
    setText('')
    setLastLlmText(null)
    setChoices({})
    setRecognized([])
    setItems([])
    setClientId('')
    setRecordMode('planned')
    setWorkoutDate(today)
    setStartTime('')
    setManualRefs([])
    setRemovedRefs([])
    setDraftRestored(false)
  }

  const currentWorkout = todayWorkouts.data?.find((workout) => workout.status === 'in_progress')
  const plannedWorkouts = todayWorkouts.data?.filter((workout) => workout.status === 'planned').sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '')) ?? []
  function workoutTime(workout: Workout) { return workout.startTime?.slice(0, 5) ?? 'Без времени' }

  const trainerInitial = actor?.firstName?.trim().slice(0, 1).toUpperCase() || 'П'
  const agenda = (currentWorkout || plannedWorkouts.length > 0) && <section className="today-agenda"><div className="today-agenda-head"><div><p className="eyebrow">Рабочий день</p><h2>На сегодня</h2></div><Link className="link" to="/schedule">Расписание</Link></div>{currentWorkout && <Link className="today-current-workout" to={`/workouts/${currentWorkout.id}/live`}><span><strong>Продолжить тренировку</strong><small>{currentWorkout.clientName} · {workoutTime(currentWorkout)}</small></span><b>→</b></Link>}{plannedWorkouts.slice(0, 3).map((workout) => <Link className="today-planned-workout" key={workout.id} to={`/workouts/${workout.id}`}><span>{workoutTime(workout)}</span><strong>{workout.clientName}</strong><small>{workout.exercises.length ? workout.exercises.map((exercise) => exercise.name).slice(0, 2).join(', ') : 'Без упражнений'}</small></Link>)}</section>
  const draftNotice = draftRestored && <div className="today-draft-notice" role="status"><strong>Черновик восстановлен</strong><button type="button" className="link" onClick={discardDraft}>Удалить</button></div>

  return <Page title="Сегодня" className="today-page today-start-page" action={<Link className="today-profile-avatar" to="/profile" aria-label="Открыть профиль">{trainerInitial}</Link>}>
    {screen === 'compose' ? <section className="today-composer">
      <div className="today-hero">
        <h1>Новая тренировка</h1>
        <p>Напишите тренировку — мы разберём её по упражнениям и подходам.</p>
      </div>
      <WorkoutComposer name="today-workout" source="today_workout" value={text} onValueChange={(value) => { voiceParseVersion.current += 1; setText(value); setChoices({}); setRecognized([]); setLlmUnmatched([]); setVoiceRefinement(null) }} onTranscriptValueChange={(value) => { setText(value); setVoiceRefinement(null) }} onTranscriptAppended={({ previousValue, value, transcript }) => refineVoiceTranscript(previousValue, value, transcript)} onClear={() => { setText(''); setLastLlmText(null); setChoices({}); setRecognized([]); setLlmUnmatched([]); setVoiceRefinement(null) }} primaryAction={<button type="button" className="wide today-primary-cta" disabled={!text.trim() || parsing} onClick={() => void review()}>{parsing ? 'Разбираю тренировку…' : 'Разобрать тренировку'}</button>} secondaryAction={<button type="button" className="secondary wide today-picker-cta" onClick={() => { trackGoal('exercise_picker_opened'); setItems([]); setScreen('review') }}><span>Выбрать упражнения</span><small>Поиск и массовый выбор</small></button>}>
      {voiceRefinement && voiceRefinement.state !== 'loading' && <p className={`today-llm-status ${voiceRefinement.state}`} role="status">{voiceRefinement.message}</p>}
      {(resolved.length > 0 || clarification || displayedUnparsed.length > 0) && <div className="today-parse-preview" aria-live="polite">
        {resolved.length > 0 && <section className="today-recognized" aria-label="Распознанные упражнения">
          <p><strong>Распознано: {resolved.length}</strong></p>
          <ul>{resolved.map((item, index) => <li key={`${item.exercise.ref}-${index}`}><strong>{item.exercise.name}</strong><span>{setSummary(item)}</span></li>)}</ul>
        </section>}
        {clarification && <section className="today-clarification" aria-label={clarification.title}><strong>{clarification.title}</strong><p>{clarification.text}</p></section>}
        {displayedUnparsed.map((item) => <div className="today-unparsed" key={item.line}>
          <p>«{item.line}» — {item.reason === 'ambiguous' ? 'выберите вариант' : 'не нашли в каталоге'}</p>
          {item.candidates.length > 0 && <div className="quick-workout-candidates">{item.candidates.map((exercise) => <button type="button" className={choices[item.line]?.ref === exercise.ref ? 'secondary selected' : 'secondary'} key={exercise.ref} onClick={() => { trackGoal('today_parse_candidate_selected'); setChoices((current) => ({ ...current, [item.line]: exercise })); setRecognized((current) => current.some((recognizedItem) => recognizedItem.line === item.line) ? current : [...current, { line: item.line, exercise, sets: [{ position: 0 }], hasValues: false }]) }}>{exercise.name}</button>)}</div>}
        </div>)}
      </div>}
       {noMatches && <div className="today-empty-parse" role="status"><strong>Не нашли упражнение</strong><span>Проверьте название или добавьте его из каталога ниже.</span></div>}
      </WorkoutComposer>
    </section> : <section className="today-review">
      <div className="today-review-head"><button type="button" className="link today-review-back" onClick={() => { if (screen === 'review') { trackGoal('today_review_back_to_input'); reviewRequest.current += 1; setParsing(false); setScreen('compose') } else { trackGoal('today_save_back_to_review'); setScreen('review') } }}>{screen === 'review' ? '← Назад' : '← К проверке'}</button><div><h1>{screen === 'review' ? 'Проверьте тренировку' : 'Сохраните тренировку'}</h1>{screen === 'review' && items.length > 0 && <p className="today-review-summary">Распознано: {items.length}</p>}</div></div>
      {screen === 'review' && <>
      {items.length > 0 ? <div className="today-exercise-list">{items.map((item, index) => {
        const showRpe = isRpeVisible(index)
        return <article className="today-exercise planned-exercise" key={`${item.exercise.ref}-${index}`}>
          <header className="today-exercise-title"><div><strong>{item.exercise.name}</strong><p className={setSummary(item) === 'без значений' ? 'today-exercise-missing' : undefined}>{setSummary(item)}</p></div><button type="button" className="icon-button" aria-label={`Удалить ${item.exercise.name}`} onClick={() => removeExercise(index)}>×</button></header>
          <details className="today-exercise-editor"><summary>{setSummary(item) === 'без значений' ? 'Добавить значения' : 'Править подходы'}</summary><div className="today-exercise-actions"><button type="button" className="link" onClick={() => { setReplaceIndex(index); setPickerOpen(true) }}>Заменить</button><button type="button" className="link" aria-pressed={showRpe} onClick={() => toggleRpe(index)}>{showRpe ? 'Скрыть RPE' : 'Указать RPE'}</button></div><WorkoutSetTable variant="planned" inputKind={item.exercise.inputKind} layout="singleValue" showRpe={showRpe} className="today-set-list">{item.sets.map((set, setIndex) => <div className={`today-set-editor workout-set-row planned-set ${showRpe ? 'rpe-visible' : ''}`} key={set.position}><strong className="workout-set-number planned-set-number">{setIndex + 1}</strong>{item.exercise.inputKind === 'strength' && <><label><span className="sr-only">Кг</span><input className="planned-set-input" aria-label={`${item.exercise.name}: вес, подход ${setIndex + 1}`} type="number" inputMode="decimal" value={set.weightKg ?? ''} onChange={(event) => updateSet(index, setIndex, { weightKg: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><label><span className="sr-only">Повт.</span><input className="planned-set-input" aria-label={`${item.exercise.name}: повторы, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.reps ?? ''} onChange={(event) => updateSet(index, setIndex, { reps: event.target.value === '' ? undefined : Number(event.target.value) })} /></label></>}{item.exercise.inputKind === 'duration' && <><label><span className="sr-only">Сек.</span><input className="planned-set-input" aria-label={`${item.exercise.name}: секунды, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.durationSec ?? ''} onChange={(event) => updateSet(index, setIndex, { durationSec: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><span /></>}{item.exercise.inputKind === 'reps' && <><label><span className="sr-only">Повт.</span><input className="planned-set-input" aria-label={`${item.exercise.name}: повторы, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.reps ?? ''} onChange={(event) => updateSet(index, setIndex, { reps: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><span /></>}{item.exercise.inputKind === 'distance' && <><label><span className="sr-only">Км</span><input className="planned-set-input" aria-label={`${item.exercise.name}: километры, подход ${setIndex + 1}`} type="number" inputMode="decimal" value={set.distanceKm ?? ''} onChange={(event) => updateSet(index, setIndex, { distanceKm: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><span /></>}{showRpe && <label><span className="sr-only">RPE</span><input className="planned-set-rpe" aria-label={`${item.exercise.name}: RPE, подход ${setIndex + 1}`} type="number" min="1" max="10" step="0.5" inputMode="decimal" value={set.rpe ?? ''} onChange={(event) => updateSet(index, setIndex, { rpe: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}{item.sets.length > 1 && <button type="button" className="link danger planned-set-remove" aria-label={`Удалить подход ${setIndex + 1}`} onClick={() => removeSet(index, setIndex)}>×</button>}</div>)}</WorkoutSetTable><div className="set-add-row"><button type="button" className="secondary today-add-set" onClick={() => addSet(index)}>＋ Подход</button></div></details>
        </article>
      })}</div> : <section className="today-empty today-exercise-empty"><p>Добавьте упражнения из каталога — можно выбрать несколько сразу.</p><button type="button" className="secondary wide" onClick={() => { setReplaceIndex(null); setPickerOpen(true) }}>Добавить упражнение</button></section>}
      {items.length > 0 && <button type="button" className="secondary wide" onClick={() => { setReplaceIndex(null); setPickerOpen(true) }}>Добавить упражнение</button>}
      {removedItem && <div className="today-undo-remove" role="status"><span>Упражнение удалено</span><button type="button" className="link" onClick={undoRemoveExercise}>Отменить</button></div>}
      {items.length > 0 && <button type="button" className="wide today-review-next" onClick={() => { trackGoal('today_save_step_opened'); setScreen('save') }}>Далее</button>}
      </>}
      {screen === 'save' && <section className="today-assignment">
      <ClientPicker userId={actor?.userId} clients={clients.data ?? []} selectedId={clientId} onChange={setClientId} label="Для кого тренировка" loading={clients.isLoading} error={clients.error} onRetry={() => void clients.refetch()} onCreate={createQuickClient} />
      {(prefillError || save.error) && <p className="error">{prefillError ?? save.error?.message}</p>}
      <section className="today-save-actions" aria-label="Тип записи">
        <div className="today-record-mode" role="group" aria-label="Тип тренировки"><button type="button" className={recordMode === 'planned' ? 'active' : ''} aria-pressed={recordMode === 'planned'} onClick={() => setRecordMode('planned')}>План</button><button type="button" className={recordMode === 'completed' ? 'active' : ''} aria-pressed={recordMode === 'completed'} onClick={() => { setRecordMode('completed'); setWorkoutDate((date) => workoutDateForRecordMode('completed', date, today)) }}>Завершённая</button></div>
        <div className="split"><label className="today-date-field"><span>Дата</span><input aria-label="Дата тренировки" type="date" value={workoutDate} max={recordMode === 'completed' ? today : undefined} onChange={(event) => setWorkoutDate(localDate(event.target.value))} required /></label>{recordMode === 'planned' && <label className="today-date-field"><span>Время</span><input aria-label="Время тренировки" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>}</div>
        <button type="button" className="wide" disabled={!items.length || !clientId || save.isPending} onClick={() => save.mutate(recordMode)}>{recordMode === 'planned' ? 'Запланировать' : 'Записать как завершённую'}</button>
      </section></section>}
    </section>}
    {screen === 'compose' && agenda}
    {draftNotice}
    {(catalog.error ?? todayWorkouts.error) && <p className="error">{(catalog.error ?? todayWorkouts.error)?.message}</p>}
    {pickerOpen && <ExercisePicker catalog={catalog} frequent={frequentExercises} onPick={(exercise) => pickExercises([exercise])} onPickMany={pickExercises} multiple={replaceIndex === null} onClose={() => { setPickerOpen(false); setReplaceIndex(null) }} />}
  </Page>
}
