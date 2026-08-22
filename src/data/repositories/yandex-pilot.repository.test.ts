import { beforeEach, describe, expect, it, vi } from 'vitest'

import { yandexPilotRepository } from './yandex-pilot.repository'

const queries = vi.hoisted(() => ({
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
vi.mock('../queries/yandex-pilot.queries', () => ({ yandexPilotQueries: queries }))

const session = {
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
}

const CLIENT_ID = '6e577cc7-3b56-4a86-bc85-1ce2426ce249'

const clients = {
  accessMode: 'read_only',
  clients: [{
    id: CLIENT_ID,
    hasAccount: false,
    fullName: 'Анна Смирнова',
    canonicalFullName: 'Анна Смирнова',
    gender: 'female',
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
  }],
}

const connections = {
  accessMode: 'read_only',
  memberships: [{
    clientId: CLIENT_ID,
    trainerId: session.profile.id,
    firstName: 'Ирина',
    lastName: null,
    joinedAt: '2026-08-20T12:00:00.000Z',
    isRoot: true,
  }],
  invitations: [{
    id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
    clientId: CLIENT_ID,
    targetRole: 'client',
    expiresAt: '2026-08-27T12:00:00.000Z',
    createdAt: '2026-08-20T12:00:00.000Z',
  }],
}

const trainingData = {
  accessMode: 'read_only',
  customExercises: [],
  workouts: [{
    id: 'be3b5576-1f5f-4db1-944b-cd78f06aa73b',
    trainerId: session.profile.id,
    clientId: CLIENT_ID,
    clientName: 'Анна Смирнова',
    createdBy: session.profile.id,
    workoutDate: '2026-08-20',
    startTime: null,
    endTime: null,
    status: 'done',
    notes: null,
    startedAt: '2026-08-20T12:00:00.000Z',
    completedAt: '2026-08-20T13:00:00.000Z',
    version: 1,
    exercises: [],
  }],
  hasMoreWorkouts: false,
}

describe('yandexPilotRepository', () => {
  beforeEach(() => {
    queries.exchangeCodeForSession.mockReset()
    queries.listClients.mockReset()
    queries.listConnections.mockReset()
    queries.listTrainingData.mockReset()
    queries.claimInvitation.mockReset()
    queries.createInvitation.mockReset()
    queries.leaveClient.mockReset()
    queries.removeTrainer.mockReset()
    queries.revokeInvitation.mockReset()
  })

  it('accepts the explicit read-only session contract', async () => {
    queries.exchangeCodeForSession.mockResolvedValue(
      new Response(JSON.stringify(session), { status: 200 }),
    )

    await expect(yandexPilotRepository.exchangeCodeForSession(
      'https://stage.example.test',
      'code',
      'verifier',
    )).resolves.toEqual(session)
  })

  it('keeps non-allowlisted identities outside the pilot', async () => {
    queries.exchangeCodeForSession.mockResolvedValue(new Response('{}', { status: 403 }))

    await expect(yandexPilotRepository.exchangeCodeForSession(
      'https://stage.example.test',
      'code',
      'verifier',
    )).rejects.toThrow('Этот аккаунт пока не добавлен в пилот')
  })

  it('rejects a malformed session response', async () => {
    queries.exchangeCodeForSession.mockResolvedValue(new Response(JSON.stringify({
      profile: { id: 'raw-yandex-id' },
      session: { token: 'raw-yandex-token' },
    }), { status: 200 }))

    await expect(yandexPilotRepository.exchangeCodeForSession(
      'https://stage.example.test',
      'code',
      'verifier',
    )).rejects.toThrow('Stage вернул неподдерживаемый формат сессии')
  })

  it('reads clients with the app session and validates the domain shape', async () => {
    queries.listClients.mockResolvedValue(
      new Response(JSON.stringify(clients), { status: 200 }),
    )

    await expect(yandexPilotRepository.listClients(
      'https://stage.example.test',
      's'.repeat(43),
    )).resolves.toEqual(clients.clients)
    expect(queries.listClients).toHaveBeenCalledWith(
      'https://stage.example.test',
      's'.repeat(43),
    )
  })

  it('rejects an invalid client response instead of rendering partial data', async () => {
    queries.listClients.mockResolvedValue(new Response(JSON.stringify({
      accessMode: 'read_only',
      clients: [{ id: 'not-a-uuid' }],
    }), { status: 200 }))

    await expect(yandexPilotRepository.listClients(
      'https://stage.example.test',
      's'.repeat(43),
    )).rejects.toThrow('Stage вернул неподдерживаемый формат клиентов.')
  })

  it('reads memberships and active invitations with validated shapes', async () => {
    queries.listConnections.mockResolvedValue(
      new Response(JSON.stringify(connections), { status: 200 }),
    )

    await expect(yandexPilotRepository.listConnections(
      'https://stage.example.test',
      's'.repeat(43),
    )).resolves.toEqual({
      memberships: connections.memberships,
      invitations: connections.invitations,
    })
  })

  it('rejects malformed membership data', async () => {
    queries.listConnections.mockResolvedValue(new Response(JSON.stringify({
      accessMode: 'read_only',
      memberships: [{ clientId: CLIENT_ID, trainerId: 'not-a-uuid' }],
      invitations: [],
    }), { status: 200 }))

    await expect(yandexPilotRepository.listConnections(
      'https://stage.example.test',
      's'.repeat(43),
    )).rejects.toThrow('Stage вернул неподдерживаемый формат связей.')
  })

  it('reads a validated read-only workout aggregate', async () => {
    queries.listTrainingData.mockResolvedValue(
      new Response(JSON.stringify(trainingData), { status: 200 }),
    )

    await expect(yandexPilotRepository.listTrainingData(
      'https://stage.example.test',
      's'.repeat(43),
    )).resolves.toEqual({
      customExercises: [],
      workouts: trainingData.workouts,
      hasMoreWorkouts: false,
    })
  })

  it('rejects malformed workout data instead of rendering a partial aggregate', async () => {
    queries.listTrainingData.mockResolvedValue(new Response(JSON.stringify({
      ...trainingData,
      workouts: [{ ...trainingData.workouts[0], workoutDate: '20.08.2026' }],
    }), { status: 200 }))

    await expect(yandexPilotRepository.listTrainingData(
      'https://stage.example.test',
      's'.repeat(43),
    )).rejects.toThrow('Stage вернул неподдерживаемый формат тренировок.')
  })

  it('creates and claims invitations with validated one-time values', async () => {
    const invitation = {
      id: connections.invitations[0]!.id,
      clientId: CLIENT_ID,
      targetRole: 'client',
      code: 'ABCDEF123456',
      expiresAt: '2026-08-27T12:00:00.000Z',
    }
    queries.createInvitation.mockResolvedValue(new Response(JSON.stringify({
      invitation,
    }), { status: 201 }))
    queries.claimInvitation.mockResolvedValue(new Response(JSON.stringify({
      clientId: CLIENT_ID,
    }), { status: 200 }))

    await expect(yandexPilotRepository.createInvitation(
      'https://stage.example.test',
      's'.repeat(43),
      CLIENT_ID,
      'client',
    )).resolves.toEqual(invitation)
    await expect(yandexPilotRepository.claimInvitation(
      'https://stage.example.test',
      's'.repeat(43),
      'abcdef123456',
    )).resolves.toBe(CLIENT_ID)
    expect(queries.claimInvitation).toHaveBeenCalledWith(
      'https://stage.example.test',
      's'.repeat(43),
      'ABCDEF123456',
    )
  })

  it('maps guarded command failures to actionable messages', async () => {
    queries.revokeInvitation.mockResolvedValue(new Response('{}', { status: 403 }))
    queries.removeTrainer.mockResolvedValue(new Response('{}', { status: 422 }))

    await expect(yandexPilotRepository.revokeInvitation(
      'https://stage.example.test',
      's'.repeat(43),
      connections.invitations[0]!.id,
    )).rejects.toThrow('Недостаточно прав')
    await expect(yandexPilotRepository.removeTrainer(
      'https://stage.example.test',
      's'.repeat(43),
      CLIENT_ID,
      session.profile.id,
    )).rejects.toThrow('Основного тренера нельзя отключить')
  })

  it('accepts no-content responses for revoke, remove and leave', async () => {
    queries.revokeInvitation.mockResolvedValue(new Response(null, { status: 204 }))
    queries.removeTrainer.mockResolvedValue(new Response(null, { status: 204 }))
    queries.leaveClient.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(yandexPilotRepository.revokeInvitation(
      'https://stage.example.test',
      's'.repeat(43),
      connections.invitations[0]!.id,
    )).resolves.toBeUndefined()
    await expect(yandexPilotRepository.removeTrainer(
      'https://stage.example.test',
      's'.repeat(43),
      CLIENT_ID,
      session.profile.id,
    )).resolves.toBeUndefined()
    await expect(yandexPilotRepository.leaveClient(
      'https://stage.example.test',
      's'.repeat(43),
      CLIENT_ID,
    )).resolves.toBeUndefined()
  })
})
