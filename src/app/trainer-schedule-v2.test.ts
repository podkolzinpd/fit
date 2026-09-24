import { describe, expect, it } from 'vitest'

import { isTrainerScheduleV2Enabled } from './trainer-schedule-v2'

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
