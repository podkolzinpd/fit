import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCoachLiveDensity, setCoachLiveDensity, useCoachLiveDensity } from './coach-live-density'

describe('per-account coach Live density', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
  const values = new Map<string, string>()
  beforeEach(() => {
    values.clear()
    Object.defineProperty(window, 'localStorage', { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } })
  })
  afterEach(() => { vi.restoreAllMocks(); if (original) Object.defineProperty(window, 'localStorage', original) })

  it('defaults to original and stores only the selected account on this device', () => {
    const { result, rerender } = renderHook(({ id }) => useCoachLiveDensity(id), { initialProps: { id: 'one' } })
    expect(result.current).toBe('original')
    act(() => setCoachLiveDensity('one', 'compact'))
    expect(result.current).toBe('compact')
    expect(values.get('fit.coachLiveDensity.one')).toBe('compact')
    rerender({ id: 'two' }); expect(result.current).toBe('original')
    rerender({ id: 'one' }); expect(result.current).toBe('compact')
    act(() => setCoachLiveDensity('one', 'original'))
    expect(result.current).toBe('original')
  })
  it('rejects unknown saved values and reacts to a real storage update', () => {
    values.set('fit.coachLiveDensity.external', 'unknown')
    const { result } = renderHook(() => useCoachLiveDensity('external'))
    expect(result.current).toBe('original')
    values.set('fit.coachLiveDensity.external', 'compact')
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'fit.coachLiveDensity.external', newValue: 'compact' })))
    expect(result.current).toBe('compact')
    expect(getCoachLiveDensity(undefined)).toBe('original')
  })
  it('keeps a session preference per account even when reads or writes are denied', () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('blocked') } })
    const { result } = renderHook(() => useCoachLiveDensity('private-one'))
    act(() => setCoachLiveDensity('private-one', 'compact'))
    expect(result.current).toBe('compact')
    expect(getCoachLiveDensity('private-two')).toBe('original')
    act(() => setCoachLiveDensity('private-one', 'original'))
    expect(result.current).toBe('original')
  })
})
