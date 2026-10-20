import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getClientLiveDensity, setClientLiveDensity, useClientLiveDensity } from './client-live-density'

describe('per-account client Live density', () => {
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
    const { result, rerender } = renderHook(({ id }) => useClientLiveDensity(id), { initialProps: { id: 'one' } })
    expect(result.current).toBe('original')
    act(() => setClientLiveDensity('one', 'compact'))
    expect(result.current).toBe('compact')
    expect(values.get('fit.clientLiveDensity.one')).toBe('compact')
    rerender({ id: 'two' }); expect(result.current).toBe('original')
    rerender({ id: 'one' }); expect(result.current).toBe('compact')
    act(() => setClientLiveDensity('one', 'original'))
    expect(result.current).toBe('original')
  })
  it('rejects unknown saved values and reacts to a real storage update', () => {
    values.set('fit.clientLiveDensity.external', 'unknown')
    const { result } = renderHook(() => useClientLiveDensity('external'))
    expect(result.current).toBe('original')
    values.set('fit.clientLiveDensity.external', 'compact')
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'fit.clientLiveDensity.external', newValue: 'compact' })))
    expect(result.current).toBe('compact')
    expect(getClientLiveDensity(undefined)).toBe('original')
  })
  it('keeps a session preference per account even when reads or writes are denied', () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('blocked') } })
    const { result } = renderHook(() => useClientLiveDensity('private-one'))
    act(() => setClientLiveDensity('private-one', 'compact'))
    expect(result.current).toBe('compact')
    expect(getClientLiveDensity('private-two')).toBe('original')
    act(() => setClientLiveDensity('private-one', 'original'))
    expect(result.current).toBe('original')
  })
})
