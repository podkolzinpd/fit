import type { ExerciseSnapshot } from './domain'

// Reviewed machines where the display may expose distance, but the exercise
// itself is valid with time alone. Do not infer this from a name, muscle group,
// or the presence of a machine: holds, on-the-spot cardio and step counts are
// not kilometres. A custom exercise can choose the existing distance kind to
// record both measurements without a schema change.
export const OPTIONAL_DISTANCE_EXERCISE_REFS = [
  'vital-air-bike-sprint',
  'vital-stair-climber',
  'vital-stepper-machine',
  'vital-gym-pro-r189-1331',
  'vital-gym-pro-r191-1333',
] as const

const optionalDistanceRefs: ReadonlySet<string> = new Set(OPTIONAL_DISTANCE_EXERCISE_REFS)

export function allowsOptionalDistance(exercise: Pick<ExerciseSnapshot, 'source' | 'ref' | 'inputKind'>): boolean {
  return exercise.inputKind === 'duration' && exercise.source === 'system' && optionalDistanceRefs.has(exercise.ref)
}

export const LOADED_DISTANCE_EXERCISE_REFS = [
  'farmer-carry', 'sled-push', 'fedb-prowler-sprint', 'fedb-sled-drag-harness',
] as const
const loadedDistanceRefs: ReadonlySet<string> = new Set(LOADED_DISTANCE_EXERCISE_REFS)
const loadedDurationRefs: ReadonlySet<string> = new Set([
  'vital-barbell-hold-ex010', 'vital-gym-pro-r003-0006',
  'vital-gym-pro-r289-1625', 'vital-gym-pro-r303-1645',
])

type ExerciseMeasurements = Pick<ExerciseSnapshot, 'source' | 'ref' | 'inputKind'>

export function isLoadedDistance(exercise: ExerciseMeasurements): boolean {
  return exercise.source === 'system' && exercise.inputKind === 'distance' && loadedDistanceRefs.has(exercise.ref)
}

export function allowsDurationWeight(exercise: ExerciseMeasurements): boolean {
  return exercise.source === 'system' && exercise.inputKind === 'duration' && loadedDurationRefs.has(exercise.ref)
}

export function allowsRepetitionTimeChoice(exercise: ExerciseMeasurements): boolean {
  return exercise.source === 'system' && exercise.ref === 'vital-gym-pro-r303-1645'
    && (exercise.inputKind === 'strength' || exercise.inputKind === 'duration')
}

export function exerciseSetColumnLabels(exercise: ExerciseMeasurements): readonly string[] | undefined {
  if (isLoadedDistance(exercise)) return ['Кг', 'Дистанц.']
  if (allowsDurationWeight(exercise)) return ['Кг', 'Время']
  return undefined
}
