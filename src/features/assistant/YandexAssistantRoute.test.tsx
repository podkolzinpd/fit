import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { YandexAssistantRoute } from './YandexAssistantRoute'

const PROFILE_ID = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
const OTHER_PROFILE_ID = '6e577cc7-3b56-4a86-bc85-1ce2426ce249'

interface MockAuthState {
  actor: { userId: string; role: 'trainer' | 'client' } | null
  loading: boolean
  error: string | null
}

interface MockYandexSession {
  accessMode: 'read_write'
  profile: {
    id: string
    firstName: string
    lastName: string | null
    timezone: string
    accountRole: 'trainer'
  }
  session: { token: string; expiresAt: string }
}

interface MockAppSessionState {
  session: MockYandexSession | null
  loading: boolean
  error: string | null
  signOut: () => Promise<void>
}

const authState = vi.hoisted(() => vi.fn<() => MockAuthState>())
vi.mock('../../app/auth-context', () => ({ useAuth: () => authState() }))

const appSessionState = vi.hoisted(() => vi.fn<() => MockAppSessionState>())
vi.mock('../../app/yandex-app-session-context', () => ({
  useYandexAppSession: () => appSessionState(),
}))

const createBackend = vi.hoisted(() => vi.fn(() => ({ cacheKey: 'yandex' })))
vi.mock('../../data/repositories/yandex-assistant.repository', () => ({
  createYandexAssistantBackend: createBackend,
}))

vi.mock('./AssistantHistoryPage', () => ({
  AssistantHistoryPage: ({ backend }: { backend?: { cacheKey: string } }) =>
    <p>{backend?.cacheKey ?? 'supabase'} assistant</p>,
}))

const createAuthorizationUrl = vi.hoisted(() => vi.fn())
vi.mock('../auth', () => ({ createYandexAuthorizationUrl: createAuthorizationUrl }))

const signOut = vi.fn()
const session = {
  accessMode: 'read_write' as const,
  profile: {
    id: PROFILE_ID,
    firstName: 'Ирина',
    lastName: null,
    timezone: 'Europe/Moscow',
    accountRole: 'trainer' as const,
  },
  session: { token: 'a'.repeat(43), expiresAt: '2099-09-01T12:00:00.000Z' },
}

describe('YandexAssistantRoute', () => {
  beforeEach(() => {
    authState.mockReset().mockReturnValue({
      actor: { userId: PROFILE_ID, role: 'trainer' },
      loading: false,
      error: null,
    })
    signOut.mockReset().mockResolvedValue(undefined)
    appSessionState.mockReset().mockReturnValue({
      session: null,
      loading: false,
      error: null,
      signOut,
    })
    createBackend.mockClear()
    createAuthorizationUrl.mockReset()
    vi.stubEnv('VITE_YANDEX_ASSISTANT_ROUTING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_ASSISTANT_ROUTING_PILOT_USER_IDS', PROFILE_ID)
    vi.stubEnv('VITE_YANDEX_APP_SESSION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps every non-pilot user on the unchanged Supabase Assistant', () => {
    vi.stubEnv('VITE_YANDEX_ASSISTANT_ROUTING_PILOT_USER_IDS', OTHER_PROFILE_ID)

    render(<YandexAssistantRoute />)

    expect(screen.getByText('supabase assistant')).toBeVisible()
    expect(createBackend).not.toHaveBeenCalled()
  })

  it('does not load either backend until the routed user confirms Yandex ID', () => {
    render(<YandexAssistantRoute />)

    expect(screen.getByRole('heading', { name: 'Подтвердите Yandex ID' })).toBeVisible()
    expect(screen.queryByText(/assistant$/)).not.toBeInTheDocument()
    expect(createBackend).not.toHaveBeenCalled()
  })

  it('pins a matching routed actor to the Yandex backend', () => {
    appSessionState.mockReturnValue({ session, loading: false, error: null, signOut })

    render(<YandexAssistantRoute />)

    expect(screen.getByText('yandex assistant')).toBeVisible()
    expect(createBackend).toHaveBeenCalledWith(
      'https://stage.example.test',
      session.session.token,
    )
    expect(screen.queryByText('supabase assistant')).not.toBeInTheDocument()
  })

  it('blocks a mismatched Yandex identity without loading or falling back', () => {
    appSessionState.mockReturnValue({
      session: { ...session, profile: { ...session.profile, id: OTHER_PROFILE_ID } },
      loading: false,
      error: null,
      signOut,
    })

    render(<YandexAssistantRoute />)

    expect(screen.getByRole('heading', { name: 'Открыт другой Yandex ID' })).toBeVisible()
    expect(screen.queryByText(/assistant$/)).not.toBeInTheDocument()
    expect(createBackend).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Завершить Yandex-сессию' }))
    expect(signOut).toHaveBeenCalledOnce()
  })
})
