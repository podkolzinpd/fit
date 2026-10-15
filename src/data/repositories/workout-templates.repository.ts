import type { WorkoutExerciseDraft, WorkoutTemplate, WorkoutTemplateDraft } from '../../shared/domain'
import { workoutTemplateQueries } from '../queries/workout-templates.queries'
import { repositoryError } from './error'

type TemplateRow = Awaited<ReturnType<typeof workoutTemplateQueries.list>>['data'] extends (infer Row)[] | null ? Row : never

export { appendWorkoutTemplateExercises, cloneWorkoutTemplate, workoutTemplateFromWorkout } from './workout-template-rules'

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
