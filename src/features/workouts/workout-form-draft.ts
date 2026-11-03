import type { WorkoutDraft, WorkoutTrainingFormat } from '../../shared/domain'
import type { LocalDate } from '../../shared/local-date'

export interface WorkoutFormDraft {
  sourceVersion?: number
  title?: string
  requestId?: string
  appliedTemplateIds?: string[]
  composerText?: string
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
  prepSeconds?: number
  executionMode?: 'timer' | 'manual'
}

function isDraft(value: unknown): value is WorkoutFormDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<WorkoutFormDraft>
  return typeof draft.clientId === 'string'
    && (draft.sourceVersion === undefined || Number.isInteger(draft.sourceVersion) && draft.sourceVersion >= 0)
    && (draft.title === undefined || typeof draft.title === 'string')
    && (draft.requestId === undefined || typeof draft.requestId === 'string')
    && (draft.appliedTemplateIds === undefined || Array.isArray(draft.appliedTemplateIds) && draft.appliedTemplateIds.every(id => typeof id === 'string'))
    && (draft.composerText === undefined || typeof draft.composerText === 'string')
    && typeof draft.workoutDate === 'string'
    && typeof draft.startTime === 'string'
    && typeof draft.endTime === 'string'
    && (draft.actualDurationMinutes === undefined || typeof draft.actualDurationMinutes === 'string')
    && typeof draft.notes === 'string'
    && typeof draft.stageId === 'string'
    && typeof draft.recordCompleted === 'boolean'
    && Array.isArray(draft.exercises)
    && (draft.trainingFormat === undefined || draft.trainingFormat === 'self' || draft.trainingFormat === 'with_trainer')
    && (draft.prepSeconds === undefined || (Number.isInteger(draft.prepSeconds) && draft.prepSeconds >= 0 && draft.prepSeconds <= 600))
    && (draft.executionMode === undefined || draft.executionMode === 'timer' || draft.executionMode === 'manual')
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

/** Edit drafts never share a key with a copy and never overwrite a newer plan. */
export function readWorkoutEditDraft(key: string, version: number | undefined): WorkoutFormDraft | null {
  const draft = readWorkoutFormDraft(key)
  return version !== undefined && draft?.sourceVersion === version ? draft : null
}

export function writeWorkoutFormDraft(key: string, draft: WorkoutFormDraft): void {
  const previous = readWorkoutFormDraft(key)
  if (draft.composerText === undefined && draft.requestId && previous?.requestId === draft.requestId && previous.composerText) {
    draft = { ...draft, composerText: previous.composerText }
  }
  if (draft.appliedTemplateIds === undefined && previous?.appliedTemplateIds && previous.requestId === draft.requestId && previous.sourceVersion === draft.sourceVersion) {
    draft = { ...draft, appliedTemplateIds: previous.appliedTemplateIds }
  }
  try { localStorage.setItem(key, JSON.stringify(draft)) } catch { /* приватный режим: ввод остаётся в текущей сессии */ }
}

export function removeWorkoutFormDraft(key: string): void {
  try { localStorage.removeItem(key) } catch { /* localStorage недоступен */ }
}

export function hasWorkoutFormContent(draft: WorkoutFormDraft | null, initialDate: LocalDate): draft is WorkoutFormDraft {
  return Boolean(draft && (draft.clientId || draft.title?.trim() || draft.composerText?.trim() || draft.notes.trim()
    || draft.exercises.length || draft.startTime || draft.endTime || draft.recordCompleted
    || draft.trainingFormat === 'self' || draft.workoutDate !== initialDate))
}

/** Explicitly retained alternatives when a trainer starts a new quick plan. */
export function quickPlanDraftChoices(key: string, date: LocalDate): Array<{ key: string; draft: WorkoutFormDraft }> {
  const result: Array<{ key: string; draft: WorkoutFormDraft }> = []
  const current = readWorkoutFormDraft(key)
  if (hasWorkoutFormContent(current, date)) result.push({ key, draft: current })
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const candidate = localStorage.key(index)
      if (!candidate?.startsWith(`${key}.saved.`)) continue
      const draft = readWorkoutFormDraft(candidate)
      if (hasWorkoutFormContent(draft, date)) result.push({ key: candidate, draft })
    }
  } catch { /* Current in-memory choice remains available when storage is denied. */ }
  return result
}

export function retainQuickPlanDraft(key: string, date: LocalDate): boolean {
  const draft = readWorkoutFormDraft(key)
  if (!hasWorkoutFormContent(draft, date)) return true
  try {
    localStorage.setItem(`${key}.saved.${draft.requestId ?? crypto.randomUUID()}`, JSON.stringify(draft))
    return true
  } catch { return false }
}

/** A template assignment keeps its own date/client context; legacy keys stay readable. */
export function templateAssignmentDraftKey(userId: string, templateId: string, clientId: string, date: LocalDate, completed = false): string {
  return `${workoutFormDraftKey(userId, `template-${templateId}`)}.assignment.${encodeURIComponent(clientId || 'any')}.${date}.${completed ? 'completed' : 'planned'}`
}

export function templateAssignmentDraftChoices(userId: string, templateId: string): Array<{ key: string; draft: WorkoutFormDraft }> {
  const legacyKey = workoutFormDraftKey(userId, `template-${templateId}`)
  const keys = new Set([legacyKey])
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(`${legacyKey}.assignment.`)) keys.add(key)
    }
  } catch { /* A denied store never authorizes deleting another draft. */ }
  return [...keys].flatMap((key) => {
    const draft = readWorkoutFormDraft(key)
    return draft ? [{ key, draft }] : []
  })
}
