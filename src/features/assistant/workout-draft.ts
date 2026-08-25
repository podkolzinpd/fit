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
