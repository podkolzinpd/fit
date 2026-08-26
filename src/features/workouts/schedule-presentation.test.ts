import { describe, expect, it } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { formatScheduleDateLabel, mondayWeekStart, scheduleEventStatus, scheduleExerciseLine, scheduleFocusMinutes } from './schedule-presentation'

function workout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: 'workout-1',
    clientId: 'client-1',
    clientName: 'Антоха',
    workoutDate: localDate('2026-08-26'),
    startTime: '07:10',
    endTime: '08:00',
    startedAt: null,
    completedAt: null,
    status: 'planned',
    notes: null,
    stageId: null,
    stageTitle: null,
    version: 1,
    exercises: [],
    ...overrides,
  }
}

describe('schedule presentation', () => {
  it('starts the week on Monday, including for Sunday', () => {
    expect(mondayWeekStart(localDate('2026-08-26'))).toBe('2026-08-24')
    expect(mondayWeekStart(localDate('2026-08-30'))).toBe('2026-08-24')
  })

  it('formats the selected date as an explicit day context', () => {
    expect(formatScheduleDateLabel(localDate('2026-08-26'))).toBe('Среда, 26 августа')
  })

  it('keeps two exercises and reports the remaining count', () => {
    expect(scheduleExerciseLine(['Велотренажёр', 'Жим ногами', 'Планка', 'Тяга'])).toBe('Велотренажёр, Жим ногами · ещё 2')
    expect(scheduleExerciseLine([])).toBe('Без упражнений')
  })

  it('uses explicit status labels instead of color alone', () => {
    const today = localDate('2026-08-26')
    expect(scheduleEventStatus(workout(), today)).toEqual({ label: 'План', tone: 'planned' })
    expect(scheduleEventStatus(workout({ status: 'in_progress' }), today)).toEqual({ label: 'Идёт', tone: 'current' })
    expect(scheduleEventStatus(workout({ status: 'done' }), today)).toEqual({ label: 'Готово', tone: 'done' })
    expect(scheduleEventStatus(workout({ status: 'cancelled' }), today)).toEqual({ label: 'Пропущена', tone: 'skipped' })
  })

  it('focuses the nearest workout, the first when all ended, or current time when empty', () => {
    const workouts = [
      workout({ id: 'early', startTime: '07:10', endTime: '08:00' }),
      workout({ id: 'late', startTime: '18:30', endTime: '19:30' }),
    ]
    expect(scheduleFocusMinutes(workouts, '12:00')).toBe(18 * 60 + 30)
    expect(scheduleFocusMinutes(workouts, '21:00')).toBe(7 * 60 + 10)
    expect(scheduleFocusMinutes([], '14:25')).toBe(14 * 60 + 25)
  })
})
