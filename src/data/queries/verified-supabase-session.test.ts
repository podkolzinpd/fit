import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
}))

vi.mock('./client', () => ({ supabase: { auth } }))

import { verifiedSupabaseAccessToken } from './verified-supabase-session'

describe('verified Supabase session', () => {
  beforeEach(() => {
    auth.getSession.mockReset()
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
})
