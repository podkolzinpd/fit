import type { Workout, WorkoutExerciseDraft, WorkoutTemplateDraft } from '../../shared/domain'

function cloneExercises(exercises: WorkoutExerciseDraft[]): WorkoutExerciseDraft[] {
  const blockIds = new Map<string, string>()
  const blockId = (source: string | undefined) => {
    if (!source) return crypto.randomUUID()
    const current = blockIds.get(source)
    if (current) return current
    const created = crypto.randomUUID()
    blockIds.set(source, created)
    return created
  }
  return exercises.map((exercise, position) => ({
    source: exercise.source,
    ref: exercise.ref,
    ...(exercise.source === 'custom' && exercise.customExerciseId ? { customExerciseId: exercise.customExerciseId } : {}),
    name: exercise.name,
    muscleGroup: exercise.muscleGroup,
    inputKind: exercise.inputKind,
    position,
    blockId: blockId(exercise.blockId),
    blockType: exercise.blockType,
    blockPreset: exercise.blockPreset,
    blockRounds: exercise.blockRounds,
    restBetweenExercisesSec: exercise.restBetweenExercisesSec,
    restBetweenRoundsSec: exercise.restBetweenRoundsSec,
    restBetweenSetsSec: exercise.restBetweenSetsSec,
    trainerComment: exercise.trainerComment,
    sets: exercise.sets.map((set, setPosition) => ({
      position: setPosition,
      weightKg: set.weightKg,
      reps: set.reps,
      durationSec: set.durationSec,
      durationMin: set.durationMin,
      distanceKm: set.distanceKm,
      rpe: set.rpe,
    })),
  }))
}

export function workoutTemplateFromWorkout(workout: Workout, name = workout.title?.trim() || workout.favoriteTitle?.trim() || 'Новый шаблон'): WorkoutTemplateDraft {
  return {
    id: crypto.randomUUID(),
    name,
    notes: workout.notes ?? undefined,
    exercises: cloneExercises(workout.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({
        position: set.position,
        weightKg: set.weightKg,
        reps: set.reps,
        durationSec: set.durationSec,
        durationMin: set.durationMin,
        distanceKm: set.distanceKm,
        rpe: set.rpe,
      })),
    }))),
  }
}

export function cloneWorkoutTemplate(template: Pick<WorkoutTemplateDraft, 'name' | 'notes' | 'exercises'>): WorkoutTemplateDraft {
  const suffix = ' — копия'
  const name = template.name.length + suffix.length <= 120 ? `${template.name}${suffix}` : template.name
  return { id: crypto.randomUUID(), name, notes: template.notes, exercises: cloneExercises(template.exercises) }
}

export function appendWorkoutTemplateExercises(existing: WorkoutExerciseDraft[], template: Pick<WorkoutTemplateDraft, 'exercises'>): WorkoutExerciseDraft[] {
  const copied = cloneExercises(template.exercises)
  return [...existing, ...copied.map((exercise, index) => ({ ...exercise, position: existing.length + index }))]
}
