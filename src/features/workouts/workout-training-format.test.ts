import { describe, expect, it } from 'vitest'
import type { TrainerFinancePackage } from '../../data/repositories/trainer-finance.repository'
import { defaultWorkoutTrainingFormat, workoutTrainingFormatLabel } from './workout-training-format'

function service(overrides: Partial<TrainerFinancePackage>): TrainerFinancePackage {
  return {
    id: crypto.randomUUID(), clientId: crypto.randomUUID(), trainerId: crypto.randomUUID(),
    kind: 'session_pack', title: 'Абонемент', sessionsTotal: 10, sessionsUsed: 0,
    sessionsRemaining: 10, priceCents: 10_000, paidCents: 0, dueCents: 10_000,
    startsOn: '2026-10-01', endsOn: null, paymentDueOn: null, comment: null,
    packageStatus: 'active', paymentStatus: 'unpaid', closedAt: null, version: 1,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('workout training format', () => {
  it('defaults a live session pack to training with trainer', () => {
    expect(defaultWorkoutTrainingFormat([service({})], '2026-10-02')).toBe('with_trainer')
  })

  it('lets online coaching win when both services are active', () => {
    const online = service({ kind: 'online_coaching', sessionsTotal: 0, sessionsRemaining: 0, endsOn: '2026-11-01' })
    expect(defaultWorkoutTrainingFormat([service({}), online], '2026-10-02')).toBe('self')
  })

  it('ignores closed, expired and exhausted session packs', () => {
    expect(defaultWorkoutTrainingFormat([
      service({ closedAt: '2026-10-01T00:00:00.000Z' }),
      service({ endsOn: '2026-09-30' }),
      service({ sessionsRemaining: 0 }),
    ], '2026-10-02')).toBe('self')
  })

  it('uses short user-facing labels', () => {
    expect(workoutTrainingFormatLabel('self')).toBe('Самостоятельно')
    expect(workoutTrainingFormatLabel('with_trainer')).toBe('С тренером')
  })
})
