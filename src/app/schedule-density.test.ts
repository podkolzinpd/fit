import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readStoredScheduleDensity, SCHEDULE_HOUR_HEIGHT } from './schedule-density'

describe('schedule density preference', () => {
  const originalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')
  const values = new Map<string, string>()

  beforeEach(() => {
    values.clear()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    })
  })

  afterEach(() => {
    if (originalStorage) Object.defineProperty(window, 'localStorage', originalStorage)
  })

  it('uses the approved 56px and 44px hour scales', () => {
    expect(SCHEDULE_HOUR_HEIGHT).toEqual({ comfortable: 56, compact: 44 })
  })

  it('reads only supported per-account values', () => {
    values.set('fit.scheduleDensity.trainer-a', 'compact')
    values.set('fit.scheduleDensity.trainer-b', 'tiny')

    expect(readStoredScheduleDensity('trainer-a')).toBe('compact')
    expect(readStoredScheduleDensity('trainer-b')).toBeUndefined()
    expect(readStoredScheduleDensity(undefined)).toBeUndefined()
  })
})
