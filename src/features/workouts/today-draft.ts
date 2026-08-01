import type { ExerciseSnapshot } from '../../shared/domain'
import type { ParsedWorkoutExercise } from './quick-workout-entry'

export interface TodayDraft {
  screen: 'compose' | 'review'
  text: string
  choices: Record<string, ExerciseSnapshot>
  items: ParsedWorkoutExercise[]
  clientId: string
}

function isDraft(value: unknown): value is TodayDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<TodayDraft>
  return (draft.screen === 'compose' || draft.screen === 'review')
    && typeof draft.text === 'string'
    && typeof draft.clientId === 'string'
    && Array.isArray(draft.items)
    && Boolean(draft.choices && typeof draft.choices === 'object')
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
