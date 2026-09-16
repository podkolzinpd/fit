import { createHash } from 'node:crypto'
import { PROGRAM_CATALOG } from './catalog.js'

export const PROGRAM_CONTEXT_VERSION = 'program-context-v2'
export const PROGRAM_WEEKS = 4
export type ProgramFrequency = 1 | 2 | 3

export function programSessionCount(frequency: ProgramFrequency): number {
  if (![1, 2, 3].includes(frequency)) throw new Error('invalid_program_frequency')
  return frequency * PROGRAM_WEEKS
}

export interface ProgramWorkoutSource {
  id: string
  clientId: string
  date: string
  status: 'planned' | 'done' | 'cancelled'
  deletedAt: string | null
  sessionRpe: number | null
  wellbeing: 'good' | 'normal' | 'hard' | null
  discomfort: boolean | null
}

export interface ProgramExerciseSource {
  id: string
  workoutId: string
  source: 'system' | 'custom'
  ref: string
  position: number
}

export interface ProgramSetSource {
  id: string
  exerciseId: string
  position: number
  confirmedAt: string | null
  factReps: number | null
  factWeightKg: number | null
  factDurationSec: number | null
  factDistanceKm: number | null
  factRpe: number | null
}

/** Adapters must authorize the actor and reject truncated reads before calling. */
export interface ProgramContextSource {
  clientId: string
  periodStart: string
  periodEnd: string
  workouts: readonly ProgramWorkoutSource[]
  exercises: readonly ProgramExerciseSource[]
  sets: readonly ProgramSetSource[]
}

interface ConfirmedSet {
  reps: number | null
  weightKg: number | null
  durationSec: number | null
  distanceKm: number | null
  rpe: number | null
}

export interface ProgramHistoryContext {
  version: typeof PROGRAM_CONTEXT_VERSION
  periodStart: string
  periodEnd: string
  completedWorkouts: number
  lastCompletedDate: string | null
  weeklyActivity: { weekStart: string; completedWorkouts: number; confirmedSets: number }[]
  /** All completed sessions, before the per-exercise recent-execution limit. */
  loadEvidence: { date: string; catalogSets: number; unmappedSets: number }[]
  feedback: {
    reportedWorkouts: number
    missingWorkouts: number
    discomfortDates: string[]
    hardDates: string[]
    meanSessionRpe: number | null
  }
  exercises: {
    source: 'system' | 'custom'
    ref: string
    sessions: number
    confirmedSets: number
    recentExecutions: { date: string; sets: ConfirmedSet[] }[]
  }[]
  gaps: ('no_completed_workouts' | 'no_confirmed_sets' | 'incomplete_feedback' | 'confirmed_set_without_values')[]
}

const dayMs = 86_400_000

function dateMs(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed)
    || new Date(parsed).toISOString().slice(0, 10) !== value) throw new Error('invalid_program_source_date')
  return parsed
}

function monday(value: string): string {
  const date = new Date(dateMs(value))
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
  return date.toISOString().slice(0, 10)
}

function unique<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  const map = new Map<string, T>()
  for (const row of rows) {
    if (!row.id || map.has(row.id)) throw new Error('duplicate_program_source_row')
    map.set(row.id, row)
  }
  return map
}

function numericFact(value: number | null, max: number, integer = false): number | null {
  if (value === null) return null
  if (!Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) {
    throw new Error('invalid_program_source_fact')
  }
  return value
}

function confirmedSet(row: ProgramSetSource): ConfirmedSet {
  return {
    reps: numericFact(row.factReps, 100_000, true),
    weightKg: numericFact(row.factWeightKg, 10_000),
    durationSec: numericFact(row.factDurationSec, 604_800),
    distanceKm: numericFact(row.factDistanceKm, 10_000),
    rpe: numericFact(row.factRpe, 10),
  }
}

/** Pure facts only: no plan values, clinical inference, names or private notes. */
export function buildProgramHistoryContext(source: ProgramContextSource): {
  fingerprint: string
  context: ProgramHistoryContext
} {
  const start = dateMs(source.periodStart)
  const end = dateMs(source.periodEnd)
  if (!source.clientId || end < start || end - start > 365 * dayMs) throw new Error('invalid_program_source_period')
  const allWorkouts = unique(source.workouts)
  const allExercises = unique(source.exercises)
  unique(source.sets)
  for (const workout of source.workouts) {
    if (workout.clientId !== source.clientId) throw new Error('program_source_client_mismatch')
    dateMs(workout.date)
  }
  if (source.exercises.some((exercise) => !allWorkouts.has(exercise.workoutId))
    || source.sets.some((set) => !allExercises.has(set.exerciseId))) throw new Error('orphan_program_source_row')

  const workouts = source.workouts.filter((row) => row.status === 'done' && row.deletedAt === null
    && row.date >= source.periodStart && row.date <= source.periodEnd)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const workoutsById = new Map(workouts.map((row) => [row.id, row]))
  const catalog = new Map(PROGRAM_CATALOG.map((row) => [row.ref, row]))
  const loadByWorkout = new Map(workouts.map((row) => [row.id, { date: row.date, catalogSets: 0, unmappedSets: 0 }]))
  const weeks = new Map<string, ProgramHistoryContext['weeklyActivity'][number]>()
  for (let day = dateMs(monday(source.periodStart)); day <= end; day += 7 * dayMs) {
    const weekStart = new Date(day).toISOString().slice(0, 10)
    weeks.set(weekStart, { weekStart, completedWorkouts: 0, confirmedSets: 0 })
  }
  for (const workout of workouts) weeks.get(monday(workout.date))!.completedWorkouts += 1

  const confirmedByExercise = new Map<string, ProgramSetSource[]>()
  for (const row of source.sets) {
    if (row.confirmedAt === null) continue
    if (!Number.isFinite(Date.parse(row.confirmedAt))) throw new Error('invalid_program_source_confirmation')
    const rows = confirmedByExercise.get(row.exerciseId) ?? []
    rows.push(row)
    confirmedByExercise.set(row.exerciseId, rows)
  }

  const byRef = new Map<string, {
    source: 'system' | 'custom'; ref: string; workoutIds: Set<string>; confirmedSets: number
    executions: Map<string, { date: string; sets: ConfirmedSet[] }>
  }>()
  let confirmedWithoutValues = false
  const exercises = [...source.exercises].sort((a, b) => a.workoutId.localeCompare(b.workoutId)
    || a.position - b.position || a.id.localeCompare(b.id))
  for (const exercise of exercises) {
    const workout = workoutsById.get(exercise.workoutId)
    if (!workout) continue
    const sets = (confirmedByExercise.get(exercise.id) ?? []).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map(confirmedSet)
    if (!sets.length) continue
    if (!exercise.ref) throw new Error('invalid_program_source_exercise')
    const metadata = exercise.source === 'system' ? catalog.get(exercise.ref) : undefined
    const evidence = loadByWorkout.get(workout.id)!
    if (!metadata) evidence.unmappedSets += sets.length
    else if (metadata.movement !== 'aerobic') evidence.catalogSets += sets.filter((set) => metadata.inputKind === 'duration'
      ? set.durationSec !== null && set.durationSec > 0
      : set.reps !== null && set.reps > 0).length
    if (sets.some((set) => set.reps === null && set.durationSec === null && set.distanceKm === null)) confirmedWithoutValues = true
    const key = `${exercise.source}:${exercise.ref}`
    const aggregate = byRef.get(key) ?? {
      source: exercise.source, ref: exercise.ref, workoutIds: new Set<string>(), confirmedSets: 0,
      executions: new Map<string, { date: string; sets: ConfirmedSet[] }>(),
    }
    aggregate.workoutIds.add(workout.id)
    aggregate.confirmedSets += sets.length
    const execution = aggregate.executions.get(workout.id) ?? { date: workout.date, sets: [] }
    execution.sets.push(...sets)
    aggregate.executions.set(workout.id, execution)
    byRef.set(key, aggregate)
    weeks.get(monday(workout.date))!.confirmedSets += sets.length
  }

  const feedback = workouts.filter((row) => row.sessionRpe !== null && row.wellbeing !== null && row.discomfort !== null)
  const rpes = workouts.flatMap((row) => row.sessionRpe === null ? [] : [numericFact(row.sessionRpe, 10)!])
  const gaps: ProgramHistoryContext['gaps'] = []
  if (!workouts.length) gaps.push('no_completed_workouts')
  if (!byRef.size) gaps.push('no_confirmed_sets')
  if (feedback.length < workouts.length) gaps.push('incomplete_feedback')
  if (confirmedWithoutValues) gaps.push('confirmed_set_without_values')
  const context: ProgramHistoryContext = {
    version: PROGRAM_CONTEXT_VERSION,
    periodStart: source.periodStart, periodEnd: source.periodEnd,
    completedWorkouts: workouts.length,
    lastCompletedDate: workouts.at(-1)?.date ?? null,
    weeklyActivity: [...weeks.values()],
    loadEvidence: [...loadByWorkout.values()],
    feedback: {
      reportedWorkouts: feedback.length, missingWorkouts: workouts.length - feedback.length,
      discomfortDates: [...new Set(workouts.filter((row) => row.discomfort === true).map((row) => row.date))],
      hardDates: [...new Set(workouts.filter((row) => row.wellbeing === 'hard').map((row) => row.date))],
      meanSessionRpe: rpes.length ? Math.round(rpes.reduce((a, b) => a + b, 0) / rpes.length * 10) / 10 : null,
    },
    exercises: [...byRef.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => ({
      source: row.source, ref: row.ref, sessions: row.workoutIds.size, confirmedSets: row.confirmedSets,
      recentExecutions: [...row.executions.entries()]
        .sort(([idA, a], [idB, b]) => b.date.localeCompare(a.date) || idA.localeCompare(idB))
        .slice(0, 3).map(([, execution]) => execution),
    })),
    gaps,
  }
  // Identity belongs in the cache key, never in the model-facing facts.
  const selectedExercises = exercises.filter((row) => workoutsById.has(row.workoutId))
  const selectedExerciseIds = new Set(selectedExercises.map((row) => row.id))
  const fingerprint = createHash('sha256').update(JSON.stringify({
    clientId: source.clientId, context, workouts, exercises: selectedExercises,
    sets: source.sets.filter((row) => selectedExerciseIds.has(row.exerciseId) && row.confirmedAt !== null)
      .sort((a, b) => a.id.localeCompare(b.id)),
  })).digest('hex')
  return { fingerprint, context }
}
