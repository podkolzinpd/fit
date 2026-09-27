import { describe, expect, it } from 'vitest'

import type { SessionActor } from '../shared/domain'
import { isFitLimeEnabled } from './fit-lime'

const trainer: SessionActor = {
  kind: 'trainer', role: 'trainer', userId: 'trainer-1', email: null,
  firstName: null, lastName: null, timezone: 'Europe/Moscow',
}

describe('isFitLimeEnabled', () => {
  it('requires the distinct server flag even when Schedule V2 is enabled', () => {
    expect(isFitLimeEnabled({ ...trainer, experiments: { trainerScheduleV2: true } })).toBe(false)
    expect(isFitLimeEnabled({ ...trainer, experiments: { trainerScheduleV2: false, fitLime: true } })).toBe(true)
    expect(isFitLimeEnabled({ ...trainer, experiments: { trainerScheduleV2: true, fitLime: false } })).toBe(false)
  })

  it('never enables Fit Lime for a client or unauthenticated visitor', () => {
    expect(isFitLimeEnabled({ ...trainer, kind: 'client', role: 'client', clientId: 'client-1', trainerId: 'trainer-1', fullName: 'Клиент', experiments: { trainerScheduleV2: true, fitLime: true } })).toBe(false)
    expect(isFitLimeEnabled(null)).toBe(false)
  })
})
