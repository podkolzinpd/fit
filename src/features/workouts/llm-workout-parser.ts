import type { ExerciseSnapshot } from '../../shared/domain'
import { exercisesRepository, type WorkoutParseResponse } from '../../data/repositories/exercises.repository'
import { parseQuickWorkoutEntry, splitWorkoutText, type ParsedWorkoutExercise } from './quick-workout-entry'

export async function parseWorkoutWithLlm(text: string, catalog: readonly ExerciseSnapshot[]) {
  // Сначала отделяем однозначно найденные упражнения. Это даёт LLM и
  // детерминированному парсеру одинаковые исходные строки и не создаёт дублей,
  // когда одна разговорная связка означает два упражнения.
  const preparedText = splitWorkoutText(text, catalog).join('\n')
  const local = localWorkoutParse(preparedText, catalog)
  try {
    const remote = await exercisesRepository.parseWorkout(preparedText, catalog.filter((exercise) => exercise.source === 'system'))
    return mergeWorkoutParse(remote, local)
  } catch (error) {
    // Явные названия и числовые значения не должны пропадать только из-за
    // временной ошибки или нестандартного ответа модели. Не угадываем:
    // fallback включается лишь для упражнений, безопасно найденных в каталоге.
    if (local.items.length) return local
    throw error
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
export function mergeWorkoutParse(remote: WorkoutParseResponse, local: WorkoutParseResponse): WorkoutParseResponse {
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

  const resolvedSources = new Set(items.map((item) => sourceKey(item.sourceText)))
  const unmatched = remote.unmatched
    .filter((item) => !resolvedSources.has(sourceKey(item.sourceText)))
    .concat(local.unmatched.filter((item) => {
      const key = sourceKey(item.sourceText)
      return !resolvedSources.has(key) && !remote.unmatched.some((candidate) => sourceKey(candidate.sourceText) === key)
    }))
  return { items, unmatched }
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
