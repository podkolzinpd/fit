import { describe, expect, it } from 'vitest'
import { localDate } from '../../shared/local-date'
import {
  clientWorkoutHistoryCalendarDays,
  clientWorkoutHistoryMonthParam,
  clientWorkoutHistoryMonthRange,
  parseClientWorkoutHistoryCalendarState,
  shiftClientWorkoutHistoryMonth,
} from './client-workout-history-calendar'

const TODAY = localDate('2026-08-30')

describe('client workout history calendar', () => {
  it('keeps list as the default and normalizes invalid or future params', () => {
    expect(parseClientWorkoutHistoryCalendarState(new URLSearchParams(), TODAY)).toEqual({
      view: 'list', month: localDate('2026-08-01'), selectedDate: undefined,
    })
    expect(parseClientWorkoutHistoryCalendarState(new URLSearchParams('view=calendar&month=2027-03&date=oops'), TODAY)).toEqual({
      view: 'calendar', month: localDate('2026-08-01'), selectedDate: undefined,
    })
  })

  it('keeps a selected date only inside the visible historical month', () => {
    const valid = parseClientWorkoutHistoryCalendarState(
      new URLSearchParams('view=calendar&month=2026-07&date=2026-07-19'),
      TODAY,
    )
    expect(valid.selectedDate).toBe('2026-07-19')
    const outside = parseClientWorkoutHistoryCalendarState(
      new URLSearchParams('view=calendar&month=2026-07&date=2026-08-01'),
      TODAY,
    )
    expect(outside.selectedDate).toBeUndefined()
  })

  it('builds a stable Monday-first six-week grid and groups multiple workouts', () => {
    const workouts = [
      { id: 'one', workoutDate: localDate('2026-08-03') },
      { id: 'two', workoutDate: localDate('2026-08-03') },
      { id: 'three', workoutDate: localDate('2026-08-30') },
    ]
    const days = clientWorkoutHistoryCalendarDays(localDate('2026-08-01'), TODAY, workouts)
    expect(days).toHaveLength(42)
    expect(days[0]?.date).toBe('2026-07-27')
    expect(days[41]?.date).toBe('2026-09-06')
    expect(days.find((day) => day.date === '2026-08-03')?.workouts.map((workout) => workout.id)).toEqual(['one', 'two'])
    expect(days.find((day) => day.date === '2026-08-31')?.future).toBe(true)
  })

  it('supports leap February and bounded month queries', () => {
    const days = clientWorkoutHistoryCalendarDays(localDate('2028-02-01'), localDate('2028-02-29'), [])
    expect(days.filter((day) => day.inMonth)).toHaveLength(29)
    expect(clientWorkoutHistoryMonthRange(localDate('2026-07-01'), TODAY)).toEqual({
      from: localDate('2026-07-01'), to: localDate('2026-07-31'),
    })
    expect(clientWorkoutHistoryMonthRange(localDate('2026-08-01'), TODAY)).toEqual({
      from: localDate('2026-08-01'), to: TODAY,
    })
  })

  it('does not move beyond the current month', () => {
    expect(shiftClientWorkoutHistoryMonth(localDate('2026-07-01'), 1, TODAY)).toBe('2026-08-01')
    expect(shiftClientWorkoutHistoryMonth(localDate('2026-08-01'), 1, TODAY)).toBe('2026-08-01')
    expect(shiftClientWorkoutHistoryMonth(localDate('2026-08-01'), -1, TODAY)).toBe('2026-07-01')
    expect(clientWorkoutHistoryMonthParam(localDate('2026-07-19'))).toBe('2026-07')
  })
})
