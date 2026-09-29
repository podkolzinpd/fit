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
