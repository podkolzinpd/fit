import { invalidateWorkoutResults } from '../../app/invalidate-workout-results'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { createRunningFormatDrafts, type PreviousExerciseResult } from '../../data/repositories/workouts.repository'
import type { ExerciseSnapshot, Workout, WorkoutDraft, WorkoutSetDraft, WorkoutTrainingFormat } from '../../shared/domain'
import { formatLocalDate, localDate, todayInTimeZone } from '../../shared/local-date'
import { isValidRpe } from '../../shared/rpe'
import type { RunningFormat } from '../../shared/running-formats'
import { trackGoal } from '../../shared/yandex-metrika'
import { Coachmark, InlineRequestError, OverflowMenu, Page, useConfirm } from '../../shared/ui'
import { ExercisePicker, ExerciseThumbnail, findCatalogExercise, recentExercisesForClient, useExerciseCatalog } from '../exercises'
import { ClientPicker, type ClientPickerSelection } from '../clients'
import { useAuth } from '../../app/auth-context'
import { isTrainerScheduleV2Enabled } from '../../app/trainer-schedule-v2'
import { isClientLimeEnabled } from '../../app/client-lime'
import { isFitLimeEnabled } from '../../app/fit-lime'
import { safeWorkoutReturnTo } from './workout-navigation'
import { readWorkoutFormDraft, removeWorkoutFormDraft, workoutFormDraftKey, writeWorkoutFormDraft } from './workout-form-draft'
import { useDataBackend } from '../../app/data-backend-context'
import { useExercisePlanRestDisplay } from '../../app/exercise-plan-display'
import { useRpeDisplay } from '../../app/rpe-display'
import { type ParsedWorkoutExercise } from './quick-workout-entry'
import { formatLlmWorkoutText, orderParsedWorkoutItems, parsedWorkoutItems, parseWorkoutWithLlm, resolveWorkoutParseChoice, workoutParseSetSummary, workoutParseUnmatched, type WorkoutParseUnmatchedView } from './llm-workout-parser'
import { clientTodayDraftKey, readClientTodayDrafts, writeClientTodayDraft, readTodayDraft, removeTodayDraft, todayDraftKey, writeTodayDraft } from './today-draft'
import { type WorkoutRecordMode } from './workout-entry-rules'
import { firstCardioDraftMissingEnteredDuration } from './calorie-duration-prompt'
import { actualWorkoutDurationSeconds } from './actual-workout-duration'
import { WorkoutActualDurationField } from './WorkoutActualDuration'
import { WorkoutComposer } from './WorkoutComposer'
import { VoiceInputButton, type VoiceInputPhase } from '../voice-input'
import { WorkoutParseErrorNotice, workoutParseErrorKind, type WorkoutParseErrorKind } from './WorkoutParseErrorNotice'
import { WorkoutSetTable } from './WorkoutSetTable'
import { RunMetricsFields } from './RunMetricsFields'
import { WorkoutDurationField } from './WorkoutDurationField'
import { allowsOptionalDistance, allowsDurationWeight, allowsRepetitionTimeChoice, isLoadedDistance, exerciseSetColumnLabels } from '../../shared/exercise-measurements'
import { isRowingExerciseRef } from '../../shared/run-metrics'
import { WearableHealthCard } from '../wearables'
import { isTodayGreetingPilotEnabled, isWearablesPilotEnabled } from '../../app/feature-flags'
import { todayHeaderProps } from './today-header'
import { ClientHomeOverview } from './ClientHomeOverview'
import { PresetWorkoutPicker } from './PresetWorkoutPicker'
import { PRESET_WORKOUTS, presetWorkoutToParsedItems } from '../../shared/preset-workouts'
import { WorkoutExerciseHeader } from './WorkoutExerciseHeader'
import { WorkoutCta, WorkoutExercise, WorkoutHeader, WorkoutSetRow } from './WorkoutSurface'
import { trainerActionItems, trainerPlanningDetail, trainerPlanningItems, type TrainerActionItem, type TrainerPlanningItem } from './trainer-attention'
import { TrainerFirstPlanPrompt, TrainerFirstRun } from './FirstRunExperience'
import { takeFirstWorkoutIntent } from './first-workout-intent'
import { groupParsedWorkoutReviewBlocks, hasUnresolvedWorkoutReviewItems, mergeParsedWorkoutReviewBlockWithNext, moveParsedWorkoutReviewBlock, splitParsedWorkoutReviewBlock } from './today-review-order'
import { AppInstallPrompt } from '../install'
import { NotificationOnboarding } from '../notifications'
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, CloseIcon, KeyboardIcon } from '../../shared/icons'
import { ChatHeaderAction } from '../chat'
import { TrainerDiscoveryHomeCard } from '../clients/TrainerDiscoveryHomeCard'
import { YandexAccountLinkingCard } from '../auth'
import { prepareZeroReplacement } from '../../shared/numeric-input'
import { QuickStartWorkout, TrainerActiveWorkouts } from './QuickStartWorkout'
import { defaultWorkoutTrainingFormat } from './workout-training-format'

type Screen = 'compose' | 'review' | 'save'
type RecordMode = WorkoutRecordMode
type UnmatchedView = WorkoutParseUnmatchedView
type VoiceRefinement = { state: 'loading' | 'success' | 'error'; message: string } | null

interface TodayPageProps {
  clientMode?: boolean
}

function appendVoiceText(previous: string, addition: string): string {
  const prefix = previous.trimEnd()
  return prefix ? `${prefix}\n${addition}` : addition
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
    trainerComment: item.trainerComment,
    // Черновик мог быть создан до появления строгого ограничения RPE в БД.
    // Не даём старому значению сорвать сохранение всей тренировки.
    sets: (item.sets.length ? item.sets : [{ position: 0 }]).map((set) => ({
      ...set,
      ...(isValidRpe(set.rpe) ? {} : { rpe: undefined }),
      metricSources: set.metricSources ?? {
        duration: item.hasValues && (set.durationSec !== undefined || set.durationMin !== undefined) ? 'entered' : 'unknown',
        distance: item.hasValues && set.distanceKm !== undefined ? 'entered' : 'unknown',
        rpe: item.hasValues && isValidRpe(set.rpe) ? 'entered' : 'unknown',
      },
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
  const { clients: clientsRepository, exercises: exercisesRepository, goals: goalsRepository, progress: progressRepository, trainerFinance, workouts: workoutsRepository } = useDataBackend()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { actor } = useAuth()
  const clientLime = clientMode && isClientLimeEnabled(actor)
  const [clientSessionId, setClientSessionId] = useState(() => crypto.randomUUID())
  const requestedClientDraft = new URLSearchParams(location.search).get('draft')
  const clientDraftId = requestedClientDraft && /^[\w-]{1,80}$/.test(requestedClientDraft) ? requestedClientDraft : clientSessionId
  const [draftListVersion, setDraftListVersion] = useState(0)
  const [restoredClientDraft, setRestoredClientDraft] = useState(false)
  const [reviewedText, setReviewedText] = useState<string | null>(null)
  const limePlanning = !clientMode && isFitLimeEnabled(actor)
  const entryState = location.state as { newClientDraft?: boolean; returnTo?: unknown; planClientId?: string; planStartTime?: string; planEndTime?: string; planTrainingFormat?: WorkoutTrainingFormat; planTitle?: string; planRequestId?: string; sourceFormDraftKey?: string } | null
  const returnTo = limePlanning ? safeWorkoutReturnTo(entryState?.returnTo) ?? '/today' : clientMode ? '/me' : '/today'
  const [planMetadata, setPlanMetadata] = useState(() => ({
    title: limePlanning ? entryState?.planTitle : undefined,
    endTime: limePlanning ? entryState?.planEndTime : undefined,
    requestId: limePlanning ? entryState?.planRequestId ?? crypto.randomUUID() : undefined,
    sourceFormDraftKey: limePlanning ? entryState?.sourceFormDraftKey : undefined,
  }))
  const [askConfirm, confirmDialog] = useConfirm()
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
  const catalog = useExerciseCatalog()
  const [firstWorkoutIntent] = useState(() => clientMode && actor ? takeFirstWorkoutIntent(actor.userId) : null)
  const compactClientEntry = clientMode && new URLSearchParams(location.search).get('entry') === 'workout'
  const compactTrainerTextEntry = !clientMode && isTrainerScheduleV2Enabled(actor) && new URLSearchParams(location.search).get('entry') === 'text'
  const [text, setText] = useState('')
  const [choices, setChoices] = useState<Record<string, ExerciseSnapshot>>({})
  const [items, setItems] = useState<ParsedWorkoutExercise[]>([])
  const planExercises = useMemo(() => items.map(draftExercise), [items])
  const [lastAddedReviewRound, setLastAddedReviewRound] = useState<{ blockId: string; position: number } | null>(null)
  const [reordering, setReordering] = useState(false)
  const showRpeByDefault = useRpeDisplay(actor?.userId)
  const showRestByDefault = useExercisePlanRestDisplay(actor?.userId)
  const [rpeOverrides, setRpeOverrides] = useState<Map<number, boolean>>(() => new Map())
  const [restOverrides, setRestOverrides] = useState<Map<number, boolean>>(() => new Map())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSelectionDraft, setPickerSelectionDraft] = useState<ExerciseSnapshot[]>([])
  const [pickerFromCompose, setPickerFromCompose] = useState(false)
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  const [clientId, setClientId] = useState(limePlanning ? entryState?.planClientId ?? '' : '')
  const effectiveClientId = clientMode ? mine.data?.id ?? clientId : clientId
  const clientWorkouts = useQuery({ queryKey: ['client-exercises-frequency', effectiveClientId], queryFn: () => workoutsRepository.list(undefined, undefined, effectiveClientId), enabled: Boolean(effectiveClientId) })
  const [recordMode, setRecordMode] = useState<RecordMode>('planned')
  const [missingCardioTime, setMissingCardioTime] = useState<string | null>(null)
  const [workoutDate, setWorkoutDate] = useState(() => {
    if (limePlanning) {
      try { return localDate(new URLSearchParams(location.search).get('date') ?? today) } catch { return today }
    }
    return today
  })
  const [startTime, setStartTime] = useState(limePlanning ? entryState?.planStartTime ?? '' : '')
  const [actualDurationMinutes, setActualDurationMinutes] = useState('')
  const [trainingFormat, setTrainingFormat] = useState<WorkoutTrainingFormat | undefined>(clientMode ? 'self' : limePlanning ? entryState?.planTrainingFormat : undefined)
  const trainingFormatTouched = useRef(limePlanning && Boolean(entryState?.planTrainingFormat))
  const finance = useQuery({
    queryKey: ['trainer-finance-client', effectiveClientId],
    queryFn: () => trainerFinance.listClient(effectiveClientId),
    enabled: !clientMode && Boolean(effectiveClientId),
  })
  const [prefillError, setPrefillError] = useState<string | null>(null)
  const [manualRefs, setManualRefs] = useState<string[]>([])
  const [removedRefs, setRemovedRefs] = useState<string[]>([])
  const [removedItem, setRemovedItem] = useState<{ item: ParsedWorkoutExercise; index: number } | null>(null)
  const [draftLoadedKey, setDraftLoadedKey] = useState<string | null>(null)
  const [restoredDraftScreen, setRestoredDraftScreen] = useState<Screen | null>(null)
  const [textComposerOpen, setTextComposerOpen] = useState(firstWorkoutIntent?.mode === 'text' || compactClientEntry || compactTrainerTextEntry || (clientLime && Boolean(requestedClientDraft)))
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
  const firstIntentConsumed = useRef(false)
  const [firstClientCreating, setFirstClientCreating] = useState(false)
  const [firstClientError, setFirstClientError] = useState<Error | null>(null)
  const planId = limePlanning ? new URLSearchParams(location.search).get('plan') ?? entryState?.planRequestId : undefined
  const planOnly = limePlanning && Boolean(planId)
  const draftKey = clientLime ? clientTodayDraftKey(actor!.userId, clientDraftId) : todayDraftKey(actor!.userId, planId)
  const draftReady = draftLoadedKey === draftKey
  const clientDrafts = useMemo(() => clientLime ? readClientTodayDrafts(actor!.userId) : [], [clientLime, actor, draftListVersion, location.search, textComposerOpen, draftReady])
  const todayPath = clientMode ? '/me' : '/today'
  const planQuery = clientLime ? `&draft=${encodeURIComponent(clientDraftId)}` : planId ? `&plan=${encodeURIComponent(planId)}` : ''
  const composePath = clientLime ? `/me?draft=${encodeURIComponent(clientDraftId)}` : !clientMode && isTrainerScheduleV2Enabled(actor) ? `/today?view=compose${planQuery}` : todayPath
  const view = new URLSearchParams(location.search).get('view')
  const requestedScreen: Screen = view === 'review' || view === 'save' ? view : 'compose'
  const screen: Screen = draftReady && requestedScreen === 'save' && items.length === 0
    ? (text.trim() ? 'review' : 'compose')
    : requestedScreen
  const reviewBlocks = useMemo(() => groupParsedWorkoutReviewBlocks(items), [items])

  function isRpeVisible(exerciseIndex: number) {
    return rpeOverrides.get(exerciseIndex) ?? showRpeByDefault
  }

  function toggleRpe(exerciseIndex: number) {
    setRpeOverrides((current) => new Map(current).set(exerciseIndex, !isRpeVisible(exerciseIndex)))
  }

  function isRestVisible(exerciseIndex: number) {
    return restOverrides.get(exerciseIndex) ?? showRestByDefault
  }

  function toggleRest(exerciseIndex: number) {
    setRestOverrides((current) => new Map(current).set(exerciseIndex, !isRestVisible(exerciseIndex)))
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
    navigate(next === 'compose' ? composePath : `${todayPath}?view=${next}${planQuery}`, { replace: next === 'compose', state: { fromTodayScreen: screen, ...(limePlanning ? { returnTo } : {}) } })
  }

  function closeTextComposer() {
    setTextComposerOpen(false)
    if (clientLime) { setRestoredDraftScreen(text.trim() || items.length ? 'compose' : null); navigate('/me'); return }
    if (compactClientEntry) navigate(todayPath, { replace: true })
    if (compactTrainerTextEntry) navigate(composePath, { replace: true, state: limePlanning ? { returnTo } : undefined })
  }

  useEffect(() => {
    const draft = readTodayDraft(draftKey)
    if (clientLime && draftLoadedKey !== draftKey) resetDraftFields(Boolean(requestedClientDraft))
    if (draft) {
      if (clientLime) setRestoredClientDraft(true)
      setRestoredDraftScreen(screen === 'compose' && (!limePlanning || draft.text.trim() || draft.items.length) ? draft.screen : null)
      setText(draft.text)
      setReviewedText(draft.reviewedText ?? (clientLime && draft.screen !== 'compose' ? draft.text : null))
      setLastLlmText(draft.lastLlmText ?? null)
      setChoices(draft.choices)
      setItems(draft.items)
      setClientId(draft.clientId)
      if (limePlanning) setPlanMetadata({ title: draft.title, endTime: draft.endTime, requestId: draft.requestId ?? crypto.randomUUID(), sourceFormDraftKey: draft.sourceFormDraftKey })
      setRecordMode(planOnly ? 'planned' : draft.recordMode ?? 'planned')
      setWorkoutDate(draft.workoutDate ? localDate(draft.workoutDate) : today)
      setStartTime(draft.startTime ?? '')
      setActualDurationMinutes(draft.actualDurationMinutes ?? '')
      setTrainingFormat(clientMode ? 'self' : draft.trainingFormat)
      trainingFormatTouched.current = Boolean(draft.trainingFormat)
      setManualRefs(draft.manualRefs ?? [])
      setRemovedRefs(draft.removedRefs ?? [])
    }
    setDraftLoadedKey(draftKey)
  }, [draftKey, today, limePlanning])

  useEffect(() => {
    if (clientMode && mine.data?.id) setClientId(mine.data.id)
  }, [clientMode, mine.data?.id])

  useEffect(() => {
    if (clientMode) { setTrainingFormat('self'); return }
    if (!trainingFormatTouched.current && finance.data) {
      setTrainingFormat(defaultWorkoutTrainingFormat(finance.data.packages, workoutDate))
    }
  }, [clientMode, finance.data, workoutDate])

  useEffect(() => {
    if (!draftReady || requestedScreen !== 'save' || items.length > 0) return
    const nextScreen: Screen = text.trim() ? 'review' : 'compose'
    navigate(nextScreen === 'compose' ? composePath : `${todayPath}?view=${nextScreen}${planQuery}`, { replace: true, state: limePlanning ? { returnTo } : undefined })
    if (nextScreen === 'compose' && text.trim()) setTextComposerOpen(true)
  }, [composePath, draftReady, items.length, navigate, requestedScreen, text, todayPath, planQuery, limePlanning, returnTo])

  useEffect(() => {
    if (!draftReady) return
    if (!text.trim() && !items.length && !(limePlanning && planMetadata.sourceFormDraftKey)) {
      removeTodayDraft(draftKey)
      return
    }
    const persistedItems = planOnly ? items.map((item, index) => ({ ...item, structure: { ...item.structure, blockId: planExercises[index]?.blockId ?? item.structure?.blockId } })) : items
    const persistedDraft = { ...(limePlanning ? planMetadata : {}), screen, text, reviewedText: reviewedText ?? undefined, lastLlmText: lastLlmText ?? undefined, choices, items: persistedItems, clientId, manualRefs, removedRefs, recordMode, workoutDate, startTime, actualDurationMinutes, trainingFormat }
    if (clientLime) writeClientTodayDraft(actor!.userId, clientDraftId, persistedDraft)
    else writeTodayDraft(draftKey, persistedDraft)
    if (limePlanning && planMetadata.sourceFormDraftKey?.startsWith(workoutFormDraftKey(actor!.userId, 'new--'))) {
      const source = readWorkoutFormDraft(planMetadata.sourceFormDraftKey)
      // A different quick plan may now occupy this date's slot. Never overwrite it.
      if (source && source.requestId === planMetadata.requestId) writeWorkoutFormDraft(planMetadata.sourceFormDraftKey, {
        ...source, title: planMetadata.title, composerText: text, clientId, workoutDate, startTime,
        endTime: planMetadata.endTime ?? '', trainingFormat, exercises: planExercises,
      })
    }
  }, [actualDurationMinutes, choices, clientId, draftKey, draftReady, items, lastLlmText, limePlanning, manualRefs, planMetadata, planExercises, planOnly, recordMode, removedRefs, reviewedText, screen, startTime, text, trainingFormat, workoutDate])

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
      const draft = { ...(limePlanning && mode === 'planned' ? { title: planMetadata.title?.trim() || null, requestId: planMetadata.requestId, endTime: planMetadata.endTime || undefined } : {}), clientId: effectiveClientId, workoutDate, startTime: startTime || undefined, ...(mode === 'completed' ? { actualDurationSec: actualWorkoutDurationSeconds(actualDurationMinutes) } : {}), trainingFormat: clientMode ? 'self' as const : trainingFormat ?? 'self', exercises: planOnly ? planExercises : items.map(draftExercise) }
      return mode === 'planned' ? workoutsRepository.save(draft) : workoutsRepository.saveCompleted(draft)
    },
    onMutate: (mode) => trackGoal(mode === 'planned' ? 'today_plan_save_started' : 'today_workout_save_started'),
    onSuccess: async (id, mode) => {
      const selectedClient = clients.data?.find((client) => client.id === clientId)
      const firstPlanClientState = !clientMode && mode === 'planned' && selectedClient
        && !(workouts.data ?? []).some((workout) => workout.clientId === clientId)
        ? { id: selectedClient.id, fullName: selectedClient.fullName }
        : undefined
      trackGoal(mode === 'planned' ? 'today_plan_saved' : 'today_workout_saved')
      trackGoal('today_review_confirmed')
      setDraftLoadedKey(null)
      removeTodayDraft(draftKey)
      if (limePlanning && planMetadata.sourceFormDraftKey?.startsWith(workoutFormDraftKey(actor!.userId, 'new--'))
        && readWorkoutFormDraft(planMetadata.sourceFormDraftKey)?.requestId === planMetadata.requestId) removeWorkoutFormDraft(planMetadata.sourceFormDraftKey)
      await invalidateWorkoutResults(queryClient)
      await queryClient.invalidateQueries({ queryKey: ['today-workouts'] })
      if (!clientMode) await queryClient.invalidateQueries({ queryKey: ['clients'] })
      if (planOnly && mode === 'planned') navigate(returnTo, { replace: true, state: { savedPlanId: id } })
      else navigate(`/workouts/${id}`, { replace: true, state: { returnTo, firstPlanClient: firstPlanClientState } })
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

  async function createFirstClient(fullName: string) {
    setFirstClientCreating(true)
    setFirstClientError(null)
    try {
      const created = await createQuickClient(fullName)
      setClientId(created.id)
    } catch (caught) {
      setFirstClientError(caught instanceof Error ? caught : new Error('Не удалось добавить клиента'))
    } finally {
      setFirstClientCreating(false)
    }
  }

  async function review() {
    if (clientLime && reviewedText === text) { setScreen('review'); return }
    if (clientLime && reviewedText !== null && !await askConfirm({
      message: 'Текст изменился. Заменить проверенный список новым разбором? Правки упражнений и подходов будут заменены.',
      confirmLabel: 'Разобрать заново',
    })) return
    const request = ++reviewRequest.current
    trackGoal('workout_parse_submitted')
    setParseError(null)
    const applyReview = (parsedItems: ParsedWorkoutExercise[], unmatched: UnmatchedView[]) => {
      const manualOnly = clientLime ? [] : items.filter((item) => manualRefs.includes(item.exercise.ref))
      const chosen = unmatched.flatMap((item) => choices[item.line] && !parsedItems.some((parsed) => parsed.line === item.line)
        ? [resolveWorkoutParseChoice(item, choices[item.line]!)]
        : [])
      if (hasUnresolvedWorkoutReviewItems(parsedItems, unmatched, choices)) {
        trackGoal('workout_parse_needs_clarification')
        return false
      }
      if (!parsedItems.length && !manualOnly.length && !chosen.length) {
        trackGoal('workout_parse_failed')
        setParseError('unrecognized')
        return false
      }
      setItems([...manualOnly, ...orderParsedWorkoutItems([...parsedItems, ...chosen])])
      if (clientLime) { setReviewedText(text); setRemovedItem(null); setManualRefs([]); setRemovedRefs([]) }
      setScreen('review')
      trackGoal('workout_parse_completed')
      trackGoal('workout_review_opened')
      return true
    }
    if (lastLlmText === text && (recognized.length > 0 || llmUnmatched.length > 0)) {
      applyReview(recognized, llmUnmatched)
      return
    }
    setParsing(true)
    try {
      const llm = await parseWorkoutWithLlm(text, catalog.exercises, {
        remoteParser: (sourceText, systemCatalog) => exercisesRepository.parseWorkout(sourceText, systemCatalog),
      })
      if (request !== reviewRequest.current) return
      const parsedItems = parsedWorkoutItems(llm, catalog.exercises)
      const unmatched = workoutParseUnmatched(llm, catalog.exercises)
      setLlmUnmatched(unmatched)
      setRecognized(parsedItems)
      setLastLlmText(text)
      applyReview(parsedItems, unmatched)
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
      const llm = await parseWorkoutWithLlm(transcript, catalog.exercises, {
        remoteParser: (sourceText, systemCatalog) => exercisesRepository.parseWorkout(sourceText, systemCatalog),
      })
      if (version !== voiceParseVersion.current) return
      const positionOffset = previousValue.trim() ? previousValue.trim().split('\n').length : 0
      const parsedItems = parsedWorkoutItems(llm, catalog.exercises).map((item) => item.sourcePosition === undefined ? item : { ...item, sourcePosition: item.sourcePosition + positionOffset })
      const unmatched = workoutParseUnmatched(llm, catalog.exercises).map((item) => item.position === undefined ? item : { ...item, position: item.position + positionOffset })
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
          if (clientLime) setReviewedText(normalizedText)
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
    const previous = clientLime ? '' : text
    const value = appendVoiceText(previous, transcript)
    setText(value)
    setParseError(null)
    setVoiceRefinement(null)
    await refineVoiceTranscript(previous, value, transcript, true)
  }

  // Recording may finish from a timer created before a new client draft identity.
  // Resolve against the current session, not the closure from the home screen.
  useEffect(() => () => {
    voiceParseVersion.current += 1
    reviewRequest.current += 1
  }, [])
  const heroTranscriptHandler = useRef(handleHeroTranscript)
  useEffect(() => { heroTranscriptHandler.current = handleHeroTranscript })

  useEffect(() => {
    if (firstIntentConsumed.current || firstWorkoutIntent?.mode !== 'voice') return
    firstIntentConsumed.current = true
    void handleHeroTranscript(firstWorkoutIntent.transcript)
  }, [firstWorkoutIntent])

  function handlePresetSelected(presetId: string) {
    const preset = PRESET_WORKOUTS.find((item) => item.id === presetId)
    if (!preset) return
    setItems(presetWorkoutToParsedItems(preset, catalog.exercises))
    trackGoal('today_preset_workout_selected')
    setScreen('review')
  }

  useEffect(() => {
    if (firstIntentConsumed.current || firstWorkoutIntent?.mode !== 'preset') return
    firstIntentConsumed.current = true
    handlePresetSelected(firstWorkoutIntent.presetId)
  }, [firstWorkoutIntent])

  async function previousResults(selected: ExerciseSnapshot[]): Promise<Map<string, PreviousExerciseResult>> {
    if (!effectiveClientId) return new Map()
    try {
      setPrefillError(null)
      return await workoutsRepository.latestExerciseResults(effectiveClientId, selected.map((exercise) => exercise.ref))
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
      if (clientLime) setReviewedText(text)
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
    setMissingCardioTime(null)
    const ref = items[itemIndex]?.exercise.ref
    if (ref) setManualRefs((current) => current.includes(ref) ? current : [...current, ref])
    const safePatch = patch.rpe === undefined || isValidRpe(patch.rpe) ? patch : { ...patch, rpe: undefined }
    setItems((current) => current.map((item, index) => index !== itemIndex ? item : {
      ...item,
      hasValues: true,
      sets: item.sets.map((set, currentSetIndex) => currentSetIndex === setIndex ? { ...set, ...safePatch,
        metricSources: {
          duration: ('durationSec' in safePatch || 'durationMin' in safePatch) ? 'entered' : set.metricSources?.duration ?? 'unknown',
          distance: 'distanceKm' in safePatch ? 'entered' : set.metricSources?.distance ?? 'unknown',
          rpe: 'rpe' in safePatch ? 'entered' : set.metricSources?.rpe ?? 'unknown',
        },
      } : set),
    }))
  }

  function updateRestBetweenSets(itemIndex: number, restBetweenSetsSec: number) {
    trackGoal('today_review_edited')
    const ref = items[itemIndex]?.exercise.ref
    if (ref) setManualRefs((current) => current.includes(ref) ? current : [...current, ref])
    setItems((current) => current.map((item, index) => index !== itemIndex ? item : {
      ...item,
      structure: { ...item.structure, restBetweenSetsSec: Math.min(600, Math.max(0, restBetweenSetsSec)) },
    }))
  }

  function updateReviewGroupRest(blockId: string, field: 'restBetweenExercisesSec' | 'restBetweenRoundsSec', value: number) {
    const seconds = Number.isFinite(value) ? Math.min(600, Math.max(0, value)) : field === 'restBetweenRoundsSec' ? 90 : 0
    setItems((current) => current.map((item) => item.structure?.blockId === blockId
      ? { ...item, structure: { ...item.structure, [field]: seconds } } : item))
  }

  function addReviewRound(blockId: string) {
    const members = items.filter((item) => item.structure?.blockId === blockId)
    const position = Math.max(0, ...members.flatMap((item) => item.sets.map((set) => set.position + 1)))
    if (members.length < 2 || position >= 20) return
    setItems((current) => current.map((item) => {
      if (item.structure?.blockId !== blockId) return item
      const previous = [...item.sets].sort((left, right) => left.position - right.position).at(-1)
      return { ...item, structure: { ...item.structure, blockRounds: position + 1 },
        sets: [...item.sets, { ...(previous ?? { position }), position }] }
    }))
    setLastAddedReviewRound({ blockId, position })
  }

  async function removeAddedReviewRound(blockId: string, position: number) {
    const members = items.filter((item) => item.structure?.blockId === blockId)
    const removed = members.flatMap((item) => item.sets.filter((set) => set.position === position))
    const hasValues = removed.some((set) => set.weightKg !== undefined || set.reps !== undefined
      || set.durationMin !== undefined || set.durationSec !== undefined || set.distanceKm !== undefined || set.rpe !== undefined)
    if (hasValues && !await askConfirm({ message: 'Убрать круг с заполненными значениями?', confirmLabel: 'Убрать круг', danger: true })) return
    setItems((current) => current.map((item) => item.structure?.blockId === blockId
      ? { ...item, structure: { ...item.structure, blockRounds: Math.max(1, position) },
        sets: item.sets.filter((set) => set.position !== position) } : item))
    setLastAddedReviewRound(null)
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
    setRpeOverrides(new Map())
    setRestOverrides(new Map())
  }

  function undoRemoveExercise() {
    if (!removedItem) return
    trackGoal('today_review_exercise_remove_undone')
    const { item, index } = removedItem
    setItems((current) => {
      if (!clientLime && current.some((currentItem) => currentItem.exercise.ref === item.exercise.ref)) return current
      const next = [...current]
      next.splice(Math.min(index, next.length), 0, item)
      return next
    })
    setRemovedRefs((current) => current.filter((ref) => ref !== item.exercise.ref))
    setRemovedItem(null)
  }

  function moveReviewBlock(itemIndex: number, direction: -1 | 1) {
    trackGoal('today_review_reordered')
    setItems((current) => moveParsedWorkoutReviewBlock(current, itemIndex, direction))
    // Видимость RPE — временная настройка по индексу. После перестановки
    // сбрасываем её, чтобы настройка не прикрепилась к другому упражнению.
    setRpeOverrides(new Map())
    setRestOverrides(new Map())
  }

  function mergeReviewBlock(itemIndex: number) {
    setItems((current) => mergeParsedWorkoutReviewBlockWithNext(current, itemIndex))
    setRpeOverrides(new Map())
    setRestOverrides(new Map())
  }

  async function splitReviewBlock(itemIndex: number) {
    const blockId = items[itemIndex]?.structure?.blockId
    const rest = items.filter((item) => item.structure?.blockId === blockId)
      .map((item) => `${item.exercise.name} — ${item.structure?.restBetweenSetsSec ?? 90} с`).join('; ')
    if (await askConfirm({ message: `Разделить суперсет? Отдых между подходами: ${rest}.`, confirmLabel: 'Разделить' })) {
      setItems((current) => splitParsedWorkoutReviewBlock(current, itemIndex))
    }
  }

  function clearDraftAndForm(openComposer = false) {
    removeTodayDraft(draftKey)
    resetDraftFields(openComposer)
    setScreen('compose')
  }

  function resetDraftFields(openComposer = false) {
    voiceParseVersion.current += 1
    reviewRequest.current += 1
    setParsing(false)
    setParseError(null)
    setVoiceRefinement(null)
    setRestoredClientDraft(false)
    setReviewedText(null)
    setLlmUnmatched([])
    setRemovedItem(null)
    setRpeOverrides(new Map())
    setRestOverrides(new Map())
    setActualDurationMinutes('')
    setLastAddedReviewRound(null)
    if (limePlanning) setPlanMetadata({ title: undefined, endTime: undefined, requestId: crypto.randomUUID(), sourceFormDraftKey: undefined })
    setText('')
    setLastLlmText(null)
    setChoices({})
    setRecognized([])
    setItems([])
    setClientId('')
    setRecordMode('planned')
    setMissingCardioTime(null)
    setWorkoutDate(today)
    setStartTime('')
    setTrainingFormat(clientMode ? 'self' : undefined)
    trainingFormatTouched.current = false
    setManualRefs([])
    setRemovedRefs([])
    setRestoredDraftScreen(null)
    setTextComposerOpen(openComposer)
  }

  function startClientDraft(openComposer: boolean) {
    if (!clientLime) { if (restoredDraftScreen) clearDraftAndForm(openComposer); else setTextComposerOpen(openComposer); return }
    const id = crypto.randomUUID()
    resetDraftFields(openComposer)
    setClientSessionId(id)
    setDraftLoadedKey(clientTodayDraftKey(actor!.userId, id))
    navigate(`/me?draft=${id}`, { state: { newClientDraft: true } })
  }

  const clientDraftCards = clientLime && voicePhase === 'idle' && clientDrafts.length > 0 && <Coachmark id="client-drafts-2026-10" userId={actor?.userId} title="Черновики отдельно" description="Новая тренировка начинается с чистого листа. Прежний ввод можно продолжить здесь.">
    {clientDrafts.map(({ id, draft }) => <section className="today-resume" key={id} aria-label="Черновик плана">
      <span><strong>Черновик плана</strong><small>{draft.items.length ? `${draft.items.length} упражнений` : draft.text.split('\n')[0]?.slice(0, 80)}</small></span>
      <div><button type="button" className="link" onClick={() => {
        setTextComposerOpen(draft.screen === 'compose')
        navigate(`/me?draft=${encodeURIComponent(id)}${draft.screen === 'compose' ? '' : `&view=${draft.screen}`}`)
      }}>Продолжить черновик</button><button type="button" className="link muted" onClick={async () => {
        if (!await askConfirm({ message: 'Удалить этот черновик плана?', confirmLabel: 'Удалить' })) return
        removeTodayDraft(clientTodayDraftKey(actor!.userId, id))
        if (id === clientDraftId) resetDraftFields(false)
        setDraftListVersion((value) => value + 1)
      }}>Удалить черновик</button></div>
    </section>)}
  </Coachmark>

  const plannedWorkouts = todayWorkouts.data?.filter((workout) => workout.status === 'planned').sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '')) ?? []
  function workoutTime(workout: Workout) { return workout.startTime?.slice(0, 5) ?? 'Без времени' }

  const profileInitial = actor?.firstName?.trim().slice(0, 1).toUpperCase() || (clientMode ? 'К' : 'П')
  const latestWorkout = workouts.data?.filter((workout) => workout.status === 'done').sort((a, b) => `${b.workoutDate}${b.startTime ?? ''}`.localeCompare(`${a.workoutDate}${a.startTime ?? ''}`))[0]
  const contextWorkout = plannedWorkouts[0] ?? latestWorkout
  const contextTitle = plannedWorkouts[0] ? 'Ближайшая тренировка' : latestWorkout ? 'Последняя тренировка' : null
  const contextCard = !clientMode && contextWorkout && contextTitle && <section className="today-context"><p>{contextTitle}</p><Link to={`/workouts/${contextWorkout.id}`}><span><strong>{contextWorkout.clientName}</strong><small>{contextWorkout.workoutDate === today ? `Сегодня, ${workoutTime(contextWorkout)}` : contextWorkout.workoutDate}</small></span><span><strong>{contextWorkout.exercises.length ? contextWorkout.exercises.map((exercise) => exercise.name).slice(0, 2).join(', ') : 'Тренировка'}</strong><small>{contextWorkout.exercises.length} упражнений</small></span><ChevronRightIcon /></Link></section>
  const actionItems = !clientMode ? trainerActionItems(clients.data ?? [], workouts.data ?? [], trainerAttention.data ?? [], today) : []
  const actionClientIds = new Set(actionItems.map((item) => item.clientId))
  const planningItems = !clientMode ? trainerPlanningItems(clients.data ?? [], workouts.data ?? [], attentionPreferences.data ?? [], actionClientIds, today) : []
  const trainerHasNoClients = !clientMode && !clients.isLoading && clients.data?.length === 0
  const onlyTrainerClient = clients.data?.length === 1 ? clients.data[0] : undefined
  const firstPlanClient = !clientMode && !clients.isLoading && !workouts.isLoading && onlyTrainerClient
    && !(workouts.data ?? []).some((workout) => workout.clientId === onlyTrainerClient.id)
    ? onlyTrainerClient
    : null
  useEffect(() => {
    if (firstPlanClient && !clientId) setClientId(firstPlanClient.id)
  }, [clientId, firstPlanClient])
  // Пилот приветствия в шапке (feature-flags.ts): та же allowlist, что и для
  // компактной voice-hero карточки — визуальная доводка того же экрана.
  const attentionHideEyebrow = Boolean(actor && isTodayGreetingPilotEnabled(actor.userId))
  const attentionSurface = !clientMode && !trainerHasNoClients && <TrainerAttentionQueue
    actions={actionItems}
    planning={planningItems}
    loading={clients.isLoading || workouts.isLoading || trainerAttention.isLoading || attentionPreferences.isLoading}
    error={trainerAttention.error ?? attentionPreferences.error}
    snoozingClientId={snoozeAttention.isPending ? snoozeAttention.variables : undefined}
    onSnooze={(targetClientId) => snoozeAttention.mutate(targetClientId)}
    hideEyebrow={attentionHideEyebrow}
  />
  const clientHomeError = clientMode ? mine.error ?? workouts.error ?? regularity.error ?? goal.error : null
  const greetingName = clientMode ? mine.data?.fullName || actor?.firstName || 'спортсмен' : actor?.firstName || 'тренер'
  const greeting = `${new Date().getHours() < 12 ? 'Доброе утро' : new Date().getHours() < 18 ? 'Добрый день' : 'Добрый вечер'}, ${greetingName}`
  // Пилот: заголовок вкладки заменяется приветствием в шапке, а дублирующая
  // строка ниже скрывается — так контент поднимается выше. Default-off,
  // allowlist не является границей авторизации (см. feature-flags.ts).
  const greetingHeaderPilotEnabled = Boolean(actor && isTodayGreetingPilotEnabled(actor.userId))

  const header = todayHeaderProps(clientMode, actor)
  const pageTitle = greetingHeaderPilotEnabled ? greeting : header.title
  const supplementalLoadError = catalog.error ?? (!clientMode ? todayWorkouts.error : null)
  return <Page title={pageTitle} hideTitle={header.hideTitle} className="today-page today-start-page" action={<div className="today-header-actions"><ChatHeaderAction />{header.showProfileAvatar && <Link className="today-profile-avatar" to={clientMode ? '/me/profile' : '/profile'} aria-label="Открыть профиль">{profileInitial}</Link>}</div>}>
    {actor && !limePlanning && !(clientLime && requestedClientDraft) && screen === 'compose' && !textComposerOpen && <><AppInstallPrompt userId={actor.userId} /><NotificationOnboarding userId={actor.userId} role={clientMode ? 'client' : 'trainer'} /></>}
    {actor && screen === 'compose' && <YandexAccountLinkingCard actor={actor} />}
    {screen === 'compose' ? <section className={`today-composer today-voice-home voice-phase-${voicePhase}`}>
      {limePlanning ? <div><button type="button" className="link today-review-back" onClick={() => navigate(returnTo)}>← В календарь</button><h1>Составить план</h1><p className="muted">{planMetadata.title || 'Новая тренировка'} · {formatLocalDate(workoutDate)}</p></div> : !greetingHeaderPilotEnabled && !(clientLime && requestedClientDraft) && <p className="today-greeting">{greeting} 👋</p>}
      {clientMode && !textComposerOpen ? <><ClientHomeOverview
        today={today}
        gender={mine.data?.gender}
        workouts={workouts.data}
        regularity={regularity.data}
        goal={goal.data}
        workoutsLoading={mine.isLoading || workouts.isLoading}
        regularityLoading={mine.isLoading || regularity.isLoading}
        error={clientHomeError}
        onRetry={() => {
          void mine.refetch()
          if (mine.data?.id) {
            void workouts.refetch()
            void regularity.refetch()
            void goal.refetch()
          }
        }}
        selfTraining={<section className="client-home-self-training primary">
          <QuickStartWorkout role="client" clientId={mine.data?.id} workouts={workouts.data} loading={mine.isLoading || workouts.isLoading} error={mine.error ?? workouts.error} onRetry={() => { void mine.refetch(); void workouts.refetch() }} returnTo="/me" />
          <div className="today-voice-hero-compact compose-workout-entry">
            <VoiceInputButton
              variant="hero"
              source="today_workout"
              idleLabel="Надиктовать тренировку"
              heroTitle={clientLime ? "Создать новую тренировку" : "Составить тренировку"}
              heroSubtitle="Голосом или вручную"
              onStart={() => startClientDraft(false)}
              onInterimTranscript={clientLime ? (value) => setText(value) : undefined}
              onCancel={clientLime ? () => { voiceParseVersion.current += 1; setVoiceRefinement(null); setTextComposerOpen(true) } : undefined}
              onPhaseChange={setVoicePhase}
              onTranscript={(transcript) => heroTranscriptHandler.current(transcript)}
              secondaryAction={voicePhase === 'idle' ? <button type="button" className="today-voice-text-inline" aria-label="Ввести текстом" onClick={() => startClientDraft(true)}><KeyboardIcon /></button> : undefined}
            />
          </div>
          {clientDraftCards}
          {!clientLime && restoredDraftScreen && voicePhase === 'idle' && <section className="today-resume"><span><strong>Есть незавершённая тренировка</strong><small>Можно продолжить с того же места</small></span><div><button type="button" className="link" onClick={() => { const target = restoredDraftScreen; setRestoredDraftScreen(null); if (target === 'compose') setTextComposerOpen(true); else setScreen(target) }}>Продолжить</button><button type="button" className="link muted" onClick={() => clearDraftAndForm(false)}>Удалить</button></div></section>}
          {clientLime && voiceRefinement?.state === 'loading' && <p className="today-llm-status loading" role="status" aria-live="polite">{voiceRefinement.message}</p>}
          {voiceRefinement?.state === 'error' && <div className="voice-action-error" role="alert"><strong>{voiceRefinement.message}</strong><button type="button" className="link" onClick={() => setTextComposerOpen(true)}>Редактировать текст</button></div>}
        </section>}
        hideActiveNextAction
        showFirstRunConnection={actor?.kind === 'client' && actor.trainerId === actor.userId}
        wearable={actor && isWearablesPilotEnabled(actor.userId) ? <WearableHealthCard /> : undefined}
        trainerDiscovery={mine.data ? <TrainerDiscoveryHomeCard clientId={mine.data.id} /> : undefined}
        presetPrompt={<PresetWorkoutPicker onSelect={handlePresetSelected} />}
      /></> : <>
      {!clientMode && trainerHasNoClients && !textComposerOpen && <TrainerFirstRun creating={firstClientCreating} error={firstClientError} onCreate={createFirstClient} />}
      {!clientMode && firstPlanClient && !textComposerOpen && <TrainerFirstPlanPrompt clientName={firstPlanClient.fullName} />}
      {!clientMode && !limePlanning && !textComposerOpen && <QuickStartWorkout role="trainer" clients={clients.data} workouts={workouts.data} loading={clients.isLoading || workouts.isLoading} error={clients.error ?? workouts.error} onRetry={() => { void clients.refetch(); void workouts.refetch() }} returnTo="/today" />}
      {!textComposerOpen && <div className="today-voice-hero-compact compose-workout-entry">
        <VoiceInputButton
          variant="hero"
          source="today_workout"
          idleLabel="Надиктовать тренировку"
          heroTitle={clientLime ? "Создать новую тренировку" : "Составить тренировку"}
          heroSubtitle="Голосом или вручную"
          onStart={() => { if (restoredDraftScreen && !limePlanning) clearDraftAndForm(false) }}
          onPhaseChange={setVoicePhase}
          onTranscript={(transcript) => heroTranscriptHandler.current(transcript)}
          secondaryAction={voicePhase === 'idle' ? <button type="button" className="today-voice-text-inline" aria-label="Ввести текстом" onClick={() => { if (restoredDraftScreen && !limePlanning) clearDraftAndForm(true); else setTextComposerOpen(true) }}><KeyboardIcon /></button> : undefined}
        />
      </div>}
      {restoredDraftScreen && !textComposerOpen && voicePhase === 'idle' && <section className="today-resume"><span><strong>{limePlanning ? 'Есть черновик плана' : 'Есть незавершённая тренировка'}</strong><small>Можно продолжить с того же места</small></span><div><button type="button" className="link" onClick={() => { const target = restoredDraftScreen; setRestoredDraftScreen(null); if (target === 'compose') setTextComposerOpen(true); else setScreen(target) }}>Продолжить</button><button type="button" className="link muted" onClick={() => clearDraftAndForm(false)}>Удалить</button></div></section>}
      {textComposerOpen && <div className="today-text-fallback"><div className="today-text-fallback-head"><div><strong>{clientLime && restoredClientDraft ? 'Черновик тренировки' : 'Новая тренировка'}</strong><small>Введите упражнения, подходы и значения</small></div><button type="button" className="link" onClick={closeTextComposer}>Скрыть</button></div><WorkoutComposer name="today-workout" source="today_workout" value={text} showVoice={false} onValueChange={(value) => { voiceParseVersion.current += 1; reviewRequest.current += 1; setParsing(false); setText(value); setLastLlmText(null); setParseError(null); setChoices({}); setRecognized([]); setLlmUnmatched([]); setVoiceRefinement(null) }} onTranscriptValueChange={(value) => { setText(value); setParseError(null); setVoiceRefinement(null) }} onTranscriptAppended={({ previousValue, value, transcript }) => refineVoiceTranscript(previousValue, value, transcript)} onClear={() => { setText(''); setParseError(null); setLastLlmText(null); setChoices({}); setRecognized([]); setLlmUnmatched([]); setVoiceRefinement(null) }} primaryAction={<button type="button" className="wide today-primary-cta" disabled={!text.trim() || parsing} onClick={() => void review()}>{parsing ? 'Разбираю тренировку…' : 'Разобрать тренировку'}</button>} secondaryAction={<button type="button" className="link wide today-picker-cta" onClick={() => { trackGoal('exercise_picker_opened'); if (!limePlanning && !clientLime) setItems([]); setPickerFromCompose(true); setPickerOpen(true) }}>Выбрать упражнения вручную</button>}>
      {voiceRefinement && (clientLime || voiceRefinement.state !== 'loading') && <p className={`today-llm-status ${voiceRefinement.state}`} role="status">{voiceRefinement.message}</p>}
      {(resolved.length > 0 || clarification || displayedUnparsed.length > 0) && <div className="today-parse-preview" aria-live="polite">
        {resolved.length > 0 && <section className="today-recognized" aria-label="Распознанные упражнения">
          <p><strong>Распознано: {resolved.length}</strong></p>
          <ul>{resolved.map((item, index) => <li key={`${item.exercise.ref}-${index}`}><strong>{item.exercise.name}</strong><span>{workoutParseSetSummary(item)}</span></li>)}</ul>
        </section>}
        {clarification && <section className="today-clarification" aria-label={clarification.title}><strong>{clarification.title}</strong><p>{clarification.text}</p></section>}
        {displayedUnparsed.map((item) => <div className="today-unparsed" key={item.line}>
          <p>«{item.line}» — {item.reason === 'ambiguous' ? 'выберите вариант' : 'не нашли в каталоге'}</p>
          {item.candidates.length > 0 && <div className="quick-workout-candidates">{item.candidates.map((exercise) => <button type="button" className={choices[item.line]?.ref === exercise.ref ? 'secondary selected' : 'secondary'} key={exercise.ref} onClick={() => { trackGoal('today_parse_candidate_selected'); setChoices((current) => ({ ...current, [item.line]: exercise })); setRecognized((current) => current.some((recognizedItem) => recognizedItem.line === item.line) ? current : orderParsedWorkoutItems([...current, resolveWorkoutParseChoice(item, exercise)])) }}>{exercise.name}</button>)}</div>}
        </div>)}
      </div>}
       {parseError && <WorkoutParseErrorNotice kind={parseError} onRetry={() => void review()} />}
      </WorkoutComposer></div>}
      {voiceRefinement?.state === 'error' && !textComposerOpen && <div className="voice-action-error" role="alert"><strong>{voiceRefinement.message}</strong><button type="button" className="link" onClick={() => setTextComposerOpen(true)}>Редактировать текст</button></div>}
      {!clientMode && !limePlanning && !textComposerOpen && <TrainerActiveWorkouts workouts={workouts.data} returnTo="/today" />}
      {!limePlanning && voicePhase === 'idle' && !restoredDraftScreen && <>{contextCard}{attentionSurface}</>}
      </>}
    </section> : <section className={`today-review workout-focused-page ${screen === 'save' ? 'today-save-step' : ''}`}>
      <div className="today-review-head"><button type="button" className="link today-review-back" onClick={() => { setReordering(false); if (screen === 'review') { trackGoal('today_review_back_to_input'); reviewRequest.current += 1; setParsing(false); setScreen('compose') } else { trackGoal('today_save_back_to_review'); setScreen('review') } }}>{screen === 'review' ? '← Назад' : '← К проверке'}</button><WorkoutHeader eyebrow={screen === 'review' ? 'ПЛАН ТРЕНИРОВКИ' : 'ПОСЛЕДНИЙ ШАГ'} title={screen === 'review' ? 'Проверьте тренировку' : planOnly ? 'Сохраните план' : 'Сохраните тренировку'} state={screen === 'save' && recordMode === 'completed' ? 'completed' : 'planned'} meta={screen === 'review' ? (items.length > 0 ? `Распознано: ${items.length}` : undefined) : planOnly ? 'Проверьте клиента, дату и формат' : 'Выберите вариант и дату'} /></div>
      {screen === 'review' && <>
      {reviewBlocks.length > 1 && <div className="today-review-order-toolbar">{reordering
        ? <div className="reorder-mode"><span>Изменение порядка</span><button type="button" className="link" onClick={() => setReordering(false)}>Готово</button></div>
        : <button type="button" className="link" onClick={() => { trackGoal('today_review_reorder_started'); setReordering(true) }}>Изменить порядок</button>}
      </div>}
      {items.length > 0 ? <div className={`today-exercise-list ${reordering ? 'is-reordering' : ''}`}>{reviewBlocks.map((block, blockIndex) => <div className="today-review-block" key={block.id}>{block.items.length > 1 && <><span className="block-badge">{block.items[0]!.item.structure?.blockPreset === 'interval' ? 'Интервалы' : block.items[0]!.item.structure?.blockPreset === 'circuit' ? 'Круговая' : 'Суперсет'}</span>{block.items[0]!.item.structure?.blockPreset === 'set' && !reordering && <div className="today-review-round-actions">
        <span>Кругов: {Math.max(1, ...block.items.flatMap(({ item }) => item.sets.map((set) => set.position + 1)))}</span>
        <button type="button" className="secondary" disabled={Math.max(1, ...block.items.flatMap(({ item }) => item.sets.map((set) => set.position + 1))) >= 20} onClick={() => addReviewRound(block.id)}>＋ Круг</button>
        {lastAddedReviewRound?.blockId === block.id && <button type="button" className="link" onClick={() => void removeAddedReviewRound(block.id, lastAddedReviewRound.position)}>Убрать добавленный круг</button>}
        <details className="today-review-group-rest"><summary>Отдых в суперсете</summary>
          <label>Между упражнениями, с<input aria-label="Отдых между упражнениями суперсета" type="number" inputMode="numeric" min="0" max="600" key={`${block.id}-exercise-${block.items[0]!.item.structure?.restBetweenExercisesSec ?? 0}`} defaultValue={block.items[0]!.item.structure?.restBetweenExercisesSec ?? 0} onBlur={(event) => updateReviewGroupRest(block.id, 'restBetweenExercisesSec', Number(event.currentTarget.value || 0))} /></label>
          <label>Между кругами, с<input aria-label="Отдых между кругами суперсета" type="number" inputMode="numeric" min="0" max="600" key={`${block.id}-round-${block.items[0]!.item.structure?.restBetweenRoundsSec ?? 90}`} defaultValue={block.items[0]!.item.structure?.restBetweenRoundsSec ?? 90} onBlur={(event) => updateReviewGroupRest(block.id, 'restBetweenRoundsSec', Number(event.currentTarget.value || 0))} /></label>
        </details>
      </div>}</>}{block.items.map(({ item, index }, itemInBlockIndex) => {
        const showRpe = isRpeVisible(index)
        const showRest = isRestVisible(index)
        const nextBlock = reviewBlocks[blockIndex + 1]
        const canMergeNext = itemInBlockIndex === block.items.length - 1 && Boolean(nextBlock && nextBlock.items.length === 1
          && block.items.every(({ item: member }) => member.structure?.blockPreset !== 'interval' && member.structure?.blockPreset !== 'circuit')
          && nextBlock.items[0]!.item.structure?.blockPreset !== 'interval' && nextBlock.items[0]!.item.structure?.blockPreset !== 'circuit' && nextBlock.items[0]!.item.structure?.blockType !== 'group')
        const distanceCapable = !allowsDurationWeight(item.exercise) && (item.exercise.inputKind === 'distance' || (item.exercise.inputKind === 'duration' && (allowsOptionalDistance(item.exercise) || item.sets.some((set) => set.distanceKm !== undefined))))
        const reviewWeightField = (set: WorkoutSetDraft, setIndex: number) => <input className="planned-set-input" aria-label={item.exercise.name + ': вес, подход ' + (setIndex + 1)} type="number" inputMode="decimal" min="0" step="any" value={set.weightKg ?? ''} onFocus={(event) => prepareZeroReplacement(event.currentTarget)} onChange={(event) => updateSet(index, setIndex, { weightKg: event.target.value === '' ? undefined : Number(event.target.value) })} />
        const reorderActions = itemInBlockIndex === 0 ? <span className="block-reorder today-review-order-buttons">
          <button type="button" className="reorder-btn" aria-label={`Переместить блок «${item.exercise.name}» вверх`} disabled={blockIndex === 0} onClick={() => moveReviewBlock(index, -1)}><ArrowUpIcon /></button>
          <button type="button" className="reorder-btn" aria-label={`Переместить блок «${item.exercise.name}» вниз`} disabled={blockIndex === reviewBlocks.length - 1} onClick={() => moveReviewBlock(index, 1)}><ArrowDownIcon /></button>
        </span> : undefined
        return <WorkoutExercise state="planned" className="today-exercise planned-exercise" key={`${item.exercise.ref}-${index}`}>
          <WorkoutExerciseHeader as="header" titleAs="strong" className="today-exercise-title" name={item.exercise.name}
            leading={<ExerciseThumbnail exercise={findCatalogExercise(catalog.exercises, item.exercise) ?? item.exercise} />}
            actions={reordering ? reorderActions : <OverflowMenu label={`Настройки упражнения «${item.exercise.name}»`} items={[
            ...(block.items.length === 1 ? [{ label: showRest ? 'Скрыть отдых' : 'Показать отдых', onClick: () => toggleRest(index) }] : []),
            { label: showRpe ? 'Скрыть RPE' : 'Указать RPE', onClick: () => toggleRpe(index) },
            ...(canMergeNext ? [{ label: block.items.length > 1 ? 'Добавить следующее в суперсет' : 'Создать суперсет со следующим', onClick: () => mergeReviewBlock(index) }] : []),
            ...(block.items.length > 1 && itemInBlockIndex === 0 && item.structure?.blockPreset === 'set' ? [{ label: 'Разделить суперсет', onClick: () => void splitReviewBlock(index) }] : []),
            { label: 'Заменить', onClick: () => { setReplaceIndex(index); setPickerOpen(true) } },
            { label: 'Удалить', danger: true, onClick: () => removeExercise(index) },
          ]} />} />
          <p className={workoutParseSetSummary(item) === 'без значений' ? 'today-exercise-missing' : undefined}>{workoutParseSetSummary(item)}</p>
          {!reordering && <details className="today-exercise-editor">
            <summary>{workoutParseSetSummary(item) === 'без значений' ? 'Добавить значения' : 'Править подходы'}</summary>
            {allowsRepetitionTimeChoice(item.exercise) && <label className="field">Измерение подхода<select aria-label="Измерение подхода" value={item.exercise.inputKind} onChange={(event) => setItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, exercise: { ...entry.exercise, inputKind: event.target.value === 'duration' ? 'duration' : 'strength' } } : entry))}>
              <option value="strength">Кг + повторы</option><option value="duration">Кг + время</option>
            </select></label>}
            {showRest && block.items.length === 1 && <label className="exercise-plan-rest-field">Отдых между подходами, с
              <input key={index + '-' + (item.structure?.restBetweenSetsSec ?? 90)} aria-label={'Отдых между подходами, ' + item.exercise.name} type="number" inputMode="numeric" min="0" max="600" defaultValue={item.structure?.restBetweenSetsSec ?? 90}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={(event) => { const raw = event.currentTarget.value; const next = raw === '' || Number.isNaN(Number(raw)) ? 90 : Math.min(600, Math.max(0, Number(raw))); event.currentTarget.value = String(next); updateRestBetweenSets(index, next) }}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
            </label>}
            <WorkoutSetTable variant="planned" inputKind={distanceCapable ? 'distance' : item.exercise.inputKind} columnLabels={exerciseSetColumnLabels(item.exercise)} layout={distanceCapable || item.exercise.inputKind === 'reps' ? 'full' : 'singleValue'} showRpe={showRpe} className="today-set-list">
              {item.sets.map((set, setIndex) => <WorkoutSetRow state="planned" className={'today-set-editor planned-set ' + (distanceCapable ? 'planned-set-running ' : '') + (showRpe ? 'rpe-visible' : '')} key={set.position}>
                <strong className="workout-set-number planned-set-number">{setIndex + 1}</strong>
                {item.exercise.inputKind === 'strength' && <>
                  {reviewWeightField(set, setIndex)}
                  <label><span className="sr-only">Повт.</span><input className="planned-set-input" aria-label={item.exercise.name + ': повторы, подход ' + (setIndex + 1)} type="number" inputMode="numeric" value={set.reps ?? ''} onFocus={(event) => prepareZeroReplacement(event.currentTarget)} onChange={(event) => updateSet(index, setIndex, { reps: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
                </>}
                {item.exercise.inputKind === 'duration' && !distanceCapable && <>
                  {allowsDurationWeight(item.exercise) && reviewWeightField(set, setIndex)}
                  <WorkoutDurationField className="planned-set-input" label={item.exercise.name + ': время, подход ' + (setIndex + 1)} durationSec={set.durationSec ?? (set.durationMin === undefined ? undefined : Math.round(set.durationMin * 60))} onCommit={(next) => updateSet(index, setIndex, { durationSec: next, durationMin: undefined })} />
                  {!allowsDurationWeight(item.exercise) && <span />}
                </>}
                {item.exercise.inputKind === 'reps' && <>
                  <WorkoutDurationField className="planned-set-input" label={item.exercise.name + ': время, подход ' + (setIndex + 1)} durationSec={set.durationSec ?? (set.durationMin === undefined ? undefined : Math.round(set.durationMin * 60))} onCommit={(next) => updateSet(index, setIndex, { durationSec: next, durationMin: undefined })} />
                  <label><span className="sr-only">Повт.</span><input className="planned-set-input" aria-label={item.exercise.name + ': повторы, подход ' + (setIndex + 1)} type="number" inputMode="numeric" value={set.reps ?? ''} onFocus={(event) => prepareZeroReplacement(event.currentTarget)} onChange={(event) => updateSet(index, setIndex, { reps: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
                </>}
                {distanceCapable && <RunMetricsFields loadField={isLoadedDistance(item.exercise) ? reviewWeightField(set, setIndex) : undefined} idPrefix={'today-run-' + index + '-' + setIndex} rowing={isRowingExerciseRef(item.exercise.ref)} optionalDistance={item.exercise.inputKind === 'duration'} durationSec={set.durationSec ?? (set.durationMin === undefined ? undefined : Math.round(set.durationMin * 60))} distanceKm={set.distanceKm} strokeRate={set.reps} inputClassName="planned-set-input" durationLabel={item.exercise.name + ': время, подход ' + (setIndex + 1)} distanceLabel={item.exercise.name + ': расстояние, подход ' + (setIndex + 1)} distanceUnitLabel={item.exercise.name + ': единица расстояния, подход ' + (setIndex + 1)} onCommit={(patch) => updateSet(index, setIndex, patch)} />}
                {showRpe && <label><span className="sr-only">RPE</span><input className="planned-set-rpe" aria-label={item.exercise.name + ': RPE, подход ' + (setIndex + 1)} type="number" min="1" max="10" step="0.5" inputMode="decimal" value={set.rpe ?? ''} onChange={(event) => updateSet(index, setIndex, { rpe: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}
                {block.items.length === 1 && item.sets.length > 1 && <button type="button" className="link danger planned-set-remove" aria-label={'Удалить подход ' + (setIndex + 1)} onClick={() => removeSet(index, setIndex)}><CloseIcon /></button>}
              </WorkoutSetRow>)}
            </WorkoutSetTable>
            {block.items.length === 1 && <div className="set-add-row"><button type="button" className="secondary today-add-set" onClick={() => addSet(index)}>＋ Подход</button></div>}
          </details>}
        </WorkoutExercise>
      })}</div>)}</div> : <section className="today-empty today-exercise-empty"><p>Добавьте упражнения из каталога — можно выбрать несколько сразу.</p><button type="button" className="secondary wide" onClick={() => { setReplaceIndex(null); setPickerOpen(true) }}>Добавить упражнение</button></section>}
      {items.length > 0 && !reordering && <button type="button" className="secondary wide" onClick={() => { setReplaceIndex(null); setPickerOpen(true) }}>Добавить упражнение</button>}
      {removedItem && <div className="today-undo-remove" role="status"><span>Упражнение удалено</span><button type="button" className="link" onClick={undoRemoveExercise}>Отменить</button></div>}
      {items.length > 0 && !reordering && <WorkoutCta type="button" className="wide today-review-next" onClick={() => { setReordering(false); trackGoal('today_save_step_opened'); setScreen('save') }}>Далее</WorkoutCta>}
      </>}
      {screen === 'save' && <section className="today-assignment">
      {clientMode
        ? effectiveClientId
          ? <p className="today-assignment-self">Тренировка будет сохранена в ваш кабинет</p>
          : mine.isLoading
            ? <p className="today-assignment-self">Проверяем профиль…</p>
            : <div className="error" role="alert">Не удалось открыть профиль спортсмена. <button type="button" className="link" onClick={() => void mine.refetch()}>Повторить</button></div>
        : <ClientPicker userId={actor?.userId} clients={clients.data ?? []} selectedId={clientId} onChange={(id) => { trainingFormatTouched.current = false; setTrainingFormat(undefined); setClientId(id) }} label="Для кого тренировка" loading={clients.isLoading} error={clients.error} onRetry={() => void clients.refetch()} onCreate={createQuickClient} />}
      {(prefillError || save.error) && <p className="error">{prefillError ?? save.error?.message}</p>}
      <section className="today-save-actions" aria-label="Тип записи">
        {planOnly ? <p className="today-plan-summary">{clients.data?.find((client) => client.id === clientId)?.fullName ?? 'Выберите клиента'} · {formatLocalDate(workoutDate)} · {startTime || 'Без времени'} · {trainingFormat === 'with_trainer' ? 'С тренером' : 'Самостоятельно'}</p> : <>
          <p className="today-save-question">Как сохранить?</p>
          <div className="today-record-mode" role="group" aria-label="Как сохранить тренировку"><button type="button" className={recordMode === 'planned' ? 'active' : ''} aria-pressed={recordMode === 'planned'} onClick={() => { setRecordMode('planned'); setMissingCardioTime(null) }}>Запланировать</button><button type="button" className={recordMode === 'completed' ? 'active' : ''} aria-pressed={recordMode === 'completed'} onClick={() => setRecordMode('completed')}>Записать выполненную</button></div>
        </>}
        <div className="split"><label className="today-date-field"><span>Дата</span><input aria-label="Дата тренировки" type="date" value={workoutDate} onChange={(event) => setWorkoutDate(localDate(event.target.value))} required /></label><label className="today-date-field"><span>{recordMode === 'planned' ? 'Время' : 'Время начала'}</span><input aria-label="Время тренировки" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label></div>
        {!clientMode && <div className="today-record-mode" role="group" aria-label="Формат тренировки"><button type="button" className={(trainingFormat ?? 'self') === 'self' ? 'active' : ''} aria-pressed={(trainingFormat ?? 'self') === 'self'} onClick={() => { trainingFormatTouched.current = true; setTrainingFormat('self') }}>Самостоятельно</button><button type="button" className={trainingFormat === 'with_trainer' ? 'active' : ''} aria-pressed={trainingFormat === 'with_trainer'} onClick={() => { trainingFormatTouched.current = true; setTrainingFormat('with_trainer') }}>С тренером</button></div>}
        {recordMode === 'completed' && <WorkoutActualDurationField value={actualDurationMinutes} onChange={setActualDurationMinutes} disabled={save.isPending} />}
        {recordMode === 'completed' && missingCardioTime
          ? <div className="finish-confirm" role="status">
              <p>У «{missingCardioTime}» есть дистанция, но нет фактического времени. Добавьте время на шаге проверки или сохраните результат без оценки активных калорий FIT.</p>
              <div className="actions workout-action-row">
                <WorkoutCta type="button" onClick={() => { setMissingCardioTime(null); setScreen('review') }}>Внести время</WorkoutCta>
                <WorkoutCta type="button" variant="secondary" pending={save.isPending} pendingLabel="Сохраняем…" onClick={() => save.mutate('completed')}>Сохранить без оценки</WorkoutCta>
              </div>
            </div>
          : <WorkoutCta type="button" className="wide" pending={save.isPending} pendingLabel="Сохраняем…" disabled={!items.length || !effectiveClientId} onClick={() => {
              const missing = recordMode === 'completed'
                ? firstCardioDraftMissingEnteredDuration({ exercises: items.map(draftExercise) }) : null
              if (missing) setMissingCardioTime(missing)
              else save.mutate(planOnly ? 'planned' : recordMode)
            }}>{planOnly ? 'Сохранить план' : recordMode === 'planned' ? 'Запланировать тренировку' : 'Записать тренировку'}</WorkoutCta>}
      </section></section>}
    </section>}
    {supplementalLoadError && <InlineRequestError error={supplementalLoadError} />}
    {pickerOpen && <ExercisePicker catalog={catalog} clientRecent={clientRecentExercises} initialMode={replaceIndex === null && items.length === 0 ? 'choose' : 'all'} techniqueActionLabel={replaceIndex === null ? 'Добавить упражнение' : 'Заменить упражнение'} onPick={(exercise, runningFormat) => pickExercises([exercise], runningFormat)} onPickMany={pickExercises} selectionDraft={replaceIndex === null ? pickerSelectionDraft : undefined} onSelectionDraftChange={replaceIndex === null ? setPickerSelectionDraft : undefined} multiple={replaceIndex === null} onClose={() => { setPickerOpen(false); setReplaceIndex(null); setPickerFromCompose(false) }} />}
    {confirmDialog}
  </Page>
}

function TrainerAttentionQueue({ actions, planning, loading, error, snoozingClientId, onSnooze, hideEyebrow }: {
  actions: TrainerActionItem[]
  planning: TrainerPlanningItem[]
  loading: boolean
  error: Error | null
  snoozingClientId?: string
  onSnooze: (clientId: string) => void
  hideEyebrow?: boolean
}) {
  if (loading) return <section id="trainer-attention" className="trainer-attention trainer-attention-loading" aria-label="Задачи по клиентам"><span className="skeleton-line" /><span className="skeleton-line short" /></section>
  if (error) return <InlineRequestError error={error} message="Не удалось загрузить задачи по клиентам." />
  if (!actions.length && !planning.length) return <section id="trainer-attention" className="trainer-attention trainer-attention-clear">{!hideEyebrow && <p className="eyebrow">ПО КЛИЕНТАМ</p>}<strong>Срочных действий нет</strong></section>
  return <section id="trainer-attention" className="trainer-attention" aria-labelledby="trainer-attention-title">
    {actions.length > 0 && <><div className="trainer-attention-heading">{!hideEyebrow && <p className="eyebrow">ПО КЛИЕНТАМ</p>}<h2 id="trainer-attention-title">Требует действия</h2></div><div className="trainer-attention-list">{actions.map((item) => <Link className={`trainer-attention-row reason-${item.reason}`} key={item.clientId} to={`/workouts/${item.workoutId}${item.reason === 'question' ? '?reply=1' : ''}`}>
      <span><strong>{item.clientName}</strong><small>{item.title}</small><em>{item.reason === 'past_plan' ? formatLocalDate(localDate(item.detail)) : item.detail}</em></span><b>{item.actionLabel}</b>
    </Link>)}</div></>}
    {planning.length > 0 && <details className="trainer-planning">
      <summary><span><strong>Проверить планы</strong><small>{planning.length} {planning.length === 1 ? 'клиент' : planning.length < 5 ? 'клиента' : 'клиентов'}</small></span><i aria-hidden="true" /></summary>
      <div className="trainer-planning-list">{planning.map((item) => <article className="trainer-planning-row" key={item.clientId}><span><strong>{item.clientName}</strong><small>{item.title}</small><em>{trainerPlanningDetail(item.detail)}</em></span><div><Link className="link" to={`/workouts/new?client=${item.clientId}`}>Запланировать</Link><button type="button" className="link muted" disabled={snoozingClientId === item.clientId} onClick={() => onSnooze(item.clientId)}>{snoozingClientId === item.clientId ? 'Сохраняем…' : 'Напомнить через 2 недели'}</button></div></article>)}</div>
    </details>}
  </section>
}
