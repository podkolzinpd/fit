import type { LocalDate } from '../../shared/local-date'

export type WorkoutRecordMode = 'planned' | 'completed'

// У завершённой тренировки дата не может быть в будущем. Это правило должно
// одинаково работать во всех входах: быстрый старт, клиент и календарь.
export function workoutDateForRecordMode(mode: WorkoutRecordMode, value: LocalDate, today: LocalDate): LocalDate {
  return mode === 'completed' && value > today ? today : value
}
