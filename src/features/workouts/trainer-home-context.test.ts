import { describe, expect, it } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { trainerHomeContext } from './trainer-home-context'

function workout(id: string, status: Workout['status'], date: string, time: string | null = null): Workout {
  return { id, status, workoutDate: localDate(date), startTime: time, clientName: id } as Workout
}

describe('trainerHomeContext', () => {
  const today = localDate('2026-09-27')

  it('prioritizes the active workout over future plans', () => {
    expect(trainerHomeContext([
      workout('tomorrow', 'planned', '2026-09-28', '09:00'),
      workout('active', 'in_progress', '2026-09-26', '18:00'),
    ], today)).toMatchObject({ title: 'Текущая тренировка', workout: { id: 'active' } })
  })

  it('chooses the nearest future workout, including after this week', () => {
    expect(trainerHomeContext([
      workout('later', 'planned', '2026-10-04', '12:00'),
      workout('past', 'planned', '2026-09-26', '18:00'),
      workout('first', 'planned', '2026-10-02', '10:00'),
    ], today)).toMatchObject({ title: 'Ближайшая тренировка', workout: { id: 'first' } })
  })

  it('falls back to the latest completed workout and never chooses cancelled', () => {
    expect(trainerHomeContext([
      workout('cancelled', 'cancelled', '2026-09-30'),
      workout('older', 'done', '2026-09-22'),
      workout('latest', 'done', '2026-09-25'),
    ], today)).toMatchObject({ title: 'Последняя тренировка', workout: { id: 'latest' } })
    expect(trainerHomeContext([workout('cancelled', 'cancelled', '2026-09-30')], today)).toBeNull()
  })
})
