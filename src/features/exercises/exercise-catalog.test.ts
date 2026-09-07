import { describe, expect, it } from 'vitest'
import type { ClientActor, TrainerActor } from '../../shared/domain'
import { customExercisePartitionOwner } from './exercise-catalog'

describe('customExercisePartitionOwner', () => {
  it('keeps a trainer custom exercise in the trainer partition', () => {
    const actor: TrainerActor = {
      kind: 'trainer', role: 'trainer', userId: 'trainer-1', email: null,
      firstName: 'Анна', lastName: null, timezone: 'Europe/Moscow',
    }

    expect(customExercisePartitionOwner(actor)).toBe('trainer-1')
  })

  it('keeps a client custom exercise in the client workout partition', () => {
    const actor: ClientActor = {
      kind: 'client', role: 'client', userId: 'client-user-1', clientId: 'client-card-1',
      trainerId: 'partition-owner-1', fullName: 'Клиент', email: null,
      firstName: 'Клиент', lastName: null, timezone: 'Europe/Moscow',
    }

    expect(customExercisePartitionOwner(actor)).toBe('partition-owner-1')
  })
})
