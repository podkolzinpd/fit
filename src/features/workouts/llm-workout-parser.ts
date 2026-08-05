import type { ExerciseSnapshot } from '../../shared/domain'
import { exercisesRepository, type WorkoutParseResponse } from '../../data/repositories/exercises.repository'

export async function parseWorkoutWithLlm(text: string, catalog: readonly ExerciseSnapshot[]) {
  return exercisesRepository.parseWorkout(text, catalog.filter((exercise) => exercise.source === 'system'))
}

function formatSet(set: WorkoutParseResponse['items'][number]['sets'][number]): string {
  const value = [
    set.reps === undefined ? '' : `${set.reps} повт.`,
    set.weightKg === undefined ? '' : `${set.weightKg} кг`,
    set.durationMin === undefined ? '' : `${set.durationMin} мин`,
    set.distanceKm === undefined ? '' : `${set.distanceKm} км`,
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
