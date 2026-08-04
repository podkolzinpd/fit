import type { WorkoutDraft } from '../../shared/domain'
import type { LocalDate } from '../../shared/local-date'

export interface WorkoutFormDraft {
  clientId: string
  workoutDate: LocalDate
  startTime: string
  endTime: string
  notes: string
  stageId: string
  recordCompleted: boolean
  exercises: WorkoutDraft['exercises']
}

function isDraft(value: unknown): value is WorkoutFormDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<WorkoutFormDraft>
  return typeof draft.clientId === 'string'
    && typeof draft.workoutDate === 'string'
    && typeof draft.startTime === 'string'
    && typeof draft.endTime === 'string'
    && typeof draft.notes === 'string'
    && typeof draft.stageId === 'string'
    && typeof draft.recordCompleted === 'boolean'
    && Array.isArray(draft.exercises)
}

export function workoutFormDraftKey(userId: string, sourceId = 'new'): string {
  return `fit.workout-form-draft.${userId}.${sourceId}`
}

export function readWorkoutFormDraft(key: string): WorkoutFormDraft | null {
  try {
    const raw = localStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return isDraft(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeWorkoutFormDraft(key: string, draft: WorkoutFormDraft): void {
  try { localStorage.setItem(key, JSON.stringify(draft)) } catch { /* приватный режим: ввод остаётся в текущей сессии */ }
}

export function removeWorkoutFormDraft(key: string): void {
  try { localStorage.removeItem(key) } catch { /* localStorage недоступен */ }
}
