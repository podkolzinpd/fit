import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  signOut: vi.fn(),
  updateProfile: vi.fn(),
}))

const yandex = vi.hoisted(() => ({ state: null as null | {
  session: {
    profile: {
      id: string
      firstName: string | null
      lastName: string | null
      timezone: string
      accountRole: 'trainer'
    }
    session: { token: string; expiresAt: string }
    accessMode: 'read_write'
  }
  loading: boolean
  error: string | null
  retry: ReturnType<typeof vi.fn>
  signOut: ReturnType<typeof vi.fn>
} }))

vi.mock('./yandex-app-session-context', () => ({
  useOptionalYandexAppSession: () => yandex.state,
}))

vi.mock('../data/repositories/auth.repository', () => ({
  authRepository: {
    getSession: auth.getSession,
    initialize: auth.initialize,
    onAuthStateChange: auth.onAuthStateChange,
    signOut: auth.signOut,
    updateProfile: auth.updateProfile,
  },
}))

const user = { id: 'user-1', email: 'trainer@example.com', user_metadata: { first_name: 'Анна' } }
const actor = { userId: user.id, role: 'trainer' as const, email: user.email, firstName: 'Анна', lastName: null, timezone: 'Europe/Moscow' }
const otherUser = { id: 'user-2', email: 'client@example.com', user_metadata: { first_name: 'Иван' } }
const otherActor = { userId: otherUser.id, role: 'client' as const, email: otherUser.email, firstName: 'Иван', lastName: null, timezone: 'Europe/Moscow', clientId: 'client-2', trainerId: 'trainer-1', fullName: 'Иван' }

function AuthProbe() {
  const state = useAuth()
  return <p>{state.loading ? 'loading' : state.actor?.email ?? state.error ?? 'anonymous'}</p>
}

function RefreshProbe() {
  const state = useAuth()
  return <><p>{state.actor?.firstName ?? 'anonymous'}</p><button onClick={() => void state.refresh()}>Обновить</button></>
}

function YandexProbe() {
  const state = useAuth()
  return <><p>{state.loading ? 'loading' : state.actor?.userId ?? state.error ?? 'anonymous'}</p><button onClick={() => void state.refresh()}>Обновить</button><button onClick={() => void state.signOut()}>Выйти</button></>
}

function SignOutProbe() {
  const state = useAuth()
  return <><p>{state.actor?.email ?? 'anonymous'}</p><button onClick={() => void state.signOut().catch(() => undefined)}>Выйти</button></>
}

function authCallback(): TestAuthCallback {
  const callback = auth.onAuthStateChange.mock.calls[0]?.[0]
  if (!callback) throw new Error('Auth callback was not registered')
  return callback
}

function renderAuth(children: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}><AuthProvider>{children}</AuthProvider></QueryClientProvider>),
  }
}

describe('AuthProvider', () => {
  beforeEach(() => {
    yandex.state = null
    auth.getSession.mockReset()
    auth.initialize.mockReset().mockResolvedValue(actor)
    auth.unsubscribe.mockReset()
    auth.signOut.mockReset().mockResolvedValue(undefined)
    auth.updateProfile.mockReset().mockResolvedValue(undefined)
    auth.onAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: auth.unsubscribe } } })
  })

  afterEach(() => vi.unstubAllEnvs())

  it('initializes directly from the auth event without requesting the session again', async () => {
    renderAuth(<AuthProbe />)

    const callback = authCallback()
    callback('INITIAL_SESSION', { user })

    await waitFor(() => expect(screen.getByText(user.email)).toBeInTheDocument())
    expect(auth.getSession).not.toHaveBeenCalled()
    expect(auth.initialize).toHaveBeenCalledOnce()
    expect(auth.initialize).toHaveBeenCalledWith(user)
  })

  it('uses one allowlisted Yandex session for the app actor and its session actions', async () => {
    const retry = vi.fn().mockResolvedValue(undefined)
    const signOut = vi.fn().mockResolvedValue(undefined)
    yandex.state = {
      session: {
        accessMode: 'read_write',
        profile: { id: 'trainer-1', firstName: 'Яна', lastName: null, timezone: 'Europe/Moscow', accountRole: 'trainer' },
        session: { token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z' },
      },
      loading: false,
      error: null,
      retry,
      signOut,
    } as typeof yandex.state
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_PILOT_USER_IDS', 'trainer-1')

    renderAuth(<YandexProbe />)

    expect(await screen.findByText('trainer-1')).toBeVisible()
    screen.getByRole('button', { name: 'Обновить' }).click()
    await waitFor(() => expect(retry).toHaveBeenCalledOnce())
    screen.getByRole('button', { name: 'Выйти' }).click()
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    expect(auth.signOut).toHaveBeenCalled()
  })

  it('reuses the initialized actor for repeated events from the same session', async () => {
    renderAuth(<AuthProbe />)
    const callback = authCallback()

    callback('INITIAL_SESSION', { user })
    callback('SIGNED_IN', { user })
    callback('TOKEN_REFRESHED', { user })

    await waitFor(() => expect(screen.getByText(user.email)).toBeInTheDocument())
    expect(auth.initialize).toHaveBeenCalledOnce()
  })

  it('явно перечитывает профиль текущего пользователя при refresh', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user } }, error: null })
    auth.initialize
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce({ ...actor, firstName: 'Мария' })
    renderAuth(<RefreshProbe />)

    authCallback()('INITIAL_SESSION', { user })
    await waitFor(() => expect(screen.getByText('Анна')).toBeInTheDocument())
    screen.getByRole('button', { name: 'Обновить' }).click()

    await waitFor(() => expect(screen.getByText('Мария')).toBeInTheDocument())
    expect(auth.initialize).toHaveBeenCalledTimes(2)
  })

  it('ignores stale initialization after logout', async () => {
    let resolveInitialization: ((value: typeof actor) => void) | undefined
    auth.initialize.mockReturnValue(new Promise((resolve) => { resolveInitialization = resolve }))
    const { queryClient } = renderAuth(<AuthProbe />)
    const callback = authCallback()

    callback('SIGNED_IN', { user })
    queryClient.setQueryData(['my-client'], { fullName: 'Анна' })
    callback('SIGNED_OUT', null)
    resolveInitialization?.(actor)

    await waitFor(() => expect(screen.getByText('anonymous')).toBeInTheDocument())
    expect(screen.queryByText(user.email)).not.toBeInTheDocument()
    expect(queryClient.getQueryData(['my-client'])).toBeUndefined()
  })

  it('clears cached server data before restoring a session', async () => {
    const { queryClient } = renderAuth(<AuthProbe />)
    queryClient.setQueryData(['my-client'], { fullName: 'Чужой клиент' })

    authCallback()('INITIAL_SESSION', { user })

    await waitFor(() => expect(screen.getByText(user.email)).toBeInTheDocument())
    expect(queryClient.getQueryData(['my-client'])).toBeUndefined()
  })

  it('clears cached data when the authenticated account changes', async () => {
    const { queryClient } = renderAuth(<AuthProbe />)
    const callback = authCallback()
    callback('SIGNED_IN', { user })
    await waitFor(() => expect(screen.getByText(user.email)).toBeInTheDocument())
    queryClient.setQueryData(['workouts', 'client-1'], [{ id: 'old-workout' }])
    auth.initialize.mockResolvedValueOnce(otherActor)

    callback('SIGNED_IN', { user: otherUser })

    await waitFor(() => expect(screen.getByText(otherUser.email)).toBeInTheDocument())
    expect(queryClient.getQueryData(['workouts', 'client-1'])).toBeUndefined()
  })

  it('очищает кэш только после подтверждённого локального выхода', async () => {
    const { queryClient } = renderAuth(<SignOutProbe />)
    authCallback()('INITIAL_SESSION', { user })
    await waitFor(() => expect(screen.getByText(user.email)).toBeInTheDocument())
    queryClient.setQueryData(['my-client'], { fullName: 'Анна' })

    await userEvent.click(screen.getByRole('button', { name: 'Выйти' }))

    await waitFor(() => expect(auth.signOut).toHaveBeenCalledOnce())
    expect(queryClient.getQueryData(['my-client'])).toBeUndefined()
  })

  it('сохраняет кэш и текущий интерфейс, если локальный выход не состоялся', async () => {
    auth.signOut.mockRejectedValue(new Error('Не удалось выйти'))
    const { queryClient } = renderAuth(<SignOutProbe />)
    authCallback()('INITIAL_SESSION', { user })
    await waitFor(() => expect(screen.getByText(user.email)).toBeInTheDocument())
    queryClient.setQueryData(['my-client'], { fullName: 'Анна' })

    await userEvent.click(screen.getByRole('button', { name: 'Выйти' }))

    await waitFor(() => expect(auth.signOut).toHaveBeenCalledOnce())
    expect(queryClient.getQueryData(['my-client'])).toEqual({ fullName: 'Анна' })
    expect(screen.getByText(user.email)).toBeInTheDocument()
  })
})
