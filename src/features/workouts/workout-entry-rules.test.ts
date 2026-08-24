import { describe, expect, it } from 'vitest'
import { localDate } from '../../shared/local-date'
import { plannedWorkoutActionLabels } from './workout-entry-rules'

describe('plannedWorkoutActionLabels', () => {
  const today = localDate('2026-08-19')

  it('opens one calm action choice for a past plan', () => {
    expect(plannedWorkoutActionLabels(localDate('2026-08-11'), today)).toEqual({
      primary: 'Выбрать действие',
      pending: 'Открываем…',
    })
  })

  it.each(['2026-08-19', '2026-08-20'])('keeps the start action for %s', (date) => {
    expect(plannedWorkoutActionLabels(localDate(date), today)).toEqual({
      primary: 'Начать тренировку',
      pending: 'Начинаем…',
    })
  })
})
