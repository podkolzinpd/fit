import { StrictMode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YandexPilotCallbackPage } from './AuthPages'
import { YandexPilotConnections } from './YandexPilotConnections'
import { createYandexAuthorizationUrl } from './yandex-pilot-oauth'

const pilot = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  listClients: vi.fn(),
  listConnections: vi.fn(),
  listTrainingData: vi.fn(),
  claimInvitation: vi.fn(),
  createInvitation: vi.fn(),
  leaveClient: vi.fn(),
  removeTrainer: vi.fn(),
  revokeInvitation: vi.fn(),
}))
vi.mock('../../data/repositories/yandex-pilot.repository', () => ({
  yandexPilotRepository: {
    exchangeCodeForSession: pilot.exchangeCodeForSession,
    listClients: pilot.listClients,
    listConnections: pilot.listConnections,
    listTrainingData: pilot.listTrainingData,
    claimInvitation: pilot.claimInvitation,
    createInvitation: pilot.createInvitation,
    leaveClient: pilot.leaveClient,
    removeTrainer: pilot.removeTrainer,
    revokeInvitation: pilot.revokeInvitation,
  },
}))

async function callbackSearch(): Promise<string> {
  const authorizationUrl = new URL(await createYandexAuthorizationUrl(
    'public-client-id',
    'http://localhost/auth/yandex/callback',
  ))
  return `?code=one-time-code&state=${authorizationUrl.searchParams.get('state')}`
}

describe('Yandex ID pilot callback page', () => {
  beforeEach(() => {
    pilot.exchangeCodeForSession.mockReset()
    pilot.listClients.mockReset()
    pilot.listConnections.mockReset()
    pilot.listTrainingData.mockReset()
    pilot.claimInvitation.mockReset()
    pilot.createInvitation.mockReset()
    pilot.leaveClient.mockReset()
    pilot.removeTrainer.mockReset()
    pilot.revokeInvitation.mockReset()
    pilot.listConnections.mockResolvedValue({ memberships: [], invitations: [] })
    pilot.listTrainingData.mockResolvedValue({
      customExercises: [],
      workouts: [],
      hasMoreWorkouts: false,
    })
    vi.stubEnv('VITE_YANDEX_ID_PILOT_ENABLED', 'true')
    vi.stubEnv('VITE_YANDEX_OAUTH_CLIENT_ID', 'public-client-id')
    vi.stubEnv('VITE_YANDEX_API_BASE_URL', 'https://stage.example.test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    window.history.replaceState(null, '', '/')
    sessionStorage.clear()
  })

  it('removes the OAuth query and shows the read-only profile with its clients', async () => {
    pilot.exchangeCodeForSession.mockResolvedValue({
      accessMode: 'read_only',
      profile: {
        id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
        firstName: 'Ирина',
        lastName: null,
        timezone: 'Europe/Moscow',
        accountRole: 'trainer',
      },
      session: {
        token: 's'.repeat(43),
        expiresAt: '2026-08-20T13:15:00.000Z',
      },
    })
    pilot.listClients.mockResolvedValue([{
      id: '6e577cc7-3b56-4a86-bc85-1ce2426ce249',
      fullName: 'Анна Смирнова',
      ageYears: 31,
      heightCm: 168,
      goal: 'Подготовка к старту',
    }])
    pilot.listConnections.mockResolvedValue({
      memberships: [{
        clientId: '6e577cc7-3b56-4a86-bc85-1ce2426ce249',
        trainerId: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
        firstName: 'Ирина',
        lastName: null,
        joinedAt: '2026-08-20T12:00:00.000Z',
        isRoot: true,
      }],
      invitations: [{
        id: 'a64d98d9-5b1d-4d4a-9028-2114fa361c0f',
        clientId: '6e577cc7-3b56-4a86-bc85-1ce2426ce249',
        targetRole: 'client',
        expiresAt: '2026-08-27T12:00:00.000Z',
        createdAt: '2026-08-20T12:00:00.000Z',
      }],
    })
    pilot.listTrainingData.mockResolvedValue({
      customExercises: [{
        id: '8f3c305e-f206-40b3-a8f0-a8d8b3df34b9',
        name: 'Тяга саней',
        muscleGroup: 'legs',
        inputKind: 'strength',
        archivedAt: null,
        version: 1,
      }],
      workouts: [{
        id: 'be3b5576-1f5f-4db1-944b-cd78f06aa73b',
        trainerId: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
        clientId: '6e577cc7-3b56-4a86-bc85-1ce2426ce249',
        clientName: 'Анна Смирнова',
        createdBy: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
        workoutDate: '2026-08-20',
        startTime: '10:00:00',
        endTime: null,
        status: 'planned',
        notes: null,
        startedAt: null,
        completedAt: null,
        version: 1,
        exercises: [{
          id: '7e1bb6d7-7717-41ea-aea5-0d8d0ea50c35',
          position: 0,
          source: 'system',
          ref: 'running',
          customExerciseId: null,
          name: 'Бег',
          muscleGroup: 'cardio',
          inputKind: 'distance',
          blockId: '7d3b454b-933c-43a6-9331-ac4009644933',
          blockType: 'single',
          blockPreset: 'set',
          blockRounds: 1,
          restBetweenExercisesSec: 0,
          restBetweenRoundsSec: 90,
          restBetweenSetsSec: 90,
          trainerComment: null,
          sets: [{
            id: '5f2a3b76-c149-43f2-a7ab-290b2dfdcd11',
            position: 0,
            plan: {
              weightKg: null,
              reps: null,
              durationMin: null,
              durationSec: 1800,
              distanceKm: 5,
              rpe: 7,
            },
            fact: {
              weightKg: null,
              reps: null,
              durationMin: null,
              durationSec: null,
              distanceKm: null,
              rpe: null,
            },
            confirmedAt: null,
            version: 1,
          }],
        }],
      }],
      hasMoreWorkouts: false,
    })
    window.history.replaceState(null, '', `/auth/yandex/callback${await callbackSearch()}`)

    render(<StrictMode><MemoryRouter><YandexPilotCallbackPage /></MemoryRouter></StrictMode>)

    expect(window.location.search).toBe('')
    expect(await screen.findByRole('heading', { name: 'Доступ подтверждён' })).toBeVisible()
    expect(screen.getByText('Ирина')).toBeVisible()
    expect(screen.getByText('Ограниченный пилот')).toBeVisible()
    expect(await screen.findAllByText('Анна Смирнова')).toHaveLength(3)
    expect(screen.getByText('31 лет · 168 см · Подготовка к старту')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Анна Смирнова' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Связи и приглашения' })).toBeVisible()
    expect(screen.getByText('Ирина · основной')).toBeVisible()
    expect(screen.getByText(/Активное приглашение для клиента до/)).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Тренировки в stage' })).toBeVisible()
    expect(screen.getByText('Тяга саней')).toBeVisible()
    expect(screen.getByText('Бег')).toBeVisible()
    expect(screen.getByText('1800 сек. · 5 км · RPE 7')).toBeVisible()
    expect(pilot.exchangeCodeForSession).toHaveBeenCalledWith(
      'https://stage.example.test',
      'one-time-code',
      expect.stringMatching(/^[A-Za-z0-9_-]{43,128}$/),
    )
    expect(pilot.listClients).toHaveBeenCalledWith(
      'https://stage.example.test',
      's'.repeat(43),
    )
    expect(pilot.exchangeCodeForSession).toHaveBeenCalledTimes(1)
    expect(pilot.listClients).toHaveBeenCalledTimes(1)
    expect(pilot.listConnections).toHaveBeenCalledWith(
      'https://stage.example.test',
      's'.repeat(43),
    )
    expect(pilot.listConnections).toHaveBeenCalledTimes(1)
    expect(pilot.listTrainingData).toHaveBeenCalledWith(
      'https://stage.example.test',
      's'.repeat(43),
    )
    expect(pilot.listTrainingData).toHaveBeenCalledTimes(1)
  })

  it('shows an explicit empty state before tenant data is migrated', async () => {
    pilot.exchangeCodeForSession.mockResolvedValue({
      accessMode: 'read_only',
      profile: {
        id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
        firstName: null,
        lastName: null,
        timezone: 'Europe/Moscow',
        accountRole: 'trainer',
      },
      session: {
        token: 's'.repeat(43),
        expiresAt: '2026-08-20T13:15:00.000Z',
      },
    })
    pilot.listClients.mockResolvedValue([])
    window.history.replaceState(null, '', `/auth/yandex/callback${await callbackSearch()}`)

    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByText('В stage пока нет клиентов')).toBeVisible()
    expect(screen.getByText('Список появится после переноса данных этого тренера.')).toBeVisible()
    expect(screen.getByText('В stage пока нет связей')).toBeVisible()
    expect(screen.getByText('Введите код приглашения или дождитесь переноса клиентской карточки.')).toBeVisible()
    expect(screen.getByText('В stage пока нет тренировок')).toBeVisible()
  })

  it('keeps the profile visible and retries a failed client read', async () => {
    const user = userEvent.setup()
    pilot.exchangeCodeForSession.mockResolvedValue({
      accessMode: 'read_only',
      profile: {
        id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
        firstName: 'Ирина',
        lastName: null,
        timezone: 'Europe/Moscow',
        accountRole: 'trainer',
      },
      session: {
        token: 's'.repeat(43),
        expiresAt: '2026-08-20T13:15:00.000Z',
      },
    })
    pilot.listClients
      .mockRejectedValueOnce(new Error('Пилот временно недоступен. Попробуйте позднее.'))
      .mockResolvedValueOnce([])
    window.history.replaceState(null, '', `/auth/yandex/callback${await callbackSearch()}`)

    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByText('Пилот временно недоступен. Попробуйте позднее.')).toBeVisible()
    expect(screen.getByText('Ирина')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('В stage пока нет клиентов')).toBeVisible()
    expect(pilot.listClients).toHaveBeenCalledTimes(2)
  })

  it('keeps the profile visible and retries a failed connections read', async () => {
    const user = userEvent.setup()
    pilot.exchangeCodeForSession.mockResolvedValue({
      accessMode: 'read_only',
      profile: {
        id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
        firstName: 'Ирина',
        lastName: null,
        timezone: 'Europe/Moscow',
        accountRole: 'trainer',
      },
      session: {
        token: 's'.repeat(43),
        expiresAt: '2026-08-20T13:15:00.000Z',
      },
    })
    pilot.listClients.mockResolvedValue([])
    pilot.listConnections
      .mockRejectedValueOnce(new Error('Пилот временно недоступен. Попробуйте позднее.'))
      .mockResolvedValueOnce({ memberships: [], invitations: [] })
    window.history.replaceState(null, '', `/auth/yandex/callback${await callbackSearch()}`)

    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByText('Пилот временно недоступен. Попробуйте позднее.')).toBeVisible()
    expect(screen.getByText('Ирина')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('В stage пока нет связей')).toBeVisible()
    expect(pilot.listConnections).toHaveBeenCalledTimes(2)
  })

  it('creates, claims and revokes invitations inside the isolated pilot', async () => {
    const user = userEvent.setup()
    const profileId = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
    const clientId = '6e577cc7-3b56-4a86-bc85-1ce2426ce249'
    const invitationId = 'a64d98d9-5b1d-4d4a-9028-2114fa361c0f'
    pilot.exchangeCodeForSession.mockResolvedValue({
      accessMode: 'read_only',
      profile: {
        id: profileId,
        firstName: 'Ирина',
        lastName: null,
        timezone: 'Europe/Moscow',
        accountRole: 'trainer',
      },
      session: {
        token: 's'.repeat(43),
        expiresAt: '2026-08-20T13:15:00.000Z',
      },
    })
    pilot.listClients.mockResolvedValue([{
      id: clientId,
      hasAccount: false,
      fullName: 'Анна Смирнова',
      ageYears: 31,
      heightCm: 168,
      goal: null,
    }])
    pilot.listConnections.mockResolvedValue({
      memberships: [{
        clientId,
        trainerId: profileId,
        firstName: 'Ирина',
        lastName: null,
        joinedAt: '2026-08-20T12:00:00.000Z',
        isRoot: true,
      }],
      invitations: [{
        id: invitationId,
        clientId,
        targetRole: 'client',
        expiresAt: '2026-08-27T12:00:00.000Z',
        createdAt: '2026-08-20T12:00:00.000Z',
      }],
    })
    pilot.createInvitation.mockResolvedValue({
      id: invitationId,
      clientId,
      targetRole: 'client',
      code: 'ABCDEF123456',
      expiresAt: '2026-08-27T12:00:00.000Z',
    })
    pilot.claimInvitation.mockResolvedValue(clientId)
    pilot.revokeInvitation.mockResolvedValue(undefined)
    window.history.replaceState(null, '', `/auth/yandex/callback${await callbackSearch()}`)

    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Пригласить клиента' }))
    expect(await screen.findByText('ABCDEF123456')).toBeVisible()
    expect(pilot.createInvitation).toHaveBeenCalledWith(
      'https://stage.example.test',
      's'.repeat(43),
      clientId,
      'client',
    )

    await user.type(screen.getByRole('textbox', { name: 'Код приглашения' }), 'abcdef123456')
    await user.click(screen.getByRole('button', { name: 'Принять приглашение' }))
    expect(await screen.findByText('Приглашение принято, связь добавлена.')).toBeVisible()
    expect(pilot.claimInvitation).toHaveBeenCalledWith(
      'https://stage.example.test',
      's'.repeat(43),
      'ABCDEF123456',
    )

    await user.click(screen.getByRole('button', { name: 'Отозвать' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Отозвать' }))
    expect(await screen.findByText('Приглашение отозвано.')).toBeVisible()
    expect(pilot.revokeInvitation).toHaveBeenCalledWith(
      'https://stage.example.test',
      's'.repeat(43),
      invitationId,
    )
  })

  it('shows an allowlist error without exposing the pilot profile', async () => {
    pilot.exchangeCodeForSession.mockRejectedValue(new Error('Этот аккаунт пока не добавлен в пилот.'))
    window.history.replaceState(null, '', `/auth/yandex/callback${await callbackSearch()}`)

    render(<MemoryRouter><YandexPilotCallbackPage /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Не удалось войти' })).toBeVisible()
    expect(screen.getByText('Этот аккаунт пока не добавлен в пилот.')).toBeVisible()
    await waitFor(() => expect(window.location.search).toBe(''))
  })
})

describe('Yandex ID pilot membership controls', () => {
  const apiBaseUrl = 'https://stage.example.test'
  const clientId = '6e577cc7-3b56-4a86-bc85-1ce2426ce249'
  const rootTrainerId = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
  const memberTrainerId = '1c2c8c58-2903-4389-91ba-705f871ae712'
  const clientActorId = '25cbe3d6-c291-4bef-8d3e-f210dbde6fa9'
  const clients = [{
    id: clientId,
    hasAccount: true,
    fullName: 'Анна Смирнова',
    canonicalFullName: 'Анна Смирнова',
    gender: 'female' as const,
    ageYears: 31,
    ageUpdatedAt: '2026-08-20',
    heightCm: 168,
    goal: null,
    note: null,
    currentWeightKg: null,
    lastActivityAt: '2026-08-20T12:00:00.000Z',
    archivedAt: null,
    version: 1,
    membershipVersion: 1,
    activity: {
      doneCount: 1,
      completionPercent: 100,
      lastWorkoutDate: '2026-08-20',
      daysInWork: 0,
      needsAttention: false,
    },
  }]
  const connections = {
    memberships: [{
      clientId,
      trainerId: rootTrainerId,
      firstName: 'Ирина',
      lastName: null,
      joinedAt: '2026-08-19T12:00:00.000Z',
      isRoot: true,
    }, {
      clientId,
      trainerId: memberTrainerId,
      firstName: 'Олег',
      lastName: null,
      joinedAt: '2026-08-20T12:00:00.000Z',
      isRoot: false,
    }],
    invitations: [],
  }

  beforeEach(() => {
    pilot.leaveClient.mockReset()
    pilot.removeTrainer.mockReset()
  })

  it('confirms removal for a client and never offers removal of the root trainer', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    pilot.removeTrainer.mockResolvedValue(undefined)
    render(<MemoryRouter><YandexPilotConnections
      apiBaseUrl={apiBaseUrl}
      clients={clients}
      connections={connections}
      error={null}
      loading={false}
      onRefresh={onRefresh}
      session={{
        accessMode: 'read_only',
        profile: {
          id: clientActorId,
          firstName: 'Анна',
          lastName: null,
          timezone: 'Europe/Moscow',
          accountRole: 'client',
        },
        session: { token: 's'.repeat(43), expiresAt: '2026-08-20T13:15:00.000Z' },
      }}
    /></MemoryRouter>)

    expect(screen.getAllByRole('button', { name: 'Отключить тренера' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Отключить тренера' }))
    await user.click(within(await screen.findByRole('alertdialog'))
      .getByRole('button', { name: 'Отключить' }))

    expect(pilot.removeTrainer).toHaveBeenCalledWith(
      apiBaseUrl,
      's'.repeat(43),
      clientId,
      memberTrainerId,
    )
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('lets only a connected non-root trainer leave the client space', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    pilot.leaveClient.mockResolvedValue(undefined)
    render(<MemoryRouter><YandexPilotConnections
      apiBaseUrl={apiBaseUrl}
      clients={clients}
      connections={connections}
      error={null}
      loading={false}
      onRefresh={onRefresh}
      session={{
        accessMode: 'read_only',
        profile: {
          id: memberTrainerId,
          firstName: 'Олег',
          lastName: null,
          timezone: 'Europe/Moscow',
          accountRole: 'trainer',
        },
        session: { token: 's'.repeat(43), expiresAt: '2026-08-20T13:15:00.000Z' },
      }}
    /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: 'Покинуть пространство' }))
    await user.click(within(await screen.findByRole('alertdialog'))
      .getByRole('button', { name: 'Покинуть' }))

    expect(pilot.leaveClient).toHaveBeenCalledWith(
      apiBaseUrl,
      's'.repeat(43),
      clientId,
    )
    expect(onRefresh).toHaveBeenCalledOnce()
  })
})
