import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataBackendProvider, useDataBackend } from './data-backend-context'

const USER_ID = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
interface MockAuthState {
  actor: {
    kind: string
    role: string
    userId: string
    email: null
    firstName: null
    lastName: null
    timezone: string
  } | null
}
const supabaseBackendParts = vi.hoisted(() => ({
  appFeedbackRepository: {}, clientsRepository: {}, exercisesRepository: {}, goalsRepository: {},
  invitationLinksRepository: { kind: 'supabase-links' }, invitationsRepository: {}, progressRepository: {}, pushNotificationsRepository: {},
  realtimeRepository: {}, trainingSummariesRepository: {}, workoutsRepository: {},
}))
const yandexInvitationLinks = vi.hoisted(() => ({ kind: 'yandex-links' }))
const createYandexMainRepository = vi.hoisted(() => vi.fn(() => ({
  source: 'yandex' as const,
  invitationLinks: yandexInvitationLinks,
})))
const createYandexInvitationLinksRepository = vi.hoisted(() => vi.fn(() => yandexInvitationLinks))
const authState = vi.hoisted(() => vi.fn<() => MockAuthState>())

vi.mock('../data/repositories/app-feedback.repository', () => ({ appFeedbackRepository: supabaseBackendParts.appFeedbackRepository }))
vi.mock('../data/repositories/clients.repository', () => ({ clientsRepository: supabaseBackendParts.clientsRepository }))
vi.mock('../data/repositories/exercises.repository', () => ({ exercisesRepository: supabaseBackendParts.exercisesRepository }))
vi.mock('../data/repositories/goals.repository', () => ({ goalsRepository: supabaseBackendParts.goalsRepository }))
vi.mock('../data/repositories/invitations.repository', () => ({
  createYandexInvitationLinksRepository,
  invitationLinksRepository: supabaseBackendParts.invitationLinksRepository,
  invitationsRepository: supabaseBackendParts.invitationsRepository,
}))
vi.mock('../data/repositories/progress.repository', () => ({ progressRepository: supabaseBackendParts.progressRepository }))
vi.mock('../data/repositories/push-notifications.repository', () => ({ pushNotificationsRepository: supabaseBackendParts.pushNotificationsRepository }))
vi.mock('../data/repositories/realtime.repository', () => ({ realtimeRepository: supabaseBackendParts.realtimeRepository }))
vi.mock('../data/repositories/training-summaries.repository', () => ({ trainingSummariesRepository: supabaseBackendParts.trainingSummariesRepository }))
vi.mock('../data/repositories/workouts.repository', () => ({ workoutsRepository: supabaseBackendParts.workoutsRepository }))
vi.mock('../data/repositories/yandex-main.repository', () => ({ createYandexMainRepository }))
vi.mock('./auth-context', () => ({ useAuth: () => authState() }))
vi.mock('./yandex-app-session-context', () => ({ useYandexAppSession: () => ({
  session: {
    accessMode: 'read_write',
    profile: { id: USER_ID, firstName: null, lastName: null, timezone: 'Europe/Moscow', accountRole: 'trainer' },
    session: { token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z' },
  },
}) }))

function Probe() {
  const backend = useDataBackend()
  return <><p>{backend.source}</p><p>{(backend.invitationLinks as { kind?: string }).kind}</p></>
}

describe('DataBackendProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    createYandexMainRepository.mockClear()
  })

  const trainer = {
    kind: 'trainer', role: 'trainer', userId: USER_ID, email: null,
    firstName: null, lastName: null, timezone: 'Europe/Moscow',
  }

  it('uses the public Yandex invitation preview before authentication when main routing is on', () => {
    authState.mockReturnValue({ actor: null })
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test/')

    render(<DataBackendProvider><Probe /></DataBackendProvider>)

    expect(screen.getByText('supabase')).toBeVisible()
    expect(screen.getByText('yandex-links')).toBeVisible()
    expect(createYandexInvitationLinksRepository).toHaveBeenCalledWith(
      'https://stage.example.test', null,
    )
  })

  it('keeps the existing Supabase backend while main routing is default-off', () => {
    authState.mockReturnValue({ actor: trainer })
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')

    render(<DataBackendProvider><Probe /></DataBackendProvider>)

    expect(screen.getByText('supabase')).toBeVisible()
    expect(createYandexMainRepository).not.toHaveBeenCalled()
  })

  it('selects the Yandex backend for a matching server-authorized session', () => {
    authState.mockReturnValue({ actor: trainer })
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test/')

    render(<DataBackendProvider><Probe /></DataBackendProvider>)

    expect(screen.getByText('yandex')).toBeVisible()
    expect(createYandexMainRepository).toHaveBeenCalledWith(
      'https://stage.example.test', 'a'.repeat(43), expect.objectContaining({ userId: USER_ID }),
    )
  })

  it('fails closed when the global routing switch is not exact', () => {
    authState.mockReturnValue({ actor: trainer })
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'TRUE')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')

    render(<DataBackendProvider><Probe /></DataBackendProvider>)

    expect(screen.getByText('supabase')).toBeVisible()
  })
})
