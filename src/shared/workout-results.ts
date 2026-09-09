import type { Workout, WorkoutExercise } from './domain'

export type ResultMetric = 'weight' | 'fixed_reps' | 'volume' | 'reps' | 'duration' | 'distance'
export interface WorkoutResult {
  key: string
  exerciseKey: string
  exerciseName: string
  metric: ResultMetric
  label: string
  unit: string
  value: number
  fixedWeight?: number
  workout: Workout
  previous?: { workout: Workout; value: number }
  state: 'baseline' | 'record' | 'increase' | 'stable' | 'decrease'
}

/** Snapshots carry kg/reps/seconds/km. Exact catalog identity is retained across renames.
 * Never match by title, animation or movement family; distance formats are not PRs.
 */
export function resultExerciseKey(exercise: WorkoutExercise): string {
  return [exercise.source, exercise.customExerciseId || exercise.ref, exercise.inputKind].join(':')
}

export function completedWorkoutOrder(a: Workout, b: Workout): number {
  return a.workoutDate.localeCompare(b.workoutDate)
    || (a.completedAt ?? '').localeCompare(b.completedAt ?? '') || a.id.localeCompare(b.id)
}

const finite = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
export const resultNumber = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })

export function workoutResults(workouts: readonly Workout[]): WorkoutResult[] {
  const history = new Map<string, { last: WorkoutResult; best: number }>()
  const results: WorkoutResult[] = []
  for (const workout of workouts.filter((item) => item.status === 'done').sort(completedWorkoutOrder)) {
    const groups = new Map<string, WorkoutExercise[]>()
    for (const exercise of workout.exercises) {
      if (!exercise.ref) continue
      const key = resultExerciseKey(exercise)
      groups.set(key, [...(groups.get(key) ?? []), exercise])
    }
    for (const [exerciseKey, exercises] of groups) {
      const exercise = exercises[0]!
      const facts = exercises.flatMap((item) => item.sets.filter((set) => set.confirmedAt).map((set) => set.fact))
      const add = (metric: ResultMetric, label: string, unit: string, value: number, fixedWeight?: number) => {
        const key = `${exerciseKey}:${metric}:${fixedWeight ?? ''}`
        const historyKey = `${workout.clientId}:${key}`
        const prior = history.get(historyKey)
        const previous = prior?.last
        const best = prior?.best ?? -Infinity
        const canRecord = exercise.inputKind !== 'distance' && exercise.inputKind !== 'duration'
        const state = !previous ? 'baseline' : value === previous.value ? 'stable'
          : value < previous.value ? 'decrease' : canRecord && value > best ? 'record' : 'increase'
        const result: WorkoutResult = { key, exerciseKey, exerciseName: exercise.name, metric, label, unit, value, fixedWeight, workout,
          previous: previous ? { workout: previous.workout, value: previous.value } : undefined, state }
        results.push(result)
        history.set(historyKey, { last: result, best: Math.max(best, value) })
      }
      if (exercise.inputKind === 'strength') {
        const weighted = facts.filter((fact) => finite(fact.weightKg) && finite(fact.reps) && fact.reps > 0)
        if (weighted.length) {
          add('weight', 'Максимальный вес', 'кг', Math.max(...weighted.map((fact) => fact.weightKg!)))
          for (const weight of [...new Set(weighted.map((fact) => fact.weightKg!))].sort((a, b) => b - a)) {
            add('fixed_reps', `Повторы при ${resultNumber(weight)} кг`, 'повт.', Math.max(...weighted.filter((fact) => fact.weightKg === weight).map((fact) => fact.reps!)), weight)
          }
          if (weighted.length === facts.length) add('volume', 'Объём', 'кг', weighted.reduce((sum, fact) => sum + fact.weightKg! * fact.reps!, 0))
        }
      } else if (exercise.inputKind === 'reps') {
        const values = facts.map((fact) => fact.reps).filter(finite)
        if (values.length) add('reps', 'Максимум повторов', 'повт.', Math.max(...values))
      } else {
        const distance = exercise.inputKind === 'distance'
        const values = facts.map((fact) => distance ? fact.distanceKm : fact.durationSec ?? (finite(fact.durationMin) ? fact.durationMin * 60 : undefined)).filter(finite)
        if (values.length) add(distance ? 'distance' : 'duration', distance ? 'Дистанция' : 'Время', distance ? 'км' : 'сек', values.reduce((a, b) => a + b, 0))
      }
    }
  }
  return results
}

export function latestWorkoutFact(workouts: readonly Workout[], workoutId?: string): { workout?: Workout; result?: WorkoutResult } {
  const workout = workoutId ? workouts.find((item) => item.id === workoutId && item.status === 'done')
    : workouts.filter((item) => item.status === 'done').sort(completedWorkoutOrder).at(-1)
  if (!workout) return {}
  const rank = { record: 0, increase: 1, decrease: 2, stable: 3, baseline: 4 }
  const metrics: ResultMetric[] = ['weight', 'fixed_reps', 'volume', 'reps', 'distance', 'duration']
  const result = workoutResults(workouts).filter((item) => item.workout.id === workout.id)
    .sort((a, b) => rank[a.state] - rank[b.state] || metrics.indexOf(a.metric) - metrics.indexOf(b.metric) || a.key.localeCompare(b.key))[0]
  return { workout, result }
}
