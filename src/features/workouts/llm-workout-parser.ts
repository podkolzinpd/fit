import type { ExerciseSnapshot } from '../../shared/domain'
import { exercisesRepository, type WorkoutParseResponse } from '../../data/repositories/exercises.repository'
import { matchesExplicitWorkoutEquipment, parseQuickWorkoutEntry, splitWorkoutText, workoutCandidates, type ParsedWorkoutExercise } from './quick-workout-entry'

/**
 * Ниже этого порога выбор модели нужно подтвердить. Локальный строгий матчинг
 * имеет confidence=1 и не зависит от самооценки LLM.
 */
export const REQUIRED_EXERCISE_CONFIDENCE = 0.97

export async function parseWorkoutWithLlm(text: string, catalog: readonly ExerciseSnapshot[]) {
  // Сначала отделяем однозначно найденные упражнения. Это даёт LLM и
  // детерминированному парсеру одинаковые исходные строки и не создаёт дублей,
  // когда одна разговорная связка означает два упражнения.
  const preparedText = splitWorkoutText(text, catalog).join('\n')
  const local = localWorkoutParse(preparedText, catalog)
  try {
    const remote = await exercisesRepository.parseWorkout(preparedText, catalog.filter((exercise) => exercise.source === 'system'))
    return requireExerciseConfirmation(mergeWorkoutParse(remote, local, catalog), catalog)
  } catch (error) {
    // Явные названия и числовые значения не должны пропадать только из-за
    // временной ошибки или нестандартного ответа модели. Не угадываем:
    // fallback включается лишь для упражнений, безопасно найденных в каталоге.
    if (local.items.length) return local
    throw error
  }
}

/**
 * Безопасный разбор не должен превращать похожее упражнение в факт тренировки.
 * Для неуверенного выбора показываем текущий вариант вместе с ближайшими из
 * каталога и ждём явного выбора человека.
 */
export function requireExerciseConfirmation(response: WorkoutParseResponse, catalog: readonly ExerciseSnapshot[]): WorkoutParseResponse {
  const byRef = new Map(catalog.map((exercise) => [exercise.ref, exercise]))
  const uncertain = response.items.filter((item) => item.confidence < REQUIRED_EXERCISE_CONFIDENCE)
  if (!uncertain.length) return response
  const unresolved = uncertain.map((item) => {
    const candidates = [item.exerciseRef, ...workoutCandidates(item.sourceText, catalog).map((exercise) => exercise.ref)]
      .filter((ref, index, all) => byRef.has(ref) && all.indexOf(ref) === index)
      .slice(0, 4)
    return { sourceText: item.sourceText, reason: 'Нужно выбрать упражнение: модель не уверена в совпадении', suggestedExerciseRefs: candidates }
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
  const result = parseQuickWorkoutEntry(text, catalog)
  return {
    items: result.parsed.map((item) => ({
      sourceText: item.line,
      exerciseRef: item.exercise.ref,
      confidence: 1,
      sets: localSets(item),
    })),
    unmatched: result.unparsed.map((item) => ({
      sourceText: item.line,
      reason: item.reason === 'ambiguous' ? 'Нужно уточнить вариант упражнения' : 'Не найдено в каталоге',
      suggestedExerciseRefs: item.candidates.map((exercise) => exercise.ref).slice(0, 4),
    })),
  }
}

/**
 * LLM выбирает упражнение и разбирает свободную речь, а локальный парсер
 * гарантирует явно названные числа независимо от их порядка во фразе.
 */
export function mergeWorkoutParse(remote: WorkoutParseResponse, local: WorkoutParseResponse, catalog?: readonly ExerciseSnapshot[]): WorkoutParseResponse {
  const remainingLocal = [...local.items]
  const items = remote.items.map((item) => {
    const key = sourceKey(item.sourceText)
    let localIndex = remainingLocal.findIndex((candidate) => sourceKey(candidate.sourceText) === key)
    if (localIndex < 0) {
      const sameRef = remainingLocal.flatMap((candidate, index) => candidate.exerciseRef === item.exerciseRef ? [index] : [])
      if (sameRef.length === 1 && remote.items.filter((candidate) => candidate.exerciseRef === item.exerciseRef).length === 1) localIndex = sameRef[0]!
    }
    if (localIndex < 0) return item
    const deterministic = remainingLocal.splice(localIndex, 1)[0]!
    return {
      ...item,
      exerciseRef: deterministic.exerciseRef,
      confidence: Math.max(item.confidence, deterministic.confidence),
      sets: deterministic.sets.some((set) => Object.keys(set).length > 0) ? deterministic.sets : item.sets,
    }
  }).concat(remainingLocal)

  const byRef = catalog ? new Map(catalog.map((exercise) => [exercise.ref, exercise])) : null
  const rejectedItems = byRef ? items.filter((item) => {
    const exercise = byRef.get(item.exerciseRef)
    return Boolean(exercise && !matchesExplicitWorkoutEquipment(item.sourceText, exercise))
  }) : []
  const safeItems = rejectedItems.length ? items.filter((item) => !rejectedItems.includes(item)) : items
  const resolvedSources = new Set(safeItems.map((item) => sourceKey(item.sourceText)))
  const unmatched = remote.unmatched
    .filter((item) => !resolvedSources.has(sourceKey(item.sourceText)))
    .concat(local.unmatched.filter((item) => {
      const key = sourceKey(item.sourceText)
      return !resolvedSources.has(key) && !remote.unmatched.some((candidate) => sourceKey(candidate.sourceText) === key)
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
  return response.items.flatMap((item) => {
    const exercise = byRef.get(item.exerciseRef)
    if (!exercise) return []
    const renderedSets = item.sets.map(formatSet).filter(Boolean)
    if (!renderedSets.length) return [exercise.name]
    const sameSets = renderedSets.every((set) => set === renderedSets[0])
    return [`${exercise.name} — ${sameSets ? `${item.sets.length} × ${renderedSets[0]}` : renderedSets.join(', ')}`]
  }).concat(response.unmatched.map((item) => item.sourceText.trim()).filter(Boolean)).join('\n')
}
