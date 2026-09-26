import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
}))

vi.mock('./client', () => ({ supabase: { auth } }))

import { refreshSupabaseAccessToken, verifiedSupabaseAccessToken } from './verified-supabase-session'

describe('verified Supabase session', () => {
  beforeEach(() => {
    auth.getSession.mockReset()
    auth.refreshSession.mockReset()
  })

  it('passes the current token to the server-side authorization gate', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'current-token' } }, error: null })

    await expect(verifiedSupabaseAccessToken()).resolves.toBe('current-token')
  })

  it('stops when the browser has no session token', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })

    await expect(verifiedSupabaseAccessToken()).rejects.toThrow('authentication_required')
  })

  it('stops when reading the browser session fails', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('storage unavailable') })

    await expect(verifiedSupabaseAccessToken()).rejects.toThrow('authentication_required')
  })

  it('returns the replacement token from an explicit refresh', async () => {
    auth.refreshSession.mockResolvedValue({ data: { session: { access_token: 'fresh-token' } }, error: null })

    await expect(refreshSupabaseAccessToken()).resolves.toBe('fresh-token')
  })

  it('fails closed when an explicit refresh cannot recover the session', async () => {
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error('refresh rejected') })

    await expect(refreshSupabaseAccessToken()).rejects.toThrow('authentication_required')
  })
})
