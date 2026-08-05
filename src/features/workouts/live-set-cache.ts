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
