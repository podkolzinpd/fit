import { describe, expect, it } from 'vitest'

import { isTrainerScheduleV2CalendarRoute, isTrainerScheduleV2Enabled } from './trainer-schedule-v2'

const trainer = {
  kind: 'trainer' as const,
  role: 'trainer' as const,
  userId: 'trainer-1',
  email: null,
  firstName: null,
  lastName: null,
  timezone: 'Europe/Moscow',
}

describe('isTrainerScheduleV2Enabled', () => {
  it('requires both the trainer role and the server experiment', () => {
    expect(isTrainerScheduleV2Enabled({ ...trainer, experiments: { trainerScheduleV2: true } })).toBe(true)
    expect(isTrainerScheduleV2Enabled({ ...trainer, experiments: { trainerScheduleV2: false } })).toBe(false)
    expect(isTrainerScheduleV2Enabled(trainer)).toBe(false)
    expect(isTrainerScheduleV2Enabled({ ...trainer, kind: 'client', role: 'client', clientId: 'client-1', trainerId: 'trainer-1', fullName: 'Клиент', experiments: { trainerScheduleV2: true } })).toBe(false)
  })
})

describe('isTrainerScheduleV2CalendarRoute', () => {
  it('keeps the calendar on ordinary trainer days and the schedule', () => {
    expect(isTrainerScheduleV2CalendarRoute('/today', '')).toBe(true)
    expect(isTrainerScheduleV2CalendarRoute('/today', '?date=2026-09-24')).toBe(true)
    expect(isTrainerScheduleV2CalendarRoute('/schedule', '?range=2w')).toBe(true)
  })

  it('leaves every workout entry step on the existing composer', () => {
    for (const view of ['compose', 'review', 'save']) {
      expect(isTrainerScheduleV2CalendarRoute('/today', `?view=${view}`)).toBe(false)
    }
    expect(isTrainerScheduleV2CalendarRoute('/today', '?classic=1')).toBe(false)
    expect(isTrainerScheduleV2CalendarRoute('/clients', '')).toBe(false)
  })
})
