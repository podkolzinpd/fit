import { describe, expect, it } from 'vitest'
import { clientWorkoutAuthorLabel } from './workout-author'

describe('clientWorkoutAuthorLabel', () => {
  const trainers = [{ trainerId: 'trainer-1', firstName: 'Анна', lastName: 'Иванова', joinedAt: '2026-08-01T00:00:00Z', isRoot: true }]

  it('distinguishes own workouts from trainer assignments', () => {
    expect(clientWorkoutAuthorLabel('client-1', 'manual', 'client-1', trainers)).toBe('Создана вами')
    expect(clientWorkoutAuthorLabel('trainer-1', undefined, 'client-1', trainers)).toBe('Назначил Анна Иванова')
  })

  it('does not reveal an unknown trainer identity', () => {
    expect(clientWorkoutAuthorLabel('trainer-2', undefined, 'client-1', trainers)).toBe('Назначена тренером')
  })

  it('labels an assistant-generated program as created by AI, only in the client-authored branch', () => {
    expect(clientWorkoutAuthorLabel('client-1', 'ai', 'client-1', trainers)).toBe('Создана ИИ')
    expect(clientWorkoutAuthorLabel(null, 'ai', 'client-1', trainers)).toBe('Создана ИИ')
    // Origin is irrelevant once the trainer assigned the workout - the trainer branch never mentions AI.
    expect(clientWorkoutAuthorLabel('trainer-1', 'ai', 'client-1', trainers)).toBe('Назначил Анна Иванова')
  })
})
