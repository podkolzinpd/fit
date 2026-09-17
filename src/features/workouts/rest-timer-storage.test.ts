import { afterEach, describe, expect, it } from 'vitest'
import { readLiveRestOverrides, restDeadline, restoreRestDeadline, storeRestDeadline } from './rest-timer-storage'

afterEach(() => sessionStorage.clear())

describe('live rest timer storage', () => {
  it('creates a deadline only for a positive rest interval', () => {
    expect(restDeadline(90, 10_000)).toBe(100_000)
    expect(restDeadline(0, 10_000)).toBeNull()
  })

  it('restores an active deadline for the same workout after reload', () => {
    storeRestDeadline('workout-1', 20_000)

    expect(restoreRestDeadline('workout-1')).toBe(20_000)
    expect(restoreRestDeadline('workout-2')).toBeNull()
  })

  it('restores an expired timer so overdue time survives reload', () => {
    storeRestDeadline('workout-1', 10_000)
    expect(restoreRestDeadline('workout-1')).toBe(10_000)
  })

  it('does not restore a manually stopped or invalid timer', () => {
    storeRestDeadline('workout-1', 20_000)
    storeRestDeadline('workout-1', null)
    expect(restoreRestDeadline('workout-1')).toBeNull()
    sessionStorage.setItem('fit:live-rest-until:workout-1', '-1')
    expect(restoreRestDeadline('workout-1')).toBeNull()
  })

  it('ignores corrupt or invalid live-only rest overrides', () => {
    sessionStorage.setItem('test', '{')
    expect(readLiveRestOverrides('test')).toEqual({})
    sessionStorage.setItem('test', JSON.stringify({ good: 90, off: 0, bad: -2, huge: 100000, text: '30' }))
    expect(readLiveRestOverrides('test')).toEqual({ good: 90, off: 0 })
  })
})
