import { beforeEach, describe, expect, it, vi } from 'vitest'
import { markAchievementCompletion, takeAchievementCompletion } from './completion-marker'

const storage = new Map<string, string>()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
  })
})

describe('new achievement completion marker', () => {
  it('is absent for historical workouts and consumed only once after confirmed finish', () => {
    expect(takeAchievementCompletion('athlete', 'workout')).toBe(false)
    markAchievementCompletion('athlete', 'workout')
    expect(takeAchievementCompletion('athlete', 'workout')).toBe(true)
    expect(takeAchievementCompletion('athlete', 'workout')).toBe(false)
  })

  it('does not leak a marker between users or workouts', () => {
    markAchievementCompletion('athlete', 'workout')
    expect(takeAchievementCompletion('other', 'workout')).toBe(false)
    expect(takeAchievementCompletion('athlete', 'other')).toBe(false)
    expect(takeAchievementCompletion('athlete', 'workout')).toBe(true)
  })
})
