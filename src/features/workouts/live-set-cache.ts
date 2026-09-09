import type { LiveSetDraft, Workout, WorkoutSet } from '../../shared/domain'

// Локальная копия live-тренировки должна сразу отражать автосохранённый факт.
// Иначе при переходе к следующей строке React сворачивает предыдущую по старым
// данным и временно показывает «Без значений», хотя запись уже отправлена.
export function applyLiveSetDraft(workout: Workout, setId: string, draft: LiveSetDraft, version: number): Workout {
  return {
    ...workout,
    exercises: workout.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => set.id === setId ? { ...set, fact: { ...draft }, version } : set),
    })),
  }
}

/** Возвращает строку с локально сохранённым черновиком, если realtime ещё не
 * успел отдать серверную версию. Так быстрый переход между подходами не стирает
 * введённые числа из компактного представления. */
export function setWithLocalDraft(set: WorkoutSet, draft: LiveSetDraft | undefined): WorkoutSet {
  return draft ? { ...set, fact: { ...draft } } : set
}

export function sameLiveSetDraft(left: LiveSetDraft, right: LiveSetDraft): boolean {
  return left.weightKg === right.weightKg
    && left.reps === right.reps
    && left.durationSec === right.durationSec
    && left.durationMin === right.durationMin
    && left.distanceKm === right.distanceKm
    && left.rpe === right.rpe
}

/** Called only after confirmation succeeds, never optimistically before the RPC. */
export function applyLiveSetConfirmation(workout: Workout, setId: string, draft: LiveSetDraft, version: number, confirmedAt: string): Workout {
  const next = applyLiveSetDraft(workout, setId, draft, version)
  return { ...next, exercises: next.exercises.map((exercise) => ({ ...exercise,
    sets: exercise.sets.map((set) => set.id === setId ? { ...set, confirmedAt: set.confirmedAt ?? confirmedAt } : set),
  })) }
}

/** A refetch started before save/confirm must not undo an acknowledged set. */
export function reconcileLiveWorkout(current: Workout | undefined, incoming: Workout): Workout {
  if (!current || current.id !== incoming.id) return incoming
  if (current.version > incoming.version) return current
  const currentSets = new Map(current.exercises.flatMap((exercise) => exercise.sets).map((set) => [set.id, set]))
  return { ...incoming, exercises: incoming.exercises.map((exercise) => ({ ...exercise,
    sets: exercise.sets.map((set) => {
      const previous = currentSets.get(set.id)
      return previous && previous.version > set.version ? previous : set
    }),
  })) }
}
