import type { ExerciseSnapshot } from '../../shared/domain'
import { COMPATIBLE_EXERCISE_REPLACEMENTS } from '../../shared/exercise-catalog-curation'

/**
 * Пары, где две системные карточки описывают одно и то же движение.
 * Старый ref не удаляется из полного каталога: он нужен сохранённым тренировкам,
 * прогрессу и старым ссылкам. В новом выборе показываем только каноническую
 * карточку. Пользовательские упражнения этот список никогда не затрагивает.
 */
export const SYSTEM_EXERCISE_PICKER_REPLACEMENTS = COMPATIBLE_EXERCISE_REPLACEMENTS

export function selectableExercises(exercises: readonly ExerciseSnapshot[]): readonly ExerciseSnapshot[] {
  return exercises.filter((exercise) => exercise.source === 'custom'
    || SYSTEM_EXERCISE_PICKER_REPLACEMENTS[exercise.ref] === undefined)
}
