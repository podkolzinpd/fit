import type { Workout, WorkoutExerciseDraft, WorkoutTemplate, WorkoutTemplateDraft } from '../../shared/domain'
import { workoutTemplateQueries } from '../queries/workout-templates.queries'
import { repositoryError } from './error'

type TemplateRow = Awaited<ReturnType<typeof workoutTemplateQueries.list>>['data'] extends (infer Row)[] | null ? Row : never

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

export function workoutTemplateFromWorkout(workout: Workout, name = 'Новый шаблон'): WorkoutTemplateDraft {
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
  return { id: crypto.randomUUID(), name: `${template.name} — копия`, notes: template.notes, exercises: cloneExercises(template.exercises) }
}

function mapRow(row: TemplateRow): WorkoutTemplate {
  return {
    id: row.id,
    trainerId: row.trainer_id,
    name: row.name,
    notes: row.notes ?? undefined,
    exercises: row.exercises as unknown as WorkoutExerciseDraft[],
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const workoutTemplatesRepository = {
  async list(): Promise<WorkoutTemplate[]> {
    const result = await workoutTemplateQueries.list()
    if (result.error) throw repositoryError(result.error)
    return result.data.map(mapRow)
  },
  async get(id: string): Promise<WorkoutTemplate> {
    const result = await workoutTemplateQueries.get(id)
    if (result.error) throw repositoryError(result.error)
    return mapRow(result.data)
  },
  async save(draft: WorkoutTemplateDraft): Promise<string> {
    const result = await workoutTemplateQueries.save(draft)
    if (result.error) throw repositoryError(result.error)
    return result.data
  },
  async archive(template: WorkoutTemplate): Promise<void> {
    const result = await workoutTemplateQueries.archive(template.id, template.version)
    if (result.error) throw repositoryError(result.error)
  },
}
