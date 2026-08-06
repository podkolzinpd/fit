import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getRpeDisplay, setRpeDisplay } from './rpe-display'

describe('RPE display preference', () => {
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

  it('is hidden by default and stored separately for each trainer', () => {
    expect(getRpeDisplay('trainer-a')).toBe(false)

    setRpeDisplay('trainer-a', true)

    expect(getRpeDisplay('trainer-a')).toBe(true)
    expect(getRpeDisplay('trainer-b')).toBe(false)
  })
})
