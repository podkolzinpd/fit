import type { ExerciseSnapshot } from '../../shared/domain'
import { exercisesRepository, type WorkoutParseResponse } from '../../data/repositories/exercises.repository'
import { matchesExplicitWorkoutEquipment, parseQuickWorkoutEntry, resolveQuickWorkoutLine, splitWorkoutText, workoutCandidates, type ParsedWorkoutExercise } from './quick-workout-entry'
import { selectableExercises } from '../exercises/selectable-exercises'
import { isActiveCatalogExercise } from '../../shared/exercise-catalog-retirement'
import { formatRunDuration, isRowingExerciseRef, rowingPaceLabel, runDistanceLabel, runPaceLabel } from '../../shared/run-metrics'

/**
 * Ниже этого порога выбор модели нужно подтвердить. Локальный строгий матчинг
 * имеет confidence=1 и не зависит от самооценки LLM.
 */
export const REQUIRED_EXERCISE_CONFIDENCE = 0.97

type WorkoutParseOptions = {
  /** По умолчанию любой локальный конфликт требует выбора пользователя. */
  requireLocalDisambiguation?: boolean
  remoteParser?: (
    text: string,
    systemCatalog: readonly ExerciseSnapshot[],
  ) => Promise<WorkoutParseResponse>
}

export async function parseWorkoutWithLlm(text: string, catalog: readonly ExerciseSnapshot[], options: WorkoutParseOptions = {}) {
  catalog = catalog.filter(isActiveCatalogExercise)
  // Сначала отделяем однозначно найденные упражнения. Это даёт LLM и
  // детерминированному парсеру одинаковые исходные строки и не создаёт дублей,
  // когда одна разговорная связка означает два упражнения.
  const preparedText = splitWorkoutText(text, catalog).join('\n')
  const local = localWorkoutParse(preparedText, catalog)
  try {
    const remote = await (options.remoteParser ?? exercisesRepository.parseWorkout)(
      preparedText,
      selectableExercises(catalog).filter((exercise) => exercise.source === 'system'),
    )
    return orderWorkoutParseResponse(requireExerciseConfirmation(mergeWorkoutParse(remote, local, catalog), catalog, options))
  } catch (error) {
    // Явные названия и числовые значения не должны пропадать только из-за
    // временной ошибки или нестандартного ответа модели. Не угадываем:
    // fallback включается лишь для упражнений, безопасно найденных в каталоге.
    if (local.items.length) return orderWorkoutParseResponse(local)
    throw error
  }
}

/**
 * Безопасный разбор не должен превращать похожее упражнение в факт тренировки.
 * Для неуверенного выбора показываем текущий вариант вместе с ближайшими из
 * каталога и ждём явного выбора человека.
 */
export function requireExerciseConfirmation(response: WorkoutParseResponse, catalog: readonly ExerciseSnapshot[], options: WorkoutParseOptions = {}): WorkoutParseResponse {
  const byRef = new Map(catalog.filter(isActiveCatalogExercise).map((exercise) => [exercise.ref, exercise]))
  response = { ...response, unmatched: response.unmatched.map((item) => ({
    ...item, suggestedExerciseRefs: item.suggestedExerciseRefs.filter((ref) => byRef.has(ref)),
  })) }
  // Уверенность модели не отменяет локальный конфликт названия или оборудования:
  // во всех пользовательских входах неоднозначность требует явного выбора.
  const locallyAmbiguousSources = new Set(options.requireLocalDisambiguation !== false ? response.items.flatMap((item) =>
    parseQuickWorkoutEntry(item.sourceText, catalog).unparsed
      .filter((unparsed) => unparsed.reason === 'ambiguous')
      .map((unparsed) => sourceKey(unparsed.line)),
  ) : [])
  const uncertain = response.items.filter((item) =>
    !byRef.has(item.exerciseRef) || item.confidence < REQUIRED_EXERCISE_CONFIDENCE || locallyAmbiguousSources.has(sourceKey(item.sourceText)),
  )
  if (!uncertain.length) return response
  const unresolved = uncertain.map((item) => {
    const candidates = [item.exerciseRef, ...workoutCandidates(item.sourceText, catalog).map((exercise) => exercise.ref)]
      .filter((ref, index, all) => byRef.has(ref) && all.indexOf(ref) === index)
      .slice(0, 4)
    return {
      sourceText: item.sourceText,
      reason: !byRef.has(item.exerciseRef) ? 'Упражнение недоступно в каталоге. Выберите другое или создайте своё.'
        : item.confidence >= REQUIRED_EXERCISE_CONFIDENCE && locallyAmbiguousSources.has(sourceKey(item.sourceText))
        ? 'Нужно уточнить вариант упражнения'
        : 'Нужно выбрать упражнение: модель не уверена в совпадении',
      suggestedExerciseRefs: candidates,
      sets: item.sets,
      ...(item.position === undefined ? {} : { position: item.position }),
    }
  })
  const uncertainSources = new Set(uncertain.map((item) => sourceKey(item.sourceText)))
  return {
    items: response.items.filter((item) => !uncertainSources.has(sourceKey(item.sourceText))),
    unmatched: response.unmatched.concat(unresolved.filter((item) => !response.unmatched.some((existing) => sourceKey(existing.sourceText) === sourceKey(item.sourceText)))),
  }
}

function sourceKey(value: string): string {
  return value.toLocaleLowerCase('ru').replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function localSets(item: ParsedWorkoutExercise): WorkoutParseResponse['items'][number]['sets'] {
  return item.sets.map((set) => ({
    ...(set.weightKg !== undefined ? { weightKg: set.weightKg } : {}),
    ...(set.reps !== undefined ? { reps: set.reps } : {}),
    ...(set.durationSec !== undefined ? { durationMin: set.durationSec / 60 } : {}),
    ...(set.distanceKm !== undefined ? { distanceKm: set.distanceKm } : {}),
  }))
}

function localWorkoutParse(text: string, catalog: readonly ExerciseSnapshot[]): WorkoutParseResponse {
  const items: WorkoutParseResponse['items'] = []
  const unmatched: WorkoutParseResponse['unmatched'] = []
  let position = 0
  for (const segment of splitWorkoutText(text, catalog)) {
    const result = parseQuickWorkoutEntry(segment, catalog)
    for (const item of result.parsed) {
      items.push({ sourceText: item.line, exerciseRef: item.exercise.ref, confidence: 1, sets: localSets(item), position })
      position += 1
    }
    for (const item of result.unparsed) {
      unmatched.push({
        sourceText: item.line,
        reason: item.reason === 'ambiguous' ? 'Нужно уточнить вариант упражнения' : 'Не найдено в каталоге',
        suggestedExerciseRefs: item.candidates.map((exercise) => exercise.ref).slice(0, 4),
        position,
      })
      position += 1
    }
  }
  return { items, unmatched }
}

/**
 * LLM выбирает упражнение и разбирает свободную речь, а локальный парсер
 * гарантирует явно названные числа независимо от их порядка во фразе.
 */
export function mergeWorkoutParse(remote: WorkoutParseResponse, local: WorkoutParseResponse, catalog?: readonly ExerciseSnapshot[]): WorkoutParseResponse {
  const remainingLocal = [...local.items]
  const remainingLocalUnmatched = [...local.unmatched]
  const byRef = catalog ? new Map(catalog.map((exercise) => [exercise.ref, exercise])) : null
  const items = remote.items.map((item) => {
    const key = sourceKey(item.sourceText)
    let localIndex = remainingLocal.findIndex((candidate) => sourceKey(candidate.sourceText) === key)
    if (localIndex < 0) {
      const sameRef = remainingLocal.flatMap((candidate, index) => candidate.exerciseRef === item.exerciseRef ? [index] : [])
      if (sameRef.length === 1 && remote.items.filter((candidate) => candidate.exerciseRef === item.exerciseRef).length === 1) localIndex = sameRef[0]!
    }
    if (localIndex < 0) {
      const exactUnmatched = remainingLocalUnmatched.findIndex((candidate) => sourceKey(candidate.sourceText) === key)
      const candidateMatches = remainingLocalUnmatched.flatMap((candidate, index) => candidate.suggestedExerciseRefs.includes(item.exerciseRef) ? [index] : [])
      const unmatchedIndex = exactUnmatched >= 0 ? exactUnmatched : item.sets.length === 0 && candidateMatches.length === 1 ? candidateMatches[0]! : -1
      if (unmatchedIndex < 0) return item
      const deterministic = remainingLocalUnmatched.splice(unmatchedIndex, 1)[0]!
      const exercise = byRef?.get(item.exerciseRef)
      const recoveredSets = exercise ? localSets(resolveQuickWorkoutLine(deterministic.sourceText, exercise)) : []
      return {
        ...item,
        sets: item.sets.length ? item.sets : recoveredSets,
        ...(deterministic.position === undefined ? {} : { position: deterministic.position }),
      }
    }
    const deterministic = remainingLocal.splice(localIndex, 1)[0]!
    return {
      ...item,
      exerciseRef: deterministic.exerciseRef,
      confidence: Math.max(item.confidence, deterministic.confidence),
      sets: deterministic.sets.some((set) => Object.keys(set).length > 0) ? deterministic.sets : item.sets,
      ...(deterministic.position === undefined ? {} : { position: deterministic.position }),
    }
  }).concat(remainingLocal)

  const rejectedItems = byRef ? items.filter((item) => {
    const exercise = byRef.get(item.exerciseRef)
    return Boolean(exercise && !matchesExplicitWorkoutEquipment(item.sourceText, exercise))
  }) : []
  const safeItems = rejectedItems.length ? items.filter((item) => !rejectedItems.includes(item)) : items
  const resolvedSources = new Set(safeItems.map((item) => sourceKey(item.sourceText)))
  const resolvedPositions = new Set(safeItems.flatMap((item) => item.position === undefined ? [] : [item.position]))
  const positionedRemoteUnmatched = remote.unmatched.map((item) => {
    if (item.position !== undefined) return item
    const localMatch = [...local.items, ...local.unmatched].find((candidate) => sourceKey(candidate.sourceText) === sourceKey(item.sourceText))
    return localMatch?.position === undefined ? item : { ...item, position: localMatch.position }
  })
  const unmatched = positionedRemoteUnmatched
    .filter((item) => !resolvedSources.has(sourceKey(item.sourceText)) && (item.position === undefined || !resolvedPositions.has(item.position)))
    .concat(remainingLocalUnmatched.filter((item) => {
      const key = sourceKey(item.sourceText)
      return !resolvedSources.has(key)
        && (item.position === undefined || !resolvedPositions.has(item.position))
        && !positionedRemoteUnmatched.some((candidate) => sourceKey(candidate.sourceText) === key)
    }))
  const unmatchedSources = new Set(unmatched.map((item) => sourceKey(item.sourceText)))
  for (const item of rejectedItems) {
    const key = sourceKey(item.sourceText)
    if (unmatchedSources.has(key)) continue
    unmatched.push({
      sourceText: item.sourceText,
      reason: 'Нужно уточнить оборудование',
      suggestedExerciseRefs: catalog
        ? workoutCandidates(item.sourceText, catalog).filter((exercise) => matchesExplicitWorkoutEquipment(item.sourceText, exercise)).map((exercise) => exercise.ref).slice(0, 4)
        : [],
    })
    unmatchedSources.add(key)
  }
  return { items: safeItems, unmatched }
}

export type WorkoutParseUnmatchedView = {
  line: string
  reason: 'not-found' | 'ambiguous'
  candidates: ExerciseSnapshot[]
  sets?: WorkoutParseResponse['unmatched'][number]['sets']
  position?: number
}

export function parsedWorkoutItems(response: WorkoutParseResponse, catalog: readonly ExerciseSnapshot[]): ParsedWorkoutExercise[] {
  const byRef = new Map(catalog.map((exercise) => [exercise.ref, exercise]))
  return response.items.flatMap((item) => {
    const exercise = byRef.get(item.exerciseRef)
    if (!exercise) return []
    const parsed = resolveQuickWorkoutLine(item.sourceText, exercise)
    const sets = item.sets.length ? item.sets.map((set, position) => ({
      position,
      weightKg: set.weightKg,
      reps: set.reps,
      ...(typeof set.durationMin === 'number' && set.durationMin > 0 ? { durationSec: Math.round(set.durationMin * 60) } : {}),
      ...(typeof set.distanceKm === 'number' && set.distanceKm > 0 ? { distanceKm: set.distanceKm } : {}),
    })) : [{ position: 0 }]
    return [{
      ...parsed,
      sets,
      hasValues: sets.some((set) => Object.keys(set).some((key) => key !== 'position' && set[key as keyof typeof set] !== undefined)),
      ...(item.position === undefined ? {} : { sourcePosition: item.position }),
    }]
  })
}

export function workoutParseUnmatched(response: WorkoutParseResponse, catalog: readonly ExerciseSnapshot[]): WorkoutParseUnmatchedView[] {
  return response.unmatched.map((item) => ({
    line: item.sourceText,
    reason: /уточнить|выбрать|не уверен/iu.test(item.reason) ? 'ambiguous' : 'not-found',
    candidates: item.suggestedExerciseRefs.flatMap((ref) => catalog.find((exercise) => exercise.ref === ref) ?? []),
    ...(item.sets === undefined ? {} : { sets: item.sets }),
    ...(item.position === undefined ? {} : { position: item.position }),
  }))
}

export function resolveWorkoutParseChoice(item: WorkoutParseUnmatchedView, exercise: ExerciseSnapshot): ParsedWorkoutExercise {
  const parsed = resolveQuickWorkoutLine(item.line, exercise)
  if (!item.sets?.length) return { ...parsed, ...(item.position === undefined ? {} : { sourcePosition: item.position }) }
  const sets = item.sets.map((set, position) => ({
    position,
    weightKg: set.weightKg,
    reps: set.reps,
    ...(typeof set.durationMin === 'number' && set.durationMin > 0 ? { durationSec: Math.round(set.durationMin * 60) } : {}),
    ...(typeof set.distanceKm === 'number' && set.distanceKm > 0 ? { distanceKm: set.distanceKm } : {}),
  }))
  return { ...parsed, sets, hasValues: true, ...(item.position === undefined ? {} : { sourcePosition: item.position }) }
}

export function orderParsedWorkoutItems(items: readonly ParsedWorkoutExercise[]): ParsedWorkoutExercise[] {
  return items.map((item, index) => ({ item, index })).sort((left, right) => {
    const leftPosition = left.item.sourcePosition ?? Number.MAX_SAFE_INTEGER
    const rightPosition = right.item.sourcePosition ?? Number.MAX_SAFE_INTEGER
    return leftPosition - rightPosition || left.index - right.index
  }).map(({ item }) => item)
}

export function workoutParseSetSummary(item: ParsedWorkoutExercise): string {
  const first = item.sets[0]
  if (!item.hasValues || !first) return 'без значений'
  if (item.exercise.inputKind === 'distance') {
    const duration = formatRunDuration(first.durationSec)
    const distance = runDistanceLabel(first.distanceKm)
    const rowing = isRowingExerciseRef(item.exercise.ref)
    const pace = rowing ? rowingPaceLabel(first.durationSec, first.distanceKm) : runPaceLabel(first.durationSec, first.distanceKm)
    const result = [distance, duration, pace ? `темп ${pace}` : null, rowing && first.reps !== undefined ? `${first.reps} гребков/мин` : null].filter(Boolean).join(' · ')
    return `${item.sets.length} × ${result || 'значения'}`
  }
  if (first.durationSec !== undefined) return `${item.sets.length} × ${first.durationSec} сек`
  if (first.distanceKm !== undefined) return `${item.sets.length} × ${first.distanceKm} км`
  const value = [first.weightKg !== undefined ? `${first.weightKg} кг` : '', first.reps !== undefined ? `${first.reps} повт.` : ''].filter(Boolean).join(' × ')
  return `${item.sets.length} × ${value || 'значения'}`
}

function orderWorkoutParseResponse(response: WorkoutParseResponse): WorkoutParseResponse {
  const order = <T extends { position?: number }>(items: T[]) => items.map((item, index) => ({ item, index })).sort((left, right) => {
    const leftPosition = left.item.position ?? Number.MAX_SAFE_INTEGER
    const rightPosition = right.item.position ?? Number.MAX_SAFE_INTEGER
    return leftPosition - rightPosition || left.index - right.index
  }).map(({ item }) => item)
  return { items: order(response.items), unmatched: order(response.unmatched) }
}

function formatSet(set: WorkoutParseResponse['items'][number]['sets'][number]): string {
  const value = [
    set.reps === undefined ? '' : `${set.reps} повт.`,
    set.weightKg === undefined ? '' : `${set.weightKg} кг`,
    typeof set.durationMin === 'number' && set.durationMin > 0 ? `${set.durationMin} мин` : '',
    typeof set.distanceKm === 'number' && set.distanceKm > 0 ? `${set.distanceKm} км` : '',
  ].filter(Boolean)
  return value.join(' × ')
}

/** Каноничная, но редактируемая запись только для уверенно разобранной диктовки. */
export function formatLlmWorkoutText(response: WorkoutParseResponse, catalog: readonly ExerciseSnapshot[]): string {
  const byRef = new Map(catalog.map((exercise) => [exercise.ref, exercise]))
  const entries = [
    ...response.items.map((item, index) => ({ kind: 'item' as const, item, index })),
    ...response.unmatched.map((item, index) => ({ kind: 'unmatched' as const, item, index: response.items.length + index })),
  ].sort((left, right) => (left.item.position ?? Number.MAX_SAFE_INTEGER) - (right.item.position ?? Number.MAX_SAFE_INTEGER) || left.index - right.index)
  return entries.flatMap((entry) => {
    if (entry.kind === 'unmatched') return entry.item.sourceText.trim() ? [entry.item.sourceText.trim()] : []
    const item = entry.item
    const exercise = byRef.get(item.exerciseRef)
    if (!exercise) return []
    const renderedSets = item.sets.map(formatSet).filter(Boolean)
    if (!renderedSets.length) return [exercise.name]
    const sameSets = renderedSets.every((set) => set === renderedSets[0])
    return [`${exercise.name} — ${sameSets ? `${item.sets.length} × ${renderedSets[0]}` : renderedSets.join(', ')}`]
  }).join('\n')
}
