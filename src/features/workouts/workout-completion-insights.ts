import { workoutTonnage } from '../../data/repositories/workouts.repository'
import type { Workout } from '../../shared/domain'
import { resultNumber, type WorkoutResult } from '../../shared/workout-results'

export interface WorkoutVolumeComparison {
  currentTonnage: number
  previousTonnage: number
  changePercent: number
  previousWorkoutDate: string
}

function confirmedStrengthRefs(workout: Workout): Set<string> {
  return new Set(workout.exercises.flatMap((exercise) => (
    exercise.inputKind === 'strength' && exercise.sets.some((set) => Boolean(set.confirmedAt))
      ? [exercise.ref]
      : []
  )))
}

function comparisonOrder(workout: Workout): string {
  return workout.completedAt ?? `${workout.workoutDate}T00:00:00`
}

export function workoutVolumeComparison(
  current: Workout,
  candidates: readonly Workout[],
): WorkoutVolumeComparison | null {
  const currentTonnage = workoutTonnage(current)
  const currentRefs = confirmedStrengthRefs(current)
  const currentOrder = comparisonOrder(current)
  if (currentTonnage <= 0 || currentRefs.size === 0) return null

  const previous = candidates
    .filter((candidate) => candidate.id !== current.id && candidate.status === 'done')
    .filter((candidate) => candidate.workoutDate <= current.workoutDate)
    .filter((candidate) => comparisonOrder(candidate) < currentOrder)
    .filter((candidate) => {
      const candidateRefs = confirmedStrengthRefs(candidate)
      const overlap = [...currentRefs].filter((ref) => candidateRefs.has(ref)).length
      return overlap / currentRefs.size >= 0.5
        && overlap / candidateRefs.size >= 0.5
        && workoutTonnage(candidate) > 0
    })
    .sort((left, right) => comparisonOrder(right).localeCompare(comparisonOrder(left)))[0]

  if (!previous) return null
  const previousTonnage = workoutTonnage(previous)
  return {
    currentTonnage,
    previousTonnage,
    changePercent: Math.round(((currentTonnage - previousTonnage) / previousTonnage) * 100),
    previousWorkoutDate: previous.workoutDate,
  }
}

export function workoutResultDeltaLabel(result: WorkoutResult): string | null {
  if (!result.previous) return null
  const change = result.value - result.previous.value
  if (change <= 0) return null
  return `+${resultNumber(change)} ${result.unit} к прошлому результату`
}
