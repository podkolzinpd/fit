import type { LocalDate } from '../../shared/local-date'

export type WorkoutRecordMode = 'planned' | 'completed'

// У завершённой тренировки дата не может быть в будущем. Это правило должно
// одинаково работать во всех входах: быстрый старт, клиент и календарь.
export function workoutDateForRecordMode(mode: WorkoutRecordMode, value: LocalDate, today: LocalDate): LocalDate {
  return mode === 'completed' && value > today ? today : value
}

export interface PlannedWorkoutActionLabels {
  primary: string
  pending: string
  secondary?: string
}

// План в прошлом остаётся доступным для внесения факта, но это уже не сценарий
// «начать тренировку сейчас». Тренеру и клиенту показываем действие в терминах
// результата и отдельно предлагаем перенести план на другую дату.
export function plannedWorkoutActionLabels(workoutDate: LocalDate, today: LocalDate): PlannedWorkoutActionLabels {
  if (workoutDate < today) return {
    primary: 'Выбрать действие',
    pending: 'Открываем…',
  }
  return {
    primary: 'Начать тренировку',
    pending: 'Начинаем…',
  }
}
