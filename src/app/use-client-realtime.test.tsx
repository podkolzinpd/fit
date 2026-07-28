import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientRealtimeChange } from '../data/repositories/realtime.repository'
import {
  applyClientRealtimeChanges,
  refetchClientSpace,
  useClientRealtime,
} from './use-client-realtime'

const realtime = vi.hoisted(() => ({
  listener: undefined as ((change: ClientRealtimeChange) => void) | undefined,
  subscribe: vi.fn<(clientId: string, listener: (change: ClientRealtimeChange) => void) => () => void>(),
  unsubscribe: vi.fn(),
}))

vi.mock('../data/repositories/realtime.repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data/repositories/realtime.repository')>()
  return {
    ...original,
    realtimeRepository: { subscribeToClientChanges: realtime.subscribe },
  }
})

function change(table: ClientRealtimeChange['table'], values: Record<string, unknown> = {}): ClientRealtimeChange {
  return { table, eventType: 'UPDATE', new: values, old: {} }
}

function Probe({ clientId }: { clientId?: string }) {
  useClientRealtime(clientId)
  return null
}

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('client realtime', () => {
  let visibility: DocumentVisibilityState

  beforeEach(() => {
    vi.useFakeTimers()
    visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    realtime.listener = undefined
    realtime.subscribe.mockReset().mockImplementation((_clientId, listener) => {
      realtime.listener = listener
      return realtime.unsubscribe
    })
    realtime.unsubscribe.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('invalidates only query families affected by the received tables', async () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()

    await applyClientRealtimeChanges(queryClient, 'client-1', [
      change('client_progress', { client_id: 'client-1' }),
      change('client_custom_metrics', { client_id: 'client-1' }),
    ])

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['progress', 'client-1'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['metrics', 'client-1'] })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['workouts'] })
  })

  it('debounces aggregate events while keeping one channel for the open client', async () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    const view = render(<Probe clientId="client-1" />, { wrapper: wrapper(queryClient) })

    expect(realtime.subscribe).toHaveBeenCalledOnce()
    expect(realtime.subscribe).toHaveBeenCalledWith('client-1', expect.any(Function))

    act(() => {
      realtime.listener?.(change('workouts', { id: 'workout-1', client_id: 'client-1' }))
      realtime.listener?.(change('workout_exercises', { workout_id: 'workout-1', client_id: 'client-1' }))
      vi.advanceTimersByTime(119)
    })
    expect(invalidate).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(1) })
    await Promise.resolve()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workouts'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workout', 'workout-1'] })

    view.rerender(<Probe clientId="client-2" />)
    expect(realtime.unsubscribe).toHaveBeenCalledOnce()
    expect(realtime.subscribe).toHaveBeenLastCalledWith('client-2', expect.any(Function))
    view.unmount()
  })

  it('disconnects in a hidden tab and refetches the client space on return', async () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()
    render(<Probe clientId="client-1" />, { wrapper: wrapper(queryClient) })

    act(() => {
      visibility = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(realtime.unsubscribe).toHaveBeenCalledOnce()

    act(() => {
      visibility = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await Promise.resolve()
    expect(realtime.subscribe).toHaveBeenCalledTimes(2)
    const visibilityOptions = invalidate.mock.calls.find(([options]) => options?.predicate)?.[0]
    expect(visibilityOptions?.predicate).toBeTypeOf('function')
    expect(visibilityOptions?.refetchType).toBe('active')
  })

  it('refetch predicate excludes unrelated global queries', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['profile'], { id: 'profile-1' })
    queryClient.setQueryData(['client', 'client-1'], { id: 'client-1' })
    queryClient.setQueryData(['client', 'client-2'], { id: 'client-2' })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await refetchClientSpace(queryClient, 'client-1')

    const options = invalidate.mock.calls[0]?.[0]
    expect(options?.predicate?.(queryClient.getQueryCache().find({ queryKey: ['profile'] })!)).toBe(false)
    expect(options?.predicate?.(queryClient.getQueryCache().find({ queryKey: ['client', 'client-1'] })!)).toBe(true)
    expect(options?.predicate?.(queryClient.getQueryCache().find({ queryKey: ['client', 'client-2'] })!)).toBe(false)
  })
})
