import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ClientTrainingSummary,
  SessionActor,
  Workout,
  WorkoutDraft,
} from '../../shared/domain'
import { localDate } from '../../shared/local-date'
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

const push = vi.hoisted(() => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }))
vi.mock('../../features/notifications/push-subscription', () => ({
  subscribeToPush: push.subscribe,
  unsubscribeFromPush: push.unsubscribe,
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

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
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
    expect(custom.createdBy).toBe(actor.userId)
    const created = await repository.exercises.create(actor.userId, customExerciseDraft())
    const updated = await repository.exercises.update(created, customExerciseDraft())
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
    await repository.goals.deleteStage(stageId)

    expect(fetchMock).toHaveBeenCalled()
  })

  it('implements the complete workout lifecycle and derived reads', async () => {
    vi.stubGlobal('fetch', installContractFetch())
    installTrainingData()
    const repository = createYandexMainRepository(apiBaseUrl, sessionToken, actor)
    const item = await repository.workouts.get(workoutId)
    expect(item.stageId).toBe(stageId)
    await expect(repository.workouts.get('555b5163-cd40-4c96-b0d1-ce1a250d25df')).rejects.toMatchObject({ code: 'PT404' })
    expect((await repository.workouts.listPage(undefined, undefined, clientId, 0, 1)).nextOffset).toBe(1)
    expect(await repository.workouts.list('2026-08-01', '2026-08-31', clientId)).toHaveLength(2)
    expect(await repository.workouts.listSummaries(clientId)).toHaveLength(2)
    expect((await repository.workouts.findActive(clientId))?.id).toBe(plannedWorkoutId)
    expect(await repository.workouts.personalRecords(workoutId)).toHaveLength(3)
    expect((await repository.workouts.latestExerciseResults(clientId, ['push-up'])).get('push-up')?.sets).toHaveLength(1)
    expect((await repository.workouts.exerciseProgressPage(clientId, 'push-up', {
      completedAt: '2026-08-20T10:00:00.000Z', workoutId,
    })).totalCount).toBe(1)

    const draft = workoutDraft()
    await repository.workouts.save(draft)
    await repository.workouts.save({ ...draft, id: workoutId, version: 1 })
    await repository.workouts.saveCompleted(draft)
    await repository.workouts.saveCompleted({ ...draft, id: workoutId, version: 1 })
    await repository.workouts.recordPlannedResult({ ...draft, id: workoutId, version: 1 })
    await expect(repository.workouts.recordPlannedResult(draft)).rejects.toThrow('не выбрана')
    await repository.workouts.start(item)
    await repository.workouts.cancelPlanned(item)
    await repository.workouts.reschedule(item, localDate('2026-08-22'), '12:00')
    await repository.workouts.saveLiveSet(setId, { weightKg: 42, reps: 10 }, item.version)
    await repository.workouts.confirmLiveSet(setId, item.version)
    await repository.workouts.appendLiveExercise(item, exerciseSnapshot())
    await repository.workouts.appendLiveSet(item, exerciseId)
    await repository.workouts.removeLiveSet(item, setId)
    await repository.workouts.reorderLiveBlock(item, blockId, -1)
    await repository.workouts.setExerciseComment(item, exerciseId, 'Комментарий')
    await repository.workouts.setWorkoutReview(item, { reaction: 'fire', review: 'Отлично' })
    await repository.workouts.setClientWorkoutComment(item, 'Сложно')
    await repository.workouts.submitFeedback(item, { sessionRpe: 8, wellbeing: 'normal', discomfort: false, comment: 'Хорошо' })
    await repository.workouts.askQuestion(item, 'Что дальше?')
    await repository.workouts.answerQuestion(item, { reaction: undefined, review: 'Продолжаем' })
    await repository.workouts.resolveQuestion(item)
    expect(await repository.workouts.listTrainerAttention()).toHaveLength(1)
    await repository.workouts.snoozeClientAttention(clientId)
    await repository.workouts.replaceLiveExercise(item, exerciseId, exerciseSnapshot())
    await repository.workouts.finish(item)
    await repository.workouts.remove(item)
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

  it('loads every training-data page before serving the sticky repository', async () => {
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
      2, apiBaseUrl, sessionToken, 'read_write', { limit: 100, offset: 1 },
    )
  })

  it('implements invitations, summaries, feedback, push and polling', async () => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'public-key')
    vi.stubGlobal('fetch', installContractFetch())
    installTrainingData()
    push.subscribe.mockResolvedValue({ endpoint: 'https://push.example.test', p256dh: 'p', authKey: 'a' })
    push.unsubscribe.mockResolvedValue(undefined)
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
    expect(await repository.pushNotifications.status(actor.userId)).toEqual({ subscribed: true, workoutReminderEnabled: true })
    await repository.pushNotifications.enable(actor.userId)
    await repository.pushNotifications.disable(actor.userId)

    const onChange = vi.fn()
    const onReady = vi.fn()
    const unsubscribe = repository.realtime.subscribeToClientChanges(clientId, onChange, onReady)
    expect(onReady).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(onChange).toHaveBeenCalledOnce()
    unsubscribe()
  })
})

let summaryMode: 'internal' | 'published' = 'internal'

function installTrainingData() {
  pilot.listTrainingData.mockResolvedValue({
    customExercises: [{
      id: customExerciseId, name: 'Тяга', muscleGroup: 'back', inputKind: 'strength',
      archivedAt: null, version: 1, createdBy: actor.userId,
    }],
    workouts: [workoutPayload(plannedWorkoutId, 'in_progress', '2026-08-21'), workoutPayload(workoutId, 'done', '2026-08-20')],
    attention: [{
      workoutId, clientId, clientName: 'Клиент', workoutDate: '2026-08-20',
      clientQuestion: 'Что дальше?', clientQuestionAskedAt: '2026-08-20T10:00:00.000Z',
      discomfort: false, clientComment: 'Хорошо', feedbackSubmittedAt: '2026-08-20T10:00:00.000Z', version: 1,
    }],
    attentionPreferences: [{ clientId, snoozedUntil: null }],
    hasMoreWorkouts: false,
    totalWorkouts: 2,
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
    startedAt: '2026-08-20T09:00:00.000Z', completedAt: status === 'done' ? '2026-08-20T10:00:00.000Z' : null,
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
        confirmedAt: status === 'done' ? '2026-08-20T10:00:00.000Z' : null, version: 1,
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
  return { name: 'Тяга', muscleGroup: 'back' as const, inputKind: 'strength' as const }
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
    if (method === 'GET' && path === '/v1/clients') return jsonResponse({ clients: [
      { id: clientId, hasAccount: true, fullName: 'Клиент', canonicalFullName: 'Клиент', gender: 'male', ageYears: 30, ageUpdatedAt: '2026-08-01', heightCm: 180, goal: 'Сила', note: null, currentWeightKg: 80, lastActivityAt: '2026-08-20T10:00:00.000Z', archivedAt: null, version: 1, membershipVersion: 1 },
      { id: archivedClientId, hasAccount: false, fullName: 'Архив', canonicalFullName: 'Архив', gender: null, ageYears: null, ageUpdatedAt: null, heightCm: null, goal: null, note: null, currentWeightKg: null, archivedAt: '2026-08-01T00:00:00.000Z', version: 1, membershipVersion: null },
    ] })
    if (method === 'GET' && path === '/v1/connections') return jsonResponse({
      memberships: [{ clientId, trainerId: actor.userId, firstName: 'Ирина', lastName: null, joinedAt: '2026-08-01T00:00:00.000Z', isRoot: true }],
      invitations: [{ id: invitationId, clientId, targetRole: 'trainer', expiresAt: '2099-01-01T00:00:00.000Z', createdAt: '2026-08-01T00:00:00.000Z' }],
    })
    if (method === 'GET' && path.endsWith('/progress/regularity')) return jsonResponse({ regularity: [{ period: 'week', periodStart: '2026-08-17', periodEnd: '2026-08-23', plannedCount: 1, completedCount: 1, completedPlannedCount: 1, partialCount: 0, skippedCount: 0, completionPercent: 100 }] })
    if (method === 'GET' && path.endsWith('/progress/running')) return jsonResponse({ sessions: [{ workoutId, workoutDate: '2026-08-20', format: 'easy', distanceKm: 5, durationSec: 1800, paceSecPerKm: 360, rpe: 7 }] })
    if (method === 'GET' && path.includes('/progress/exercises/')) return jsonResponse({ items: [{ workoutId, workoutDate: '2026-08-20', completedAt: '2026-08-20T10:00:00.000Z', exerciseName: 'Отжимания', inputKind: 'strength', confirmedSetCount: 1, primaryValue: 22, previousPrimaryValue: 20, primaryChange: 2, allTimePrimaryValue: 22, bestWeightKg: 22, repsAtBestWeight: 10, bestWeightReps: 220, allTimeBestWeightKg: 22, allTimeBestWeightReps: 220, isPrimaryPr: true, isWeightPr: true, isWeightRepsPr: true, trainerComment: null, sets: [{ weightKg: 22, reps: 10, durationSec: null, distanceKm: null, rpe: 8 }] }], nextCursor: null, totalCount: 1 })
    if (method === 'GET' && path.endsWith('/progress')) return jsonResponse({
      entries: [{ id: progressId, clientId, createdBy: actor.userId, recordedOn: '2026-08-01', weightKg: 80, chestCm: null, waistCm: null, hipCm: null, notes: 'Старт', customMetrics: [{ metricId, value: 60 }], version: 1 }],
      customMetrics: [{ id: metricId, clientId, name: 'Пульс', unit: 'уд/мин', archivedAt: null, version: 1 }],
      goal: { id: goalId, clientId, title: 'Снизить вес', targetDate: '2026-12-01', status: 'active', version: 1, stages: [{ id: stageId, goalId, title: 'Первый этап', startsOn: '2026-08-01', endsOn: '2026-08-31', position: 0, version: 1 }], criteria: [{ id: criterionId, goalId, metric: 'weight', operation: 'decrease_to', targetValue: 75, rangeMin: null, rangeMax: null, unit: 'кг', confirmationStatus: 'confirmed', position: 0, version: 1 }] },
    })
    if (method === 'GET' && path.endsWith('/training-summaries')) {
      const metrics = { completed_workouts: 1, workouts_per_week: 1, active_weeks: 1, longest_gap_days: 0, progress_facts: [] }
      return summaryMode === 'published'
        ? jsonResponse({ summaries: [{ id: publishedSummaryId, source_summary_id: summaryId, client_id: clientId, period_start: '2026-08-01', period_end: '2026-08-31', summary: clientSummary, display_metrics: metrics, generated_at: '2026-09-01T00:00:00.000Z', published_at: '2026-09-02T00:00:00.000Z' }] })
        : jsonResponse({ summaries: [{ id: summaryId, client_id: clientId, period_start: '2026-08-01', period_end: '2026-08-31', trainer_summary: { headline: 'Итог', progress: ['Рост'], consistency: 'Стабильно', attention: [] }, client_summary: clientSummary, display_metrics: metrics, generated_at: '2026-09-01T00:00:00.000Z', version: 1, published: false }] })
    }
    if (method === 'GET' && path === '/v1/push-notifications/status') return jsonResponse({ status: { subscribed: true, preferences: { workout_reminder: true, workout_scheduled: false } } })
    if (path === '/v1/assistant/yandex/suggest-goal-criteria') return jsonResponse({ criteria: [], needsInput: [], unsupportedReason: null })
    if (path.endsWith('/training-summaries/generate')) return jsonResponse({ data: { generated_at: '2026-09-01T00:00:00.000Z' }, cached: false })
    if (path === '/v1/invitations' && method === 'POST') return jsonResponse({ invitation: { code: 'ABCDEF123456' } }, 201)
    if (path === '/v1/invitations/claim') return jsonResponse({ clientId })
    if (path === '/v1/app-feedback') return jsonResponse({ feedback: { id: progressId } }, 201)
    if (path === '/v1/custom-exercises' || path.includes('/custom-exercises/')) return jsonResponse({ exercise: { id: customExerciseId, name: 'Тяга', muscleGroup: 'back', inputKind: 'strength', archivedAt: path.endsWith('/archive') ? '2026-09-01T00:00:00.000Z' : null, version: 2 } })
    if (path === '/v1/progress' || path.startsWith('/v1/progress/')) return jsonResponse({ progress: { id: progressId, version: 2 } })
    if (path === '/v1/progress-metrics' || path.startsWith('/v1/progress-metrics/')) return jsonResponse({ metric: { id: metricId, archivedAt: path.endsWith('/archive') ? '2026-09-01T00:00:00.000Z' : null, version: 2 } })
    if (path === '/v1/goals' || path.startsWith('/v1/goals/')) return jsonResponse({ goal: { id: goalId, version: 2 } })
    if (path === '/v1/goal-stages' || path.startsWith('/v1/goal-stages/')) return method === 'DELETE' ? emptyResponse() : jsonResponse({ stage: { id: stageId } })
    if (path.includes('/attention/snooze')) return jsonResponse({ client: { snoozedUntil: '2026-09-15T00:00:00.000Z' } })
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
    if (path.startsWith('/v1/clients/') && path.endsWith('/preferences')) return jsonResponse({ client: { membershipVersion: 2 } })
    if (path.startsWith('/v1/clients/')) return jsonResponse({ client: { id: clientId, version: 2 } })
    return emptyResponse()
  })
}

function emptyResponse(): Response {
  return new Response(null, { status: 204 })
}
