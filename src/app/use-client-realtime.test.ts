import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientRealtimeChange } from '../data/repositories/realtime.repository'

const realtimeMocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('../data/repositories/realtime.repository', () => ({
  realtimeRepository: { subscribeToClientChanges: realtimeMocks.subscribe },
}))

import { clientRealtimeQueryKeys, useClientRealtime } from './use-client-realtime'

let hidden = false

beforeEach(() => {
  vi.useFakeTimers()
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  realtimeMocks.subscribe.mockReset()
  realtimeMocks.unsubscribe.mockReset()
  realtimeMocks.subscribe.mockReturnValue(realtimeMocks.unsubscribe)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('clientRealtimeQueryKeys', () => {
  it('targets one workout and dependent lists for a workout event', () => {
    expect(clientRealtimeQueryKeys('client-1', {
      table: 'workouts',
      eventType: 'UPDATE',
      new: { id: 'workout-1', client_id: 'client-1' },
      old: {},
    })).toEqual([
      ['workout', 'workout-1'],
      ['workouts'],
      ['client-stats', 'client-1'],
    ])
  })

  it('does not invalidate workouts for a progress event', () => {
    expect(clientRealtimeQueryKeys('client-1', {
      table: 'client_progress',
      eventType: 'INSERT',
      new: { id: 'progress-1', client_id: 'client-1' },
      old: {},
    })).toEqual([
      ['progress', 'client-1'],
      ['client', 'client-1'],
    ])
  })

  it('uses the deleted row id for delete events', () => {
    expect(clientRealtimeQueryKeys('client-1', {
      table: 'workouts',
      eventType: 'DELETE',
      new: {},
      old: { id: 'workout-1', client_id: 'client-1' },
    })[0]).toEqual(['workout', 'workout-1'])
  })

  it('debounces events and invalidates only affected queries', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    renderHook(() => useClientRealtime('client-1'), { wrapper })
    const onChange = realtimeMocks.subscribe.mock.calls[0]![1] as (change: ClientRealtimeChange) => void

    act(() => {
      onChange({ table: 'client_progress', eventType: 'UPDATE', new: { id: 'p-1' }, old: {} })
      onChange({ table: 'client_progress', eventType: 'UPDATE', new: { id: 'p-1' }, old: {} })
      vi.advanceTimersByTime(150)
    })

    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['progress', 'client-1'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['client', 'client-1'] })
  })

  it('unsubscribes while hidden and refetches active queries after returning', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    renderHook(() => useClientRealtime('client-1'), { wrapper })

    act(() => {
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(realtimeMocks.unsubscribe).toHaveBeenCalledOnce()

    act(() => {
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(realtimeMocks.subscribe).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workouts'], refetchType: 'active' })
  })
})
