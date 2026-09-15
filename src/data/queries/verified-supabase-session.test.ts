import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
  refreshSession: vi.fn(),
}))

vi.mock('./client', () => ({ supabase: { auth } }))

import { verifiedSupabaseAccessToken } from './verified-supabase-session'

describe('verified Supabase session', () => {
  beforeEach(() => {
    auth.getSession.mockReset()
    auth.getUser.mockReset()
    auth.refreshSession.mockReset()
  })

  it('uses an active session without refreshing it', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'current-token' } }, error: null })
    auth.getUser.mockResolvedValue({ data: { user: { id: 'actor' } }, error: null })

    await expect(verifiedSupabaseAccessToken()).resolves.toBe('current-token')
    expect(auth.getUser).toHaveBeenCalledWith('current-token')
    expect(auth.refreshSession).not.toHaveBeenCalled()
  })

  it('refreshes a locally stored session which Auth no longer accepts', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'stale-token' } }, error: null })
    auth.getUser
      .mockResolvedValueOnce({ data: { user: null }, error: new Error('Auth session missing!') })
      .mockResolvedValueOnce({ data: { user: { id: 'actor' } }, error: null })
    auth.refreshSession.mockResolvedValue({ data: { session: { access_token: 'fresh-token' } }, error: null })

    await expect(verifiedSupabaseAccessToken()).resolves.toBe('fresh-token')
    expect(auth.getUser).toHaveBeenNthCalledWith(2, 'fresh-token')
  })

  it('stops before the paid request when the revoked session cannot be refreshed', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'stale-token' } }, error: null })
    auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error('Auth session missing!') })
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error('Auth session missing!') })

    await expect(verifiedSupabaseAccessToken()).rejects.toThrow('authentication_required')
  })
})
