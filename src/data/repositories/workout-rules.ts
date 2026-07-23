import type { ClientStats, InputKind, Workout, WorkoutDraft, WorkoutSet, WorkoutSummary } from '../../shared/domain'
import type { LocalDate } from '../../shared/local-date'
import { MUSCLE_GROUP_LABELS } from '../../shared/system-exercises'

export interface ExerciseChartPoint {
  date: LocalDate
  value: number
}

// Upcoming = not yet done and dated today or later, nearest first.
// History = everything else (done, or planned in the past), most recent first.
export function splitClientWorkouts(workouts: Workout[], today: LocalDate): { upcoming: Workout[]; history: Workout[] } {
  const upcoming = workouts
    .filter((workout) => workout.status !== 'done' && workout.workoutDate >= today)
    .sort((a, b) => (a.workoutDate < b.workoutDate ? -1 : a.workoutDate > b.workoutDate ? 1 : 0))
  const history = workouts
    .filter((workout) => workout.status === 'done' || workout.workoutDate < today)
    .sort((a, b) => (a.workoutDate > b.workoutDate ? -1 : a.workoutDate < b.workoutDate ? 1 : 0))
  return { upcoming, history }
}

const ATTENTION_DAYS = 14

function daysBetween(from: LocalDate, to: LocalDate): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const start = Date.UTC(fy ?? 0, (fm ?? 1) - 1, fd)
  const end = Date.UTC(ty ?? 0, (tm ?? 1) - 1, td)
  return Math.round((end - start) / 86_400_000)
}

export function computeClientStats(summaries: WorkoutSummary[], today: LocalDate): ClientStats {
  const done = summaries.filter((workout) => workout.status === 'done')
  const missed = summaries.filter(
    (workout) => workout.status === 'planned' && workout.workoutDate < today,
  )

  const lastWorkoutDate = done.reduce<LocalDate | null>(
    (latest, workout) => (latest === null || workout.workoutDate > latest ? workout.workoutDate : latest),
    null,
  )
  const firstWorkoutDate = summaries.reduce<LocalDate | null>(
    (earliest, workout) => (earliest === null || workout.workoutDate < earliest ? workout.workoutDate : earliest),
    null,
  )

  const denominator = done.length + missed.length
  const completionPercent = denominator === 0 ? null : Math.round((done.length / denominator) * 100)
  const daysInWork = firstWorkoutDate === null ? null : Math.max(0, daysBetween(firstWorkoutDate, today))
  const needsAttention = lastWorkoutDate !== null && daysBetween(lastWorkoutDate, today) >= ATTENTION_DAYS

  return { doneCount: done.length, completionPercent, lastWorkoutDate, daysInWork, needsAttention }
}

// Actual workout duration by the timer (start → finish), as "42 мин" or
// "1 ч 05 мин". Returns null when timestamps are missing or non-positive.
export function workoutDurationLabel(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null
  const ms = Date.parse(completedAt) - Date.parse(startedAt)
  if (!Number.isFinite(ms) || ms <= 0) return null
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} мин`
  return `${hours} ч ${String(minutes).padStart(2, '0')} мин`
}

export function chartUnitFor(inputKind: InputKind): string {
  if (inputKind === 'distance') return 'км'
  if (inputKind === 'reps') return 'повт.'
  return 'кг'
}

// Ordered, de-duplicated muscle-group labels for a workout's exercises.
export function muscleGroupLabels(workout: Workout): string[] {
  const seen = new Set<string>()
  const labels: string[] = []
  for (const exercise of workout.exercises) {
    const label = MUSCLE_GROUP_LABELS[exercise.muscleGroup]
    if (!seen.has(label)) { seen.add(label); labels.push(label) }
  }
  return labels
}

// Body Mass Index = weight(kg) / height(m)². Null when data is missing/invalid.
export function bmiValue(heightCm: number, weightKg: number | null): number | null {
  if (!weightKg || weightKg <= 0 || !heightCm || heightCm <= 0) return null
  const meters = heightCm / 100
  return weightKg / (meters * meters)
}

export function bmiLabel(heightCm: number, weightKg: number | null): string {
  const value = bmiValue(heightCm, weightKg)
  return value === null ? '—' : value.toFixed(1)
}

// Total lifted volume (tonnage) over a workout: Σ weight × reps for every set
// of strength exercises, using the actual result and falling back to the plan.
export function workoutTonnage(workout: Workout): number {
  let total = 0
  for (const exercise of workout.exercises) {
    if (exercise.inputKind !== 'strength') continue
    for (const set of exercise.sets) {
      const weight = set.fact.weightKg ?? set.weightKg
      const reps = set.fact.reps ?? set.reps
      if (weight && reps) total += weight * reps
    }
  }
  return total
}

// Compact tonnage label, e.g. "1 250 кг" (or "1.2 т" once past a tonne).
export function tonnageLabel(kg: number): string {
  if (kg <= 0) return '—'
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} т`
  return `${Math.round(kg)} кг`
}

// Actual result if recorded, otherwise the plan — so completed workouts
// marked done without live fact entry still appear on the chart.
function setMetric(inputKind: InputKind, set: WorkoutSet): number | undefined {
  if (inputKind === 'distance') return set.fact.distanceKm ?? set.distanceKm
  if (inputKind === 'reps') return set.fact.reps ?? set.reps
  return set.fact.weightKg ?? set.weightKg
}

// Best result per completed workout for one exercise, oldest first, for the
// progression chart. Only done workouts; workouts without any value skipped.
export function exerciseChartPoints(workouts: Workout[], exerciseRef: string): ExerciseChartPoint[] {
  return workouts
    .filter((workout) => workout.status === 'done')
    .map((workout) => {
      const exercise = workout.exercises.find((item) => item.ref === exerciseRef)
      if (!exercise) return null
      const values = exercise.sets
        .map((set) => setMetric(exercise.inputKind, set))
        .filter((value): value is number => value !== undefined)
      if (values.length === 0) return null
      return { date: workout.workoutDate, value: Math.max(...values) }
    })
    .filter((point): point is ExerciseChartPoint => point !== null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

export function copyWorkout(source: Workout, workoutDate = source.workoutDate): WorkoutDraft {
  return {
    clientId: source.clientId, workoutDate, startTime: source.startTime ?? undefined,
    endTime: source.endTime ?? undefined, notes: source.notes ?? undefined,
    exercises: source.exercises.map((exercise) => ({
      source: exercise.source, ref: exercise.ref, customExerciseId: exercise.customExerciseId,
      name: exercise.name, muscleGroup: exercise.muscleGroup, inputKind: exercise.inputKind,
      position: exercise.position,
      sets: exercise.sets.map((set) => ({ position: set.position, weightKg: set.weightKg,
        reps: set.reps, durationMin: set.durationMin, distanceKm: set.distanceKm })),
    })),
  }
}

export function canTransition(from: Workout['status'], to: Workout['status']): boolean {
  return (from === 'planned' && to === 'in_progress') || (from === 'in_progress' && to === 'done')
}
