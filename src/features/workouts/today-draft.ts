import type { ExerciseSnapshot } from '../../shared/domain'
import type { ChatMessage } from './chat-types'
import type { ParsedWorkoutExercise } from './quick-workout-entry'

export interface TodayDraft {
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
  /** Лента чата «Быстрого ввода» — не обязательна: старые черновики без неё остаются валидными. */
  messages?: ChatMessage[]
}

function isDraft(value: unknown): value is TodayDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<TodayDraft>
  return (draft.screen === 'compose' || draft.screen === 'review' || draft.screen === 'save')
    && typeof draft.text === 'string'
    && (draft.lastLlmText === undefined || typeof draft.lastLlmText === 'string')
    && typeof draft.clientId === 'string'
    && Array.isArray(draft.items)
    && Boolean(draft.choices && typeof draft.choices === 'object')
    && (draft.recordMode === undefined || draft.recordMode === 'planned' || draft.recordMode === 'completed')
    && (draft.workoutDate === undefined || typeof draft.workoutDate === 'string')
    && (draft.startTime === undefined || typeof draft.startTime === 'string')
    && (draft.messages === undefined || Array.isArray(draft.messages))
}

export function todayDraftKey(userId: string): string {
  return `fit.today-draft.${userId}`
}

export function readTodayDraft(key: string): TodayDraft | null {
  try {
    const raw = localStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return isDraft(parsed) ? parsed : null
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
