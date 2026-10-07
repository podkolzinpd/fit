import type { WorkoutTemplateDraft } from '../../shared/domain'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function workoutTemplateDraftKey(userId: string, templateId?: string, sourceWorkoutId?: string): string {
  const context = templateId ? `template:${templateId}` : sourceWorkoutId ? `source:${sourceWorkoutId}` : 'new'
  return `fit.workout-template-draft.${userId}.${context}`
}

function isDraft(value: unknown): value is WorkoutTemplateDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<WorkoutTemplateDraft>
  return typeof draft.id === 'string' && UUID.test(draft.id)
    && typeof draft.name === 'string' && typeof draft.notes === 'string'
    && (draft.version === undefined || (Number.isSafeInteger(draft.version) && draft.version >= 1))
    && Array.isArray(draft.exercises) && draft.exercises.every((exercise) => exercise && typeof exercise === 'object'
      && typeof exercise.ref === 'string' && typeof exercise.name === 'string'
      && typeof exercise.source === 'string' && typeof exercise.muscleGroup === 'string'
      && typeof exercise.inputKind === 'string' && Number.isInteger(exercise.position)
      && Array.isArray(exercise.sets) && exercise.sets.every((set) => set && typeof set === 'object' && Number.isInteger(set.position)))
}

export function readWorkoutTemplateDraft(key: string): WorkoutTemplateDraft | null {
  try {
    const raw = localStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return isDraft(parsed) ? parsed : null
  } catch { return null }
}

export function writeWorkoutTemplateDraft(key: string, draft: WorkoutTemplateDraft): boolean {
  try { localStorage.setItem(key, JSON.stringify(draft)); return true } catch { return false }
}

export function removeWorkoutTemplateDraft(key: string): void {
  try { localStorage.removeItem(key) } catch { /* In-memory editor still closes safely. */ }
}
