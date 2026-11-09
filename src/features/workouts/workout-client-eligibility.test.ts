import { describe, expect, it } from 'vitest'
import { isWorkoutClient } from './workout-client-eligibility'

describe('new workout client eligibility', () => {
  it('accepts server-approved manual cards and excludes archived or disconnected cards', () => {
    expect(isWorkoutClient({ hasAccount: false, archivedAt: null, canCreateWorkout: true })).toBe(true)
    expect(isWorkoutClient({ hasAccount: true, archivedAt: '2026-11-07', canCreateWorkout: true })).toBe(false)
    expect(isWorkoutClient({ hasAccount: true, archivedAt: null, canCreateWorkout: false })).toBe(false)
    expect(isWorkoutClient({ hasAccount: true, archivedAt: null, canCreateWorkout: true })).toBe(true)
  })
})
