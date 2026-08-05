import type { LiveSetDraft, Workout } from '../../shared/domain'

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
