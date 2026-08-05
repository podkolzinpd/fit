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
import { VoiceNoteField } from '../voice-input'
import { useAuth } from '../../app/auth-context'
import type { ParsedWorkoutExercise } from './quick-workout-entry'
import { formatLlmWorkoutText, parseWorkoutWithLlm } from './llm-workout-parser'
import type { WorkoutParseResponse } from '../../data/repositories/exercises.repository'
import { readTodayDraft, removeTodayDraft, todayDraftKey, writeTodayDraft } from './today-draft'
import { workoutDateForRecordMode, type WorkoutRecordMode } from './workout-entry-rules'

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
    const sets = item.sets.length ? item.sets.map((set, position) => ({ position, weightKg: set.weightKg, reps: set.reps, durationSec: set.durationMin === undefined ? undefined : Math.round(set.durationMin * 60), distanceKm: set.distanceKm })) : [{ position: 0 }]
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
  const [pickerOpen, setPickerOpen] = useState(false)
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  const [clientId, setClientId] = useState('')
  const clientWorkouts = useQuery({ queryKey: ['client-exercises-frequency', clientId], queryFn: () => workoutsRepository.list(undefined, undefined, clientId), enabled: Boolean(clientId) })
  const [recordMode, setRecordMode] = useState<RecordMode>('planned')
  const [workoutDate, setWorkoutDate] = useState(today)
  const [startTime, setStartTime] = useState('')
  const [quickClientName, setQuickClientName] = useState('')
  const [quickClientOpen, setQuickClientOpen] = useState(false)
  const [quickClientOption, setQuickClientOption] = useState<{ id: string; fullName: string } | null>(null)
  const [prefillError, setPrefillError] = useState<string | null>(null)
  const [manualRefs, setManualRefs] = useState<string[]>([])
  const [removedRefs, setRemovedRefs] = useState<string[]>([])
  const [draftReady, setDraftReady] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [llmUnmatched, setLlmUnmatched] = useState<UnmatchedView[]>([])
  const [recognized, setRecognized] = useState<ParsedWorkoutExercise[]>([])
  const [voiceRefinement, setVoiceRefinement] = useState<VoiceRefinement>(null)
  const voiceParseVersion = useRef(0)
  const inputStarted = useRef(false)
  const openedTracked = useRef(false)
  const lastEmptyText = useRef('')
  const reviewRequest = useRef(0)
  const draftKey = todayDraftKey(actor!.userId)
  const view = new URLSearchParams(location.search).get('view')
  const screen: Screen = view === 'review' || view === 'save' ? view : 'compose'

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
    writeTodayDraft(draftKey, { screen, text, choices, items, clientId, manualRefs, removedRefs, recordMode, workoutDate, startTime })
  }, [choices, clientId, draftKey, draftReady, items, manualRefs, recordMode, removedRefs, screen, startTime, text, workoutDate])

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
  const createQuickClient = useMutation({
    mutationFn: () => clientsRepository.createQuick(quickClientName.trim()),
    onSuccess: async (id) => {
      trackGoal('today_quick_client_created')
      setQuickClientOption({ id, fullName: quickClientName.trim() })
      setClientId(id)
      setQuickClientName('')
      setQuickClientOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
  })

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
      setLlmUnmatched(unmatched)
      setRecognized(parsedItems)
      const formatted = formatLlmWorkoutText(llm, catalog.exercises)
      if (!formatted) {
        setVoiceRefinement({ state: 'error', message: 'Не удалось получить структурированный разбор диктовки.' })
        trackGoal('voice_workout_parse_failed')
        return
      }
      setText((current) => current === value ? appendVoiceText(previousValue, formatted) : current)
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

  function discardDraft() {
    removeTodayDraft(draftKey)
    setScreen('compose')
    setText('')
    setChoices({})
    setRecognized([])
    setItems([])
    setClientId('')
    setRecordMode('planned')
    setWorkoutDate(today)
    setStartTime('')
    setQuickClientOption(null)
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
      <div className="today-input-card">
        <VoiceNoteField name="today-workout" source="today_workout" label="Тренировка" voiceLabel="Надиктовать" voiceBeta placeholder={'Присед 3×8 — 80 кг\nПланка 3×45 сек'} value={text} autoResize onValueChange={(value) => { voiceParseVersion.current += 1; setText(value); setChoices({}); setRecognized([]); setLlmUnmatched([]); setVoiceRefinement(null) }} onTranscriptAppended={({ previousValue, value, transcript }) => void refineVoiceTranscript(previousValue, value, transcript)} />
        {text && <div className="today-input-actions"><button type="button" className="link" onClick={() => { setText(''); setChoices({}); setRecognized([]); setLlmUnmatched([]) }}>Очистить</button></div>}
      </div>
      {voiceRefinement && <p className={`today-llm-status ${voiceRefinement.state}`} role="status">{voiceRefinement.message}</p>}
      {text.trim() && <div className="today-parse-preview" aria-live="polite">
        {resolved.length > 0 && <section className="today-recognized" aria-label="Распознанные упражнения">
          <p><strong>Распознано: {resolved.length}</strong></p>
          <ul>{resolved.map((item, index) => <li key={`${item.exercise.ref}-${index}`}><strong>{item.exercise.name}</strong><span>{setSummary(item)}</span></li>)}</ul>
        </section>}
        {clarification && <section className="today-clarification" aria-label={clarification.title}><strong>{clarification.title}</strong><p>{clarification.text}</p></section>}
        {displayedUnparsed.map((item) => <div className="today-unparsed" key={item.line}>
          <p>«{item.line}» — {item.reason === 'ambiguous' ? 'выберите вариант' : 'не нашли в каталоге'}</p>
          {item.candidates.length > 0 && <div className="quick-workout-candidates">{item.candidates.map((exercise) => <button type="button" className={choices[item.line]?.ref === exercise.ref ? 'secondary selected' : 'secondary'} key={exercise.ref} onClick={() => { setChoices((current) => ({ ...current, [item.line]: exercise })); setRecognized((current) => current.some((recognizedItem) => recognizedItem.line === item.line) ? current : [...current, { line: item.line, exercise, sets: [{ position: 0 }], hasValues: false }]) }}>{exercise.name}</button>)}</div>}
        </div>)}
      </div>}
       {noMatches && <div className="today-empty-parse" role="status"><strong>Не нашли упражнение</strong><span>Проверьте название или добавьте его из каталога ниже.</span></div>}
       <button type="button" className="wide today-primary-cta" disabled={!text.trim() || parsing} onClick={() => void review()}>{parsing ? 'Разбираю тренировку…' : 'Разобрать тренировку'}</button>
      <button type="button" className="secondary wide today-picker-cta" onClick={() => { trackGoal('exercise_picker_opened'); setItems([]); setScreen('review') }}><span>Выбрать упражнения</span><small>Поиск и массовый выбор</small></button>
    </section> : <section className="today-review">
      <div className="today-review-head"><button type="button" className="link today-review-back" onClick={() => { if (screen === 'review') { reviewRequest.current += 1; setParsing(false); setScreen('compose') } else setScreen('review') }}>{screen === 'review' ? '← Назад' : '← К проверке'}</button><div><h1>{screen === 'review' ? 'Проверьте тренировку' : 'Сохраните тренировку'}</h1>{screen === 'review' && items.length > 0 && <p className="today-review-summary">Распознано: {items.length}</p>}</div></div>
      {screen === 'review' && <>
      {items.length > 0 ? <div className="today-exercise-list">{items.map((item, index) => <article className="today-exercise" key={`${item.exercise.ref}-${index}`}>
        <div className="today-exercise-title"><div><strong>{item.exercise.name}</strong><p className={setSummary(item) === 'без значений' ? 'today-exercise-missing' : undefined}>{setSummary(item)}</p></div><button type="button" className="icon-button" aria-label={`Удалить ${item.exercise.name}`} onClick={() => { setRemovedRefs((current) => current.includes(item.exercise.ref) ? current : [...current, item.exercise.ref]); setItems((current) => current.filter((_, itemIndex) => itemIndex !== index)) }}>×</button></div>
        <details className="today-exercise-editor"><summary>{setSummary(item) === 'без значений' ? 'Добавить значения' : 'Править подходы'}</summary><button type="button" className="link" onClick={() => { setReplaceIndex(index); setPickerOpen(true) }}>Заменить упражнение</button><div className="today-set-list">{item.sets.map((set, setIndex) => <div className="today-set-editor" key={set.position}><strong>{setIndex + 1}</strong>{item.exercise.inputKind === 'strength' && <><label>Кг<input aria-label={`${item.exercise.name}: вес, подход ${setIndex + 1}`} type="number" inputMode="decimal" value={set.weightKg ?? ''} onChange={(event) => updateSet(index, setIndex, { weightKg: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><label>Повт.<input aria-label={`${item.exercise.name}: повторы, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.reps ?? ''} onChange={(event) => updateSet(index, setIndex, { reps: event.target.value === '' ? undefined : Number(event.target.value) })} /></label></>}{item.exercise.inputKind === 'duration' && <label>Сек.<input aria-label={`${item.exercise.name}: секунды, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.durationSec ?? ''} onChange={(event) => updateSet(index, setIndex, { durationSec: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}{item.exercise.inputKind === 'reps' && <label>Повт.<input aria-label={`${item.exercise.name}: повторы, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.reps ?? ''} onChange={(event) => updateSet(index, setIndex, { reps: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}{item.exercise.inputKind === 'distance' && <label>Км<input aria-label={`${item.exercise.name}: километры, подход ${setIndex + 1}`} type="number" inputMode="decimal" value={set.distanceKm ?? ''} onChange={(event) => updateSet(index, setIndex, { distanceKm: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}<label>RPE<input aria-label={`${item.exercise.name}: RPE, подход ${setIndex + 1}`} type="number" min="1" max="10" step="0.5" inputMode="decimal" value={set.rpe ?? ''} onChange={(event) => updateSet(index, setIndex, { rpe: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>{item.sets.length > 1 && <button type="button" className="link danger" aria-label={`Удалить подход ${setIndex + 1}`} onClick={() => removeSet(index, setIndex)}>×</button>}</div>)}</div><button type="button" className="secondary today-add-set" onClick={() => addSet(index)}>＋ Подход</button></details>
      </article>)}</div> : <section className="today-empty today-exercise-empty"><p>Добавьте упражнения из каталога — можно выбрать несколько сразу.</p><button type="button" className="secondary wide" onClick={() => { setReplaceIndex(null); setPickerOpen(true) }}>Добавить упражнение</button></section>}
      {items.length > 0 && <button type="button" className="secondary wide" onClick={() => { setReplaceIndex(null); setPickerOpen(true) }}>Добавить упражнение</button>}
      {items.length > 0 && <button type="button" className="wide today-review-next" onClick={() => setScreen('save')}>Далее</button>}
      </>}
      {screen === 'save' && <section className="today-assignment">
      <label className="today-client"><span>Для кого тренировка</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Выберите клиента</option>{quickClientOption && !clients.data?.some((client) => client.id === quickClientOption.id) && <option value={quickClientOption.id}>{quickClientOption.fullName}</option>}{clients.data?.map((client) => <option value={client.id} key={client.id}>{client.fullName}</option>)}</select></label>
      {!clientId && !quickClientOpen && <button type="button" className="link today-new-client" onClick={() => setQuickClientOpen(true)}>＋ Новый клиент</button>}
      {!clientId && quickClientOpen && <section className="today-quick-client"><div className="today-quick-client-head"><strong>Новый клиент</strong><button type="button" className="link" onClick={() => { setQuickClientOpen(false); setQuickClientName('') }}>Отмена</button></div><p>Укажите имя — остальное можно заполнить позже.</p><div className="today-quick-client-form"><input aria-label="Имя нового клиента" value={quickClientName} onChange={(event) => setQuickClientName(event.target.value)} placeholder="Имя клиента" autoFocus /><button type="button" className="secondary" disabled={quickClientName.trim().length < 2 || createQuickClient.isPending} onClick={() => createQuickClient.mutate()}>Создать</button></div>{createQuickClient.error && <p className="error">{createQuickClient.error.message}</p>}</section>}
      {(prefillError || save.error) && <p className="error">{prefillError ?? save.error?.message}</p>}
      <section className="today-save-actions" aria-label="Тип записи">
        <div className="today-record-mode" role="group" aria-label="Тип тренировки"><button type="button" className={recordMode === 'planned' ? 'active' : ''} aria-pressed={recordMode === 'planned'} onClick={() => setRecordMode('planned')}>План</button><button type="button" className={recordMode === 'completed' ? 'active' : ''} aria-pressed={recordMode === 'completed'} onClick={() => { setRecordMode('completed'); setWorkoutDate((date) => workoutDateForRecordMode('completed', date, today)) }}>Завершённая</button></div>
        <div className="split"><label className="today-date-field"><span>Дата</span><input aria-label="Дата тренировки" type="date" value={workoutDate} max={recordMode === 'completed' ? today : undefined} onChange={(event) => setWorkoutDate(localDate(event.target.value))} required /></label>{recordMode === 'planned' && <label className="today-date-field"><span>Время</span><input aria-label="Время тренировки" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>}</div>
        <button type="button" className="wide" disabled={!items.length || !clientId || save.isPending} onClick={() => save.mutate(recordMode)}>{recordMode === 'planned' ? 'Запланировать' : 'Записать как завершённую'}</button>
      </section></section>}
    </section>}
    {screen === 'compose' && agenda}
    {draftNotice}
    {(clients.error ?? catalog.error ?? todayWorkouts.error) && <p className="error">{(clients.error ?? catalog.error ?? todayWorkouts.error)?.message}</p>}
    {pickerOpen && <ExercisePicker catalog={catalog} frequent={frequentExercises} onPick={(exercise) => pickExercises([exercise])} onPickMany={pickExercises} multiple={replaceIndex === null} onClose={() => { setPickerOpen(false); setReplaceIndex(null) }} />}
  </Page>
}
