import { describe, expect, it } from 'vitest'
import type { Workout } from '../../shared/domain'
import { canTransition, copyWorkout } from './workout-rules'
import { localDate } from '../../shared/local-date'

describe('workouts repository rules', () => {
  it('разрешает только последовательные переходы', () => {
    expect(canTransition('planned', 'in_progress')).toBe(true)
    expect(canTransition('planned', 'done')).toBe(false)
    expect(canTransition('in_progress', 'done')).toBe(true)
  })

  it('копирует план без факта и идентификаторов', () => {
    const source: Workout = {
      id: 'w1', clientId: 'c1', clientName: 'Анна', workoutDate: localDate('2026-07-21'),
      startTime: null, endTime: null, status: 'done', notes: null, version: 3,
      exercises: [{ id: 'e1', source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0,
        sets: [{ id: 's1', position: 0, weightKg: 50, reps: 10, fact: { weightKg: 55, reps: 9 }, confirmedAt: 'now', version: 2 }] }],
    }
    const copy = copyWorkout(source, localDate('2026-07-22'))
    expect(copy.id).toBeUndefined()
    expect(copy.exercises[0]?.sets[0]).toEqual({ position: 0, weightKg: 50, reps: 10, durationMin: undefined, distanceKm: undefined })
  })
})
