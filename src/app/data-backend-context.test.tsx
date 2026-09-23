import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataBackendProvider, useDataBackend } from './data-backend-context'

const USER_ID = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
const providerState = vi.hoisted(() => ({ actorPresent: true, sessionPresent: true, profileId: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b' }))
const supabaseBackendParts = vi.hoisted(() => ({
  appFeedbackRepository: {}, clientsRepository: {}, exercisesRepository: {}, goalsRepository: {},
  invitationsRepository: {}, legalRepository: {}, progressRepository: {}, pushNotificationsRepository: {},
  realtimeRepository: {}, trainingSummariesRepository: {}, workoutsRepository: {},
}))
const createYandexMainRepository = vi.hoisted(() => vi.fn(() => ({ source: 'yandex' as const })))

vi.mock('../data/repositories/app-feedback.repository', () => ({ appFeedbackRepository: supabaseBackendParts.appFeedbackRepository }))
vi.mock('../data/repositories/clients.repository', () => ({ clientsRepository: supabaseBackendParts.clientsRepository }))
vi.mock('../data/repositories/exercises.repository', () => ({ exercisesRepository: supabaseBackendParts.exercisesRepository }))
vi.mock('../data/repositories/goals.repository', () => ({ goalsRepository: supabaseBackendParts.goalsRepository }))
vi.mock('../data/repositories/invitations.repository', () => ({ invitationsRepository: supabaseBackendParts.invitationsRepository }))
vi.mock('../data/repositories/legal.repository', () => ({ legalRepository: supabaseBackendParts.legalRepository }))
vi.mock('../data/repositories/progress.repository', () => ({ progressRepository: supabaseBackendParts.progressRepository }))
vi.mock('../data/repositories/push-notifications.repository', () => ({ pushNotificationsRepository: supabaseBackendParts.pushNotificationsRepository }))
vi.mock('../data/repositories/realtime.repository', () => ({ realtimeRepository: supabaseBackendParts.realtimeRepository }))
vi.mock('../data/repositories/training-summaries.repository', () => ({ trainingSummariesRepository: supabaseBackendParts.trainingSummariesRepository }))
vi.mock('../data/repositories/workouts.repository', () => ({ workoutsRepository: supabaseBackendParts.workoutsRepository }))
vi.mock('../data/repositories/yandex-main.repository', () => ({ createYandexMainRepository }))
vi.mock('./auth-context', () => ({ useAuth: () => ({
  actor: providerState.actorPresent
    ? { kind: 'trainer', role: 'trainer', userId: USER_ID, email: null, firstName: null, lastName: null, timezone: 'Europe/Moscow' }
    : null,
}) }))
vi.mock('./yandex-app-session-context', () => ({ useYandexAppSession: () => ({
  session: providerState.sessionPresent ? {
    accessMode: 'read_write',
    profile: { id: providerState.profileId, firstName: null, lastName: null, timezone: 'Europe/Moscow', accountRole: 'trainer' },
    session: { token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z' },
  } : null,
}) }))

function Probe() {
  return <p>{useDataBackend().source}</p>
}

describe('DataBackendProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    createYandexMainRepository.mockClear()
    providerState.actorPresent = true
    providerState.sessionPresent = true
    providerState.profileId = USER_ID
  })

  it('keeps the existing Supabase backend while main routing is default-off', () => {
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')

    render(<DataBackendProvider><Probe /></DataBackendProvider>)

    expect(screen.getByText('supabase')).toBeVisible()
    expect(createYandexMainRepository).not.toHaveBeenCalled()
  })

  it('selects the Yandex backend for a matching server-authorized session', () => {
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
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'TRUE')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')

    render(<DataBackendProvider><Probe /></DataBackendProvider>)

    expect(screen.getByText('supabase')).toBeVisible()
  })

  it('does not select Supabase for an authenticated actor with a missing Yandex session', () => {
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_APP_SESSION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_NATIVE_REGISTRATION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_ONLY_AUTH_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
    providerState.sessionPresent = false

    expect(() => render(<DataBackendProvider><Probe /></DataBackendProvider>))
      .toThrow('Сессия Yandex ID недоступна. Войдите снова.')
    expect(createYandexMainRepository).not.toHaveBeenCalled()
  })

  it('does not select Supabase for an authenticated actor with a mismatched Yandex session', () => {
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_APP_SESSION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_NATIVE_REGISTRATION_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_ONLY_AUTH_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
    providerState.profileId = '73c868ff-0dd4-4f76-a890-57846b302a92'

    expect(() => render(<DataBackendProvider><Probe /></DataBackendProvider>))
      .toThrow('Сессия Yandex ID недоступна. Войдите снова.')
    expect(createYandexMainRepository).not.toHaveBeenCalled()
  })
})
