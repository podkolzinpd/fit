import { describe, expect, it } from 'vitest'
import type { Workout } from '../../shared/domain'
import { clientWorkoutAuthorLabel, clientWorkoutCardLabel } from './workout-author'

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

describe('clientWorkoutCardLabel', () => {
  const trainers = [{ trainerId: 'trainer-1', firstName: 'Анна', lastName: 'Иванова', joinedAt: '2026-08-01T00:00:00Z', isRoot: true }]

  function workout(overrides: Partial<Workout>): Workout {
    return {
      id: 'workout-1', clientId: 'client-1', clientName: 'Клиент', createdBy: 'client-1', origin: 'manual',
      favoriteTitle: null, startedBy: null, completedBy: null, workoutDate: '2026-09-25' as Workout['workoutDate'],
      startTime: null, endTime: null, startedAt: null, completedAt: null, status: 'planned', notes: null,
      stageId: null, stageTitle: null, version: 1, exercises: [],
      ...overrides,
    }
  }

  it('prepends the truncated favorite title to the author label, variant C3', () => {
    const result = clientWorkoutCardLabel(workout({ favoriteTitle: 'Ноги и спина' }), 'client-1', trainers)
    expect(result).toBe('⭐ Ноги и спина · Создана вами')
  })

  it('does not touch the label for a workout not planned from a favorite', () => {
    expect(clientWorkoutCardLabel(workout({}), 'client-1', trainers)).toBe('Создана вами')
  })

  it('shows the AI author label alongside the favorite title when both apply', () => {
    const result = clientWorkoutCardLabel(workout({ favoriteTitle: 'Утро', origin: 'ai' }), 'client-1', trainers)
    expect(result).toBe('⭐ Утро · Создана ИИ')
  })

  it('truncates a long favorite title but never the author suffix', () => {
    const result = clientWorkoutCardLabel(
      workout({ favoriteTitle: 'Очень длинное название избранной тренировки' }),
      'client-1',
      trainers,
    )
    expect(result).toBe('⭐ Очень длинное название… · Создана вами')
  })

  it('works for a trainer-assigned workout too', () => {
    const result = clientWorkoutCardLabel(workout({ favoriteTitle: 'Ноги', createdBy: 'trainer-1' }), 'client-1', trainers)
    expect(result).toBe('⭐ Ноги · Назначил Анна Иванова')
  })
})
