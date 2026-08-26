import type { WorkoutDraft } from '../../shared/domain'
import type { WorkoutParseResponse } from '../../data/repositories/exercises.repository'

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

type WorkoutMetricPatch = { setCount?: number; reps?: number; weightKg?: number }

function patchedSets(
  sets: WorkoutParseResponse['items'][number]['sets'],
  patch: WorkoutMetricPatch,
): WorkoutParseResponse['items'][number]['sets'] {
  const count = Math.max(1, Math.min(20, patch.setCount ?? (sets.length || 1)))
  const seed = sets[0] ?? {}
  return Array.from({ length: count }, (_, index) => ({
    ...(sets[index] ?? seed),
    ...(patch.reps === undefined ? {} : { reps: patch.reps }),
    ...(patch.weightKg === undefined ? {} : { weightKg: patch.weightKg }),
  }))
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
