import { describe, expect, it } from 'vitest'
import { buildFitLimeCalendarPlan } from './fit-lime-calendar-plan.js'

describe('bounded Fit Lime visual calendar plan', () => {
  it('creates 15 named clients and 60 diverse workouts across three Monday weeks', () => {
    const plan = buildFitLimeCalendarPlan('trainer-a', '2026-09-28', '2026-10-03')
    expect(plan.clients).toHaveLength(15)
    expect(plan.workouts).toHaveLength(60)
    expect(new Set(plan.workouts.map((item) => item.id)).size).toBe(60)
    expect(plan.clients.every((item) => !/демо|тест/i.test(item.fullName))).toBe(true)
    expect(plan.workouts.filter((item) => item.status === 'in_progress')).toHaveLength(1)
    expect(plan.workouts.filter((item) => item.status === 'in_progress')[0]?.workoutDate).toBe('2026-10-03')
    expect(plan.workouts.some((item) => item.status === 'done')).toBe(true)
    expect(plan.workouts.some((item) => item.status === 'planned')).toBe(true)
    expect(plan.workouts.some((item) => item.status === 'cancelled')).toBe(true)
    expect(plan.workouts.some((item) => item.startTime === null)).toBe(true)
    expect(plan.workouts.some((item) => !item.withExercises)).toBe(true)
    expect(plan.workouts.some((item) => item.withExercises)).toBe(true)
    expect(plan.workouts.map((item) => item.workoutDate).sort()[0]).toBe('2026-09-21')
    expect(plan.workouts.map((item) => item.workoutDate).sort().at(-1)).toBe('2026-10-10')
    expect(plan.workouts.filter((item) => item.workoutDate === '2026-10-04')).toHaveLength(0)
  })
  it('keeps deterministic identities for retries but never shares them across trainers', () => {
    const first = buildFitLimeCalendarPlan('trainer-a', '2026-09-28', '2026-10-03')
    expect(first).toEqual(buildFitLimeCalendarPlan('trainer-a', '2026-09-28', '2026-10-03'))
    const second = buildFitLimeCalendarPlan('trainer-b', '2026-09-28', '2026-10-03')
    const ids = new Set(first.clients.map((item) => item.id))
    expect(second.clients.some((item) => ids.has(item.id))).toBe(false)
    expect(first.clients.every((item) => /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/.test(item.id))).toBe(true)
  })
})
