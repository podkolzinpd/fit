import { describe, expect, it } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import { SYSTEM_EXERCISE_CATALOG } from '../../shared/system-exercises'
import {
  exerciseSearchConflicts,
  exerciseSearchAliases,
  normalizeExerciseSearch,
  rankExerciseSearch,
  resolveExerciseSearch,
} from './exercise-search'

const fixtures: ExerciseSnapshot[] = [
  { source: 'system', ref: 'system-plank', name: 'Планка', muscleGroup: 'core', inputKind: 'duration' },
  { source: 'custom', ref: 'custom-plank', customExerciseId: 'custom-plank', name: 'Планка', muscleGroup: 'core', inputKind: 'strength' },
  { source: 'system', ref: 'back-squat', name: 'Присед со штангой', muscleGroup: 'legs', inputKind: 'strength' },
  { source: 'system', ref: 'front-squat', name: 'Фронтальный присед со штангой', muscleGroup: 'legs', inputKind: 'strength' },
]

describe('exercise search contract', () => {
  it('нормализует регистр, е/ё и формы оборудования', () => {
    expect(normalizeExerciseSearch('ЖИМ ГАНТЕЛЯМИ В ТРЕНАЖЁРЕ')).toBe('жим гантели в тренажер')
    expect(normalizeExerciseSearch('Тяга в Смите со ШТАНГОЙ')).toBe('тяга в смит со штанга')
  })

  it('различает точное, неоднозначное и поисковое совпадение', () => {
    expect(resolveExerciseSearch(fixtures, 'Присед со штангой')).toMatchObject({
      level: 'exact', matches: [{ exercise: { ref: 'back-squat' } }],
    })
    expect(resolveExerciseSearch(fixtures, 'Планка')).toMatchObject({
      level: 'ambiguous', matches: [
        { exercise: { source: 'custom', ref: 'custom-plank' } },
        { exercise: { source: 'system', ref: 'system-plank' } },
      ],
    })
    expect(resolveExerciseSearch(fixtures, 'штанга ноги').level).toBe('ambiguous')
  })

  it('принимает единственную опечатку в длинной точной фразе', () => {
    expect(resolveExerciseSearch(fixtures, 'Присед со штангй')).toMatchObject({
      level: 'exact', matches: [{ exercise: { ref: 'back-squat' } }],
    })
  })

  it('поднимает недавнее и пользовательское, не меняя уровень уверенности', () => {
    const recent = resolveExerciseSearch(fixtures, 'присед штанга', { preferredExerciseRefs: ['front-squat'] })
    expect(recent.level).not.toBe('exact')
    expect(recent.matches[0]?.exercise.ref).toBe('front-squat')

    expect(rankExerciseSearch(fixtures, 'планка').map(({ exercise }) => exercise.ref))
      .toEqual(['custom-plank', 'system-plank'])
  })

  it('формирует детерминированный отчёт конфликтующих фраз', () => {
    const conflicts = exerciseSearchConflicts(fixtures)
    expect(conflicts).toContainEqual({ phrase: 'планка', exerciseRefs: ['custom-plank', 'system-plank'] })
    // Historic aliases intentionally overlap duplicate refs retained for history.
    expect(exerciseSearchConflicts(SYSTEM_EXERCISE_CATALOG)).toEqual(exerciseSearchConflicts([...SYSTEM_EXERCISE_CATALOG].reverse()))
  })

  it('даёт поисковые варианты каждому системному упражнению, не меняя каталог', () => {
    expect(SYSTEM_EXERCISE_CATALOG).toHaveLength(663)
    expect(SYSTEM_EXERCISE_CATALOG.every((exercise) => exerciseSearchAliases(exercise).length > 0)).toBe(true)
    expect(exerciseSearchAliases(SYSTEM_EXERCISE_CATALOG.find((exercise) => exercise.ref === 'fedb-face-pull')!)).toContain('face pull')
  })

  it('не превращает автоматически сгенерированный вариант в точное совпадение', () => {
    const bridge = SYSTEM_EXERCISE_CATALOG.find((exercise) => exercise.ref === 'fedb-butt-lift-bridge')!
    const result = resolveExerciseSearch([bridge], 'butt lift bridge')

    expect(result.level).toBe('search')
    expect(result.matches[0]?.exercise.ref).toBe('fedb-butt-lift-bridge')
  })

  it('укладывает полный каталог в интерактивный бюджет поиска', () => {
    const queries = ['присед', 'жим гантелями', 'тренажер ноги', 'тяга блока', 'разведения плечами']
    const startedAt = performance.now()
    for (let index = 0; index < 10; index += 1) {
      for (const query of queries) rankExerciseSearch(SYSTEM_EXERCISE_CATALOG, query)
    }
    expect(performance.now() - startedAt).toBeLessThan(1_500)
  })
})
