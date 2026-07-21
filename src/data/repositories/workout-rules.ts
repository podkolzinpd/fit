import type { Workout, WorkoutDraft } from '../../shared/domain'

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
