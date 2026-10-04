import type { ExerciseSnapshot, WorkoutTrainingFormat } from '../../shared/domain'
import type { ParsedWorkoutExercise } from './quick-workout-entry'

export interface TodayDraft {
  title?: string
  requestId?: string
  sourceFormDraftKey?: string
  endTime?: string
  screen: 'compose' | 'review' | 'save'
  text: string
  lastLlmText?: string
  choices: Record<string, ExerciseSnapshot>
  items: ParsedWorkoutExercise[]
  clientId: string
  manualRefs?: string[]
  removedRefs?: string[]
  recordMode?: 'planned' | 'completed'
  workoutDate?: string
  startTime?: string
  actualDurationMinutes?: string
  trainingFormat?: WorkoutTrainingFormat
}

function isDraft(value: unknown): value is TodayDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<TodayDraft>
  return (draft.screen === 'compose' || draft.screen === 'review' || draft.screen === 'save')
    && (draft.title === undefined || typeof draft.title === 'string')
    && (draft.requestId === undefined || typeof draft.requestId === 'string')
    && (draft.sourceFormDraftKey === undefined || typeof draft.sourceFormDraftKey === 'string')
    && (draft.endTime === undefined || typeof draft.endTime === 'string')
    && typeof draft.text === 'string'
    && (draft.lastLlmText === undefined || typeof draft.lastLlmText === 'string')
    && typeof draft.clientId === 'string'
    && Array.isArray(draft.items)
    && Boolean(draft.choices && typeof draft.choices === 'object')
    && (draft.recordMode === undefined || draft.recordMode === 'planned' || draft.recordMode === 'completed')
    && (draft.workoutDate === undefined || typeof draft.workoutDate === 'string')
    && (draft.startTime === undefined || typeof draft.startTime === 'string')
    && (draft.actualDurationMinutes === undefined || typeof draft.actualDurationMinutes === 'string')
    && (draft.trainingFormat === undefined || draft.trainingFormat === 'self' || draft.trainingFormat === 'with_trainer')
}

export function todayDraftKey(userId: string, planId?: string | null): string {
  return `fit.today-draft.${userId}${planId ? `.plan.${encodeURIComponent(planId)}` : ''}`
}

export function readTodayDraft(key: string): TodayDraft | null {
  try {
    const raw = localStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!isDraft(parsed)) return null
    if (parsed.screen === 'save' && parsed.items.length === 0) {
      return { ...parsed, screen: parsed.text.trim() ? 'review' : 'compose' }
    }
    return parsed
  } catch {
    return null
  }
}

export function writeTodayDraft(key: string, draft: TodayDraft): void {
  try { localStorage.setItem(key, JSON.stringify(draft)) } catch { /* приватный режим: черновик остаётся в сессии */ }
}

export function removeTodayDraft(key: string): void {
  try { localStorage.removeItem(key) } catch { /* localStorage недоступен */ }
}

/** Client drafts have their own identities; the old singleton remains explicitly resumable. */
export function clientTodayDraftKey(userId: string, id: string): string {
  return id === 'legacy' ? todayDraftKey(userId) : todayDraftKey(userId, `client-${id}`)
}

export function readClientTodayDrafts(userId: string): { id: string; draft: TodayDraft }[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(`fit.client-today-drafts.${userId}`) ?? '[]')
    const ids = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && /^[\w-]{1,80}$/.test(id)) : []
    return [...new Set([...ids, 'legacy'])].flatMap((id) => {
      const draft = readTodayDraft(clientTodayDraftKey(userId, id))
      return draft && (draft.text.trim() || draft.items.length) ? [{ id, draft }] : []
    })
  } catch { return [] }
}

export function writeClientTodayDraft(userId: string, id: string, draft: TodayDraft): void {
  writeTodayDraft(clientTodayDraftKey(userId, id), draft)
  try {
    const ids = readClientTodayDrafts(userId).map((entry) => entry.id).filter((entry) => entry !== id && entry !== 'legacy')
    localStorage.setItem(`fit.client-today-drafts.${userId}`, JSON.stringify([id, ...ids]))
  } catch { /* Unavailable storage must not interrupt the current draft. */ }
}
