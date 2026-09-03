import type { ExerciseSnapshot } from '../../shared/domain'

/**
 * Пары, где две системные карточки описывают одно и то же движение.
 * Старый ref не удаляется из полного каталога: он нужен сохранённым тренировкам,
 * прогрессу и старым ссылкам. В новом выборе показываем только каноническую
 * карточку. Пользовательские упражнения этот список никогда не затрагивает.
 */
export const SYSTEM_EXERCISE_PICKER_REPLACEMENTS: Readonly<Record<string, string>> = {
  'fedb-bent-over-barbell-row': 'barbell-row',
  'fedb-standing-dumbbell-press': 'vital-standing-dumbbell-press',
  'fedb-front-plate-raise': 'vital-plate-front-raise',
  'fedb-smith-machine-stiff-legged-deadlift': 'vital-smith-stiff-leg-deadlift',
}

export function selectableExercises(exercises: readonly ExerciseSnapshot[]): readonly ExerciseSnapshot[] {
  return exercises.filter((exercise) => exercise.source === 'custom'
    || SYSTEM_EXERCISE_PICKER_REPLACEMENTS[exercise.ref] === undefined)
}
