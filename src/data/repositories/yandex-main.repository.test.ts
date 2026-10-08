import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ClientTrainingSummary,
  SessionActor,
  Workout,
  WorkoutDraft,
  WorkoutExerciseDraft,
} from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { PRIVACY_VERSION, TERMS_VERSION } from '../../shared/legal'
import { getRequestDiagnostics } from '../../shared/request-diagnostics'
import type { YandexTrainingDataPage } from '../queries/yandex-pilot.queries'
import { createYandexMainRepository } from './yandex-main.repository'

const pilot = vi.hoisted(() => ({ listTrainingData: vi.fn(), parseWorkout: vi.fn() }))
vi.mock('./yandex-pilot.repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./yandex-pilot.repository')>()
  return {
    ...actual,
    yandexPilotRepository: {
      ...actual.yandexPilotRepository,
      listTrainingData: pilot.listTrainingData,
      parseWorkout: pilot.parseWorkout,
    },
  }
})

const push = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  isSupported: vi.fn().mockReturnValue(true),
  getCurrent: vi.fn().mockResolvedValue({ endpoint: 'https://push.example/pilot-device', p256dh: 'p', authKey: 'a' }),
}))
vi.mock('../../features/notifications/push-subscription', () => ({
  subscribeToPush: push.subscribe,
  unsubscribeFromPush: push.unsubscribe,
  isPushSupported: push.isSupported,
  getCurrentPushSubscription: push.getCurrent,
}))

const actor: SessionActor = {
  kind: 'trainer', role: 'trainer', userId: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
  email: null, firstName: 'Ирина', lastName: null, timezone: 'Europe/Moscow',
}
const sessionToken = 'a'.repeat(43)
const apiBaseUrl = 'https://stage.example.test'
const clientId = '1a0c5295-0a0f-4ccb-a39a-e58090967245'
const archivedClientId = '209cb508-16e2-4399-8dd0-bcadfd58818f'
const workoutId = '948d78c7-994c-4c21-b2fe-81efb2091854'
const plannedWorkoutId = '409f30e4-5b08-42d0-8209-95d62112467e'
const exerciseId = 'e2fc2c6d-0f33-4826-af68-46b0a5c79ff4'
const setId = '9fcce2c2-e182-433e-bb16-a481705c75fd'
const blockId = '8ffdb87b-078c-42d4-b6db-af8bc60f80f2'
const customExerciseId = 'c4add315-e5dd-421a-883a-bc2684a49986'
const progressId = '547aa497-7239-4e32-9b19-5dc9230351f6'
const metricId = '982c402f-3a6e-4c79-8e4d-aefbe4086bfc'
const goalId = 'a1013343-1267-49dc-8c4d-9ad99b709035'
const stageId = 'cf07db27-7d46-401f-9412-70c929fb55be'
const criterionId = '0bed7147-4e6c-49d2-bba9-d88f2579e9f0'
const invitationId = '8fc45130-9bcf-4b77-9ff7-f0872a354034'
const summaryId = '00b88f4f-e17a-47ae-9d2e-c68079217ac5'
const publishedSummaryId = 'e7335649-0713-44a7-9640-5453a3849dca'
const conversationId = '3a6cc527-7bbd-4217-8a76-77de34a2c0fe'
const publicProfileId = '0ee2e109-13e0-48ba-8664-7cc767128f0c'
const financePackageId = '34df7b20-a0b5-4627-bd98-d4a174625723'
const financePaymentId = 'ec3e661a-0ee8-48da-a269-d4f7707427cc'
const financeSessionId = '8938c8e0-3856-469b-b743-ab5942ce4564'

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-fit-request-id': 'repository-test-request-id',
    },
  })
}

describe('Yandex main repository', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    pilot.listTrainingData.mockReset()
    pilot.parseWorkout.mockReset()
    push.subscribe.mockReset()
    push.unsubscribe.mockReset()
  })

  it('deletes only the selected goal stage with its displayed version and no prerequisite reads', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((url, init) => {
      if (url === `${apiBaseUrl}/health`) return Promise.resolve(jsonResponse({ status: 'ok' }))
      if (url === `${apiBaseUrl}/v1/goal-stages/${stageId}` && init?.method === 'DELETE') return Promise.resolve(emptyResponse())
      throw new Error('Client overview and unrelated client progress are unavailable')
    })
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    await repository.goals.deleteStage({ id: stageId, version: 7 })
    const writes = fetchMock.mock.calls.filter(([url]) => url !== `${apiBaseUrl}/health`)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.[1]).toMatchObject({
      method: 'DELETE', body: JSON.stringify({ expectedVersion: 7 }),
      headers: { 'x-fit-session': sessionToken },
    })
  })

  it.each([
    [409, 'stage_conflict', 'PT409'],
    [403, 'forbidden', 'PT403'],
    [404, 'not_found', 'PT404'],
  ])('propagates stage deletion HTTP %i without refreshing or retrying the version', async (status, error, code) => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((url) => Promise.resolve(
      url === `${apiBaseUrl}/health` ? jsonResponse({ status: 'ok' }) : jsonResponse({ error }, status),
    ))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    await expect(repository.goals.deleteStage({ id: stageId, version: 7 })).rejects.toMatchObject({ code })
    const writes = fetchMock.mock.calls.filter(([url]) => url !== `${apiBaseUrl}/health`)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.[0]).toBe(`${apiBaseUrl}/v1/goal-stages/${stageId}`)
    expect(writes[0]?.[1]?.body).toBe(JSON.stringify({ expectedVersion: 7 }))
  })

  it('refreshes trainer names on later reads while sharing simultaneous connections requests', async () => {
    let displayName = 'Татьяна'
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(jsonResponse({
      memberships: [{ clientId, trainerId: actor.userId, firstName: null, lastName: null, displayName,
        joinedAt: '2026-10-07T10:00:00Z', isRoot: true }], invitations: [],
    })))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    const [trainers] = await Promise.all([repository.invitations.listTrainers(clientId), repository.invitations.list(clientId)])
    expect(trainers[0]?.displayName).toBe('Татьяна')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    displayName = 'Татьяна Александровна'
    expect((await repository.invitations.listTrainers(clientId))[0]?.displayName).toBe(displayName)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403))
    await expect(repository.invitations.listTrainers(clientId)).rejects.toThrow()
    expect((await repository.invitations.listTrainers(clientId))[0]?.displayName).toBe(displayName)
  })

  it('reads records of an old workout in one request without the first Progress page', async () => {
    const records = [{ exerciseRef: 'squat', exerciseName: 'Приседание', inputKind: 'strength',
      metric: 'weight_reps', primaryValue: 600, weightKg: 60, reps: 10 }]
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((url) => {
      if (url === `${apiBaseUrl}/v1/workouts/${workoutId}/personal-records`) return Promise.resolve(jsonResponse({ records }))
      throw new Error('Workout aggregates and paginated exercise history must not be requested')
    })
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    expect(await repository.workouts.personalRecords(workoutId)).toEqual(records)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'x-fit-session': sessionToken })
    expect(pilot.listTrainingData).not.toHaveBeenCalled()
  })

  it('keeps empty records and retries a failed read without cached emptiness or fallback', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403))
      .mockResolvedValueOnce(jsonResponse({ records: [] }))
      .mockResolvedValueOnce(jsonResponse({ records: [{ metric: 'invented' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    await expect(repository.workouts.personalRecords(workoutId)).rejects.toThrow()
    expect(await repository.workouts.personalRecords(workoutId)).toEqual([])
    await expect(repository.workouts.personalRecords(workoutId)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(pilot.listTrainingData).not.toHaveBeenCalled()
  })

  it('reads client stats once without loading workout aggregates', async () => {
    const stats = { doneCount: 123, completionPercent: 75, lastWorkoutDate: '2026-10-01', daysInWork: 300, needsAttention: false }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ stats }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    expect(await repository.workouts.clientStats(clientId, localDate('2026-10-06'))).toEqual(stats)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${apiBaseUrl}/v1/clients/${clientId}/workout-stats?today=2026-10-06`)
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'x-fit-session': sessionToken })
    expect(pilot.listTrainingData).not.toHaveBeenCalled()
  })

  it('keeps empty client stats and calendar dates without inventing totals', async () => {
    const stats = { doneCount: 0, completionPercent: null, lastWorkoutDate: null, daysInWork: null, needsAttention: false }
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ stats })))
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    expect(await repository.workouts.clientStats(clientId, localDate('2026-10-06'))).toEqual(stats)
  })

  it('rejects invalid stats and permits a fresh read after failure without history fallback', async () => {
    const stats = { doneCount: 1, completionPercent: 100, lastWorkoutDate: '2026-10-01', daysInWork: 5, needsAttention: false }
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ stats: { ...stats, lastWorkoutDate: '2026-02-30' } }))
      .mockResolvedValueOnce(jsonResponse({ error: 'not_found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ stats }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    await expect(repository.workouts.clientStats(clientId, localDate('2026-10-06'))).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(repository.workouts.clientStats(clientId, localDate('2026-10-06'))).rejects.toBeInstanceOf(Error)
    expect(await repository.workouts.clientStats(clientId, localDate('2026-10-06'))).toEqual(stats)
    expect(pilot.listTrainingData).not.toHaveBeenCalled()
  })

  it('preserves the additive overview deadline without per-client requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ overview: {
      month: '2026-10', receivedCents: 0, dueCents: 250000, attentionCount: 0,
      clients: [{ clientId, fullName: 'Анна', archivedAt: null, receivedCents: 0, dueCents: 250000,
        nearestPaymentDueOn: '2026-10-08', unpaidPackageCount: 2, activePackageCount: 1, upcomingPackageCount: 0,
        sessionsRemaining: 8, overdue: false, lowSessions: false, unassignedSessions: 0, needsAttention: false }],
    } }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    await expect(repository.trainerFinance.listOverview('2026-10')).resolves.toMatchObject({
      clients: [{ nearestPaymentDueOn: '2026-10-08', unpaidPackageCount: 2 }],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads and changes trainer finance only through the Yandex API', async () => {
    const financePackage = {
      id: financePackageId, clientId, trainerId: actor.userId, kind: 'session_pack', title: '10 тренировок',
      sessionsTotal: 10, sessionsUsed: 2, sessionsRemaining: 8,
      priceCents: 2500000, paidCents: 1000000, dueCents: 1500000,
      startsOn: '2026-09-01', endsOn: null, paymentDueOn: '2026-09-10', comment: null,
      packageStatus: 'active', paymentStatus: 'partial', closedAt: null, version: 1,
      createdAt: '2026-09-01T10:00:00.000000+00:00', updatedAt: '2026-09-01T10:00:00.000000+00:00',
    }
    const payment = {
      id: financePaymentId, packageId: financePackageId, amountCents: 1000000,
      receivedOn: '2026-09-01', source: 'manual', comment: null, voidedAt: null,
      voidReason: null, version: 1, createdAt: '2026-09-01T10:00:00.000000+00:00',
      updatedAt: '2026-09-01T10:00:00.000000+00:00',
    }
    const financeSession = {
      id: financeSessionId, packageId: financePackageId,
      workoutId: '77d5776a-337c-466e-a3e6-e098adb03cc7', disposition: 'charged',
      source: 'automatic', comment: null, workoutDate: '2026-09-05', voidedAt: null,
      voidReason: null, version: 1, createdAt: '2026-09-05T10:00:00.000000+00:00',
      updatedAt: '2026-09-05T10:00:00.000000+00:00',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ overview: { month: '2026-09', receivedCents: 1000000, dueCents: 1500000, attentionCount: 1, clients: [{ clientId, fullName: 'Анна', archivedAt: null, receivedCents: 1000000, dueCents: 1500000, activePackageCount: 1, upcomingPackageCount: 0, sessionsRemaining: 8, overdue: true, lowSessions: false, unassignedSessions: 0, needsAttention: true }] } }))
      .mockResolvedValueOnce(jsonResponse({ finance: { clientId, packages: [financePackage], payments: [payment], sessions: [financeSession] } }))
      .mockResolvedValueOnce(jsonResponse({ package: financePackage }, 201))
      .mockResolvedValueOnce(jsonResponse({ payment }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ session: { ...financeSession, disposition: 'free', packageId: null, version: 2 } }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(repository.trainerFinance.listOverview('2026-09')).resolves.toMatchObject({ receivedCents: 1000000, attentionCount: 1, clients: [{ nearestPaymentDueOn: null, unpaidPackageCount: 0 }] })
    await expect(repository.trainerFinance.listClient(clientId)).resolves.toMatchObject({ clientId, packages: [{ sessionsRemaining: 8 }] })
    await repository.trainerFinance.createPackage(clientId, {
      kind: 'session_pack', title: '10 тренировок', sessionsTotal: 10, openingUsedSessions: 2,
      priceCents: 2500000, openingPaidCents: 1000000, startsOn: '2026-09-01',
      endsOn: null, paymentDueOn: '2026-09-10', comment: null,
    })
    await repository.trainerFinance.addPayment(financePackageId, { amountCents: 1000000, receivedOn: '2026-09-01', comment: null })
    await repository.trainerFinance.voidPayment(financePaymentId, 1, 'Ошибка')
    await repository.trainerFinance.updateSession(financeSessionId, { expectedVersion: 1, disposition: 'free', packageId: null, comment: null, workoutDate: '2026-09-01' })

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `${apiBaseUrl}/v1/finance/overview?month=2026-09`,
      `${apiBaseUrl}/v1/clients/${clientId}/finance`,
      `${apiBaseUrl}/v1/clients/${clientId}/finance/packages`,
      `${apiBaseUrl}/v1/finance/packages/${financePackageId}/payments`,
      `${apiBaseUrl}/v1/finance/payments/${financePaymentId}`,
      `${apiBaseUrl}/v1/finance/sessions/${financeSessionId}`,
    ])
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({ method: 'DELETE', body: JSON.stringify({ expectedVersion: 1, reason: 'Ошибка' }) })
    expect(fetchMock.mock.calls[5]?.[1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ expectedVersion: 1, disposition: 'free', packageId: null, comment: null, workoutDate: '2026-09-01' }) })
  })

  it('reads client finance only from the self endpoint', async () => {
    const clientActor: SessionActor = {
      ...actor,
      kind: 'client', role: 'client', userId: '974f21af-f304-421f-81bd-050dbfabdd46',
      clientId, trainerId: actor.userId, fullName: 'Анна',
    }
    const response = { trainers: [{
      trainerId: actor.userId,
      trainerName: 'Ирина',
      packages: [{
        id: financePackageId, kind: 'session_pack', title: '10 тренировок', sessionsTotal: 10,
        sessionsUsed: 2, sessionsRemaining: 8, priceCents: 2500000,
        paidCents: 1000000, dueCents: 1500000, startsOn: '2026-09-01',
        endsOn: null, paymentDueOn: '2026-09-10', packageStatus: 'active',
        paymentStatus: 'partial',
      }],
      payments: [{ id: financePaymentId, packageId: financePackageId, amountCents: 1000000, receivedOn: '2026-09-01' }],
    }] }
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ finance: response }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, clientActor)

    await expect(repository.clientFinance.getMine()).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${apiBaseUrl}/v1/me/finance`)
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain(clientId)
  })

  it('uses the Yandex API for legal acceptance and account deletion lifecycle', async () => {
    const requestId = '8fc45130-9bcf-4b77-9ff7-f0872a354034'
    const acceptedAt = '2026-09-19T10:00:00.000000+00:00'
    const requestedAt = '2026-09-19T11:00:00.000000+00:00'
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        void input
        void init
        return Promise.resolve(new Response(null, { status: 500 }))
      },
    )
      .mockResolvedValueOnce(jsonResponse({ applicable: true, accepted: false, acceptedAt: null }))
      .mockResolvedValueOnce(jsonResponse({ acceptedAt }))
      .mockResolvedValueOnce(jsonResponse({
        supported: true,
        request: { id: requestId, status: 'requested', requestedAt },
      }))
      .mockResolvedValueOnce(jsonResponse({ requestId }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(repository.legal.getAcceptanceStatus()).resolves.toEqual({
      applicable: true,
      accepted: false,
      acceptedAt: null,
    })
    await expect(repository.legal.acceptCurrent('existing_user')).resolves.toBe(acceptedAt)
    await expect(repository.legal.getAccountDeletionStatus()).resolves.toEqual({
      supported: true,
      request: { id: requestId, status: 'requested', requestedAt },
    })
    await expect(repository.legal.requestAccountDeletion()).resolves.toBe(requestId)
    await expect(repository.legal.cancelAccountDeletionRequest()).resolves.toBeUndefined()

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `${apiBaseUrl}/v1/legal/acceptance`,
      `${apiBaseUrl}/v1/legal/acceptance`,
      `${apiBaseUrl}/v1/account-deletion-request`,
      `${apiBaseUrl}/v1/account-deletion-request`,
      `${apiBaseUrl}/v1/account-deletion-request`,
    ])
    const acceptanceRequest = fetchMock.mock.calls[1]?.[1]
    expect(acceptanceRequest?.method).toBe('PUT')
    expect(new Headers(acceptanceRequest?.headers).get('x-fit-session')).toBe(sessionToken)
    expect(acceptanceRequest?.body).toBe(JSON.stringify({
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      source: 'existing_user',
    }))
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({ method: 'POST' })
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({ method: 'DELETE' })
  })

  it('keeps correlation metadata when an API request fails', async () => {
    const requestId = '18940d82-9075-48d2-a847-8feee301b4d7'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'service_unavailable' }),
      {
        status: 503,
        headers: {
          'content-type': 'application/json',
          'x-fit-request-id': requestId,
          'x-fit-error-code': 'database_unavailable',
          'x-fit-release-id': 'release-42',
        },
      },
    )))
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    let caught: unknown
    try {
      await repository.legal.getAcceptanceStatus()
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({ code: 'service_unavailable' })
    const diagnostics = getRequestDiagnostics(caught)
    expect(diagnostics?.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(diagnostics).toEqual({
      requestId,
      occurredAt: diagnostics?.occurredAt,
      backend: 'yandex',
      operation: 'GET /v1/legal/acceptance',
      stage: 'api',
      status: 503,
      errorCode: 'service_unavailable',
      releaseId: 'release-42',
    })
  })

  it('reads and updates the trainer discovery prompt', async () => {
    const visible = { state: 'visible', remindAt: null, updatedAt: null }
    const snoozed = {
      state: 'snoozed',
      remindAt: '2026-10-12T09:00:00.000000+00:00',
      updatedAt: '2026-09-12T09:00:00.000000+00:00',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(visible))
      .mockResolvedValueOnce(jsonResponse(snoozed))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(repository.trainerDiscovery.getPromptPreference()).resolves.toEqual(visible)
    await expect(repository.trainerDiscovery.setPromptPreference('snooze')).resolves.toEqual(snoozed)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${apiBaseUrl}/v1/trainer-discovery/prompt`)
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ action: 'snooze' }),
    })
  })

  it('lists, saves, and removes favorite workouts', async () => {
    const wireExercise = {
      sourceExerciseId: null, position: 0, source: 'system', ref: 'squat', customExerciseId: null,
      name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', blockId: 'b1', blockType: 'single',
      blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90,
      trainerComment: null,
      sets: [{ sourceSetId: null, position: 0, weightKg: 60, reps: 5, durationMin: null, durationSec: null, distanceKm: null, rpe: null }],
    }
    const wireFavorite = {
      // Postgres jsonb_build_object serializes timestamptz with a numeric
      // offset ("+00:00"), never a literal "Z" — the schema must accept this
      // native shape, not just a hand-typed "Z" fixture.
      id: '12acc6d6-7ca8-43cd-b124-b4224c917fae', title: 'Ноги и кор',
      createdAt: '2026-09-19T09:00:00.000000+00:00', exercises: [wireExercise],
    }
    const domainExercise: WorkoutExerciseDraft = {
      position: 0, source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength',
      blockId: 'b1', blockType: 'single', blockPreset: 'set', blockRounds: 1,
      restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90,
      sets: [{ position: 0, weightKg: 60, reps: 5 }],
    }
    const domainFavorite = { id: wireFavorite.id, title: wireFavorite.title, createdAt: wireFavorite.createdAt, exercises: [domainExercise] }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ favorites: [wireFavorite] }))
      .mockResolvedValueOnce(jsonResponse(wireFavorite))
      .mockResolvedValueOnce(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(repository.favoriteWorkouts.list()).resolves.toEqual([domainFavorite])
    await expect(repository.favoriteWorkouts.save('Ноги и кор', [domainExercise])).resolves.toEqual(domainFavorite)
    await expect(repository.favoriteWorkouts.remove(wireFavorite.id)).resolves.toBeUndefined()

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${apiBaseUrl}/v1/favorite-workouts`)
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ title: 'Ноги и кор', exercises: [wireExercise] }),
    })
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`${apiBaseUrl}/v1/favorite-workouts/${wireFavorite.id}`)
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: 'DELETE' })
  })

  it('lists favorites carried over from Supabase, whose exercises omit unset optional keys entirely', async () => {
    // Supabase's toJson() serializes via JSON.stringify, which drops keys
    // whose value is undefined — unlike the Yandex write path, which always
    // sends an explicit null. A favorite saved on Supabase (directly, or
    // migrated into Yandex through the tenant snapshot) carries this shape.
    const wireFavorite = {
      id: '20d4ab64-df6a-4cf4-a46f-16359b1eb541', title: 'Доброе утро',
      createdAt: '2026-09-19T21:24:48.813954+03:00',
      exercises: [{
        ref: 'crunches', name: 'Скручивания', source: 'system',
        blockId: '9f82cfad-2119-48e4-895d-a6dce5095597', position: 1,
        blockType: 'single', inputKind: 'reps', blockPreset: 'set', blockRounds: 1,
        muscleGroup: 'core', restBetweenSetsSec: 90, restBetweenRoundsSec: 0, restBetweenExercisesSec: 0,
        sets: [{ rpe: 7, reps: 15, position: 0 }, { rpe: 7, reps: 15, position: 1 }],
      }],
    }
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ favorites: [wireFavorite] }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(repository.favoriteWorkouts.list()).resolves.toEqual([{
      id: wireFavorite.id, title: wireFavorite.title, createdAt: wireFavorite.createdAt,
      exercises: [{
        ref: 'crunches', name: 'Скручивания', source: 'system',
        blockId: '9f82cfad-2119-48e4-895d-a6dce5095597', position: 1,
        blockType: 'single', inputKind: 'reps', blockPreset: 'set', blockRounds: 1,
        muscleGroup: 'core', restBetweenSetsSec: 90, restBetweenRoundsSec: 0, restBetweenExercisesSec: 0,
        sets: [{ rpe: 7, reps: 15, position: 0 }, { rpe: 7, reps: 15, position: 1 }],
      }],
    }])
  })

  it('requests and validates a page of public trainers', async () => {
    const draft = {
      displayName: 'Анна', bio: '', specialties: [], city: '', metroStationIds: [], customLocations: [], trainingModes: [],
      experienceStartYear: null, education: '', formats: '', price: '', acceptingClients: true,
      avatarDataUrl: null, photos: [], certificates: [],
    }
    const profile = {
      publicId: publicProfileId, profile: draft,
      isBrandTrainer: false,
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [profile], totalCount: 21, nextOffset: 3 }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(repository.trainerProfiles.listCatalog({
      query: 'Анна', specialties: [], city: '', metroStationIds: ['msk-dinamo', 'msk-aeroport'], mode: 'online', acceptingClients: true, brandTrainerOnly: true,
    }, { offset: 0, limit: 3 })).resolves.toEqual({ items: [profile], totalCount: 21, nextOffset: 3 })
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(requested.pathname).toBe('/v1/trainers/catalog')
    expect(requested.searchParams.getAll('metro')).toEqual(['msk-dinamo', 'msk-aeroport'])
    expect(Object.fromEntries(requested.searchParams)).toEqual({ query: 'Анна', metro: 'msk-aeroport', mode: 'online', accepting: 'true', brand: 'true', offset: '0', limit: '3' })
  })

  it('also searches the pre-split legacy specialty so anketas that never re-selected still surface', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], totalCount: 0, nextOffset: null }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await repository.trainerProfiles.listCatalog({
      query: '', specialties: ['Адаптивная физическая культура (для людей с особенностями здоровья)'], city: '', metroStationIds: [], mode: '', acceptingClients: null, brandTrainerOnly: false,
    }, { offset: 0, limit: 3 })

    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(requested.searchParams.getAll('specialty')).toEqual([
      'Адаптивная физическая культура (для людей с особенностями здоровья)',
      'Реабилитация и адаптивная физкультура (после травм, ограничения по здоровью)',
    ])
  })

  it('writes trainer gallery changes through the Yandex API', async () => {
    const draft = {
      displayName: 'Анна', bio: '', specialties: [], city: '', metroStationIds: [], customLocations: [], trainingModes: [],
      experienceStartYear: null, education: '', formats: '', price: '', acceptingClients: true,
      avatarDataUrl: null, photos: [], certificates: [],
    }
    const response = {
      publicId: publicProfileId, draft, published: null, listedInCatalog: false,
      publishedAt: null, updatedAt: '2026-09-20T10:00:00.000Z', version: 1, isBrandTrainer: false,
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(response, 201))
      .mockResolvedValueOnce(jsonResponse(response))
      .mockResolvedValueOnce(jsonResponse(response))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    const photoId = '22222222-2222-4222-8222-222222222222'
    const part = {
      dataUrl: 'data:image/jpeg;base64,/9j/4A==', mimeType: 'image/jpeg' as const,
      width: 10, height: 10, sizeBytes: 4,
    }

    await repository.trainerProfiles.uploadPhoto(draft, { image: part, thumbnail: part }, true)
    await repository.trainerProfiles.reorderPhotos([photoId])
    await repository.trainerProfiles.deletePhoto(photoId)

    expect(fetchMock.mock.calls.map((call) => [new URL(String(call[0])).pathname, (call[1] as RequestInit).method]))
      .toEqual([
        ['/v1/trainer-profile/photos', 'POST'],
        ['/v1/trainer-profile/photos/order', 'PATCH'],
        [`/v1/trainer-profile/photos/${photoId}`, 'DELETE'],
      ])
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)))
      .toEqual({ draft, photo: { image: part, thumbnail: part }, replaceLegacy: true })
  })

  it('explains an oversized trainer photo instead of showing a generic failure', async () => {
    const draft = {
      displayName: 'Анна', bio: '', specialties: [], city: '', metroStationIds: [], customLocations: [], trainingModes: [],
      experienceStartYear: null, education: '', formats: '', price: '', acceptingClients: true,
      avatarDataUrl: null, photos: [], certificates: [],
    }
    const part = {
      dataUrl: 'data:image/jpeg;base64,/9j/4A==', mimeType: 'image/jpeg' as const,
      width: 10, height: 10, sizeBytes: 4,
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ error: 'request_too_large' }, 413),
    ))
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(repository.trainerProfiles.uploadPhoto(
      draft,
      { image: part, thumbnail: part },
    )).rejects.toMatchObject({
      code: 'trainer_photo_too_large',
      message: 'Фото слишком большое. Выберите другое фото.',
    })
  })

  it('creates a quick client without fabricating profile measurements', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      client: { id: '1a0c5295-0a0f-4ccb-a39a-e58090967245' },
    }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(repository.clients.createQuick('Новый клиент'))
      .resolves.toBe('1a0c5295-0a0f-4ccb-a39a-e58090967245')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${apiBaseUrl}/v1/clients`)
    expect(init.headers).toMatchObject({ 'x-fit-session': sessionToken })
    expect(JSON.parse(String(init.body))).toEqual({
      fullName: 'Новый клиент', gender: null, ageYears: null,
      ageUpdatedAt: null, heightCm: null, goal: null, note: null,
      initialWeightKg: null, initialWeightRecordedOn: null,
    })
  })

  it('uses the idempotent own-client endpoint for the first client action', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      client: { id: clientId, version: 2, membershipVersion: 1 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const clientActor: SessionActor = {
      ...actor,
      role: 'client',
    }
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, clientActor)

    await expect(repository.clients.createQuickOwn('Антон'))
      .resolves.toBe(clientId)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${apiBaseUrl}/v1/clients/me/quick`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ fullName: 'Антон' })
  })

  it('drops a stale client snapshot after a conflict and on realtime refresh', async () => {
    vi.useFakeTimers()
    let version = 1
    const clientPayload = () => ({ clients: [{
      id: clientId, canArchive: true, hasAccount: true, fullName: 'Клиент', canonicalFullName: 'Клиент',
      gender: 'female', ageYears: 30, ageUpdatedAt: '2026-08-01', heightCm: 170,
      goal: null, note: null, currentWeightKg: null, lastActivityAt: '2026-09-18T10:00:00.000Z',
      archivedAt: null, version, membershipVersion: 1,
    }] })
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url).pathname
      if (path === '/v1/clients' && (init?.method ?? 'GET') === 'GET') return Promise.resolve(jsonResponse(clientPayload()))
      if (path === `/v1/clients/${clientId}` && init?.method === 'PUT') {
        return Promise.resolve(jsonResponse({ error: 'client_conflict' }, 409))
      }
      return Promise.resolve(new Response(null, { status: 204 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    expect((await repository.clients.get(clientId)).version).toBe(1)
    version = 2
    await expect(repository.clients.update({
      id: clientId, version: 1, fullName: 'Клиент', gender: 'female', ageYears: 30,
      ageUpdatedAt: localDate('2026-08-01'), heightCm: 170,
    })).rejects.toMatchObject({ code: 'PT409' })
    expect((await repository.clients.get(clientId)).version).toBe(2)

    version = 3
    const unsubscribe = repository.realtime.subscribeToClientChanges(clientId, vi.fn())
    expect((await repository.clients.get(clientId)).version).toBe(3)
    unsubscribe()
  })

  it('batches and deduplicates private Vital media URL requests', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const { paths } = JSON.parse(String(init?.body)) as { paths: string[] }
      return Promise.resolve(jsonResponse({
        signedUrls: paths.map((path) => ({
          path,
          signedUrl: `https://storage.example/${path}?token=redacted`,
        })),
      }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(Promise.all([
      repository.exercises.createVitalMediaUrl('vital-pro/squat.jpg', 60 * 60),
      repository.exercises.createVitalMediaUrl('vital-pro/squat.mp4', 60 * 60),
      repository.exercises.createVitalMediaUrl('vital-pro/squat.mp4', 60 * 60),
    ])).resolves.toEqual([
      'https://storage.example/vital-pro/squat.jpg?token=redacted',
      'https://storage.example/vital-pro/squat.mp4?token=redacted',
      'https://storage.example/vital-pro/squat.mp4?token=redacted',
    ])

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${apiBaseUrl}/v1/exercise-media/sign-batch`)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'x-fit-session': sessionToken })
    expect(init.body).toBe(JSON.stringify({ paths: [
      'vital-pro/squat.jpg',
      'vital-pro/squat.mp4',
    ] }))
  })

  it('chunks a large private Vital media request burst into bounded batches', async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const { paths } = JSON.parse(String(init?.body)) as { paths: string[] }
      return Promise.resolve(jsonResponse({
        signedUrls: paths.map((path) => ({ path, signedUrl: `https://storage.example/${path}` })),
      }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    const paths = Array.from({ length: 33 }, (_, index) => `vital-pro/exercise-${index}.jpg`)

    await expect(Promise.all(paths.map((path) => (
      repository.exercises.createVitalMediaUrl(path, 60 * 60)
    )))).resolves.toHaveLength(33)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { paths: string[] }
    const second = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { paths: string[] }
    expect(first.paths).toHaveLength(32)
    expect(second.paths).toHaveLength(1)
  })

  it('rejects a custom exercise photo url request instead of hitting the network (YAFIT-521 gap, see FEATURE_PARITY.md)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(repository.exercises.createCustomExercisePhotoUrl('trainer-1/exercise-1.jpg', 60 * 60)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts the resource-specific version returned by a Live mutation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      set: { id: '9fcce2c2-e182-433e-bb16-a481705c75fd', replayed: false, version: 4 },
    }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    const workout = { id: '948d78c7-994c-4c21-b2fe-81efb2091854', version: 3 } as Workout

    await expect(repository.workouts.appendLiveSet(
      workout, 'e2fc2c6d-0f33-4826-af68-46b0a5c79ff4',
    )).resolves.toBe(4)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/v1/workout-exercises/e2fc2c6d-0f33-4826-af68-46b0a5c79ff4/sets')
    expect(JSON.parse(String(init.body))).toMatchObject({ expectedVersion: 3 })
  })

  it('does not fall back to Supabase after a Yandex API failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'service_unavailable' }, 503))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(repository.clients.createQuick('Новый клиент')).rejects.toMatchObject({
      code: 'service_unavailable',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([
    [429, 'summary_generation_period_limit', false],
    [502, 'yandex_cloud_quality_check_failed', true],
    [504, 'yandex_cloud_timeout', true],
  ])('preserves training summary error %s from the Yandex API', async (status, code, immediateRetryAllowed) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: code }, status)))
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(repository.trainingSummaries.generate(
      clientId, '2026-08-01', '2026-08-31', true,
    )).rejects.toMatchObject({
      name: 'TrainingSummaryGenerationError',
      code,
      immediateRetryAllowed,
    })
  })

  it.each([
    [401, 'session_expired'],
    [403, 'PT403'],
    [404, 'PT404'],
    [409, 'PT409'],
    [422, 'PT422'],
    [500, 'service_unavailable'],
    [400, 'invalid_request'],
  ])('maps HTTP %s to a stable repository error', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, status)))
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    await expect(repository.clients.createQuick('Новый клиент')).rejects.toMatchObject({ code })
  })

  it('maps an active-workout conflict and a network failure without a fallback', async () => {
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'active_workout_exists' }, 409)))
    await expect(repository.clients.createQuick('Новый клиент')).rejects.toMatchObject({
      code: 'active_workout_exists',
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(repository.clients.createQuick('Новый клиент')).rejects.toMatchObject({
      code: 'network_unavailable',
    })
  })

  it('retries a failed client list instead of reusing the rejected request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ clients: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(repository.clients.list()).rejects.toBeTruthy()
    await expect(repository.clients.list()).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries failed training data without keeping a rejected workout list', async () => {
    pilot.listTrainingData
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        customExercises: [], workouts: [], attention: [], attentionPreferences: [],
        hasMoreWorkouts: false, totalWorkouts: 0,
      })
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(repository.workouts.list()).rejects.toThrow('offline')
    await expect(repository.workouts.list()).resolves.toEqual([])
    expect(pilot.listTrainingData).toHaveBeenCalledTimes(2)
  })

  it('implements the complete clients, exercise, progress and goal contracts', async () => {
    const fetchMock = installContractFetch()
    vi.stubGlobal('fetch', fetchMock)
    installTrainingData()
    pilot.parseWorkout.mockResolvedValue({ items: [], unmatched: [] })
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    expect(await repository.clients.getMine()).toBeNull()
    expect(await repository.clients.resolveId(clientId)).toBe(clientId)
    await expect(repository.clients.resolveId('555b5163-cd40-4c96-b0d1-ce1a250d25df')).rejects.toThrow('не найдена')
    expect(await repository.clients.list()).toHaveLength(1)
    expect(await repository.clients.list(true)).toHaveLength(2)
    expect((await repository.clients.listAttentionPreferences(actor.userId))[0]).toMatchObject({ clientId })
    expect((await repository.clients.get(clientId)).fullName).toBe('Клиент')
    await expect(repository.clients.get('555b5163-cd40-4c96-b0d1-ce1a250d25df')).rejects.toThrow('не найдена')
    await repository.clients.create(clientDraft())
    await repository.clients.createQuick('Быстрый клиент')
    await repository.clients.createQuickOwn('Свой клиент')
    await repository.clients.createOwn(clientDraft())
    await repository.clients.update(clientUpdate())
    await repository.clients.updateOwn(clientUpdate())
    await repository.clients.updatePreferences({ clientId, alias: 'Псевдоним', note: undefined, version: 1 })
    expect((await repository.clients.setArchived((await repository.clients.get(clientId)), true)).archivedAt).not.toBeNull()
    expect((await repository.clients.setArchived((await repository.clients.get(clientId)), false)).archivedAt).toBeNull()

    expect(repository.exercises.system.length).toBeGreaterThan(0)
    await expect(repository.exercises.parseWorkout('присед 10', repository.exercises.system)).resolves.toEqual({ items: [], unmatched: [] })
    await expect(repository.exercises.suggestGoalCriteria('снизить вес', [], [])).resolves.toEqual({
      criteria: [], needsInput: [], unsupportedReason: null,
    })
    const custom = (await repository.exercises.list())[0]!
    expect(custom).toMatchObject({
      createdBy: actor.userId,
      primaryMuscleDetail: 'Широчайшие',
      equipment: 'Сани',
      description: 'Сохраняйте нейтральное положение спины.',
    })
    const created = await repository.exercises.create(actor.userId, actor.userId, customExerciseDraft())
    expect(created).toMatchObject(customExerciseDraft())
    const updated = await repository.exercises.update(created, customExerciseDraft())
    expect(updated).toMatchObject(customExerciseDraft())
    await repository.exercises.setArchived(updated, true)

    expect(await repository.progress.regularity(clientId)).toHaveLength(1)
    expect(await repository.progress.running(clientId, '2026-08-01', '2026-08-31')).toHaveLength(1)
    const entries = await repository.progress.list(clientId)
    expect(entries[0]?.recordedOn).toBe('2026-08-01')
    await repository.progress.save(progressDraft())
    await repository.progress.save({ ...progressDraft(), id: progressId, version: 1 })
    await repository.progress.remove(entries[0]!)
    expect(await repository.progress.listMetrics(clientId)).toHaveLength(1)
    const metric = await repository.progress.createMetric(clientId, 'Пульс', 'уд/мин')
    await repository.progress.setMetricArchived(metric, true)

    const goal = await repository.goals.get(clientId)
    expect(goal?.stages[0]?.id).toBe(stageId)
    await repository.goals.save(goalDraft())
    await repository.goals.save({ ...goalDraft(), id: goalId, version: 1, criteria: null, criterion: null })
    await repository.goals.archive(goalId, 1)
    await repository.goals.saveStage(stageDraft())
    await repository.goals.saveStage({ ...stageDraft(), id: stageId, version: 1 })
    await repository.goals.deleteStage({ id: stageId, version: 1 })

    expect(fetchMock).toHaveBeenCalled()
  })

  it('implements the complete workout lifecycle and derived reads', async () => {
    const fetchMock = installContractFetch()
    vi.stubGlobal('fetch', fetchMock)
    installTrainingData()
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    const item = await repository.workouts.get(workoutId)
    expect(item.activeCaloriesKcal).toBe(315)
    expect(item.stageId).toBe(stageId)
    await expect(repository.workouts.get('555b5163-cd40-4c96-b0d1-ce1a250d25df')).rejects.toMatchObject({ code: 'PT404' })
    expect((await repository.workouts.listPage(undefined, undefined, clientId, 0, 1)).nextOffset).toBe(1)
    expect(await repository.workouts.list('2026-08-01', '2026-08-31', clientId)).toHaveLength(2)
    expect(await repository.workouts.listSummaries(clientId)).toHaveLength(2)
    expect((await repository.workouts.findActive(clientId))?.id).toBe(plannedWorkoutId)
    expect(await repository.workouts.personalRecords(workoutId)).toHaveLength(2)
    expect((await repository.workouts.latestExerciseResults(clientId, ['push-up'])).get('push-up')?.sets).toHaveLength(1)
    expect((await repository.workouts.exerciseProgressPage(clientId, 'push-up', {
      completedAt: '2026-08-20T10:00:00.000000+00:00', workoutId,
    })).totalCount).toBe(1)

    const draft = { ...workoutDraft(), trainingFormat: 'with_trainer' as const }
    await repository.workouts.save(draft)
    await repository.workouts.save({ ...draft, id: workoutId, version: 1 })
    await repository.workouts.saveCompleted({ ...draft, actualDurationSec: 3000 })
    const completedCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/v1/workouts/completed') && init?.method === 'POST')
    expect(JSON.parse(String(completedCall?.[1]?.body))).toMatchObject({ actualDurationSec: 3000 })
    await repository.workouts.saveCompleted({ ...draft, id: workoutId, version: 1 })
    await repository.workouts.recordPlannedResult({ ...draft, id: workoutId, version: 1 })
    const createCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/v1/workouts') && init?.method === 'POST')
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({ trainingFormat: 'with_trainer' })
    await expect(repository.workouts.recordPlannedResult(draft)).rejects.toThrow('не выбрана')
    await repository.workouts.start(item)
    await repository.workouts.cancelPlanned(item)
    await repository.workouts.reschedule(item, localDate('2026-08-22'), '12:00')
    await repository.workouts.saveLiveSet(setId, { weightKg: 42, reps: 10 }, item.version)
    await repository.workouts.confirmLiveSet(setId, item.version)
    await repository.workouts.appendLiveExercise(item, exerciseSnapshot())
    await repository.workouts.appendLiveSet(item, exerciseId)
    expect(repository.workouts.supportsAtomicLiveRounds).toBe(true)
    expect(repository.workouts.supportsLiveSupersetSplit).toBe(true)
    const roundOperationId = 'c94ec52e-dc52-4c84-a61e-e45f11cb6f40'
    const removeRoundOperationId = 'c94ec52e-dc52-4c84-a61e-e45f11cb6f41'
    await repository.workouts.appendLiveRound(item, blockId, roundOperationId)
    await repository.workouts.removeLastLiveRound(item, blockId, 1, removeRoundOperationId)
    const roundCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes(`/blocks/${blockId}/rounds`))
    expect(roundCalls.map(([, init]) => init?.method)).toEqual(['POST', 'DELETE'])
    expect(roundCalls.map(([, init]) => (JSON.parse(String(init?.body)) as { operationId: string }).operationId)).toEqual([roundOperationId, removeRoundOperationId])
    expect(String(roundCalls[1]?.[0])).toContain(`/rounds/1`)
    await repository.workouts.splitLiveSuperset(item, blockId, 'c94ec52e-dc52-4c84-a61e-e45f11cb6f42')
    const splitCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith(`/blocks/${blockId}/split`))
    expect(splitCall?.[1]?.method).toBe('POST')
    expect((JSON.parse(String(splitCall?.[1]?.body)) as { operationId: string }).operationId).toBe('c94ec52e-dc52-4c84-a61e-e45f11cb6f42')
    await repository.workouts.removeLiveSet(item, setId)
    await repository.workouts.removeLiveExercise(item, exerciseId)
    await repository.workouts.reorderLiveBlock(item, blockId, -1)
    await repository.workouts.mergeLiveBlockWithNext(item, blockId, 'circuit')
    const mergeCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith(`/v1/workouts/${workoutId}/blocks/${blockId}/merge-next`))
    expect(mergeCall?.[1]?.method).toBe('POST')
    expect(JSON.parse(String(mergeCall?.[1]?.body))).toMatchObject({ expectedVersion: item.version, preset: 'circuit' })
    await repository.workouts.setExerciseComment(item, exerciseId, 'Комментарий')
    await repository.workouts.setWorkoutReview(item, { reaction: 'fire', review: 'Отлично' })
    await repository.workouts.setClientWorkoutComment(item, 'Сложно')
    await repository.workouts.submitFeedback(item, { sessionRpe: 8, wellbeing: 'normal', discomfort: false, comment: 'Хорошо' })
    await repository.workouts.setActualDuration(item, 3000)
    expect(fetchMock).toHaveBeenCalledWith(`${apiBaseUrl}/v1/workouts/${item.id}/duration`, expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ actualDurationSec: 3000, expectedVersion: item.version }),
    }))
    await repository.workouts.askQuestion(item, 'Что дальше?')
    await repository.workouts.answerQuestion(item, { reaction: undefined, review: 'Продолжаем' })
    await repository.workouts.resolveQuestion(item)
    expect(await repository.workouts.listTrainerAttention()).toHaveLength(1)
    await repository.workouts.snoozeClientAttention(clientId)
    await repository.workouts.replaceLiveExercise(item, exerciseId, exerciseSnapshot())
    await repository.workouts.finish(item)
    await repository.workouts.remove(item)
  })

  it('sends the prep countdown only when the form owns it', async () => {
    const fetchMock = installContractFetch()
    vi.stubGlobal('fetch', fetchMock)
    installTrainingData()
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    expect((await repository.workouts.get(workoutId)).prepSeconds).toBeNull()
    await repository.workouts.save({ ...workoutDraft(), prepSeconds: 20 })
    await repository.workouts.save({ ...workoutDraft(), id: workoutId, version: 1 })
    const bodies = fetchMock.mock.calls
      .filter(([url, init]) => /\/v1\/workouts(\/[0-9a-f-]{36})?$/.test(String(url)) && (init?.method === 'POST' || init?.method === 'PUT'))
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
    expect(bodies[0]).toMatchObject({ prepSeconds: 20 })
    // Старый клиент без поля не сбрасывает сохранённую подготовку.
    expect(bodies[1]).not.toHaveProperty('prepSeconds')
  })

  it('preserves empty optional values across sparse workout and progress contracts', async () => {
    const sparseWorkout = {
      ...workoutPayload(workoutId, 'done', '2026-08-20'),
      stageId: undefined,
      stageTitle: undefined,
      hasPr: undefined,
      exercises: [{
        ...workoutPayload(workoutId, 'done', '2026-08-20').exercises[0]!,
        sets: [{
          ...workoutPayload(workoutId, 'done', '2026-08-20').exercises[0]!.sets[0]!,
          plan: {
            weightKg: null, reps: null, durationMin: null,
            durationSec: null, distanceKm: null, rpe: null,
          },
          fact: {
            weightKg: null, reps: null, durationMin: null,
            durationSec: null, distanceKm: null, rpe: null,
          },
        }],
      }],
    }
    pilot.listTrainingData.mockResolvedValue({
      customExercises: [{
        id: customExerciseId, name: 'Без автора', muscleGroup: 'other', inputKind: 'reps',
        archivedAt: null, version: 1,
      }],
      workouts: [sparseWorkout], attention: [], attentionPreferences: [],
      hasMoreWorkouts: false, totalWorkouts: 1,
    })
    const contractFetch = installContractFetch()
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
      if (url.pathname.endsWith('/progress') && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse({
          entries: [{
            id: progressId, clientId, createdBy: null, recordedOn: '2026-08-01',
            weightKg: null, chestCm: null, waistCm: null, hipCm: null, notes: null,
            customMetrics: [], version: 1,
          }],
          customMetrics: [], goal: null,
        })
      }
      return contractFetch(input, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    expect((await repository.exercises.list())[0]?.createdBy).toBe('')
    const mapped = await repository.workouts.get(workoutId)
    expect(mapped).toMatchObject({ stageId: null, stageTitle: null, hasPr: false })
    expect(mapped.exercises[0]?.sets[0]).toMatchObject({
      weightKg: undefined,
      reps: undefined,
      rpe: undefined,
      fact: { weightKg: undefined, reps: undefined, rpe: undefined },
    })

    const sparseDraft: WorkoutDraft = {
      clientId,
      workoutDate: localDate('2026-08-22'),
      exercises: [{
        position: 0, source: 'system', ref: 'push-up', name: 'Отжимания',
        muscleGroup: 'chest', inputKind: 'strength', sets: [{ position: 0 }],
      }],
    }
    await repository.workouts.save(sparseDraft)
    await repository.workouts.saveLiveSet(setId, {}, mapped.version)
    await repository.progress.save({
      clientId, recordedOn: localDate('2026-08-22'), customMetrics: [],
    })
    expect(await repository.progress.list(clientId)).toEqual([expect.objectContaining({
      weightKg: undefined, notes: undefined,
    })])
    expect(await repository.goals.get(clientId)).toBeNull()
  })

  it('collects all scoped pages only when the caller explicitly requests a full list', async () => {
    pilot.listTrainingData
      .mockResolvedValueOnce({
        customExercises: [], workouts: [workoutPayload(workoutId, 'done', '2026-08-20')],
        attention: [], attentionPreferences: [], hasMoreWorkouts: true, totalWorkouts: 2,
      })
      .mockResolvedValueOnce({
        customExercises: [], workouts: [workoutPayload(plannedWorkoutId, 'in_progress', '2026-08-21')],
        attention: [], attentionPreferences: [], hasMoreWorkouts: false, totalWorkouts: 2,
      })
    vi.stubGlobal('fetch', installContractFetch())
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(repository.workouts.list()).resolves.toHaveLength(2)
    expect(pilot.listTrainingData).toHaveBeenNthCalledWith(
      2, apiBaseUrl, sessionToken, 'read_write', { limit: 100, offset: 1, scope: 'workouts' },
    )
  })

  it('loads exactly the requested history page without fetching earlier or later pages', async () => {
    pilot.listTrainingData.mockResolvedValue({
      customExercises: [], workouts: [workoutPayload(workoutId, 'done', '2026-08-20')],
      attention: [], attentionPreferences: [], hasMoreWorkouts: true, totalWorkouts: 241,
    })
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(repository.workouts.listPage('2026-01-01', '2026-08-31', clientId, 120, 20))
      .resolves.toMatchObject({ items: [{ id: workoutId }], nextOffset: 121, totalCount: 241 })
    expect(pilot.listTrainingData).toHaveBeenCalledExactlyOnceWith(
      apiBaseUrl, sessionToken, 'read_write', {
        limit: 20, offset: 120, scope: 'workouts', clientId, from: '2026-01-01', to: '2026-08-31',
      },
    )
  })

  it('reads an old workout directly by ID and preserves the not-found error', async () => {
    installTrainingData()
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    await expect(repository.workouts.get(workoutId)).resolves.toMatchObject({ id: workoutId })
    expect(pilot.listTrainingData).toHaveBeenCalledExactlyOnceWith(
      apiBaseUrl, sessionToken, 'read_write', { limit: 1, offset: 0, workoutId, scope: 'workouts' },
    )
    await expect(repository.workouts.get('555b5163-cd40-4c96-b0d1-ce1a250d25df'))
      .rejects.toMatchObject({ code: 'PT404' })
  })

  it('shares metadata without loading workouts for catalogs and attention', async () => {
    installTrainingData()
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    await repository.exercises.list()
    await repository.workouts.listTrainerAttention()
    await repository.clients.listAttentionPreferences(actor.userId)
    expect(pilot.listTrainingData).toHaveBeenCalledExactlyOnceWith(
      apiBaseUrl, sessionToken, 'read_write', { limit: 1, offset: 0, scope: 'metadata' },
    )
  })

  it('does not cache a failed page or hide its failure as empty history', async () => {
    pilot.listTrainingData.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      customExercises: [], workouts: [], attention: [], attentionPreferences: [],
      hasMoreWorkouts: false, totalWorkouts: 0,
    })
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    await expect(repository.workouts.listPage(undefined, undefined, clientId)).rejects.toThrow('offline')
    await expect(repository.workouts.listPage(undefined, undefined, clientId)).resolves.toEqual({
      items: [], totalCount: 0,
    })
    expect(pilot.listTrainingData).toHaveBeenCalledTimes(2)
  })

  it('rejects a page without the required total instead of inventing an exact count', async () => {
    pilot.listTrainingData.mockResolvedValue({
      customExercises: [], workouts: [], attention: [], attentionPreferences: [], hasMoreWorkouts: false,
    })
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    await expect(repository.workouts.listPage()).rejects.toThrow('неподдерживаемый формат тренировок')
  })

  it('implements invitations, summaries, feedback, push and polling', async () => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'public-key')
    const fetchMock = installContractFetch()
    vi.stubGlobal('fetch', fetchMock)
    installTrainingData()
    push.subscribe.mockResolvedValue({ endpoint: 'https://push.example.test', p256dh: 'p', authKey: 'a' })
    push.unsubscribe.mockResolvedValue({ endpoint: 'https://push.example/pilot-device' })
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    expect(await repository.invitations.create(clientId, 'trainer')).toBe('ABCDEF123456')
    expect(await repository.invitations.claim(' abcdef123456 ')).toBe(clientId)
    expect(await repository.invitations.reconnect('abcdef123456')).toBe(clientId)
    expect(await repository.invitations.list(clientId)).toHaveLength(1)
    expect(await repository.invitations.listTrainers(clientId)).toHaveLength(1)
    await repository.invitations.revoke(invitationId)
    await repository.invitations.disconnectTrainer(clientId)
    await repository.invitations.removeTrainer(clientId, actor.userId)
    await repository.invitations.leave(clientId)

    expect(await repository.trainingSummaries.firstCompletedWorkoutDate(clientId)).toBe('2026-08-20')
    expect(await repository.trainingSummaries.listForTrainer(clientId)).toHaveLength(1)
    summaryMode = 'published'
    expect(await repository.trainingSummaries.listForClient(clientId)).toHaveLength(1)
    const generated = await repository.trainingSummaries.generate(clientId, '2026-08-01', '2026-08-31', true)
    expect(generated.cached).toBe(false)
    summaryMode = 'internal'
    const summary = (await repository.trainingSummaries.listForTrainer(clientId))[0]!
    await repository.trainingSummaries.publish(summary, clientSummary)
    await repository.trainingSummaries.unpublish(summary)

    expect(await repository.appFeedback.submit('problem', '  Сообщение  ')).toBe(progressId)
    vi.stubGlobal('Notification', { permission: 'granted' })
    expect(await repository.pushNotifications.status(actor.userId)).toEqual({ state: 'working', workoutReminderEnabled: true, workoutScheduledEnabled: false, chatMessageEnabled: true })
    await repository.pushNotifications.enable(actor.userId)
    await repository.pushNotifications.disable(actor.userId)
    const pushRequests = fetchMock.mock.calls.filter(([input]) =>
      new URL(String(input)).pathname.startsWith('/v1/push-notifications/'))
    expect(pushRequests).toEqual(expect.arrayContaining([
      [
        `${apiBaseUrl}/v1/push-notifications/subscription/status`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ endpoint: 'https://push.example/pilot-device' }),
        }),
      ],
      [
        `${apiBaseUrl}/v1/push-notifications/subscription`,
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ endpoint: 'https://push.example/pilot-device' }),
        }),
      ],
    ]))

    const onChange = vi.fn()
    const onReady = vi.fn()
    const unsubscribe = repository.realtime.subscribeToClientChanges(clientId, onChange, onReady)
    expect(onReady).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(onChange).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('uses the Yandex API for public trainer chat and its connection invitation', async () => {
    vi.stubGlobal('fetch', installContractFetch())
    installTrainingData()
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)

    await expect(repository.chat.openPublicTrainer(publicProfileId)).resolves.toBe(conversationId)
    await expect(repository.chat.connectionState(conversationId)).resolves.toMatchObject({ canInvite: true })
    await expect(repository.chat.inviteToConnect(conversationId)).resolves.toMatchObject({ invitationPending: true })
    await expect(repository.chat.acceptConnection(conversationId)).resolves.toMatchObject({ activeConnection: true })
  })
})

let summaryMode: 'internal' | 'published' = 'internal'

function installTrainingData() {
  const data = {
    customExercises: [{
      id: customExerciseId, name: 'Тяга', muscleGroup: 'back', inputKind: 'strength',
      primaryMuscleDetail: 'Широчайшие', equipment: 'Сани',
      description: 'Сохраняйте нейтральное положение спины.',
      archivedAt: null, version: 1, createdBy: actor.userId,
    }],
    workouts: [workoutPayload(plannedWorkoutId, 'in_progress', '2026-08-21'), workoutPayload(workoutId, 'done', '2026-08-20')],
    attention: [{
      workoutId, clientId, clientName: 'Клиент', workoutDate: '2026-08-20',
      clientQuestion: 'Что дальше?', clientQuestionAskedAt: '2026-08-20T10:00:00.000000+00:00',
      discomfort: false, clientComment: 'Хорошо', feedbackSubmittedAt: '2026-08-20T10:00:00.000000+00:00', version: 1,
    }],
    attentionPreferences: [{ clientId, snoozedUntil: null }],
    hasMoreWorkouts: false,
    totalWorkouts: 2,
  }
  pilot.listTrainingData.mockImplementation((
    _apiBaseUrl: string, _sessionToken: string, _accessMode: unknown, page?: YandexTrainingDataPage,
  ) => {
    const filtered = data.workouts.filter((item) =>
      (page?.clientId === undefined || item.clientId === page.clientId)
      && (page?.workoutId === undefined || item.id === page.workoutId)
      && (page?.from === undefined || item.workoutDate >= page.from)
      && (page?.to === undefined || item.workoutDate <= page.to))
    const offset = page?.offset ?? 0
    const limit = page?.limit ?? 100
    return Promise.resolve({
      ...data,
      ...(page?.scope === 'workouts' ? { customExercises: [], attention: [], attentionPreferences: [] } : {}),
      workouts: page?.scope === 'metadata' ? [] : filtered.slice(offset, offset + limit),
      hasMoreWorkouts: page?.scope !== 'metadata' && offset + limit < filtered.length,
      totalWorkouts: page?.scope === 'metadata' ? 0 : filtered.length,
    })
  })
}

function workoutPayload(id: string, status: 'done' | 'in_progress', date: string) {
  return {
    id, trainerId: actor.userId, clientId, clientName: 'Клиент', createdBy: actor.userId,
    workoutDate: date, startTime: '10:00:00', endTime: '11:00:00', status,
    notes: null, clientComment: null, sessionRpe: null, wellbeing: null, discomfort: null,
    feedbackSubmittedAt: null, trainerReaction: null, trainerReview: null,
    trainerReviewAuthorId: null, trainerReviewedAt: null, clientQuestion: null,
    clientQuestionAskedAt: null, clientQuestionResolvedAt: null,
    startedAt: '2026-08-20T09:00:00.000Z', completedAt: status === 'done' ? '2026-08-20T10:00:00.000000+00:00' : null,
    activeCaloriesKcal: status === 'done' ? 315 : null,
    stageId, stageTitle: 'Этап', hasPr: status === 'done', version: 1,
    exercises: [{
      id: exerciseId, position: 0, source: 'system' as const, ref: 'push-up', customExerciseId: null,
      name: 'Отжимания', muscleGroup: 'chest' as const, inputKind: 'strength' as const,
      blockId, blockType: 'single' as const, blockPreset: 'set' as const, blockRounds: 1,
      restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 60,
      trainerComment: null,
      sets: [{
        id: setId, position: 0,
        plan: { weightKg: 20, reps: 10, durationMin: null, durationSec: null, distanceKm: null, rpe: 7 },
        fact: { weightKg: 22, reps: 10, durationMin: null, durationSec: null, distanceKm: null, rpe: 8 },
        confirmedAt: status === 'done' ? '2026-08-20T10:00:00.000000+00:00' : null, version: 1,
      }],
    }],
  }
}

function clientDraft() {
  return {
    fullName: 'Клиент', gender: 'male' as const, ageYears: 30,
    ageUpdatedAt: localDate('2026-08-01'), heightCm: 180,
    goal: 'Сила', note: 'Заметка', initialWeightKg: 80,
    initialWeightRecordedOn: localDate('2026-08-01'),
  }
}

function clientUpdate() {
  return { id: clientId, ...clientDraft(), version: 1 }
}

function customExerciseDraft() {
  return {
    name: 'Тяга',
    muscleGroup: 'back' as const,
    inputKind: 'strength' as const,
    primaryMuscleDetail: 'Широчайшие',
    equipment: 'Сани',
    description: 'Сохраняйте нейтральное положение спины.',
  }
}

function progressDraft() {
  return {
    clientId, recordedOn: localDate('2026-08-01'), weightKg: 80,
    notes: 'Старт', customMetrics: [{ metricId, value: 60.123 }],
  }
}

function goalDraft() {
  return {
    clientId, title: 'Снизить вес', targetDate: localDate('2026-12-01'),
    criteria: [{
      metric: 'weight' as const, operation: 'decrease_to' as const,
      targetValue: 75, unit: 'кг', confirmationStatus: 'confirmed' as const,
    }],
  }
}

function stageDraft() {
  return {
    goalId, title: 'Первый этап', startsOn: localDate('2026-08-01'),
    endsOn: localDate('2026-08-31'), position: 0,
  }
}

function exerciseSnapshot() {
  return { source: 'system' as const, ref: 'push-up', name: 'Отжимания', muscleGroup: 'chest' as const, inputKind: 'strength' as const }
}

function workoutDraft(): WorkoutDraft {
  return {
    requestId: '3d959430-cecf-4c21-9636-2f5727acfd24', clientId,
    workoutDate: localDate('2026-08-22'), startTime: '10:00', endTime: '11:00',
    notes: 'План', stageId, exercises: [{
      ...exerciseSnapshot(), position: 0, blockId, blockType: 'single', blockPreset: 'set',
      blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 0,
      restBetweenSetsSec: 60, trainerComment: 'Техника',
      sets: [{ position: 0, weightKg: 20, reps: 10, rpe: 7 }],
    }],
  }
}

const clientSummary: ClientTrainingSummary = {
  headline: 'Итог', achievements: ['Готово'], consistency: 'Стабильно',
  encouragement: 'Продолжайте', goalAlignment: 'По плану', nextSteps: ['Дальше'],
}

function installContractFetch() {
  summaryMode = 'internal'
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
    const method = init?.method ?? 'GET'
    const path = url.pathname
    if (method === 'GET' && path.endsWith('/personal-records')) return jsonResponse({ records: [
      { exerciseRef: 'push-up', exerciseName: 'Отжимания', inputKind: 'strength', metric: 'weight', primaryValue: 22, weightKg: 22, reps: 10 },
      { exerciseRef: 'push-up', exerciseName: 'Отжимания', inputKind: 'strength', metric: 'weight_reps', primaryValue: 220, weightKg: 22, reps: 10 },
    ] })
    if (method === 'GET' && path === '/v1/clients') return jsonResponse({ clients: url.searchParams.get('archived') === 'true' ? [
      { id: archivedClientId, canArchive: true, hasAccount: false, fullName: 'Архив', canonicalFullName: 'Архив', gender: null, ageYears: null, ageUpdatedAt: null, heightCm: null, goal: null, note: null, currentWeightKg: null, lastActivityAt: '2026-08-01T00:00:00.000000+00:00', archivedAt: '2026-08-01T00:00:00.000000+00:00', version: 1, membershipVersion: 1 },
    ] : [
      { id: clientId, canArchive: true, hasAccount: true, fullName: 'Клиент', canonicalFullName: 'Клиент', gender: 'male', ageYears: 30, ageUpdatedAt: '2026-08-01', heightCm: 180, goal: 'Сила', note: null, currentWeightKg: 80, lastActivityAt: '2026-08-20T10:00:00.000000+00:00', archivedAt: null, version: 1, membershipVersion: 1 },
    ] })
    if (method === 'GET' && path === '/v1/connections') return jsonResponse({
      memberships: [{ clientId, trainerId: actor.userId, firstName: 'Ирина', lastName: null, joinedAt: '2026-08-01T00:00:00.000000+00:00', isRoot: true }],
      invitations: [{ id: invitationId, clientId, targetRole: 'trainer', expiresAt: '2099-01-01T00:00:00.000000+00:00', createdAt: '2026-08-01T00:00:00.000000+00:00' }],
    })
    if (method === 'GET' && path.endsWith('/progress/regularity')) return jsonResponse({ regularity: [{ period: 'week', periodStart: '2026-08-17', periodEnd: '2026-08-23', plannedCount: 1, completedCount: 1, completedPlannedCount: 1, partialCount: 0, skippedCount: 0, completionPercent: 100 }] })
    if (method === 'GET' && path.endsWith('/progress/running')) return jsonResponse({ sessions: [{ workoutId, workoutDate: '2026-08-20', format: 'easy', distanceKm: 5, durationSec: 1800, paceSecPerKm: 360, rpe: 7 }] })
    if (method === 'GET' && path.includes('/progress/exercises/')) return jsonResponse({ items: [{ workoutId, workoutDate: '2026-08-20', completedAt: '2026-08-20T10:00:00.000000+00:00', exerciseName: 'Отжимания', inputKind: 'strength', confirmedSetCount: 1, primaryValue: 22, previousPrimaryValue: 20, primaryChange: 2, allTimePrimaryValue: 22, bestWeightKg: 22, repsAtBestWeight: 10, bestWeightReps: 220, allTimeBestWeightKg: 22, allTimeBestWeightReps: 220, isPrimaryPr: true, isWeightPr: true, isWeightRepsPr: true, trainerComment: null, sets: [{ weightKg: 22, reps: 10, durationSec: null, distanceKm: null, rpe: 8 }] }], nextCursor: null, totalCount: 1 })
    if (method === 'GET' && path.endsWith('/progress')) return jsonResponse({
      entries: [{ id: progressId, clientId, createdBy: actor.userId, recordedOn: '2026-08-01', weightKg: 80, chestCm: null, waistCm: null, hipCm: null, notes: 'Старт', customMetrics: [{ metricId, value: 60 }], version: 1 }],
      customMetrics: [{ id: metricId, clientId, name: 'Пульс', unit: 'уд/мин', archivedAt: null, version: 1 }],
      goal: { id: goalId, clientId, title: 'Снизить вес', targetDate: '2026-12-01', status: 'active', version: 1, stages: [{ id: stageId, goalId, title: 'Первый этап', startsOn: '2026-08-01', endsOn: '2026-08-31', position: 0, version: 1 }], criteria: [{ id: criterionId, goalId, metric: 'weight', operation: 'decrease_to', targetValue: 75, rangeMin: null, rangeMax: null, unit: 'кг', confirmationStatus: 'confirmed', position: 0, version: 1 }] },
    })
    if (method === 'GET' && path.endsWith('/training-summaries')) {
      const metrics = { completed_workouts: 1, workouts_per_week: 1, active_weeks: 1, longest_gap_days: 0, progress_facts: [] }
      return summaryMode === 'published'
        ? jsonResponse({ summaries: [{ id: publishedSummaryId, source_summary_id: summaryId, client_id: clientId, period_start: '2026-08-01', period_end: '2026-08-31', summary: clientSummary, display_metrics: metrics, generated_at: '2026-09-01T00:00:00.000000+00:00', published_at: '2026-09-02T00:00:00.000000+00:00' }] })
        : jsonResponse({ summaries: [{ id: summaryId, client_id: clientId, period_start: '2026-08-01', period_end: '2026-08-31', trainer_summary: { headline: 'Итог', progress: ['Рост'], consistency: 'Стабильно', attention: [] }, client_summary: clientSummary, display_metrics: metrics, generated_at: '2026-09-01T00:00:00.000000+00:00', version: 1, published: false }] })
    }
    if (method === 'GET' && path === '/v1/push-notifications/status') return jsonResponse({ status: { subscribed: true, preferences: { workout_reminder: true, workout_scheduled: false, chat_message: true } } })
    if (method === 'POST' && path === `/v1/trainers/${publicProfileId}/chat`) return jsonResponse({ conversationId })
    if (method === 'GET' && path === `/v1/chat/conversations/${conversationId}/connection`) return jsonResponse({ state: { activeConnection: false, invitationPending: false, invitedAt: null, canInvite: true, canAccept: false, trainerSwitchRequired: false } })
    if (method === 'POST' && path === `/v1/chat/conversations/${conversationId}/connection/invite`) return jsonResponse({ state: { activeConnection: false, invitationPending: true, invitedAt: '2026-09-12T10:00:00.000000+00:00', canInvite: true, canAccept: false, trainerSwitchRequired: false } })
    if (method === 'POST' && path === `/v1/chat/conversations/${conversationId}/connection/accept`) return jsonResponse({ state: { activeConnection: true, invitationPending: false, invitedAt: '2026-09-12T10:00:00.000000+00:00', canInvite: false, canAccept: false, trainerSwitchRequired: false } })
    if (method === 'POST' && path === '/v1/push-notifications/subscription/status') return jsonResponse({ subscribed: true })
    if (path === '/v1/assistant/yandex/suggest-goal-criteria') return jsonResponse({ criteria: [], needsInput: [], unsupportedReason: null })
    if (path.endsWith('/training-summaries/generate')) return jsonResponse({ data: { generated_at: '2026-09-01T00:00:00.000000+00:00' }, cached: false })
    if (path === '/v1/invitations' && method === 'POST') return jsonResponse({ invitation: { code: 'ABCDEF123456' } }, 201)
    if (path === '/v1/invitations/claim') return jsonResponse({ clientId })
    if (path === '/v1/app-feedback') return jsonResponse({ feedback: { id: progressId } }, 201)
    if (path === '/v1/custom-exercises' || path.includes('/custom-exercises/')) return jsonResponse({ exercise: { id: customExerciseId, ...customExerciseDraft(), archivedAt: path.endsWith('/archive') ? '2026-09-01T00:00:00.000000+00:00' : null, version: 2 } })
    if (path === '/v1/progress' || path.startsWith('/v1/progress/')) return jsonResponse({ progress: { id: progressId, version: 2 } })
    if (path === '/v1/progress-metrics' || path.startsWith('/v1/progress-metrics/')) return jsonResponse({ metric: { id: metricId, archivedAt: path.endsWith('/archive') ? '2026-09-01T00:00:00.000000+00:00' : null, version: 2 } })
    if (path === '/v1/goals' || path.startsWith('/v1/goals/')) return jsonResponse({ goal: { id: goalId, version: 2 } })
    if (path === '/v1/goal-stages' || path.startsWith('/v1/goal-stages/')) return method === 'DELETE' ? emptyResponse() : jsonResponse({ stage: { id: stageId } })
    if (path.includes('/attention/snooze')) return jsonResponse({ client: { snoozedUntil: '2026-09-15T00:00:00.000000+00:00' } })
    if (path.includes('/workout-sets/')) return jsonResponse({ set: { version: 2 } })
    if (path.includes('/workout-exercises/') && path.endsWith('/sets')) return jsonResponse({ set: { version: 2 } }, 201)
    if (path.includes('/workout-exercises/') && path.endsWith('/comment')) return jsonResponse({ exercise: { version: 2 } })
    if (path.includes('/blocks/')) return jsonResponse({ block: { version: 2 } })
    if (path.includes('/workouts/') && path.endsWith('/exercises') && method === 'POST') return jsonResponse({ exercise: { version: 2 } }, 201)
    if (path.includes('/workouts/') && path.includes('/exercises/') && method === 'PUT') return jsonResponse({ exercise: { version: 2 } })
    if (path.startsWith('/v1/workouts')) {
      if (path === '/v1/workouts' || path === '/v1/workouts/completed'
        || path.endsWith('/completed') || path.endsWith('/result')
        || (method === 'PUT' && /^\/v1\/workouts\/[^/]+$/.test(path))) {
        return jsonResponse({ workout: { id: workoutId, version: 2 } })
      }
      return jsonResponse({ workout: { version: 2 } })
    }
    if (path === '/v1/clients' && method === 'POST') return jsonResponse({ client: { id: clientId } }, 201)
    if (path === '/v1/clients/me/quick' && method === 'POST') return jsonResponse({ client: { id: clientId, version: 1, membershipVersion: 1 } })
    if (path.startsWith('/v1/clients/') && path.endsWith('/preferences')) return jsonResponse({ client: { membershipVersion: 2 } })
    if (path.startsWith('/v1/clients/')) return jsonResponse({ client: { id: clientId, version: 2 } })
    return emptyResponse()
  })
}

function emptyResponse(): Response {
  return new Response(null, { status: 204 })
}
