import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const realtime = vi.hoisted(() => ({
  channel: vi.fn(),
  on: vi.fn(),
  subscribe: vi.fn<(callback?: (status: REALTIME_SUBSCRIBE_STATES) => void) => void>(),
  removeChannel: vi.fn(),
}))

vi.mock('./client', () => ({
  supabase: {
    channel: realtime.channel,
    removeChannel: realtime.removeChannel,
  },
}))

import { clientRealtimeTables, subscribeToClientChanges } from './realtime.queries'

describe('subscribeToClientChanges', () => {
  beforeEach(() => {
    realtime.channel.mockReset().mockReturnValue({
      on: realtime.on,
      subscribe: realtime.subscribe,
    })
    realtime.on.mockReset().mockReturnThis()
    realtime.subscribe.mockReset()
    realtime.removeChannel.mockReset().mockResolvedValue('ok')
  })

  it('uses one filtered channel for all tables in the open client space', () => {
    const ready = vi.fn()
    const stop = subscribeToClientChanges('client-1', vi.fn(), ready)

    expect(realtime.channel).toHaveBeenCalledOnce()
    expect(realtime.channel).toHaveBeenCalledWith('client:client-1')
    expect(realtime.on).toHaveBeenCalledTimes(clientRealtimeTables.length)
    expect(realtime.on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'clients', filter: 'id=eq.client-1' },
      expect.any(Function),
    )
    expect(realtime.on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'workouts', filter: 'client_id=eq.client-1' },
      expect.any(Function),
    )
    expect(realtime.on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'client_goals', filter: 'client_id=eq.client-1' },
      expect.any(Function),
    )
    expect(realtime.on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'client_invitations', filter: 'client_id=eq.client-1' },
      expect.any(Function),
    )
    expect(realtime.subscribe).toHaveBeenCalledOnce()
    expect(realtime.subscribe).toHaveBeenCalledWith(expect.any(Function))
    realtime.subscribe.mock.calls[0]?.[0]?.(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)
    expect(ready).toHaveBeenCalledOnce()

    stop()
    expect(realtime.removeChannel).toHaveBeenCalledOnce()
  })
})
