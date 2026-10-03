import { describe, expect, it } from 'vitest'
import type { Workout } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { compactScheduleClientName, compactScheduleEventLabel, compactScheduleTime, formatScheduleDateLabel, layoutScheduleTimelineEvents, mondayWeekStart, scheduleEventStatus, scheduleExerciseLine, scheduleFocusMinutes, scheduleHourLabelCollidesWithNow, scheduleTimelineScrollTop } from './schedule-presentation'

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

  it('keeps time and a short client name readable in a seven-column calendar', () => {
    expect(compactScheduleTime('08:00:00')).toBe('8')
    expect(compactScheduleTime('18:30:00')).toBe('18:30')
    expect(compactScheduleTime(null)).toBe('—')
    expect(compactScheduleClientName('Анна Смирнова')).toBe('Ан')
    expect(compactScheduleClientName('Ян')).toBe('Ян')
    expect(compactScheduleEventLabel('08:00:00', 'Анна Смирнова')).toBe('8\u2009Ан')
    expect(compactScheduleEventLabel('18:30:00', 'Анна Смирнова')).toBe('18:30\u2009А')
  })

  it('keeps two exercises and reports the remaining count', () => {
    expect(scheduleExerciseLine(['Велотренажёр', 'Жим ногами', 'Планка', 'Тяга'])).toBe('Велотренажёр, Жим ногами · ещё 2')
    expect(scheduleExerciseLine([])).toBe('Без упражнений')
  })

  it('uses explicit status labels instead of color alone', () => {
    const today = localDate('2026-08-26')
    expect(scheduleEventStatus(workout(), today)).toEqual({ label: 'План', tone: 'planned' })
    expect(scheduleEventStatus(workout({ workoutDate: localDate('2026-08-25') }), today)).toEqual({ label: 'План', tone: 'decision' })
    expect(scheduleEventStatus(workout({ status: 'in_progress' }), today)).toEqual({ label: 'Идёт', tone: 'current' })
    expect(scheduleEventStatus(workout({ status: 'done' }), today)).toEqual({ label: 'Готово', tone: 'done' })
    expect(scheduleEventStatus(workout({ status: 'cancelled' }), today)).toEqual({ label: 'Пропущена', tone: 'skipped' })
  })

  it('marks only trainer-assigned workouts started and finished by the same athlete', () => {
    const today = localDate('2026-08-26')
    const actors = { trainerId: 'trainer-1', createdBy: 'trainer-1', startedBy: 'client-1', completedBy: 'client-1' }
    expect(scheduleEventStatus(workout({ status: 'done', ...actors }), today))
      .toEqual({ label: 'Самостоятельно', tone: 'self-led' })
    expect(scheduleEventStatus(workout({ status: 'done', ...actors, completedBy: 'trainer-1' }), today))
      .toEqual({ label: 'Готово', tone: 'done' })
    expect(scheduleEventStatus(workout({ status: 'done', ...actors, createdBy: 'client-1' }), today))
      .toEqual({ label: 'Готово', tone: 'done' })
    expect(scheduleEventStatus(workout({ status: 'done', trainerId: 'trainer-1', createdBy: 'trainer-1' }), today))
      .toEqual({ label: 'Готово', tone: 'done' })
  })

  it('focuses the nearest workout, the first when all ended, or current time when empty', () => {
    const workouts = [
      workout({ id: 'early', startTime: '07:10', endTime: '08:00' }),
      workout({ id: 'late', startTime: '18:30', endTime: '19:30' }),
    ]
    expect(scheduleFocusMinutes(workouts, '12:00')).toBe(18 * 60 + 30)
    expect(scheduleFocusMinutes(workouts, '21:00')).toBe(7 * 60 + 10)
    expect(scheduleFocusMinutes([], '14:25')).toBe(14 * 60 + 25)
    expect(scheduleFocusMinutes([
      workout({ id: 'early', startTime: '07:10', endTime: '08:00' }),
      workout({ id: 'late', startTime: '23:50', endTime: '00:20' }),
    ], '23:55')).toBe(23 * 60 + 50)
  })

  it('keeps useful context above the focused time instead of pinning it to the top', () => {
    expect(scheduleTimelineScrollTop(15 * 60 + 3, 400, 56)).toBeCloseTo(707, 0)
    expect(scheduleTimelineScrollTop(60, 800, 56)).toBe(0)
  })

  it('places overlapping and short workouts in separate tappable lanes', () => {
    const events = layoutScheduleTimelineEvents([
      workout({ id: 'a', startTime: '14:00', endTime: '14:10' }),
      workout({ id: 'b', startTime: '14:15', endTime: '14:30' }),
      workout({ id: 'c', startTime: '16:00', endTime: '17:00' }),
    ], 56)
    expect(events.map(({ workout: item, column, columns, height }) => [item.id, column, columns, height])).toEqual([
      ['a', 0, 2, 54], ['b', 1, 2, 54], ['c', 0, 1, 56],
    ])
  })

  it('uses the compact hour scale without shrinking a tappable event below 44px', () => {
    const events = layoutScheduleTimelineEvents([
      workout({ id: '30m', startTime: '09:00', endTime: '09:30' }),
      workout({ id: '45m', startTime: '10:00', endTime: '10:45' }),
      workout({ id: '60m', startTime: '11:00', endTime: '12:00' }),
      workout({ id: '90m', startTime: '13:00', endTime: '14:30' }),
    ], 44, 44)
    expect(events.map(({ workout: item, top, height }) => [item.id, top, height])).toEqual([
      ['30m', 9 * 44, 44],
      ['45m', 10 * 44, 44],
      ['60m', 11 * 44, 44],
      ['90m', 13 * 44, 66],
    ])
  })

  it('keeps three simultaneous workouts distinct and reuses a lane afterwards', () => {
    const events = layoutScheduleTimelineEvents([
      workout({ id: 'a', startTime: '14:00', endTime: '15:00' }),
      workout({ id: 'b', startTime: '14:05', endTime: '14:20' }),
      workout({ id: 'c', startTime: '14:10', endTime: '14:30' }),
      workout({ id: 'd', startTime: '15:15', endTime: '16:00' }),
    ], 56)
    expect(events.map(({ workout: item, column, columns }) => [item.id, column, columns])).toEqual([
      ['a', 0, 3], ['b', 1, 3], ['c', 2, 3], ['d', 0, 1],
    ])
  })

  it('keeps late and across-midnight workouts visible without hiding untimed items', () => {
    const events = layoutScheduleTimelineEvents([
      workout({ id: 'untimed', startTime: null, endTime: null }),
      workout({ id: 'late', startTime: '23:50', endTime: null }),
      workout({ id: 'midnight', startTime: '23:55', endTime: '00:25' }),
    ], 56)
    expect(events.map(({ workout: item }) => item.id)).toEqual(['late', 'midnight'])
    expect(events[0]?.top).toBeGreaterThan(23 * 56)
    expect(events[1]?.height).toBe(54)
    expect(events.map((event) => event.columns)).toEqual([2, 2])
  })

  it('hides an hourly label only when the live marker would overlap it', () => {
    expect(scheduleHourLabelCollidesWithNow(15, 15 * 60 + 3)).toBe(true)
    expect(scheduleHourLabelCollidesWithNow(15, 15 * 60 + 11)).toBe(false)
    expect(scheduleHourLabelCollidesWithNow(14, 15 * 60 + 3)).toBe(false)
  })

  it('Lime protects labels on both sides of the hour at both densities', () => {
    for (const height of [44, 56]) {
      expect(scheduleHourLabelCollidesWithNow(17, 16 * 60 + 51, height)).toBe(true)
      expect(scheduleHourLabelCollidesWithNow(17, 17 * 60 + 3, height)).toBe(true)
      expect(scheduleHourLabelCollidesWithNow(17, 17 * 60 + 30, height)).toBe(false)
    }
  })

  it('Lime adjacent hourly sessions do not acquire false collision lanes', () => {
    for (const height of [44, 56]) {
      const events = layoutScheduleTimelineEvents([
        workout({ id: 'a', startTime: '14:00', endTime: '15:00' }),
        workout({ id: 'b', startTime: '15:00', endTime: '16:00' }),
      ], height, height === 44 ? 44 : 54, 0)
      expect(events.map((event) => event.columns)).toEqual([1, 1])
      expect(events.every((event) => event.height >= 44)).toBe(true)
    }
  })
})
