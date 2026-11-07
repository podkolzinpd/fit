import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLiveExerciseAnimation, setLiveExerciseAnimation } from './live-exercise-animation'
import { getRpeDisplay, setRpeDisplay, useRpeDisplay } from './rpe-display'
import { getExercisePlanRestDisplay, setExercisePlanRestDisplay } from './exercise-plan-display'
import { getAppTheme, setAppTheme } from './theme'
import { getBodyMapDisplayMode, setBodyMapDisplayMode } from '../features/progress/body-map-appearance'

describe('existing preferences when device writes fail', () => {
  beforeEach(() => {
    localStorage.clear()
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    document.documentElement.className = ''
  })

  function rejectWrites() {
    return vi.spyOn(Object.hasOwn(window.localStorage, 'setItem') ? window.localStorage : Object.getPrototypeOf(window.localStorage) as Storage, 'setItem').mockImplementation(() => {
      throw new DOMException('Synthetic storage quota', 'QuotaExceededError')
    })
  }

  it('applies animation without changing the other account or its default', () => {
    rejectWrites()
    setLiveExerciseAnimation('storage-animation-a', false)
    expect(getLiveExerciseAnimation('storage-animation-a')).toBe(false)
    expect(getLiveExerciseAnimation('storage-animation-b')).toBe(true)
  })

  it('keeps RPE across editor unmount and remount in the same session', () => {
    rejectWrites()
    const first = renderHook(() => useRpeDisplay('storage-rpe-a'))
    act(() => setRpeDisplay('storage-rpe-a', true))
    expect(first.result.current).toBe(true)
    first.unmount()
    expect(renderHook(() => useRpeDisplay('storage-rpe-a')).result.current).toBe(true)
    expect(getRpeDisplay('storage-rpe-b')).toBe(false)
  })

  it('applies plan rest for the selected account only', () => {
    rejectWrites()
    setExercisePlanRestDisplay('storage-rest-a', true)
    expect(getExercisePlanRestDisplay('storage-rest-a')).toBe(true)
    expect(getExercisePlanRestDisplay('storage-rest-b')).toBe(false)
  })

  it('keeps the selected theme consistent with its displayed switch', () => {
    const next = getAppTheme() === 'light' ? 'dark' : 'light'
    rejectWrites()
    setAppTheme(next)
    expect(getAppTheme()).toBe(next)
  })

  it('keeps the body map choice in its existing account scope', () => {
    rejectWrites()
    setBodyMapDisplayMode('storage-map-a', 'trainer', undefined, 'list')
    expect(getBodyMapDisplayMode('storage-map-a', 'trainer', undefined, null)).toBe('list')
    expect(getBodyMapDisplayMode('storage-map-b', 'trainer', undefined, null)).toBe('real')
  })

  it('replaces a transient choice with the next successful write under the old key', () => {
    const blocked = rejectWrites()
    setRpeDisplay('storage-recovery', true)
    expect(getRpeDisplay('storage-recovery')).toBe(true)
    blocked.mockRestore()
    setRpeDisplay('storage-recovery', false)
    expect(getRpeDisplay('storage-recovery')).toBe(false)
    expect(localStorage.getItem('fit.rpeDisplay.storage-recovery')).toBe('false')
  })
})
