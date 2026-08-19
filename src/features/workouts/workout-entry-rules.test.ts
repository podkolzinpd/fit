import { describe, expect, it } from 'vitest'
import { localDate } from '../../shared/local-date'
import { plannedWorkoutActionLabels, workoutDateForRecordMode } from './workout-entry-rules'

describe('workoutDateForRecordMode', () => {
  const today = localDate('2026-08-03')

  it('keeps a future date for a plan', () => {
    expect(workoutDateForRecordMode('planned', localDate('2026-08-07'), today)).toBe('2026-08-07')
  })

  it('moves a completed workout from a future date to today', () => {
    expect(workoutDateForRecordMode('completed', localDate('2026-08-07'), today)).toBe(today)
  })

  it('keeps a past completed workout date', () => {
    expect(workoutDateForRecordMode('completed', localDate('2026-08-01'), today)).toBe('2026-08-01')
  })
})

describe('plannedWorkoutActionLabels', () => {
  const today = localDate('2026-08-19')

  it('offers to record a result or reschedule a missed plan', () => {
    expect(plannedWorkoutActionLabels(localDate('2026-08-11'), today)).toEqual({
      primary: 'Записать результат',
      pending: 'Открываем…',
      secondary: 'Перенести тренировку',
    })
  })

  it.each(['2026-08-19', '2026-08-20'])('keeps the start action for %s', (date) => {
    expect(plannedWorkoutActionLabels(localDate(date), today)).toEqual({
      primary: 'Начать тренировку',
      pending: 'Начинаем…',
    })
  })
})
