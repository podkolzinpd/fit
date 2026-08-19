import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isCoachmarkSeen, markCoachmarkSeen } from './coachmarks'

describe('coachmarks', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
  })

  it('is unseen until marked, then stays seen for that user and id', () => {
    expect(isCoachmarkSeen('user-1', 'trainer-progress-overview-2026-08')).toBe(false)
    markCoachmarkSeen('user-1', 'trainer-progress-overview-2026-08')
    expect(isCoachmarkSeen('user-1', 'trainer-progress-overview-2026-08')).toBe(true)
  })

  it('keeps coachmarks scoped per user', () => {
    markCoachmarkSeen('user-1', 'trainer-progress-overview-2026-08')
    expect(isCoachmarkSeen('user-2', 'trainer-progress-overview-2026-08')).toBe(false)
  })

  it('keeps coachmarks scoped per id for the same user', () => {
    markCoachmarkSeen('user-1', 'trainer-progress-overview-2026-08')
    expect(isCoachmarkSeen('user-1', 'other-coachmark')).toBe(false)
  })

  it('is a no-op without a userId', () => {
    markCoachmarkSeen(undefined, 'trainer-progress-overview-2026-08')
    expect(isCoachmarkSeen(undefined, 'trainer-progress-overview-2026-08')).toBe(false)
  })
})
