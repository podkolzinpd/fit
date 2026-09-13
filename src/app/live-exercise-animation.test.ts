import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getLiveExerciseAnimation, setLiveExerciseAnimation, useLiveExerciseAnimation } from './live-exercise-animation'

describe('live exercise animation preference', () => {
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

  it('is enabled by default and isolated per user', () => {
    expect(getLiveExerciseAnimation('user-a')).toBe(true)
    setLiveExerciseAnimation('user-a', false)
    expect(getLiveExerciseAnimation('user-a')).toBe(false)
    expect(getLiveExerciseAnimation('user-b')).toBe(true)
  })

  it('applies changes immediately in the current tab', () => {
    const { result } = renderHook(() => useLiveExerciseAnimation('user-a'))
    expect(result.current).toBe(true)
    act(() => setLiveExerciseAnimation('user-a', false))
    expect(result.current).toBe(false)
  })
})
