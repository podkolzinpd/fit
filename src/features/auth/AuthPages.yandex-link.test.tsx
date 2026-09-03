import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YandexPilotCallbackPage } from './AuthPages'
import {
  createYandexAuthorizationUrl,
  peekPendingYandexAuthorizationIntent,
} from './yandex-pilot-oauth'

type MockActor = {
  kind: 'trainer'
  role: 'trainer'
  userId: string
  email: string
  firstName: string | null
  lastName: string | null
  timezone: string
}

interface MockAuthState {
  actor: MockActor | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const actor: MockActor = {
  kind: 'trainer',
  role: 'trainer',
  userId: 'trainer-1',
  email: 'trainer@test.com',
  firstName: 'Ирина',
  lastName: null,
  timezone: 'Europe/Moscow',
}

const useAuth = vi.hoisted(() => vi.fn<() => MockAuthState>())
vi.mock('../../app/auth-context', () => ({ useAuth: () => useAuth() }))

const authRepository = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('../../data/repositories/auth.repository', () => ({ authRepository }))

const yandexPilotRepository = vi.hoisted(() => ({ linkYandexAccount: vi.fn() }))
vi.mock('../../data/repositories/yandex-pilot.repository', () => ({ yandexPilotRepository }))

const establishYandexSession = vi.hoisted(() => vi.fn())
vi.mock('../../app/yandex-app-session-context', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../app/yandex-app-session-context')>(),
  useYandexAppSession: () => ({ establish: establishYandexSession }),
}))

async function linkingCallbackSearch(): Promise<string> {
  const authorizationUrl = new URL(await createYandexAuthorizationUrl(
    'public-client-id',
    'http://localhost/auth/yandex/callback',
    sessionStorage,
    'link',
  ))
  return `?code=one-time-code&state=${authorizationUrl.searchParams.get('state')}`
}

describe('Yandex account linking callback', () => {
  beforeEach(() => {
    useAuth.mockReset()
    authRepository.getSession.mockReset()
    yandexPilotRepository.linkYandexAccount.mockReset()
    establishYandexSession.mockReset()
    useAuth.mockReturnValue({ actor, loading: false, error: null, refresh: vi.fn() })
    authRepository.getSession.mockResolvedValue({
      data: { session: { access_token: 'supabase-access-token' } },
      error: null,
    })
    yandexPilotRepository.linkYandexAccount.mockResolvedValue({
      profileId: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
    })
    vi.stubEnv('VITE_YANDEX_ID_PILOT_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_PILOT_USER_IDS', 'trainer-1')
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

  it('links the current FIT account and clears the OAuth query', async () => {
    window.history.replaceState(null, '', `/auth/yandex/callback${await linkingCallbackSearch()}`)

    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Yandex ID привязан' })).toBeVisible()
    expect(screen.getByText('Теперь этот Yandex ID связан с текущим FIT-профилем. Основной вход пока остаётся прежним.')).toBeVisible()
    expect(window.location.search).toBe('')
    expect(peekPendingYandexAuthorizationIntent()).toBe('pilot')
    await waitFor(() => expect(yandexPilotRepository.linkYandexAccount).toHaveBeenCalledWith(
      'https://stage.example.test',
      'supabase-access-token',
      'one-time-code',
      expect.stringMatching(/^[A-Za-z0-9_-]{43,128}$/),
    ))
    expect(yandexPilotRepository.linkYandexAccount).toHaveBeenCalledTimes(1)
    expect(establishYandexSession).not.toHaveBeenCalled()
  })

  it('starts the issued Yandex app session immediately after a safe link', async () => {
    const linkedSession = {
      accessMode: 'read_write' as const,
      profile: {
        id: actor.userId, firstName: 'Ирина', lastName: null,
        timezone: 'Europe/Moscow', accountRole: 'trainer' as const,
      },
      session: { token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z' },
    }
    yandexPilotRepository.linkYandexAccount.mockResolvedValue({
      profileId: linkedSession.profile.id,
      appSession: linkedSession,
    })
    vi.stubEnv('VITE_YANDEX_APP_SESSION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_APP_SESSION_PILOT_USER_IDS', linkedSession.profile.id)
    window.history.replaceState(null, '', `/auth/yandex/callback${await linkingCallbackSearch()}`)

    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Yandex ID привязан' })).toBeVisible()
    expect(establishYandexSession).toHaveBeenCalledWith(linkedSession)
  })

  it('does not link when the current user is outside the rollout allowlist', async () => {
    vi.stubEnv('VITE_YANDEX_SESSION_LINKING_PILOT_USER_IDS', 'trainer-2')
    window.history.replaceState(null, '', `/auth/yandex/callback${await linkingCallbackSearch()}`)

    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByRole('alert')).toHaveTextContent('Привязка Yandex ID пока недоступна для этого аккаунта.')
    expect(screen.getAllByRole('link', { name: 'Вернуться в профиль' })[0]).toHaveAttribute('href', '/profile')
    expect(authRepository.getSession).not.toHaveBeenCalled()
    expect(yandexPilotRepository.linkYandexAccount).not.toHaveBeenCalled()
    expect(peekPendingYandexAuthorizationIntent()).toBe('pilot')
  })

  it('requires an existing FIT session before linking a Yandex ID', async () => {
    useAuth.mockReturnValue({ actor: null, loading: false, error: null, refresh: vi.fn() })
    window.history.replaceState(null, '', `/auth/yandex/callback${await linkingCallbackSearch()}`)

    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByRole('alert')).toHaveTextContent('Войдите в FIT по email, паролю или Google, затем начните привязку Yandex ID из профиля.')
    expect(screen.getAllByRole('link', { name: 'Вернуться ко входу' })[0]).toHaveAttribute('href', '/auth')
    expect(authRepository.getSession).not.toHaveBeenCalled()
    expect(yandexPilotRepository.linkYandexAccount).not.toHaveBeenCalled()
  })
})
