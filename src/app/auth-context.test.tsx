import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './auth-context'

interface TestUser {
  id: string
  email?: string
  user_metadata: Record<string, unknown>
}

type TestAuthCallback = (event: string, session: { user: TestUser } | null) => void

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  initialize: vi.fn(),
  onAuthStateChange: vi.fn<(callback: TestAuthCallback) => {
    data: { subscription: { unsubscribe: () => void } }
  }>(),
  unsubscribe: vi.fn(),
}))

vi.mock('../data/repositories/auth.repository', () => ({
  authRepository: {
    getSession: auth.getSession,
    initialize: auth.initialize,
    onAuthStateChange: auth.onAuthStateChange,
  },
}))

const user = { id: 'user-1', email: 'trainer@example.com', user_metadata: { first_name: 'Анна' } }
const actor = { kind: 'trainer' as const, userId: user.id, email: user.email, firstName: 'Анна', lastName: null, timezone: 'Europe/Moscow' }

function AuthProbe() {
  const state = useAuth()
  return <p>{state.loading ? 'loading' : state.actor?.email ?? state.error ?? 'anonymous'}</p>
}

function authCallback(): TestAuthCallback {
  const callback = auth.onAuthStateChange.mock.calls[0]?.[0]
  if (!callback) throw new Error('Auth callback was not registered')
  return callback
}

describe('AuthProvider', () => {
  beforeEach(() => {
    auth.getSession.mockReset()
    auth.initialize.mockReset().mockResolvedValue(actor)
    auth.unsubscribe.mockReset()
    auth.onAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: auth.unsubscribe } } })
  })

  it('initializes directly from the auth event without requesting the session again', async () => {
    render(<AuthProvider><AuthProbe /></AuthProvider>)

    const callback = authCallback()
    callback('INITIAL_SESSION', { user })

    await waitFor(() => expect(screen.getByText(user.email)).toBeInTheDocument())
    expect(auth.getSession).not.toHaveBeenCalled()
    expect(auth.initialize).toHaveBeenCalledOnce()
    expect(auth.initialize).toHaveBeenCalledWith(user)
  })

  it('reuses the initialized actor for repeated events from the same session', async () => {
    render(<AuthProvider><AuthProbe /></AuthProvider>)
    const callback = authCallback()

    callback('INITIAL_SESSION', { user })
    callback('SIGNED_IN', { user })
    callback('TOKEN_REFRESHED', { user })

    await waitFor(() => expect(screen.getByText(user.email)).toBeInTheDocument())
    expect(auth.initialize).toHaveBeenCalledOnce()
  })

  it('ignores stale initialization after logout', async () => {
    let resolveInitialization: ((value: typeof actor) => void) | undefined
    auth.initialize.mockReturnValue(new Promise((resolve) => { resolveInitialization = resolve }))
    render(<AuthProvider><AuthProbe /></AuthProvider>)
    const callback = authCallback()

    callback('SIGNED_IN', { user })
    callback('SIGNED_OUT', null)
    resolveInitialization?.(actor)

    await waitFor(() => expect(screen.getByText('anonymous')).toBeInTheDocument())
    expect(screen.queryByText(user.email)).not.toBeInTheDocument()
  })
})
