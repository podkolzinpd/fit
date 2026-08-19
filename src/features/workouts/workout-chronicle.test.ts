import { describe, expect, it } from 'vitest'
import { chronicleExercisePreview } from './workout-chronicle'

describe('chronicleExercisePreview', () => {
  it('оставляет в карточке истории только два первых упражнения', () => {
    expect(chronicleExercisePreview(['Жим', 'Тяга', 'Планка'])).toEqual({
      visible: ['Жим', 'Тяга'],
      hiddenCount: 1,
    })
  })

  it('не добавляет счётчик, когда все упражнения помещаются', () => {
    expect(chronicleExercisePreview(['Бег', 'Заминка'])).toEqual({
      visible: ['Бег', 'Заминка'],
      hiddenCount: 0,
    })
  })

  it('безопасно обрабатывает пустую тренировку', () => {
    expect(chronicleExercisePreview([])).toEqual({ visible: [], hiddenCount: 0 })
  })
})
