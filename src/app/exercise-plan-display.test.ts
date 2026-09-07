import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getExercisePlanRestDisplay, setExercisePlanRestDisplay, useExercisePlanRestDisplay } from './exercise-plan-display'

describe('exercise plan rest display', () => {
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

  it('keeps the preference isolated per trainer', () => {
    setExercisePlanRestDisplay('trainer-a', true)
    expect(getExercisePlanRestDisplay('trainer-a')).toBe(true)
    expect(getExercisePlanRestDisplay('trainer-b')).toBe(false)
  })

  it('updates mounted editors in the current tab', () => {
    const { result } = renderHook(() => useExercisePlanRestDisplay('trainer-a'))
    expect(result.current).toBe(false)
    act(() => setExercisePlanRestDisplay('trainer-a', true))
    expect(result.current).toBe(true)
  })
})
