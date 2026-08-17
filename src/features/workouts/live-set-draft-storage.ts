import type { LiveSetDraft } from '../../shared/domain'

type StoredLiveSetDrafts = Record<string, LiveSetDraft>

function storageKey(userId: string, workoutId: string): string {
  return `fit.live-set-drafts.${userId}.${workoutId}`
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function isLiveSetDraft(value: unknown): value is LiveSetDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const draft = value as Record<string, unknown>
  return optionalNumber(draft.weightKg)
    && optionalNumber(draft.reps)
    && optionalNumber(draft.durationSec)
    && optionalNumber(draft.durationMin)
    && optionalNumber(draft.distanceKm)
    && optionalNumber(draft.rpe)
}

export function readPendingLiveSetDrafts(userId: string, workoutId: string): Map<string, LiveSetDraft> {
  try {
    const raw = localStorage.getItem(storageKey(userId, workoutId))
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map()
    return new Map(Object.entries(parsed).flatMap(([setId, draft]) => isLiveSetDraft(draft) ? [[setId, draft]] : []))
  } catch {
    return new Map()
  }
}

export function writePendingLiveSetDraft(userId: string, workoutId: string, setId: string, draft: LiveSetDraft): void {
  try {
    const drafts = Object.fromEntries(readPendingLiveSetDrafts(userId, workoutId)) as StoredLiveSetDrafts
    drafts[setId] = draft
    localStorage.setItem(storageKey(userId, workoutId), JSON.stringify(drafts))
  } catch { /* приватный режим: черновик остаётся в памяти текущей вкладки */ }
}

export function removePendingLiveSetDraft(userId: string, workoutId: string, setId: string): void {
  try {
    const drafts = Object.fromEntries(readPendingLiveSetDrafts(userId, workoutId)) as StoredLiveSetDrafts
    delete drafts[setId]
    if (Object.keys(drafts).length) localStorage.setItem(storageKey(userId, workoutId), JSON.stringify(drafts))
    else localStorage.removeItem(storageKey(userId, workoutId))
  } catch { /* localStorage недоступен */ }
}

export function clearPendingLiveSetDrafts(userId: string, workoutId: string): void {
  try { localStorage.removeItem(storageKey(userId, workoutId)) } catch { /* localStorage недоступен */ }
}
