import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YandexAppSessionPage, YandexPilotCallbackPage } from './AuthPages'
import { createYandexAuthorizationUrl } from './yandex-pilot-oauth'

const PROFILE_ID = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
const session = {
  accessMode: 'read_write' as const,
  profile: {
    id: PROFILE_ID,
    firstName: 'Ирина',
    lastName: null,
    timezone: 'Europe/Moscow',
    accountRole: 'trainer' as const,
  },
  session: {
    token: 'a'.repeat(43),
    expiresAt: '2099-09-01T12:00:00.000Z',
  },
}

interface MockAuthState {
  actor: { userId: string; role: 'trainer' | 'client' } | null
  loading: boolean
  error: string | null
}

interface MockAppSessionState {
  session: typeof session | null
  loading: boolean
  error: string | null
  establish: (value: typeof session) => void
  retry: () => Promise<void>
  signOut: () => Promise<void>
}

const authState = vi.hoisted(() => vi.fn<() => MockAuthState>())
vi.mock('../../app/auth-context', () => ({ useAuth: () => authState() }))

const appSessionState = vi.hoisted(() => vi.fn<() => MockAppSessionState>())
vi.mock('../../app/yandex-app-session-context', () => ({
  useYandexAppSession: () => appSessionState(),
}))

const repository = vi.hoisted(() => ({
  exchangeCodeForAppSession: vi.fn(),
  revokeAppSession: vi.fn(),
}))
vi.mock('../../data/repositories/yandex-pilot.repository', () => ({
  yandexPilotRepository: repository,
}))

const establish = vi.fn()
const retry = vi.fn()
const signOut = vi.fn()

async function appCallbackSearch(): Promise<string> {
  const authorizationUrl = new URL(await createYandexAuthorizationUrl(
    'public-client-id',
    'http://localhost/auth/yandex/callback',
    sessionStorage,
    'app',
  ))
  return `?code=one-time-code&state=${authorizationUrl.searchParams.get('state')}`
}

describe('Yandex app session auth flow', () => {
  beforeEach(() => {
    establish.mockReset()
    retry.mockReset().mockResolvedValue(undefined)
    signOut.mockReset().mockResolvedValue(undefined)
    repository.exchangeCodeForAppSession.mockReset().mockResolvedValue(session)
    repository.revokeAppSession.mockReset().mockResolvedValue(undefined)
    authState.mockReset().mockReturnValue({ actor: null, loading: false, error: null })
    appSessionState.mockReset().mockReturnValue({
      session: null,
      loading: false,
      error: null,
      establish,
      retry,
      signOut,
    })
    vi.stubEnv('VITE_YANDEX_APP_SESSION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_APP_SESSION_PILOT_USER_IDS', PROFILE_ID)
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(7),
      subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(9).buffer) },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    window.history.replaceState(null, '', '/')
    sessionStorage.clear()
  })

  it('exchanges an app OAuth callback and opens the session route', async () => {
    window.history.replaceState(null, '', `/auth/yandex/callback${await appCallbackSearch()}`)
    render(<MemoryRouter initialEntries={['/auth/yandex/callback']}>
      <Routes>
        <Route path="/auth/yandex/callback" element={<YandexPilotCallbackPage />} />
        <Route path="/auth/yandex/session" element={<p>session route</p>} />
      </Routes>
    </MemoryRouter>)

    expect(await screen.findByText('session route')).toBeVisible()
    expect(repository.exchangeCodeForAppSession).toHaveBeenCalledWith(
      'https://stage.example.test',
      'one-time-code',
      expect.stringMatching(/^[A-Za-z0-9_-]{43,128}$/),
    )
    expect(establish).toHaveBeenCalledWith(session)
    expect(window.location.search).toBe('')
  })

  it('revokes the returned token when the profile is outside the frontend rollout', async () => {
    vi.stubEnv('VITE_YANDEX_APP_SESSION_PILOT_USER_IDS', '11111111-1111-4111-8111-111111111111')
    window.history.replaceState(null, '', `/auth/yandex/callback${await appCallbackSearch()}`)
    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Этот профиль не добавлен в пилот входа через Yandex ID.',
    )
    expect(repository.revokeAppSession).toHaveBeenCalledWith(
      'https://stage.example.test',
      session.session.token,
    )
    expect(establish).not.toHaveBeenCalled()
  })

  it('opens a matching Yandex app session for the authenticated FIT actor', async () => {
    authState.mockReturnValue({
      actor: { userId: PROFILE_ID, role: 'trainer' },
      loading: false,
      error: null,
    })
    window.history.replaceState(null, '', `/auth/yandex/callback${await appCallbackSearch()}`)
    render(<MemoryRouter initialEntries={['/auth/yandex/callback']}>
      <Routes>
        <Route path="/auth/yandex/callback" element={<YandexPilotCallbackPage />} />
        <Route path="/assistant" element={<p>assistant route</p>} />
      </Routes>
    </MemoryRouter>)

    expect(await screen.findByText('assistant route')).toBeVisible()
    expect(repository.exchangeCodeForAppSession).toHaveBeenCalledOnce()
    expect(establish).toHaveBeenCalledWith(session)
  })

  it('revokes a Yandex app session linked to another FIT actor', async () => {
    authState.mockReturnValue({
      actor: { userId: '6e577cc7-3b56-4a86-bc85-1ce2426ce249', role: 'trainer' },
      loading: false,
      error: null,
    })
    window.history.replaceState(null, '', `/auth/yandex/callback${await appCallbackSearch()}`)
    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Yandex ID связан с другим FIT-профилем.',
    )
    expect(repository.revokeAppSession).toHaveBeenCalledWith(
      'https://stage.example.test',
      session.session.token,
    )
    expect(establish).not.toHaveBeenCalled()
  })

  it('shows a restored session and logs out without exposing the token', async () => {
    appSessionState.mockReturnValue({
      session,
      loading: false,
      error: null,
      establish,
      retry,
      signOut,
    })
    render(<MemoryRouter initialEntries={['/auth/yandex/session']}>
      <Routes>
        <Route path="/auth/yandex/session" element={<YandexAppSessionPage />} />
        <Route path="/auth" element={<p>auth route</p>} />
      </Routes>
    </MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Сессия работает' })).toBeVisible()
    expect(screen.getByText('Ирина')).toBeVisible()
    expect(document.body.textContent).not.toContain(session.session.token)
    fireEvent.click(screen.getByRole('button', { name: 'Выйти из Yandex ID' }))
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    expect(await screen.findByText('auth route')).toBeVisible()
  })

  it('offers retry instead of opening a direct session route after restore failure', () => {
    appSessionState.mockReturnValue({
      session: null,
      loading: false,
      error: 'Yandex Cloud вход временно недоступен.',
      establish,
      retry,
      signOut,
    })
    render(<MemoryRouter><YandexAppSessionPage /></MemoryRouter>)

    expect(screen.getByRole('alert')).toHaveTextContent('Yandex Cloud вход временно недоступен.')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
