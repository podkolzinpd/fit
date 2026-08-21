import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { clientsRepository } from '../../data/repositories/clients.repository'
import { goalsRepository } from '../../data/repositories/goals.repository'
import { progressRepository } from '../../data/repositories/progress.repository'
import { createRunningFormatDrafts, workoutsRepository, type PreviousExerciseResult } from '../../data/repositories/workouts.repository'
import type { ExerciseSnapshot, Workout, WorkoutDraft, WorkoutSetDraft } from '../../shared/domain'
import { formatLocalDate, localDate, todayInTimeZone } from '../../shared/local-date'
import { isValidRpe } from '../../shared/rpe'
import type { RunningFormat } from '../../shared/running-formats'
import { trackGoal } from '../../shared/yandex-metrika'
import { Page } from '../../shared/ui'
import { ExercisePicker, recentExercisesForClient, useExerciseCatalog } from '../exercises'
import { ClientPicker, type ClientPickerSelection } from '../clients'
import { useAuth } from '../../app/auth-context'
import { useRpeDisplay } from '../../app/rpe-display'
import type { ParsedWorkoutExercise } from './quick-workout-entry'
import { formatLlmWorkoutText, parseWorkoutWithLlm } from './llm-workout-parser'
import type { WorkoutParseResponse } from '../../data/repositories/exercises.repository'
import { readTodayDraft, removeTodayDraft, todayDraftKey, writeTodayDraft } from './today-draft'
import { workoutDateForRecordMode, type WorkoutRecordMode } from './workout-entry-rules'
import { WorkoutComposer } from './WorkoutComposer'
import { VoiceInputButton, type VoiceInputPhase } from '../voice-input'
import { WorkoutParseErrorNotice, workoutParseErrorKind, type WorkoutParseErrorKind } from './WorkoutParseErrorNotice'
import { WorkoutSetTable } from './WorkoutSetTable'
import { RunMetricsFields } from './RunMetricsFields'
import { formatRunDuration, runDistanceLabel, runPaceLabel } from '../../shared/run-metrics'
import { WearableHealthCard } from '../wearables'
import { isWearablesPilotEnabled } from '../../app/feature-flags'
import { todayHeaderProps } from './today-header'
import { ClientHomeOverview, clientHomeLatestDoneWorkout } from './ClientHomeOverview'
import { WorkoutExerciseHeader } from './WorkoutExerciseHeader'
import { WorkoutCta, WorkoutExercise, WorkoutHeader, WorkoutSetRow } from './WorkoutSurface'
import { trainerActionItems, trainerPlanningItems, type TrainerActionItem, type TrainerPlanningItem } from './trainer-attention'

type Screen = 'compose' | 'review' | 'save'
type RecordMode = WorkoutRecordMode
type UnmatchedView = { line: string; reason: 'not-found' | 'ambiguous'; candidates: ExerciseSnapshot[] }
type VoiceRefinement = { state: 'loading' | 'success' | 'error'; message: string } | null

interface TodayPageProps {
  clientMode?: boolean
}

function setSummary(item: ParsedWorkoutExercise): string {
  const first = item.sets[0]
  if (!item.hasValues || !first) return 'без значений'
  if (item.exercise.inputKind === 'distance') {
    const duration = formatRunDuration(first.durationSec)
    const distance = runDistanceLabel(first.distanceKm)
    const pace = runPaceLabel(first.durationSec, first.distanceKm)
    const result = [distance, duration, pace ? `темп ${pace}` : null].filter(Boolean).join(' · ')
    return `${item.sets.length} × ${result || 'значения'}`
  }
  if (first.durationSec !== undefined) return `${item.sets.length} × ${first.durationSec} сек`
  if (first.distanceKm !== undefined) return `${item.sets.length} × ${first.distanceKm} км`
  const value = [first.weightKg !== undefined ? `${first.weightKg} кг` : '', first.reps !== undefined ? `${first.reps} повт.` : ''].filter(Boolean).join(' × ')
  return `${item.sets.length} × ${value || 'значения'}`
}

function trainerPlanningDetail(value: string): string {
  return value.replace(/\d{4}-\d{2}-\d{2}/g, (date) => formatLocalDate(localDate(date)))
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
    blockId: item.structure?.blockId ?? crypto.randomUUID(),
    blockType: item.structure?.blockType ?? 'single',
    blockPreset: item.structure?.blockPreset,
    blockRounds: item.structure?.blockRounds ?? 1,
    restBetweenExercisesSec: item.structure?.restBetweenExercisesSec,
    restBetweenRoundsSec: item.structure?.restBetweenRoundsSec,
    restBetweenSetsSec: item.structure?.restBetweenSetsSec,
    // Черновик мог быть создан до появления строгого ограничения RPE в БД.
    // Не даём старому значению сорвать сохранение всей тренировки.
    sets: (item.sets.length ? item.sets : [{ position: 0 }]).map((set) => ({
      ...set,
      ...(isValidRpe(set.rpe) ? {} : { rpe: undefined }),
    })),
  }
}

function runningFormatItems(exercise: ExerciseSnapshot, format: RunningFormat): ParsedWorkoutExercise[] {
  return createRunningFormatDrafts(exercise, format).map((draft) => ({
    line: draft.name,
    exercise: { ...exercise, name: draft.name },
    sets: draft.sets,
    hasValues: draft.sets.some((set) => Object.keys(set).some((key) => key !== 'position' && set[key as keyof typeof set] !== undefined)),
    structure: {
      blockId: draft.blockId,
      blockType: draft.blockType,
      blockPreset: draft.blockPreset,
      blockRounds: draft.blockRounds,
      restBetweenExercisesSec: draft.restBetweenExercisesSec,
      restBetweenRoundsSec: draft.restBetweenRoundsSec,
      restBetweenSetsSec: draft.restBetweenSetsSec,
    },
  }))
}

export function TodayPage({ clientMode = false }: TodayPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { actor } = useAuth()
  const mine = useQuery({ queryKey: ['my-client'], queryFn: () => clientsRepository.getMine(), enabled: clientMode })
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false), enabled: !clientMode })
  const today = todayInTimeZone(actor?.timezone)
  const todayWorkouts = useQuery({ queryKey: ['today-workouts', today], queryFn: () => workoutsRepository.list(today, today), enabled: !clientMode })
  const workouts = useQuery({ queryKey: ['workouts', mine.data?.id], queryFn: () => workoutsRepository.list(undefined, undefined, clientMode ? mine.data!.id : undefined), enabled: !clientMode || Boolean(mine.data) })
  const trainerAttention = useQuery({
    queryKey: ['trainer-attention', actor?.userId],
    queryFn: () => workoutsRepository.listTrainerAttention(),
    enabled: !clientMode && Boolean(actor?.userId),
    refetchInterval: 60_000,
  })
  const attentionPreferences = useQuery({ queryKey: ['trainer-attention-preferences', actor?.userId], queryFn: () => clientsRepository.listAttentionPreferences(actor!.userId), enabled: !clientMode && Boolean(actor?.userId) })
  const goal = useQuery({ queryKey: ['client-goal', mine.data?.id], queryFn: () => goalsRepository.get(mine.data!.id), enabled: clientMode && Boolean(mine.data) })
  const regularity = useQuery({ queryKey: ['workout-regularity', mine.data?.id], queryFn: () => progressRepository.regularity(mine.data!.id), enabled: clientMode && Boolean(mine.data) })
  const latestClientWorkout = workouts.data ? clientHomeLatestDoneWorkout(workouts.data) : undefined
  const personalRecords = useQuery({
    queryKey: ['workout-personal-records', latestClientWorkout?.id],
    queryFn: () => workoutsRepository.personalRecords(latestClientWorkout!.id),
    enabled: clientMode && Boolean(latestClientWorkout?.hasPr),
  })
  const catalog = useExerciseCatalog()
  const [text, setText] = useState('')
  const [choices, setChoices] = useState<Record<string, ExerciseSnapshot>>({})
  const [items, setItems] = useState<ParsedWorkoutExercise[]>([])
  const showRpeByDefault = useRpeDisplay(actor?.userId)
  const [rpeOverrides, setRpeOverrides] = useState<Map<number, boolean>>(() => new Map())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerFromCompose, setPickerFromCompose] = useState(false)
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
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<WorkoutParseErrorKind | null>(null)
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

  useEffect(() => {
    const draft = readTodayDraft(draftKey)
    if (draft) {
      setRestoredDraftScreen(screen === 'compose' ? draft.screen : null)
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
    }
    setDraftReady(true)
  }, [draftKey, today])

  useEffect(() => {
    if (clientMode && mine.data?.id) setClientId(mine.data.id)
  }, [clientMode, mine.data?.id])

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
      if (!clientMode) await queryClient.invalidateQueries({ queryKey: ['clients'] })
      navigate(`/workouts/${id}`, { state: { returnTo: clientMode ? '/me' : '/today' } })
    }, onError: () => trackGoal('today_workout_save_error'),
  })
  const snoozeAttention = useMutation({
    mutationFn: (targetClientId: string) => workoutsRepository.snoozeClientAttention(targetClientId),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['trainer-attention-preferences'] }) },
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
    setParseError(null)
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
        setParseError('unrecognized')
        return
      }
      setItems([...manualOnly, ...parsedItems, ...chosen])
      setScreen('review')
      trackGoal('workout_parse_completed')
      trackGoal('workout_review_opened')
    } catch (error) {
      if (request === reviewRequest.current) {
        trackGoal('workout_parse_failed')
        setParseError(workoutParseErrorKind(error))
      }
    } finally {
      if (request === reviewRequest.current) setParsing(false)
    }
  }

  async function refineVoiceTranscript(previousValue: string, value: string, transcript: string, openReview = false) {
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
        if (openReview) setTextComposerOpen(true)
        trackGoal('voice_workout_parse_failed')
        return
      }
      const normalizedText = appendVoiceText(previousValue, formatted)
      setText((current) => current === value ? normalizedText : current)
      setLastLlmText(normalizedText)
      if (unmatched.length) {
        setVoiceRefinement({ state: 'error', message: 'Распознанные упражнения отформатированы; одно или несколько нужно уточнить.' })
        if (openReview) setTextComposerOpen(true)
        trackGoal('voice_workout_parse_partial')
      } else {
        setVoiceRefinement({ state: 'success', message: 'Диктовка разобрана и отформатирована.' })
        if (openReview && parsedItems.length) {
          setItems(parsedItems)
          setScreen('review')
          trackGoal('workout_review_opened')
        }
        trackGoal('voice_workout_parse_completed')
      }
    } catch {
      if (version !== voiceParseVersion.current) return
      setVoiceRefinement({ state: 'error', message: 'Не удалось обработать диктовку. Исходный текст сохранён.' })
      if (openReview) setTextComposerOpen(true)
      trackGoal('voice_workout_parse_failed')
    }
  }

  async function handleHeroTranscript(transcript: string) {
    const previous = text
    const value = appendVoiceText(previous, transcript)
    setText(value)
    setParseError(null)
    setVoiceRefinement(null)
    await refineVoiceTranscript(previous, value, transcript, true)
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

  async function pickExercises(exercises: ExerciseSnapshot[], runningFormat?: RunningFormat) {
    if (pickerFromCompose) {
      setScreen('review')
      setPickerFromCompose(false)
    }
    if (runningFormat && exercises[0]) {
      const selectedItems = runningFormatItems(exercises[0], runningFormat)
      setItems((current) => {
        if (replaceIndex === null) return [...current, ...selectedItems]
        const next = [...current]
        next.splice(replaceIndex, 1, ...selectedItems)
        return next
      })
      setManualRefs((current) => [...new Set([...current, 'running'])])
      setReplaceIndex(null)
      setPickerOpen(false)
      return
    }
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
  const contextCard = !clientMode && contextWorkout && contextTitle && <section className="today-context"><p>{contextTitle}</p><Link to={currentWorkout ? `/workouts/${contextWorkout.id}/live` : `/workouts/${contextWorkout.id}`}><span><strong>{contextWorkout.clientName}</strong><small>{contextWorkout.workoutDate === today ? `Сегодня, ${workoutTime(contextWorkout)}` : contextWorkout.workoutDate}</small></span><span><strong>{contextWorkout.exercises.length ? contextWorkout.exercises.map((exercise) => exercise.name).slice(0, 2).join(', ') : 'Тренировка'}</strong><small>{contextWorkout.exercises.length} упражнений</small></span><b>›</b></Link></section>
  const actionItems = !clientMode ? trainerActionItems(clients.data ?? [], workouts.data ?? [], trainerAttention.data ?? [], today) : []
  const actionClientIds = new Set(actionItems.map((item) => item.clientId))
  const planningItems = !clientMode ? trainerPlanningItems(clients.data ?? [], workouts.data ?? [], attentionPreferences.data ?? [], actionClientIds, today) : []
  const attentionSurface = !clientMode && <TrainerAttentionQueue
    actions={actionItems}
    planning={planningItems}
    loading={clients.isLoading || workouts.isLoading || trainerAttention.isLoading || attentionPreferences.isLoading}
    error={trainerAttention.error ?? attentionPreferences.error}
    snoozingClientId={snoozeAttention.isPending ? snoozeAttention.variables : undefined}
    onSnooze={(targetClientId) => snoozeAttention.mutate(targetClientId)}
  />
  const clientHomeError = clientMode ? mine.error ?? workouts.error ?? regularity.error ?? goal.error ?? personalRecords.error : null
  const greetingName = clientMode ? mine.data?.fullName || actor?.firstName || 'спортсмен' : actor?.firstName || 'тренер'
  const greeting = `${new Date().getHours() < 12 ? 'Доброе утро' : new Date().getHours() < 18 ? 'Добрый день' : 'Добрый вечер'}, ${greetingName}`

  const header = todayHeaderProps(clientMode, actor)
  return <Page title={header.title} hideTitle={header.hideTitle} className="today-page today-start-page" action={header.showProfileAvatar ? <Link className="today-profile-avatar" to={clientMode ? '/me/profile' : '/profile'} aria-label="Открыть профиль">{profileInitial}</Link> : undefined}>
    {screen === 'compose' ? <section className={`today-composer today-voice-home voice-phase-${voicePhase}`}>
      <p className="today-greeting">{greeting} 👋</p>
      {clientMode && !textComposerOpen ? <ClientHomeOverview
        today={today}
        workouts={workouts.data}
        regularity={regularity.data}
        goal={goal.data}
        personalRecords={personalRecords.data}
        workoutsLoading={mine.isLoading || workouts.isLoading}
        regularityLoading={mine.isLoading || regularity.isLoading}
        error={clientHomeError}
        onRetry={() => {
          void mine.refetch()
          if (mine.data?.id) {
            void workouts.refetch()
            void regularity.refetch()
            void goal.refetch()
            if (latestClientWorkout?.hasPr) void personalRecords.refetch()
          }
        }}
        selfTraining={<section className="client-home-self-training primary">
          <VoiceInputButton variant="hero" source="today_workout" idleLabel="Надиктовать тренировку" onStart={() => { if (restoredDraftScreen) clearDraftAndForm(false) }} onPhaseChange={setVoicePhase} onTranscript={handleHeroTranscript} />
          {voicePhase === 'idle' && <button type="button" className="link today-text-toggle" onClick={() => { if (restoredDraftScreen) clearDraftAndForm(true); else setTextComposerOpen(true) }}>Ввести текстом</button>}
          {restoredDraftScreen && voicePhase === 'idle' && <section className="today-resume"><span><strong>Есть незавершённая тренировка</strong><small>Можно продолжить с того же места</small></span><div><button type="button" className="link" onClick={() => { const target = restoredDraftScreen; setRestoredDraftScreen(null); if (target === 'compose') setTextComposerOpen(true); else setScreen(target) }}>Продолжить</button><button type="button" className="link muted" onClick={() => clearDraftAndForm(false)}>Удалить</button></div></section>}
          {voiceRefinement?.state === 'error' && <div className="voice-action-error" role="alert"><strong>{voiceRefinement.message}</strong><button type="button" className="link" onClick={() => setTextComposerOpen(true)}>Редактировать текст</button></div>}
        </section>}
        wearable={actor && isWearablesPilotEnabled(actor.userId) ? <WearableHealthCard /> : undefined}
      /> : <>
      {!textComposerOpen && <VoiceInputButton variant="hero" source="today_workout" idleLabel="Надиктовать тренировку" onStart={() => { if (restoredDraftScreen) clearDraftAndForm(false) }} onPhaseChange={setVoicePhase} onTranscript={handleHeroTranscript} />}
      {!textComposerOpen && voicePhase === 'idle' && <button type="button" className="link today-text-toggle" onClick={() => { if (restoredDraftScreen) clearDraftAndForm(true); else setTextComposerOpen(true) }}>Ввести текстом</button>}
      {restoredDraftScreen && !textComposerOpen && voicePhase === 'idle' && <section className="today-resume"><span><strong>Есть незавершённая тренировка</strong><small>Можно продолжить с того же места</small></span><div><button type="button" className="link" onClick={() => { const target = restoredDraftScreen; setRestoredDraftScreen(null); if (target === 'compose') setTextComposerOpen(true); else setScreen(target) }}>Продолжить</button><button type="button" className="link muted" onClick={() => clearDraftAndForm(false)}>Удалить</button></div></section>}
      {textComposerOpen && <div className="today-text-fallback"><div className="today-text-fallback-head"><div><strong>Новая тренировка</strong><small>Введите упражнения, подходы и значения</small></div><button type="button" className="link" onClick={() => setTextComposerOpen(false)}>Скрыть</button></div><WorkoutComposer name="today-workout" source="today_workout" value={text} showVoice={false} onValueChange={(value) => { voiceParseVersion.current += 1; setText(value); setParseError(null); setChoices({}); setRecognized([]); setLlmUnmatched([]); setVoiceRefinement(null) }} onTranscriptValueChange={(value) => { setText(value); setParseError(null); setVoiceRefinement(null) }} onTranscriptAppended={({ previousValue, value, transcript }) => refineVoiceTranscript(previousValue, value, transcript)} onClear={() => { setText(''); setParseError(null); setLastLlmText(null); setChoices({}); setRecognized([]); setLlmUnmatched([]); setVoiceRefinement(null) }} primaryAction={<button type="button" className="wide today-primary-cta" disabled={!text.trim() || parsing} onClick={() => void review()}>{parsing ? 'Разбираю тренировку…' : 'Разобрать тренировку'}</button>} secondaryAction={<button type="button" className="link wide today-picker-cta" onClick={() => { trackGoal('exercise_picker_opened'); setItems([]); setPickerFromCompose(true); setPickerOpen(true) }}>Выбрать упражнения вручную</button>}>
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
       {parseError && <WorkoutParseErrorNotice kind={parseError} onRetry={() => void review()} />}
      </WorkoutComposer></div>}
      {voiceRefinement?.state === 'error' && !textComposerOpen && <div className="voice-action-error" role="alert"><strong>{voiceRefinement.message}</strong><button type="button" className="link" onClick={() => setTextComposerOpen(true)}>Редактировать текст</button></div>}
      {voicePhase === 'idle' && !restoredDraftScreen && <>{contextCard}{attentionSurface}</>}
      </>}
    </section> : <section className={`today-review workout-focused-page ${screen === 'save' ? 'today-save-step' : ''}`}>
      <div className="today-review-head"><button type="button" className="link today-review-back" onClick={() => { if (screen === 'review') { trackGoal('today_review_back_to_input'); reviewRequest.current += 1; setParsing(false); setScreen('compose') } else { trackGoal('today_save_back_to_review'); setScreen('review') } }}>{screen === 'review' ? '← Назад' : '← К проверке'}</button><WorkoutHeader eyebrow={screen === 'review' ? 'ПЛАН ТРЕНИРОВКИ' : 'ПОСЛЕДНИЙ ШАГ'} title={screen === 'review' ? 'Проверьте тренировку' : 'Сохраните тренировку'} state="planned" meta={screen === 'review' ? (items.length > 0 ? `Распознано: ${items.length}` : undefined) : 'Выберите вариант и дату'} /></div>
      {screen === 'review' && <>
      {items.length > 0 ? <div className="today-exercise-list">{items.map((item, index) => {
        const showRpe = isRpeVisible(index)
        return <WorkoutExercise state="planned" className="today-exercise planned-exercise" key={`${item.exercise.ref}-${index}`}>
          <WorkoutExerciseHeader as="header" titleAs="strong" className="today-exercise-title" name={item.exercise.name} actions={<button type="button" className="icon-button" aria-label={`Удалить ${item.exercise.name}`} onClick={() => removeExercise(index)}>×</button>} />
          <p className={setSummary(item) === 'без значений' ? 'today-exercise-missing' : undefined}>{setSummary(item)}</p>
          <details className="today-exercise-editor"><summary>{setSummary(item) === 'без значений' ? 'Добавить значения' : 'Править подходы'}</summary><div className="today-exercise-actions"><button type="button" className="link" onClick={() => { setReplaceIndex(index); setPickerOpen(true) }}>Заменить</button><button type="button" className="link" aria-pressed={showRpe} onClick={() => toggleRpe(index)}>{showRpe ? 'Скрыть RPE' : 'Указать RPE'}</button></div><WorkoutSetTable variant="planned" inputKind={item.exercise.inputKind} layout={item.exercise.inputKind === 'distance' ? 'full' : 'singleValue'} showRpe={showRpe} className="today-set-list">{item.sets.map((set, setIndex) => <WorkoutSetRow state="planned" className={`today-set-editor planned-set ${showRpe ? 'rpe-visible' : ''}`} key={set.position}><strong className="workout-set-number planned-set-number">{setIndex + 1}</strong>{item.exercise.inputKind === 'strength' && <><label><span className="sr-only">Кг</span><input className="planned-set-input" aria-label={`${item.exercise.name}: вес, подход ${setIndex + 1}`} type="number" inputMode="decimal" value={set.weightKg ?? ''} onChange={(event) => updateSet(index, setIndex, { weightKg: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><label><span className="sr-only">Повт.</span><input className="planned-set-input" aria-label={`${item.exercise.name}: повторы, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.reps ?? ''} onChange={(event) => updateSet(index, setIndex, { reps: event.target.value === '' ? undefined : Number(event.target.value) })} /></label></>}{item.exercise.inputKind === 'duration' && <><label><span className="sr-only">Сек.</span><input className="planned-set-input" aria-label={`${item.exercise.name}: секунды, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.durationSec ?? ''} onChange={(event) => updateSet(index, setIndex, { durationSec: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><span /></>}{item.exercise.inputKind === 'reps' && <><label><span className="sr-only">Повт.</span><input className="planned-set-input" aria-label={`${item.exercise.name}: повторы, подход ${setIndex + 1}`} type="number" inputMode="numeric" value={set.reps ?? ''} onChange={(event) => updateSet(index, setIndex, { reps: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><span /></>}{item.exercise.inputKind === 'distance' && <RunMetricsFields idPrefix={`today-run-${index}-${setIndex}`} durationSec={set.durationSec} distanceKm={set.distanceKm} inputClassName="planned-set-input" durationLabel={`${item.exercise.name}: время, подход ${setIndex + 1}`} distanceLabel={`${item.exercise.name}: расстояние, подход ${setIndex + 1}`} distanceUnitLabel={`${item.exercise.name}: единица расстояния, подход ${setIndex + 1}`} onCommit={(patch) => updateSet(index, setIndex, patch)} />}{showRpe && <label><span className="sr-only">RPE</span><input className="planned-set-rpe" aria-label={`${item.exercise.name}: RPE, подход ${setIndex + 1}`} type="number" min="1" max="10" step="0.5" inputMode="decimal" value={set.rpe ?? ''} onChange={(event) => updateSet(index, setIndex, { rpe: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}{item.sets.length > 1 && <button type="button" className="link danger planned-set-remove" aria-label={`Удалить подход ${setIndex + 1}`} onClick={() => removeSet(index, setIndex)}>×</button>}</WorkoutSetRow>)}</WorkoutSetTable><div className="set-add-row"><button type="button" className="secondary today-add-set" onClick={() => addSet(index)}>＋ Подход</button></div></details>
        </WorkoutExercise>
      })}</div> : <section className="today-empty today-exercise-empty"><p>Добавьте упражнения из каталога — можно выбрать несколько сразу.</p><button type="button" className="secondary wide" onClick={() => { setReplaceIndex(null); setPickerOpen(true) }}>Добавить упражнение</button></section>}
      {items.length > 0 && <button type="button" className="secondary wide" onClick={() => { setReplaceIndex(null); setPickerOpen(true) }}>Добавить упражнение</button>}
      {removedItem && <div className="today-undo-remove" role="status"><span>Упражнение удалено</span><button type="button" className="link" onClick={undoRemoveExercise}>Отменить</button></div>}
      {items.length > 0 && <WorkoutCta type="button" className="wide today-review-next" onClick={() => { trackGoal('today_save_step_opened'); setScreen('save') }}>Далее</WorkoutCta>}
      </>}
      {screen === 'save' && <section className="today-assignment">
      {clientMode
        ? <p className="today-assignment-self">Тренировка будет сохранена в ваш кабинет</p>
        : <ClientPicker userId={actor?.userId} clients={clients.data ?? []} selectedId={clientId} onChange={setClientId} label="Для кого тренировка" loading={clients.isLoading} error={clients.error} onRetry={() => void clients.refetch()} onCreate={createQuickClient} />}
      {(prefillError || save.error) && <p className="error">{prefillError ?? save.error?.message}</p>}
      <section className="today-save-actions" aria-label="Тип записи">
        <p className="today-save-question">Как сохранить?</p>
        <div className="today-record-mode" role="group" aria-label="Как сохранить тренировку"><button type="button" className={recordMode === 'planned' ? 'active' : ''} aria-pressed={recordMode === 'planned'} onClick={() => setRecordMode('planned')}>Запланировать</button><button type="button" className={recordMode === 'completed' ? 'active' : ''} aria-pressed={recordMode === 'completed'} onClick={() => { setRecordMode('completed'); setWorkoutDate((date) => workoutDateForRecordMode('completed', date, today)) }}>Записать выполненную</button></div>
        <div className="split"><label className="today-date-field"><span>Дата</span><input aria-label="Дата тренировки" type="date" value={workoutDate} max={recordMode === 'completed' ? today : undefined} onChange={(event) => setWorkoutDate(localDate(event.target.value))} required /></label>{recordMode === 'planned' && <label className="today-date-field"><span>Время</span><input aria-label="Время тренировки" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>}</div>
        <WorkoutCta type="button" className="wide" pending={save.isPending} pendingLabel="Сохраняем…" disabled={!items.length || !clientId} onClick={() => save.mutate(recordMode)}>{recordMode === 'planned' ? 'Запланировать тренировку' : 'Записать тренировку'}</WorkoutCta>
      </section></section>}
    </section>}
    {(catalog.error ?? (!clientMode ? todayWorkouts.error : null)) && <p className="error">{(catalog.error ?? (!clientMode ? todayWorkouts.error : null))?.message}</p>}
    {pickerOpen && <ExercisePicker catalog={catalog} clientRecent={clientRecentExercises} initialMode={replaceIndex === null && items.length === 0 ? 'choose' : 'all'} onPick={(exercise, runningFormat) => pickExercises([exercise], runningFormat)} onPickMany={pickExercises} multiple={replaceIndex === null} onClose={() => { setPickerOpen(false); setReplaceIndex(null); setPickerFromCompose(false) }} />}
  </Page>
}

function TrainerAttentionQueue({ actions, planning, loading, error, snoozingClientId, onSnooze }: {
  actions: TrainerActionItem[]
  planning: TrainerPlanningItem[]
  loading: boolean
  error: Error | null
  snoozingClientId?: string
  onSnooze: (clientId: string) => void
}) {
  if (loading) return <section className="trainer-attention trainer-attention-loading" aria-label="Задачи по клиентам"><span className="skeleton-line" /><span className="skeleton-line short" /></section>
  if (error) return <p className="error">Не удалось загрузить задачи по клиентам.</p>
  if (!actions.length && !planning.length) return <section className="trainer-attention trainer-attention-clear"><p className="eyebrow">ПО КЛИЕНТАМ</p><strong>Срочных действий нет</strong></section>
  return <section className="trainer-attention" aria-labelledby="trainer-attention-title">
    {actions.length > 0 && <><div className="trainer-attention-heading"><p className="eyebrow">ПО КЛИЕНТАМ</p><h2 id="trainer-attention-title">Требует действия</h2></div><div className="trainer-attention-list">{actions.map((item) => <Link className={`trainer-attention-row reason-${item.reason}`} key={item.clientId} to={`/workouts/${item.workoutId}${item.reason === 'question' ? '?reply=1' : ''}`}>
      <span><strong>{item.clientName}</strong><small>{item.title}</small><em>{item.reason === 'past_plan' ? formatLocalDate(localDate(item.detail)) : item.detail}</em></span><b>{item.actionLabel}</b>
    </Link>)}</div></>}
    {planning.length > 0 && <details className="trainer-planning">
      <summary><span><strong>Проверить планы</strong><small>{planning.length} {planning.length === 1 ? 'клиент' : planning.length < 5 ? 'клиента' : 'клиентов'}</small></span><i aria-hidden="true" /></summary>
      <div className="trainer-planning-list">{planning.map((item) => <article className="trainer-planning-row" key={item.clientId}><span><strong>{item.clientName}</strong><small>{item.title}</small><em>{trainerPlanningDetail(item.detail)}</em></span><div><Link className="link" to={`/workouts/new?client=${item.clientId}`}>Запланировать</Link><button type="button" className="link muted" disabled={snoozingClientId === item.clientId} onClick={() => onSnooze(item.clientId)}>{snoozingClientId === item.clientId ? 'Сохраняем…' : 'Напомнить через 2 недели'}</button></div></article>)}</div>
    </details>}
  </section>
}
