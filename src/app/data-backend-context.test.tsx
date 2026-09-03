import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataBackendProvider, useDataBackend } from './data-backend-context'

const USER_ID = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
const supabaseBackendParts = vi.hoisted(() => ({
  appFeedbackRepository: {}, clientsRepository: {}, exercisesRepository: {}, goalsRepository: {},
  invitationsRepository: {}, progressRepository: {}, pushNotificationsRepository: {},
  realtimeRepository: {}, trainingSummariesRepository: {}, workoutsRepository: {},
}))
const createYandexMainRepository = vi.hoisted(() => vi.fn(() => ({ source: 'yandex' as const })))

vi.mock('../data/repositories/app-feedback.repository', () => ({ appFeedbackRepository: supabaseBackendParts.appFeedbackRepository }))
vi.mock('../data/repositories/clients.repository', () => ({ clientsRepository: supabaseBackendParts.clientsRepository }))
vi.mock('../data/repositories/exercises.repository', () => ({ exercisesRepository: supabaseBackendParts.exercisesRepository }))
vi.mock('../data/repositories/goals.repository', () => ({ goalsRepository: supabaseBackendParts.goalsRepository }))
vi.mock('../data/repositories/invitations.repository', () => ({ invitationsRepository: supabaseBackendParts.invitationsRepository }))
vi.mock('../data/repositories/progress.repository', () => ({ progressRepository: supabaseBackendParts.progressRepository }))
vi.mock('../data/repositories/push-notifications.repository', () => ({ pushNotificationsRepository: supabaseBackendParts.pushNotificationsRepository }))
vi.mock('../data/repositories/realtime.repository', () => ({ realtimeRepository: supabaseBackendParts.realtimeRepository }))
vi.mock('../data/repositories/training-summaries.repository', () => ({ trainingSummariesRepository: supabaseBackendParts.trainingSummariesRepository }))
vi.mock('../data/repositories/workouts.repository', () => ({ workoutsRepository: supabaseBackendParts.workoutsRepository }))
vi.mock('../data/repositories/yandex-main.repository', () => ({ createYandexMainRepository }))
vi.mock('./auth-context', () => ({ useAuth: () => ({
  actor: { kind: 'trainer', role: 'trainer', userId: USER_ID, email: null, firstName: null, lastName: null, timezone: 'Europe/Moscow' },
}) }))
vi.mock('./yandex-app-session-context', () => ({ useYandexAppSession: () => ({
  session: {
    accessMode: 'read_write',
    profile: { id: USER_ID, firstName: null, lastName: null, timezone: 'Europe/Moscow', accountRole: 'trainer' },
    session: { token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z' },
  },
}) }))

function Probe() {
  return <p>{useDataBackend().source}</p>
}

describe('DataBackendProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    createYandexMainRepository.mockClear()
  })

  it('keeps the existing Supabase backend while main routing is default-off', () => {
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_PILOT_USER_IDS', USER_ID)

    render(<DataBackendProvider><Probe /></DataBackendProvider>)

    expect(screen.getByText('supabase')).toBeVisible()
    expect(createYandexMainRepository).not.toHaveBeenCalled()
  })

  it('selects one Yandex backend for the matching session and allowlist', () => {
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_PILOT_USER_IDS', USER_ID)
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test/')

    render(<DataBackendProvider><Probe /></DataBackendProvider>)

    expect(screen.getByText('yandex')).toBeVisible()
    expect(createYandexMainRepository).toHaveBeenCalledWith(
      'https://stage.example.test', 'a'.repeat(43), expect.objectContaining({ userId: USER_ID }),
    )
  })

  it('fails closed when more than one profile is configured', () => {
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_MAIN_ROUTING_PILOT_USER_IDS', `${USER_ID},11111111-1111-4111-8111-111111111111`)
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')

    render(<DataBackendProvider><Probe /></DataBackendProvider>)

    expect(screen.getByText('supabase')).toBeVisible()
  })
})
