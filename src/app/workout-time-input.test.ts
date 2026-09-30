import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getWorkoutTimeWheel, setWorkoutTimeWheel, useWorkoutTimeWheel } from './workout-time-input'

describe('workout time input preference', () => {
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

  it('starts with the keyboard and updates the current page immediately', () => {
    const { result } = renderHook(useWorkoutTimeWheel)
    expect(result.current).toBe(false)
    act(() => setWorkoutTimeWheel(true))
    expect(result.current).toBe(true)
    expect(getWorkoutTimeWheel()).toBe(true)
    act(() => setWorkoutTimeWheel(false))
    expect(result.current).toBe(false)
  })

  it('keeps the keyboard when storage is unavailable', () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('blocked') } })
    expect(getWorkoutTimeWheel()).toBe(false)
    act(() => setWorkoutTimeWheel(true))
    expect(getWorkoutTimeWheel()).toBe(true)
  })
})
