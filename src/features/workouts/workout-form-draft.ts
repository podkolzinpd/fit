import type { WorkoutDraft, WorkoutTrainingFormat } from '../../shared/domain'
import type { LocalDate } from '../../shared/local-date'

export interface WorkoutFormDraft {
  title?: string
  requestId?: string
  clientId: string
  workoutDate: LocalDate
  startTime: string
  endTime: string
  actualDurationMinutes?: string
  notes: string
  stageId: string
  recordCompleted: boolean
  exercises: WorkoutDraft['exercises']
  trainingFormat?: WorkoutTrainingFormat
}

function isDraft(value: unknown): value is WorkoutFormDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<WorkoutFormDraft>
  return typeof draft.clientId === 'string'
    && (draft.title === undefined || typeof draft.title === 'string')
    && (draft.requestId === undefined || typeof draft.requestId === 'string')
    && typeof draft.workoutDate === 'string'
    && typeof draft.startTime === 'string'
    && typeof draft.endTime === 'string'
    && (draft.actualDurationMinutes === undefined || typeof draft.actualDurationMinutes === 'string')
    && typeof draft.notes === 'string'
    && typeof draft.stageId === 'string'
    && typeof draft.recordCompleted === 'boolean'
    && Array.isArray(draft.exercises)
    && (draft.trainingFormat === undefined || draft.trainingFormat === 'self' || draft.trainingFormat === 'with_trainer')
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
