import type { WorkoutDraft } from '../../shared/domain'
import type { WorkoutParseResponse } from '../../data/repositories/exercises.repository'

export type AssistantWorkoutDraftSnapshot = {
  transcript: string
  rawFragments: string[]
  workoutDate: string
  startTime: string
  requestId: string
  result?: WorkoutParseResponse
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function assistantWorkoutDraftKey(userId: string, conversationId: string, clientId: string): string {
  return `fit:assistant-workout-draft:v1:${userId}:${conversationId}:${clientId}`
}

export function readAssistantWorkoutDraft(key: string, storage: DraftStorage | undefined = browserStorage()): AssistantWorkoutDraftSnapshot | undefined {
  if (!storage) return undefined
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null') as Partial<AssistantWorkoutDraftSnapshot> | null
    if (!value || typeof value.transcript !== 'string' || !Array.isArray(value.rawFragments) || !value.rawFragments.every((item) => typeof item === 'string') || typeof value.workoutDate !== 'string' || typeof value.startTime !== 'string' || typeof value.requestId !== 'string') return undefined
    if (value.result !== undefined && (!value.result || !Array.isArray(value.result.items) || !Array.isArray(value.result.unmatched))) return undefined
    return value as AssistantWorkoutDraftSnapshot
  } catch {
    return undefined
  }
}

export function writeAssistantWorkoutDraft(key: string, snapshot: AssistantWorkoutDraftSnapshot, storage: DraftStorage | undefined = browserStorage()): void {
  if (!storage) return
  try { storage.setItem(key, JSON.stringify(snapshot)) } catch { /* A full or blocked storage must not break the chat. */ }
}

export function clearAssistantWorkoutDraft(key: string, storage: DraftStorage | undefined = browserStorage()): void {
  if (!storage) return
  try { storage.removeItem(key) } catch { /* A blocked storage must not break the chat. */ }
}

function browserStorage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
}

export function appendAssistantTranscript(current: string, transcript: string): string {
  const next = transcript.trim()
  if (!next) return current
  const existing = current.trimEnd()
  return existing ? `${existing}\n${next}` : next
}

export type WorkoutParseQueue = { current: Promise<void> }

export function enqueueWorkoutParse(queue: WorkoutParseQueue, task: () => Promise<void>): Promise<void> {
  const next = queue.current.then(task, task)
  queue.current = next.then(() => undefined, () => undefined)
  return next
}

export function assistantWorkoutSaveInput(
  requestId: string,
  clientId: string,
  workoutDate: string,
  startTime: string,
  exercises: WorkoutDraft['exercises'],
) {
  return { workout: { requestId, clientId, workoutDate, startTime, exercises } }
}

export function appendWorkoutParse(existing: WorkoutParseResponse | undefined, fragment: WorkoutParseResponse): WorkoutParseResponse {
  const current = existing ?? { items: [], unmatched: [] }
  return {
    items: [...current.items, ...fragment.items],
    unmatched: [...current.unmatched, ...fragment.unmatched.filter((item) => !current.unmatched.some((known) => known.sourceText === item.sourceText))],
  }
}

export function replaceWorkoutParseSource(existing: WorkoutParseResponse, sourceText: string, fragment: WorkoutParseResponse): WorkoutParseResponse {
  return appendWorkoutParse({
    items: existing.items.filter((item) => item.sourceText !== sourceText),
    unmatched: existing.unmatched.filter((item) => item.sourceText !== sourceText),
  }, fragment)
}

type WorkoutMetricPatch = { setCount?: number; reps?: number | undefined; weightKg?: number | undefined }

function patchedSets(
  sets: WorkoutParseResponse['items'][number]['sets'],
  patch: WorkoutMetricPatch,
): WorkoutParseResponse['items'][number]['sets'] {
  const count = Math.max(1, Math.min(20, patch.setCount ?? (sets.length || 1)))
  const seed = sets[0] ?? {}
  return Array.from({ length: count }, (_, index) => {
    const next = { ...(sets[index] ?? seed) }
    if ('reps' in patch) {
      if (patch.reps === undefined) delete next.reps
      else next.reps = patch.reps
    }
    if ('weightKg' in patch) {
      if (patch.weightKg === undefined) delete next.weightKg
      else next.weightKg = patch.weightKg
    }
    return next
  })
}

export function updateWorkoutParseMetrics(
  existing: WorkoutParseResponse,
  sourceText: string,
  patch: WorkoutMetricPatch,
): WorkoutParseResponse {
  return {
    items: existing.items.map((item) => item.sourceText === sourceText ? { ...item, sets: patchedSets(item.sets, patch) } : item),
    unmatched: existing.unmatched.map((item) => item.sourceText === sourceText ? { ...item, sets: patchedSets(item.sets ?? [], patch) } : item),
  }
}

export function removeWorkoutParseSource(existing: WorkoutParseResponse, sourceText: string): WorkoutParseResponse {
  return {
    items: existing.items.filter((item) => item.sourceText !== sourceText),
    unmatched: existing.unmatched.filter((item) => item.sourceText !== sourceText),
  }
}

export function resolveWorkoutParseSource(existing: WorkoutParseResponse, sourceText: string, exerciseRef: string): WorkoutParseResponse {
  const unresolved = existing.unmatched.find((item) => item.sourceText === sourceText)
  if (!unresolved) return existing
  return replaceWorkoutParseSource(existing, sourceText, {
    items: [{ sourceText, exerciseRef, confidence: 1, sets: unresolved.sets ?? [] }],
    unmatched: [],
  })
}

export function appendedWorkoutTranscript(previous: string, current: string): string {
  const normalizedPrevious = previous.trim()
  const normalizedCurrent = current.trim()
  if (!normalizedCurrent || normalizedPrevious === normalizedCurrent) return ''
  return normalizedPrevious && normalizedCurrent.startsWith(normalizedPrevious)
    ? normalizedCurrent.slice(normalizedPrevious.length).trim()
    : normalizedCurrent
}
