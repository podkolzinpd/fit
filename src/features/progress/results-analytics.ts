import type { Workout } from '../../shared/domain'
import { addDays, type LocalDate } from '../../shared/local-date'
import { resultExerciseKey, type WorkoutResult } from '../../shared/workout-results'
import { loadBodyMap } from './body-progress-map'
import { mondayStart } from './workout-regularity-progress'

export function weeklySetDistribution(workouts: readonly Workout[], start: LocalDate, end: LocalDate, today: LocalDate) {
  const effectiveEnd = end < today ? end : today
  const weeks = []
  for (let week = mondayStart(start); week <= effectiveEnd; week = addDays(week, 7)) {
    const from = week < start ? start : week
    const fullEnd = addDays(week, 6)
    const to = fullEnd > effectiveEnd ? effectiveEnd : fullEnd
    const data = loadBodyMap(workouts, from, to)
    weeks.push({ week, start: from, end: to, partial: from !== week || to !== fullEnd, ...data.coverage, regions: data.regions })
  }
  return weeks
}

const finite = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
export function workoutVolumeDetails(workout: Workout, exerciseKey: string) {
  const exercises = workout.exercises.filter((exercise) => resultExerciseKey(exercise) === exerciseKey && exercise.inputKind === 'strength')
  const facts = exercises.flatMap((exercise) => exercise.sets.filter((set) => set.confirmedAt).map((set) => set.fact))
  if (!facts.length || facts.some((fact) => !finite(fact.weightKg) || !finite(fact.reps) || fact.reps <= 0)) return null
  const sets = facts.map((fact) => ({ weight: fact.weightKg!, reps: fact.reps! }))
  return { count: sets.length, reps: sets.reduce((sum, set) => sum + set.reps, 0),
    minWeight: Math.min(...sets.map((set) => set.weight)), maxWeight: Math.max(...sets.map((set) => set.weight)),
    volume: sets.reduce((sum, set) => sum + set.weight * set.reps, 0), sets,
    combinations: sets.map((set) => `${set.weight}:${set.reps}`).sort().join('|') }
}

export function volumeChangeDetails(result: WorkoutResult) {
  if (result.metric !== 'volume' || !result.previous) return null
  const before = workoutVolumeDetails(result.previous.workout, result.exerciseKey)
  const after = workoutVolumeDetails(result.workout, result.exerciseKey)
  if (!before || !after) return null
  const changed: string[] = []
  if (before.count !== after.count) changed.push('число подходов')
  if (before.reps !== after.reps) changed.push('сумма повторов')
  if (before.minWeight !== after.minWeight || before.maxWeight !== after.maxWeight) changed.push('записанные веса')
  if (!changed.length && before.combinations !== after.combinations) changed.push('сочетания веса и повторов в подходах')
  return { before, after, changed }
}
