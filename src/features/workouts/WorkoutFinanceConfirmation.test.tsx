import { describe, expect, it } from 'vitest'
import type { TrainerFinanceClientBundle } from '../../data/repositories/trainer-finance.repository'
import { workoutFinanceConfirmation } from './WorkoutFinanceConfirmation'

const bundle: TrainerFinanceClientBundle = {
  clientId: 'client',
  packages: [{ id: 'package', clientId: 'client', trainerId: 'trainer', kind: 'session_pack', title: '10 тренировок', sessionsTotal: 10, sessionsUsed: 3, sessionsRemaining: 7, priceCents: 3000000, paidCents: 3000000, dueCents: 0, startsOn: '2026-09-01', endsOn: null, paymentDueOn: null, comment: null, packageStatus: 'active', paymentStatus: 'paid', closedAt: null, version: 1, createdAt: '', updatedAt: '' }],
  payments: [],
  sessions: [{ id: 'session', packageId: 'package', workoutId: 'workout', disposition: 'charged', source: 'automatic', comment: null, workoutDate: '2026-09-30', voidedAt: null, voidReason: null, version: 1, createdAt: '', updatedAt: '' }],
}

describe('workoutFinanceConfirmation', () => {
  it('shows the package and remaining sessions after an automatic charge', () => {
    expect(workoutFinanceConfirmation(bundle, 'workout')).toEqual({ title: 'Занятие списано', detail: '10 тренировок · осталось 7' })
  })

  it('does not show finance when the trainer has not enabled it for the workout', () => {
    expect(workoutFinanceConfirmation(bundle, 'another-workout')).toBeNull()
  })
})
