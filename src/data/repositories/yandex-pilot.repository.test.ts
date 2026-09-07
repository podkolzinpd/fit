import { beforeEach, describe, expect, it, vi } from 'vitest'

import { yandexPilotRepository } from './yandex-pilot.repository'

const queries = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  exchangeCodeForAppSession: vi.fn(),
  getAppSession: vi.fn(),
  revokeAppSession: vi.fn(),
  linkYandexAccount: vi.fn(),
  listClients: vi.fn(),
  listConnections: vi.fn(),
  listTrainingData: vi.fn(),
  parseWorkout: vi.fn(),
  sendAssistantTurn: vi.fn(),
  listTrainingSummaries: vi.fn(),
  generateTrainingSummary: vi.fn(),
  publishTrainingSummary: vi.fn(),
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

const appSession = {
  ...session,
  accessMode: 'read_write',
  session: {
    token: 'a'.repeat(43),
    expiresAt: '2026-08-31T13:15:00.000Z',
  },
}

const CLIENT_ID = '6e577cc7-3b56-4a86-bc85-1ce2426ce249'
const CUSTOM_EXERCISE_ID = 'b27d65d0-6221-47cb-91a0-8dfcc0a2ceba'

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
    activity: {
      doneCount: 1,
      completionPercent: 100,
      lastWorkoutDate: '2026-08-20',
      daysInWork: 0,
      needsAttention: false,
    },
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
  customExercises: [{
    id: CUSTOM_EXERCISE_ID,
    name: 'Тестовая тяга Yandex stage',
    muscleGroup: 'back',
    inputKind: 'strength',
    archivedAt: null,
    version: 1,
  }],
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
    clientComment: null,
    sessionRpe: 8,
    wellbeing: 'normal',
    discomfort: false,
    feedbackSubmittedAt: '2026-08-20T13:01:00.000Z',
    trainerReaction: 'fire',
    trainerReview: 'Отличная работа',
    trainerReviewAuthorId: session.profile.id,
    trainerReviewedAt: '2026-08-20T13:05:00.000Z',
    clientQuestion: null,
    clientQuestionAskedAt: null,
    clientQuestionResolvedAt: null,
    startedAt: '2026-08-20T12:00:00.000Z',
    completedAt: '2026-08-20T13:00:00.000Z',
    version: 1,
    exercises: [{
      id: 'd40b742b-5d5b-41ab-91df-ed464414d034',
      position: 0,
      source: 'custom',
      ref: `custom:${CUSTOM_EXERCISE_ID}`,
      customExerciseId: CUSTOM_EXERCISE_ID,
      name: 'Тестовая тяга Yandex stage',
      muscleGroup: 'back',
      inputKind: 'strength',
      blockId: '8ffdb87b-078c-42d4-b6db-af8bc60f80f2',
      blockType: 'single',
      blockPreset: 'set',
      blockRounds: 1,
      restBetweenExercisesSec: 0,
      restBetweenRoundsSec: 90,
      restBetweenSetsSec: 90,
      trainerComment: 'Проверка весов и повторов',
      sets: [{
        id: 'ea8efab5-0530-4660-9798-79901fcddfeb',
        position: 0,
        plan: {
          weightKg: 40,
          reps: 10,
          durationMin: null,
          durationSec: null,
          distanceKm: null,
          rpe: 7,
        },
        fact: {
          weightKg: 42.5,
          reps: 10,
          durationMin: null,
          durationSec: null,
          distanceKm: null,
          rpe: 8,
        },
        confirmedAt: '2026-08-20T12:30:00.000Z',
        version: 1,
      }],
    }],
  }],
  attention: [],
  attentionPreferences: [{ clientId: CLIENT_ID, snoozedUntil: null }],
  hasMoreWorkouts: false,
}

describe('yandexPilotRepository', () => {
  beforeEach(() => {
    queries.exchangeCodeForSession.mockReset()
    queries.exchangeCodeForAppSession.mockReset()
    queries.getAppSession.mockReset()
    queries.revokeAppSession.mockReset()
    queries.linkYandexAccount.mockReset()
    queries.listClients.mockReset()
    queries.listConnections.mockReset()
    queries.listTrainingData.mockReset()
    queries.parseWorkout.mockReset()
    queries.sendAssistantTurn.mockReset()
    queries.listTrainingSummaries.mockReset()
    queries.generateTrainingSummary.mockReset()
    queries.publishTrainingSummary.mockReset()
    queries.claimInvitation.mockReset()
    queries.createInvitation.mockReset()
    queries.leaveClient.mockReset()
    queries.removeTrainer.mockReset()
    queries.revokeInvitation.mockReset()
  })

  it('validates native parser and training-summary responses', async () => {
    const generated = {
      id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
      client_id: CLIENT_ID,
      period_start: '2026-08-01',
      period_end: '2026-08-26',
      display_metrics: { completed_workouts: 1 },
      generated_at: '2026-08-26T12:00:00.000Z',
      trainer_summary: { headline: 'Внутренний вывод' },
    }
    queries.parseWorkout.mockResolvedValue(new Response(JSON.stringify({
      items: [{ sourceText: 'присед', exerciseRef: 'squat', confidence: 1, sets: [{ reps: 10 }] }],
      unmatched: [],
    }), { status: 200 }))
    queries.listTrainingSummaries.mockResolvedValue(new Response(JSON.stringify({
      summaries: [generated],
    }), { status: 200 }))
    queries.generateTrainingSummary.mockResolvedValue(new Response(JSON.stringify({
      data: generated,
      cached: false,
    }), { status: 200 }))

    await expect(yandexPilotRepository.parseWorkout(
      'https://stage.example.test', 's'.repeat(43), 'присед', [],
    )).resolves.toMatchObject({ items: [{ exerciseRef: 'squat' }] })
    await expect(yandexPilotRepository.listTrainingSummaries(
      'https://stage.example.test', 's'.repeat(43), CLIENT_ID,
    )).resolves.toEqual([generated])
    await expect(yandexPilotRepository.generateTrainingSummary(
      'https://stage.example.test', 's'.repeat(43), CLIENT_ID,
      '2026-08-01', '2026-08-26',
    )).resolves.toEqual({ data: generated, cached: false })
  })

  it('validates native Assistant turn responses and maps turn conflicts', async () => {
    queries.sendAssistantTurn.mockResolvedValueOnce(new Response(JSON.stringify({
      reply: 'Продолжайте диктовку.',
      action: {
        tool: 'record_workout',
        status: 'needs_input',
        title: 'Новая тренировка',
        description: 'Диктуйте упражнения.',
        payload: { step: 'workout' },
      },
    }), { status: 200 }))

    await expect(yandexPilotRepository.sendAssistantTurn(
      'https://stage.example.test',
      's'.repeat(43),
      CLIENT_ID,
      'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
      'запиши тренировку',
    )).resolves.toMatchObject({
      reply: 'Продолжайте диктовку.',
      action: { tool: 'record_workout', status: 'needs_input' },
    })
    expect(queries.sendAssistantTurn).toHaveBeenCalledWith(
      'https://stage.example.test',
      's'.repeat(43),
      CLIENT_ID,
      'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
      'запиши тренировку',
    )

    queries.sendAssistantTurn.mockResolvedValueOnce(new Response('{}', { status: 409 }))
    await expect(yandexPilotRepository.sendAssistantTurn(
      'https://stage.example.test',
      's'.repeat(43),
      CLIENT_ID,
      'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
      'другой текст',
    )).rejects.toThrow('уже был использован')
  })

  it('explains an empty summary period without invitation wording', async () => {
    queries.generateTrainingSummary.mockResolvedValue(new Response('{}', { status: 422 }))

    await expect(yandexPilotRepository.generateTrainingSummary(
      'https://stage.example.test', 's'.repeat(43), CLIENT_ID,
      '2026-08-01', '2026-08-26',
    )).rejects.toThrow('Для выбранного периода нет завершённых тренировок')
  })

  it('publishes a summary through the read-write command contract', async () => {
    queries.publishTrainingSummary.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(yandexPilotRepository.publishTrainingSummary(
      'https://stage.example.test',
      'a'.repeat(43),
      CLIENT_ID,
      { headline: 'Стабильный прогресс' },
      2,
    )).resolves.toBeUndefined()
    expect(queries.publishTrainingSummary).toHaveBeenCalledWith(
      'https://stage.example.test',
      'a'.repeat(43),
      CLIENT_ID,
      { headline: 'Стабильный прогресс' },
      2,
    )
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

  it('accepts the explicit read-write app session contract', async () => {
    queries.exchangeCodeForAppSession.mockResolvedValue(
      new Response(JSON.stringify(appSession), { status: 200 }),
    )

    await expect(yandexPilotRepository.exchangeCodeForAppSession(
      'https://stage.example.test',
      'code',
      'verifier',
    )).resolves.toEqual(appSession)
  })

  it('restores and revokes an opaque read-write app session', async () => {
    const profile = { accessMode: 'read_write', profile: appSession.profile }
    queries.getAppSession.mockResolvedValue(
      new Response(JSON.stringify(profile), { status: 200 }),
    )
    queries.revokeAppSession.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(yandexPilotRepository.getAppSession(
      'https://stage.example.test',
      appSession.session.token,
    )).resolves.toEqual(profile)
    await expect(yandexPilotRepository.revokeAppSession(
      'https://stage.example.test',
      appSession.session.token,
    )).resolves.toBeUndefined()
  })

  it('maps an invalid stored app session to an expired-session error', async () => {
    queries.getAppSession.mockResolvedValue(new Response('{}', { status: 401 }))

    await expect(yandexPilotRepository.getAppSession(
      'https://stage.example.test',
      appSession.session.token,
    )).rejects.toThrow('Сессия Yandex ID истекла')
  })

  it('keeps a read-only pilot session outside the app session contract', async () => {
    queries.exchangeCodeForAppSession.mockResolvedValue(
      new Response(JSON.stringify(session), { status: 200 }),
    )

    await expect(yandexPilotRepository.exchangeCodeForAppSession(
      'https://stage.example.test',
      'code',
      'verifier',
    )).rejects.toThrow('Stage вернул неподдерживаемый формат Yandex ID сессии')
  })

  it('maps a disabled app rollout to a Yandex Cloud rollout message', async () => {
    queries.exchangeCodeForAppSession.mockResolvedValue(new Response('{}', { status: 403 }))

    await expect(yandexPilotRepository.exchangeCodeForAppSession(
      'https://stage.example.test',
      'code',
      'verifier',
    )).rejects.toThrow('профиль ещё не включён')
  })

  it('links Yandex ID to the existing FIT profile with a validated result', async () => {
    queries.linkYandexAccount.mockResolvedValue(new Response(JSON.stringify({
      profileId: session.profile.id,
    }), { status: 200 }))

    await expect(yandexPilotRepository.linkYandexAccount(
      'https://stage.example.test',
      'supabase-session',
      'code',
      'verifier',
    )).resolves.toEqual({ profileId: session.profile.id })
    expect(queries.linkYandexAccount).toHaveBeenCalledWith(
      'https://stage.example.test',
      'supabase-session',
      'code',
      'verifier',
    )
  })

  it('maps Yandex ID linking conflicts without exposing identifiers', async () => {
    queries.linkYandexAccount.mockResolvedValue(new Response('{}', { status: 409 }))

    await expect(yandexPilotRepository.linkYandexAccount(
      'https://stage.example.test',
      'supabase-session',
      'code',
      'verifier',
    )).rejects.toThrow('уже связан')
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
      customExercises: trainingData.customExercises,
      workouts: trainingData.workouts,
      attention: trainingData.attention,
      attentionPreferences: trainingData.attentionPreferences,
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
