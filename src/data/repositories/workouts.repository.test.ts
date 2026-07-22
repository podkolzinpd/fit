import { describe, expect, it } from 'vitest'
import type { Workout, WorkoutStatus, WorkoutSummary } from '../../shared/domain'
import { canTransition, computeClientStats, copyWorkout } from './workout-rules'
import { localDate } from '../../shared/local-date'

function summary(date: string, status: WorkoutStatus, id = date): WorkoutSummary {
  return { id, workoutDate: localDate(date), status }
}

const TODAY = localDate('2026-07-22')

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

describe('computeClientStats', () => {
  it('считает только выполненные тренировки и последнюю дату', () => {
    const stats = computeClientStats([
      summary('2026-07-05', 'done'),
      summary('2026-07-18', 'done'),
      summary('2026-07-25', 'planned'),
    ], TODAY)
    expect(stats.doneCount).toBe(2)
    expect(stats.lastWorkoutDate).toBe('2026-07-18')
  })

  it('процент выполнения = выполнено / (выполнено + пропущено)', () => {
    const stats = computeClientStats([
      summary('2026-07-05', 'done'),
      summary('2026-07-10', 'done'),
      summary('2026-07-12', 'done'),
      summary('2026-07-08', 'planned'), // пропущено: план в прошлом
      summary('2026-07-30', 'planned'), // будущее не входит в знаменатель
      summary('2026-07-22', 'in_progress'), // идёт — не считается
    ], TODAY)
    expect(stats.completionPercent).toBe(75)
  })

  it('возвращает null процент без выполненных и пропущенных', () => {
    const stats = computeClientStats([summary('2026-07-30', 'planned')], TODAY)
    expect(stats.completionPercent).toBeNull()
  })

  it('считает дни в работе от первой тренировки', () => {
    const stats = computeClientStats([
      summary('2026-07-02', 'done'),
      summary('2026-07-18', 'done'),
    ], TODAY)
    expect(stats.daysInWork).toBe(20)
  })

  it('дни в работе null, если тренировок нет', () => {
    const stats = computeClientStats([], TODAY)
    expect(stats.daysInWork).toBeNull()
  })

  it('помечает вниманием при последней тренировке 14+ дней назад', () => {
    const stats = computeClientStats([summary('2026-07-05', 'done')], TODAY)
    expect(stats.needsAttention).toBe(true)
  })

  it('не помечает вниманием при недавней тренировке', () => {
    const stats = computeClientStats([summary('2026-07-18', 'done')], TODAY)
    expect(stats.needsAttention).toBe(false)
  })
})
