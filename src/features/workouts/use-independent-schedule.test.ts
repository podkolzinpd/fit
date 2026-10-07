import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readIndependentSchedule, useIndependentSchedule } from './use-independent-schedule'

describe('actor-scoped independent schedule preference', () => {
  const originalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    if (originalStorage) Object.defineProperty(window, 'localStorage', originalStorage)
  })

  it('is default-off and persists only explicit true for the current actor', () => {
    expect(readIndependentSchedule('coach')).toBe(false)
    const { result, rerender } = renderHook(({ userId }) => useIndependentSchedule(userId), { initialProps: { userId: 'coach' } })
    act(() => result.current.change(true))
    expect(result.current.enabled).toBe(true)
    expect(readIndependentSchedule('coach')).toBe(true)
    rerender({ userId: 'other-coach' })
    expect(result.current.enabled).toBe(false)
    act(() => result.current.change(true))
    rerender({ userId: 'coach' })
    expect(result.current.enabled).toBe(true)
    act(() => result.current.change(false))
    expect(readIndependentSchedule('coach')).toBe(false)
    expect(readIndependentSchedule('other-coach')).toBe(true)
    expect(readIndependentSchedule(undefined)).toBe(false)
    window.localStorage.setItem('fit.lime-schedule-independent.coach', '1')
    expect(readIndependentSchedule('coach')).toBe(false)
  })

  it('stays usable with visible save failure and supports retry', () => {
    // Real jsdom Storage uses a WebIDL proxy: spying on its instance methods is
    // not equivalent to denying storage. Replace the window property explicitly.
    Object.defineProperty(window, 'localStorage', { configurable: true, value: {
      getItem: () => { throw new Error('unavailable') },
      setItem: () => { throw new Error('unavailable') },
    } })
    const { result, rerender } = renderHook(({ userId }) => useIndependentSchedule(userId), { initialProps: { userId: 'coach' } })
    expect(result.current.enabled).toBe(false)
    act(() => result.current.change(true))
    expect(result.current.enabled).toBe(true)
    expect(result.current.storageError).toBe(true)
    rerender({ userId: 'other-coach' })
    expect(result.current.enabled).toBe(false)
    expect(result.current.storageError).toBe(false)
    rerender({ userId: 'coach' })
    if (originalStorage) Object.defineProperty(window, 'localStorage', originalStorage)
    act(() => result.current.change(true))
    expect(result.current.storageError).toBe(false)
    expect(readIndependentSchedule('coach')).toBe(true)
  })
})
