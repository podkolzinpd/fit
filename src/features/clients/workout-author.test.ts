import { describe, expect, it } from 'vitest'
import { clientWorkoutAuthorLabel } from './workout-author'

describe('clientWorkoutAuthorLabel', () => {
  const trainers = [{ trainerId: 'trainer-1', firstName: 'Анна', lastName: 'Иванова', joinedAt: '2026-08-01T00:00:00Z', isRoot: true }]

  it('distinguishes own workouts from trainer assignments', () => {
    expect(clientWorkoutAuthorLabel('client-1', 'client-1', trainers)).toBe('Создана вами')
    expect(clientWorkoutAuthorLabel('trainer-1', 'client-1', trainers)).toBe('Назначил Анна Иванова')
  })

  it('does not reveal an unknown trainer identity', () => {
    expect(clientWorkoutAuthorLabel('trainer-2', 'client-1', trainers)).toBe('Назначена тренером')
  })
})
