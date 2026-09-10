import { afterEach, describe, expect, it } from 'vitest'
import { restDeadline, restoreRestDeadline, storeRestDeadline } from './rest-timer-storage'

afterEach(() => sessionStorage.clear())

describe('live rest timer storage', () => {
  it('creates a deadline only for a positive rest interval', () => {
    expect(restDeadline(90, 10_000)).toBe(100_000)
    expect(restDeadline(0, 10_000)).toBeNull()
  })

  it('restores an active deadline for the same workout after reload', () => {
    storeRestDeadline('workout-1', 20_000)

    expect(restoreRestDeadline('workout-1', 10_000)).toBe(20_000)
    expect(restoreRestDeadline('workout-2', 10_000)).toBeNull()
  })

  it('does not restore an expired or manually stopped timer', () => {
    storeRestDeadline('workout-1', 10_000)
    expect(restoreRestDeadline('workout-1', 10_000)).toBeNull()

    storeRestDeadline('workout-1', 20_000)
    storeRestDeadline('workout-1', null)
    expect(restoreRestDeadline('workout-1', 10_000)).toBeNull()
  })
})
